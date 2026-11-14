# GFV — GUI for VPS

> A server desktop in your browser that **teaches you**, **protects you**, and **lets you clone your setup**.

---

## 1. Vision

GFV gives you a desktop in the browser, similar to Puter, but it is connected to your real VPS servers. You get windows, a menu bar and a Dock, a terminal, a file manager, a system monitor, and a Dev Hub that installs dev tools with one click.

**What makes it different from Cockpit, 1Panel, GMSSH, and EveryOS:**

- **Learn Mode:** every action shows the real command and a plain-English explanation.
- **Safety Net:** dangerous actions are warned about, and config files are snapshotted so you can undo changes.
- **Recipes:** your GUI actions are recorded and exported as a reusable bash script. Replay and sharing come in v2.

**Audience:** (b) beginners and (c) portfolio/learning first. Expand to (a) experienced devs later.
**Modes:** **Local mode first.** It runs on your machine and connects to VPSes over SSH. Hosted mode, where GFV is deployed on the VPS itself, comes in v2.

---

## 2. Tech Stack

| Layer      | Choice                                                                         | Why                                                               |
| ---------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Language   | **TypeScript** everywhere                                                      | Matches MERN/PERN skills                                          |
| Monorepo   | pnpm workspaces                                                                | `server/`, `web/`, and `shared/` in one repo                      |
| Backend    | **Node 22 + Fastify** + `@fastify/websocket`                                   | Fast, typed, good WebSocket support                               |
| SSH / SFTP | **`ssh2`**                                                                     | The standard Node SSH library. Provides exec, PTY shell, and SFTP |
| Database   | **SQLite** via `better-sqlite3` + **Drizzle ORM**                              | No install needed for local mode, and can move to Postgres later  |
| Secrets    | Node `crypto` (AES-256-GCM) with a key derived from a master password (scrypt) | SSH keys and passwords are encrypted at rest                      |
| Frontend   | **React 19 + Vite**                                                            | Known stack                                                       |
| State      | **Zustand**                                                                    | Simple global state for windows and servers                       |
| UI         | Tailwind CSS + shadcn/ui                                                       | Fast to build and looks clean                                     |
| Windows    | **react-rnd**                                                                  | Draggable and resizable windows                                   |
| Terminal   | **xterm.js** (+ fit addon)                                                     | Industry standard, also used by VS Code                           |
| Editor     | **Monaco** (`@monaco-editor/react`)                                            | VS Code's editor                                                  |
| Charts     | **uPlot** (or Recharts)                                                        | Lightweight live charts                                           |
| Validation | **Zod** (in `shared/`)                                                         | One schema for both API and UI                                    |
| Testing    | Vitest (unit), Playwright (e2e), Docker `sshd` container as the test VPS       |                                                                   |
| Run        | `npx gfv` starts the server on `127.0.0.1` and opens the browser               |                                                                   |

We don't clone Puter. Its license is AGPL, it uses jQuery, and its backend is built for cloud storage, not SSH. We build our own small desktop shell with react-rnd and use **daedalOS** only as a design reference.

---

## 3. Architecture

```
 Browser (React desktop)                     Your machine (Node)                 VPS(es)
┌──────────────────────────┐   HTTP + WS   ┌───────────────────────────┐  SSH  ┌──────────┐
│ Desktop shell (windows)  │ ────────────► │ Fastify API               │ ────► │ sshd     │
│ Apps: Terminal, Files,   │               │ ├─ SSH connection pool    │       │ /proc    │
│ Monitor, Dev Hub, ...    │ ◄──────────── │ ├─ Command Runner ★       │ ◄──── │ systemd  │
│ Learn panel / Warnings   │   streams     │ ├─ SFTP service           │       │ docker   │
└──────────────────────────┘               │ ├─ Metrics collector      │       └──────────┘
                                           │ ├─ Snapshot service       │
                                           │ └─ SQLite (servers,       │
                                           │    history, recipes)      │
                                           └───────────────────────────┘
```

### ★ The Command Runner (the core idea)

Every action in the GUI goes through a single function. Learn Mode, the Safety Net, and Recipes all depend on this, so it must exist from day one.

```ts
// shared/actions.ts
type Action = {
  id: string; // "install.node"
  title: string; // "Install Node.js 22"
  explain: string; // plain-English explanation (Learn Mode)
  commands: (params) => string[]; // real shell commands
  risk: 'safe' | 'caution' | 'danger';
  riskReason?: string; // shown in Safety Net dialog
  snapshotPaths?: string[]; // files to back up before running
  recordable: boolean; // goes into Recipes
};
```

How a run works:

