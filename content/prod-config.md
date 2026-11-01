---
id: prod-config
title: "Production Configuration and Choosing Where to Host"
summary: "The settings that only matter once real traffic arrives, and why each one matters. Covers startup validation, Kestrel limits and request timeouts, HTTPS, HSTS and security headers, liveness, readiness and startup health checks, graceful shutdown across systemd, Docker, Kubernetes and App Service, production logging, GC modes and DATAS, thread-pool starvation, globalization and time zones in containers, connection pools, warm-up, and a decision guide for where to host. Ends with a one-page go-live checklist."
layer: infra
where: Hosting › Production configuration
fits: "The app-side half of hosting. It pulls together [Configuration](ch:configuration-options), [Resilience](ch:resilience), [Memory & GC](ch:memory-gc), [Web security](ch:web-security) and [Observability](ch:observability-aspire) into one pre-launch pass. The decision guide leads into [Cloud](ch:cloud-story)."
levels: i,a
prereqs: containers-single-host
next: cloud-story
---

## The 30-second version

- **Fail at startup, not at 3 a.m.**: validate configuration and dependency injection when the app starts.
- **Bound everything**: request size, request time, connections, outgoing call timeouts. Every unbounded thing becomes an outage under load.
- **Health checks have three jobs**: *live* (restart me), *ready* (send me traffic), *started* (still booting). Mixing them up causes restart loops and outages.
- **Shutdown timeouts must nest**: the app's < the supervisor's < the platform's. And the load balancer must stop sending traffic before the app stops accepting it.
- **Logging**: Information for your code, Warning for the framework, structured, no secrets or personal data.
- **Runtime**: Server GC (with DATAS on .NET 9+), never block on async, containers need the right globalization and time-zone data.
- **Choose hosting** by how much you want to operate yourself, not by what's fashionable.

## Previously at Kettle {b}

Kettle is deployed, behind a proxy, in containers, with backups. Before the marketing launch, the CTO asks for a go-live review: "Show me that the app itself is ready for ten times today's traffic, a bad deploy, and a slow database."

**The problem:** the app works in staging with a handful of users. Production settings only show their value, or their absence, under load and during failures.

**This episode:** a walk through each production setting, the failure it prevents, and finally where Kettle should run next.

## Start from zero: why production needs different settings {b}

:::plain
In development you want helpful errors and nothing in your way. In production you want the opposite: hide internal details, put limits on everything, and make problems show up early and loudly.
:::

| | Development | Production |
|---|---|---|
| Error details | full stack traces in the browser | a generic ProblemDetails response; details only in logs |
| Limits | none, so they don't get in the way | on body size, time, connections, rates |
| Logging | Debug, to the console | Information or Warning, structured, shipped centrally |
| Configuration errors | found when a page is used | found at startup, so a bad deploy never takes traffic |
| Swagger UI | on | off, or behind authentication |
| Secrets | user secrets on your laptop | a secret store or mounted files |

All of this hangs off one setting, **`ASPNETCORE_ENVIRONMENT=Production`** (which is also the default when nothing is set). Check that it's really set on every server: a production app running as `Development` shows stack traces, including connection details, to anyone ([Hosting: environments](ch:aspnet-hosting)).

## Fail fast at startup {i}

:::plain
If a setting is missing or wrong, the app should refuse to start, so the deploy fails and the old version keeps running. Far better than starting fine and failing on the first real request.
:::

```csharp norun
builder.Services.AddOptions<PaymentsOptions>()
    .BindConfiguration("Payments")
    .ValidateDataAnnotations()                     // [Required], [Url], [Range] on the options class
    .Validate(o => o.TimeoutSeconds is > 0 and <= 30, "Payments:TimeoutSeconds must be 1-30")
    .ValidateOnStart();                            // check now, not on first use

builder.Host.UseDefaultServiceProvider(o =>
{
    o.ValidateScopes = true;                       // catches a scoped service captured by a singleton
    o.ValidateOnBuild = true;                      // every registration can actually be constructed
});
```

