# How GFV works: a deep tour of the code

This document explains **how GFV is built and wired together**, and **how the code is written**, so you can
read any file in the repository and know why it is there. It is written for someone who knows React and
Express/Node (MERN) but has not built an SSH tool before.

Every file path below is real (relative to the repository root). When a number or a name matters, it was
checked against the code. If you change the code, change this document with it.

> **How to read it.** Part 1 to 3 give you the map. Parts 4 to 9 are the server, in the order a request meets
> it. Parts 10 to 16 are the features. Part 17 is the browser side. Parts 18 to 22 are tooling, tests and a
> recipe for adding your own feature. Part 23 lists "odd looking but on purpose" decisions.
> If you only have 20 minutes, read parts 1, 2, 9 (the Command Runner) and 17.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [The repository map](#2-the-repository-map)
3. [How the code is written (conventions)](#3-how-the-code-is-written-conventions)
4. [Start-up and wiring (the dependency graph)](#4-start-up-and-wiring-the-dependency-graph)
5. [The HTTP layer: Fastify, auth, hooks](#5-the-http-layer-fastify-auth-hooks)
6. [The database](#6-the-database)
7. [Secrets and security](#7-secrets-and-security)
8. [The SSH layer](#8-the-ssh-layer)
9. [The Command Runner (the heart of GFV)](#9-the-command-runner-the-heart-of-gfv)
10. [The Safety Net (danger detection)](#10-the-safety-net-danger-detection)
11. [The Terminal](#11-the-terminal)
12. [Files and the Editor (SFTP)](#12-files-and-the-editor-sftp)
13. [Snapshots (backups before changes)](#13-snapshots-backups-before-changes)
14. [Monitor, Services and Docker (quiet queries)](#14-monitor-services-and-docker-quiet-queries)
15. [Dev Hub (installs)](#15-dev-hub-installs)
16. [Recipes (record and export)](#16-recipes-record-and-export)
17. [The browser side](#17-the-browser-side)
18. [The shared package](#18-the-shared-package)
19. [Run modes and packaging](#19-run-modes-and-packaging)
20. [Testing strategy](#20-testing-strategy)
21. [End-to-end walkthroughs](#21-end-to-end-walkthroughs)
22. [How to add a feature](#22-how-to-add-a-feature)
23. [Odd-looking decisions that are on purpose](#23-odd-looking-decisions-that-are-on-purpose)
24. [Glossary](#24-glossary)

---

## 1. The big picture

GFV is a **local web app that controls remote servers over SSH**.

```
 YOUR COMPUTER                                                      YOUR SERVER(S)
┌──────────────────────────────────────────────────────────┐      ┌──────────────┐
│  Browser (React)                                          │      │  sshd        │
│  desktop, windows, apps                                   │      │  bash        │
│       │  HTTP + WebSocket (127.0.0.1 only)                │      │  /etc /proc  │
│       ▼                                                   │ SSH  │  systemd     │
│  Node server (Fastify)                                    │─────►│  docker ...  │
│   ├─ auth (token/cookie)                                  │      └──────────────┘
│   ├─ Command Runner  ← every "do something" goes here     │
│   ├─ SSH pool (one live connection per server)            │
│   ├─ SFTP service (file bytes)                            │
│   ├─ Vault (master password → encryption key)             │
│   └─ SQLite file  ~/.gfv/gfv.db                           │
└──────────────────────────────────────────────────────────┘
```

Three things make it more than "a terminal in the browser", and they shape the whole architecture:

| Idea           | Meaning                                                | What it forced in the code                                        |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| **Learn Mode** | every action shows the real command and an explanation | actions are _data_ (an `Action` object), not hidden code          |
| **Safety Net** | risky things are confirmed, config files are backed up | all changes pass through **one** place that can check and back up |
| **Recipes**    | what you did becomes a bash script                     | actions are replayable (id + parameters), so they can be recorded |

That one place is the **Command Runner**. Almost everything else exists to feed it or show its results.

**The "database" of your servers is the servers themselves.** GFV stores very little (server list, encrypted
credentials, history, recipes). The truth about files, processes and services is read live over SSH.

**Mental model for a MERN developer:**

- The server is an Express-like API (Fastify) plus WebSockets. It talks to SQLite instead of Mongo/Postgres.
- The "third party API" it calls is _your VPS_, through an SSH library (`ssh2`).
- The frontend is a normal React SPA (Vite), but its UI is a window manager (like an OS desktop).
- `shared/` is a package imported by both sides: Zod schemas and the action catalogue live there, so the two
  sides can never disagree about a shape.

---

## 2. The repository map

It is a **pnpm workspace** with three packages plus tooling:

```
gfv/
├─ shared/            @gfv/shared  types, Zod schemas, the ACTION CATALOGUE, danger detector, parsers
│  └─ src/
│     ├─ actions/     define.ts (Action type), index.ts (catalogue + previewAction), files.ts, services.ts,
│     │               docker.ts, monitor.ts, devhub.ts, samples.ts
│     ├─ danger.ts    detectDanger(): "is this command line risky?"
│     ├─ shell.ts     shellQuote(): the only way a value enters a command
│     ├─ snapshots.ts backup command generator + path rules
│     ├─ runner.ts    request/stream message shapes for the Command Runner
│     ├─ terminal.ts  WebSocket message shapes for the terminal
│     ├─ files.ts     file API shapes and limits
│     ├─ schemas.ts   server/connection/vault API shapes
│     ├─ learn.ts     commandNames(): which programs did a command line use?
│     ├─ metrics/     sample.ts, lists.ts: parsers for /proc, ps, systemctl, docker output
│     ├─ devhub/      tools.ts (install catalogue), detect.ts (what is installed)
│     └─ recipes/     recipes.ts (shapes), export.ts (recipe → bash script)
│
├─ server/            @gfv/server  Node + Fastify + ssh2 + SQLite
│  ├─ drizzle/        SQL migrations (0000 … 0003)
│  └─ src/
│     ├─ index.ts     dev entry (Vite serves the web app)
│     ├─ cli.ts       `gfv` command entry (production)
│     ├─ start.ts     startServer(): builds every object and wires them together
│     ├─ app.ts       buildApp(): the Fastify instance + all route modules
│     ├─ auth.ts      token / cookie / Origin checks
│     ├─ context.ts   AppContext: what every route module receives
│     ├─ crypto/      vault.ts: master password → AES key, encrypt/decrypt
│     ├─ db/          schema.ts (tables), index.ts (open + migrate), vaultStore.ts
│     ├─ ssh/         connect.ts (one connection), pool.ts (all connections), hostKeys.ts (TOFU)
│     ├─ services/    runner/ (Command Runner), sftp/ (files), recipes/ (recorder)
│     ├─ terminal/    lineTracker.ts, altScreen.ts: the terminal's Safety Net
│     └─ routes/      one file per area: vault, servers, connections, runs, files, recipes, terminal, ws
│
├─ web/               @gfv/web  React 19 + Vite + Tailwind v4 + Zustand
│  └─ src/
│     ├─ main.tsx, App.tsx          entry and the unlock gate
│     ├─ desktop/                   window manager and shell: Desktop, Window, MenuBar, Dock, Spotlight, windowStore
│     ├─ apps/                      one folder per app (terminal, files, editor, monitor, services, ...)
│     ├─ runner/                    RunDialog + runStore: the UI for the Command Runner
│     ├─ learn/                     LearnPanel (journal)
│     ├─ tour/                      onboarding tour
│     ├─ stores/                    Zustand stores: server, learn, recording
│     ├─ components/                shared UI (ui/ = shadcn-style primitives)
│     ├─ hooks/usePolling.ts
│     └─ lib/                       api.ts (HTTP client), ws.ts (status socket), storage.ts, utils.ts
│
├─ e2e/               Docker test servers, shims, Playwright specs
├─ scripts/           dev.mjs (run dev), build-package.mjs (make the npm package)
├─ docs/              README images and this document
├─ README.md          how to install and use
├─ PLAN.md            features, milestones, v2 ideas (source of truth for scope)
└─ CLAUDE.md          conventions, status per milestone, gotchas
```

Size, roughly: shared ≈ 2,200 lines, server ≈ 2,900 lines, web ≈ 5,800 lines of non-test code, plus ≈ 2,900
lines of tests. The biggest single files are `web/src/apps/files/FilesApp.tsx` (376), `server/src/services/runner/runner.ts`
(382) and `shared/src/danger.ts` (366).

---

## 3. How the code is written (conventions)

Knowing the habits makes every file predictable.

### 3.1 TypeScript, strictly

`tsconfig.base.json` turns on `strict`, **`noUncheckedIndexedAccess`** (an array index may be `undefined`, so the
code writes `tokens[i]!` only when it has just proven the index exists) and **`verbatimModuleSyntax`** (type-only
imports must say `import type`). Everything is ESM (`"type": "module"`), so imports end in `.js` even in `.ts`
files (`import { x } from './auth.js'`). That is how Node's ESM resolution wants it.

### 3.2 One definition, used on both sides (Zod)

A shape is written **once** as a Zod schema in `shared/`, and both sides import it:

```ts
// shared/src/files.ts
export const FileEntrySchema = z.object({ name: z.string(), path: z.string(), type: z.enum([...]), ... });
export type FileEntry = z.infer<typeof FileEntrySchema>;   // the TypeScript type comes from the schema
```

The server uses `Schema.safeParse(req.body)` to **validate input**; the browser uses `Schema.parse(response)` to
**validate output** (see `web/src/lib/api.ts`). If the two ever disagree, a test or a runtime parse fails loudly
instead of the UI showing `undefined`.

### 3.3 Dependency injection by a plain object

There are no classes with hidden singletons. `server/src/start.ts` creates each service and passes them in an
`AppContext` object (`server/src/context.ts`): `{ db, vault, pool, runner, sftp, recipes, allowedOrigins }`. Every
route module is a function `(app, ctx) => void` that takes only what it needs by destructuring:

```ts
export function fileRoutes(app: FastifyInstance, { sftp, vault }: AppContext): void { ... }
```

This makes tests easy: `server/src/testUtil.ts` builds the same context with an in-memory database.

### 3.4 Results as data, not exceptions

Where failure is _normal_ (wrong password, host key unknown, not connected, invalid params) functions return a
**discriminated union** and the caller must handle each case:

```ts
type ConnectOutcome =
  | { status: 'connected'; client: Client }
  | { status: 'host_key_unknown'; keyType: string; fingerprint: string }
  | { status: 'host_key_changed'; ... } | { status: 'auth_failed' } | { status: 'error'; message: string };
```

Exceptions are kept for the truly unexpected. TypeScript then proves every case is handled (the `switch` on
`status` in the web app has no missing branch).

### 3.5 Pure functions in `shared/`, side effects at the edges

Anything that can be a pure function (no network, no clock, no database) is one and lives in `shared/`:
`previewAction`, `detectDanger`, `shellQuote`, `parseSample`, `exportRecipe`, `commandNames`, `parseDetect`. They are
unit-tested with plain inputs and outputs. The side effects (SSH, SQLite, WebSocket, React) live in `server/` and
`web/` and call the pure functions. This split is why the project has 270+ fast tests.

### 3.6 Small modules, comments that say _why_

Each file has one job. Comments explain intent and traps ("why `-nT`", "why a PTY here"), not what the next line
does. Security-sensitive spots carry a sentence saying what must never happen ("never log terminal input").

### 3.7 Security rules written into the code style

1. **Never build a command by string concatenation with user data.** Values go through `shellQuote()`.
2. **Validate with Zod before using** anything from the network.
3. **Never log or return secrets.** The credential blob is stripped by `toPublic()` before any response.
4. **Defaults deny.** Unknown things are refused (unknown origin, unknown action, unknown path shape).

### 3.8 Tests live next to the code

`foo.ts` → `foo.test.ts` (unit). Anything that needs a real SSH server is `*.int.test.ts` and skips itself when
the Docker test servers are not running. Browser specs are `e2e/*.spec.ts` (Playwright). Details in part 20.

### 3.9 Tooling

| Tool                | Role                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm workspaces     | three packages, one lockfile. `@gfv/shared` is linked, and consumed **as TypeScript source** (`"main": "src/index.ts"`), so there is no build step for it in development. |
| tsx                 | runs server TypeScript directly (`tsx watch` in dev).                                                                                                                     |
| Vite                | dev server and production build of the web app.                                                                                                                           |
| Vitest              | unit + integration tests (`pnpm test`), configured in `vitest.config.ts` to run `*.test.ts` only.                                                                         |
| Playwright          | browser specs (`pnpm e2e`).                                                                                                                                               |
| ESLint + Prettier   | `pnpm lint`, `pnpm format`.                                                                                                                                               |
| Drizzle (ORM + kit) | typed SQL and migrations (`pnpm --filter @gfv/server db:generate`).                                                                                                       |
| esbuild             | bundles the server into one file for the npm package.                                                                                                                     |

---

## 4. Start-up and wiring (the dependency graph)

`server/src/start.ts` is the **composition root**: the one place where objects are created and connected.
Reading it top to bottom tells you the whole shape of the backend:

```
startServer(opts)
  process.umask(0o077)                      files we create are private to your user
  db       = openDb()                       SQLite file + run migrations
  vault    = new Vault(dbVaultStore(db))    master password handling (needs the db to persist salt/canary)
  pool     = new SshPool(db, vault, dbHostKeyStore(db))   connections (needs vault to decrypt credentials)
  runner   = new Runner(db, pool)           the Command Runner (needs pool to run, db for history)
  recipes  = new RecipeService(db)
  runner.onSuccess(recipes.recordRun)       ← wiring by event: a successful run may become a recipe step
  sftp     = new SftpService(pool, db)
  runner.onSnapshot(e => sftp.prune(...))   ← wiring by event: keep only the newest backups
  app      = buildApp(token, { db, vault, pool, runner, sftp, recipes, allowedOrigins })
  (production only) serve web app + token→cookie redirect
  app.listen(127.0.0.1, port)
```

As a graph (an arrow means "uses"):

```
   routes ──► AppContext ──► runner ──► pool ──► vault ──► db
                         ├─► sftp ───► pool                 ▲
                         ├─► recipes ───────────────────────┤
                         └─► db ────────────────────────────┘
   runner ─(events)─► recipes, sftp          (no import cycle: the arrow is a callback)
```

Two details worth noticing:

- **The two `runner.on…` lines are how services stay decoupled.** The runner does not import the recipe or SFTP
  code; it just calls whatever listeners were registered. This avoids circular imports.
- **`index.ts` (dev) and `cli.ts` (production) both call `startServer`.** They only differ in options (a
  dev web port to allow, or a folder of built web files to serve).

---

## 5. The HTTP layer: Fastify, auth, hooks

`server/src/app.ts` (`buildApp`) creates the Fastify instance and registers everything.

**Fastify in one paragraph (for Express users):** routes are `app.get(path, handler)`; the handler can return a
value (it becomes the JSON response) or use `reply`. `app.addHook('onRequest' | 'preHandler', fn)` are like
middleware. Plugins add features (`@fastify/websocket` adds `{ websocket: true }` routes; `@fastify/static`
serves files).

### 5.1 What `buildApp` sets up, in order

1. **JSON parser tweak.** Many action endpoints have no body but browsers still send
   `content-type: application/json`; an empty body would be a 400 in stock Fastify. The custom parser treats
   empty as "no body".
2. **Raw bytes parser** for `application/octet-stream`. It hands the route the _stream itself_, so file saves
   and uploads are piped to SFTP without buffering (no multipart library needed).
3. **`@fastify/websocket`.**
4. **`registerAuth`** (see 5.2).
5. **Route modules:** `vaultRoutes`, `serverRoutes`, `connectionRoutes`, `wsRoutes`, `terminalRoutes`,
   `runRoutes`, `fileRoutes`, `recipeRoutes`, plus `GET /api/health`.

The logger is `pino`, silent under tests and `warn` for the `gfv` command (`GFV_LOG_LEVEL`). Secrets are
redacted from logged headers (`req.headers.cookie`, `x-gfv-token`).

### 5.2 Authentication (`server/src/auth.ts`)

Because the server listens on `127.0.0.1`, **any web page open in your browser can send requests to it**
(that is how local-network attacks work). So every `/api` request must prove it comes from _you_:

```
onRequest hook, for URLs starting with /api:
   token = header  x-gfv-token   (dev proxy and tests)
        or cookie  gfv_token     (the browser, in production)
   no token or wrong token (timing-safe compare)  → 401
   token came from the COOKIE and the method changes things (POST/PUT/PATCH/DELETE):
        the Origin header must be one of allowedOrigins, otherwise → 403
```

How the token reaches the browser:

- **Development:** `scripts/dev.mjs` generates a random token, gives it to both server and Vite; the Vite proxy
  adds `x-gfv-token` to every proxied request (including WebSockets). The browser never sees the token.
- **Production (`gfv`):** you open `http://127.0.0.1:4310/?token=…`. `start.ts` has an `onRequest` hook that, for
  `GET /?token=<correct>`, answers `302 → /` with
  `Set-Cookie: gfv_token=…; Path=/; HttpOnly; SameSite=Strict`. From then on the browser sends the cookie.

Why both _token_ and _Origin_ and _SameSite_? Defence in depth: `SameSite=Strict` stops cross-site requests from
carrying the cookie; the Origin check stops anything that slips through; the token stops other local programs
and pages that cannot read the cookie.

**WebSockets** cannot set headers from browser JavaScript, so they rely on the cookie (or the dev proxy header)
plus an explicit Origin check in each WS route (`server/src/routes/origin.ts`).

### 5.3 "Locked" guards

Every route module that needs credentials adds a `preHandler` hook that returns **423 Locked** if the vault is not
unlocked. They are written as URL-prefix checks (`if (req.url.startsWith('/api/servers') && !vault.unlocked)`)
because hooks added with `app.addHook` apply to the whole app, not just that module. If you add a route, put it
behind the right guard or add one.

### 5.4 The routes (REST)

| Area        | Endpoints                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault       | `GET /api/vault`, `POST /api/vault/{create,unlock,lock,change-password}`                                                                                                   |
| Servers     | `GET/POST /api/servers`, `PUT/DELETE /api/servers/:id`                                                                                                                     |
| Connections | `GET /api/connections`, `POST /api/servers/:id/{connect,test,disconnect,trust-host-key}`                                                                                   |
| Runs        | `GET /api/actions`, `POST /api/runs/{preview,query}`, `POST /api/runs`, `POST /api/runs/:id/cancel`, `GET /api/history`                                                    |
| Files       | `GET /api/servers/:id/fs/{list,read,download}`, `PUT /api/servers/:id/fs/file`                                                                                             |
| Snapshots   | `GET /api/servers/:id/snapshots`, `DELETE /api/servers/:id/snapshots/:snapshotId`                                                                                          |
| Recipes     | `GET /api/recipes`, `GET/PATCH/DELETE /api/recipes/:id`, `…/export`, `…/steps/reorder`, `DELETE …/steps/:stepId`, `GET /api/recording`, `POST /api/recording/{start,stop}` |

### 5.5 The WebSockets

| Path                      | Purpose                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/api/ws`                 | pushes `{type:'connections', statuses}` whenever any server's connection status changes               |
| `/api/terminal/:serverId` | one per terminal tab: binary frames = raw terminal bytes, text frames = JSON control messages         |
| `/api/runs/:id/stream`    | a run's output: JSON messages, **replayed from the start** for late joiners, closes when the run ends |

---

## 6. The database

SQLite via `better-sqlite3` (synchronous, fast, no server) and **Drizzle** (typed queries). The file is
`~/.gfv/gfv.db` (or `$GFV_HOME/gfv.db`); `chmod 600`. `server/src/db/index.ts` opens it, sets
`journal_mode = WAL` and `foreign_keys = ON`, and **runs migrations automatically** every time.

Tables (`server/src/db/schema.ts`):

| Table          | Holds                                                                                                          | Notes                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `vault_meta`   | one row: scrypt salt + params + the encrypted "canary"                                                         | no secrets; lets us check a master password     |
| `servers`      | name, host, port, user, auth type, colour, **`credential` (encrypted blob)**                                   | blob = AES-GCM of the SSH key/password JSON     |
| `known_hosts`  | one trusted host key fingerprint per server                                                                    | the TOFU store                                  |
| `history`      | one row per Command Runner run: action, redacted params, commands, risk, exit code, times, last 8 KB of output | the Learn journal reads it                      |
| `snapshots`    | file path, where the backup lives on the server, size, time, `source` (which action) and `runId`               | the Snapshots timeline reads it                 |
| `recipes`      | name, which server it was recorded on                                                                          |                                                 |
| `recipe_steps` | position, `actionId`, validated `params` (JSON)                                                                | **not** the commands: the script is regenerated |
| `recording`    | a single row (`id = 1`) while a recording is active                                                            | survives a page reload                          |

**Migrations** are SQL files in `server/drizzle/`, generated by `drizzle-kit` from `schema.ts`. Add a column →
edit `schema.ts` → `pnpm --filter @gfv/server db:generate` → commit the new `.sql`. In the published package the
folder sits next to `dist/` (`GFV_MIGRATIONS` can override).

**Synchronous transactions.** `better-sqlite3` is synchronous, so `db.transaction(() => { ... })` runs the body
immediately inside BEGIN/COMMIT. `Vault.changePassword` relies on this to re-encrypt every credential **and**
save the new key metadata atomically.

---

## 7. Secrets and security

### 7.1 The vault (`server/src/crypto/vault.ts`)

Goal: SSH keys and passwords are stored **encrypted**, and the key to decrypt them is derived from a password
only you know, and is **never written to disk**.

```
master password ──scrypt(salt, N=2^15, r=8, p=1)──► 32-byte key   (kept ONLY in server memory)
credential JSON ──AES-256-GCM(key, random 12-byte IV)──► blob = IV | auth tag (16) | ciphertext
```

- **scrypt** is deliberately slow and memory-hungry, so guessing passwords offline is expensive.
- **AES-GCM** encrypts _and authenticates_: tampering or the wrong key makes `decipher.final()` throw.
- **The canary.** To check a password we cannot compare against a stored password (we never store it). Instead,
  at creation we encrypt a known string (`gfv-vault-canary-v1`) with the key and store it. To unlock: derive the
  key from the typed password, try to decrypt the canary; success means the password is right.
- **Lock / unlock.** `lock()` overwrites the key buffer with zeros. A browser reload does _not_ lock (the key lives
  in the server process); restarting the server or pressing 🔒 does. Locking also disconnects every SSH connection.
- **Changing the password** (`changePassword`): verify the old one, derive a new key with a **new salt**, then in
  one DB transaction re-encrypt every `servers.credential` and save the new salt/canary. A crash cannot leave
  data encrypted under a key the metadata does not match. (Tests prove a thrown transaction leaves the old
  password working.)

### 7.2 Slowing down guessing (`server/src/routes/throttle.ts`)

`AttemptThrottle`: 3 free wrong attempts, then each further failure doubles the wait (1 s, 2 s, 4 s … max 60 s).
The routes answer **429** with `retry-after` and `retryAfterSec`; the unlock screen disables its button until
then. It is in memory, so a server restart resets it, which is fine for a program only reachable from your own
computer. One throttle instance covers both unlock and change-password.

### 7.3 Credentials never leave the server

`serverRoutes` converts a database row with `toPublic()`, which removes `credential`. The browser can _write_
a credential (create/update) but can never read one back. Decryption happens in exactly one place:
`SshPool.target()`, just before connecting.

### 7.4 Host keys (TOFU)

See part 8. Short version: the first connection must be approved by you (you see the fingerprint); a later
change is **never** accepted silently.

### 7.5 Shell injection defence

Everything that goes to a shell passes `shellQuote()` (`shared/src/shell.ts`):

```ts
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw ...;
  if (value !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) && !value.startsWith('-')) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;     // single-quote, and escape embedded '
}
```

Plain words stay readable (`/var/log/syslog`), anything else is wrapped in single quotes (where the shell
interprets nothing), and a leading `-` is quoted so a value can never be read as an option. Parameters are also
validated first by Zod (for example container names must match `^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$`).

### 7.6 What the Safety Net is _not_

It is a seatbelt for mistakes, not a security boundary (part 10). A determined user can always bypass it, since
they already hold a terminal on their own server.

---

## 8. The SSH layer

Three small files in `server/src/ssh/`.

### 8.1 `connect.ts`: one connection, with host-key checking

`connect(target, hostKeys)` returns a `ConnectOutcome` (the union from 3.4). The interesting trick is **how it
does Trust-On-First-Use with the `ssh2` library**. `ssh2` calls a `hostVerifier(key)` callback during the
handshake; returning `false` aborts the connection. So:

```
hostVerifier(key):
   fp = fingerprint(key)                    "SHA256:" + unpadded base64 of sha256(key blob)   (same as ssh-keygen -l)
   stored = hostKeys.get(serverId)
   no stored key      → remember {unknown, fp}  and return false   (abort, report to the user)
   stored != fp       → remember {changed, fp, expected} and return false   (abort, NEVER auto-accept)
   stored == fp       → return true
```

After the abort, `connect()` sees the remembered problem and resolves with `host_key_unknown` /
`host_key_changed` instead of a generic error. The credentials come from `target.secret` (key + passphrase, or
password) and are never logged or included in messages. Keep-alive is 15 s; the ready timeout is 10 s.

### 8.2 `hostKeys.ts`

`fingerprint()`, `keyTypeOf()` (reads the length-prefixed type name from the raw key blob) and the
`known_hosts`-table store (`get`, `save` as an upsert).

### 8.3 `pool.ts`: all connections

`SshPool extends EventEmitter` and keeps **one live `Client` per server id**:

- `status(id)`: `disconnected | connecting | connected | error`. A change emits `'status'`, which `/api/ws`
  forwards to the browser.
- `connect(id)`: decrypts the credential (`vault.decrypt`), calls `connect()`. On an unknown/changed key it stores
  a `pending` record `{keyType, fingerprint, changed}`.
- `trustHostKey(id, fingerprint, replace)`: the user pressed "Trust". The fingerprint they send **must equal**
  the pending one (they approve exactly what they were shown); replacing a _changed_ key additionally needs
  `replace: true`. Only then is it saved.
- **Auto-reconnect.** If a connection drops and the server is in the `wanted` set (not manually disconnected),
  the pool retries with a growing delay `[1, 2, 5, 10, 30] s`. Host-key or auth problems stop the retries so the
  user can act.
- `getClient(id)` returns the live client or `undefined` (everything else uses this).
- `disconnect(id)` / `disconnectAll()`.

**Trust sequence (what happens when you press Connect the first time):**

```
browser                       server                         VPS
  POST /servers/:id/connect ─►  pool.connect ─ssh handshake──►
                                hostVerifier: no stored key → abort
  ◄─ 200 {status:'host_key_unknown', fingerprint}
  (dialog shows fingerprint; you compare it with the server's)
  POST /servers/:id/trust-host-key {fingerprint} ─► pool.trustHostKey → known_hosts row saved
  POST /servers/:id/connect ─►  handshake again, key matches → 'ready' → status 'connected'
```

---

## 9. The Command Runner (the heart of GFV)

Files: `shared/src/actions/*` (what can be done), `server/src/services/runner/runner.ts` + `run.ts` (doing it),
`web/src/runner/*` (showing it).

> **The rule:** every GUI action that changes or queries a server is an **Action**, executed by the **Runner**.
> The only exceptions are the interactive terminal (a live PTY) and moving file _bytes_ over SFTP (part 12).

### 9.1 The `Action` type (`shared/src/actions/define.ts`)

An action is a plain object that _describes_ an operation:

```ts
export const makeDir = defineAction({
  id: 'files.mkdir',
  title: 'Create a folder',
  explain: 'Creates a new folder. The -p flag means missing parent folders are created too, ...',
  params: z.object({ path: absPath }), // validated by Zod before use
  commands: ({ path }) => [`mkdir -p -- ${shellQuote(path)}`], // the real shell commands
  risk: 'safe',
  recordable: true, // may become a recipe step
  internal: true, // driven by an app, hidden from the Actions launcher
});
```

All the fields:

| Field                         | Meaning                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`, `title`, `explain`      | identity and the Learn Mode text                                                               |
| `params` (Zod)                | the only way input reaches `commands`                                                          |
| `commands(params, ctx)`       | the shell command lines. `ctx` = facts about the server (below)                                |
| `risk`, `riskReason`          | declared risk: `safe`, `caution`, `danger`                                                     |
| `dynamicRisk(params)`         | may _raise_ risk depending on params (stopping `ssh.service`, killing `sshd`)                  |
| `snapshotPaths(params)`       | files this action will overwrite → backup commands are prepended (part 13)                     |
| `exportCommands(params, ctx)` | different commands for exported scripts (e.g. a rename that is safe to run twice)              |
| `recordable`                  | may be recorded into a recipe                                                                  |
| `quiet`                       | a read-only polling query (no dialog, no history). Must be `safe` (enforced by `defineAction`) |
| `longRunning`                 | takes minutes (installs): runs in a PTY, 30-minute timeout, cancellable                        |
| `secretParams`                | param names redacted from history                                                              |
| `internal`, `fields`          | UI hints for the temporary "Actions" launcher                                                  |

`ctx` (`ActionCtx`): `sudo` (`''` if you are root, `'sudo -n '` otherwise), `home` (your home directory on the
server) and `runId` (names backup files). Commands write `${ctx.sudo}systemctl restart x`, so the same action
works for root and for a sudo user, and Learn Mode shows exactly what ran.

The catalogue (`shared/src/actions/index.ts`) is the array `ACTIONS`: **42 actions**, 8 of them quiet, 13
long-running, 28 recordable (3 danger, 26 caution, 13 safe).

### 9.2 `previewAction`: turning an action + params into a preview (pure)

```
previewAction(actionId, rawParams, ctx):
  1. find the action                              → unknown_action
  2. params.safeParse(rawParams)                  → invalid_params (with Zod issues)
  3. commands = [ ...backup commands for snapshotPaths, ...action.commands(params, ctx) ]
  4. matches  = detectDanger(each command)        (Safety Net, part 10)
  5. risk     = max( declared, dynamicRisk, worst detector match )     ← can only go UP
  6. reasons  = action.riskReason + dynamicRisk reason + each detector reason
  7. return { preview: { title, explain, commands, risk, reasons, matches, longRunning, snapshots }, params }
```

The same function powers three things: the **preview dialog**, the **server-side check before running**, and the
**recipe export** (with a different `ctx`). Step 5 is why a "safe" action whose parameters turn dangerous (for
example deleting `/etc`) still gets flagged.

### 9.3 The server side: `Runner.start`

```
start(serverId, actionId, params, { confirmed, record })
  runId  = randomUUID()
  ctx    = await ctxFor(serverId)           detect root vs sudo + $HOME once per connection (cached)
  p      = previewAction(actionId, params, { ...ctx, runId })        → errors become { ok:false, error }
  if p.risk != 'safe' and not confirmed  → { ok:false, error:'confirmation_required' }   ← SERVER-SIDE Safety Net
  client = pool.getClient(serverId)       → 'not_connected' if none
  run    = new Run(runId)                 buffers messages for replay
  execute(run, ...)  (async, not awaited)
  return { ok:true, run, preview }        the HTTP response is immediate; output streams later
```

The confirmation check is on the **server**, so a buggy or hostile browser cannot skip the Safety Net.

### 9.4 `execute`: running the commands

For each command, in order:

1. emit `{type:'step', index, total, command}`.
2. `execStep(client, command, emit, { pty, abort })`: opens a **separate SSH exec channel** for that command and
   streams its output (decoded with `StringDecoder`, so a multi-byte character split between chunks is not
   corrupted). Resolves with the exit code.
3. If the step printed `Snapshot saved: NAME (N bytes)`, record a `snapshots` row (part 13).
4. **Stop at the first non-zero exit** (later steps usually depend on earlier ones), or if cancelled.

Then it emits `{type:'done', exitCode, failedStep?, cancelled?}`, calls the success listeners (recipes) when
`exitCode === 0` and the run was not cancelled and `record` is true, and inserts a `history` row with
**redacted** params/commands/output (8 KB tail).

**Why separate channels, not one `bash -c "a && b"`?** Each command gets its own exit code and its own streamed
block in the UI, and the Learn panel can show them line by line.

**`longRunning` actions** (installs): `execStep` uses `exec(cmd, { pty: true })`. In a PTY, **Cancel** writes
Ctrl-C (`\x03`) into the channel, and the terminal driver signals the whole foreground process group, so
`apt-get` and its children stop (a plain exec would only signal the outer shell). After 3 s with no exit it
closes the channel. A 30-minute timer cancels with `cancelled: 'timeout'`. Because a PTY merges stdout/stderr and
turns `\n` into `\r\n`, the runner cleans `\r` out of the text. Exit codes for signal deaths are `128 + signal`.

### 9.5 `Run` (`server/src/services/runner/run.ts`): the replay buffer

A run starts executing the moment `POST /api/runs` is accepted, but the browser opens the WebSocket a moment
_later_. If output were only pushed live, early lines would be lost. So `Run` keeps **every message** (up to
1 MB of output) in an array. `subscribe(fn)` first **replays** the array, then adds `fn` for live messages.
Runs are forgotten 5 minutes after they finish. The same mechanism lets you close the run dialog and reopen it
later (Dev Hub "View output").

Message types (`shared/src/runner.ts`): `step`, `output {stream, text}`, `truncated`, `done`, `error`.

### 9.6 Quiet queries (`Runner.query`)

Polling views (Monitor, Services, Docker, Dev Hub's detection) would flood history and open a dialog every
2 seconds if they used normal runs. Actions with `quiet: true` go through `POST /api/runs/query`:

- run synchronously, return `{ exitCode, stdout, stderr }` as **data** (the app decides what a failure means,
  e.g. exit 127 = "not installed");
- 10 s timeout, 1 MB output cap, no dialog, **not saved to history**;
- refused (403) for any action that is not `quiet`, so this endpoint cannot run anything dangerous.

### 9.7 History, redaction and Learn Mode

`history` rows store redacted parameters. `GET /api/history` returns the entries plus `learned`: the distinct
program names found by `commandNames()` (`shared/src/learn.ts`), which skips `sudo`, `env`, shell keywords like
`if/then/fi`, and variable assignments. "You've learned N commands" is `learned.length`.

### 9.8 The UI half: `RunDialog` (`web/src/runner/RunDialog.tsx`)

A small state machine:

```
loading ──preview ok──► preview ──Run (checkbox if risky)──► running ──done──► finished
   └──error──► error                                           └─ Hide / Esc ─► (run continues; watcher takes over)
```

- `loading`: `POST /api/runs/preview` shows what _would_ run.
- `preview`: explanation, each command (with "Try it yourself"), risk reasons; risky ones need _I understand the
  risk_.
- `running`: `POST /api/runs` returns a `runId`; a WebSocket to `/api/runs/:id/stream` shows output; a timer shows
  elapsed time; long runs show **Hide** and **Cancel**.
- Any app opens it with `requestRun({ serverId, actionId, params, onDone })`. `onDone` lets the File Manager refresh
  after a change.
- **Hide:** closing the dialog while running does not stop the run. `runStore.watchRun` opens a quiet socket just
  to notice completion and clear the "Installing…" state (it is client-side: a reload forgets it, but the run still
  finishes and is in history).

---

## 10. The Safety Net (danger detection)

### 10.1 The detector (`shared/src/danger.ts`)

`detectDanger(commandLine): DangerMatch[]`, each match `{ id, level: 'caution'|'danger', reason, safer? }`. It is a
pure function used in **two** places: previews (every command an action would run) and the terminal.

How it works:

1. **Whole-line patterns** that span pipes/redirects: fork bombs, `curl … | sh`, redirects onto raw disks or into
   `/etc`, `/boot`… and `kill $(pidof sshd)`.
2. **Split into segments** on `&&`, `||`, `|`, `;`, newlines and sub-shell/backtick markers.
3. **Tokenize each segment** (respecting quotes).
4. **Find the real command**: skip `VAR=x` prefixes and wrapper commands (`sudo`, `env`, `nohup`, `time`…, with
   their options). So `sudo -u bob rm -rf /` is analysed as `rm`.
5. **Per-command rules** (a `switch` on the command name) with flags parsed (`-rf`, `--recursive`): `rm`,
   `chmod`, `chown`/`chgrp` (recursive, on critical paths such as `/`, `/etc`, `~`), `dd`, `mkfs*`/`mke2fs`/`wipefs`/
   `shred`, partition tools (`fdisk`, `parted`, `gdisk`), `ufw`, `iptables`/`ip6tables`/`nft`, `kill`/`pkill`/`killall`
   (PID 1, `sshd`), `systemctl`/`service` (stopping SSH), power commands (`shutdown`, `reboot`, `halt`, `poweroff`,
   `init 0/6`), `visudo`, and editing `sshd_config`/`sudoers`/`fstab`.
6. Results sorted danger-first, with a plain reason and, where one exists, a **safer alternative**.

Design choice: aim for _few false alarms on common accidents_ rather than perfect shell parsing. It says so in its
own header comment: a safety net for accidents, not a security boundary (aliases, variables, `eval`, scripts and
tab-completion can hide intent).

### 10.2 The terminal's check (`server/src/terminal/`)

The terminal is a raw byte stream, so the server must **rebuild the line you are typing** from keystrokes.

- `lineTracker.ts` (`LineTracker.process(input)`): a small state machine over the input. It handles printable
  characters, backspace, Ctrl-U (clear line), Ctrl-W (delete word), Ctrl-C (abort line), ANSI escape sequences
  (arrow keys), and **bracketed paste**
  (pasted text is literal: newlines in a paste do not run anything). When it sees **Enter**, it runs
  `detectDanger(line)`. If there are matches it returns `{ forward, hold }`: everything _before_ the Enter is
  forwarded, and the Enter and the rest are **withheld**.
- `altScreen.ts` (`AltScreenDetector`): full-screen programs (vim, htop, less) switch the terminal to the
  "alternate screen" (`ESC[?1049h`). Watching the **output** for that sequence tells us keystrokes are going to a
  program, not a shell prompt, so checking pauses. Sequences split across chunks are handled with a small tail.

The hold, in the terminal route: the server sends a `danger` message (line + reasons) to the browser, **ignores
further keystrokes**, and waits for `danger_decision`: `run` writes `\r` (the held Enter) then replays the rest;
`cancel` writes Ctrl-C (`\x03`) to abandon the line. It never hard-blocks: you can always press _Run anyway_.

Limits (deliberate and documented): Tab completion, Ctrl-R history search, arrow-key history recall and cursor
movement change the line in ways only the shell sees. The tracker sets an `uncertain` flag for them and still
checks what it saw, so these can bypass the check.

---

## 11. The Terminal

### 11.1 Protocol (`shared/src/terminal.ts`)

One WebSocket per tab: `/api/terminal/:serverId?cols=&rows=`.

- **Binary frames** = raw bytes (keystrokes browser→server; output server→browser).
- **Text frames** = JSON control messages. Browser→server: `resize`, `danger_decision`. Server→browser: `ready`,
  `exit`, `error`, `danger`.

### 11.2 The route (`server/src/routes/terminal.ts`)

```
WS opens ─► origin check ─► client = pool.getClient(serverId)  (else error 'not_connected')
        attach 'message' listeners IMMEDIATELY and QUEUE input        ← the browser may type before the shell exists
        client.shell({ term: 'xterm-256color', cols, rows })          ← a real PTY
        on shell ready: replay the queue, send {type:'ready'}
        stream 'data' → socket.send(binary)   with BACKPRESSURE:
              if socket.bufferedAmount > 1 MB → stream.pause(), poll every 20 ms, resume below 256 KB
        socket binary → handleInput() → LineTracker / AltScreenDetector → stream.write()
        stream 'close' → send {type:'exit'} and close
```

Three real bugs shaped this: keystrokes typed before the shell was ready were lost (hence the queue);
`cat hugefile` froze the browser (hence backpressure); and early danger checks inside `vim` produced false
warnings (hence `altScreen`). **Terminal input and output are never logged.**

### 11.3 The browser side (`web/src/apps/terminal/`)

- `TerminalView.tsx`: creates an **xterm.js** terminal and a `FitAddon`, opens the WebSocket with the current size,
  pipes bytes both ways (`term.onData` → binary frames), sends `resize` when the size changes, and shows the danger
  bar (Cancel is focused so a stray Enter never runs it) and a "Session ended / Reconnect" overlay.
  `Ctrl+Shift+C` copies (plain `Ctrl+C` stays SIGINT).
- `TerminalApp.tsx`: tabs. **Tabs stay mounted but hidden**, so their shells keep running while you look at
  another tab (hidden tabs are not re-fitted, because a `display:none` element has size 0).
- `terminalBus.ts`: lets other UI type a command into a terminal **without running it** ("Try it yourself").
  Terminals register themselves; `typeIntoTerminal(serverId, command)` finds a live one (or opens a terminal and
  waits for `ready`) and calls `term.paste(text)`. Bracketed paste means the shell shows the text but does not
  execute it; newlines are stripped anyway.

---

## 12. Files and the Editor (SFTP)

### 12.1 Why SFTP is an exception to "everything through the Runner"

Listing a folder or saving a file's bytes has no meaningful _command_ to show, and piping binary data through a
shell would corrupt it. So byte transfer uses **SFTP** (`server/src/services/sftp/sftp.ts`). Things that **are**
commands stay in the Runner: `files.mkdir`, `files.rename`, `files.chmod`, `files.delete-path`.

### 12.2 `SftpService`

- Keeps one SFTP channel per live `Client` (a `WeakMap<Client, Promise<SFTPWrapper>>`; it is dropped when the
  channel closes).
- `list(path)`: `readdir`, then `stat` each symlink to learn whether it points at a folder. Mode is returned as
  octal text (`644`).
- `readText(path)`: refuses folders, caps at **5 MB**, and treats a file as _not editable_ if it contains a NUL
  byte or is not valid UTF-8 (saving it back as text would corrupt it).
- `createReadStream(path)`: for downloads (streamed, never buffered).
- `write(path, stream, { createOnly, maxBytes })`: overwrites **in place** (keeps owner, permissions, symlinks);
  `createOnly` uses flag `wx` (uploads refuse to overwrite); a counting transform enforces the size cap while
  streaming (editor saves 5 MB, uploads 100 MB). If the path is under a protected prefix (default `/etc`) and
  exists, it makes a backup first (part 13) and **discards that backup if the write then fails**.
- Errors are mapped to codes (`not_found`, `permission_denied`, `exists`, `too_large`, …) and the route turns
  them into HTTP statuses (404, 403, 409, 413 …).

### 12.3 Routes (`server/src/routes/files.ts`)

`GET fs/list` (`~` means home), `GET fs/read` (JSON for the editor), `GET fs/download` (stream with
`content-disposition`), `PUT fs/file` (raw bytes in, `?create=1` for uploads). Paths pass `normalizePath()`
(`sftp/paths.ts`): absolute only, no NUL, normalised. SFTP itself enforces the user's permissions.

### 12.4 The browser side

- `FilesApp.tsx`: path bar, sort, hidden toggle, selection, drag-and-drop upload (each file `PUT` with
  `create=1`; existing names are skipped with a message), and buttons that call `requestRun` for mkdir/rename/
  chmod/delete with `onDone` to refresh. The root element has `data-path` so tests can wait for a folder to load.
- `EditorApp.tsx` + `MonacoEditor.tsx`: Monaco, loaded lazily (a separate ~3 MB chunk, only on first open),
  bundled locally (`monacoSetup.ts`: editor core + the lightweight syntax highlighters, one web worker, no
  TypeScript language service). Ctrl+S saves; a `●` in the window title marks unsaved changes
  (`windowStore.setTitle` + a **close guard** registry that asks before discarding).
- **Save with sudo** (when a save is refused with `permission_denied`): the browser uploads the text to
  `/tmp/gfv-save-<random>` over SFTP, then runs the **`files.write-root` action**: back up the old file, `sudo cp`
  the temp file over the real one (copying onto an existing file keeps its owner and mode), delete the temp file.
  You see and confirm every command.

---

## 13. Snapshots (backups before changes)

There are **two** mechanisms that write to the same `snapshots` table and the same place on the server
(`~/.gfv/snapshots/`):

1. **The Editor's own SFTP save** under `/etc`: `SftpService.snapshot()` copies the old file by SFTP before
   overwriting (and deletes the copy if the save fails).
2. **Runner snapshots** for any action that declares `snapshotPaths(params)`:
   `previewAction` **prepends** visible backup commands (`shared/src/snapshots.ts`):

   ```
   mkdir -p -m 700 "$HOME/.gfv" "$HOME/.gfv/snapshots"
   if [ -e FILE ]; then sudo cat -- FILE > "$HOME/.gfv/snapshots/<runId>__<flat path>" && chmod 600 ... \
        && echo "Snapshot saved: NAME (N bytes)" || { rm -f ...; echo "Could not back up" >&2; exit 1; }
   else echo "FILE does not exist yet: nothing to back up"; fi
   ```

   Design points: the copy is made with `cat … > dest` so the **redirect runs as your user** and the backup file is
   yours (readable for diffs) even when _reading_ the original needed sudo; if the backup fails the exit is
   non-zero, so **the action never runs** and nothing is overwritten; the runner parses the
   `Snapshot saved: NAME (N bytes)` line and inserts the DB row (`source` = action id, `runId`).

**Restore** (`files.restore-snapshot`) is itself an action with `snapshotPaths: [path]`, so restoring first backs
up the _current_ file: **a restore can be undone**. Its `snapshot` parameter must match `SNAPSHOT_PATH`
(`…/.gfv/snapshots/<safe name>`, no `..`), so the action cannot be used to copy arbitrary files over a target.

**Pruning:** after a snapshot is recorded the newest 30 per file are kept; older rows and their remote files are
deleted (`SftpService.prune`, called through the runner's `onSnapshot` event). A single backup can be deleted from
the Snapshots app.

**The timeline** (`web/src/apps/snapshots/SnapshotsApp.tsx`): `GET /api/servers/:id/snapshots`, grouped by file;
selecting one fetches the backup and the current file (or the previous backup) through the normal `fs/read`
endpoint and shows them in a **Monaco diff editor** (a lazy chunk shared with the Editor).

---

## 14. Monitor, Services and Docker (quiet queries)

These apps **poll**. They use `usePolling(fn, ms, enabled)` (`web/src/hooks/usePolling.ts`): runs now and every
`ms`, skips a tick while the previous call is still running, pauses while the tab is hidden, and the apps pass
`enabled = !window.minimized`.

### 14.1 Monitor

`monitor.sample` is one command that prints several `/proc` files and `df`, separated by `==section` markers
(`shared/src/actions/monitor.ts`). `parseSample` (`shared/src/metrics/sample.ts`) turns the text into numbers.
CPU % needs **two samples** (`/proc/stat` counters are cumulative): `cpuPercent(prev, cur)` uses the change in
total vs idle time; `netRate` divides byte-counter differences by the elapsed seconds and never goes negative
(counters can reset). Charts are **uPlot** (`UPlotChart.tsx`), a 60-point window (2 minutes at 2 s).
`monitor.processes` runs `ps` and `parseProcesses` reads it. Stop/Kill are ordinary actions
(`process.kill` = TERM, `process.force-kill` = KILL and `danger`), and `dynamicRisk` makes killing `sshd`/PID 1
a danger.

### 14.2 Services and Docker

`services.list` prints `systemctl list-units` and `list-unit-files`; `parseServices` merges runtime state with the
boot setting. Docker uses `docker ps --format '{{json .}}'` (one JSON object per line) which is robust to parse.
Logs are queries too (`journalctl -u … -n N`, `docker logs --tail N`), shown in `LogPanel` with a **Follow**
toggle that re-reads every 2 s. Start/stop/restart/enable/remove are normal confirmable actions. A failed query is
translated into a human message by `queryProblem()` (exit 127 → "not installed", permission → "needs root").

### 14.3 The test containers have no systemd or Docker

`e2e/shims/{systemctl,journalctl,docker}` are small shell scripts copied into the test image; they print canned
output shaped like the real tools. So the whole pipeline (command → parser → UI) is tested, but real systemd/
Docker behaviour is not. Check on a real VPS before relying on it.

---

## 15. Dev Hub (installs)

- **Catalogue** (`shared/src/devhub/tools.ts`): Node 22 via nvm, Python 3 (+pip, venv), Docker (`docker.io`),
  PostgreSQL, nginx, Git. Each has `install(ctx)` and `uninstall(ctx)` returning command lists.
- **Every install starts with `DISTRO_GUARD`**, a shell snippet that reads `/etc/os-release` and exits with a
  friendly message unless the system is Ubuntu/Debian. The guard is _inside the commands_, so it holds on the
  server too (a unit test runs it in `sh` against sample files).
- **apt, non-interactively:** `sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -y -q -o DPkg::Lock::Timeout=120 …`
  (waits up to 2 minutes for another package manager instead of failing).
- **nvm without `curl | bash`:** download a **pinned version** to a file, check its **SHA-256**, then run it, then
  `nvm install 22`. Nothing is piped into a shell, and every step is visible.
- **Docker:** the distro `docker.io` package; GFV does **not** add your user to the `docker` group (that is
  equivalent to giving root). It uses `sudo docker`.
- **Uninstall = `apt remove`** (keeps data and config). The only destructive variant is
  `devhub.purge.postgresql` (`danger`, deletes databases).
- **Detection:** `devhub.detect` is one quiet command that prints the distro and each tool's version and service
  state; `parseDetect` turns that into `{ os: { supported }, tools: { installed, version, running } }`. The cards
  poll it every 6 s and after every run.
- **Hide / resume** is described in 9.8; **Cancel** and the 30-minute timeout are in 9.4.

---

## 16. Recipes (record and export)

- **Recording** is a server-side state (`recording` table, one row). `RecipeService.start(serverId)` creates a
  recipe and the row; `stop()` deletes the row. A recording is tied to **one server**.
- **The recorder hook:** `runner.onSuccess(recipes.recordRun)`. After every successful, non-silent run,
  `recordRun` checks: a recording is active, same server, the action is `recordable` and has no `secretParams` →
  append a step `{ actionId, params }` (the validated params the runner used).
- **Steps store the action and parameters, not commands.** The script is **regenerated** at export, so improvements
  to the action catalogue improve old recipes (the trade-off: an old recipe's output can change when the catalogue
  does).
- **Export** (`shared/src/recipes/export.ts`, pure): for each step, `recipeStepInfo` builds the commands with
  `ctx = { sudo: '$SUDO ' }` and prefers `exportCommands` when present. The script:

  ```bash
  #!/usr/bin/env bash
  # Recipe: My stack
  # Exported from GFV on 2026-11-13, recorded on vps-a.
  # (explanation of what a recipe is)
  set -euo pipefail

  # Run this as root, or as a user that can use sudo.      ← only if some step needs sudo
  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

  echo '==> Step 1/2: Create a folder'
  # Creates a new folder. ...  (explanation as comments)
  mkdir -p -- /tmp/app
  ...
  ```

  Risky steps get `# ⚠ Caution/DANGER: reason` comments. Unknown or invalid steps become `# Skipped: …` instead of
  crashing. Backup commands are never exported. The recipe **name is flattened to one line**, so a name cannot
  inject script lines.

- **Idempotence** (safe to run twice) comes from the commands themselves (`mkdir -p`, `apt-get install`,
  `systemctl enable`) plus `exportCommands` where needed: the rename step becomes
  `if [ -e FROM ] && [ ! -e TO ]; then mv -nT …; else echo Skipped …; fi`.
- **Milestone test:** `server/src/ssh/recipes.int.test.ts` records on `vps-a`, exports, checks `bash -n`, **runs the
  script on the clean `vps-b`**, verifies the result, and runs it a second time.
- **UI:** menu-bar Record / Stop (n), `RecipesApp.tsx` (steps with explanations and commands, rename, reorder,
  delete, Script tab with Copy/Download). Not recorded by design: file edits, uploads, killed processes.

---

### 16.3 Parameters, jobs and replay (M11)

**Parameters** (`shared/src/recipes/params.ts`). A step's params may contain `{{name}}` inside strings; the recipe
declares `params: [{ name, label, default?, secret? }]` (column `recipes.params`). Substitution (`substitute`) happens
on the PARAMS, before the action's Zod schema and before `shellQuote`, so a value can never become shell syntax.
`resolveValues` applies defaults (a `secret` is never defaulted); `paramProblems` finds undeclared placeholders.
`RecipeService.setParams/updateStep` validate every step with stand-in values, so a recipe cannot be saved in a
state that would fail when replayed.

**Export** turns each parameter into an environment variable `GFV_<NAME>` (the prefix avoids clashes with HOME or
PATH). Steps are built with a sentinel (`__GFVPARAM_NAME__`) so the action still validates, then `injectVars`
replaces the sentinel with `"${GFV_NAME}"`, closing and reopening single quotes where `shellQuote` put it inside
them. `server/src/services/recipes/export.run.test.ts` RUNS generated scripts in real bash, including with a hostile
value (`x'; touch PWNED; echo '`), to prove the value stays inert.

**Jobs** (`server/src/services/jobs/jobs.ts`, `shared/src/jobs.ts`, `routes/jobs.ts`). A job is the same steps run on
one or more servers: a _replay_ (a recipe) or a _broadcast_ (one action). Each target runs its steps **in order**,
targets run **in parallel**, and every step goes through `Runner.start` (so history, snapshots and the Safety Net
apply). Rules:

- **Plan, then confirm once.** `POST /api/jobs/plan` returns the exact commands per server (they differ: root vs
  sudo) and the highest risk. `POST /api/jobs` refuses a caution/danger plan unless `confirmed` (checked SERVER-side),
  refuses disconnected targets (naming them) and invalid steps, and runs nothing in those cases.
- **Pause on failure.** A failing step pauses only that target (`status: paused`) and waits for a decision
  (`POST /api/jobs/:id/targets/:serverId/decision`: `retry`, `skip`, `abort`); the other targets carry on.
  Nothing after the failed step has run. Cancel sends Ctrl-C to running steps and abandons paused targets.
- **Not recorded.** Job steps use `recordStep: false` (a new Runner option), so replaying while a recording is active
  does not add the replay to the recording. With secret parameters `record: false` as well: values could otherwise
  appear in history.
- **State.** `Job.snapshot()` is the whole state; the WebSocket `/api/jobs/:id/stream` sends output lines and a fresh
  snapshot after every change, replayed to late viewers (like runs). Live jobs are in memory; a finished job is saved
  to `jobs` (migration 0004) as a snapshot WITHOUT parameter values. A job that is still running when GFV restarts
  is lost (its steps already ran, and are in history).
- `JobService` takes a `JobRunner` (`preview/start/cancel`), so `jobs.test.ts` drives the state machine with a scripted
  fake runner (forced failures, retry, skip, abort, cancel, late subscribers) and `ssh/jobs.int.test.ts` does it for
  real on vps-a and vps-b.

UI: `apps/jobs/JobsApp.tsx` (progress per server, step list, output, the decision buttons), `PlanDialog.tsx` (pick
servers, parameter values or an action, preview the plan, confirm, start), `stores/jobStore.ts` (watches a job's
stream and toasts when a server needs a decision or the job ends), and in Recipes a **Parameters** tab, a per-step
parameter editor and **Run on…**.

### 16.4 Other export formats, sharing and cloning (M12)

**Formats** (`shared/src/recipes/formats.ts`, `exportAs(format, input)`; route `GET /api/recipes/:id/export?format=`
returns `{ files, notes }`, and for bash still `script`/`filename`). All of them start from the same steps and the same
sentinel mechanism as the bash export, so the "a value never becomes syntax" property carries over:

- **Dockerfile:** `FROM ubuntu:24.04`, parameters as `ARG GFV_NAME`, each command as `RUN` (sudo dropped: a build is
  root). Steps that only make sense on a running machine (`systemctl`, `ufw`, `docker`...) are left out and listed in
  `notes`. A secret parameter has no default and a warning (build args are stored in the image history).
- **Docker Compose:** `docker-compose.yml` (build args, required ones as `${VAR:?...}`) plus the Dockerfile.
- **Ansible:** real modules where there is a clean match (`files.mkdir/chmod/delete-path` to `ansible.builtin.file`,
  `service.*` to `ansible.builtin.systemd`); everything else is an `ansible.builtin.shell` task. Parameters reach shell
  tasks through `environment:` (`GFV_NAME: "{{ name }}"`), never pasted into the command text. Defaults are `vars:`,
  secret or required ones `vars_prompt:`. YAML is emitted by a tiny emitter that quotes every scalar with
  `JSON.stringify` (valid YAML).

**Recipe files** (`shared/src/recipes/share.ts`): `{ format: 1, name, description?, tags?, author?, params, steps }`,
no secret values. A file is UNTRUSTED input. `inspectRecipeFile` validates it from scratch (known actions, valid
params, no undeclared placeholders, only `recordable` actions without `secretParams`, the same rule recording uses)
and describes every step as it would run; `POST /api/recipes/import` repeats that on the server, so nothing the
browser claims is believed. The bundled starter library (`library.ts`, served by `GET /api/library`) is made of the
same files and goes through the same checks. There is no backend: a community library is "post the file in a Git
repository"; GFV never fetches anything by itself.

**Clone this server** (`POST /api/servers/:id/clone-recipe`): runs the quiet `devhub.detect` query and makes a recipe
of `devhub.install.<tool>` steps for what is installed (Ubuntu/Debian only). It reproduces tools, not files or
configuration.

---

## 17. The browser side

### 17.1 Entry and gating (`main.tsx`, `App.tsx`)

`App` decides what to show from the vault status:

```
vault unknown + request failed → "Can't reach the GFV server" (Retry)
vault unknown                  → "Loading…"
vault locked / not created     → UnlockScreen   (choose a master password, or unlock; shows 429 waiting)
vault unlocked                 → Desktop
```

It also toggles the `dark` class on `<html>` from the theme (Tailwind's `dark:` variant follows that class).

### 17.2 State: Zustand stores

Small global stores, no providers. The pattern is `create((set, get) => ({ ...state, ...actions }))` and
components read with a selector (`useServers((s) => s.servers)`).

| Store             | File                       | Holds                                                                                            |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| desktop / windows | `desktop/windowStore.ts`   | windows `{id, appId, title, x, y, w, h, z, minimized, maximized, serverId?, arg?}`, focus, theme |
| servers           | `stores/serverStore.ts`    | vault status, server list, connection statuses, active server, `live` link flag                  |
| learn             | `stores/learnStore.ts`     | journal entries, learned commands, panel open (localStorage)                                     |
| recording         | `stores/recordingStore.ts` | the active recording, `justStopped` (so Recipes opens the finished one)                          |
| run dialog        | `runner/runStore.ts`       | the current run request, active (hidden) runs                                                    |
| tour              | `tour/tourStore.ts`        | tour step; "seen" flag in localStorage                                                           |

### 17.3 The window manager (`web/src/desktop/`)

- `windowStore.ts`: the model. `open`, `close`, `focus` (bumps `z` and un-minimizes), `minimize`,
  `toggleMaximize` (remembers the old rectangle in a map so restore is trivial), `move`, `resize`, `setTitle`.
  **Persistence:** layout is saved to localStorage (`gfv.desktop.v1`) after 300 ms of quiet (dragging fires many
  updates) and is **flushed immediately on `pagehide`/tab hidden**, so a quick reload does not lose the layout.
  Everything read back is validated with Zod; all localStorage access is wrapped in try/catch (`lib/storage.ts`).
  `registerCloseGuard`/`tryClose` let an app (the Editor) veto closing its window.
- `Window.tsx`: a `react-rnd` box (draggable by the `.win-titlebar`, resizable, `bounds="parent"`). Maximized is a
  CSS-level override (`100%` × `100% − DOCK_SAFE`), so the stored rectangle is untouched. A window tied to a server
  gets that server's **colour as a ring and a name pill** (text colour from `readableOn`). The app component sits
  inside an `ErrorBoundary`, so one crashing app does not blank the desktop. Traffic lights, a glass title bar and
  the open/close/minimize/restore animations (Web Animations API, `windowAnim.ts`) are described in
  `docs/DESIGN_SYSTEM.md`. `closing` (transient) lets a window play its close animation before `close` removes it.
- `Desktop.tsx`: the wallpaper, `MenuBar`, the **workspace container** (under the menu bar, shrinks when the Learn
  panel is docked, so windows never hide under either; it is the drag boundary and what Mission Control lays out
  in), the windows, the `Dock`, the desktop right-click menu, the first-run card, the connection-lost banner, and
  mounts **once**: `RunDialogHost`, `Tour`, `Spotlight`, `ControlCenter`, `ToastHost`, `ConfirmHost`,
  `ChangePasswordDialog`. It also owns the global shortcuts (`hotkeys.ts`) and closes saved windows whose app no
  longer exists.
- `MenuBar.tsx` + `menuModel.ts` (pure) + `appMenus.ts`: the menus; apps contribute with `useAppMenus`.
  `Dock.tsx` + `dockMath.ts` (pure): the Dock. `Spotlight.tsx` + `spotlightModel.ts` (pure fuzzy search).
  `overviewLayout.ts` (pure): Mission Control. `commands.ts`: actions reachable from several places.
  `overlayStore.ts`: which overlay is open. `appearanceStore.ts` (in `stores/`): wallpaper and Reduce Transparency.
- `openApp.ts`: the one way to open an app: handles `singleton` apps and ties `serverBound` apps to the active
  server.
- **The registry** (`apps/registry.tsx`) is the single list of apps: `{ id, title, icon, component, defaultSize,
serverBound?, singleton?, hidden? }`. **Adding an app = adding one entry.** The shell never changes.

### 17.4 How an app is built

Every app is a component that receives `{ windowId }` and reads what it needs from the window store:

```tsx
export function FilesApp({ windowId }: { windowId: string }) {
  const serverId = useDesktop((s) => s.windows[windowId]?.serverId);
  if (!serverId) return <NoServer app="Files" />;
  ...
}
```

Common pieces: `NoServer` (empty state), `CommandsDisclosure` ("Commands this view runs", Learn Mode for polling
views), `LogPanel`, `PromptDialog` (type-a-value dialog), `RiskBadge`, `CommandLine` (a command + "Try it
yourself"), `ErrorBoundary`, the shadcn-style primitives in `components/ui/` (Button, Input, Label, Dialog on
Radix), and `usePolling`.

### 17.5 Talking to the server (`web/src/lib/`)

- `api.ts`: one `request(method, path, body)` wrapper (`fetch` with `credentials: 'same-origin'`) that throws
  `ApiError(status, body)` (with a readable `.detail`) and **Zod-parses responses**. `sendBytes()` is the raw-bytes
  variant for saves/uploads. Everything the UI can call is a method on the `api` object.
- `ws.ts`: the status socket; reconnects every 2 s, and reports `live` so the desktop can show a banner.
- Streams for runs and terminals are opened where used (`RunDialog`, `TerminalView`).

### 17.6 Styling

Tailwind CSS v4 with design tokens as CSS variables (`index.css`: `--background`, `--primary`, … mapped to
utilities like `bg-background`). `@custom-variant dark` makes `dark:` follow the `.dark` class. The first visit
follows the system theme. Class names are merged with `cn()` (`clsx` + `tailwind-merge`).

### 17.7 Learn, Tour, Recording UI

- `learn/LearnPanel.tsx`: a docked aside with the journal (from `GET /api/history`), the learned counter, and
  "Try it yourself". It refreshes whenever a run finishes.
- `tour/Tour.tsx`: a dependency-free coach-mark: finds the target by `[data-tour="…"]`, rings it with a huge box
  shadow, and positions a card next to it. The same `data-tour` attributes are what the Playwright specs use to
  find Dock icons.
- Recording: the menu-bar button calls `recordingStore`, which mirrors the server-side state.

---

## 18. The shared package

`@gfv/shared` is imported by server, web, tests and the package build. What lives there is chosen by one rule:
**if both sides must agree on it, or it is pure logic, it goes in `shared/`.**

| Kind                          | Examples                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shapes (Zod + inferred types) | server/connection/vault API (`schemas.ts`), runner messages (`runner.ts`), terminal messages (`terminal.ts`), file API (`files.ts`), recipes (`recipes/recipes.ts`) |
| The action catalogue          | `actions/*`                                                                                                                                                         |
| Pure logic                    | `previewAction`, `detectDanger`, `shellQuote`, snapshot command generation, recipe export, `commandNames`                                                           |
| Parsers                       | `metrics/sample.ts`, `metrics/lists.ts`, `devhub/detect.ts`                                                                                                         |
| Limits and constants          | `EDITOR_MAX_BYTES`, `UPLOAD_MAX_BYTES`, `NVM_SHA256`, `SAMPLE_COMMAND`                                                                                              |

Because it is consumed as source, the web app can import the same `previewAction` the server uses, for example the
"Commands this view runs" panel and the recipe step display call it in the browser.

---

## 19. Run modes and packaging

### 19.1 Development (`pnpm dev`)

`scripts/dev.mjs` starts two processes with the same random `GFV_TOKEN`:

```
vite (localhost:5173) ── /api (and WebSocket) proxy, adds x-gfv-token ──► tsx watch server/src/index.ts (127.0.0.1:4310)
```

Hot reload on both sides. Use `GFV_HOME=<temp dir> pnpm dev` to avoid touching your real `~/.gfv`.

### 19.2 Production from source (`pnpm start`)

Builds the web app, then runs `server/src/cli.ts` (via `tsx`), which serves `web/dist` itself and uses the cookie
flow. Options: `--port`, `--no-open`. If the default port 4310 is busy it tries the next 20.

### 19.3 The npm package (`pnpm build:package`)

`scripts/build-package.mjs`:

1. builds the web app;
2. **esbuild** bundles `server/src/cli.ts` (and the shared code) into `dist-pkg/dist/cli.js`, leaving runtime
   dependencies external (`fastify`, `ssh2`, `better-sqlite3`, `drizzle-orm`, `zod`, …);
3. copies `web/dist` → `dist-pkg/web` and `server/drizzle` → `dist-pkg/drizzle`;
4. writes `dist-pkg/package.json` with only the runtime dependencies, a `bin`, `engines >= 22`, and
   `license: UNLICENSED` as a placeholder.

`cd dist-pkg && pnpm pack` makes the tarball. Installing it pulls the dependencies (including the prebuilt
`better-sqlite3` binary), and the `gfv` command works. Nothing is published yet (the name and license are still
to be decided).

---

## 20. Testing strategy

Three layers, each answering a different question.

| Layer       | Files                          | Question                                                                                       | Needs                             |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| Unit        | `*.test.ts` next to the code   | is this pure logic right? (detector, quoting, parsers, export, crypto, throttle, window store) | nothing                           |
| Integration | `server/src/ssh/*.int.test.ts` | does it work against a real SSH server?                                                        | Docker test VPSes                 |
| End-to-end  | `e2e/*.spec.ts` (Playwright)   | does the whole product work in a browser?                                                      | Docker test VPSes + built web app |

**The Docker test VPSes** (`e2e/docker-compose.yml`, `e2e/Dockerfile`): two Ubuntu 24.04 containers with `sshd`,
user `gfv`, key `e2e/keys/id_test`, passwordless sudo, `vps-a` on port 2201 and `vps-b` on 2202. Host keys are
generated at container start, so recreating a container gives a _new_ host key (which is how the "host key
changed" flow is tested).

**Rules that came from real pain:**

- Integration tests `describe.skipIf(!reachable)`: if the containers are down they **silently skip**. When a run
  looks too fast, check the skipped count (`docker compose -f e2e/docker-compose.yml up -d`).
- Vitest runs test files in **parallel**; two files that both run `apt-get` on the same container collide on the
  apt lock. That is why the Dev Hub tests use `vps-b` and the rest use `vps-a`.
- `app.injectWS` can race (the server may reply before the test attaches listeners). Tests use a real `ws`
  client against `app.listen({ port: 0 })`, or assert on server-side state.
- The slow real-install tests (Node and PostgreSQL on a clean container) only run with `GFV_SLOW_TESTS=1`.
- `pnpm e2e` builds the web app, starts the app with `e2e/serve.ts` (production mode, port 4399, temp
  `GFV_HOME`), and runs the specs **in order on one worker**: spec 01 adds the server the rest use. The specs find
  desktop icons with `data-tour="app-<id>"` on the Dock icons (visible text did not match). `openApp` parks the pointer off the
  Dock first, because magnification moves icons. `GFV_E2E_SERVER_CMD` runs the same specs
  against a packed install.

Numbers at the time of writing: 54 test files, 480 passing tests (+3 opt-in), 46 Playwright specs (+ on-demand
capture specs). Contrast, accessible names, focus and reduced motion are measured by `e2e/10-accessibility.spec.ts`.

---

## 21. End-to-end walkthroughs

### 21.1 "I press Connect on a new server" → see 8.3 (trust sequence)

### 21.2 "I click New folder in Files"

```
FilesApp           PromptDialog asks for the name → requestRun({ actionId:'files.mkdir', params:{path}, onDone })
RunDialog          POST /api/runs/preview → server: previewAction → { commands:['mkdir -p -- /tmp/x'], risk:'safe', ... }
                   shows "What this does" + the command; you press Run
RunDialog          POST /api/runs → Runner.start (risk safe: no confirmation needed) → { runId }
RunDialog          WebSocket /api/runs/:id/stream → replay + live: step, output, done{exitCode:0}
Runner.execute     pool.getClient → exec "mkdir -p -- /tmp/x" on its own channel → exit 0
Runner             history row inserted; onSuccess → RecipeService.recordRun (if recording)
RunDialog          shows "Finished successfully"; calls onDone → FilesApp reloads the listing
LearnPanel         refreshed: the journal shows the command and "You've learned … mkdir"
```

### 21.3 "I install Git from the Dev Hub"

```
DevHubApp  Install → requestRun('devhub.install.git')
preview    commands: [DISTRO_GUARD, sudo -n env … apt-get … update, … install git, git --version]
           risk 'caution' (Runner requires confirmed:true; the dialog needs the checkbox)
run        longRunning → each step in a PTY; dialog shows Hide / Cancel / elapsed time
Hide       dialog closes; the run continues; the card says "Installing… View output"; watchRun notices the end
Cancel     POST /api/runs/:id/cancel → Ctrl-C into the PTY → apt stops → done{cancelled:'user'}
```

### 21.4 "I edit /etc/something in the Editor"

```
Ctrl+S → PUT /fs/file (as your user) → SFTP open fails → 403 permission_denied (the early backup is discarded)
Editor shows "Save with sudo…" → upload text to /tmp/gfv-save-<hex> → requestRun('files.write-root', {path, tmp})
preview: [mkdir snapshots dir, sudo cat FILE > backup, sudo cp tmp FILE, rm tmp]   ← the backup is part of what you confirm
run → backup recorded in `snapshots` → Snapshots app shows it; Restore re-runs files.restore-snapshot (backing up again)
```

### 21.5 "I record a recipe"

```
⏺ Record → POST /api/recording/start {serverId}            (row in `recording`)
… you run actions …  each success → Runner.onSuccess → RecipeService.recordRun → recipe_steps row
■ Stop → POST /api/recording/stop → Recipes app opens the new recipe
Script tab → GET /api/recipes/:id/export → exportRecipe(...) → bash text you can copy or download
```

---

## 22. How to add a feature

**Example: a "Firewall status" view.** The same recipe applies to almost everything.

1. **Decide the kind of operation.**
   - Read-only and polled → a **quiet** action (`quiet: true`, `risk: 'safe'`).
   - Changes something → a normal action with a `risk`, `riskReason`, and `recordable`.
   - Takes minutes → add `longRunning: true`.
2. **Write the action** in `shared/src/actions/<area>.ts` with `defineAction`. Validate every parameter with Zod,
   and pass every value through `shellQuote`. Use `${ctx.sudo}` for anything needing root. Add it to the area's
   exported array, which `actions/index.ts` spreads into `ACTIONS`.
3. **Add a parser** if you need to read output: a pure function in `shared/src/` with a unit test on a fixture
   string.
4. **Test the action** in `shared/`: command text, quoting, risk, invalid params. Look at
   `shared/src/actions/m6.test.ts` for the style.
5. **Build the app** in `web/src/apps/<name>/`: a component taking `{ windowId }`; use `api.query` + `usePolling`
   for reads and `requestRun` for changes (with `onDone` to refresh). Reuse `NoServer`, `CommandsDisclosure`,
   `RiskBadge`.
6. **Register it** with one entry in `web/src/apps/registry.tsx` (`serverBound: true` for server apps).
7. **If it needs a new backend route** (rare: the Runner covers most things), add a module in `server/src/routes/`,
   take what you need from `AppContext`, guard it for the locked vault, and register it in `app.ts`.
8. **If it needs a new table**, edit `server/src/db/schema.ts` and run `pnpm --filter @gfv/server db:generate`.
9. **Integration/e2e test** against the Docker servers if it touches SSH.
10. **Update `README.md`** (user-facing), **`CLAUDE.md`** (status/gotchas) and, if scope changed, **`PLAN.md`**.

Checks before you call it done: `pnpm typecheck && pnpm lint && pnpm test`, then drive it in a real browser.

---

## 23. Odd-looking decisions that are on purpose

| What you will see                                                                     | Why                                                                                                  |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Imports end in `.js` in `.ts` files                                                   | ESM resolution in Node                                                                               |
| `tokens[i]!`                                                                          | `noUncheckedIndexedAccess` is on; the `!` follows a bounds check                                     |
| `app.addHook` guards check `req.url.startsWith(...)`                                  | Fastify hooks are app-wide unless encapsulated; each module guards its own prefix                    |
| Route handlers return `reply.code(…).send(…)` for errors but plain values for success | Fastify serialises returned values as JSON                                                           |
| Output buffering in `Run`                                                             | the browser's WebSocket connects after the run starts                                                |
| One exec channel per command                                                          | per-step exit codes and output blocks                                                                |
| PTY only for `longRunning`                                                            | Cancel needs Ctrl-C to reach child processes, but a PTY merges stderr and rewrites newlines          |
| `mv -nT` for rename                                                                   | `-n` never overwrites; `-T` stops "move _into_ the folder" when the target is an existing folder     |
| `cat file > backup` instead of `cp -p`                                                | the copy must be owned by you to be readable for diffs                                               |
| Backup commands are visible in the preview                                            | Learn Mode must show everything GFV does                                                             |
| Recipes store params, not commands                                                    | regenerate scripts as the catalogue improves                                                         |
| `exportCommands` on some actions                                                      | scripts must be safe to run twice                                                                    |
| `SQL` raw subquery in `RecipeService.list`                                            | Drizzle drops table qualifiers there and `id` bound to the wrong table (a real bug, found by a test) |
| `vaultStore.save` is an upsert                                                        | changing the master password saves the single row again                                              |
| `process.umask(0o077)` and `chmod 600`                                                | the database holds encrypted credentials; keep it private                                            |
| `terminal` input is never logged                                                      | it may contain passwords                                                                             |
| Monaco bundled locally, no CDN                                                        | works offline, no third-party requests                                                               |
| `data-tour="app-<id>"` on icons                                                       | the tour and the Playwright specs both need stable handles                                           |
| Integration tests skip silently without Docker                                        | they must not break `pnpm test` for people without Docker (check the skipped count)                  |
| `license: UNLICENSED` in the package                                                  | a placeholder until you choose                                                                       |
| Shims for `systemctl`/`docker` in the test image                                      | the containers have no systemd or Docker daemon                                                      |

---

## 24. Glossary

- **Action**: a data description of one operation (id, explanation, commands, risk). The unit of Learn Mode,
  Safety Net and Recipes.
- **Command Runner**: the server component that validates, previews, confirms, runs, records actions.
- **Quiet query**: a read-only action run without a dialog or history entry, for polling views.
- **PTY**: a pseudo-terminal. The interactive terminal uses one; long installs use one so Ctrl-C works.
- **SFTP**: file transfer over the SSH connection. Used for file bytes.
- **TOFU**: trust on first use. You approve a server's host key the first time; changes are never silently accepted.
- **Host key fingerprint**: a short hash that identifies a server's SSH identity.
- **Vault**: the encrypted credential store, unlocked by the master password.
- **scrypt / AES-GCM**: the slow key-derivation function and the authenticated encryption cipher the vault uses.
- **Canary**: a known string encrypted at vault creation, used to check a master password.
- **Snapshot**: a backup copy of a file made on the server before GFV overwrites it.
- **Recipe**: a recorded list of actions that can be exported as a bash script.
- **Shim**: a tiny fake `systemctl`/`docker` script in the test containers.
- **Composition root**: the place (`start.ts`) where all objects are created and connected.
- **Discriminated union**: a TypeScript type whose `status`/`type` field says which shape you have.
- **Zod**: the schema library used for validation and for deriving TypeScript types.
