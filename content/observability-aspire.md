---
id: observability-aspire
title: Observability, OpenTelemetry and .NET Aspire
summary: Knowing what your system is doing in production. Monitoring vs observability, the three signals (logs, metrics, traces), how .NET emits them (ILogger, Meter, ActivitySource), OpenTelemetry setup and exporters, distributed tracing and context propagation, custom metrics and spans, Application Insights and Azure Monitor, alerting and SLOs, and .NET Aspire for orchestration, service defaults and the dashboard.
layer: cross
where: Cross-cutting › Observability
fits: Observability is a layer-8 concern instrumenting every layer: the ASP.NET Core pipeline ([Middleware](ch:middleware)), HttpClient ([HttpClient](ch:http-client)), EF Core ([EF Core querying](ch:efcore-querying)), messaging ([Messaging & events](ch:messaging-events)) and the runtime itself ([Memory & GC](ch:memory-gc)). Logging basics are in [Errors & logging](ch:errors-logging); in the cloud, the data lands in Azure Monitor ([Cloud & Azure overview](ch:cloud-azure-overview)).
levels: b,i,a
prereqs: errors-logging, http-client
next: performance-engineering, cloud-azure-overview, kubernetes
---

## TL;DR

- **Monitoring** answers questions you thought to ask ahead of time (dashboards, alerts); **observability** lets you answer questions you didn't anticipate, from the data your system already emits.
- The three signals — **logs** (what happened), **metrics** (how much/how often, cheap to query), **traces** (where did the time go for *this* request) — are most useful linked together by a shared **TraceId**.
- .NET's built-in APIs (`ILogger`, `Meter`, `ActivitySource`) are already OpenTelemetry-shaped; the **OpenTelemetry SDK** just listens to them and exports to whatever backend you choose (Azure Monitor, Grafana, Jaeger, …).
- A **trace** is one TraceId shared across every **span** (unit of work) in a request, even across service boundaries — the **W3C `traceparent` header** is how that ID survives an HTTP call to another service.
- Keep metric tags **low-cardinality** (status code, route) — a tag like `userId` or `orderId` creates a new time series per value and can blow up cost; put high-cardinality IDs on traces and logs instead.
- **.NET Aspire** is a development/deployment toolkit (an AppHost to run your whole system locally with one command, shared service defaults, a local dashboard) — it is not something you ship as a production runtime.

## Monitoring vs observability: knowing the answer vs being able to find it {b}

- **Monitoring** answers questions you **knew to ask in advance**: is CPU above 80%? Is the error rate above 1%? It drives dashboards and alerts.
- **Observability** is the ability to answer **new questions** about the system's internal state from its outputs, without shipping new code: "Why are checkout requests from mobile users in Germany slow since 14:05?"

In a distributed system, where one click touches 8 services, observability isn't optional — nobody could have pre-built a dashboard for every possible question an incident might raise, and that's exactly the gap observability closes. Without it, every incident turns into hours of guesswork.

## The three signals {b}

| Signal | What it is | Answers | Example |
|---|---|---|---|
| **Logs** | Timestamped records of discrete events, ideally structured | *What happened, in detail?* | `Payment declined for order 1042: insufficient_funds` |
| **Metrics** | Numeric measurements aggregated over time (cheap to store, fast to query) | *How much, how often, how fast, trending?* | `http.server.request.duration` p95 = 420 ms; 12 errors/s |
| **Traces** | The path of **one request** through the system: a tree of timed **spans** | *Where did the time go? Which service failed?* | Checkout 1.8 s = API 30 ms → Orders 1.6 s → SQL 1.5 s |

Plus, increasingly, **profiles** (continuous CPU and memory profiling) and **events/exceptions**.

They're most powerful **correlated**: a metric spike → exemplar traces from that spike → the logs of those traces, all linked by **TraceId**. Each signal alone answers a narrower question than the chain of all three together — a metric tells you *that* something's wrong, a trace tells you *where*, and the logs for that trace tell you *why*.

## How .NET emits telemetry {i}

.NET has **vendor-neutral APIs built into the BCL**. Libraries emit telemetry through them, and you choose where it goes — the emitting code never needs to know or care which backend eventually receives it.