1. The UI calls `runAction(serverId, actionId, params)`.
2. The UI shows a **preview**: explanation, exact commands, and risk level. In beginner mode this preview always appears.
3. If the risk is `caution` or `danger`, a confirmation dialog shows the reason.
4. Files listed in `snapshotPaths` are snapshotted.
5. The commands run over SSH, and output streams live to the UI.
6. The result is saved to `history`. If it succeeded and is recordable, it is also added to the current **recording**.

Raw terminal commands are also checked by the **danger-pattern detector**. In the terminal the server holds the Enter key on a dangerous line until the user clicks **Run anyway** (or **Cancel**), so it is a confirmation, never a hard block. Checking is paused inside full-screen programs (vim, htop) and is best effort: Tab completion and shell history can bypass it. It is a safety net for accidents, not a security boundary.

---

## 4. Version 1 — Features

### 4.1 Desktop Shell

- Desktop with app icons, wallpaper, and a right-click menu
- Windows that can be dragged, resized, minimized, maximized, and closed, with focus and z-order
- Menu bar (app menus, clock, **server picker**) and a Dock (running apps, minimized windows). Taskbar and Start menu were replaced by these in M10
- Each window is tied to a server, shown by a colored border and server-name badge
- Layout saved to localStorage, wrapped in try/catch
- Light and dark themes

### 4.2 Server Manager

- Add, edit, or delete a server: name, host, port, user, and auth (private key or password), plus a color
- Test the connection, and verify the host key on first connect (TOFU), with a warning if the key changes later
- Credentials encrypted with the master password, which is entered once per app session
- Connection pool with keep-alive and auto-reconnect

### 4.3 Core Apps

