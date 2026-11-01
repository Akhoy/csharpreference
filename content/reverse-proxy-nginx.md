---
id: reverse-proxy-nginx
title: "nginx in Front of ASP.NET Core: A Production Configuration, Line by Line"
summary: "The reverse proxy most .NET apps on Linux sit behind. Covers what nginx does for Kestrel, how its configuration is structured, a complete production config for Kettle explained line by line (HTTP to HTTPS, TLS, HTTP/2, forwarded headers, keep-alive to upstream, timeouts, body size), the matching ASP.NET Core forwarded-headers setup, WebSockets and SignalR, buffering and streaming, compression and static files, rate limiting, load balancing with failover, access logs with request IDs and upstream timings, the inheritance traps, and safely testing and reloading changes. Every config in this chapter passes nginx -t."
layer: infra
where: Hosting › Reverse proxy with nginx
fits: "The second episode of Hosting. Uses the hops from [the request journey](ch:request-journey). The server it runs on is set up in [Linux deployment](ch:linux-deploy), and the alternatives are compared in [Other proxies](ch:other-proxies)."
levels: b,i,a
prereqs: request-journey
next: other-proxies
---

## The 30-second version

- nginx sits in front of Kestrel and does the internet-facing jobs: **TLS**, **HTTP to HTTPS**, **compression**, **static files**, **request limits**, **load balancing**, and absorbing slow clients.
- Kestrel listens only on **localhost** (or a Unix socket), so nothing reaches the app except through nginx.
- nginx passes the original client details in **forwarded headers**, and the app's `UseForwardedHeaders` (first in the pipeline) restores them.
- Two traps catch everyone: `proxy_set_header` and `add_header` are **not inherited** into a block that sets any of its own, and nginx's default upload limit is **1 MB**.
- Test every change with `nginx -t` and apply it with `systemctl reload nginx`, which doesn't drop connections.

## Words you'll meet

| Word | In plain words |
|---|---|
| **directive** | One setting in an nginx config, ending in `;`, such as `listen 443 ssl;`. |
| **context / block** | A `{ … }` section that holds directives: `http`, `server`, `location`, `upstream`. |
| **server block** | The settings for one site, chosen by port and host name. |
| **location** | Settings for a matching group of URLs inside a site. |
| **upstream** | A named group of backend servers nginx forwards to. |
| **`proxy_pass`** | The directive that forwards a request to an upstream. |
| **buffering** | nginx holding a response, or request, in memory or on disk while the slow side catches up. |
| **reload** | Re-reading the config without dropping open connections. |

## Previously at Kettle {b}

Kettle knows every hop between a customer and Kestrel. Its first server is a Linux machine, and the team decides to put nginx in front of the app: it's the most widely used reverse proxy, it's in every Linux distribution, and almost every hosting guide assumes it.

**The problem:** a reverse proxy that's only half configured causes exactly the bugs from the last episode: wrong client IPs, redirect loops, failed uploads and dropped WebSocket connections.

**This episode:** a complete production nginx configuration for Kettle, explained line by line, and the app-side settings that go with it.

## Start from zero: what nginx does for Kestrel {b}

:::plain
nginx is the receptionist and Kestrel is the specialist in the back office. The receptionist deals with the public, checks IDs, handles the routine requests and only passes on what needs the specialist.
:::

Kestrel is a fast, secure web server, and it can face the internet directly. But in production, nginx usually stands in front of it and takes these jobs:

| Job | Why nginx does it |
|---|---|
| **TLS termination** | One place holds the certificate and renews it, for every app on the machine |
| **HTTP → HTTPS redirect, HSTS** | Done once, before any app code runs |
| **Several apps on one IP** | nginx picks the app by host name (`api.kettle.example`, `admin.kettle.example`) |
| **Slow clients** | nginx reads a slow upload, or feeds a slow download, while Kestrel's thread is long finished |
| **Static files, compression** | nginx serves files straight from disk very efficiently |
| **Limits** | upload size, request rate, connection counts, at the edge |
| **Load balancing and failover** | spreads requests across several Kestrel instances, and skips a dead one |
| **Zero-downtime deploys** | switch traffic to the new version with a reload |

The trade-off is one more piece to configure and operate. On Azure App Service or Container Apps, the platform's front end does these jobs for you ([Other proxies](ch:other-proxies)).

## How an nginx config is organised {b}

:::plain
An nginx config is nested blocks. The outer `http` block holds settings for all sites, each `server` block is one site, and each `location` block handles a group of URLs in that site.
:::

