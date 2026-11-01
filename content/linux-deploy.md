---
id: linux-deploy
title: "Deploying to a Linux Server, End to End"
summary: "Takes a fresh Linux VM to a live HTTPS site. Covers locking the server down, publishing framework-dependent vs self-contained, running Kestrel under systemd with a hardened unit, secrets in an environment file, Let's Encrypt certificates that renew themselves, logs with journald, a blue/green deploy script with health checks and instant rollback, database migrations that don't break the running version, Data Protection keys, backups you've actually restored, and monitoring for a single server."
layer: infra
where: Hosting › Linux server deployment
fits: "Puts the [request journey](ch:request-journey) and [nginx](ch:reverse-proxy-nginx) into practice on a real machine. Uses graceful shutdown from [Hosting](ch:aspnet-hosting#application-lifetime-and-graceful-shutdown-what-actually-hap), migrations from [EF Core](ch:efcore-fundamentals#migrations-evolving-the-schema-in-step-with-the-model) and the pipeline from [CI/CD](ch:cicd-iac). Containers come next."
levels: b,i,a
prereqs: other-proxies
next: containers-single-host
---

## The 30-second version

- **Lock the server down first**: a non-root user, SSH keys only, a firewall allowing 22, 80 and 443, and automatic security updates.
- **Publish** the app (`dotnet publish -c Release -r linux-x64`) and copy it to a versioned folder like `/srv/kettle/releases/<git-sha>`.
- **systemd** runs it as a service: starts it on boot, restarts it if it crashes, stops it gracefully, and sends its output to **journald**.
- **nginx** sits in front with a **Let's Encrypt** certificate that certbot renews automatically.
- **Deploy** by starting the new version next to the old one, checking its health, switching nginx over, then stopping the old one. **Rollback** is switching back.
- **Back up** the database every night to somewhere else, and **test restoring** it. Monitor from outside the server.

## Words you'll meet {b}

| Word | Meaning |
|---|---|
| **VM / VPS** | a virtual machine you rent; you get a Linux box and root access |
| **SSH** | the encrypted remote shell you use to manage the server |
| **systemd** | the program that starts and supervises services on almost every Linux distribution |
| **unit** | a systemd config file describing a service, timer or other resource |
| **journald** | systemd's log collector; you read it with `journalctl` |
| **ufw** | "uncomplicated firewall", a simple front end to the Linux firewall on Ubuntu |
| **certbot** | the standard client that gets certificates from Let's Encrypt |
| **RID** | runtime identifier, such as `linux-x64` or `linux-arm64`, the platform you publish for |
| **blue/green** | running two copies (slots) and switching traffic between them to deploy without downtime |
| **RPO / RTO** | how much data you can afford to lose, and how long recovery may take |

## Previously at Kettle {b}

Kettle's beta needs a home. The cloud budget isn't approved yet, so the team rents one Linux VM: 4 cores, 8 GB of RAM, Ubuntu 24.04 LTS, Postgres on the same machine. Everything from the last three episodes has to happen for real.

**The problem:** nobody on the team has taken a .NET app from `dotnet run` to a production Linux server, and a mistake here means downtime or a breach.

**This episode:** every step, in order, with the reasons behind each.

## Start from zero: what "deploying to a server" really means {b}

:::plain
Deploying means: copy your compiled app onto the server, have something start it and keep it running, put nginx in front for HTTPS, and have a safe way to replace it with a new version.
:::

Locally, `dotnet run` compiles and starts the app in your terminal. When you close the terminal, it stops. A server needs four things your laptop doesn't:

1. **A compiled, self-standing copy** of the app (`dotnet publish`), not the source code.
2. **A supervisor** that starts the app when the machine boots, restarts it if it crashes, and stops it cleanly: **systemd**.
3. **A front door** with a real certificate: **nginx** and **Let's Encrypt**.
4. **A repeatable process** for putting new versions out and taking them back: a deploy script, run by CI.

```text
 your laptop / CI                              the server
 ┌──────────────────┐   scp / rsync   ┌──────────────────────────────────────────┐
 │ dotnet publish   │ ──────────────▶ │ /srv/kettle/releases/3f9c2e1/            │
 │  → tar.gz        │                 │        ▲                                 │
 └──────────────────┘                 │ systemd: kettle-api@5001  (Kestrel:5001) │
                                      │        ▲                                 │
 browser ─── HTTPS :443 ─────────────▶│ nginx  (TLS, certbot renews certs)       │
                                      │ postgres (localhost only)                │
                                      └──────────────────────────────────────────┘
```

