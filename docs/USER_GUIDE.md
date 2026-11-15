# GFV user guide

This is the long version of the README. I wrote it the way I would explain GFV to a friend sitting next to me:
how to start it, what each app does, and where the sharp edges are. If something here is wrong or unclear, please
open an issue, because the guide is only useful if it matches what the program really does.

## Contents

- [Starting GFV](#starting-gfv)
- [Try it without a server](#try-it-without-a-server)
- [First run](#first-run)
- [The desktop](#the-desktop)
- [How a change reaches your server](#how-a-change-reaches-your-server)
- [The apps](#the-apps)
- [Learning with GFV](#learning-with-gfv)
- [Recipes and jobs](#recipes-and-jobs)
- [Websites, projects and the network](#websites-projects-and-the-network)
- [Firewall and lockout protection](#firewall-and-lockout-protection)
- [Security checkup and backups](#security-checkup-and-backups)
- [App Store and databases](#app-store-and-databases)
- [The assistant](#the-assistant)
- [Using GFV on a phone](#using-gfv-on-a-phone)
- [Running GFV for several people](#running-gfv-for-several-people)
- [Your data](#your-data)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)

## Starting GFV

You need Node.js 22 or newer and pnpm on the computer you work from. GFV runs there and reaches your servers over
SSH, so nothing is installed on the servers.

```bash
pnpm install
pnpm start
```

`pnpm start` builds the web app, starts GFV and opens your browser. It accepts the same options as the `gfv`
command: `--port 5000` to pick a port, `--no-open` to skip opening the browser.

GFV prints an address with a long token in it. Open that address once. The token signs your browser in and then
disappears from the address bar. If you close the tab by accident, open the same address again, or start GFV again
for a new one.

You can also build an installable package and install it as a command:

```bash
pnpm build:package
(cd dist-pkg && pnpm pack)
npm install -g ./dist-pkg/gui-for-vps-0.1.0.tgz
gfv
```

## Try it without a server

The repository includes throwaway servers that run in Docker, which is the safest way to get to know GFV. You need
Docker installed.

```bash
ssh-keygen -t ed25519 -N "" -f e2e/keys/id_test
docker compose -f e2e/docker-compose.yml up -d --build
```

That starts two Ubuntu servers, one on port 2201 and one on port 2202. In GFV add a server with host `127.0.0.1`,
port `2201`, username `gfv`, and the private key from `e2e/keys/id_test`. The user has passwordless sudo.

These two servers have no systemd and no Docker, so the Services and Docker apps show canned data on them. There is
also a more realistic one with real systemd, a real firewall and real Docker, which I use to test the firewall,
backups and App Store:

```bash
docker compose -f e2e/docker-compose.yml --profile systemd up -d --build vps-systemd
```

It listens on port 2204 and runs privileged, so only use it on a machine you trust. Stop everything with
`docker compose -f e2e/docker-compose.yml down`.

## First run

First you choose a master password of at least eight characters. It encrypts your SSH keys and passwords on this
computer. I do not store it and I cannot recover it, so use a password manager.

A short tour follows. You can skip it and replay it later from the Help menu.

To add a server, open the Servers app and press Add server. Give it a name, the host (an address or a domain), the
port (usually 22) and the username. For authentication either paste your private key (the text that starts with
`-----BEGIN OPENSSH PRIVATE KEY-----`), choose the key file, or pick a password. If the key has a passphrase, enter
that too.

Press Save, then Connect. The first time, GFV shows the server's host key fingerprint. Please check it against the
real one before you trust it. On the server you can print it with:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If the fingerprint ever changes later, GFV refuses to connect and tells you. That can mean the server was
reinstalled, or that someone is sitting in the middle of the connection, so be careful.

A note about sudo. If you log in as root everything works. If you log in as a normal user, actions that need
administrator rights run `sudo -n`, which needs passwordless sudo for that user (a line like
`youruser ALL=(ALL) NOPASSWD:ALL` in a file under `/etc/sudoers.d/`). Without it those actions fail with "a password
is required" and everything else still works.

## The desktop

The desktop is modelled on macOS, because I find windows, a dock and a menu bar the quickest way to keep several
servers and tools in view at once.

The Dock at the bottom opens apps or brings a running app to the front. A dot marks a running app, and right-clicking
an icon lists its windows. The menu bar at the top has the GFV menu (theme, wallpaper, master password, lock), the
menus of the focused app, and on the right search, the active server, Record, Learn, Control Center and a clock.

Every window that talks to a server shows that server's colour and name, so you always know which machine you are
touching. That matters a lot when you have two servers that look alike.

Spotlight (Ctrl+K, or Cmd+K inside the terminal and the editor) opens apps, jumps to windows, switches servers and
runs safe actions. Mission Control (Ctrl+Up) shows all windows side by side. Control Center, the sliders icon, holds
the quick settings. The zoom button makes a window fill the workspace, and the full-screen button in the menu bar
puts the whole interface in browser full screen.

Everything can be reached with the keyboard, the animations respect your system's reduced-motion setting, and
Reduce Transparency in the GFV menu swaps the frosted glass for solid colours.

## How a change reaches your server

This is the part of GFV I care most about, so it is worth understanding.

Whenever an app wants to change something, a window opens with three things: what it does in plain English, the
exact commands that will run, and the risk, which is safe, caution or danger. Caution and danger actions need you to
tick that you understand the risk. Only then do you press Run, and the output streams in live. Nothing runs before
you confirm. The server checks this too, so a bug in the interface cannot skip it.

Reading things, like the monitor or a list of services, does not need a window. Those are quiet queries that just
read and show.

Terminal input is the one exception, because a shell is a shell. GFV still watches what you type and holds the Enter
key on a dangerous line until you confirm. As I say elsewhere, that is a seatbelt and not a wall.

## The apps

Terminal. A real shell. The plus button opens more tabs and Ctrl+Shift+C copies. If you type something dangerous,
like `rm -rf /`, GFV holds the Enter key and asks you to cancel or run it anyway. Reloading the page ends your
shells.

Files. Type a path or double-click folders. You can create folders, upload (or drag files in from your computer),
rename, change permissions, download and delete. Double-click a file to edit it. You can drag a file from one server's
window onto another server's window to copy it between them. It streams through GFV, never overwrites, and works for
single files only.

Editor. Opens from Files. Ctrl+S saves. If the file belongs to root and the save is refused, "Save with sudo" shows
you the exact commands, with a backup of the old version first.

Monitor. Live CPU, memory, network and disk, plus a process list you can search and sort. Stop asks a process to quit
politely, and Kill forces it, which is a danger action.

Services. systemd services: start, stop, restart, enable or disable at boot, and logs.

Docker. Containers and images: start, stop, restart, remove and read logs.

Dev Hub. One-click installs of Node.js 22, Python 3, Docker, PostgreSQL, nginx and Git on Ubuntu, Debian and (for
most of them) Fedora. You see the commands and confirm. Installs take minutes, so you can hide the window and let
them keep running, or cancel.

Snapshots. Before GFV changes a file it saves the old version on the server. This app is the timeline of those
backups. Pick one to see a diff against the file now and restore it. A restore backs up the current file first, so a
restore can itself be undone.

Actions. A tiny launcher for a few example actions.

## Learning with GFV

Learn Mode is the panel on the right. It keeps a journal of every command GFV ran for you with its explanation, and it
counts how many different commands you have seen. "Try it yourself" next to a command types it into a terminal
without running it, so you can read it, change it and press Enter yourself.

The Lessons app has short guided lessons that use your real server. You read a step, do something in GFV, and the
lesson notices when you did it. Quiz questions let you try again after a wrong answer. A skill level at the top
changes only what is shown by default: Beginner keeps everything explained, Intermediate folds the explanations
away, and Expert starts with the Learn panel closed. The level never weakens the safety confirmations.

## Recipes and jobs

A recipe is a recorded setup. Press Record in the menu bar, do things in GFV, and press Stop. The Recipes app opens
with your steps, which you can rename, reorder and delete. Only actions are recorded. File edits, uploads and
killed processes are not, so a recipe rebuilds a setup, not your file contents.

The Script tab exports the recipe as a bash script, an Ansible playbook, a Dockerfile, or a Docker Compose file.
Steps that do not fit a format are left out or turned into a shell task, and a note says so. I generate these files
but I have not run the Dockerfile or the playbook for you, so read them before you use them.

A recipe can have parameters, for example a domain name. Write the placeholder as `{{site}}` inside a step. A secret
parameter is never stored or logged. In an exported script each parameter becomes an environment variable.

"Run on" replays a recipe on one or more servers. You see the exact commands for each server first, confirm once,
and the Jobs app shows progress per server. If a step fails on a server, that server pauses and asks whether to
retry, skip or stop, while the others carry on. "New broadcast" runs a single action on several servers at once.

The Library has starter recipes that ship with GFV, and you can import a recipe file someone sent you. Imported files
are checked again, so one that uses an unknown action or invalid values is refused. Share saves a recipe as a
readable file without secrets. Clone setup, on the Servers app, builds a recipe from the Dev Hub tools installed on
a server.

## Websites, projects and the network

Network has two tabs. Ports lists everything the server is listening on and which program owns it, and whether it
is reachable from anywhere or only from the server itself. Sites and domains manages nginx. Add site points a domain
at a local port or a folder, checks the whole nginx configuration before reloading, and undoes the change if nginx
rejects it. Get HTTPS uses certbot and Let's Encrypt. The domain has to point at the server already, and the preview
tells you that it accepts the Let's Encrypt terms of service for you.

Projects deploys an app from a git repository into `~/gfv-projects/<name>` on the server. It clones or updates the
code and runs your build command there. Check for updates shows new commits and Deploy brings them in, discarding
local edits inside that folder. Environment saves variables to a file only you can read, and the values travel in a
temporary file so they never appear in a command or in the history. Run as a service creates a systemd service for
your user that restarts on a crash and starts at boot. Only deploy repositories you trust, because the build command is
that project's own code running on your server. Private repositories need an SSH key that is already set up on the
server.

Server Map draws how a visitor reaches your code: domain, nginx site, port, the program listening there, and the
project it was started from. A site that points at a port nobody listens on is drawn as a dashed red link and listed
under Problems. It refreshes every few seconds, and clicking a box opens the app that manages it.

## Firewall and lockout protection

The Firewall app manages ufw on Ubuntu and Debian: turn it on or off, add and remove rules, and see the rules in
plain language. Turning it on allows the SSH port first, so you cannot lock yourself out by switching it on.

The part I am proudest of is the lockout protection. A firewall rule can cut the very connection GFV is using, and
then nothing in the browser can fix it. So before a risky change, GFV saves the current rules on the server and
starts a timer there that restores them after 40 seconds. It then makes the change and opens a brand new SSH
connection to prove it can still get in. Only if that works does it cancel the timer. If it does not, the server puts
the old rules back by itself. I tested this against a real firewall by genuinely locking GFV out, twice.

Every change is also an entry in an undo timeline, with a button that puts the firewall back the way it was before
that change. An undo can be undone too.

## Security checkup and backups

The Security app reads a handful of settings and tells you what to look at: password logins and root login over SSH,
whether a firewall is on, pending and automatic updates, fail2ban, accounts with root powers or no password, disk
space, and which ports face the internet. Each finding explains why it matters and, where it is safe, offers a fix
that goes through the normal preview and confirmation. Changing SSH logins uses the same lockout protection as the
firewall, and GFV will not offer to turn passwords off if your account has no SSH key. It is a checklist of common
problems, not a guarantee that a server is secure.

Backups creates real systemd timers on the server. You choose folders, a schedule and how many archives to keep, and
the server packs the folders into archives under `~/.gfv/backups`. You can run one now, download an archive, and
restore it into a new folder. Restoring never overwrites your live files. Please remember that these archives live on
the same server. Download them or copy them somewhere else too, because a backup on the same disk does not survive
the disk.

## App Store and databases

The App Store installs a few well-known Docker apps with one click: a test page, Uptime Kuma, Grafana, Vaultwarden,
PostgreSQL and Redis. Each is pinned to a specific version. Passwords are generated on the server into a file only
you can read, so they never appear in a command or in the history, and Show credentials reads them back when you
ask. By default an app listens on the server only. Ticking "reachable from the internet" opens its port to everyone
unless a firewall says otherwise. Removing an app keeps its data unless you choose to delete it.

The Database app lets you browse and query PostgreSQL. GFV reaches the database through the SSH connection to its
server, so the database never has to be open to the internet. Everything runs in a read-only transaction unless you
switch on "allow changes" and confirm, and the database itself refuses anything else. Results are capped at 500 rows,
and one statement runs at a time. Saved passwords are encrypted with your master password.

## The assistant

The assistant is off until you turn it on in its settings. You can use Anthropic with your own API key, or any server
that speaks the OpenAI chat format, such as Ollama, which keeps everything on your computer.

I wanted this to be something I would trust myself, so it works in two steps. First you write a question and press
Preview. GFV shows you the exact text that would be sent, with passwords, tokens and private keys already removed,
and where it would go. Only if you press Send does anything leave your computer, and exactly what you previewed is
what is sent. The assistant cannot run anything. It can suggest actions, and each suggestion opens the normal review
window with the real commands and the real risk.

When a run fails, an "Explain this error" button offers to put the failing command and its output into the assistant.

## Using GFV on a phone

Below about 768 pixels wide the desktop becomes a launcher grid with one full-screen app at a time and a bottom bar.
The terminal gets a row of keys a phone keyboard lacks, such as Ctrl, Esc and the arrows. You can also install GFV as
an app from your browser. Remember that GFV listens on your computer's loopback address, so to use it from a phone
you need hosted mode or a tunnel.

## Running GFV for several people

Hosted mode runs GFV on a server with accounts, two-factor authentication, an administrator role and a member role,
per-server access, and an audit log. It must sit behind HTTPS. Read [HOSTED.md](HOSTED.md) before you try it, and
please treat it as something to review yourself, because it has not had an outside security review.

## Your data

Your data lives in `~/.gfv/gfv.db`, which holds your servers with their encrypted credentials, trusted host keys,
history and recipes. Set `GFV_HOME` to use another folder. The file is readable only by you. On each server, GFV
keeps its file backups in `~/.gfv/snapshots`, its undo points in `~/.gfv/guard`, and app passwords in `~/.gfv/apps`.

If you forget the master password it cannot be recovered. To start over, stop GFV and delete `~/.gfv/gfv.db`. You will
have to add your servers again.

## Troubleshooting

"Can't reach the GFV server" in the browser. GFV is not running, or the page is from an old session. Start it again
and open the address it prints.

Port 4310 is busy. GFV uses the next free port. You can also pick one with `--port`.

Connect fails with authentication failed. Check the username and the key or password. A key with a passphrase needs
the passphrase, and the server has to allow that kind of login.

Connect fails because the host key changed. The server's identity changed. After a reinstall that is expected;
otherwise be careful. GFV shows the new fingerprint and asks you to confirm replacing the old one.

Saving a file says permission denied. Use Save with sudo in the editor. It needs root or passwordless sudo.

An action fails with "a password is required". The user needs passwordless sudo, or log in as root.

Dev Hub says it can only install on certain systems. Other distributions are not supported yet.

Services says the server does not use systemd, or Docker says it is not installed. The server really has neither.
Install Docker from the Dev Hub.

An install was cancelled and the next one complains about dpkg. Run `sudo dpkg --configure -a` on the server.

The terminal says the session ended. The shell closed, or you reloaded the page. Start a new session.

## Known limits

- Ubuntu and Debian are the main targets. Fedora is partly supported. Alpine, Arch and firewalld are not.
- The firewall app only manages ufw.
- Backups stay on the same server unless you copy them elsewhere, and they are not encrypted.
- The database app supports PostgreSQL only, one statement at a time.
- Recipes record actions, not file edits.
- Logs refresh every couple of seconds instead of streaming.
- Terminal shells end when the page is reloaded.
- I have not tried the assistant against the real Anthropic API or a real Ollama server.
- Hosted mode has not had an outside security review.