| Signal | .NET API | Built-in sources |
|---|---|---|
| Logs | `ILogger` (Microsoft.Extensions.Logging) | ASP.NET Core, EF Core, HttpClient, your code |
| Metrics | `System.Diagnostics.Metrics`: `Meter`, `Counter<T>`, `Histogram<T>`, `UpDownCounter<T>`, `ObservableGauge<T>` | `Microsoft.AspNetCore.Hosting` (request duration), `System.Net.Http`, `System.Runtime` (GC, thread pool, exceptions), Kestrel, EF Core |
| Traces | `System.Diagnostics.ActivitySource` / `Activity` (= an OpenTelemetry span) | ASP.NET Core (incoming requests), HttpClient (outgoing), SqlClient, EF Core, Azure SDKs, gRPC, MassTransit |

**OpenTelemetry (OTel)** is the CNCF standard for collecting and exporting telemetry. The **OpenTelemetry .NET SDK** listens to those built-in APIs and exports via **OTLP** (the OpenTelemetry Protocol) to any backend: Azure Monitor/Application Insights, Grafana (Tempo, Loki, Prometheus/Mimir), Jaeger, Zipkin, Datadog, Honeycomb, New Relic, Elastic, or the Aspire dashboard.

```text
Your code + libraries ──(ILogger · Meter · ActivitySource)──▶ OpenTelemetry SDK ──OTLP──▶ Collector (optional) ──▶ backend(s)
                                                                processors, sampling            batching, filtering, routing
```

## Setting up OpenTelemetry {i}

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r
        .AddService(serviceName: "shop-api", serviceVersion: "1.4.2")
        .AddAttributes([new("deployment.environment", builder.Environment.EnvironmentName)]))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation(o => o.Filter = ctx => !ctx.Request.Path.StartsWithSegments("/health"))
        .AddHttpClientInstrumentation()
        .AddEntityFrameworkCoreInstrumentation()        // or AddSqlClientInstrumentation
        .AddSource("Shop.*")                            // your own ActivitySources
        .AddSource("MassTransit")
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()                    // GC, thread pool, exceptions, JIT
        .AddMeter("Shop.*")
        .AddOtlpExporter())
    .WithLogging(l => l.AddOtlpExporter());             // ILogger → OTLP, with TraceId/SpanId attached

// Or, for Azure: the Azure Monitor OpenTelemetry distro does all of the above and exports to Application Insights
// builder.Services.AddOpenTelemetry().UseAzureMonitor();   // connection string from APPLICATIONINSIGHTS_CONNECTION_STRING
```

Exporter endpoints come from standard environment variables: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`.

## Distributed tracing {i}

A **trace** is identified by a **TraceId** shared by every **span** in it. Each span has a SpanId, a parent SpanId, a name, a start and end time, **attributes** (tags), **events** and a **status**.

```text
TraceId 4bf92f35…                                                    0ms ───────────────────────────── 1820ms
└─ POST /api/orders                       shop-api        [██████████████████████████████████████████████████]
   ├─ SELECT Customers…                   shop-api/sql     [██]
   ├─ POST http://pricing/quote           shop-api→pricing   [████████]
   │  └─ GET /quote                       pricing-svc         [███████]
   │     └─ redis GET price:KB-01         pricing-svc          [█]
   ├─ INSERT Orders; INSERT Outbox        shop-api/sql                 [██████████████████████████████████]  ← the slow part
   └─ publish OrderPlaced                 shop-api/servicebus                                             [█]
      └─ consume OrderPlaced              billing-svc (async, linked)                                        [████]
```

Notice exactly what this tree makes obvious at a glance: of the 1.8-second checkout, the vast majority is one single SQL span — not the pricing call, not the message publish. Without a trace like this, "checkout is slow" would have sent you investigating five different services before finding the one that actually mattered.