- **`ValidateOnStart`**: without it, options are validated the first time something asks for them, which might be the first checkout an hour after deploy.
- **`ValidateOnBuild` / `ValidateScopes`** are on by default only in Development. Turning them on in Production costs a little startup time and catches a whole class of bugs ([Dependency injection](ch:dependency-injection)).
- Combined with the readiness check in the deploy script, a misconfigured release fails its deploy and never sees a user.

## Bound everything: Kestrel limits and timeouts {i}

:::plain
Every request should have a maximum size and a maximum time. Without limits, a few slow or huge requests can tie up the whole server.
:::

Kestrel's defaults, and what Kettle sets:

| Setting | Default | Kettle | Why |
|---|---|---|---|
| `MaxRequestBodySize` | ~28.6 MB (30,000,000 bytes) | 1 MB globally, 20 MB on the upload endpoint | most endpoints take small JSON; large bodies only where expected |
| `MaxRequestHeadersTotalSize` | 32 KB | default | big enough for cookies and tokens |
| `RequestHeadersTimeout` | 30 s | 15 s | a client that dribbles headers holds a connection (slowloris) |
| `KeepAliveTimeout` | 130 s | shorter than the proxy's upstream keepalive | avoids the proxy reusing a connection Kestrel just closed (a source of rare 502s) |
| `MinRequestBodyDataRate` | 240 bytes/s after 5 s grace | default | drops clients that upload absurdly slowly |
| `MaxConcurrentConnections` | unlimited | set only with load-test evidence | a cap turns overload into fast rejections rather than everything slowing down |
| `AddServerHeader` | true | false | no need to advertise "Kestrel" |

```csharp norun
builder.WebHost.ConfigureKestrel(k =>
{
    k.AddServerHeader = false;
    k.Limits.MaxRequestBodySize = 1 * 1024 * 1024;
    k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
});

// Per endpoint: a bigger body only where needed
app.MapPost("/products/{id}/images", UploadImage)
   .WithMetadata(new RequestSizeLimitAttribute(20 * 1024 * 1024));
```

**Request timeouts.** Kestrel doesn't limit how long a handler may run. The request timeouts middleware does, by cancelling `HttpContext.RequestAborted` ([details](ch:caching-ratelimit-cors#response-compression-and-request-timeouts)):

```csharp norun
builder.Services.AddRequestTimeouts(o =>
    o.DefaultPolicy = new RequestTimeoutPolicy { Timeout = TimeSpan.FromSeconds(10) });
app.UseRequestTimeouts();
app.MapGet("/reports/monthly", BuildReport).WithRequestTimeout(TimeSpan.FromSeconds(60));
```

It only works if your code **passes the cancellation token down**, to EF Core queries, `HttpClient` calls and anything else that waits. A handler that ignores the token keeps running after the timeout. Also: the middleware does nothing while a debugger is attached, so test it without one.

