# GFV: a desktop in your browser for your VPS

GFV (a working name) gives you a desktop in the browser that is connected to your **real servers over SSH**:
windows, a menu bar and a Dock, a terminal, a file manager, an editor, a system monitor, services, Docker and one-click
installs for the usual dev tools.

![GFV demo](docs/demo.gif)

What makes it different from other server panels:

- **It teaches you (Learn Mode).** Every action shows the real command and a plain-English explanation of
  what it does, line by line. A journal keeps every command GFV ran for you, and "Try it yourself" types a
  command into a terminal without running it.
- **It protects you (Safety Net).** Risky actions (and risky commands you type in the terminal) are held until
  you confirm, with the reason. Before GFV overwrites a config file it backs the old version up on the
  server, and the Snapshots app shows a diff and restores it with one click. A restore can itself be undone.
- **It clones your setup (Recipes).** Press Record, do things in GFV, press Stop, and export what you did as
  a bash script with a comment explaining every step.

| Run an action: preview, real commands, risk | Monitor                      | Recipe export              |
| ------------------------------------------- | ---------------------------- | -------------------------- |
| ![Preview](docs/preview.png)                | ![Monitor](docs/monitor.png) | ![Recipe](docs/recipe.png) |

## Contents

1. [Install and start](#1-install-and-start)
2. [Try it without a server of your own](#2-try-it-without-a-server-of-your-own)
3. [First run: add your first server](#3-first-run-add-your-first-server)
4. [Using GFV](#4-using-gfv)
5. [Your data, security and the master password](#5-your-data-security-and-the-master-password)
6. [Troubleshooting](#6-troubleshooting)
7. [Known limits](#7-known-limits)
8. [Development](#8-development)

## 1. Install and start

You need **Node.js 22 or newer** and **pnpm** on the computer you work on (not on the server). GFV runs on
your computer and reaches your servers over SSH: nothing is installed on the servers.

**From this repository** (works today):

```bash
pnpm install
pnpm start          # builds the web app, starts GFV, opens your browser
```

`pnpm start` accepts the same options as the `gfv` command: `pnpm start --port 5000`, `pnpm start --no-open`.

**As an installed command** (build a package from the repository, then install the tarball anywhere):

```bash
pnpm build:package
(cd dist-pkg && pnpm pack)                  # makes dist-pkg/gfv-0.1.0.tgz
npm install -g ./dist-pkg/gfv-0.1.0.tgz     # or: pnpm add -g ./dist-pkg/gfv-0.1.0.tgz
gfv
```

**`npx gfv`** works once the package is published to npm (not done yet: the name and license are still to be
decided).

GFV prints an address like `http://127.0.0.1:4310/?token=…` and opens it in your browser. Open that address
(the long token in it signs your browser in, then it disappears from the address bar). Stop GFV with
`Ctrl+C` in the terminal where it runs.

```
gfv [--port <n>] [--no-open] [--version] [--help]
```

## 2. Try it without a server of your own

The repository includes two throwaway Ubuntu servers in Docker, handy for learning GFV safely. You need Docker.

```bash
ssh-keygen -t ed25519 -N "" -f e2e/keys/id_test               # once: a key just for these test servers
docker compose -f e2e/docker-compose.yml up -d --build         # starts vps-a (port 2201) and vps-b (port 2202)
```

Then add a server in GFV with: host `127.0.0.1`, port `2201`, username `gfv`, and the private key from
`e2e/keys/id_test` (use the "Choose File" button). `sudo` works without a password there. Stop them later with
`docker compose -f e2e/docker-compose.yml down`. (Systemd and Docker are not really running inside these
containers, so the Services and Docker apps show canned data there.)

## 3. First run: add your first server

1. **Choose a master password** (at least 8 characters). It encrypts your SSH keys and passwords on this
   computer. There is no recovery if you forget it.
2. A short **tour** shows the desktop. Skip it or click through; you can replay it from the Help menu
   ("Take the Tour").
3. Click **Servers** in the Dock (or press "Add a server"), then **+ Add server** and fill in:
   - **Name** (anything), **Host** (IP or domain), **Port** (usually 22), **Username**;
   - **Authentication**: paste your **private key** (the `-----BEGIN OPENSSH PRIVATE KEY-----` text) or choose
     the key file, with its passphrase if it has one; or pick **Password**.
4. Press **Save**, then **Connect**.
5. The first time, GFV shows the server's **host key fingerprint**. Check that it is really your server
   (on the server: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), then **Trust and connect**. If the
   fingerprint ever changes later, GFV refuses to connect and tells you: that can mean someone is
   intercepting the connection, or that the server was reinstalled.
6. The status turns green: **Connected**. The server now appears in the menu bar's server picker.

**About `sudo`:** if you log in as `root`, everything works. If you log in as a normal user, actions that need
administrator rights (installing tools, restarting services, saving system files) run `sudo -n`, which needs
**passwordless sudo** for that user (a line like `youruser ALL=(ALL) NOPASSWD:ALL` in `/etc/sudoers.d/`).
Without it those actions fail with "a password is required"; everything else still works.

## 4. Using GFV

**The desktop** looks and works like a macOS desktop.

- **Dock** (bottom): click an app to open it (or bring it to the front). Icons grow as the pointer nears them;
  a dot marks a running app; right-click an icon for its windows and _New Window_. Minimized windows wait after
  the separator.
- **Menu bar** (top): the **GFV menu** (light/dark, wallpaper, _Reduce Transparency_, master password, lock), then
  the focused app's **File / Edit / View / Window / Help** menus (the Terminal, Editor and Files add their own
  items), and on the right: search, the **active server** picker, **Record**, **Learn**, **Control Center** and
  the clock.
- **Windows** have traffic lights (close, minimize, zoom; double-click the title bar to zoom). Every window that
  talks to a server shows that server's **colour ring and name**, so you always know which machine it controls.
- **Spotlight** (**Ctrl+K**, or the magnifier): type to open an app, jump to a window, switch server, change a
  setting or run a safe action. Inside the Terminal and the Editor Ctrl+K belongs to bash/Monaco, so use **Cmd+K**
  there or the magnifier.
- **Full screen:** the zoom button (green) makes a window fill the whole workspace and the Dock tucks away (touch the bottom edge to bring it back). The full-screen button in the menu bar (or View > Enter Full Screen) puts the whole GUI in browser full screen; Esc exits. Turn the _Learn_ panel off for the full width.
- **Mission Control** (**Ctrl+Up**, View menu, or Spotlight): all windows side by side; click one to bring it
  forward, Esc to leave.
- **Control Center** (the sliders icon): server, light/dark, wallpaper, Learn, Record, lock.
- Right-click the bare desktop for a small menu, a file row for file actions, or the terminal for Copy/Paste.

Everything is keyboard-reachable and respects your system's _reduce motion_ setting; _Reduce Transparency_ (GFV
menu) swaps the frosted glass for solid colours.

| App           | How to use it                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Terminal**  | A real shell. Press **+** for more tabs. Copy with `Ctrl+Shift+C`. If you type something dangerous (for example `rm -rf /`) GFV holds the Enter key and asks: **Cancel** or **Run anyway**. Reloading the browser page ends your shells.                                                    |
| **Files**     | Type a path in the bar or double-click folders. Buttons: New folder, Upload (or drag files from your computer into the window), Rename, Permissions, Download, Delete. Double-click a file to edit it. Tick "Hidden files" to see dotfiles.                                                 |
| **Editor**    | Opens from Files. `Ctrl+S` saves; a `●` in the title means unsaved changes. If the save is refused because the file belongs to root, press **Save with sudo…**: GFV shows the exact commands (a backup of the old version comes first), you confirm, done.                                  |
| **Monitor**   | Live CPU, memory, network and disk, plus the process list (search and sort). **Stop** asks a process to quit politely; **Kill** forces it (dangerous: you must confirm).                                                                                                                    |
| **Services**  | systemd services: start, stop, restart, enable or disable at boot, and **Logs** (tick _Follow_ to refresh every 2 s).                                                                                                                                                                       |
| **Docker**    | Containers and images: start, stop, restart, remove, logs. Shows "not installed" if the server has no Docker.                                                                                                                                                                               |
| **Dev Hub**   | One-click install of Node.js 22, Python 3, Docker, PostgreSQL, nginx and Git on **Ubuntu/Debian**. See the exact commands, confirm, and watch the output. Installs take minutes: you can **Hide** the window (it keeps running; the card shows "Installing… View output") or **Cancel** it. |
| **Snapshots** | The timeline of backups GFV made before changing a file. Pick one to see a diff against the file now (or the previous backup) and **Restore this version…**. You can also delete a backup.                                                                                                  |
| **Recipes**   | See below.                                                                                                                                                                                                                                                                                  |
| **Actions**   | A small launcher for a few example actions (uptime, delete a path).                                                                                                                                                                                                                         |

**Every change goes through the same steps.** When an app wants to change something on the server, a window
shows **what it does** in plain English, the **exact commands**, and the **risk** (safe, caution or danger).
Caution and danger actions need you to tick _I understand the risk_. Press **Run** and the output streams in
live. Nothing runs before you confirm.

**Lessons.** The **Lessons** app has short guided lessons that use your real server: read a step, do something in GFV (the lesson notices when you did it), and answer quiz questions (a wrong answer just lets you try again). Progress is saved in this browser. Pick a **skill level** at the top: _Beginner_ keeps everything explained, _Intermediate_ folds the explanations away, _Expert_ starts with the Learn panel closed. The level never changes the safety confirmations.

**Learn Mode (_Learn_ in the menu bar).** The panel on the right keeps a **journal** of every command GFV ran
for you, with its explanation, and counts how many different commands you have seen. Press **Try it yourself**
next to any command to type it into a terminal **without running it**.

**Recipes: clone a setup.**

1. Press **Record** in the menu bar (it records on the active server).
2. Do things in GFV: create folders, install tools, restart services, change permissions…
3. Press **Stop**. The Recipes app opens with your steps. Rename the recipe, reorder or delete steps.
4. Open the **Script** tab: **Copy** it or **Download** the `.sh` file.
5. On another server (as root, or as a user with sudo): `bash my-recipe.sh`. The script explains each step in
   comments and is written to be safe to run twice where possible.

Only _actions_ are recorded. File edits, uploads and killed processes are not, so a recipe rebuilds the setup,
not your file contents.

**Run a recipe on other servers (Jobs).** In Recipes press **Run on…**, tick the servers, and press **Preview**: you
see the exact commands that will run on each server and their risk. Confirm once (if anything is risky) and press
**Start**. The **Jobs** app shows progress per server. Every server runs the steps in order, all servers at the
same time. **If a step fails, that server pauses** and asks: _Retry step_, _Skip step_, or _Stop this server_; the
others carry on, and nothing after the failed step has run. _Cancel job_ stops everything (Ctrl-C to running steps).

**Parameters.** A recipe can ask for values when it runs (a domain name, a database password). On the recipe's
**Parameters** tab add one (for example `site`, default `main`), then on the **Steps** tab edit a step and write
`{{site}}` inside a text value, such as `/var/www/{{site}}`. A _secret_ parameter is never stored or logged and
always has to be typed. In an exported script each parameter is an environment variable
(`GFV_SITE=blue bash recipe.sh`); a required one that is missing stops the script before it does anything.

**Copy between servers.** Open two Files windows on different servers and drag a file from one onto the other (or onto a folder row). It is streamed through GFV, never overwrites an existing file, and works for files only (not folders yet).

**Network (ports and domains).** The **Network** app has two tabs. _Ports_ shows every port the server is listening on and which program owns it, marking whether it is reachable from anywhere or only from the server itself. _Sites & domains_ manages nginx: **Add site** points a domain at an app on a local port (or a folder of files), checks the whole nginx configuration before reloading, and automatically undoes the change if nginx rejects it. **Get HTTPS** uses certbot (Let’s Encrypt): the domain must already point at the server, and the preview shows that it accepts Let’s Encrypt’s Terms of Service on your behalf. Every change shows its exact commands first.

**Broadcast.** In Jobs press **New broadcast…** to run one action on several servers at once.

**Other formats.** On a recipe's **Script** tab pick the format: **Bash script**, **Dockerfile**, **Docker Compose**
(compose file + Dockerfile) or **Ansible playbook**. Steps that cannot be expressed in a format (a service restart
inside a Docker image, an action with no Ansible module) are left out or turned into a shell task, and a note above
the file says so. Review the result before using it: GFV generates it, but it has not run it for you.

**Library and sharing.** **Library…** (top of the recipe list) has **starter recipes** that ship with GFV, and
**From a file** to import a recipe someone sent you. You see every command and its risk before importing, and a file
that uses an unknown action or invalid values is refused with the reasons. **Share** saves a recipe as a readable
`.gfv-recipe.json` file (no secret values), which you can send to someone or keep in a Git repository. Nothing is
downloaded from the internet by GFV itself.

**Clone setup.** On the **Servers** app press **Clone setup** on a connected server to make a recipe of the Dev Hub
tools (Node, Python, Docker, PostgreSQL, nginx, Git) installed on it. It reproduces the tools, not your files or
settings.

**Other things:** _Take the Tour_ (Help menu) and _Change Master Password…_ (GFV menu). _Lock Vault_ (GFV menu or
Control Center) closes every connection, and you need the master password again.

## 5. Your data, security and the master password

- **Where your data lives:** `~/.gfv/gfv.db` (servers with their **encrypted** credentials, trusted host keys,
  history, recipes, snapshot records). Set `GFV_HOME` to use another folder. The file is readable only by you.
  On each server, backups GFV makes go to `~/.gfv/snapshots/`.
- **Forgot the master password?** It cannot be recovered. To start over, stop GFV and delete `~/.gfv/gfv.db`
  (you will have to add your servers again).
- **GFV is meant to run on your own computer.** It listens on `127.0.0.1` only and requires a random session
  token on every request. Opening the printed address once turns the token into an `HttpOnly`,
  `SameSite=Strict` cookie. WebSocket origins are checked, and so is the origin of every request that changes
  something. Hosting GFV on a server for several people is not supported yet.
- **Credentials** are encrypted at rest (AES-256-GCM, key derived from your master password with scrypt). The
  master password is never stored. Repeated wrong passwords are slowed down.
- **Host keys** are verified on first use. A changed key is never accepted silently.
- **One Command Runner:** every action validates and shell-quotes its parameters (never string-concatenates
  them), checks risk on the server, and is recorded in your history.
- The Safety Net is a seatbelt for accidents, not a security boundary: shell syntax is too rich to parse
  perfectly (tab completion, history and aliases can bypass the terminal check).

## 6. Troubleshooting

| Problem                                                            | What to do                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Can't reach the GFV server" in the browser                        | GFV is not running, or the page is from an old session. Start it again and open the address it prints.                                                                            |
| Port 4310 is busy                                                  | GFV uses the next free port by itself. Or pick one: `--port 5000`.                                                                                                                |
| "Too many wrong attempts"                                          | The unlock screen waits a little (up to a minute) after repeated wrong passwords. Wait, then try again.                                                                           |
| Connect fails: authentication failed                               | Check the username and the key or password. A key with a passphrase needs the passphrase. The server must allow that login method.                                                |
| Connect fails: host key changed                                    | The server's identity changed. If you reinstalled the server this is expected; otherwise be careful. GFV shows the new fingerprint and asks you to confirm replacing the old one. |
| "Permission denied" when saving a file                             | Use **Save with sudo…** in the Editor (needs root or passwordless sudo).                                                                                                          |
| Install or restart fails with "a password is required"             | The user needs passwordless sudo (see [section 3](#3-first-run-add-your-first-server)) or log in as root.                                                                         |
| Dev Hub: "can only install on Ubuntu or Debian"                    | Other systems are not supported yet.                                                                                                                                              |
| Services says "does not use systemd" / Docker says "not installed" | The server has no systemd or Docker. Install Docker from the Dev Hub.                                                                                                             |
| An install was cancelled and the next one complains about dpkg     | Run `sudo dpkg --configure -a` on the server.                                                                                                                                     |
| The lost-connection banner appears                                 | GFV itself went away or is restarting. It reconnects by itself.                                                                                                                   |
| Terminal shows "Session ended"                                     | The shell closed (`exit`, or a page reload). Press **Start new session**.                                                                                                         |

## 7. Known limits

- Real systemd and Docker behaviour is covered by tests against canned output (the test containers have
  neither); try it on a real VPS before you rely on it. Python, Docker and nginx installs were not run for real.
- Recipes record **actions** only and have no parameters yet. Replaying a recipe on another server from the
  app is a future feature (export the script and run it).
- Logs refresh every couple of seconds (Follow); they are not a live stream.
- Terminal shells end when the browser page is reloaded.
- Targets Ubuntu and Debian servers first.

## 8. Development

```bash
pnpm install
pnpm dev                 # server on 127.0.0.1:4310 + web on localhost:5173 (shared random token)
pnpm typecheck && pnpm lint && pnpm test
```

The integration tests and the Playwright specs use the two Docker test servers from
[section 2](#2-try-it-without-a-server-of-your-own); they skip themselves when the containers are not running
(check the skipped count if a test run looks too quick):

```bash
pnpm test                # unit + integration tests
pnpm e2e                 # Playwright: the built app against the test servers
```

`pnpm build:package` builds the publishable package into `dist-pkg/` (one bundled server file, the web app and
the migrations); `cd dist-pkg && pnpm pack` makes the tarball that `npx gfv` would download.

Layout: `shared/` (types, Zod schemas, the action catalog, danger detector), `server/` (Fastify, SSH pool,
Command Runner, SFTP, SQLite), `web/` (React desktop and apps), `e2e/` (test servers and Playwright specs),
`docs/` (README images). Read **[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)** for a deep tour of how everything is wired and how the
code is written, `PLAN.md` for the milestones and v2 ideas, and `CLAUDE.md` for conventions and gotchas.