**Context propagation** carries the trace across process boundaries using the **W3C Trace Context** header:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             version-traceid-parentspanid-flags(sampled)
tracestate: vendor-specific data
baggage: tenant=acme,userTier=gold          (optional key/values propagated to downstream services)
```

ASP.NET Core reads it on incoming requests; HttpClient and gRPC write it on outgoing calls automatically; messaging libraries put it in message headers. **`Activity.Current`** flows through async calls (via `AsyncLocal`) — the exact same ambient-flow mechanism [Errors & logging](ch:errors-logging#log-scopes-attaching-context-to-everything-inside-a-block) relied on for log scopes — so logs written anywhere during a request carry its TraceId and SpanId automatically, with no manual plumbing.

### Sampling

Recording every span of every request is expensive at scale. **Head sampling** decides at the start (e.g. keep 10%, `TraceIdRatioBasedSampler`); **tail sampling** (in the OpenTelemetry Collector) decides after the trace completes, which lets you **keep all errors and slow traces** and sample the rest — precisely the traces you'd actually want during an incident, kept disproportionately more often than the boring, fast, successful ones. Always keep metrics unsampled: they're aggregates, and sampling an aggregate just makes it a less accurate aggregate for no real cost saving.

## Custom spans and metrics {i}

```csharp
public sealed class CheckoutTelemetry
{
    public static readonly ActivitySource Source = new("Shop.Checkout", "1.0");
    private static readonly Meter Meter = new("Shop.Checkout", "1.0");

    public static readonly Counter<long> OrdersPlaced = Meter.CreateCounter<long>("shop.orders.placed", unit: "{order}", description: "Orders successfully placed");
    public static readonly Histogram<double> OrderValue = Meter.CreateHistogram<double>("shop.order.value", unit: "EUR");
    public static readonly UpDownCounter<int> ActiveCheckouts = Meter.CreateUpDownCounter<int>("shop.checkouts.active");
}

public async Task<Result<OrderId>> CheckoutAsync(Cart cart, CancellationToken ct)
{
    using var activity = CheckoutTelemetry.Source.StartActivity("checkout");          // null if nobody is listening: cheap
    activity?.SetTag("cart.items", cart.Lines.Count);
    activity?.SetTag("customer.tier", cart.CustomerTier);
    CheckoutTelemetry.ActiveCheckouts.Add(1);
    try
    {
        var result = await PlaceOrderAsync(cart, ct);
        if (result.IsSuccess)
        {
            CheckoutTelemetry.OrdersPlaced.Add(1, new KeyValuePair<string, object?>("payment.method", cart.PaymentMethod));
            CheckoutTelemetry.OrderValue.Record((double)cart.Total.Amount);
        }
        else activity?.SetStatus(ActivityStatusCode.Error, result.Error.Code);
        return result;
    }
    catch (Exception ex)
    {
        activity?.AddException(ex);
        activity?.SetStatus(ActivityStatusCode.Error);
        throw;
    }
    finally { CheckoutTelemetry.ActiveCheckouts.Add(-1); }
}
```

| Instrument | Use for |
|---|---|
| `Counter<T>` | Monotonic counts: requests, orders, errors |
| `UpDownCounter<T>` | Values that go up and down: queue depth, active connections |
| `Histogram<T>` | Distributions: durations, sizes, amounts (gives percentiles) |
| `ObservableGauge<T>` | Sampled current values via a callback: cache size, pool usage |

:::gotcha Cardinality
Every unique combination of tag values creates a new time series. Tagging a metric with `userId`, `orderId` or full URLs creates **millions of series** and huge bills or crashed backends. Use **low-cardinality** tags on metrics (status code, route template, payment method, region). Put high-cardinality data (IDs) on **traces and logs**.
:::

Notice `CheckoutTelemetry.OrdersPlaced` tags by `payment.method` — a handful of distinct values — rather than, say, `customer.id`, which would create one time series per customer and quietly violate exactly the cardinality rule above.

Follow the **OpenTelemetry semantic conventions** for names and attributes (`http.request.method`, `http.response.status_code`, `db.system`, `messaging.system`), so backends can build standard views.

## What to measure: RED, USE and the golden signals {i}

| Method | For | Measure |
|---|---|---|
| **RED** | Request-driven services (APIs) | **R**ate (requests/s), **E**rrors (failed/s or %), **D**uration (latency percentiles) |
| **USE** | Resources (CPU, memory, pools, queues) | **U**tilisation, **S**aturation (queueing), **E**rrors |
| **Four golden signals** (Google SRE) | Any service | Latency, traffic, errors, saturation |

Use **percentiles (p50, p95, p99)**, not averages: an average of 100 ms can hide 5% of users waiting 4 seconds — the average is dragged down by the many fast requests while saying nothing about the tail that's actually painful for real users. For .NET specifically, also watch **GC pause time and heap size**, **thread pool queue length and thread count** (starvation; see [async/await](ch:async-await#deadlocks-and-thread-pool-starvation)), **exception rate**, **connection pool usage**, and **outbox/queue lag**.

## Alerting and SLOs {a}

- **SLI** (indicator): a measured ratio, e.g. "share of checkout requests completing in under 1 s with a 2xx/4xx status".
- **SLO** (objective): the target, e.g. "99.5% over 30 days".
- **Error budget**: the 0.5% you're allowed to miss. When it's spent, prioritise reliability over features.
- **Alert on symptoms users feel** (SLO burn rate, error rate, latency), not on every cause (one CPU spike). Every page should be **actionable**, and link to a dashboard and a runbook.

## Application Insights and Azure Monitor {i}

**Azure Monitor** is Azure's observability platform; **Application Insights** is its APM feature for applications; **Log Analytics** workspaces store the data, queried with **KQL** (Kusto Query Language).

```text
// Slowest endpoints in the last hour (KQL)
requests
| where timestamp > ago(1h)
| summarize count(), p95 = percentile(duration, 95), failures = countif(success == false) by name
| order by p95 desc

