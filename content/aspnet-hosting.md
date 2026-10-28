---
id: aspnet-hosting
title: ASP.NET Core Architecture and Hosting
summary: What ASP.NET Core is made of, the Generic Host and WebApplication, the two phases of Program.cs, Kestrel and reverse proxies, IIS and in-process hosting, environments, the application lifetime and graceful shutdown.
layer: framework
where: ASP.NET Core › Hosting › Program.cs, Host & Kestrel
fits: This is the entry point of layer 3. The **host** is the object that owns the three pieces of plumbing every other ASP.NET Core chapter uses (DI, configuration and logging) and runs the web server. If you understand this chapter, `Program.cs` becomes a readable table of contents for the whole application.
levels: b,i,a
prereqs: big-picture, delegates-events, async-await
next: dependency-injection, configuration-options, middleware
---

## TL;DR

- ASP.NET Core is just a console app with **Kestrel** (a built-in web server) baked in — no separate IIS/Apache process required.
- `Program.cs` has two phases: register services/config *before* `builder.Build()`, configure the request pipeline *after* it. Once built, you can't add more DI registrations.
- Production traffic almost always goes through a reverse proxy in front of Kestrel (for TLS, load balancing, a WAF). You must explicitly trust forwarded headers, or the client's real IP/scheme gets scrambled.
- The environment name (`ASPNETCORE_ENVIRONMENT`) should only ever change *configuration*, never which code path runs.
- Shutdown is graceful: Kestrel stops accepting new requests, finishes in-flight ones, then hosted services get a chance to stop — all within a time budget.
- `HttpContext` carries everything about one request, including `RequestServices` (that request's DI scope). It's not thread-safe and dies with the request.

## A surprising fact to start from {b}

Here's something worth sitting with before anything else in this chapter: **ASP.NET Core isn't a server you deploy your code into.** There's no separate "IIS" or "Apache" process hosting your app from the outside, the way classic ASP.NET or PHP worked. **ASP.NET Core is a set of libraries** — the `Microsoft.AspNetCore.App` shared framework — that your code references, and your app is, underneath it all, an ordinary console program. One that happens to contain its own complete web server, listening on a socket, running inside the exact same process as your business logic.

That single fact explains a lot of what follows in this chapter: why `Program.cs` looks like it's both "configuring services" and "starting a server" in the same file, why you can set a breakpoint anywhere in a request handler and step straight through into framework code with no process boundary in the way, and why the whole thing can be packaged into one small container image with nothing else installed.

```text
┌──────────────────────────── Your ASP.NET Core application ────────────────────────────┐
│                                                                                        │
│   Program.cs ─▶ WebApplicationBuilder ─▶ WebApplication (the host)                    │
│                     │                         │                                       │
│        ┌────────────┼──────────────┐          ├── Kestrel web server (listens on ports) │
│        ▼            ▼              ▼          ├── Middleware pipeline                   │
│   Configuration   Logging   DI container      └── Endpoints (routing)                   │
│   (IConfiguration)(ILogger) (IServiceProvider)        ├── Minimal APIs                  │
│                                                        ├── Controllers (MVC)            │
│                                                        ├── Razor Pages / Blazor         │
│                                                        ├── SignalR hubs / gRPC services │
│                                                        └── Health checks …              │
│   Hosted services (BackgroundService) run alongside the web server                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## The Generic Host: the thing that owns everything else {i}

Before there's a web server, routing, or anything web-specific at all, there's a **host** — an object whose entire job is owning an app's shared resources and its lifetime:

- the **DI container** (`IServiceProvider`),
- **configuration** (`IConfiguration`),
- **logging** (`ILoggerFactory`),
- the **environment** (`IHostEnvironment`: name, content root),
- **hosted services** (`IHostedService`), which it starts and stops — and, as you'll see shortly, the web server itself is just one of these,
- **lifetime** management (`IHostApplicationLifetime`) and graceful shutdown.

This "Generic Host" (`Microsoft.Extensions.Hosting`) isn't actually web-specific at all — it's the same host a **Worker Service** uses, with no HTTP involved anywhere:

```csharp
// A worker service: same host, same DI/config/logging, no HTTP
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<QueueProcessor>();
builder.Build().Run();
```

ASP.NET Core doesn't replace this host with something different — it **adds the web-specific parts on top** of the exact same foundation. Since .NET 6, **`WebApplication`** is the simplified API for that combination (the "minimal hosting model"): it's simultaneously an `IHost` *and* the object you configure your middleware pipeline and endpoints through.

:::fits Generic Host vs WebApplication vs Startup.cs — recognising older code
- **.NET Core 2.x–5:** `Program.cs` built a host with `Host.CreateDefaultBuilder().ConfigureWebHostDefaults(...)`, and a separate **`Startup`** class had `ConfigureServices(IServiceCollection)` and `Configure(IApplicationBuilder)`.
- **.NET 6+:** `WebApplication.CreateBuilder(args)`, all in `Program.cs`. Same two phases, less ceremony.

When you read older code, `ConfigureServices` = phase 1 and `Configure` = phase 2 below — the two-phase shape hasn't actually changed, only the syntax wrapping it has.
:::

## The two phases of Program.cs, and why the split matters {b}

```csharp
var builder = WebApplication.CreateBuilder(args);

// ═════════ PHASE 1: describe services and configuration (nothing runs yet) ═════════
// builder.Configuration  → IConfigurationManager (sources already loaded: json, env vars, args)
// builder.Logging        → ILoggingBuilder
// builder.Services       → IServiceCollection (the DI registrations "recipe list")
// builder.Environment    → IWebHostEnvironment
// builder.WebHost        → Kestrel / web host settings
// builder.Host           → generic host settings

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();
builder.Services.AddDbContext<ShopDb>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Shop")));
builder.Services.AddOrdering();                 // your own extension method per feature/layer

var app = builder.Build();                      // ← the DI container is BUILT here and locked

// ═════════ PHASE 2: configure the request pipeline (order matters!) ═════════
if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok());
app.MapOrderEndpoints();