## Preparing the server {i}

:::plain
Before your app goes anywhere near it, make the server hard to break into: log in with keys rather than passwords, never work as root, and let only web and SSH traffic in.
:::

A new VM is attacked within minutes of getting a public IP; bots try SSH passwords around the clock. Do this first:

```bash
# As root, once: create your own admin user and give it your SSH key
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# SSH: keys only, no root login. Test a new session works BEFORE closing this one.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# Firewall: SSH, HTTP, HTTPS only. Kestrel's ports and Postgres stay unreachable from outside.
ufw allow OpenSSH
ufw allow 'Nginx Full'          # 80 and 443, available once nginx is installed
ufw enable

# Security updates install themselves
apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades

# The account the app runs as: no login shell, no home directory to speak of
useradd --system --no-create-home --shell /usr/sbin/nologin kettle
mkdir -p /srv/kettle/releases /var/lib/kettle /etc/kettle
chown kettle:kettle /var/lib/kettle
```

Why each step matters:

- **No root login, no passwords.** Password guessing is the most common attack on a new server, and SSH keys can't be guessed. Locking out root means an attacker needs both a username and a key.
- **The firewall** is a second wall: even if Kestrel or Postgres were accidentally bound to `0.0.0.0`, nobody outside could reach them.
- **A dedicated `kettle` user** means a bug in the app that lets an attacker run commands gives them only what that user can touch, not the whole machine.
- **Automatic updates** close OS security holes without anyone remembering to. Plan a reboot window for kernel updates (`/var/run/reboot-required` appears when one is needed).
- Also: set the time zone to **UTC** (`timedatectl set-timezone UTC`) so logs from every machine line up, and check time sync is on (`timedatectl` should say "System clock synchronized: yes"). Token validation and TLS both fail when clocks drift.

## Publishing the app {b}

:::plain
`dotnet publish` produces a folder containing everything needed to run the app. You choose whether the .NET runtime is installed on the server separately or bundled inside that folder.
:::

```bash
# Framework-dependent: needs the ASP.NET Core runtime installed on the server
dotnet publish src/Kettle.Api -c Release -r linux-x64 --self-contained false -o out/

# Self-contained: carries its own runtime, nothing to install on the server
dotnet publish src/Kettle.Api -c Release -r linux-x64 --self-contained true -o out/
```

| | Framework-dependent | Self-contained |
|---|---|---|
| Size | small (your DLLs only, a few MB) | larger (~70–100 MB, includes the runtime) |
| Server needs | the matching ASP.NET Core runtime (`apt install aspnetcore-runtime-8.0`) | nothing .NET-related |
| Runtime security patches | `apt upgrade` patches every app at once | you rebuild and redeploy each app |
| Several apps on different .NET versions | each needs its runtime installed | each brings its own |
| Started with | `dotnet Kettle.Api.dll` (or the apphost `./Kettle.Api`) | `./Kettle.Api` |

Kettle chooses **self-contained**: the server stays clean, the exact runtime the tests ran against is the one in production, and a runtime patch arrives with the next deploy, which happens daily anyway. A team with many apps on one server and infrequent deploys might prefer framework-dependent so `apt upgrade` patches them all.

Options worth knowing:

- **`-r linux-arm64`** for ARM servers (often cheaper per core on cloud providers).
- **`-p:PublishReadyToRun=true`** precompiles to native code, so startup is faster at the cost of a bigger output ([How code runs](ch:how-code-runs)).
- **`-p:PublishSingleFile=true`** bundles everything into one executable. Convenient, but it changes how some code finds files: `Assembly.Location` is empty, so use `AppContext.BaseDirectory`.
- Native AOT is a bigger step with real restrictions; see [Performance](ch:performance-engineering).

CI then packs the output: `tar -czf kettle-$GITHUB_SHA.tar.gz -C out .` and copies it to the server. **Build once, deploy the same artifact everywhere**: the file tested in staging is byte-for-byte the file in production.

