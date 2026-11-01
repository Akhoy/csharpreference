---
id: containers-single-host
title: "Containers in Production on One Host"
summary: "Runs Kettle's whole stack (Caddy, the API, a worker, Postgres) with Docker Compose on one server. Covers a production compose file line by line, health checks and depends_on conditions, restart policies, volumes for data that must survive, secrets, resource limits, log rotation, deploying by image tag from a registry, migrations as a one-off container, rolling back, backups, and where Compose stops being enough."
layer: infra
where: Hosting › Containers on one host
fits: "Builds on [Docker](ch:docker) (images and local compose) and replaces the hand-installed server from [Linux deployment](ch:linux-deploy). The same images later run on [Container Apps](ch:azure-compute) or [Kubernetes](ch:kubernetes)."
levels: i,a
prereqs: linux-deploy
next: prod-config
---

## The 30-second version

- Package each part of the system as an **image**, and describe how they run together in **`compose.yaml`**. The server needs only Docker installed.
- CI builds and pushes images **tagged with the git SHA**. Deploying means changing the tag and running `docker compose up -d`; rolling back means changing it back.
- In production, add what local compose files skip: **health checks**, `restart: unless-stopped`, **named volumes** for data, **secrets**, **resource limits**, **log rotation**, and no ports open except the proxy's.
- Run **migrations as a one-off container** before starting the new version.
- Compose on one host has no automatic failover or rolling updates across machines. That's the job of Container Apps or Kubernetes.

## Previously at Kettle {b}

Kettle's API is now an image ([last episode](ch:docker)). But the server around it is still built by hand: the staging server has a different Postgres version, someone installed an extra package in production that nobody remembers, and the new worker service needs its own systemd unit, user and deploy script.

**The problem:** the server is a pet. Every change is manual and the environments drift apart.

**This episode:** the server runs only Docker. Everything else is described in one file, in version control, identical on staging and production.

## Start from zero: what changes with containers {b}

:::plain
Instead of installing .NET, nginx and Postgres on the server, you run each one as a container. A single file lists them all, and one command starts or updates everything.
:::

| | Hand-built server ([last episode](ch:linux-deploy)) | Docker Compose |
|---|---|---|
| What's installed on the server | runtime, nginx, Postgres, certbot, tools | Docker only |
| How the app is shipped | a tarball copied over SSH | an image pulled from a registry |
| What describes the setup | systemd units, nginx files, notes | `compose.yaml` in git |
| Staging vs production | drift over time | the same file, different `.env` |
| Rolling back | switch slot, if the old release is kept | change the image tag |
| Adding a service | new user, unit, folders, deploy script | a few lines of YAML |

The [Docker chapter](ch:docker) covered images and using compose on a laptop. A production compose file differs in what it adds: health checks, restart policies, volumes, secrets, limits and log handling.

## Kettle's production compose file, line by line {i}

```yaml
# /srv/kettle/compose.yaml
name: kettle

services:
  proxy:
    image: caddy:2.8
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"                      # HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data                   # certificates: must survive restarts
      - caddy_config:/config
    depends_on:
      api:
        condition: service_healthy
    logging: &default-logging
      driver: json-file
      options: { max-size: "20m", max-file: "5" }

  api:
    image: ghcr.io/kettle/api:${KETTLE_VERSION:?set KETTLE_VERSION}
    restart: unless-stopped
    environment:
      ASPNETCORE_ENVIRONMENT: Production
      ASPNETCORE_HTTP_PORTS: "8080"
    secrets:                               # mounted as files under /run/secrets/
      - source: app_db_connection
        target: ConnectionStrings__Main    # file name = configuration key
      - source: payments_api_key
        target: Payments__ApiKey
    volumes:
      - dp_keys:/var/lib/kettle/dp-keys    # Data Protection keys survive new containers
    healthcheck:
      test: ["CMD", "/app/healthcheck", "http://localhost:8080/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
    stop_grace_period: 45s
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits: { cpus: "2.0", memory: 1g }
    logging: *default-logging

  worker:
    image: ghcr.io/kettle/worker:${KETTLE_VERSION:?set KETTLE_VERSION}
    restart: unless-stopped
    environment:
      DOTNET_ENVIRONMENT: Production
    secrets:
      - source: app_db_connection
        target: ConnectionStrings__Main
    stop_grace_period: 60s
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512m }
    logging: *default-logging

  db:
    image: postgres:16.4
    restart: unless-stopped
    environment:
      POSTGRES_DB: kettle
      POSTGRES_USER: kettle_admin
      POSTGRES_PASSWORD_FILE: /run/secrets/db_admin_password
    secrets:
      - db_admin_password
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./db-init:/docker-entrypoint-initdb.d:ro   # first start only: creates the kettle_app user
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kettle_admin -d kettle"]
      interval: 5s
      timeout: 3s
      retries: 10
    shm_size: 256m
    deploy:
      resources:
        limits: { memory: 3g }
    logging: *default-logging

volumes:
  caddy_data:
  caddy_config:
  dp_keys:
  pg_data:

secrets:
  db_admin_password:
    file: ./secrets/db_admin_password.txt
  db_admin_connection:
    file: ./secrets/db_admin_connection.txt
  app_db_connection:
    file: ./secrets/app_db_connection.txt     # Host=db;Database=kettle;Username=kettle_app;Password=...
  payments_api_key:
    file: ./secrets/payments_api_key.txt
```