// Everything for one trace
union requests, dependencies, traces, exceptions
| where operation_Id == "4bf92f3577b34da6a3ce929d0e0e4736"
| order by timestamp asc
```

Features: the **application map** (auto-discovered dependency topology), **transaction search** and end-to-end transaction views, **live metrics**, failures and performance blades, **availability tests** (synthetic pings), smart detection, the profiler and snapshot debugger, workbooks and alerts. Use the **Azure Monitor OpenTelemetry Distro** (`UseAzureMonitor()`) in new code; the classic Application Insights SDK is in maintenance.

## .NET Aspire {i}

**.NET Aspire** is an opinionated toolkit for building **observable, production-ready distributed apps**. It covers three things:

### 1. Orchestration: the AppHost

A C# project that **describes your whole system** and runs it locally with one command — a single source of truth for "what does this system consist of," instead of a docker-compose file, a README, and tribal knowledge about which environment variables to set:

```csharp
// Shop.AppHost/Program.cs
var builder = DistributedApplication.CreateBuilder(args);

var sql = builder.AddSqlServer("sql").WithDataVolume().AddDatabase("shopdb");
var redis = builder.AddRedis("cache").WithRedisInsight();
var bus = builder.AddRabbitMQ("bus").WithManagementPlugin();       // or AddAzureServiceBus(...).RunAsEmulator()

var catalog = builder.AddProject<Projects.Shop_Catalog>("catalog")
    .WithReference(sql).WithReference(redis).WaitFor(sql);

var api = builder.AddProject<Projects.Shop_Api>("api")
    .WithReference(sql).WithReference(redis).WithReference(bus).WithReference(catalog)   // injects connection strings + service discovery
    .WithExternalHttpEndpoints()
    .WaitFor(sql);

builder.AddProject<Projects.Shop_Worker>("worker").WithReference(bus).WithReference(sql);
builder.AddNpmApp("web", "../shop-web").WithReference(api).WithHttpEndpoint(env: "PORT");

