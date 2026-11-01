---
id: hosting-story
title: "Part X as One Story: Kettle Goes Live"
summary: "Read this first. Kettle's services run in a cupboard with no front door. Part X takes them onto the real internet: how a request travels from a browser to Kestrel, nginx and the other reverse proxies, deploying to a Linux server with systemd, HTTPS and zero-downtime releases, containers in production on one host, and the production settings that only matter under real load. Each chapter is an episode: something breaks on the way to launch, and the chapter is the fix."
layer: infra
where: Hosting in Production › Start of Part X
fits: "The doorway into Part X, Hosting in Production. It builds on [Hosting](ch:aspnet-hosting) and [Middleware](ch:middleware) from Part III, and prepares everything Part XI moves to the cloud."
levels: b
prereqs: ms-operations
next: request-journey
---

## The 30-second version

- Part X takes Kettle from "runs on our server" to "runs on the internet, safely": DNS, TLS, a reverse proxy, a real server, deployments, rollbacks, backups and production settings.
- 7 episodes. Each starts with **Previously at Kettle** and ends with **Next episode**.
- This is the practical knowledge most tutorials skip, and the part interviewers probe when they ask "how would you run this in production?"

## Where Kettle is now {b}

Kettle's code is in good shape: clean architecture, tested, observable, split into services where it helps. But all of it runs on one machine in the office cupboard, reached by IP address, over plain HTTP, deployed by copying files at night. Launch is in a month. Part X is the road from there to a site that customers can trust: secure, recoverable, and deployable at lunchtime without anyone noticing.

## The road through Part X {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [A request's journey](ch:request-journey) | Every customer shows the same IP, HTTPS redirects loop, big uploads time out. | DNS, TCP and TLS, CDNs and load balancers, forwarded headers, stacked timeouts, reading 502/503/504 |
| 2 | [nginx in front of ASP.NET Core](ch:reverse-proxy-nginx) | Kestrel faces the internet alone. | nginx config line by line, forwarded headers, WebSockets, buffering, limits, load balancing, logs, safe reloads |
| 3 | [Other proxies](ch:other-proxies) | One proxy doesn't fit every place Kettle runs. | Caddy, Traefik, YARP, IIS and the ASP.NET Core Module, HAProxy, managed front doors, how to choose |
| 4 | [Deploying to a Linux server](ch:linux-deploy) | Nobody has taken a .NET app to a real server before. | Hardening, publishing, systemd, secrets, Let's Encrypt, journald, blue/green deploys, rollback, backups, monitoring |
| 5 | [Ship the whole box](ch:docker) | Staging and production have different runtimes and libraries. | Images and layers, multi-stage Dockerfiles, .NET container images, compose |
| 6 | [Containers on one host](ch:containers-single-host) | The server is a hand-built pet that drifts. | Production Compose: health checks, volumes, secrets, limits, logs, deploy by tag, migrations, rollback |
| 7 | [Production configuration](ch:prod-config) | Will it survive ten times the traffic and a slow database? | Limits and timeouts, health checks, graceful shutdown, logging, GC and thread pool, culture and time, where to host, the go-live checklist |

## The whole picture in one diagram {b}

```text
 customer ── DNS ──▶ CDN / WAF ──▶ load balancer ──▶ reverse proxy ──▶ Kestrel ──▶ your code
                        (edge)      (cloud, optional)   (nginx, Caddy,     (your       │
                                                         Traefik, IIS)      process)    ▼
                                                                                    database
  Episode 1: what each hop does    Episodes 2–3: the proxy    Episodes 4–6: the server and how code gets onto it
                                                              Episode 7: the app's own settings
```

## How to read each episode {b}

Every chapter in this part follows the same beats:

1. **Previously at Kettle.** Where the shop is, in two or three sentences.
2. **The problem.** What went wrong on the way to launch.
3. **The chapter itself.** Plain-words summaries first, then the mechanics with real, tested config files, then in-depth sections and interview questions.
4. **Next episode.** The new problem that leads into the next chapter.

:::tip The configs are real
The nginx configs in this part pass `nginx -t`, the systemd units pass `systemd-analyze verify`, and the compose files pass `docker compose config`. Change the domain names and paths and they're a sound starting point for a real server.
:::

## Where this part ends {b}

By the end of Part X, Kettle is live: HTTPS everywhere, deploys with no downtime, a rollback that takes seconds, backups that have been restored, and settings checked against a go-live list. It's still one server, though, and one server can fail. Part XI moves Kettle to the cloud.

[Start: Episode 1 · A request's journey →](ch:request-journey)
