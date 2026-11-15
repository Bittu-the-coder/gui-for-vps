# Contributing to GFV

Thank you for thinking about helping. GFV is a one-person project that I would like to turn into something a
community can grow, so I have tried to make it easy to get started and easy to know what a good contribution looks
like. You do not need to be an expert. Fixing a typo, reproducing a bug, or telling me that something on your
distribution did not work are all real contributions.

## Ways to help

The most useful thing you can do right now is use GFV on a server and tell me what happened. I tested a lot against
Docker containers, but real servers are messier. Good bug reports include what you did, what you expected, what
happened instead, the distribution and version of the server, and any error text. Please remove passwords, keys and
hostnames you do not want public.

If you want to write code, the [roadmap](docs/ROADMAP.md) lists things I would like to build and marks the ones that
are a good first step. If you have an idea that is not on the list, open an issue and tell me about it before you
spend a weekend on it, so we can agree on the shape together. That is the best way to avoid a pull request I have to
turn down.

Documentation fixes are always welcome. If a guide told you something untrue, or skipped a step, fix it.

## Setting up

You need Node.js 22 or newer and pnpm 12. Please use pnpm and not npm, because the lockfile and the workspace
settings are pnpm's.

```bash
git clone https://github.com/Bittu-the-coder/gui-for-vps.git
cd gui-for-vps
pnpm install
pnpm dev
```

`pnpm dev` starts the server on 127.0.0.1:4310 and the web app on localhost:5173 with a shared random token. Use a
temporary data folder while you experiment so you never touch your real data: `GFV_HOME=/tmp/gfv-dev pnpm dev`.

If `pnpm install` refuses to run a build script, run `pnpm approve-builds --all` once. The packages that need it are
recorded in `pnpm-workspace.yaml`.

## Running the checks

Before you open a pull request, these three should pass:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

The unit tests need nothing else. The integration tests and the browser tests use throwaway Docker servers, and they
skip themselves when those are not running, so a quick run does not always mean everything ran. If your change
touches anything that talks to a server, start the test servers and run them for real. The commands are in the
[user guide](docs/USER_GUIDE.md#try-it-without-a-server), and the browser tests run with `pnpm e2e`.

Some tests install real packages inside the containers and can take several minutes on a slow connection.

## How the code is organised

The one rule that shapes everything is this: every action that changes or queries a server goes through the Command
Runner, using an Action defined in `shared/src/actions/`. An action has an id, a title, a plain-English explanation,
the commands it runs, a risk level, and whether it can be recorded into a recipe. Learn Mode, the confirmation
dialogs, the history, the snapshots and the recipes all depend on that single description, which is why I do not
accept routes that run ad-hoc SSH commands. The only exceptions are the interactive terminal, SFTP for moving bytes,
the database tunnel and the assistant gateway, each of which is explained in the architecture notes.

Other rules I hold to:

- Parameters never get string-concatenated into shell commands. They are validated with Zod and quoted with
  `shellQuote`. A pull request that builds a command from user input without that will be sent back.
- Secrets never appear in command lines, history, logs or error messages.
- Anything that could lock a user out of their own server should use the guard mechanism in `shared/src/guard.ts`.
- New routes in hosted mode are closed to members by default. If a member should reach a route, add it to the table
  in `server/src/hosted.ts`, and the test that walks every registered route will tell you if you missed one.
- Colours, shadows and timings come from the design tokens in `web/src/styles/tokens.css`, not from hard-coded
  values. Icons come from lucide. [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) explains the rest.

For a guided tour of the code, read [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md). It has a section called "How to add a
feature" that walks through a complete example.

## Tests I expect

If you add an action, add a unit test for its commands and for what happens with hostile input. If you add a parser,
test it with real output. If you add something that touches a server, add an integration test against a container, and
if it has a user interface, a browser test. A test that checks something real, like asking the container whether the
firewall rule exists, is worth more to me than one that checks a mock.

Please do not mark a test as skipped to make a run pass. If it is flaky, tell me and we will fix the cause.

## Pull requests

Keep them focused. One change per pull request is much easier to review than five. Describe what you changed and why,
and say how you tested it, including what you could not test. If your change alters what the program does, update
the guide or the architecture notes in the same pull request.

I will try to answer within a few days. I may ask for changes, and I may sometimes say no, usually because a change
does not fit the direction of the project. I will always explain why.

## Code style

Prettier formats the code and ESLint checks it, so run `pnpm format` and `pnpm lint`. TypeScript is strict
everywhere. Prefer small, focused modules, and comment the why rather than the what.

## Conduct

Be kind and assume good faith. The [code of conduct](CODE_OF_CONDUCT.md) says what that means in practice.
