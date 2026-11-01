---
id: other-proxies
title: "Caddy, Traefik, YARP, IIS and the Cloud's Front Doors"
summary: "nginx isn't the only way in. Covers Caddy with automatic HTTPS in a few lines, Traefik configuring itself from Docker labels, YARP as a reverse proxy written in C# with active health checks and custom logic, IIS with the ASP.NET Core Module (in-process vs out-of-process, web.config, app_offline, and the startup errors), HAProxy, and managed front doors on Azure, AWS, Cloudflare and Kubernetes. Ends with how to choose."
layer: infra
where: Hosting › Other reverse proxies
fits: "Alternatives to [nginx](ch:reverse-proxy-nginx), doing the same jobs from the [request journey](ch:request-journey). YARP reappears as a gateway in [Microservices](ch:ms-communication#the-gateway-one-front-door); the managed options connect to [Azure compute](ch:azure-compute) and [Kubernetes](ch:kubernetes)."
levels: i,a
prereqs: reverse-proxy-nginx
next: linux-deploy
---

## The 30-second version

- **Caddy**: the simplest config of all, and it gets and renews certificates by itself. Great for single servers and small teams.
- **Traefik**: watches Docker or Kubernetes and builds its routes from **labels** on your containers. Great when containers come and go.
- **YARP**: a reverse proxy **library** for ASP.NET Core, so routing, auth and transformations are C#. Great for API gateways and BFFs.
- **IIS + ASP.NET Core Module**: the Windows Server path. Runs the app inside IIS's worker process by default.
- **Managed front doors** (Front Door, Application Gateway, App Service, Container Apps, AWS ALB, Cloudflare, Kubernetes ingress) do the proxy's job for you on a platform.
- The forwarded-headers rules from the last two episodes apply to all of them.

## Previously at Kettle {b}

Kettle's nginx config works. But the team's containers on the staging server change every day and someone keeps forgetting to update nginx; finance wants a Windows server in the office to run the reporting app; and the microservices team needs a gateway with logic only C# can express.

**The problem:** one proxy doesn't fit every place Kettle runs.

**This episode:** the main alternatives, what each is good at, and how to choose.

## Start from zero: the same job, different trade-offs {b}

:::plain
Every reverse proxy does the same basic job: take requests from the internet and forward them to your app. They differ in how you configure them and what they do for you automatically.
:::

| | nginx | Caddy | Traefik | YARP | IIS (ANCM) |
|---|---|---|---|---|---|
| Configured with | text config files | a short `Caddyfile` | labels on containers, or files | C# and `appsettings.json` | IIS Manager, `web.config` |
| Certificates | you run certbot | **automatic** | **automatic** | you provide them, or a front proxy does | Windows certificate store |
| Discovers backends | no, you list them | no (except via plugins) | **yes**, from Docker or Kubernetes | from config, or code you write | one app per site |
| Custom logic | limited (or scripting modules) | modules | middleware plugins | **anything, in C#** | IIS modules |
| Best for | Linux servers, the most common setup | small teams, single servers | container hosts, dynamic setups | gateways, BFFs | Windows servers |

## Caddy: HTTPS with nothing to configure {i}

:::plain
Caddy gets a certificate for your domain by itself and renews it forever. A complete production config for Kettle is three lines.
:::

```text
# /etc/caddy/Caddyfile
kettle.example {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5000
}
```

What those lines do:

- The **site address** `kettle.example` makes Caddy listen on 80 and 443, obtain a certificate from Let's Encrypt (or ZeroSSL) automatically, renew it, and redirect HTTP to HTTPS.
- **`reverse_proxy`** forwards to Kestrel with `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` already set. It also proxies WebSockets with no extra configuration.
- **`encode`** compresses responses.

More of what Kettle needs is one line each: `reverse_proxy 10.0.1.11:5000 10.0.1.12:5000 { lb_policy least_conn  health_uri /health/ready }` adds load balancing with **active** health checks, and `request_body { max_size 20MB }` sets an upload limit.