| App                | Features                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Terminal**       | xterm.js connected to an SSH PTY, multiple tabs, resize, copy/paste, and a danger-command warning bar                                                |
| **File Manager**   | Browse, upload (drag from your PC), download, new file/folder, rename, delete, chmod, hidden files toggle, path bar, and "open in Editor"            |
| **Editor**         | Monaco with syntax highlighting, save over SFTP (snapshot first if it's a system config), and an unsaved-changes guard                               |
| **System Monitor** | Live CPU, RAM, disk, network, uptime, and OS info parsed from `/proc` and `df`. Process list with sort, search, and kill (with a Safety Net confirm) |
| **Services**       | `systemctl` list, start/stop/restart/enable, and live logs (`journalctl - **Docker** (if installed)                                                  | List containers and images, start/stop/remove, and logs |

### 4.4 Dev Hub (one-click installs)

Each item is a Command Runner action with an explanation, so the user sees exactly what is happening.

- **v1 set:** Node.js (via nvm), Python 3 + pip, Docker, PostgreSQL, nginx, Git
- Detect what is already installed and show its version
- Install, uninstall, and start/stop where it applies
- Target **Ubuntu/Debian** first, and detect the distro to show a friendly "not supported yet" message elsewhere

### 4.5 Learn Mode (Idea B)

- A toggle in the menu bar, **on by default** for new users
- Every action shows a "what this does" panel with the commands it runs, line by line
- "Try it yourself" button: copies the command into the Terminal without running it
- A **command journal** listing every command GFV ran, with explanations
- A simple counter: "You've learned N commands"

### 4.6 Safety Net (Idea C)

- Danger-pattern detector for `rm -rf /`, `chmod 777`, `> /etc/...`, `ufw disable`, editing `sshd_config`, killing PID 1 or sshd, `dd`, `mkfs`, and similar
- Confirmation dialog with the reason and a safer alternative where one exists
- **Config snapshots**: before GFV edits a file under `/etc` (or another listed path), a copy goes to `~/.gfv/snapshots/` on the server, and the change is recorded in SQLite
- **Snapshot timeline** app: see the changes to a file, diff them, and restore with one click (a restore backs up the current file first, so it can be undone)
- **Save with sudo** in the Editor for root-owned files: the backup and the `sudo cp` are ordinary Command Runner commands, shown in the preview

### 4.7 Recipes — basic (Idea A, part 1)

- Record and stop buttons in the menu bar
- Every successful recordable action while recording becomes a step
- View the recipe's steps, reorder or delete them, and rename it
- **Export as a bash script** with comments taken from the action explanations, idempotent where possible

---

## 5. Project Structure

```
gfv/
├─ PLAN.md
├─ package.json              # pnpm workspaces
├─ shared/                   # types, zod schemas, action catalog, danger patterns
│  └─ src/{actions/,danger.ts,types.ts}
├─ server/
│  └─ src/
│     ├─ index.ts            # fastify boot, open browser
│     ├─ db/                 # drizzle schema + migrations (servers, history, snapshots, recipes)
│     ├─ crypto/             # master key, encrypt/decrypt
│     ├─ ssh/                # pool, host-key store, exec, pty
│     ├─ services/           # runner, sftp, metrics, snapshots, recipes, devhub detect
│     └─ routes/             # REST + websocket handlers
├─ web/
│  └─ src/
│     ├─ desktop/            # shell: Desktop, Window, MenuBar, Dock, Spotlight, windowStore
│     ├─ apps/               # terminal, files, editor, monitor, services, docker, devhub, snapshots, recipes, settings
│     ├─ components/         # LearnPanel, DangerDialog, ServerBadge, ...
│     └─ lib/                # api client, ws client
└─ e2e/                      # playwright tests + docker-compose with test sshd
```

---

## 6. Build Order (Milestones)

| #   | Milestone                                                                                                                                              | Done when                                                                                      | Est.     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------- |
| M0  | Repo setup: workspaces, TS, lint, Vite, Fastify, test `sshd` container                                                                                 | `pnpm dev` shows a blank page and the API health check passes                                  | 1–2 days |
| M1  | **Desktop shell**: windows, taskbar, start menu, window store                                                                                          | You can open, drag, resize, and close dummy apps                                               | 3–4 days |
| M2  | **Server Manager** + encryption + SSH pool + host-key check                                                                                            | You can add the test container and see "connected"                                             | 3–4 days |
| M3  | **Terminal** app (PTY over WebSocket)                                                                                                                  | Running `htop` works inside the browser                                                        | 2–3 days |
| M4  | **Command Runner** + Learn panel + danger detector + history                                                                                           | Running a sample action shows the preview, explanation, and streamed output                    | 4–5 days |
| M5  | **File Manager** + **Editor** (SFTP)                                                                                                                   | You can edit a file and save it, and the snapshot is taken for `/etc` files                    | 5–7 days |
| M6  | **System Monitor** + process kill, **Services**, **Docker**                                                                                            | Live charts update and you can restart nginx                                                   | 5–6 days |
| M7  | **Dev Hub** (6 tools) on Ubuntu                                                                                                                        | Node and Postgres install on a clean Ubuntu container                                          | 4–5 days |
| M8  | **Snapshots timeline** + **Recipes** (record and export bash)                                                                                          | Exporting a recipe produces a script that works on a fresh container                           | 4–5 days |
| M9  | ✅ Polish: onboarding tour, themes, error states, `npx gfv` packaging, README, and a demo GIF                                                          | A new user can go from install to their first server in under 3 minutes                        | 4–5 days |
| M10 | ✅ macOS-style redesign: tokens, menu bar, Dock, glass windows, Spotlight, Mission Control, Control Center, toasts, per-app menus, accessibility audit | `pnpm e2e` passes incl. the contrast/focus audit; before/after screenshots in `docs/redesign/` | done     |

**Total: about 6–8 weeks part-time.** Each milestone is a usable step, so we commit and demo after every one.
--

## 7. Security (even in local mode)

- The server binds to **127.0.0.1 only**, with a random session token in the URL and cookie, so other local sites can't talk to the API
- Check the WebSocket origin and require the token on every WS and API call
- Credentials are encrypted at rest and the master password is never stored
- Host-key verification, never auto-accepting changed keys
- No shell-string concatenation with user input: escape it with a quoting helper, and validate params with Zod
- Never log secrets

---

## 8. Testing & Verification

- **Test VPS:** `e2e/docker-compose.yml` runs two Ubuntu `sshd` containers, `vps-a` and `vps-b`
- **Unit (Vitest):** `/proc` parsers, danger detector, crypto, action → command generation, and recipe → bash export
- **Integration:** SSH pool, SFTP ops, and the runner against the containers
- **E2E (Playwright):** add a server, then open the terminal, run `echo hi`, and see the output. Then upload, edit, and download a file, install Node from the Dev Hub, record a recipe, export it, and run it on `vps-b`
- **Manual:** run against a real cheap VPS before the v1 release

---

## 9. Version 2 — Planned Features

### Idea A — Recipes, full version

- **Replay a recipe on another VPS** with one click, with step-by-step progress and a pause on failure
- Parameterized recipes, for example asking for the domain name and DB password when the recipe runs
- Export as Dockerfile, docker-compose, or an Ansible playbook
- **Community recipe library**, such as "MERN on Ubuntu", "Spring Boot + Postgres + nginx", and "WordPress": browse, rate, fork, and share
- "Clone this server": generate a recipe from a server's current state

### Idea B — Learn Mode, advanced

- Guided lessons ("Deploy your first app", "Set up a firewall") that use the real server
- Quizzes: "Which command shows disk usage?" before revealing it
- Skill levels that progressively hide GUI hand-holding
- AI explain: select any terminal output and ask "what does this mean?"

### Idea C — Safety Net, advanced

- Full **undo timeline** for packages installed or removed, services changed, and firewall rules
- "Lockout protection": when changing SSH or firewall settings, auto-revert in 60 seconds unless confirmed (like a monitor-resolution change)
- A security checkup app: open ports, root login, password auth, outdated packages, and fail2ban, each with a one-click fix
- Scheduled backups of chosen folders and databases

### Idea D — Server Map

- A live visual graph: **domain → nginx → port → process → database**
- Click a node to open the matching app (logs, config, restart)
- Highlight problems in red, such as a process down, a port not listening, or an expired cert
- Multi-server view showing how servers talk to each other

### Other v2 features

- **Hosted mode**: deploy GFV on a VPS and use it as a browser computer, with TLS (auto Let's Encrypt), login + 2FA, rate limiting, an audit log, and multi-user support (switching to Postgres is optional)
- **Cross-server drag and drop**: drag files between two servers' File Manager windows
- **Multi-server broadcast**: run one command or action on several servers at once
- **Projects app**: deploy from a GitHub repo, manage env vars, run as a service with pm2 or systemd, with logs and auto-redeploy
- **Ports & Domains app**: see what is on each port, map domains to apps, and get one-click HTTPS
- **Database GUI**: browse Postgres, MySQL, and MongoDB tables and run queries
- **App Store**: one-click Docker apps such as Portainer, Uptime Kuma, n8n, and Nextcloud
- **AI assistant**: "why is my server slow?" and "set up nginx for my app", always going through the Command Runner so it is explained, safe, and recordable
- **More distros**: Fedora/RHEL, Alpine, Arch
- **Desktop app**: wrap the web UI with Tauri for a native download
- **Mobile layout**: a basic monitor and terminal on phones

---

## 10. Roadmap after v1 (agreed order)

Sizes are part-time days. "Needs" lists dependencies between milestones. Each milestone: short plan, build, verify
(`typecheck && lint && test`, real-browser check, `pnpm e2e`), update README, CLAUDE.md, PLAN.md and
`docs/HOW_IT_WORKS.md`. New dependencies and downloads over ~20 MB are confirmed with the user first.

| #   | Milestone                                                                                                                                                                                      | Size  | Needs        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------ |
| M11 | ✅ **Job engine**: replay a recipe on another server (progress, retry/skip/abort on failure), recipe parameters, multi-server broadcast. (Recording of file edits moved to a later milestone.) | done  | none         |
| M12 | ✅ Recipe exports (Dockerfile, compose, Ansible), "Clone this server" (Dev Hub tools), recipe files + bundled starter library (no backend: a "community library" is a Git repo of files)       | done  | M11          |
| M13 | **Distros**: package/service-manager abstraction, Fedora/RHEL first (Alpine, Arch as a Dev Hub subset), systemd-capable test containers                                                        | 7–10  | none         |
| M14 | Firewall app, **lockout protection** (server-side auto-revert), undo timeline                                                                                                                  | 7–9   | M13          |
| M15 | Security checkup app, scheduled backups                                                                                                                                                        | 6–8   | M14          |
| M16 | ✅ Learn Mode advanced: lessons, quizzes, skill levels (AI explain is in M23)                                                                                                                  | done  | M10          |
| M17 | ✅ Ports & Domains (nginx sites with rollback; HTTPS via certbot is built but not run against a real domain)                                                                                   | done  | M13          |
| M18 | ✅ Projects (deploy from git, env vars, systemd service, update check). Scheduled auto-redeploy not built.                                                                                     | done  | M17          |
| M19 | ✅ Server Map (domain → site → port → program → project, problems in red)                                                                                                                      | done  | M17, M18     |
| M20 | App Store (Docker apps)                                                                                                                                                                        | 4–5   | M13          |
| M21 | Database GUI (SSH tunnel, `pg` first)                                                                                                                                                          | 7–9   | none         |
| M22 | ✅ Cross-server drag and drop (files; folders not yet)                                                                                                                                         | done  | M11          |
| M23 | AI assistant + AI explain (own key or local model; nothing sent without a per-send preview; only proposes Actions)                                                                             | 8–10  | most Actions |
| M24 | Hosted mode (TLS via a front proxy, login + 2FA, audit log, multi-user)                                                                                                                        | 15–20 | everything   |
| M25 | Mobile layout                                                                                                                                                                                  | 5–7   | M10          |
| M26 | Desktop wrapper (PWA first; Tauri only if the toolchain download is acceptable)                                                                                                                | 2–3   | M25          |

Decisions: AI provider interface with the Anthropic API (user's key, in the vault) and any OpenAI-compatible
endpoint (Ollama = nothing leaves the machine); one `aiGateway` module is the only outbound LLM path. Hosted mode
stages: single admin first, multi-user second, SQLite throughout. Tauri is last and optional.