And the whole proxy configuration:

```text
# /srv/kettle/Caddyfile
kettle.example {
    encode zstd gzip
    reverse_proxy api:8080
}
```

The decisions in that file:

- **Only the proxy publishes ports.** `api`, `worker` and `db` have no `ports:` section, so they're reachable only on the private network Compose creates for this project, where services find each other by name (`api:8080`, `db:5432`). Publishing Postgres "just for debugging" is a classic way to get a database ransomed: Docker's published ports **bypass ufw** on many setups, because Docker writes its own firewall rules.
- **`image:` with a version variable**, never `build:` and never `:latest`. The server runs exactly the image CI built and tested. `${KETTLE_VERSION:?…}` makes Compose refuse to start if the version isn't set, instead of silently pulling something else.
- **`restart: unless-stopped`** brings containers back after a crash or a reboot (Docker itself must be enabled: `systemctl enable docker`), but respects a deliberate `docker compose stop`.
- **Health checks and `depends_on: condition: service_healthy`**: the API starts only once Postgres accepts connections, and Caddy only once the API reports ready. Plain `depends_on` only waits for the container to *start*, not to be ready.
- **`stop_grace_period`** is Docker's version of systemd's `TimeoutStopSec`: Docker sends SIGTERM, waits this long, then SIGKILL. It defaults to **10 seconds**, which is too short for an API draining requests or a worker finishing a message. Keep it longer than `HostOptions.ShutdownTimeout`.
- **Named volumes** (`pg_data`, `caddy_data`, `dp_keys`) hold everything that must survive a new container: the database files, the certificates, and the Data Protection keys. Lose `caddy_data` and Caddy requests new certificates on every start, quickly hitting Let's Encrypt's rate limits.
- **Log rotation.** Docker's default `json-file` logs grow forever until the disk fills. `max-size` and `max-file` cap them at 100 MB per container. The `&default-logging` / `*default-logging` pair is a YAML anchor so the setting is written once.
- **Resource limits** stop one service from starving the others: a memory leak in the worker kills the worker, not Postgres. .NET reads these limits and sizes the GC heap and thread pool to match ([Docker: limits](ch:docker#container-memory-and-cpu-limits-with-net)).
- **`shm_size`** for Postgres: the default 64 MB of shared memory is too small for parallel queries.

:::note Health checks need a tool in the image
`chiseled` and distroless .NET images have no shell and no `curl`, so `CMD curl ...` fails. Options: ship a tiny health-check executable in the image (Kettle's `/app/healthcheck` is a 20-line .NET console app, published with Native AOT, that exits 0 on HTTP 200); or skip the Docker health check and rely on the proxy's and the platform's checks.
:::

## Secrets without leaking them {i}

:::plain
Passwords go in files that Compose mounts into the container at `/run/secrets/`. They never appear in the image, in `docker inspect`, or in the compose file itself.
:::

- **Environment variables leak.** They show up in `docker inspect`, in crash dumps, in child processes and in debug pages that print the environment. Files under `/run/secrets` don't.
- **Reading them in .NET:** one line in `Program.cs`, `builder.Configuration.AddKeyPerFile("/run/secrets", optional: true)`, turns every file in the folder into a configuration key named after the file, with `__` meaning `:`. That's why the compose file mounts the connection string with `target: ConnectionStrings__Main`: the app reads `builder.Configuration.GetConnectionString("Main")` exactly as it does locally, with no Docker-specific code.
- **The `secrets/` folder** on the server is `chmod 700`, owned by root, and listed in `.gitignore`. Production secret values never go into git.
- A secret manager (Vault, a cloud key vault, or SOPS-encrypted files in git) is the next step once there's more than one server.

## Deploying and rolling back {i}

CI builds images and pushes them with the git SHA as the tag. The deploy, run on the server:

```bash
#!/usr/bin/env bash
# /srv/kettle/deploy.sh <version>
set -euo pipefail
cd /srv/kettle
export KETTLE_VERSION="$1"

docker compose pull api worker                                  # fetch the new images first; nothing changes yet
docker compose run --rm --no-deps migrator                      # schema changes, backward compatible (see below)
docker compose up -d --wait api worker proxy                    # recreate only what changed; wait for healthy
echo "KETTLE_VERSION=$KETTLE_VERSION" > .env                    # remember what's live, for reboots and rollbacks
docker image prune -f --filter "until=168h"                     # tidy old images
```

- **`pull` first**: downloading takes the longest, so do it while the old version is still serving.
- **`up -d --wait`**: recreates containers whose image or config changed, leaves the rest alone, and waits until health checks pass. It returns a non-zero exit code if they don't, so CI marks the deploy failed.
- **`.env`**: Compose reads it automatically, so after a reboot `restart: unless-stopped` brings back the same version.
- **Rollback** is `./deploy.sh <previous-sha>`: the old image is still cached on the server, so it's quick.

The migrator is a service that only runs when asked:

```yaml
  migrator:
    image: ghcr.io/kettle/migrator:${KETTLE_VERSION:?set KETTLE_VERSION}   # contains an EF Core migration bundle
    profiles: ["tools"]                    # never started by a plain `up`
    # the bundle runs as the admin user, which may alter the schema; the app's user may not
    command: ["sh", "-c", "./efbundle --connection \"$(cat /run/secrets/db_admin_connection)\""]
    secrets: [db_admin_connection]
    depends_on:
      db: { condition: service_healthy }
```

:::gotcha Compose recreates; it doesn't roll
`docker compose up -d` stops the old API container and then starts the new one. Between the two there's a gap of a few seconds (more, while the new one warms up) where Caddy has no backend and returns **502**. Options, in order of effort:
1. Accept a few seconds at quiet times. Caddy's `lb_try_duration 10s` makes it hold requests and retry while the backend comes back, so most users see a slow response rather than an error.
2. Run two API services (`api_blue`, `api_green`) and switch Caddy between them, as in the [Linux blue/green script](ch:linux-deploy#zero-downtime-deploys).
3. Use **Traefik**, which discovers new containers as they become healthy, with `docker compose up -d --scale api=2 --no-recreate` and then remove the old ones.
4. Move to a platform with rolling updates built in (Container Apps, Kubernetes, Docker Swarm).
:::

## Backups and data {a}

The database lives in the `pg_data` volume, at `/var/lib/docker/volumes/kettle_pg_data/_data` on the host. **Don't back up that folder while Postgres is running**: the files are inconsistent mid-write. Dump through Postgres instead:

```bash
docker compose exec -T db pg_dump -U kettle_admin --format=custom kettle > /var/backups/kettle/kettle-$(date -u +%F).dump
```

Then copy off the server, rotate, alert on failure and test restores, exactly as in the [last episode](ch:linux-deploy#backups-youve-actually-restored). Also back up `caddy_data` (certificates, so a rebuild doesn't hit rate limits) and `dp_keys` (so a rebuild doesn't log everyone out).

**Upgrading Postgres** to a new major version isn't an image tag change: the data format differs between major versions. Dump, start the new version with an empty volume, restore. Minor versions (16.3 → 16.4) are a tag change.

## Running it well {a}

- **Watching it:** `docker compose ps` (state and health), `docker compose logs -f api`, `docker stats` (live CPU and memory). Ship logs and metrics off the box, as before: OpenTelemetry from the app, plus an agent or cAdvisor for container metrics.
- **Updates:** the base images get security fixes, so rebuild and redeploy regularly (CI on a schedule, with Dependabot or Renovate bumping image tags). Pin exact versions (`postgres:16.4`) and update deliberately; a floating tag like `postgres:16` changes under you on the next pull.
- **Image security:** run as non-root (the official .NET images have an `app` user; use `USER $APP_UID`), use the smallest base image that works (chiseled), and scan images in CI ([Docker: size and security](ch:docker#image-size-startup-and-security)).
- **Docker's own host:** keep Docker updated, restrict who's in the `docker` group (membership is equivalent to root), and set `"live-restore": true` in `/etc/docker/daemon.json` so containers keep running while the Docker daemon itself is upgraded.
- **Reproducing the server:** with Docker installed by a script (cloud-init or Ansible) and everything else in git, a dead server is rebuilt by installing Docker, cloning the config, restoring the secrets and the latest backup, and running `deploy.sh`.

## When Compose is no longer enough {a}

Compose on one host is a great place to be for a long time. Move on when you need:

| Need | Why Compose can't do it | Next step |
|---|---|---|
| Survive a server failure | everything is on one machine | a managed platform, or several hosts |
| Rolling updates with no gap | Compose recreates containers | Container Apps, Kubernetes |
| Scale out across machines | Compose works on one host | Container Apps, Kubernetes, Swarm |
| A managed database with point-in-time restore and failover | Postgres in a container is yours to run | Azure Database for PostgreSQL, RDS |
| Many teams deploying independently | one shared file, one server | a platform with per-service deployments |

The images don't change when you move: the same `ghcr.io/kettle/api:<sha>` runs on [Azure Container Apps](ch:azure-compute) or [Kubernetes](ch:kubernetes). That's the main reason to containerise early.

## Interview questions {i}

:::qa What changes when running Docker Compose in production rather than locally?
Use prebuilt, version-tagged images from a registry rather than `build:`; add health checks and use `depends_on` with `service_healthy`; set restart policies; keep state in named volumes; pass secrets as files rather than environment variables; set resource limits and a longer `stop_grace_period`; rotate logs; and publish only the reverse proxy's ports, keeping the database and app on the internal network.
:::

:::qa Why are Docker's published ports a security risk on a server with a firewall?
Docker writes its own iptables rules for published ports, which on many setups take precedence over ufw, so a published database port can be reachable from the internet even when ufw appears to block it. Don't publish internal services' ports; let them communicate on the Compose network, or bind published ports to `127.0.0.1`.
:::

:::qa How do you deploy and roll back with Compose?
CI pushes images tagged with the git SHA. The deploy pulls the new images, runs migrations as a one-off container, and runs `docker compose up -d --wait` with the new tag, which recreates changed services and waits for health checks. Rolling back is redeploying the previous tag; the database must still be compatible with the older version.
:::

:::qa Why does `docker compose up -d` cause a short outage, and how do you avoid it?
It stops the old container before the new one is healthy, so the proxy has no backend for a few seconds. Avoid it by running two copies and switching the proxy between them, by letting the proxy retry during the gap, by using a proxy such as Traefik that adds containers when healthy while scaling up before removing old ones, or by moving to a platform with rolling updates.
:::

## Next episode {b}

Kettle runs in containers, deploys by tag and rolls back in seconds. One question remains before calling it production-ready: is the app itself configured for production? Timeouts, limits, headers, GC, shutdown, health checks and the settings that only matter under real load. [Episode 7 · Production configuration checklist →](ch:prod-config)

## Further reading

- [Use Compose in production](https://docs.docker.com/compose/how-tos/production/)
- [Compose file reference](https://docs.docker.com/reference/compose-file/)
- [Docker and ufw / packet filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [Containerize a .NET app](https://learn.microsoft.com/en-us/dotnet/core/docker/build-container)
