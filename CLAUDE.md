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
  - `execOnce` (`server/src/ssh/exec.ts`) is the only ad-hoc SSH exec, used for "Test connection" until the Command Runner exists in M4.
- **M3 (Terminal) is done.**
  - Protocol (`shared/src/terminal.ts`): one WebSocket per tab at `/api/terminal/:serverId?cols=&rows=`. BINARY frames = raw terminal bytes, TEXT frames = JSON control messages (resize, danger_decision / ready, exit, error, danger). Each tab is its own SSH shell channel on the pooled connection.
  - Server: `server/src/routes/terminal.ts`. Attaches the socket listeners immediately and queues input until the shell is ready (otherwise early keystrokes are lost). Backpressure pauses the SSH stream when the browser lags. Never log terminal input or output.
  - Safety Net: `shared/src/danger.ts` (`detectDanger`, reused by the Command Runner in M4). `server/src/terminal/lineTracker.ts` rebuilds the typed line from keystrokes and holds Enter on a dangerous one until "Run anyway"/"Cancel"; `altScreen.ts` pauses checks inside vim/htop. Best effort only (Tab completion/history can bypass it).
  - Web: `web/src/apps/terminal/` (xterm.js + fit addon, tabs stay mounted while hidden, danger bar, "Session ended" / "Reconnect" overlay, Ctrl+Shift+C copies). Reloading the browser ends the shells (no session reattach in v1).
  - Not done yet: a `terminalBus` so Learn Mode can type a command into a terminal without running it (add it in M4 when "Try it yourself" needs it).
- **Next step: M4 (Command Runner + Learn panel + danger detector wiring + history).** See PLAN.md §6. Work milestone by milestone, in order.
- Update this Status section when a milestone is finished.

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