## Running it as a service with systemd {i}

:::plain
systemd is the part of Linux that starts programs at boot and keeps them running. You describe your app in a small "unit" file and systemd takes care of the rest.
:::

```ini
# /etc/systemd/system/kettle-api.service
[Unit]
Description=Kettle API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=notify
User=kettle
Group=kettle
WorkingDirectory=/srv/kettle/current
ExecStart=/srv/kettle/current/Kettle.Api
EnvironmentFile=/etc/kettle/kettle.env
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=ASPNETCORE_URLS=http://127.0.0.1:5000
Environment=DOTNET_PRINT_TELEMETRY_MESSAGE=false
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=45
SyslogIdentifier=kettle-api
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/kettle
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Line by line:

- **`After=` / `Wants=`**: start once the network (and local Postgres) is up. `After` only orders startup; it doesn't make Postgres a hard requirement, so the app still starts and its health check reports the database problem.
- **`Type=notify`**: systemd waits until the app *says* it has started before marking it "active". The app says so through `builder.Services.AddSystemd()` (package `Microsoft.Extensions.Hosting.Systemd`), which also formats console logs for journald and wires `SIGTERM` to graceful shutdown. Without it, use `Type=simple` and systemd assumes the app is ready the moment the process starts.
- **`User=kettle`**: never run the app as root.
- **`EnvironmentFile=`**: secrets come from a file only root and the service can read (next section).
- **`ASPNETCORE_URLS=http://127.0.0.1:5000`**: Kestrel listens only on the loopback interface, so only nginx on the same machine can reach it.
- **`Restart=always` / `RestartSec=5`**: if the app crashes, start it again after 5 seconds. systemd gives up if it fails repeatedly in a short window (the defaults allow 5 starts in 10 seconds), so a crash loop doesn't spin forever.
- **`KillSignal=SIGTERM` / `TimeoutStopSec=45`**: on stop, systemd sends `SIGTERM`, the .NET host begins graceful shutdown (stop accepting connections, finish in-flight requests, stop hosted services), and systemd waits up to 45 seconds before sending `SIGKILL`.
- **The sandboxing lines** (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, `ReadWritePaths`): the app sees a read-only filesystem except `/var/lib/kettle`, gets its own private `/tmp`, can't see home directories, and can't gain privileges. If an attacker gets code running inside the app, there's little they can change. `systemd-analyze security kettle-api` scores a unit and suggests more settings.
- **`LimitNOFILE=65535`**: every connection is a file descriptor; the default limit (1024 on some systems) is too low for a busy service.

:::gotcha Three shutdown timeouts must agree
The host's own `HostOptions.ShutdownTimeout` (30 seconds by default) must be **shorter** than systemd's `TimeoutStopSec`, which must be shorter than anything above it that waits, such as a deploy script or a cloud platform's grace period. If systemd's timeout is shorter, it kills the app mid-shutdown: in-flight requests fail and background work stops halfway. Kettle: host 30 s < systemd 45 s.
:::

Using it:

```bash
sudo systemctl daemon-reload            # after creating or editing any unit file
sudo systemctl enable --now kettle-api  # start now, and at every boot
systemctl status kettle-api             # running? since when? last few log lines
sudo systemctl restart kettle-api
```

## Configuration and secrets on the server {i}

:::plain
The connection string and API keys go in a file that only root and the app can read. systemd turns each line into an environment variable, and ASP.NET Core reads environment variables as configuration.
:::

```bash
# /etc/kettle/kettle.env   owned root:kettle, mode 640
ConnectionStrings__Main=Host=127.0.0.1;Database=kettle;Username=kettle_app;Password=...
Payments__ApiKey=sk_live_...
Jwt__SigningKey=...
```

- **The double underscore** `__` stands for the `:` separator, so `ConnectionStrings__Main` becomes `ConnectionStrings:Main` ([Configuration](ch:configuration-options)).
- **Permissions:** `sudo chown root:kettle /etc/kettle/kettle.env && sudo chmod 640 /etc/kettle/kettle.env`. Root can write it, the app's group can read it, nobody else can see it.
- **Keep it out of the release folder**, so a deploy never overwrites it and it never ends up in an artifact or a git repository.
- **Never put secrets in `appsettings.Production.json`**: that file is in source control and in every build artifact. Settings that are not secret (log levels, feature defaults) belong there.
- Once Kettle moves to a cloud, a secret manager (Key Vault and managed identity) replaces this file ([Identity & secrets](ch:azure-identity-secrets)).

