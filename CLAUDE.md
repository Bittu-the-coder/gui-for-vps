# GFV — GUI for VPS

A browser-based desktop (Puter-style) for managing real VPS servers over SSH. It **teaches** (Learn Mode), **protects** (Safety Net), and **clones setups** (Recipes).

**Read `PLAN.md` first.** It is the source of truth for features, architecture, milestones, and v2 scope. If a decision changes, update `PLAN.md` in the same change.

## Status

- **M0 (repo setup) is done.** Workspaces, strict TS, ESLint/Prettier, Vitest, Fastify `/api/health` with token auth, Vite + React + Tailwind page, and two Ubuntu 24.04 test VPSes.
- **M1 (Desktop shell) is done.** Zustand window store (`web/src/desktop/windowStore.ts`), app registry (`web/src/apps/registry.tsx`, add real apps there), react-rnd windows, taskbar, start menu, right-click menu, light/dark theme, layout persisted to localStorage. No shadcn/ui yet (add in M2).
- **M2 (Server Manager) is done.**
  - Crypto: `server/src/crypto/vault.ts` (scrypt + AES-256-GCM, canary check). The unlocked key lives only in server memory, so a browser reload does NOT lock; a server restart or the 🔒 button does.
  - DB: `server/src/db/` (better-sqlite3 + Drizzle, migrations in `server/drizzle/`, data in `~/.gfv`, override with `GFV_HOME`).
  - SSH: `server/src/ssh/` (pool with reconnect, TOFU host keys: unknown/changed keys abort the handshake and need an explicit trust call; a changed key also needs `replace: true`). `/api/ws` pushes connection statuses (Origin-checked).
  - Web: unlock screen, Servers app (`web/src/apps/servers/`), taskbar server switcher, windows tied to a server (coloured border + badge via `serverBound` in the app registry). shadcn-style components in `web/src/components/ui/` (hand-written: button, input, label, dialog).
- **M3 (Terminal) is done.**
  - Protocol (`shared/src/terminal.ts`): one WebSocket per tab at `/api/terminal/:serverId?cols=&rows=`. BINARY frames = raw terminal bytes, TEXT frames = JSON control messages (resize, danger_decision / ready, exit, error, danger). Each tab is its own SSH shell channel on the pooled connection.
  - Server: `server/src/routes/terminal.ts`. Attaches the socket listeners immediately and queues input until the shell is ready (otherwise early keystrokes are lost). Backpressure pauses the SSH stream when the browser lags. Never log terminal input or output.
  - Safety Net: `shared/src/danger.ts` (`detectDanger`, reused by the Command Runner in M4). `server/src/terminal/lineTracker.ts` rebuilds the typed line from keystrokes and holds Enter on a dangerous one until "Run anyway"/"Cancel"; `altScreen.ts` pauses checks inside vim/htop. Best effort only (Tab completion/history can bypass it).
  - Web: `web/src/apps/terminal/` (xterm.js + fit addon, tabs stay mounted while hidden, danger bar, "Session ended" / "Reconnect" overlay, Ctrl+Shift+C copies). Reloading the browser ends the shells (no session reattach in v1).
  - Not done yet: a `terminalBus` so Learn Mode can type a command into a terminal without running it (add it in M4 when "Try it yourself" needs it).
- **M4 (Command Runner + Learn panel) is done.**
  - Actions: `shared/src/actions/` (`defineAction`, `previewAction` = validate params + build commands + risk raised by `detectDanger`, never lowered; `redactParams/redactSecrets`), `shared/src/shell.ts` (`shellQuote`, the only way a param enters a command). Sample actions in `actions/samples.ts` (`connection.test`, `system.uptime`, `system.clear-apt-cache`, `files.delete-path`); real catalogs come in M5-M7.
  - Runner: `server/src/services/runner/` (`Runner.start` checks `confirmed` SERVER-side for caution/danger, runs commands in order on separate exec channels, stops at the first non-zero exit; `Run` buffers messages so a late WebSocket gets a replay). Routes in `server/src/routes/runs.ts`: `GET /api/actions`, `POST /api/runs/preview`, `POST /api/runs`, WS `/api/runs/:id/stream`, `GET /api/history`. Protocol types in `shared/src/runner.ts`. `execOnce` is gone: "Test connection" runs `connection.test` through the runner with `record: false`.
  - History: `history` table (migration 0001). Params and output are redacted; output tail is 8 KB. `GET /api/history` also returns `learned` (distinct command names, via `shared/src/learn.ts`).
  - Web: `RunDialog` (preview, risk checkbox, streamed output, mounted once in Desktop, opened with `requestRun()`), `LearnPanel` (right dock, taskbar toggle, on by default, workspace narrows), `terminalBus` ("Try it yourself" pastes into a terminal without running; opens one if needed), temporary Actions app. Dummy apps removed.
  - Not done: snapshots (`snapshotPaths` is declared but ignored until M5/M8), run cancellation and per-run timeout (planned for M7), no web unit tests for the new UI (verified by headless browser).
