---
id: request-journey
title: "From Browser to Kestrel: Every Hop a Request Takes"
summary: "Before configuring any server, know the road. Follows one request to kettle.example from the customer's browser to your code: DNS records and TTLs, TCP and the TLS handshake, certificates, chains and SNI, CDNs, layer-4 and layer-7 load balancers, the reverse proxy and Kestrel. Shows what each hop changes about the request (client IP, scheme, host, path), how timeouts stack up along the way, and how to read 502, 503 and 504 to find the hop that failed."
layer: infra
where: Hosting › How a request reaches your app
fits: "The map for the whole Hosting part. Kestrel and the forwarded-headers problem were introduced in [Hosting](ch:aspnet-hosting#why-production-traffic-rarely-hits-kestrel-directly); this chapter explains the hops in front of it, and the next chapters configure them: [nginx](ch:reverse-proxy-nginx), [other proxies](ch:other-proxies), [a Linux server](ch:linux-deploy)."
levels: b,i,a
prereqs: aspnet-hosting, middleware
next: reverse-proxy-nginx
---

## The 30-second version

- A request passes through several machines before your code sees it: **DNS** finds the address, **TLS** sets up encryption, a **CDN** may answer from cache, a **load balancer** picks a server, a **reverse proxy** forwards to **Kestrel**.
- Each hop can **change what your app sees**: the client's IP, whether it was HTTPS, the host name, even the path. Forwarded headers carry the originals, and your app must trust them only from its own proxy.
- Each hop has its **own timeout**. The outermost one should be the longest, or users see errors while your app is still working.
- **502** means a hop couldn't get a valid answer from the next one, **504** means it gave up waiting, and **503** means nothing healthy was available. The status code tells you which gap to look in.

## Words you'll meet

| Word | In plain words |
|---|---|
| **DNS** | The internet's phone book: turns `kettle.example` into an IP address. |
| **TTL** | How long a DNS answer may be cached before being asked again. |
| **TLS** | The encryption under HTTPS. It also proves the server is who it says it is. |
| **certificate** | A signed document binding a domain name to a public key. |
| **SNI** | The domain name the browser sends at the start of TLS, so one IP address can serve many sites. |
| **CDN** | A network of servers near users that caches and serves content. |
| **load balancer** | Spreads incoming connections or requests across several servers. |
| **layer 4 / layer 7** | Balancing by connection (IP and port) vs by HTTP request (path, headers). |
| **reverse proxy** | A server that receives requests for your app and forwards them to it. |
| **upstream** | From the proxy's point of view, the server it forwards to: your app. |

## Previously at Kettle {b}

Kettle's services are well designed and run fine on the developers' machines and on the old server in the cupboard. The next step is the real internet: a domain name, HTTPS, more than one server, and customers whose IP addresses matter for rate limits and fraud checks. The first attempt showed every customer as the same IP address, redirected HTTPS users in a loop, and timed out large uploads.

**The problem:** none of those were bugs in Kettle's code. They happened in the hops between the customer and Kestrel.

**This episode:** each hop, what it does, what it changes, and how to tell which one failed.

## Start from zero: the road a request travels {b}

:::plain
Typing a web address starts a relay race. Several machines each do one job and hand the request on. Your app is only the last runner, and it only sees what the others passed along.
:::

A customer types `https://kettle.example/teas` and presses Enter:

```text
Browser
  │ 1. DNS: "where is kettle.example?" → 203.0.113.10
  │ 2. TCP connection to 203.0.113.10:443
  │ 3. TLS handshake: check the certificate, agree on keys
  ▼
CDN edge (optional) ── serves cached images and CSS; forwards everything else
  ▼
Load balancer ── picks one of several servers
  ▼
Reverse proxy (nginx, Caddy, YARP, IIS…) ── on each server, or shared
  ▼
Kestrel ── inside your ASP.NET Core process
  ▼
Middleware → routing → your endpoint
```

On a small setup, several of these are one machine: one server where nginx handles TLS and forwards to Kestrel on the same box. On Azure or Kubernetes, the load balancer and proxy are managed services. The jobs are the same either way.

## DNS: finding the address {b}

:::plain
DNS turns a name into an IP address. Answers are cached for a set time, so changes take effect slowly unless you planned for it.
:::

| Record | Maps | Example |
|---|---|---|
| **A** | name → IPv4 address | `kettle.example → 203.0.113.10` |
| **AAAA** | name → IPv6 address | `kettle.example → 2001:db8::10` |
| **CNAME** | name → another name | `www.kettle.example → kettle.example`, `shop.kettle.example → kettle.azurewebsites.net` |
| **TXT** | name → text | domain-ownership proofs for certificates and email |
| **CAA** | which certificate authorities may issue for this domain | `0 issue "letsencrypt.org"` |

**TTL is a deployment setting.** Every DNS answer carries a TTL (time to live), and resolvers cache it that long. With a TTL of a day, moving Kettle to a new server means some customers keep reaching the old one for up to a day. Before a planned migration, lower the TTL to a few minutes a day or two ahead, move, check, then raise it again.

