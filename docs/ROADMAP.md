# Roadmap

This is where I think GFV should go next. It is not a promise, it is a list of ideas, and the best way to move
something up the list is to build it or to tell me you need it. Items marked "good first" are small, well-contained
and a nice way to get to know the code. If one interests you, open an issue so we do not both do the same work.

If you want to know what already exists, the [user guide](USER_GUIDE.md) describes it and the
[milestone history](MILESTONES.md) records how it was built and what I could not verify.

## What I want most: more real-world testing

The biggest gap is not a missing feature, it is how little GFV has been used on real servers. I tested the risky
parts carefully against containers and a few real systems, but providers and distributions all behave a little
differently. If you can run GFV against a real VPS and tell me what broke, that helps more than any new feature.
Please note the provider, the distribution and its version.

I also have not run the assistant against the real Anthropic API or a real Ollama install, and hosted mode has not
had a security review. I have only deployed it once behind nginx on a real VPS, so reports from other setups (other
providers, other proxies) are very welcome too.

## Supporting more systems

- Alpine Linux in the Dev Hub (apk and OpenRC). Good first, because the Dev Hub is already organised by package
  manager.
- Arch Linux in the Dev Hub (pacman).
- The Fedora firewall (firewalld) in the Firewall app. Today it only manages ufw.
- Other service managers than systemd, with clear messages instead of failures.

## Making the existing apps deeper

- More apps in the App Store, each pinned to a version and tested for real. Good first: adding one entry to the
  catalogue plus its test.
- MySQL, MariaDB and SQLite in the Database app. PostgreSQL is the only one today.
- Saved queries and a query history in the Database app.
- Backups to somewhere other than the same server (SFTP or S3), and encrypting the archives.
- Scheduled redeploys for Projects, using systemd timers, and webhooks.
- Live log streaming instead of refreshing every couple of seconds.
- Terminal sessions that survive a page reload, for example with a tmux-style layer.
- Recording file edits into recipes (this needs a careful design so secrets are not recorded).
- Copying whole folders between servers, with a progress bar. Good first for the progress bar.
- Window snapping and more wallpapers and themes. Good first.
- An Edit menu for the apps that do not have one yet. Good first.

## Quality and accessibility

- A proper screen-reader pass over the whole interface. I check contrast and keyboard access automatically, but a
  person using assistive technology will find things I cannot.
- Translations. Nothing is translated yet, and the text is spread across components. A first step would be to
  collect it in one place.
- Pinch-to-zoom on the server map on touch screens.
- More browser tests for the paths that are only covered by the API tests today. Good first.

## Hosted mode

- Single sign-on with OpenID Connect.
- Password reset by email, instead of an administrator resetting it.
- Exporting the audit log and a retention setting.
- Letting members use more than the servers they were given, for example recipes of their own, with a proper design
  for who can see what.

## Things I decided not to do

I decided not to build a native wrapper with Tauri. The installable web app covers what I wanted, and a native shell
would add a toolchain I do not want to maintain alone. If you really want one, I am open to a pull request that keeps
it out of the way of the main build.

I am also not planning to turn GFV into a hosted product. It is meant to be software you run yourself.