**Trade-offs:** a smaller ecosystem of guides and modules than nginx, and its automatic certificate management needs port 80 or 443 reachable from the internet (or a DNS-provider plugin for wildcard certificates). Behind a CDN or load balancer, configure `trusted_proxies` so Caddy itself trusts the forwarded headers it receives.

## Traefik: a proxy that reads your containers {i}

:::plain
Traefik watches Docker. When a container starts with the right labels, Traefik adds a route to it and gets a certificate. When the container stops, the route goes away.
:::

```yaml
# compose.yaml on the staging server
services:
  traefik:
    image: traefik:v3.1
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false          # only route containers that opt in
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.le.acme.email=ops@kettle.example
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports: ["80:80", "443:443"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro       # read container labels
      - ./letsencrypt:/letsencrypt

  api:
    image: ghcr.io/kettle/api:1.4.2
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=Host(`staging.kettle.example`)
      - traefik.http.routers.api.entrypoints=websecure
      - traefik.http.routers.api.tls.certresolver=le
      - traefik.http.services.api.loadbalancer.server.port=8080   # the port inside the container
```

- **Routers** match requests (by host, path, headers), **services** are where they go, and **middlewares** change them on the way (redirects, rate limits, basic auth, headers).
- Scale `api` to three containers and Traefik load-balances across them with no config change.
- In Kubernetes, Traefik can be the ingress controller, reading `Ingress` or Gateway API objects instead of labels.

:::gotcha The Docker socket is root access
Mounting `/var/run/docker.sock` lets Traefik read labels, but anything that can use that socket can start containers, which is effectively root on the host. Mount it read-only, keep Traefik's image up to date, or put a socket proxy in between that exposes only the read calls Traefik needs.
:::

## YARP: a reverse proxy you write in C# {a}

:::plain
YARP is a library, not a program. You build your proxy as an ordinary ASP.NET Core app, so you can add any logic you can write in C#.
:::