app.Run();                                      // ← starts Kestrel + hosted services, blocks until shutdown
```

Notice `var app = builder.Build();` sitting almost exactly in the middle — that one line is a genuine, hard boundary, not just a visual one, and understanding *why* explains most of the "gotchas" later in this section. **Phase 1**, everything before `Build()`, is purely declarative: you're handing the builder a recipe list — "when something needs an `IOrderRepository`, give it an `EfOrderRepository`" — and nothing is actually constructed yet. **Phase 2**, everything after, is where the actual request pipeline gets assembled, in the exact order you write it, because that order becomes the literal order requests flow through later.

| Phase | Object | You do | Chapter |
|---|---|---|---|
| 1 | `builder.Services` | Register services and their lifetimes | [DI](ch:dependency-injection) |
| 1 | `builder.Configuration` | Add config sources, bind options | [Configuration](ch:configuration-options) |
| 1 | `builder.Logging` | Configure providers and levels | [Errors & logging](ch:errors-logging) |
| — | `builder.Build()` | Creates the `IServiceProvider`; registrations frozen | |
| 2 | `app.Use…()` | Add middleware, **in order** | [Middleware](ch:middleware) |
| 2 | `app.Map…()` | Define endpoints | [Routing](ch:routing), [Building APIs](ch:building-apis) |
| — | `app.Run()` | Start the server | |

:::gotcha Three mistakes that fall directly out of misunderstanding the phase boundary
- Calling `builder.Services.Add…` **after** `Build()` throws, because the moment the container is built, the recipe list is frozen — there's no "add one more registration" operation on an already-constructed `IServiceProvider`.
- Resolving a service in phase 1 by calling `builder.Services.BuildServiceProvider()` doesn't give you early access to the real container — it silently builds a **second, entirely separate container**, so any singleton you touch through it gets constructed twice, once in each container, with two independent instances quietly diverging from that point on. Analyzer ASP0000 specifically warns about this.
- Getting the **order** wrong in phase 2 produces no error at all, just silently wrong behaviour — placing `UseAuthorization` before `UseAuthentication`, for instance, means every single request looks anonymous, with nothing in the compiler or the running app to tell you why.
:::

### What CreateBuilder quietly sets up for you

`WebApplication.CreateBuilder(args)` isn't a blank slate — it arrives with a set of sensible defaults already wired in, worth knowing explicitly rather than discovering by accident:

- **Content root** = current directory; **web root** = `wwwroot`.
- **Configuration** sources: `appsettings.json` → `appsettings.{Environment}.json` → User Secrets (Development) → environment variables → command-line args.
- **Logging** providers: Console, Debug, EventSource (and EventLog on Windows), configured from the `Logging` config section.
- **Kestrel** as the server, configured from the `Kestrel` config section.
- **DI validation** (`ValidateScopes`, `ValidateOnBuild`) in Development — this is precisely the mechanism [Dependency injection](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug) relies on to catch a captive dependency at startup rather than letting it surface as a confusing runtime bug.
- Routing, plus a developer exception page in Development (implicitly).

Two variants exist for when you want fewer of these defaults: `WebApplication.CreateSlimBuilder(args)` trims the defaults down for a smaller, AOT-friendly footprint, and `CreateEmptyBuilder` gives you essentially nothing pre-configured at all.

## Kestrel: the web server that's actually inside your process {b}

**Kestrel** is the cross-platform HTTP server mentioned at the very start of this chapter — the thing that makes "your app is a console program containing its own web server" literally true. It:

- listens on sockets (TCP; QUIC for HTTP/3),
- handles **TLS**,
- parses **HTTP/1.1, HTTP/2 and HTTP/3**,
- builds an `HttpContext` for each request and passes it to your middleware pipeline,
- is built on `System.IO.Pipelines` — the same pooled-buffer I/O abstraction mentioned in [Advanced C#](ch:advanced-csharp#pooling-buffers-paying-the-allocation-cost-once-instead-of-e) — for high throughput with minimal per-request allocation.

```csharp
builder.WebHost.ConfigureKestrel(k =>
{
    k.Limits.MaxRequestBodySize = 10 * 1024 * 1024;     // 10 MB
    k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
    k.AddServerHeader = false;                          // don't advertise "Server: Kestrel"
});
```

```json
// or in appsettings.json
"Kestrel": {
  "Endpoints": {
    "Http":  { "Url": "http://0.0.0.0:8080" },
    "Https": { "Url": "https://0.0.0.0:8443", "Certificate": { "Path": "cert.pfx", "Password": "…" } }
  }
}
```

The listening URL itself can come from several different places, in practice usually chosen by whichever hosting environment you're actually deploying to: `ASPNETCORE_URLS`, `ASPNETCORE_HTTP_PORTS` (defaulting to **8080** in the official .NET 8+ container images), `--urls` on the command line, or `launchSettings.json` specifically in development.

## Why production traffic rarely hits Kestrel directly {i}

Given that Kestrel is a genuinely capable, hardened web server on its own, why does nearly every production deployment still put something in front of it?

```text
Internet ─▶ [ CDN / WAF ] ─▶ [ Reverse proxy / load balancer ] ─▶ Kestrel (instance 1)
                              Azure Front Door, App Gateway,     ─▶ Kestrel (instance 2)
                              Nginx, YARP, IIS, K8s ingress       ─▶ Kestrel (instance 3)
