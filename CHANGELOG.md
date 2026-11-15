# Changelog

All notable changes to GFV are listed here. I follow semantic versioning loosely while the project is young:
until 1.0, a minor version can change things.

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
- Hosted mode has not been put behind a real TLS proxy on the internet, and nobody has reviewed its security except me.