The gateway configuration from [Microservices](ch:ms-communication#the-gateway-one-front-door) covers routing. Three things that set YARP apart:

**Active health checks and failover**, configured per cluster:

```json
"Clusters": {
  "ordering": {
    "LoadBalancingPolicy": "LeastRequests",
    "HealthCheck": {
      "Active": { "Enabled": true, "Interval": "00:00:10", "Timeout": "00:00:05", "Policy": "ConsecutiveFailures", "Path": "/health/ready" }
    },
    "Destinations": {
      "a": { "Address": "http://10.0.1.11:8080/" },
      "b": { "Address": "http://10.0.1.12:8080/" }
    }
  }
}
```

**Transforms**, for changing requests and responses on the way through: strip a path prefix, add headers, or swap the user's cookie for a bearer token when forwarding to an API (the BFF pattern, [OAuth & OIDC](ch:oauth-oidc-identity#spas-and-the-bff-pattern)):

```csharp norun
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))
    .AddTransforms(ctx =>
    {
        ctx.AddRequestTransform(async t =>
        {
            var token = await t.HttpContext.GetTokenAsync("access_token");     // held server-side by the BFF
            if (token is not null)
                t.ProxyRequest.Headers.Authorization = new("Bearer", token);
        });
    });
```

**Everything else in ASP.NET Core**: authentication and authorization policies per route, rate limiting, output caching, OpenTelemetry tracing, all with the middleware you already know.

**Trade-offs:** you own a proxy *application*: build it, deploy it, patch it. YARP usually sits behind a TLS-terminating front (a cloud load balancer or nginx), or terminates TLS in Kestrel itself.

## IIS and the ASP.NET Core Module {i}

:::plain
On Windows Server, IIS hosts ASP.NET Core through a small module. By default your app runs inside IIS's own worker process, and a `web.config` file tells IIS how to start it.
:::

**Setting up a server:**

1. Install the **.NET Hosting Bundle** for your .NET version: the runtime plus the **ASP.NET Core Module (ANCM)**. Restart IIS afterwards (`iisreset`), or IIS won't load the module.
2. Create an **application pool** with **.NET CLR version: No Managed Code**. That setting refers to the old .NET Framework; ASP.NET Core loads its own runtime.
3. Point a site at the folder produced by `dotnet publish`, which includes a generated `web.config`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <location path="." inheritInChildApplications="false">
    <system.webServer>
      <handlers>
        <add name="aspNetCore" path="*" verb="*" modules="AspNetCoreModuleV2" resourceType="Unspecified" />
      </handlers>
      <aspNetCore processPath="dotnet" arguments=".\Kettle.Reports.dll"
                  stdoutLogEnabled="false" stdoutLogFile=".\logs\stdout" hostingModel="inprocess">
        <environmentVariables>
          <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
        </environmentVariables>
      </aspNetCore>
    </system.webServer>
  </location>
</configuration>
```

**In-process vs out-of-process:**

| | In-process (default) | Out-of-process |
|---|---|---|
| Where the app runs | inside IIS's worker process, `w3wp.exe` | its own `dotnet` process running Kestrel |
| HTTP server | IIS HTTP Server (`IISHttpServer`), no Kestrel | Kestrel, with IIS forwarding to it |
| Speed | faster: no extra hop | an extra local hop |
| Use when | almost always | you need Kestrel-specific behaviour, or several apps per pool |

**Practical rules:**

- **`web.config` configures IIS, not your app.** App settings still come from `appsettings.json`, environment variables and secrets, as everywhere else ([Configuration](ch:configuration-options)).
- **Deploying:** IIS locks the running app's files. Copy an `app_offline.htm` file into the site folder first, which makes ANCM shut the app down gracefully and serve that page; replace the files; then delete `app_offline.htm`. Web Deploy and most pipeline tasks do this for you.
- **Startup failures** show as **HTTP 500.30** ("in-process start failure") or **502.5** ("process failure", out-of-process). The cause is in the Windows **Event Log** (Application). For more detail, temporarily set `stdoutLogEnabled="true"`, make sure the `logs` folder exists and the app pool identity can write to it, then turn it off again.
- **Data Protection keys:** under IIS, keys are stored per app pool identity in the registry by default. On a web farm, persist them to a shared location, such as Azure Blob Storage protected by Key Vault, or cookies break when requests hit a different server ([Auth](ch:auth#cookie-authentication)).
- **Windows authentication** (Kerberos and NTLM for intranet apps) is IIS's strength: enable it in IIS and use `AddAuthentication(IISDefaults.AuthenticationScheme)`.

## HAProxy, briefly {a}

**HAProxy** is a very fast load balancer and proxy for TCP and HTTP, popular at the edge of large self-hosted systems. Compared with nginx, it has richer load-balancing and **active health checking** in the free version, detailed live statistics, and precise connection control. Its configuration is text, like nginx's. Choose it when load balancing is the main job and you're running at a scale where its observability and tuning matter.

## Managed front doors in the cloud {i}

:::plain
On a cloud platform, a managed service usually does the reverse proxy's job. You configure it through the portal or infrastructure code, and you still have to get forwarded headers right in the app.
:::

| Service | Layer | What it gives you | Notes |
|---|---|---|---|
| **Azure Front Door** | global, edge (layer 7) | CDN, WAF, TLS at the edge, routing to regions, failover | adds `X-Forwarded-*` and `X-Azure-FDID`; lock your origin so it only accepts traffic from your Front Door |
| **Azure Application Gateway** | regional, layer 7 | WAF, path-based routing, TLS termination, autoscaling | inside your VNet, in front of VMs, App Service or AKS |
| **App Service front end** | built in | TLS, custom domains, managed certificates, load balancing across instances | forwards scheme and client IP; ASP.NET Core on App Service enables forwarded headers for you |
| **Container Apps ingress** | built in (Envoy) | TLS, custom domains, traffic splitting between revisions | set `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` only because nothing else can reach the app |
| **Kubernetes ingress / Gateway API** | in the cluster | routing to services by host and path, TLS | many controllers (nginx-based, Traefik, Envoy, cloud ones); the Gateway API is the newer, more expressive standard |
| **AWS ALB, CloudFront** | layer 7 / edge | the AWS equivalents of Application Gateway and Front Door | same forwarded-header rules |
| **Cloudflare** | edge | CDN, WAF, DDoS protection, TLS | real client IP in `CF-Connecting-IP`; restore it in the app or in nginx |

**Two rules for any managed front door:**

1. **Lock the origin.** If your app or server also accepts traffic directly from the internet, attackers can bypass the WAF and rate limits by going around the front door. Restrict the origin to the front door's IP ranges or a private link, and check the header it adds that proves the request came through your instance.
2. **Know how many proxies are in front of you.** CDN → Application Gateway → nginx → Kestrel is three hops, so `ForwardLimit` and the trusted networks must match ([Request journey](ch:request-journey#what-each-hop-changes-and-how-your-app-gets-the-originals-ba)).

## Choosing {i}

| Kettle's situation | Choice |
|---|---|
| One Linux server, a team that likes explicit configuration | **nginx** with certbot |
| One server, small team, wants the least to look after | **Caddy** |
| A Docker host where containers change often | **Traefik**, or Caddy with Docker labels via a plugin |
| An API gateway or BFF with real logic in front of services | **YARP**, behind a TLS-terminating front |
| Windows Server, intranet, Windows authentication | **IIS** with ANCM |
| On Azure App Service or Container Apps | the **platform's front end**, plus Front Door if you need global edge and WAF |
| Kubernetes | an **ingress controller** or Gateway API implementation |

It's common to combine them: Cloudflare or Front Door at the edge, a cloud load balancer, then YARP as the gateway, then Kestrel. The more layers, the more important it is to know each one's timeouts and forwarded headers.

## Interview questions {i}

:::qa nginx vs Caddy vs Traefik vs YARP: how do you choose?
nginx is the most widely used text-configured proxy and suits Linux servers where you want explicit control. Caddy automates certificates and has the simplest config, good for small setups. Traefik discovers backends from Docker or Kubernetes and configures routes from labels, good for dynamic container environments. YARP is a C# library for building proxies inside ASP.NET Core, good for gateways and BFFs needing custom logic, usually behind a TLS-terminating front.
:::

:::qa What's the difference between IIS in-process and out-of-process hosting?
In-process runs the app inside the IIS worker process using the IIS HTTP Server instead of Kestrel, avoiding a hop, and is the default. Out-of-process runs the app as a separate Kestrel process with IIS acting as a reverse proxy. In both, `web.config` configures only IIS and the ASP.NET Core Module, not the application's settings.
:::

:::qa How do you deploy a new version to IIS without file-lock errors?
Drop an `app_offline.htm` file into the site, which makes the ASP.NET Core Module stop the app gracefully and serve that page, copy the new files, then remove it. Deployment tools such as Web Deploy automate this. For true zero downtime, run several servers behind a load balancer and update them one at a time.
:::

:::qa How do you secure an origin behind a CDN or Front Door?
Restrict the origin so it accepts traffic only from the front door, using its published IP ranges, a private link, or both, and verify the identifying header it adds. Otherwise attackers can reach the origin directly and bypass the WAF, rate limits and caching. Configure forwarded headers for the exact number of proxies in front of the app.
:::

## Next episode {b}

Kettle has picked its proxy. Now the whole server: a fresh Linux machine, from first login to a live HTTPS site with automatic certificate renewal, deployments, rollbacks and backups. [Episode 4 · Deploying to a Linux server →](ch:linux-deploy)

## Further reading

- [Caddy reverse proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy)
- [Traefik Docker provider](https://doc.traefik.io/traefik/providers/docker/)
- [YARP documentation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/yarp-overview)
- [Host ASP.NET Core on Windows with IIS](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/iis/)
- [Troubleshoot ASP.NET Core on IIS](https://learn.microsoft.com/en-us/aspnet/core/test/troubleshoot-azure-iis)