**Outgoing calls need limits too.** Every `HttpClient` gets a timeout and a resilience pipeline (`AddStandardResilienceHandler`), and every database command a command timeout. The rule from the [request journey](ch:request-journey#timeouts-stack-up): each layer's timeout is shorter than the one calling it, so the innermost layer gives up first and returns a clear error instead of the proxy returning a vague 504.

## HTTPS, HSTS and security headers {i}

- **Behind a TLS-terminating proxy**: configure forwarded headers first ([nginx chapter](ch:reverse-proxy-nginx#the-app-side-forwarded-headers-in-asp-net-core)). Then `UseHsts()` and `UseHttpsRedirection()` see the real scheme. Without it, `UseHttpsRedirection` can loop forever, and generated links point to `http://`.
- **HSTS**: `max-age` of at least a year once you're sure HTTPS works everywhere; `includeSubDomains` only if every subdomain has HTTPS; `preload` only after reading what it commits you to, because removal takes months.
- **Security headers** for anything that serves HTML: `Content-Security-Policy` (the important one, which limits where scripts can come from), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `frame-ancestors 'none'` in the CSP to stop clickjacking. Pure JSON APIs need few of them; HSTS and `nosniff` are enough ([Web security](ch:web-security#transport-security-and-security-headers)).
- **Set them in one place.** Either the proxy or the app sets each header, not both, or you get duplicates (the nginx `add_header` inheritance trap makes that easy to get wrong).
- **CORS** is not a security header for your server. It's permission for browsers to call you from other origins; keep the allowed origin list explicit ([CORS](ch:caching-ratelimit-cors)).

## Health checks: live, ready, started {i}

:::plain
A health check answers a question for whoever is asking. "Should I restart you?" and "should I send you traffic?" are different questions, and they need different endpoints.
:::

| Endpoint | Question | Checks | Failure means |
|---|---|---|---|
| `/health/live` | is the process stuck? | nothing external: the app can respond at all | restart the container or process |
| `/health/ready` | can it serve requests now? | database, required caches, anything without which requests fail | stop sending traffic, but don't restart |
| `/health/startup` (Kubernetes) | has it finished starting? | warm-up done, migrations checked | keep waiting; don't apply liveness yet |

```csharp norun
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(connectionString, tags: ["ready"])
    .AddCheck<WarmupHealthCheck>("warmup", tags: ["ready", "startup"]);

app.MapHealthChecks("/health/live",  new() { Predicate = r => r.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") });
```

:::gotcha The database in the liveness check
If `/health/live` checks the database, a 30-second database blip makes the platform restart **every** instance at once. They all come back cold, all reconnect at once and hit the database hard, and it takes much longer to recover. Dependencies belong in readiness only. Liveness asks one thing: is this process broken in a way a restart would fix?
:::

Other rules: keep checks cheap and quick (they run every few seconds on every instance); don't expose detailed health output publicly (it tells attackers your dependencies), so map the endpoints on a separate port or require authorization for the detailed version; and don't check *other services'* health in readiness, or one service's failure takes down every service that depends on it ([Resilience: health checks](ch:resilience#health-checks)).

## Graceful shutdown, end to end {a}

:::plain
When the platform wants to stop your app, it first stops sending it traffic, then asks it to stop, waits, and finally kills it. Your timeouts must fit inside the platform's, or requests get cut off mid-flight.
:::

What happens when an instance stops, on any platform:

1. The **load balancer or proxy stops sending new requests** to it.
2. The process gets **SIGTERM**. The .NET host fires `ApplicationStopping`, Kestrel stops accepting connections and waits for in-flight requests, and hosted services get their `stoppingToken` cancelled.
3. The host waits up to **`HostOptions.ShutdownTimeout`** (30 s by default), then exits.
4. If the process is still running when the **platform's grace period** ends, it gets **SIGKILL**.

| Platform | Grace period setting | Default |
|---|---|---|
| systemd | `TimeoutStopSec` | 90 s |
| Docker / Compose | `stop_grace_period` / `docker stop -t` | **10 s** |
| Kubernetes | `terminationGracePeriodSeconds` | 30 s |
| Azure Container Apps | `terminationGracePeriodSeconds` on the template | 30 s |

**The Kubernetes race.** Steps 1 and 2 happen *at the same time* in Kubernetes: removing the pod from the endpoints and sending SIGTERM are separate, parallel actions. For a second or two the pod is shutting down while ingress controllers and other nodes still send it requests, which fail. The standard fix is a short delay before shutdown starts, either a `preStop` hook (`sleep 5`, or the native `sleep` action in recent Kubernetes versions) or a delay in the app's `ApplicationStopping`. Then set `terminationGracePeriodSeconds` larger than the delay plus `ShutdownTimeout` ([Kubernetes](ch:kubernetes)).

**Background work must cooperate.** A `BackgroundService` that ignores `stoppingToken` holds up shutdown until it's killed. Long jobs should check the token, stop at a safe point, and leave work in a state another instance can pick up (an outbox, a message that's not yet acknowledged) ([Background work](ch:background-work)).

```csharp norun
builder.Services.Configure<HostOptions>(o =>
{
    o.ShutdownTimeout = TimeSpan.FromSeconds(25);                                // < platform grace period
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.StopHost; // the default since .NET 6: crash loudly
});
```

## Logging in production {i}

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning",
      "System.Net.Http.HttpClient": "Warning"
    }
  }
}
```

- **Framework categories at Warning.** At Information, ASP.NET Core and `HttpClient` log several lines per request, which multiplies log volume and cost and buries your own messages. Turn a category up temporarily when investigating.
- **EF Core command logging off** in production: every SQL statement at Information is a lot of volume, and with `EnableSensitiveDataLogging` it would log parameter values, meaning personal data.
- **Structured, with correlation.** JSON to the console, picked up by the platform, or OpenTelemetry logs exported directly. Every line carries the trace ID so you can jump from a log line to the whole request ([Observability](ch:observability-aspire)).
- **Never log** passwords, tokens, full card numbers, or personal data you don't need. Treat logs as data that gets copied, retained and read widely ([What to log](ch:errors-logging#what-to-log-and-what-never-to-log)).
- **Change levels without redeploying**: log levels come from configuration and reload on change, so Kettle can turn up one category on one environment for an hour.

## Runtime: GC, threads and memory {a}

**GC mode.** ASP.NET Core apps use **Server GC** by default: a heap and a GC thread per core, which gives the best throughput. Since **.NET 9**, Server GC uses **DATAS** (dynamic adaptation to application sizes) by default: it starts with one heap and adds heaps as load grows, so a lightly loaded app no longer reserves memory as if it were busy. For many small containers on one machine, DATAS (or Workstation GC on .NET 8) keeps memory per container low ([Memory & GC: choosing how the GC behaves](ch:memory-gc)).

**Containers.** .NET reads the container's memory and CPU limits: the GC heap limit defaults to 75% of the memory limit, and `Environment.ProcessorCount` reflects the CPU limit. Always set a memory limit; without one, the app sees all of the host's memory and an out-of-memory kill comes without warning.

**Thread-pool starvation** is the most common way a .NET service falls over under load:

- **Symptom:** latency climbs to seconds, CPU stays *low*, and the thread count climbs slowly (the pool adds threads gradually). Health checks time out, so the platform restarts instances, which makes it worse.
- **Cause:** blocking on async code (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`) or long synchronous I/O on pool threads, so threads are held while they wait ([Threading](ch:threading-concurrency)).
- **Diagnosis:** `dotnet-counters monitor -n Kettle.Api` shows `ThreadPool Queue Length` growing and `ThreadPool Thread Count` rising; a `dotnet-stack` or dump shows many threads blocked in `Wait`.
- **Fix:** make the call path async all the way. Raising `ThreadPool.SetMinThreads` only hides it for a while.

**Tiered compilation and Dynamic PGO** are on by default and make code faster after it has run for a while, which is one reason the first requests after a deploy are slower (see warm-up below).

## Globalization, culture and time {a}

- **Run on UTC**, store `DateTimeOffset` or UTC `DateTime`, and convert to a user's time zone only at the edge (display, or business rules that really are local, like "orders before 2 p.m. ship today"). Use `TimeProvider` so time-dependent code can be tested ([Everyday types](ch:everyday-types)).
- **Time zone data:** `TimeZoneInfo.FindSystemTimeZoneById("Europe/London")` needs tzdata in the container. Chiseled .NET images don't include it; use the `-extra` image variants, or install `tzdata`.
- **Culture data (ICU):** the same applies to ICU, which .NET uses for culture-aware formatting and comparison. Without it, apps either fail at startup or must run with `InvariantGlobalization=true`. That's fine for a pure API that formats nothing for humans, but culture-specific formatting then silently becomes invariant.
- **Don't rely on the server's culture.** Parse and format machine data (CSV, protocols, logs) with `CultureInfo.InvariantCulture`. A server set to a culture where `,` is the decimal separator turns `1.5` into `15` in naive parsing code.

## Connections, pools and warm-up {a}

- **Database pools.** Npgsql and SqlClient keep up to **100** connections per connection string per process by default. Four instances × 100 = 400 possible connections, which can exceed what the database allows (Postgres defaults to 100 `max_connections`). Size `Max Pool Size` per instance from the database's limit, or put PgBouncer in front ([EF Core in production](ch:efcore-advanced)).
- **HttpClient**: through `IHttpClientFactory` or a long-lived client with `PooledConnectionLifetime`, never `new HttpClient()` per request, which exhausts sockets ([HTTP clients](ch:http-client)).
- **Warm-up.** The first requests after start are slow: JIT compilation, EF Core model building, connection pools opening, caches empty. Gate readiness on a warm-up check that runs representative queries and calls, publish with **ReadyToRun** to cut JIT time, and consider an EF Core compiled model for big models ([Startup performance](ch:performance-engineering#startup-performance)).
- **Rate limiting and backpressure**: decide what the app does at capacity, before it gets there. Reject fast with 429 or 503 and `Retry-After` rather than queueing until everything times out ([Rate limiting](ch:caching-ratelimit-cors#rate-limiting-protecting-the-api-from-its-own-popularity)).

## Choosing where to host {i}

:::plain
Every hosting option trades money and control against how much work you do yourself. Start with the least work that meets your needs, and move when a real need appears.
:::

| Option | You operate | Good for | Watch out for |
|---|---|---|---|
| **One VM** (systemd + nginx) | OS, patches, proxy, backups, everything | small products, tight budgets, learning | single point of failure; all ops is yours |
| **VM + Docker Compose** | OS, Docker, the compose file | small teams wanting reproducible deploys | no failover or rolling updates across hosts |
| **Azure App Service** (or AWS Elastic Beanstalk) | the app and its settings | classic web apps and APIs; deployment slots for zero-downtime swaps | less control over the OS and networking; plan pricing |
| **Azure Container Apps** (or AWS App Runner / ECS Fargate) | container images, scaling rules | containerised APIs and workers; scale to zero; Dapr and KEDA built in | per-second billing adds up for always-busy services |
| **Kubernetes** (AKS, EKS, GKE) | cluster add-ons, upgrades, manifests, policies | many services and teams, a platform team to own it | real operational cost; easy to over-adopt |
| **Functions / serverless** | functions and triggers | event-driven, spiky or occasional work | cold starts, execution limits, a different programming model |

How Kettle decides:

- **Who's on call?** Two developers and no ops team means managed platforms. Every component you run yourself is one you patch, back up and get paged for.
- **What does downtime cost?** If an hour down is an annoyance, one server is fine. If it's lost revenue, you need at least two instances, a managed database with failover, and zero-downtime deploys.
- **Traffic shape.** Steady traffic favours reserved VMs or plans (cheaper per hour). Spiky or mostly idle traffic favours scale-to-zero platforms.
- **Compliance and data residency** may decide the region and the provider for you.
- **Cost of the whole system**, not just compute: a managed Postgres often costs more than the app servers, and people's time costs more than both.

Kettle's choice: Azure Container Apps for the API and workers (the same images as on the Compose host), Azure Database for PostgreSQL Flexible Server, Front Door in front. Kubernetes only if the number of services and teams grows enough to justify a platform team. The [Cloud part](ch:cloud-story) builds that.

## The go-live checklist {i}

**Configuration and startup**
- [ ] `ASPNETCORE_ENVIRONMENT=Production` confirmed on every instance
- [ ] Options validated with `ValidateOnStart`; DI validated on build
- [ ] Secrets from a secret store or mounted files, none in images, repos or `appsettings.*.json`
- [ ] Swagger UI and developer pages off (or behind auth)

**Traffic**
- [ ] Forwarded headers with known proxies; `AllowedHosts` set
- [ ] HTTPS redirect and HSTS; certificates auto-renew; expiry monitored
- [ ] Body size, header and request time limits; cancellation tokens passed down
- [ ] Outgoing calls have timeouts and resilience; each layer's timeout shorter than the one above
- [ ] Rate limits on public and expensive endpoints

**Health and lifecycle**
- [ ] Separate liveness and readiness; no dependencies in liveness
- [ ] Shutdown timeouts nest: app < supervisor < platform; Kubernetes preStop delay
- [ ] Background services honour cancellation
- [ ] Zero-downtime deploys and a rehearsed rollback; migrations backward compatible

**State and data**
- [ ] Data Protection keys persisted and shared
- [ ] Backups off-site, alerting on failure, restore tested, RPO/RTO agreed
- [ ] Connection pool sizes fit the database's limits

**Observability**
- [ ] Structured logs with trace IDs, shipped centrally; framework categories at Warning; no secrets or personal data
- [ ] Metrics and traces exported; dashboards for rate, errors, latency, saturation
- [ ] External uptime check; alerts that go to a person, for things a person must act on
- [ ] A runbook for the top three failure modes

**Runtime**
- [ ] Memory limit set; GC mode suits the deployment; no sync-over-async
- [ ] UTC everywhere; tzdata and ICU present or deliberately invariant
- [ ] Warm-up gates readiness; ReadyToRun if startup matters
- [ ] Load-tested at expected peak × 2, with the failure behaviour observed

## Interview questions {i}

:::qa What's the difference between liveness and readiness checks, and why does it matter?
Liveness answers whether the process is broken in a way a restart fixes; readiness answers whether it can serve traffic right now. Dependencies such as the database belong only in readiness. Put them in liveness and a dependency outage makes the platform restart every instance at once, turning a short blip into a long outage with a thundering herd on recovery.
:::

:::qa How do you make sure a deploy doesn't drop in-flight requests?
Remove the instance from the load balancer before it stops (in Kubernetes, a preStop delay to cover endpoint propagation), handle SIGTERM with graceful shutdown so in-flight requests finish, keep `HostOptions.ShutdownTimeout` shorter than the platform's grace period, and make background services honour cancellation. Combine with rolling or blue/green deployment and readiness checks so new instances only get traffic when ready.
:::

:::qa Latency spikes under load but CPU is low. What do you suspect?
Thread-pool starvation, usually from blocking on async code or synchronous I/O on pool threads. Confirm with `dotnet-counters` (queue length rising, thread count climbing slowly) and a stack dump showing blocked threads. Fix by making the path async end to end; raising minimum threads only masks it. Also check connection pool exhaustion, which looks similar.
:::

:::qa How would you choose between App Service, Container Apps and Kubernetes?
By how much the team wants to operate and what the system needs. App Service suits conventional web apps with little ops overhead and deployment slots. Container Apps suits containerised APIs and workers that need autoscaling, including to zero, without running a cluster. Kubernetes suits many services and teams with a platform team that can own the cluster's operational cost. Start with the least operational burden that meets the requirements.
:::

:::qa What would you check before taking a .NET service to production?
Configuration validated at startup and secrets in a store; forwarded headers, HTTPS and HSTS; limits and timeouts at every layer; separate liveness and readiness checks; graceful shutdown that fits the platform; persisted Data Protection keys; tested backups; structured logs, metrics and traces with alerts; and a load test showing behaviour at and beyond expected peak.
:::

## Next episode {b}

Kettle has outgrown one server: the CTO approves the cloud budget, and the go-live review chose Container Apps, managed Postgres and Front Door. Part XI moves Kettle to Azure, piece by piece. [Part XI · Kettle Moves to the Cloud →](ch:cloud-story)

## Further reading

- [Configure options for Kestrel](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options)
- [Health checks in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks)
- [Kubernetes: pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [Runtime configuration options for garbage collection](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector)
- [Debug thread-pool starvation](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-threadpool-starvation)
- [Globalization invariant mode](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization)