builder.Build().Run();
```

`dotnet run --project Shop.AppHost` starts the containers (SQL, Redis, RabbitMQ), all the projects and the front end, **wires connection strings and service URLs** as configuration/environment variables, and opens the **dashboard**.

### 2. Service defaults

A shared `ServiceDefaults` project that every service calls with `builder.AddServiceDefaults()`. It configures, in one place: **OpenTelemetry** (logs, metrics, traces with OTLP export), **health checks** (`/health`, `/alive`), **service discovery**, and **HttpClient resilience** defaults — notice this is, concretely, everything the rest of this chapter and [Resilience](ch:resilience) described, pre-wired consistently across every service in the solution rather than configured once per project and inevitably drifting out of sync.

### 3. Integrations (formerly "components")

NuGet packages that register a client **with health checks, telemetry, retries and configuration** already set up: `builder.AddSqlServerDbContext<ShopDb>("shopdb")`, `builder.AddRedisDistributedCache("cache")`, `builder.AddAzureServiceBusClient("bus")`, `builder.AddNpgsqlDataSource("db")`, and many more.

### The dashboard

A local (or standalone) web UI showing every resource's state, console **logs**, **structured logs**, **traces** and **metrics** via OTLP, which is distributed tracing on your laptop from day one. It's also available as a standalone container for any OTLP-emitting app.

### Deployment

Aspire's app model can be **published**: `azd up` (Azure Developer CLI) provisions Azure Container Apps plus the backing services, and community and Microsoft tooling generates Kubernetes manifests, Docker Compose and Bicep. Aspire is **development-time and deployment tooling**, not a runtime you need in production.

:::why Why Aspire matters
Before Aspire, running "API + worker + SQL + Redis + RabbitMQ + front end" locally meant docker-compose files, scripts, duplicated connection strings and no tracing. Aspire makes that the default developer experience, and bakes observability and resilience best practices into every service from the start.
:::

## Diagnosing a production issue: a workflow {a}

1. **Alert fires** (an SLO burn rate or error rate on checkout).
2. **Dashboard**: which endpoint, since when, and does it correlate with a deployment (annotations) or traffic?
3. **Exemplar traces** of failing or slow requests: which span is red or long, and which service and dependency?
4. **Logs for that TraceId**: the exception and context.
5. **Runtime metrics** of the affected service: GC, thread pool starvation, CPU, connection pool.
6. **Mitigate first** (roll back, scale out, fail over, toggle a feature flag), then **root cause**, and a blameless post-mortem.
7. Add the missing **signal or alert** you wished you'd had.

Notice how directly this seven-step workflow walks back through the three signals, in exactly the order the "correlated" point at the top of this chapter promised: a metric (step 1–2) points you to traces (step 3), which point you to logs (step 4), which point you to the actual fix.

:::qa What are the three pillars of observability?
Logs (detailed records of discrete events), metrics (numeric aggregates over time, cheap and good for dashboards and alerts) and traces (the end-to-end path of a single request across services as a tree of timed spans). They're most useful correlated through the trace ID.
:::

:::qa What is OpenTelemetry and how does .NET support it?
A vendor-neutral CNCF standard and SDK for generating, collecting and exporting logs, metrics and traces (via OTLP). .NET's built-in APIs (ILogger, System.Diagnostics.Metrics Meter, and ActivitySource/Activity for spans) are OpenTelemetry-compatible. The OpenTelemetry .NET SDK subscribes to them and exports to backends like Azure Monitor, Grafana, Jaeger or Datadog.
:::

:::qa How does distributed tracing work across services?
Each request gets a trace ID; each unit of work is a span with a parent. The W3C traceparent header (and baggage) propagates context on outgoing HTTP, gRPC and messages, and receivers continue the same trace. ASP.NET Core and HttpClient handle propagation automatically, and backends reassemble the full call tree with timings.
:::

:::qa What's the difference between metrics and logs?
Metrics are pre-aggregated numeric time series (counters, histograms): small, fast, ideal for trends, dashboards and alerting, with low-cardinality dimensions. Logs are individual event records with rich context, used for investigation, and more expensive to store and query.
:::

:::qa What is cardinality and why does it matter for metrics?
The number of unique tag-value combinations. Each one creates a separate time series, so high-cardinality tags (user IDs, order IDs, raw URLs) explode storage and cost. Keep metric tags low-cardinality and put IDs on traces and logs.
:::

:::qa What would you monitor for a .NET web API?
RED metrics per endpoint (request rate, error rate, p95/p99 latency), dependency latency and failures, plus .NET runtime metrics (GC pause and heap, thread pool queue length and thread count, exception rate), connection pool usage, queue/outbox lag, health checks and SLO burn-rate alerts.
:::

:::qa What is .NET Aspire?
A toolkit for building distributed .NET apps: an AppHost project to orchestrate services and containers locally with automatic configuration and service discovery, ServiceDefaults to apply OpenTelemetry, health checks and resilience consistently, integration packages for common services, and a dashboard showing logs, traces and metrics. It can also drive deployment (e.g. to Azure Container Apps with azd).
:::

:::qa What are SLIs, SLOs and error budgets?
An SLI is a measured indicator of service level (e.g. % of requests under 300 ms). An SLO is the target for it (99.9% over 30 days). The error budget is the allowed shortfall (0.1%), used to balance releasing features against reliability work and to drive alerting on burn rate.
:::

## Further reading

- [.NET observability with OpenTelemetry](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/observability-with-otel)
- [Distributed tracing in .NET](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing)
- [Creating metrics](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/metrics-instrumentation)
- [Azure Monitor OpenTelemetry for .NET](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable?tabs=aspnetcore)
- [.NET Aspire documentation](https://learn.microsoft.com/en-us/dotnet/aspire/)
- Book: *Observability Engineering* (Majors, Fong-Jones, Miranda). Google's *Site Reliability Engineering* (free online).

## Verify this chapter

Run with `dotnet run` (a plain console app, .NET 8/9; `System.Diagnostics.Activity` and `System.Diagnostics.Metrics` are part of the BCL, no extra packages). It checks the actual .NET telemetry primitives directly: that `StartActivity` is a no-op without a listener, that nested spans form a parent/child trace tree, that a `Counter<T>` is observable, and that a `traceparent` header built from a real `Activity` matches the W3C format. Exporting to a real OpenTelemetry Collector, Azure Monitor or the Aspire dashboard needs a live backend, so that part is left to the Further reading links instead of faked here.

```csharp
// Verify this chapter: run with `dotnet run`. No external packages needed --
// System.Diagnostics.Activity and System.Diagnostics.Metrics are in the BCL.
// This checks the .NET APIs the chapter describes directly; it does not spin
// up a real OpenTelemetry Collector or export to a backend (see Further
// reading for that).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Text.RegularExpressions;

