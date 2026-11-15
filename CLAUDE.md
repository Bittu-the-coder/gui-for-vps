# Working on GFV with an AI assistant

This file is read by Claude Code at the start of a session. It is also a quick summary of the rules for human
contributors. The full version is in [CONTRIBUTING.md](CONTRIBUTING.md).

GFV is a browser desktop for managing real servers over SSH. Read [README.md](README.md) for what it is,
[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for how it is wired, [docs/MILESTONES.md](docs/MILESTONES.md) for why things
are the way they are, and [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) before touching anything in `web/`.

## Commands

- Use pnpm, never npm. `pnpm install`, `pnpm dev`, `pnpm start`.
- Before saying a change is done: `pnpm typecheck && pnpm lint && pnpm test`. For anything that touches a server or the
  interface, also run the integration tests and `pnpm e2e` against the Docker test servers (see
  [docs/USER_GUIDE.md](docs/USER_GUIDE.md#try-it-without-a-server)). They skip themselves when the containers are not
  running, so check the skipped count.
- Use a temporary data folder (`GFV_HOME=/tmp/gfv-dev`) and never touch a real `~/.gfv` while testing.
- Do not commit or push unless the person you are working with asks you to.

## Rules that matter

1. Everything that changes or queries a server goes through the Command Runner using an Action defined in
   `shared/src/actions/`. Do not run ad-hoc SSH commands from routes. The documented exceptions are the terminal (PTY),
   SFTP, the database tunnel and the assistant gateway.
2. Parameters never get concatenated into shell commands. Validate with Zod and quote with `shellQuote`.
3. Secrets never appear in command lines, history, logs, error messages or audit entries.
4. Anything that could cut GFV's own access to a server must use the guard in `shared/src/guard.ts`.
5. In hosted mode a route is closed to members unless it is listed in `server/src/hosted.ts`.
6. Design tokens only in `web/` (no hard-coded colours), icons from lucide, no emoji in the interface.
7. Test against something real when you can, and be honest in your summary about what you could not test.

## Gotchas that cost time

- pnpm 12 blocks install scripts until you run `pnpm approve-builds --all`, and it enforces a minimum release age for
  new package versions.
- Do not `pkill -f` a pattern that also appears in your own command line. It kills your own shell. Kill by port or pid.
- The Docker test servers stop when the machine restarts. Start them again, otherwise integration tests skip silently.
- Integration test files that share a container use `exclusive()` from `server/src/testUtil.ts`, because they break
  each other when they run in parallel.
- A test helper that runs `docker exec` must not go through the host shell, or `$VARIABLES` get expanded before the
  container sees them.
- The Playwright specs run in order and share one server, which the first spec adds.