```text
/etc/nginx/nginx.conf                 main file: worker settings, the http block, and include lines
/etc/nginx/conf.d/*.conf              extra settings for the http block
/etc/nginx/sites-available/kettle.conf   your site (Debian and Ubuntu layout)
/etc/nginx/sites-enabled/kettle.conf  → a symlink to it; only enabled sites are loaded
```

```nginx
# The shape, simplified
http {                                  # applies to every site
    server {                            # one site: chosen by listen port + server_name
        listen 80;
        server_name kettle.example;
        location / {                    # requests whose path starts with /
            proxy_pass http://127.0.0.1:5000;
        }
    }
}
```

How nginx chooses:

1. **Which `server`:** the one whose `listen` matches the port, and whose `server_name` matches the request's `Host` header. If none matches, the **default server** for that port answers, which is often not the one you meant. Define an explicit default server that rejects unknown hosts.
2. **Which `location`:** exact matches (`location = /health`) first, then the longest matching prefix (`location /api/`), with regular-expression locations (`location ~ \.php$`) checked in between unless the prefix is marked `^~`. Keep to exact and prefix locations, and the rules stay predictable.

## Kettle's production config, line by line {i}

:::plain
This is a complete, working configuration: redirect plain HTTP to HTTPS, serve HTTPS with a real certificate, and forward every request to Kestrel with the headers it needs.
:::

The app listens on `http://127.0.0.1:5000` (localhost only). The config below goes in `/etc/nginx/sites-available/kettle.conf`, with a symlink in `sites-enabled`.

```nginx
# A group of backends. One for now; Kettle adds more later in this chapter.
upstream kettle_api {
    server 127.0.0.1:5000;
    keepalive 32;                       # keep up to 32 idle connections to Kestrel open for reuse
}

# Requests for a host we don't serve: close the connection without a response
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

# Plain HTTP: only answer certificate challenges, redirect everything else to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name kettle.example www.kettle.example;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;          # Let's Encrypt checks a file here when issuing or renewing
    }
    location / {
        return 301 https://kettle.example$request_uri;
    }
}

# HTTPS: the real site
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name kettle.example;

    ssl_certificate     /etc/letsencrypt/live/kettle.example/fullchain.pem;   # certificate + intermediates
    ssl_certificate_key /etc/letsencrypt/live/kettle.example/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:TLS:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 20m;           # nginx's default is 1 MB: bigger uploads get 413 before reaching the app

    location / {
        proxy_pass         http://kettle_api;
        proxy_http_version 1.1;                     # needed for keep-alive to the upstream
        proxy_set_header   Connection        "";    # ...and clear "Connection: close"
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;
        proxy_set_header   X-Request-ID      $request_id;

        proxy_connect_timeout 5s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;
    }
}
```

Line by line, the parts that matter:

- **`upstream` with `keepalive`.** Without it, nginx opens a new TCP connection to Kestrel for every request. `keepalive` keeps idle connections open, and it only works together with `proxy_http_version 1.1` and an empty `Connection` header in the location.
- **`return 444` default server.** Bots scan IP addresses with random `Host` headers. Without an explicit default, they'd reach Kettle. `444` is nginx's special "close the connection without replying".
- **The port 80 server** exists only to answer Let's Encrypt's challenge and to redirect. `301` with `$request_uri` keeps the path and query string. Redirecting to one canonical host (`kettle.example`, not `www`) avoids duplicate URLs.
- **`listen 443 ssl http2`.** HTTP/2 between browsers and nginx: one connection carries many requests. nginx 1.25.1 and later prefer a separate `http2 on;` line; the older form shown here works on both, with a deprecation warning on newer versions.
- **`fullchain.pem`, not `cert.pem`**, so clients get the intermediate certificates too ([Request journey](ch:request-journey#tcp-and-tls-a-private-verified-connection)).
- **`ssl_protocols TLSv1.2 TLSv1.3`.** Older protocols are broken and disabled. The session cache lets returning clients skip the full handshake.
- **HSTS** tells browsers to use only HTTPS for this site for a year, even if someone types `http://`. `always` adds it to error responses too. Turn it on only once HTTPS works, because browsers remember it.
- **`client_max_body_size 20m`.** nginx rejects bigger request bodies with `413 Request Entity Too Large` before the app sees them. Keep it in line with Kestrel's own `MaxRequestBodySize` (about 28.6 MB by default) and your endpoint limits.
- **`proxy_set_header` lines** carry the original host, client address and scheme ([Request journey](ch:request-journey#what-each-hop-changes-and-how-your-app-gets-the-originals-ba)). `$proxy_add_x_forwarded_for` appends nginx's view of the client to any existing list. `$request_id` is a random ID nginx generates per request, which you'll log on both sides.
- **Timeouts.** `proxy_connect_timeout` is how long to wait for Kestrel to accept a connection: keep it short, so a dead upstream fails fast. `proxy_read_timeout` is the longest gap allowed between two reads of the response, not the total time. Keep it above your app's own request timeout ([timeouts stack up](ch:request-journey#timeouts-stack-up)).

:::gotcha The inheritance trap
`proxy_set_header` and `add_header` are inherited from an outer block **only if the inner block sets none of its own**. Add one `proxy_set_header` to a `location`, and every header set at the `server` level silently disappears from that location. The same goes for `add_header`, which is how HSTS quietly vanishes from one path. Either set them all in each `location`, or put shared ones in a file and `include` it in each location.
:::

## The app side: forwarded headers in ASP.NET Core {i}

:::plain
nginx writes the customer's real IP and the original scheme into headers. The app has to be told to read them, and to believe them only when they come from nginx.
:::

```csharp norun
var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    o.ForwardLimit = 1;                                   // one proxy in front of us: nginx
    o.AllowedHosts = ["kettle.example"];                  // only accept forwarded hosts we actually serve
    // Loopback (127.0.0.1, ::1) is trusted by default, which fits nginx on the same machine.
    // nginx on another machine: o.KnownProxies.Add(IPAddress.Parse("10.0.1.5"));
});

var app = builder.Build();
app.UseForwardedHeaders();     // FIRST: everything after it sees the real client IP, scheme and host
app.UseHsts();                 // nginx already sends HSTS; harmless, but pick one place in practice
app.UseHttpsRedirection();     // now sees https, so no redirect loop
// ... the rest of the pipeline
```

And bind Kestrel to localhost only, so it can't be reached around nginx:

```bash
ASPNETCORE_URLS=http://127.0.0.1:5000
```

Points that matter in production:

- **Order.** `UseForwardedHeaders` must come before anything that reads the client IP, the scheme or the host: HTTPS redirection, authentication (redirect URIs), rate limiting, logging.
- **Trust.** Only addresses in `KnownProxies` or `KnownNetworks` are believed. If nginx runs on a different machine and you don't add it, the headers are ignored and the app keeps seeing the proxy's IP.
- **The environment-variable shortcut.** Setting `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` turns the middleware on without code, but it **trusts any sender**. That's only safe when the app is unreachable except through the proxy, as in a container behind a platform load balancer.
- **Host.** Forwarding the host lets an attacker set it, which matters for password-reset links built from `Request.Host`. Restrict it with `AllowedHosts`, and also set the app's own top-level `AllowedHosts` configuration.
- **Logging the request ID.** Read `X-Request-ID` in a small middleware and add it to the log scope, so one ID connects nginx's access log to the app's logs ([Errors & logging](ch:errors-logging)).

## WebSockets, SignalR and Blazor Server {i}

:::plain
A WebSocket starts as an ordinary request asking to "upgrade" the connection. nginx must pass that request on, and then keep the connection open for a long time.
:::

```nginx
# In the http context (outside any server): turn the Upgrade header into the right Connection header
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    # ... the HTTPS server from above ...

    location /hubs/ {                                # SignalR hubs; Blazor Server uses /_blazor
        proxy_pass         http://kettle_api;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        $connection_upgrade;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;                        # an idle socket must survive between messages
        proxy_buffering    off;
    }
}
```

- **`Upgrade` and `Connection` headers.** These are hop-by-hop headers, which proxies don't forward unless told to. Without them, the WebSocket handshake fails, and SignalR silently falls back to slower long polling.
- **Long `proxy_read_timeout`** for these routes only. SignalR sends keep-alive pings (every 15 seconds by default), so an hour is generous. The default 60 seconds would cut idle connections.
- **More than one Kestrel instance?** SignalR and Blazor Server need each client to reach the **same** instance. Open-source nginx offers `ip_hash` in the upstream for that, or use a SignalR backplane or Azure SignalR Service ([Render modes](ch:blazor-render-modes#in-depth-running-server-and-webassembly-in-production)).

## Buffering, streaming and uploads {a}

By default nginx **buffers** responses: it reads the response from Kestrel as fast as Kestrel can send it, holds it, and feeds it to the client at the client's pace. That's usually what you want, because Kestrel's request finishes quickly even for a customer on a slow phone connection. But it breaks responses meant to arrive gradually:

| Response | Setting |
|---|---|
| Normal pages and JSON | default buffering on |
| Server-Sent Events, streamed `IAsyncEnumerable` JSON, progress output | `proxy_buffering off;` on that location, or have the app send the header `X-Accel-Buffering: no` |
| Large file downloads | buffering on, with nginx spilling to disk; or `X-Accel-Redirect` so nginx serves the file itself after the app authorises it |
| Large uploads streamed straight to storage | `proxy_request_buffering off;` so nginx streams the body to the app instead of saving all of it first |

`X-Accel-Redirect` is a neat pattern for protected downloads. The app checks the user may download invoice 42, then responds with the header `X-Accel-Redirect: /protected/invoices/42.pdf` and no body. nginx serves the file from an `internal` location, so the app never streams the bytes.

## Compression, caching and static files {a}

```nginx
# In the http context
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types application/json application/javascript text/css text/plain image/svg+xml;
gzip_vary on;

server {
    # ... the HTTPS server ...

    location /assets/ {                      # fingerprinted build output, e.g. app.3f1c2a.js
        alias /srv/kettle/current/wwwroot/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;   # re-add: inheritance trap
        access_log off;
    }
}
```

- **Compress in one place.** Either nginx (`gzip`, or Brotli through an extra module) or the app's response-compression middleware, not both. Compressing JSON typically shrinks it by 70–90%.
- **Don't compress already-compressed types** (images, video, zip files): it costs CPU for nothing.
- **Compression over HTTPS and secrets.** Compressing responses that mix attacker-controlled input with secrets, in the same response, enables BREACH-style attacks. Avoid reflecting user input next to tokens, and rely on antiforgery tokens that change per request.
- **Static files.** Fingerprinted file names (`app.3f1c2a.js`) can be cached for a year, because a new version gets a new name. In .NET 9 and later, `MapStaticAssets` produces fingerprinted, pre-compressed files, so serving them from the app is also efficient. nginx serving them directly saves the round trip to Kestrel.

## Rate limiting at the edge {a}

nginx can reject floods before they reach the app. This complements the app's own rate limiter ([Caching, rate limiting & CORS](ch:caching-ratelimit-cors)), which knows about users and API keys rather than only IP addresses.

```nginx
# In the http context: one shared memory zone, keyed by client address, 5 requests per minute
limit_req_zone $binary_remote_addr zone=signin:10m rate=5r/m;

server {
    # ... the HTTPS server ...

    location = /account/sign-in {
        limit_req zone=signin burst=5 nodelay;      # allow a short burst, then reject
        limit_req_status 429;
        proxy_pass         http://kettle_api;
        proxy_http_version 1.1;
        proxy_set_header   Connection        "";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

`$binary_remote_addr` is the client IP as nginx sees it. Behind a CDN or load balancer, that's the CDN's address, so you'd need the `real_ip` module (`set_real_ip_from` + `real_ip_header`) to restore the client's IP in nginx first, exactly like the app's forwarded-headers middleware.

## Load balancing and failover {a}

```nginx
upstream kettle_api {
    least_conn;                                       # send to the instance with the fewest active requests
    server 10.0.1.11:5000 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:5000 max_fails=3 fail_timeout=10s;
    server 10.0.1.13:5000 backup;                     # only used when the others are down
    keepalive 32;
}
```

| Choice | Behaviour |
|---|---|
| default (round robin) | each request to the next server in turn |
| `least_conn` | to the server with fewest active connections: better when request times vary |
| `ip_hash` / `hash $cookie_x consistent` | same client to the same server: for SignalR or Blazor Server without a backplane |
| `max_fails` + `fail_timeout` | after 3 failed attempts within 10 s, skip that server for 10 s (**passive** health checks) |
| `backup` | a standby server |

Open-source nginx only has **passive** health checks: it notices a failure when a real request fails, then retries that request on another server if it's safe (`proxy_next_upstream`, which by default retries on connection errors and timeouts, but not for non-idempotent methods like POST once the request has been sent). Active probing of `/health/ready` needs nginx Plus or a different proxy. For most setups, combine passive checks with taking an instance out of the upstream before deploying to it ([Linux deployment](ch:linux-deploy#zero-downtime-deploys)).

## Logs you can actually use {a}

The default access log lacks the two things you need most: how long the upstream took, and an ID to find the request in the app's logs.

```nginx
# In the http context
log_format kettle '$remote_addr - [$time_iso8601] "$request" $status $body_bytes_sent '
                  'rt=$request_time urt=$upstream_response_time ua="$http_user_agent" '
                  'rid=$request_id upstream=$upstream_addr';

access_log /var/log/nginx/kettle.access.log kettle;
error_log  /var/log/nginx/kettle.error.log warn;
```

- `$request_time` is the total time nginx spent, including sending to a slow client. `$upstream_response_time` is how long Kestrel took. A big gap between them means a slow client or network, not a slow app.
- `$request_id` matches the `X-Request-ID` header sent to the app, so you can jump from an nginx line to the app's logs.
- The **error log** is where 502s explain themselves: `connect() failed (111: Connection refused)` means the app isn't listening; `upstream prematurely closed connection` means it crashed or closed mid-response; `upstream timed out` means `proxy_read_timeout` was hit.
- On busy servers, send logs to your log platform rather than leaving them on local disk, and configure log rotation (`logrotate` does this for nginx by default on Ubuntu).

## Changing config safely {i}

```bash
sudo nginx -t                      # check syntax and that referenced files exist: ALWAYS first
sudo systemctl reload nginx        # apply: new workers start, old ones finish their requests, then exit
sudo nginx -T | less               # print the full effective config, all includes expanded
```

A **reload** is graceful: existing connections finish on the old configuration while new ones use the new configuration, so nothing is dropped. A **restart** stops everything first. If `nginx -t` fails, a reload is refused and the old config keeps running, which is why you always test first. Keep the config in Git and deploy it like code ([CI/CD](ch:cicd-iac)).

## Interview questions {i}

:::qa Why put nginx in front of Kestrel if Kestrel is production-ready?
To centralise internet-facing concerns: TLS termination and certificate renewal, HTTP-to-HTTPS redirects, hosting several apps on one IP by host name, absorbing slow clients with buffering, serving static files and compression, edge limits on body size and request rate, load balancing with failover, and zero-downtime switches with a graceful reload. Kestrel is then bound to localhost so it's reachable only through the proxy.
:::

:::qa What headers must nginx forward, and what must the app do with them?
`Host` (or `X-Forwarded-Host`), `X-Forwarded-For` with the client address, and `X-Forwarded-Proto` with the scheme, plus a request ID for correlation. The app runs `UseForwardedHeaders` first, configured with the forwarded headers to process, the number of proxies, the hosts it accepts, and the proxies it trusts, so it restores the client IP, scheme and host without letting clients spoof them.
:::

:::qa How do you proxy WebSockets or SignalR through nginx?
Use `proxy_http_version 1.1` and forward the hop-by-hop `Upgrade` and `Connection` headers, usually via a `map` from `$http_upgrade`. Raise `proxy_read_timeout` for those routes so idle connections survive, disable buffering there, and keep each client on the same backend (with `ip_hash`, or a backplane) when there are several instances.
:::

:::qa What is nginx's proxy_set_header inheritance gotcha?
`proxy_set_header` and `add_header` are only inherited from an outer level when the inner block defines none of its own. Adding a single header in a `location` drops all the server-level ones there, which commonly loses forwarded headers or HSTS on specific routes. Repeat them, or include a shared snippet in every location.
:::

:::qa Why do uploads over 1 MB fail behind nginx?
nginx's default `client_max_body_size` is 1 MB, so it rejects larger bodies with 413 before the app sees them. Set it to the size you intend to accept, consistent with Kestrel's `MaxRequestBodySize` and any per-endpoint limits, and consider `proxy_request_buffering off` for large streamed uploads.
:::

## Next episode {b}

nginx is the classic choice, but it isn't the only one. Caddy gets certificates by itself, Traefik configures itself from Docker, YARP lets you write the proxy in C#, IIS is still the Windows answer, and in the cloud the platform often is the proxy. [Episode 3 · Other proxies →](ch:other-proxies)

## Further reading

- [Host ASP.NET Core on Linux with nginx](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/linux-nginx)
- [nginx: reverse proxy guide](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/) and [WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
- [Mozilla SSL configuration generator](https://ssl-config.mozilla.org/)
- [Configure ASP.NET Core to work with proxy servers](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)