The database follows the same rules: Postgres listens on `127.0.0.1` only, and the app's user `kettle_app` gets only the rights it needs (read and write data, not drop tables). Migrations run as a separate, more privileged user during the deploy.

## HTTPS with Let's Encrypt {i}

:::plain
Let's Encrypt gives free certificates that last 90 days. certbot proves to Let's Encrypt that you control the domain, saves the certificate, and renews it automatically before it expires.
:::

1. **Point DNS at the server**: an `A` record (and `AAAA` for IPv6) for `kettle.example`.
2. **Serve the challenge folder** over plain HTTP. The port-80 server block from [the nginx chapter](ch:reverse-proxy-nginx#kettles-production-config-line-by-line) already has `location /.well-known/acme-challenge/ { root /var/www/certbot; }`.
3. **Get the certificate:**

```bash
sudo apt install certbot
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d kettle.example -d www.kettle.example \
     --email ops@kettle.example --agree-tos --no-eff-email
# Certificate:  /etc/letsencrypt/live/kettle.example/fullchain.pem
# Private key:  /etc/letsencrypt/live/kettle.example/privkey.pem
```

4. **Make renewals reload nginx.** certbot installs a systemd timer that tries renewal twice a day and renews when fewer than 30 days remain. nginx keeps using the old certificate until it reloads, so add a deploy hook:

```bash
echo -e '#!/bin/sh\nsystemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run      # proves the whole renewal path works
```

**How the challenge works:** certbot asks Let's Encrypt for a certificate; Let's Encrypt replies with a random token; certbot writes it to `/var/www/certbot/.well-known/acme-challenge/<token>`; Let's Encrypt fetches `http://kettle.example/.well-known/acme-challenge/<token>` from the internet. If it gets the token back, you control the domain. That's why port 80 must stay open and must not redirect that path away.

:::gotcha Things that break certificates
- **Rate limits:** Let's Encrypt allows a limited number of certificates per domain per week. Experiment with `--staging` (or `--dry-run`) first.
- **Wildcards** (`*.kettle.example`) need the **DNS challenge**: certbot creates a TXT record through your DNS provider's API plugin.
- **The renewal never reloads nginx**, so the old certificate expires in production even though a new one is on disk. The deploy hook above prevents it, and an external expiry check (below) catches it.
:::

## Logs with journald {i}

:::plain
Everything the app writes to the console ends up in the systemd journal. `journalctl` lets you read, follow and search it.
:::

```bash
journalctl -u kettle-api -f                       # follow live, like tail -f
journalctl -u kettle-api --since "10 min ago"
journalctl -u kettle-api -p err --since today     # errors and worse only
journalctl -u kettle-api -o json-pretty -n 5      # with all structured fields
journalctl -u nginx -u kettle-api --since "2026-11-01 14:00" --until "14:05"   # both, interleaved
```

Make the journal survive reboots and cap its size, in `/etc/systemd/journald.conf`: `Storage=persistent` and `SystemMaxUse=2G`.

journald is good for "what is this one server doing right now". It's not enough on its own: when the disk dies, the logs go with it, and you can't search across servers. Ship logs off the machine as well, with OpenTelemetry or Serilog to a central store ([Observability](ch:observability-aspire), [Structured logging](ch:errors-logging#structured-logging-keeping-the-data-not-just-the-sentence)).

## Zero-downtime deploys {a}

:::plain
Restarting the app means a few seconds when nothing answers. Instead, start the new version next to the old one, check it works, tell nginx to send traffic to it, and only then stop the old one.
:::

**Why a plain restart drops requests:** `systemctl restart` stops the old process (in-flight requests finish, but new connections are refused while it shuts down), then starts the new one, which takes a few seconds to start, warm up and connect to the database. During that gap nginx returns **502**. For a beta, maybe acceptable. For a shop taking orders, no.

**Blue/green on one server.** Run the app as a **template unit**, `kettle-api@.service`: the same unit as above, with the port taken from the instance name. `%i` is the text after the `@`, so `kettle-api@5001` and `kettle-api@5002` are two instances:

```ini
# /etc/systemd/system/kettle-api@.service  (only the lines that differ)
Description=Kettle API on port %i
WorkingDirectory=/srv/kettle/slot-%i
ExecStart=/srv/kettle/slot-%i/Kettle.Api
Environment=ASPNETCORE_URLS=http://127.0.0.1:%i
SyslogIdentifier=kettle-api-%i
```

nginx's upstream moves into its own small file, which the deploy rewrites:

```nginx
# /etc/nginx/snippets/kettle-upstream.conf   included from the http block
upstream kettle_api {
    server 127.0.0.1:5001;
    keepalive 32;
}
```

The deploy script, run on the server by CI over SSH:

```bash
#!/usr/bin/env bash
# deploy.sh <git-sha>  : blue/green deploy of Kettle on one server
set -euo pipefail

SHA="$1"
ARTIFACT="/tmp/kettle-${SHA}.tar.gz"           # uploaded by CI before this runs
UPSTREAM=/etc/nginx/snippets/kettle-upstream.conf

# 1. Which slot is live? The upstream file names its port.
LIVE=$(grep -oE '127\.0\.0\.1:[0-9]+' "$UPSTREAM" | cut -d: -f2)
if [[ "$LIVE" == 5001 ]]; then IDLE=5002; else IDLE=5001; fi
echo "live slot: $LIVE, deploying $SHA to: $IDLE"

# 2. Unpack the new release into its own folder and point the idle slot at it.
RELEASE="/srv/kettle/releases/${SHA}"
mkdir -p "$RELEASE"
tar -xzf "$ARTIFACT" -C "$RELEASE"
ln -sfn "$RELEASE" "/srv/kettle/slot-${IDLE}"

# 3. Start it and wait until it says it's ready.
systemctl restart "kettle-api@${IDLE}"
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${IDLE}/health/ready" >/dev/null; then break; fi
  if [[ $i == 30 ]]; then
    echo "new release never became ready; live slot untouched" >&2
    systemctl stop "kettle-api@${IDLE}"
    exit 1
  fi
  sleep 2
done

# 4. Switch traffic: rewrite the upstream, test, reload (graceful).
printf 'upstream kettle_api {\n    server 127.0.0.1:%s;\n    keepalive 32;\n}\n' "$IDLE" > "$UPSTREAM"
nginx -t
systemctl reload nginx

# 5. Let in-flight requests on the old slot finish, then stop it.
sleep 30
systemctl stop "kettle-api@${LIVE}"

# 6. Keep the last five releases for rollback.
ls -1dt /srv/kettle/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "deployed $SHA on $IDLE"
```

What makes it safe:

- **The old version keeps serving** until the new one has passed its readiness check. A release that can't start, can't reach the database or fails its checks never receives a single request.
- **`nginx -t` before reload**: if the rewritten file were somehow invalid, `set -e` stops the script and nginx keeps running with the old config.
- **`reload` is graceful**: nginx starts new workers with the new upstream, while old workers finish the requests they already have.
- **`set -euo pipefail`**: any failing command, unset variable or failed pipe stops the script instead of carrying on in a half-deployed state.
- **The readiness endpoint matters.** `/health/ready` should check the database and anything else the app can't work without, and only report ready once startup work (cache warm-up, migrations check) is done ([Resilience](ch:resilience#health-checks)).
- The old slot's process is still on disk and its release folder is still there, which makes rollback trivial.

In CI, the deploy job is three commands: copy the artifact (`scp kettle-$SHA.tar.gz deploy@server:/tmp/`), run `ssh deploy@server sudo /usr/local/bin/deploy.sh $SHA`, then run smoke tests against the public URL. Give the `deploy` user `sudo` rights for that one script only (a line in `/etc/sudoers.d/`), not general root.

### Database changes during a deploy

For the 30 seconds both versions are running, and for the whole time a rollback might be needed, **the old code and the new code share one database**. So a migration must not break the old code:

- **Expand, then contract.** To rename a column: release 1 adds the new column and writes to both; a backfill copies old data; release 2 reads from the new column; release 3 drops the old one. Each step is safe for the version before it.
- **Never in one release:** drop or rename a column the running version uses, or add a `NOT NULL` column without a default.
- **Run migrations as a separate step before switching**, as a privileged database user, using an EF Core migration bundle (`dotnet ef migrations bundle`) or idempotent SQL script. Not at app startup: with two instances starting, both would race to migrate ([CI/CD: databases in the pipeline](ch:cicd-iac#databases-in-the-pipeline)).
- **Large tables:** adding an index or column can lock the table. In Postgres, use `CREATE INDEX CONCURRENTLY` and add columns as nullable first.

## Rolling back {i}

Because the previous release is still on disk and its slot is ready to start, rollback is the deploy in reverse:

```bash
# rollback.sh : send traffic back to the other slot
systemctl start "kettle-api@${PREVIOUS}"     # its symlink still points at the old release
# ...same readiness loop as deploy.sh...
# rewrite the upstream to ${PREVIOUS}, nginx -t, reload, stop the bad slot
```

It takes seconds and needs no build. Two conditions keep it possible: the database is still compatible with the old version (expand/contract), and the release folders are kept (the script keeps five). **Practise it** in staging, so the first rollback isn't during an incident.

## State that lives on the server {a}

A server isn't only the app. Everything below must survive a deploy, and ideally the loss of the server:

- **Data Protection keys.** ASP.NET Core encrypts auth cookies, antiforgery tokens and TempData with keys it generates. By default on Linux they go in the user's home folder, or **only in memory** if there isn't one, which is the case for the `kettle` system user with `ProtectHome=true`. Then every restart logs everyone out. Persist them to a folder the service can write:

  ```csharp norun
  builder.Services.AddDataProtection()
      .SetApplicationName("kettle")                                   // the same in both slots, so they share keys
      .PersistKeysToFileSystem(new DirectoryInfo("/var/lib/kettle/dp-keys"));
  ```

  Both slots must use the same keys and application name, or a user switched from blue to green gets logged out. With more than one server, store keys in a shared place (a database table via `PersistKeysToDbContext`, Redis, or Blob Storage) and protect them at rest.
- **Uploaded files.** Keep them in `/var/lib/kettle/uploads` (outside the release folders), or better, in object storage.
- **The database**, which brings us to backups.

## Backups you've actually restored {i}

:::plain
A backup only counts if you've restored it. Copy the database off the server every night, keep several days of copies, and regularly practise restoring one.
:::

A systemd **timer** runs the backup every night (timers are systemd's replacement for cron, with logs in the journal and catch-up if the server was off):

```ini
# /etc/systemd/system/kettle-backup.service
[Unit]
Description=Nightly Kettle database backup

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/local/bin/kettle-backup.sh
```

```ini
# /etc/systemd/system/kettle-backup.timer
[Unit]
Description=Run the Kettle backup every night

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
#!/usr/bin/env bash
# /usr/local/bin/kettle-backup.sh
set -euo pipefail
FILE="/var/backups/kettle/kettle-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --file="$FILE" kettle          # compressed, restorable table by table
rclone copy "$FILE" offsite:kettle-backups/            # off this machine: object storage in another region
find /var/backups/kettle -name '*.dump' -mtime +7 -delete
curl -fsS https://hc.example/ping/kettle-backup        # "dead man's switch": alert if this ping doesn't arrive
```

Enable it with `systemctl enable --now kettle-backup.timer`; `systemctl list-timers` shows when it runs next.

The rules behind it:

- **Off the server.** A backup on the same disk dies with the disk, or with an attacker who has the server. Copy it to object storage in another region or provider, ideally with object lock (immutability) so ransomware can't delete it.
- **Know your RPO.** A nightly dump means up to 24 hours of orders lost. If that's too much, add continuous WAL archiving (Postgres point-in-time recovery, with tools such as pgBackRest), or use a managed database that does it for you.
- **Test restores.** Once a month, restore last night's dump into a scratch database (`pg_restore --dbname=kettle_restore_test ...`) and run a few queries. Time it: that's your real RTO.
- **Alert on missing backups.** The ping at the end of the script reaches a monitoring service, which alerts if a night passes without it. Backups that silently stopped months ago are the classic disaster.

## Monitoring one server {i}

You can't watch a server all day, so have something watch it and tell you:

| Check | How | Why |
|---|---|---|
| Is the site up? | an **external** uptime check of `https://kettle.example/health/live` every minute | checks DNS, TLS, nginx and the app together, from where users are |
| Certificate expiry | uptime tools alert at 14 days left | catches a renewal that silently failed |
| Disk space | alert at 80% | full disks stop Postgres and logging, and can corrupt data |
| Memory, CPU, load | node exporter + Prometheus, or the provider's agent | finds leaks and capacity problems before they're outages |
| App metrics and traces | OpenTelemetry to a backend | request rates, errors, latency ([Observability](ch:observability-aspire)) |
| Backups ran | the dead man's switch above | the failure nobody notices otherwise |
| Security updates and reboots | unattended-upgrades mail, `/var/run/reboot-required` | patched servers |

Send alerts somewhere someone will see them (chat or phone), and only for things that need a human to act. Alerts that fire all the time get ignored.

## The honest limits of one server {a}

One server is simple, cheap and fast, and plenty for many products. Know what you're accepting:

- **It's a single point of failure.** Hardware failure, a bad kernel update or a full disk takes everything down. RTO is "build a new server and restore", so script the setup (Ansible, cloud-init, or at least a written runbook) and rehearse it.
- **Scaling is vertical**: a bigger VM. That goes surprisingly far for a .NET app, but the database and the app compete for the same CPU and memory.
- **The next steps up**, in order: move the database to a managed service (backups and failover handled for you); add a second app server behind a load balancer (Data Protection keys and uploads must then be shared); then containers and a platform ([Containers on one host](ch:containers-single-host), then [Azure compute](ch:azure-compute) or [Kubernetes](ch:kubernetes)).

## Interview questions {i}

:::qa How would you deploy an ASP.NET Core app to a Linux VM?
Publish (often self-contained for a specific RID), copy the artifact to a versioned release folder, run it under systemd as a dedicated non-root user with Kestrel bound to localhost, and put nginx in front for TLS with Let's Encrypt certificates renewed by certbot. Secrets come from a restricted environment file or a secret manager. Deploys go through CI, with health checks before traffic switches and a quick rollback path.
:::

:::qa How do you deploy with zero downtime on a single server?
Run two instances (blue/green) on different localhost ports. Start the new version on the idle port, wait for its readiness check, switch nginx's upstream and reload (graceful), give in-flight requests time to finish on the old instance, then stop it. Database migrations must be backward compatible (expand/contract), so the old and new code can share the database during the switch and after a rollback.
:::

:::qa What happens when systemd stops a .NET app?
systemd sends SIGTERM. With the systemd integration, the .NET host triggers graceful shutdown: it stops accepting new connections, lets in-flight requests finish, and stops hosted services, up to `HostOptions.ShutdownTimeout`. If the process hasn't exited when systemd's `TimeoutStopSec` expires, systemd sends SIGKILL. The host's timeout should be shorter than systemd's.
:::

:::qa Why do users get logged out after every deploy, and how do you fix it?
The Data Protection keys that encrypt auth cookies aren't persisted, so each new process generates new keys and can't read existing cookies. This happens when keys are only in memory (a service user without a home folder) or each instance has its own. Persist the keys to shared storage, protect them at rest, and set the same application name everywhere.
:::

:::qa What makes a backup strategy trustworthy?
Backups are copied off the server (ideally immutable), match the business's RPO (nightly dumps, or continuous WAL archiving for point-in-time recovery), raise an alert when they don't run, and are restored regularly as a test, which also measures the real RTO.
:::

## Next episode {b}

Kettle is live on one server. But the server has a .NET app, nginx, Postgres and a growing list of things installed by hand, and the staging server has drifted from production. "It works on my server" is the new "it works on my machine". Next: package the app, with its exact runtime, as a container image. [Episode 5 · Ship the whole box →](ch:docker)

## Further reading

- [Host ASP.NET Core on Linux with nginx](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/linux-nginx)
- [.NET application publishing overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/)
- [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) and [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) reference
- [Let's Encrypt: how it works](https://letsencrypt.org/how-it-works/)
- [Configure ASP.NET Core Data Protection](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview)
- [PostgreSQL: backup and restore](https://www.postgresql.org/docs/current/backup.html)