- **M5 (File Manager + Editor) is done.**
  - SFTP is the second sanctioned exception to "everything through the Command Runner" (after the PTY), because moving bytes has no command to show and a shell pipe would corrupt binary files. `server/src/services/sftp/` (`SftpService`: list, readText, createReadStream, write with optional snapshot) + `server/src/routes/files.ts` (`/api/servers/:id/fs/{list,read,download}` and `PUT /fs/file` with a raw `application/octet-stream` body, `?create=1` = refuse to overwrite). No multipart dependency. Paths must be absolute (`normalizePath`); `~` only for `list`.
  - Operations that ARE commands still use the runner: `files.mkdir`, `files.rename` (`mv -n`), `files.chmod` (caution), `files.delete-path`. These are `internal: true` (hidden from the temporary Actions app). `requestRun` takes an `onDone` callback so apps refresh afterwards.
  - Snapshots: saving over an existing file under `/etc` (prefix list in `SftpOptions`) first copies the old version to `~/.gfv/snapshots/` on the server and records it in the `snapshots` table (migration 0002). If the copy fails, the save is aborted. Timeline/restore UI is M8. Saves write in place (keeps owner, mode, symlinks) and run as the SSH user: `/etc` files usually need root, so the Editor shows "permission denied" (no sudo-save yet).
  - Web: `web/src/apps/files/` (listing, path bar, hidden toggle, sort, new folder, rename, chmod, delete, download, upload by button or drag-and-drop), `web/src/apps/editor/` (Monaco loaded lazily from the local bundle: editor core + basic highlighters only, one worker; Ctrl+S; critical-config confirm for sshd_config/sudoers/fstab; unsaved dot in the title; `registerCloseGuard`/`tryClose` in `windowStore.ts` ask before discarding). Windows have an optional `arg` (the Editor's file path); registry apps can be `hidden` (Editor).
  - Not done: sudo-save for root-owned files; uploading folders; multi-select; the Editor's permission-denied and close-guard paths, and rename/chmod/delete/download/drag-drop in the UI, were not driven in a browser (only: create folder, upload, edit, Ctrl+S). Rename/chmod/delete are covered by the API integration test.
- **M6 (System Monitor, Services, Docker) is done.**
  - **Quiet queries:** actions marked `quiet: true` (always `safe`, `internal`) are read-only polling reads (metrics, lists, logs). They run through `Runner.query` / `POST /api/runs/query` (no dialog, not saved to history, 10 s timeout, 1 MB cap, returns `{exitCode, stdout, stderr}` as data). Anything that changes a server still uses the preview + confirm flow. Each polling app has a "Commands this view runs" disclosure (`CommandsDisclosure`) so Learn Mode still teaches.
  - **`ctx.sudo`:** `commands(params, ctx)` gets `{sudo: '' | 'sudo -n '}`; the runner detects root once per connection (`id -u`, cached per ssh Client). `previewAction(id, params, ctx)`, and `runner.preview/start` are now async because of this.
  - **`dynamicRisk(params)`** on an Action raises risk by params (killing sshd/pid 1, stopping ssh.service...). Force kill is its own `danger` action (`process.force-kill`).
  - Shared: `shared/src/metrics/{sample,lists}.ts` (pure parsers + `cpuPercent`/`netRate`, unit-tested on fixtures), `shared/src/actions/{monitor,services,docker}.ts`.
  - Web: `apps/monitor` (uPlot charts, 2 s polling, 2-minute window, disks, process table with search/sort/Stop/Kill), `apps/services` (list, filter, start/stop/restart/enable/disable, logs), `apps/docker` (containers/images, start/stop/restart/rm/rmi, logs, "not installed" state). `usePolling` pauses while the window is minimized or the tab is hidden. Logs are refreshed (button or 3 s toggle), NOT live-streamed.
  - **Test VPSes have no systemd or Docker:** `e2e/shims/{systemctl,journalctl,docker}` (copied into the image) print canned output, so those pipelines are tested but real systemd/Docker behaviour is NOT. Verify manually on a real VPS before release (PLAN §8). Rebuild with `docker compose -f e2e/docker-compose.yml up -d --build`.
  - Not done: live log streaming and run cancellation (planned for M7 with long installs), per-process details, kill by process tree, container exec/create, Docker volumes/networks.
- **Next step: M7 (Dev Hub: Node, Python, Docker, PostgreSQL, nginx, Git on Ubuntu).** See PLAN.md §6.
- Update this Status section when a milestone is finished.

## Handoff notes (read before starting M4)

**How we work (the user's rules)**

- **pnpm only** (never npm). The user commits and pushes themselves: never run `git commit`/`git push`; when a step is done, give them the commands. M0–M3 may still be uncommitted, so run `git status` first.
- For each milestone: write a short plan, get a "go", then build. Offer a recommendation on every open choice. A bare "go" means "go with your recommendations" (state which ones you used).
- Verify before saying "done": `pnpm typecheck && pnpm lint && pnpm test`, then drive the real UI in a headless browser (the `browser-automation` skill) against the Docker test VPS and look at a screenshot. Several real bugs were found only this way (lost keystrokes before shell ready, layout not saved on quick reload).

**Gotchas that cost time**

- **pnpm 12:** install scripts are blocked until approved (`pnpm approve-builds --all`, recorded as `allowBuilds` in `pnpm-workspace.yaml`; already done for esbuild, better-sqlite3, ssh2, cpu-features). A minimum-release-age policy rejects package versions published in the last day: use `pnpm clean --lockfile && pnpm install` instead of weakening it. Every import must be declared in the package that uses it (strict, no hoisting).
- **Dev servers:** `pnpm dev` leaves stray `vite`/`tsx` processes if killed carelessly, and a stale one on port 4310/5173 serves an old token (symptom: `/api/health` 401 through the proxy). Kill by port: `kill $(ss -ltnp | grep ':5173 ' | grep -oP 'pid=\K[0-9]+')`. Do NOT `pkill -f "<pattern>"` with a pattern that also appears in your own command line: it kills your own shell.
- **Never touch the real `~/.gfv` while testing.** Use `GFV_HOME=<temp dir> pnpm dev` (or for the server alone `GFV_HOME=… GFV_TOKEN=t GFV_PORT=4399 pnpm exec tsx server/src/index.ts`).
- **Test VPSes:** `docker compose -f e2e/docker-compose.yml up -d --build` (Ubuntu 24.04 + htop, user `gfv`, key `e2e/keys/id_test`). Host keys are generated at container start, so `--force-recreate` gives a NEW host key (this is how the "host key changed" flow is tested). Integration tests (`server/src/ssh/*.int.test.ts`) skip themselves when port 2201 is closed.
- **`app.injectWS` races:** the server may send/close before the test attaches listeners. Assert on server-side state, or use a real `ws` client against `app.listen({port: 0})`.
- **Dev auth:** `scripts/dev.mjs` makes one random `GFV_TOKEN`; the Vite proxy injects it as `x-gfv-token` (including for WebSockets), so the browser never sees it. Production (`npx gfv`) must instead open `/?token=…` and set a cookie: NOT built yet.
- **Browser-test scripts** (Playwright-style `--script` files) lived in the session scratchpad and are gone. Recreate as needed; the M2 and M3 flows they covered are described above. Turning them into real Playwright specs in `e2e/` is an M9 task.
- Bash in xterm's DOM renderer shows trailing spaces as non-breaking spaces; bash with bracketed paste prints `\x1b[?2004l\r` after Enter, so command output follows `\r`, not `\r\n`.

**Known gaps / backlog (not forgotten)**

- No unlock-attempt throttling (scrypt makes guesses ~100ms each; add in M9). DB file is mode 644 inside a 700 dir; could chmod 600. No "change master password".
- Production token/cookie flow and `npx gfv` packaging (M9). Favicon 404. App shows "Loading…" forever if the server is down. Light theme was not visually checked.
- `shared/src/schemas.ts` `ConnectResultSchema` is hand-synced with `server/src/ssh/pool.ts` `PublicOutcome` (no compile-time link).
- Dummy apps Notes/Clock/Hello in `web/src/apps/dummy.tsx` (Hello is `serverBound` only to demo the window↔server tie): remove once real apps exist.
- Web has no automated tests beyond the window store; the UI is verified by headless-browser scripts.
- Terminal: shells end on browser reload; no `terminalBus` yet (Learn Mode "Try it yourself" needs it, see M4).

**M4 (Command Runner) — decisions to settle with the user BEFORE coding**

1. `Action` shape in `shared/src/actions/` (id, title, explain, commands(params), risk, riskReason?, snapshotPaths?, recordable) with a Zod params schema per action, and a shell-quoting helper (`shellQuote`) so params are never string-concatenated. Run risk through the existing `detectDanger` too.
2. Run flow: UI `runAction(serverId, actionId, params)` → server returns a **preview** (explanation, exact commands, risk) → confirm for caution/danger → stream output over a WebSocket (reuse the `/api/ws` or a new `/api/runs/:id` socket) → exit code. Define the WS message types in `shared/` like `terminal.ts`.
3. `history` table (Drizzle): serverId, actionId, params (redact secrets), commands, risk, exit code, started/finished, output tail. Never store secrets or terminal input.
4. Learn panel: how it docks into the desktop (taskbar toggle, on by default), "Try it yourself" (needs a `terminalBus` to type a command into a Terminal without running it), command journal + "learned N commands" counter.
5. Sample actions to prove it works: one `safe` (e.g. `system.uptime`), one `caution`, one `danger`. Replace `execOnce`'s "Test connection" with a runner action. All real Dev Hub/Services/etc. actions come in later milestones.

## About the user

- Full-stack dev: MERN/PERN, a little Spring Boot. **Not comfortable with Go or Rust**, so keep everything TypeScript.
- Audience priority: beginners and a portfolio/learning project first, experienced devs later.
- Likes to **discuss and agree on a plan before code is written**. For anything non-trivial (new milestone, new dependency, architecture change), explain the approach briefly and confirm before building.
- Wants honest opinions, not sugarcoating.
- Explain _how_ things are built as you go. This is also a learning project.

## Key decisions (don't re-litigate without the user)

- **Browser app, local mode first.** Node server binds to `127.0.0.1`, and `npx gfv` opens the browser. Hosted mode (deploying GFV on a VPS) is **v2**.
- **No Puter fork** (AGPL, jQuery, cloud-storage backend). Build our own shell with `react-rnd`, using daedalOS only as a design reference.
- **No Rust/GPUI.** A Tauri wrapper may come in v2.
- Stack: pnpm workspaces (`shared/`, `server/`, `web/`), Node 22 + Fastify + `@fastify/websocket`, `ssh2`, SQLite (`better-sqlite3` + Drizzle), Zod, React 19 + Vite, Zustand, Tailwind + shadcn/ui, xterm.js, Monaco, uPlot. Tests use Vitest + Playwright, with Docker `sshd` containers as test VPSes.
- Target Ubuntu/Debian servers first.
- The name "GFV" is a working name and may change before release.

## Core architecture rule: the Command Runner

**Every GUI action that changes or queries a server must go through the Command Runner** (`server/src/services/runner`), using an `Action` defined in `shared/src/actions/`. Each Action has:
`id, title, explain, commands(params), risk ("safe"|"caution"|"danger"), riskReason?, snapshotPaths?, recordable`.

Learn Mode (show the explanation and commands), Safety Net (risk confirmation and snapshots), history, and Recipes all depend on this. Do not run ad-hoc SSH commands from routes. Add an Action instead. The only exception is the raw interactive Terminal (PTY), and its input is still checked by the danger-pattern detector (it holds Enter until the user confirms, but never hard-blocks).

## Security rules (apply even in local mode)

- Bind to `127.0.0.1` only. Require a random session token on every HTTP and WS request, and check the WS `Origin`.
- Encrypt SSH credentials at rest (AES-256-GCM, key from master password via scrypt). Never store the master password, and never log secrets.
- Verify host keys (TOFU). Never auto-accept a changed key.
- Never build shell commands by string-concatenating user input. Validate params with Zod and use a shell-quoting helper.

## Conventions

- TypeScript strict mode everywhere. Shared types and schemas live in `shared/`.
- Small focused modules. Each desktop app lives in `web/src/apps/<name>/`.
- Wrap `localStorage` access in try/catch.
- Write tests alongside features: unit tests for parsers, danger detector, crypto, and recipe export, plus integration tests against the test `sshd` container.
- Commit after each working milestone step, but only when the user asks.

## Useful commands

- `pnpm dev`: start server (`127.0.0.1:4310`) + web (`localhost:5173`) with a shared random token (`scripts/dev.mjs`)
- `pnpm test`: unit tests (Vitest)
- `pnpm typecheck` / `pnpm lint` / `pnpm format`
- `pnpm e2e`: Playwright against the Docker test servers (no specs yet)
- `docker compose -f e2e/docker-compose.yml up -d`: start test VPSes `vps-a` (port 2201) and `vps-b` (port 2202), user `gfv`, key `e2e/keys/id_test` (gitignored; create with `ssh-keygen -t ed25519 -N "" -f e2e/keys/id_test`)