void Check(string name, bool ok)
{
    if (!ok) throw new Exception($"FAIL: {name}");
    Console.WriteLine($"OK: {name}");
}

// 1. "null if nobody is listening: cheap" -- with no ActivityListener
// registered, StartActivity returns null instead of doing real work.
var source = new ActivitySource("Shop.Checkout.Test", "1.0");
using var noListenerActivity = source.StartActivity("checkout");
Check("StartActivity returns null when no ActivityListener is subscribed (cheap no-op)",
    noListenerActivity is null);

// 2. Once a listener subscribes, the same call produces a real Activity with
// a TraceId -- this is what the OpenTelemetry SDK does under the hood.
ActivitySource.AddActivityListener(new ActivityListener
{
    ShouldListenTo = s => s.Name == "Shop.Checkout.Test",
    Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded
});
using var parent = source.StartActivity("checkout");
Check("once a listener is registered, StartActivity returns a real Activity", parent is not null);
Check("a recorded Activity has a non-empty TraceId", parent!.TraceId.ToString().Length == 32);

// 3. Nested spans form a parent/child tree -- the mechanism behind the trace
// diagrams in this chapter: a child span's ParentSpanId matches the parent's
// own SpanId.
using (var child = source.StartActivity("sql-query"))
{
    Check("a span started while a parent Activity is current records that parent's SpanId",
        child is not null && child.ParentSpanId == parent.SpanId);
    Check("the child shares the same TraceId as its parent (one trace, many spans)",
        child!.TraceId == parent.TraceId);
}

// 4. Counter<T>: a monotonic counter that a MeterListener can observe --
// verifies CreateCounter + Add actually produces a measurement, the
// mechanism OrdersPlaced.Add(1, ...) relies on in the chapter's example.
var meter = new Meter("Shop.Checkout.Test", "1.0");
var counter = meter.CreateCounter<long>("shop.orders.placed");
var recordedValues = new List<long>();
using var meterListener = new MeterListener();
meterListener.InstrumentPublished = (instrument, listener) =>
{
    if (instrument.Meter.Name == "Shop.Checkout.Test") listener.EnableMeasurementEvents(instrument);
};
meterListener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) => recordedValues.Add(measurement));
meterListener.Start();

counter.Add(1);
counter.Add(1);
counter.Add(3);
Check("a Counter<long>.Add is observed by a MeterListener with the exact recorded values",
    recordedValues.Count == 3 && recordedValues[0] == 1 && recordedValues[2] == 3);

// 5. W3C Trace Context header format: version-traceid-parentid-flags, exactly
// as shown in the chapter's traceparent example.
string traceparent = $"00-{parent.TraceId}-{parent.SpanId}-01";
bool matchesW3CFormat = Regex.IsMatch(traceparent, "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$");
Check("a traceparent header built from TraceId/SpanId matches the W3C Trace Context format", matchesW3CFormat);

// Not runtime-verifiable here (needs a running OpenTelemetry Collector,
// Aspire dashboard, or Azure Monitor backend to observe for real): OTLP
// export, the Aspire AppHost orchestrating containers, head/tail sampling
// decisions in a Collector, and KQL queries against Log Analytics -- see
// Further reading: ".NET observability with OpenTelemetry" and the Aspire docs.

Console.WriteLine("All checks passed.");
```
