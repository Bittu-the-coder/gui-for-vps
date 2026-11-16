# Changelog

All notable changes to GFV are listed here. I follow semantic versioning loosely while the project is young:
until 1.0, a minor version can change things.

## 0.2.0

- License change: GFV is now released under the GNU Affero General Public License v3.0 (AGPL-3.0-only), with a
  commercial license available for uses the AGPL does not fit (see `COMMERCIAL-LICENSE.md`). Versions 0.1.0 and 0.1.1
  were released under the MIT license and remain available under it.
- Contributions are accepted under the AGPL, and contributors grant the maintainer the right to also offer their work
  under a commercial license (see `CONTRIBUTING.md`).

## 0.1.1

- The npm package is `gui-for-vps`, because npm refused the name `gfv` as too similar to existing packages. It now
  installs both a `gui-for-vps` and a `gfv` command, so `npx gui-for-vps` works.
- `gfv --version` reports the right version from the published package.
- Connection errors say what to check (timeouts, refused connections, unknown hosts, no route) instead of showing the
  raw SSH message.
- Integration tests skip cleanly when the Docker test servers or their key are missing, so CI on a fresh clone is green.
- Docs: a step-by-step guide for running hosted mode on a VPS behind nginx with a free domain, tested on a real Azure
  VPS.

## 0.1.0

This is the first public release. I built it over several months, and I tested the risky parts against real systems
instead of mocks, so I want to be clear about what is in it and what is not proven yet.

What is in it:

- A browser desktop with windows, a Dock, Spotlight and Mission Control, in light and dark themes
- Terminal, file manager, editor, monitor, services and Docker views, over SSH
- Dev Hub for one-click installs, and a Safety Net that asks before anything risky runs
- Snapshots of files before they change, with diffs and one-click restore
- Recipes you can record, export (bash, Ansible, Dockerfile, Compose), share and replay on several servers
- Network, Projects and a Server Map for websites and apps
- A firewall app with lockout protection: a timer on the server undoes a change if GFV can no longer connect
- A security checkup, scheduled backups, an App Store, a database browser and an optional assistant
- A phone layout and an installable app
- Hosted mode, with accounts, two-factor authentication, roles and an audit log

What I have not proven:

- I have not used GFV on many different real servers. Ubuntu and Debian are the main targets, and Fedora is partly
  supported.
- I have not run the assistant against the real Anthropic API or a real Ollama server.
- Hosted mode has been set up once on a real Azure VPS behind nginx and Let's Encrypt (the steps in `docs/HOSTED.md`),
  but nobody has reviewed its security except me.
