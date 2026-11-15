# Security

GFV holds the keys to people's servers, so I take security reports seriously, and I would rather hear about a problem
privately than read about it in a public issue.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Instead use GitHub's private vulnerability reporting on this
repository (the "Report a vulnerability" button on the Security tab). If that is not available to you, contact me
through the email address on my GitHub profile.

Tell me what you found, how to reproduce it, and what you think the impact is. I will reply as soon as I can, usually
within a few days, and I will keep you updated while I fix it. I will credit you in the release notes if you would like
that.

GFV is a young, one-person project, so I cannot promise a bug bounty or a fixed fix time, but I will always treat a
report with care.

## What I consider in scope

Anything that lets someone get at credentials, run commands they should not be able to run, bypass the confirmation
and risk checks, escape the access rules in hosted mode, or read data they should not see. Injection into a shell
command or a configuration file is a bug I want to hear about.

## How GFV protects you, and where it stops

In local mode GFV listens on 127.0.0.1 only and requires a random token on every request. SSH credentials are
encrypted at rest with AES-256-GCM using a key derived from your master password with scrypt, and the master password
is never stored. Host keys are verified the first time you connect, and a changed key is never accepted silently.
Parameters are validated and quoted before they reach a shell. The server enforces the confirmation for risky
actions, not just the interface.

Some honest limits. The Safety Net that watches terminal input is a seatbelt, not a boundary, because shell syntax is
too rich to parse perfectly. The scrubbing of secrets before text is sent to an AI model is pattern based and can
miss a secret in an unusual format, which is why you always see the text before it is sent. Hosted mode has not had
an outside security review, and its TLS depends on the reverse proxy you put in front of it.

## Supported versions

Until there is a 1.0 release, only the latest version on the main branch gets fixes.