A **CNAME can't sit at the root** of a domain (`kettle.example` itself), only on subdomains. Many DNS providers offer an "alias" or "flattening" record to work around this when the root must point at a cloud hostname.

## TCP and TLS: a private, verified connection {i}

:::plain
Before any HTTP is sent, the browser and server set up an encrypted connection and the server proves its identity with a certificate. This happens at whichever hop "terminates" TLS.
:::

1. **TCP** opens a connection to port 443.
2. The browser starts **TLS** and sends **SNI**: the name it wants, `kettle.example`. One IP address can host many sites, and SNI tells the server which certificate to present.
3. The server sends its **certificate** and the **intermediate certificates** that link it to a root the browser trusts. That's the **chain**.
4. The browser checks the chain, that the name matches, and that the certificate hasn't expired. Then both sides agree on encryption keys.
5. Only now does the HTTP request travel, encrypted.

**TLS termination** is where the encryption ends: the hop that holds the certificate and decrypts. Usually it's the CDN, load balancer or reverse proxy, which then forwards plain HTTP, or new TLS, to the next hop. From that point on, your app can't tell from the connection itself that the customer used HTTPS, which is the root of the redirect-loop bug below.

Two common failures:

- **Missing intermediate certificate.** Browsers that already cached the intermediate work; others, and many API clients, fail. Always serve the **full chain** (in nginx, the `fullchain.pem` file, not just `cert.pem`).
- **Expired certificate.** Certificates now last 90 days or less (Let's Encrypt), and maximum lifetimes are being shortened further across the industry. Automatic renewal isn't optional, and neither is monitoring the expiry date ([Linux server](ch:linux-deploy)).

## CDNs and load balancers {i}

:::plain
A CDN answers from a nearby cache when it can, so many requests never reach you. A load balancer spreads the rest across your servers, either by connection or by individual HTTP request.
:::

**A CDN** (Azure Front Door, Cloudflare, CloudFront) has servers in many cities. It terminates TLS close to the user, serves cacheable responses (images, CSS, JavaScript, sometimes whole pages) from its cache, and forwards the rest to your origin over long-lived, optimised connections. It also absorbs attacks before they reach you. Kettle's product images and scripts never touch the API servers.

**Load balancers** come in two kinds:

| | Layer 4 (transport) | Layer 7 (application) |
|---|---|---|
| Sees | IP addresses and ports | full HTTP requests: path, headers, cookies |
| Decides per | TCP connection | HTTP request |
| Can do | spread connections; very fast | route `/api` and `/admin` differently, terminate TLS, add headers, retry, WAF |
| Azure examples | Azure Load Balancer | Application Gateway, Front Door |
| Self-hosted | HAProxy (TCP mode), cloud network LBs | nginx, HAProxy (HTTP mode), Caddy, Traefik |

**Health checks.** A load balancer only sends traffic to servers that pass its health probe, usually your `/health/ready` endpoint ([Resilience](ch:resilience#health-checks)). If the probe path is wrong or slow, healthy servers get removed and customers get 503s.

**Sticky sessions** (session affinity) send a client back to the same server each time. Blazor Server and SignalR need it unless a backplane or Azure SignalR Service handles connections. Everything else should be stateless, so any server can answer any request.

## What each hop changes, and how your app gets the originals back {i}

:::plain
Each hop starts a new connection to the next one, so your app sees the proxy as the client. The proxy writes the original details into headers, and your app reads them only if they came from a proxy it trusts.
:::

| Your app wants | Without help it sees | Forwarded in | Symptoms if ignored |
|---|---|---|---|
| the customer's IP | the proxy's IP, such as `127.0.0.1` | `X-Forwarded-For` | rate limits and fraud checks treat every customer as one; logs useless |
| whether it was HTTPS | `http`, because TLS ended at the proxy | `X-Forwarded-Proto` | **HTTPS redirect loops**; generated links and OAuth redirect URIs use `http://` |
| the original host name | the proxy's upstream name, such as `localhost:5000` | `X-Forwarded-Host` (or the proxy passes `Host` through) | wrong absolute URLs in emails and `Location` headers |
| the original path prefix | the path after the proxy stripped `/shop` | `X-Forwarded-Prefix` | broken links when the app is mounted under a sub-path |

ASP.NET Core's **forwarded headers middleware** reads these and rewrites `HttpContext` (`Connection.RemoteIpAddress`, `Request.Scheme`, `Request.Host`), so the rest of the app sees the original request. It must run **first** in the pipeline, and it must only trust headers from **known proxies**, because any client can send its own `X-Forwarded-For` ([Hosting](ch:aspnet-hosting#why-production-traffic-rarely-hits-kestrel-directly) shows the setup, and [nginx](ch:reverse-proxy-nginx#the-app-side-forwarded-headers-in-asp-net-core) shows both sides together).

`X-Forwarded-For` can hold a **list** when there are several proxies: `client, cdn, loadbalancer`. The middleware walks it from the right, accepting each address only while it belongs to a known proxy. Set `ForwardLimit` to the number of proxies in front of you, so a client can't add fake entries on the left.

The standard `Forwarded` header (RFC 7239) carries the same information in one header. Most proxies still send the `X-Forwarded-*` ones, which is what ASP.NET Core reads by default.

## Timeouts stack up {a}

:::plain
Every hop gives up after its own time limit. If an inner hop waits longer than an outer one, the customer sees an error while your app carries on working on a request nobody is waiting for.
:::

| Hop | Typical default | Kettle's setting |
|---|---|---|
| CDN to origin | 30–60 s | 60 s |
| Load balancer idle timeout | 60 s (varies by service) | 60 s |
| nginx `proxy_read_timeout` | 60 s | 30 s for the API, 1 h for WebSocket routes |
| Your request timeout (ASP.NET Core request-timeouts middleware) | none | 20 s |
| Database command timeout | 30 s | 5 s |

The rule: **each inner timeout shorter than the one outside it.** Then a slow request fails inside your app first, with a proper error you log, instead of the proxy cutting the connection while the app keeps working. Pass the request's `CancellationToken` down, so the database query actually stops ([Resilience](ch:resilience#timeouts)).

Long-lived connections (WebSockets, Server-Sent Events, Blazor Server circuits, large downloads) are the exception, and need longer timeouts on just those routes.

## Reading 502, 503 and 504 {i}

:::plain
These three errors are usually created by a hop in front of your app, not by your app. Each one points at a different gap between two hops.
:::

| Status | Means | Usual causes | Look at |
|---|---|---|---|
| **502 Bad Gateway** | the proxy got **no valid response** from upstream | app not running or crashed; wrong port or socket; app closed the connection; TLS mismatch between proxy and app | proxy error log (`connect() failed`, `upstream prematurely closed`); is the process up? |
| **503 Service Unavailable** | **no healthy upstream** is available, or the app itself is refusing work | every instance failing its health probe; app shutting down; rate limiter or queue full | load balancer health status; readiness endpoint; app logs |
| **504 Gateway Timeout** | the proxy **waited too long** for upstream | slow database query; thread-pool starvation; proxy timeout shorter than the work | traces for slow spans; proxy timeout settings; thread pool counters |

Some useful habits:

- Give every request an ID at the **outermost** hop and pass it inward (`X-Request-ID`, or the W3C `traceparent` header), so one request can be found in every log along the way ([Observability](ch:observability-aspire#distributed-tracing)).
- Check each hop from the inside out: `curl` the app directly on the server (`curl -i http://127.0.0.1:5000/health/ready`), then through the proxy, then from outside. The first hop where it fails is where the problem is.
- A 502 straight after a deployment usually means the proxy is forwarding to an app that hasn't started yet, or that started on a different port.

## Interview questions {i}

:::qa Walk me through what happens when a user requests a page of your ASP.NET Core app.
DNS resolves the name to an IP, the browser opens a TCP connection and performs a TLS handshake with SNI, validating the certificate chain. The request may be served from a CDN cache, otherwise it passes a load balancer that picks a healthy server, then a reverse proxy that forwards it to Kestrel with forwarded headers. In the app, the forwarded-headers middleware restores the client's IP and scheme, then the middleware pipeline, routing and the endpoint run, and the response travels back the same way.
:::

:::qa Why does an app behind a proxy loop on HTTPS redirects, and how do you fix it?
TLS ended at the proxy, so the app receives plain HTTP and sees `Request.Scheme` as `http`. `UseHttpsRedirection` then redirects to HTTPS, the proxy forwards that as HTTP again, and so on. The proxy must send `X-Forwarded-Proto`, and the app must run `UseForwardedHeaders` first, trusting only its known proxies, so the scheme is restored before HTTPS redirection runs.
:::

:::qa How should timeouts be set across a CDN, load balancer, proxy and app?
Each inner timeout should be shorter than the one outside it, so a slow request fails inside the app with a logged error rather than being cut off by an outer hop while the app keeps working. Pass cancellation tokens down so the work actually stops. Long-lived routes such as WebSockets get their own longer timeouts.
:::

:::qa What's the difference between 502, 503 and 504?
502 means a gateway or proxy got an invalid or no response from upstream, often because the app is down or listening elsewhere. 503 means no healthy upstream is available or the service is deliberately refusing work. 504 means the proxy timed out waiting for upstream, which points to slow requests or a timeout set shorter than the work.
:::

:::qa Layer-4 vs layer-7 load balancing?
A layer-4 balancer works on TCP connections, using IPs and ports, and is fast but can't see HTTP. A layer-7 balancer understands HTTP, so it can route by path or header, terminate TLS, add forwarded headers, retry and apply a WAF, at higher cost per request.
:::

## Next episode {b}

Kettle now knows the road. Time to build the most important hop: a reverse proxy in front of Kestrel, configured properly. [Episode 2 · nginx in front of ASP.NET Core →](ch:reverse-proxy-nginx)

## Further reading

- [Configure ASP.NET Core to work with proxy servers and load balancers](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)
- [How DNS works](https://developer.mozilla.org/en-US/docs/Glossary/DNS) and [TLS on MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security)
- [Request timeouts middleware](https://learn.microsoft.com/en-us/aspnet/core/performance/timeouts)
