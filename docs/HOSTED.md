# Running GFV on a server (hosted mode)

By default GFV runs on your own computer and only listens on `127.0.0.1`. I added hosted mode for the case where you
want to run it on a server and reach it from anywhere, from a laptop, a phone, or together with a teammate. It adds
accounts, two-factor authentication, roles, per-server access and an audit log. It has to sit behind HTTPS.

I want to be straight about its status before you rely on it. I tested the sign-in, the roles and the access rules
thoroughly, including a test that walks every route the server registers. I have also set it up once on a real Azure VPS
behind nginx and a Let's Encrypt certificate, following the steps below, and it worked. That is a single deployment, and
nobody else has reviewed its security. Please read this page, review the code in
`server/src/hosted.ts` and `server/src/services/auth/users.ts`, and keep it behind a VPN or an IP allow-list if you
can.

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
- It was tested against local Docker servers and in-process proxies, and set up once on a real internet-facing VPS.
  Treat your deployment as something to review yourself, and keep it behind a VPN or an IP allow-list if you can.

## Before you start

You need a VPS (Ubuntu or Debian is what I used) that you can SSH into, and a domain name that points at it. A paid
`.com` or `.io` works the same way as a free one. The free options I know that work:

- **DuckDNS** (`yourname.duckdns.org`): free and stable. This is what I used.
- **sslip.io** (`203-0-113-5.sslip.io` points to `203.0.113.5` automatically): no signup, but its shared Let's Encrypt
  limits can make certificates fail.

With DuckDNS: sign in at duckdns.org, add a subdomain, and put your **VPS's public IP** in the "current ip" box. Careful:
DuckDNS can pre-fill the address of the computer you are browsing from. Check what the VPS thinks its address is with
`curl -4 ifconfig.me` on the VPS, and compare it with `nslookup yourname.duckdns.org`. If they differ, certificates will
fail with a timeout (this happened to me).

In the cloud firewall of the VPS (on Azure, the **Network Security Group** under Networking), allow inbound TCP **22,
80 and 443**. Do not open 4310: only nginx on the same machine should reach it. If the VPS also runs `ufw`, allow 22
first, then 80 and 443.

I use `gfv.example.com` below. Replace it with your own name everywhere.

## 1. Install and start GFV

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx build-essential python3 curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs                 # check: node -v shows 22 or newer

sudo npm install -g gui-for-vps            # a couple of minutes: it builds a native module
gfv --version

sudo useradd --system --create-home --shell /usr/sbin/nologin gfv
sudo mkdir -p /var/lib/gfv && sudo chown gfv:gfv /var/lib/gfv && sudo chmod 700 /var/lib/gfv
openssl rand -hex 24                       # your setup token: keep it for step 3
```

Run it as a service (`/etc/systemd/system/gfv.service`). `--public-url` must match **exactly** the address you will type
in the browser: https, no trailing slash.

```ini
[Unit]
Description=GFV (hosted)
After=network-online.target

[Service]
User=gfv
Environment=GFV_HOME=/var/lib/gfv
Environment=GFV_SETUP_TOKEN=put-the-token-from-above-here
ExecStart=/usr/bin/gfv --hosted --no-open --public-url https://gfv.example.com --port 4310
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/gfv

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gfv
sudo systemctl status gfv                        # active (running)
curl -s http://127.0.0.1:4310/api/health         # answers from the VPS itself
```

If `/usr/bin/gfv` does not exist, run `which gfv` and use that path. By default GFV listens on `127.0.0.1` only, so only
the proxy on the same machine can reach it. `--host 0.0.0.0` exposes it on every address: only do that behind a
firewall.

## 2. Put nginx and HTTPS in front

The proxy MUST send `X-Forwarded-Proto: https` (GFV trusts it to decide whether sign-in is allowed and to set the
`Secure` cookie) and must be the only thing that can reach port 4310. First a plain HTTP site, which certbot then
upgrades. Create `/etc/nginx/sites-available/gfv`:

```nginx
server {
    listen 80;
    server_name gfv.example.com;

    client_max_body_size 1g;          # uploads from the Files app

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
        proxy_request_buffering off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/gfv /etc/nginx/sites-enabled/gfv
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d gfv.example.com          # choose the option to redirect HTTP to HTTPS
sudo certbot renew --dry-run                     # renewal is automatic; this proves it works
```

**Caddy** is an alternative with automatic certificates: a file with
`gfv.example.com { reverse_proxy 127.0.0.1:4310 }` is all it needs.

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

## Adding servers, including the one GFV runs on

GFV manages machines over SSH, so the VPS it runs on is not special: you add it in the **Servers** app like any other.
As your normal login user on that VPS (not `gfv`):

```bash
ssh-keygen -t ed25519 -N "" -f ~/gfv_key
cat ~/gfv_key.pub >> ~/.ssh/authorized_keys
cat ~/gfv_key                      # paste this private key into GFV
```

Add a server with host `127.0.0.1`, port 22, your username and that key, and approve the fingerprint. Then delete the
files (`shred -u ~/gfv_key ~/gfv_key.pub`) so only GFV's encrypted copy remains. For other VPSes, make a new key, put
its `.pub` line in that server's `~/.ssh/authorized_keys`, and use that server's public address. Be careful with
firewall changes on the machine GFV itself runs on: the lockout protection works there too, but cutting SSH also cuts GFV.

## Updating

```bash
sudo npm install -g gui-for-vps@latest
sudo systemctl restart gfv
```

Then an administrator signs in and unlocks the vault again.

## Troubleshooting

| Symptom                               | What to check                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Certbot says "Timeout during connect" | The domain points at a different IP than the VPS (compare `curl -4 ifconfig.me` and `nslookup`), or port 80 is not open in the cloud firewall |
| 502 Bad Gateway                       | `sudo systemctl status gfv` and `sudo journalctl -u gfv -n 50`                                                                                |
| Sign-in says HTTPS is required        | The `X-Forwarded-Proto https` line is missing in nginx                                                                                        |
| A terminal opens and then dies        | The `Upgrade` and `Connection` lines are missing in nginx                                                                                     |
| Sign-in loops or says "bad origin"    | `--public-url` does not match the address in the browser                                                                                      |
| Large uploads fail                    | Raise `client_max_body_size` in the nginx site                                                                                                |
| Editor or Users app not in the Dock   | By design: the Editor opens from a file in **Files**, and Users is for administrators only                                                    |
