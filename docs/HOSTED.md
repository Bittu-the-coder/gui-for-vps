# Running GFV on a server (hosted mode)

By default GFV runs on **your own computer** and only listens on `127.0.0.1`. Hosted mode is for running it on a
server you can reach from anywhere (a laptop, a phone, a teammate). It adds accounts, two-factor authentication,
roles, per-server access and an audit log. **It must sit behind HTTPS.**

## What you get

|                           |                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts                  | Username + password (scrypt-hashed, 12+ characters). The first account is created with a one-time **setup token** printed on the server's console.                                                                                               |
| Two-factor authentication | TOTP (Google Authenticator, Authy, 1Password…) and 8 one-time recovery codes. A code cannot be used twice.                                                                                                                                       |
| Roles                     | **Administrator**: everything, manages accounts, servers, the vault. **Member**: uses only the servers an administrator gave them.                                                                                                               |
| Deny by default           | A member can call only routes that are explicitly listed for members (`MEMBER_RULES` in `server/src/hosted.ts`). A new route is closed to members until someone decides otherwise. A test enumerates every registered route to prove it.         |
| Audit log                 | Sign-ins (and failures), account changes, every change request, file downloads, terminal opens, every action run (id, risk, server) and whether a database query was a read or a write. Never passwords, SQL text, request bodies or keystrokes. |
| Sessions                  | 12 h idle timeout, 7 days at most, `HttpOnly; Secure; SameSite=Strict`, stored hashed, revocable per device. Changing a password signs every device out.                                                                                         |
| Throttling                | After 3 wrong tries per account and address the delay doubles (1 s … 5 min). Unknown accounts cost the same time as wrong passwords.                                                                                                             |

## What it does NOT do

- It does **not terminate TLS itself.** Put it behind a reverse proxy (below). GFV refuses to sign anyone in over plain
  `http://` unless the address is `localhost`, so a mis-configured proxy fails closed.
- One shared **vault** (master password). An administrator unlocks it after each restart; members can then use the
  servers they were given. SSH credentials are never shown to members.
- Recipes, jobs, recording, server management and the AI settings are **administrator-only**.
- No single sign-on (SSO/OIDC), no password reset by email: an administrator resets passwords and 2FA.
- It was tested against local Docker servers and in-process proxies, **not** against a real internet-facing deployment.
  Treat the first deployment as something to review yourself, and keep it behind a VPN or an IP allow-list if you can.

## 1. Start GFV

```bash
# on the server, as a normal user (not root)
npx gfv --hosted --public-url https://gfv.example.com --port 4310
```

It prints a **setup token** once. Keep it for step 3. (`GFV_SETUP_TOKEN=...` sets your own.) By default it listens on
`127.0.0.1` only, so only the proxy on the same machine can reach it. `--host 0.0.0.0` exposes it on every address:
only do that behind a firewall.

As a service (`/etc/systemd/system/gfv.service`):

```ini
[Unit]
Description=GFV (hosted)
After=network-online.target

[Service]
User=gfv
Environment=GFV_HOME=/var/lib/gfv
Environment=GFV_SETUP_TOKEN=put-a-long-random-string-here
ExecStart=/usr/bin/npx gfv --hosted --public-url https://gfv.example.com --port 4310
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/gfv
StateDirectory=gfv
StateDirectoryMode=0700

[Install]
WantedBy=multi-user.target
```

## 2. Put HTTPS in front

**Caddy** (certificates are automatic):

```
gfv.example.com {
    reverse_proxy 127.0.0.1:4310
}
```

**nginx** (with a certificate from certbot):

```nginx
server {
    listen 443 ssl http2;
    server_name gfv.example.com;
    ssl_certificate     /etc/letsencrypt/live/gfv.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gfv.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
        # terminals and live updates are WebSockets
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

The proxy MUST send `X-Forwarded-Proto: https` (GFV trusts it to decide whether sign-in is allowed and to set the
`Secure` cookie) and must be the only thing that can reach port 4310.

## 3. First run

1. Open `https://gfv.example.com`, enter the setup token, choose the administrator's username and password.
2. Create the **master password** (the vault). Add your servers.
3. Open **Account… → Set up 2FA** and store the recovery codes somewhere safe. Do this for every administrator.
4. Open **Users**: create members and tick the servers each may use.

## Operating it

- **Restart:** the vault locks. An administrator signs in and unlocks it.
- **Back up** `GFV_HOME` (`gfv.db` and `auth.key`). `auth.key` encrypts the 2FA secrets: without it, members must re-enrol.
- **Lost phone:** an administrator uses **Users → Reset 2FA**. A lost administrator device: use a recovery code.
- **Locked out entirely:** stop GFV, then run `sqlite3 $GFV_HOME/gfv.db "delete from users"` and start it again to get
  the setup screen (and a new setup token) back. Sessions and access lists go with it; servers and the vault stay.
- **Review the audit log** regularly (Users → Audit log).