```

The proxy isn't compensating for a Kestrel weakness — it's **centralising** concerns that would otherwise have to be duplicated across every single instance of your app: terminating TLS once instead of in each process, balancing load across instances, routing many different apps behind one public IP, caching, adding a WAF, and enforcing request rate limits at the edge before traffic ever reaches your code at all.

Putting something in front of Kestrel does have one real consequence. As far as the TCP connection is concerned, the proxy *is* the client — so every request now appears to come from the **proxy's** IP address and scheme, not the real visitor's. The proxy compensates by adding `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` headers carrying the *real* client's information. But your app has to explicitly **opt in** to trusting those headers. Skip that, and `HttpContext.Connection.RemoteIpAddress`, HTTPS redirection, and any URL your app generates will all be subtly wrong — reflecting the proxy's identity instead of the real client's:

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Add(IPAddress.Parse("10.0.0.4"));    // only trust your proxy
});
app.UseForwardedHeaders();                               // FIRST in the pipeline
```

That `KnownProxies` line matters more than it looks. Without it, any client could forge their own `X-Forwarded-For` header and have your app believe whatever IP they claimed. The mechanism only stays trustworthy if you only honour it when it comes from a proxy you actually control. (Azure App Service and many managed hosts already enable this correctly for you — worth knowing, so you don't accidentally configure it twice.)

**YARP** ("Yet Another Reverse Proxy") is Microsoft's own reverse-proxy library, built on ASP.NET Core itself, commonly reached for specifically for API gateways and the BFF pattern — a reverse proxy written in the same stack and language as the apps it's proxying to.

## IIS hosting on Windows {i}

On Windows servers specifically, IIS can still host ASP.NET Core, via the **ASP.NET Core Module (ANCM)**, in one of two genuinely different shapes:

| Model | How | Notes |
|---|---|---|
| **In-process** (default) | The app runs **inside** the IIS worker process (`w3wp.exe`) using the IIS HTTP server instead of Kestrel | Fastest on IIS |
| **Out-of-process** | IIS forwards requests to a separate Kestrel process | IIS acts as a reverse proxy |

A `web.config` is generated at publish time, but only to configure IIS itself — it is **not** used for application configuration the way it was for classic ASP.NET, so don't go looking for connection strings in it. With Linux containers now the dominant production deployment target, IIS is largely irrelevant for new cloud-native work, mattering mainly for on-premises Windows deployments.

## Environments: the one variable that's meant to change configuration, never code paths {b}

The environment name comes from **`ASPNETCORE_ENVIRONMENT`** (or `DOTNET_ENVIRONMENT`), and if nobody sets it, it defaults to `Production` — a deliberate, safe default: an unconfigured deployment fails toward hiding implementation details, not toward leaking them.

| Name | Typical behaviour |
|---|---|
| `Development` | Developer exception page, User Secrets loaded, DI scope validation, detailed errors, OpenAPI UI |
| `Staging` | Production-like settings, test data/services |
| `Production` | Generic error responses, HSTS, real secrets from Key Vault, minimal logging noise |

```csharp
if (app.Environment.IsDevelopment()) { app.MapOpenApi(); app.MapScalarApiReference(); }
if (!app.Environment.IsDevelopment()) app.UseHsts();
if (app.Environment.IsEnvironment("Local")) { /* custom names work too */ }
```

Per-environment *settings* belong in `appsettings.{Environment}.json` (see [Configuration](ch:configuration-options)). There's a discipline worth holding onto here, easy to drift away from under deadline pressure: the environment should change **configuration values**, never **which code path runs**. `if (app.Environment.IsProduction())` sprinkled through business logic means you're no longer testing the same code in staging that will actually run in production — exactly the "it works on my machine" problem the whole container-based deployment model in [Docker](ch:docker) exists to eliminate.

## Application lifetime and graceful shutdown: what actually happens, in order {i}

`app.Run()` isn't just "start listening" — it drives the entire lifecycle of the process, start to finish, in a specific, predictable sequence:

1. Build the container.
2. Start each `IHostedService` in registration order (`StartAsync`). The web server is one of them, so background services registered *before* it in `Program.cs` genuinely start first.
3. Kestrel starts listening; `IHostApplicationLifetime.ApplicationStarted` fires.
4. … the app runs …
5. On **SIGTERM** — `docker stop`, a Kubernetes pod being terminated, an App Service restart — or Ctrl+C, shutdown begins. `ApplicationStopping` fires. Kestrel **stops accepting** new connections but lets in-flight requests finish. Hosted services get `StopAsync` called, with their `stoppingToken` cancelled. All of this has to happen within **`ShutdownTimeout`** (30 s by default).
6. `ApplicationStopped` fires; the container is disposed (disposing singletons).

```csharp
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(45));

var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
lifetime.ApplicationStopping.Register(() => Log.Information("Draining…"));
```

:::why Why "graceful" shutdown is worth real engineering effort, not just a nice-to-have
In Kubernetes or Container Apps, instances get replaced routinely — on every deployment, during every scale-in event — as normal operation, not failure. Without graceful shutdown, each of those routine replacements drops whatever requests were in flight at that moment (502s to real users) and kills background jobs mid-work with no chance to clean up. Three practical habits fix this: honour `stoppingToken` in every background service so it actually notices a shutdown request; keep your own shutdown work comfortably under the platform's grace period instead of racing it; and make work genuinely **idempotent** (see [Messaging & events](ch:messaging-events#idempotent-consumers-and-the-inbox)) so a job interrupted mid-way and retried from scratch doesn't double-charge a card or double-send an email.
:::

## HttpContext: the one object your entire pipeline shares {b}

Every single request gets exactly one **`HttpContext`** — the object essentially every chapter in the rest of Part III assumes you already know the shape of:

| Member | Contains |
|---|---|
| `Request` | Method, Path, Query, Headers, Body (stream), Cookies, `ReadFromJsonAsync<T>()` |
| `Response` | StatusCode, Headers, Body (stream), `WriteAsJsonAsync()`, `OnStarting`/`OnCompleted` callbacks |
| `User` | The `ClaimsPrincipal` set by authentication |
| `RequestServices` | The **request-scoped** `IServiceProvider` |
| `Items` | A per-request dictionary for sharing data between middleware |
| `Features` | Low-level server features (`IHttpRequestFeature`, `IEndpointFeature`…) |
| `Connection` | Remote IP, port, client certificate |
| `RequestAborted` | `CancellationToken` cancelled if the client disconnects |
| `TraceIdentifier` | A unique ID for the request (used in ProblemDetails/logs) |
| `GetEndpoint()` | The endpoint chosen by routing (with its metadata) |

`RequestServices` deserves a second look specifically because it's the concrete answer to a question [Dependency injection](ch:dependency-injection#scopes-made-concrete) raised abstractly: *where* does ASP.NET Core's "one scope per request" actually live? Right here — `HttpContext.RequestServices` *is* that request's DI scope, created by middleware early in the pipeline, and everything resolved anywhere during this request ultimately traces back to it.

Two rules worth holding firmly: `HttpContext` is **not thread-safe**, and it's **only valid for the duration of the request it belongs to**. To reach it from a service rather than directly in a handler, inject `IHttpContextAccessor` — sparingly, since it's usually a sign you could instead just pass what you actually need explicitly — and never, under any circumstance, capture an `HttpContext` reference inside background work that might still be running after the request has already finished; by the time that background code runs, the context it captured may already be invalid.

## Hosting models summary {a}

| Host | Server | Typical use |
|---|---|---|
| Self-hosted Kestrel in a container | Kestrel | Kubernetes, Container Apps, App Service for Containers (most common) |
| Azure App Service (code deploy, Linux) | Kestrel behind the App Service front ends | PaaS web apps |
| IIS in-process | IIS HTTP server | Windows on-premises |
| HTTP.sys | Windows kernel driver | Windows-only features (Windows auth, port sharing) without IIS |
| Azure Functions (isolated worker) | Functions host + ASP.NET Core integration | Serverless HTTP triggers |
| `TestServer` | In-memory | Integration tests ([Integration testing](ch:integration-testing)) |

:::qa What is the role of Program.cs in ASP.NET Core?
It's the application entry point. It creates a WebApplicationBuilder, registers services and configuration (phase 1), builds the WebApplication (which builds the DI container), configures the middleware pipeline and endpoints (phase 2), then calls Run to start Kestrel and the hosted services.
:::

:::qa What is the Generic Host?
The `IHost` abstraction from Microsoft.Extensions.Hosting that provides DI, configuration, logging, environment info and lifetime management, and runs IHostedService instances. It's used by web apps, worker services and console apps alike; ASP.NET Core's web server runs as one of its hosted services.
:::

:::qa What is Kestrel and why use a reverse proxy in front of it?
Kestrel is ASP.NET Core's built-in cross-platform web server: it handles sockets, TLS and HTTP/1-3 parsing and feeds requests into the pipeline. A reverse proxy adds load balancing, TLS termination, a WAF, caching, multiple apps behind one IP and centralised rate limiting. When you use one, you must configure forwarded headers so the app sees the real client IP and scheme.
:::

:::qa How does ASP.NET Core know which environment it's running in?
From the ASPNETCORE_ENVIRONMENT (or DOTNET_ENVIRONMENT) variable, defaulting to Production. It controls which appsettings.{Environment}.json is loaded, whether User Secrets are used, and is available as IWebHostEnvironment.
:::

:::qa What's the difference between in-process and out-of-process hosting in IIS?
In-process runs the app inside the IIS worker process using IIS's HTTP server, which is faster. Out-of-process runs Kestrel as a separate process, with IIS forwarding requests to it as a reverse proxy.
:::

:::qa What happens when an ASP.NET Core app receives SIGTERM?
The host triggers ApplicationStopping, Kestrel stops accepting new connections and drains in-flight requests, hosted services' StopAsync is called and their stopping tokens are cancelled, all within ShutdownTimeout (30 s by default). Then ApplicationStopped fires and the DI container (with its singletons) is disposed.
:::

:::qa What is HttpContext and is it thread-safe?
The per-request object holding Request, Response, User, RequestServices (the scoped container), Items, Features and RequestAborted. It is not thread-safe and only valid for the duration of the request, so it must not be captured in background tasks.
:::

:::qa Why shouldn't you call BuildServiceProvider() inside Program.cs?
It builds a separate container from the one the app will use, so singletons get created twice and their state diverges, and disposal isn't handled. Use the options pattern, factory overloads (`sp => ...`), or resolve after `builder.Build()` from `app.Services`.
:::

## Further reading

- [ASP.NET Core fundamentals overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/)
- [.NET Generic Host](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host)
- [Kestrel web server](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel)
- [Configure ASP.NET Core to work with proxy servers](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)
- Book: *ASP.NET Core in Action* (3rd ed.) by Andrew Lock, the best book-length treatment. Also his blog, andrewlock.net.

## Verify this chapter

Run with `dotnet run` in a console project (`dotnet new web`, then `dotnet add package Microsoft.AspNetCore.TestHost`). It checks the environment default, the shutdown-timeout default, the order of host lifecycle events, and that `RequestServices` really is one scope per request.

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

void Check(bool condition, string claim)
{
    if (!condition) throw new Exception($"FAIL: {claim}");
    Console.WriteLine($"OK: {claim}");
}

// 1. With no ASPNETCORE_ENVIRONMENT/DOTNET_ENVIRONMENT set, the environment defaults to "Production".
Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", null);
var defaultBuilder = WebApplication.CreateBuilder();
Check(defaultBuilder.Environment.EnvironmentName == Environments.Production,
    "With no environment variable set, WebApplication.CreateBuilder defaults to Production");

// 2. HostOptions.ShutdownTimeout defaults to 30 seconds.
var hostOptionsApp = WebApplication.CreateBuilder().Build();
var shutdownTimeout = hostOptionsApp.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<HostOptions>>().Value.ShutdownTimeout;
Check(shutdownTimeout == TimeSpan.FromSeconds(30), "HostOptions.ShutdownTimeout defaults to 30 seconds");

// 3. The host fires ApplicationStarted, then ApplicationStopping, then ApplicationStopped, in that order.
var lifecycleBuilder = WebApplication.CreateBuilder();
lifecycleBuilder.WebHost.UseTestServer();
var lifecycleApp = lifecycleBuilder.Build();
var events = new List<string>();
var lifetime = lifecycleApp.Services.GetRequiredService<IHostApplicationLifetime>();
lifetime.ApplicationStarted.Register(() => events.Add("Started"));
lifetime.ApplicationStopping.Register(() => events.Add("Stopping"));
lifetime.ApplicationStopped.Register(() => events.Add("Stopped"));
await lifecycleApp.StartAsync();
await lifecycleApp.StopAsync();
Check(events.SequenceEqual(new[] { "Started", "Stopping", "Stopped" }),
    "Host lifecycle fires Started, then Stopping, then Stopped, in order");

// 4. HttpContext.RequestServices IS that request's scope: resolved twice in ONE request, same instance;
//    resolved in two DIFFERENT requests, different instances.
var scopeBuilder = WebApplication.CreateBuilder();
scopeBuilder.WebHost.UseTestServer();
scopeBuilder.Services.AddScoped<GuidService>();
var scopeApp = scopeBuilder.Build();
scopeApp.MapGet("/", (HttpContext ctx) =>
{
    var a = ctx.RequestServices.GetRequiredService<GuidService>().Id;
    var b = ctx.RequestServices.GetRequiredService<GuidService>().Id;
    return $"{a},{b}";
});
await scopeApp.StartAsync();
var client = scopeApp.GetTestClient();
var firstRequest = (await client.GetStringAsync("/")).Split(',');
var secondRequest = (await client.GetStringAsync("/")).Split(',');
await scopeApp.StopAsync();

Check(firstRequest[0] == firstRequest[1], "Resolving a scoped service twice within ONE request returns the same instance");
Check(firstRequest[0] != secondRequest[0], "A scoped service resolved in two DIFFERENT requests returns different instances");

Console.WriteLine("All aspnet-hosting claims verified.");

class GuidService { public Guid Id { get; } = Guid.NewGuid(); }
```

Claims this doesn't attempt to verify — they depend on the OS, Kestrel internals, or a real reverse proxy, not just the BCL — are left to the official docs linked above: Kestrel's exact transport behaviour, IIS in-process vs out-of-process hosting, and the actual `X-Forwarded-*` header handling of a specific proxy.
