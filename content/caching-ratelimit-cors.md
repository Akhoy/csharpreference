---
id: caching-ratelimit-cors
title: Caching, Rate Limiting, CORS and Response Performance
summary: The pipeline features that protect and speed up an API. Caching layers and strategies (in-memory, distributed, HybridCache, output and HTTP caching), invalidation and stampedes, rate limiting algorithms and partitioning, CORS and preflight requests, response compression, and request timeouts.
layer: framework
where: ASP.NET Core › Request pipeline › Caching, rate limiting & CORS
fits: Most of these are **middleware** ([Middleware](ch:middleware)) whose behaviour is chosen per endpoint through routing metadata ([Routing](ch:routing)). The cache **stores** themselves (Redis) live in layer 5 ([NoSQL & Redis](ch:nosql-redis)), and CORS is a browser-security mechanism covered from the attacker's side in [Web security](ch:web-security).
levels: b,i,a
prereqs: middleware, routing
next: nosql-redis, background-work, web-security
---

## TL;DR

- Every cache decision reduces to one question: **how stale can this data be?** Decide that first, per data type, before picking a technology.
- `IMemoryCache` is fast but **per instance** — three app instances means three independent copies that can disagree. `IDistributedCache` (Redis) is shared but pays a network hop every time. `HybridCache` (.NET 9) gives you both: a fast local layer in front of a shared one, plus stampede protection.
- On a write, **delete** the cache key rather than overwriting it with the new value — overwriting can leave a stale value cached if two writers race.
- Rate limiting (fixed window, sliding window, token bucket) caps requests per client; like `IMemoryCache`, the built-in limiter's counters are **per instance**, so a "100/minute" limit becomes "100 × instance count" across a fleet unless you use a shared store.
- CORS protects **browsers**, not your API — non-browser clients (curl, server-to-server calls) ignore it completely. Your API's real protection is authentication/authorization.

## Why cache at all {b}

Most backend reads are **repetitive**, in a specific, exploitable way: the same product page, the same exchange rates, the same permission lookup, asked for thousands of times while the underlying data barely changes. Every one of those identical requests still costs a full database round trip or an external API call unless something intervenes. A cache is that intervention — a copy of the answer, kept close by, so the thousandth identical request doesn't repeat the work the first one already did.

| Benefit | Cost |
|---|---|
| Lower latency (memory lookup in microseconds vs a database query in milliseconds) | **Staleness**: the copy may be out of date |
| Less load on databases and downstream APIs; lower bills | **Invalidation** logic |
| Resilience: can keep serving when a dependency is slow | Memory use, extra infrastructure (Redis) |
| Absorbs traffic spikes | Consistency across instances |

:::why The question every cache decision reduces to
Every cache ultimately answers one question: **how stale may this data be?** A price shown at checkout: seconds, or arguably no cache at all. A product description: minutes or hours is fine. A list of countries: days, safely. Decide this per data type *first*, before picking any technology — the right tool follows directly from the answer, not the other way around.
:::

## The caching layers, from the browser down to the database {b}

A single request can pass through several independent caching layers before it ever touches a database, each one answering the "how stale" question for a different audience:

```text
Browser cache ─▶ CDN / reverse proxy ─▶ Output cache (whole response) ─▶ App data cache (memory → Redis) ─▶ Database
  Cache-Control      Front Door            ASP.NET Core middleware        HybridCache / IMemoryCache /       (+ its own
  ETag                                                                    IDistributedCache                    buffer pool)
```

| Layer | Tool | Caches | Shared across instances? |
|---|---|---|---|
| HTTP (client/CDN) | `Cache-Control`, `ETag` headers, response caching middleware | Responses, by URL | Yes (CDN), per user (browser) |
| Server output | **Output caching** (`AddOutputCache`) | Whole endpoint responses | Per instance (or Redis store) |
| App data, local | **`IMemoryCache`** | Objects in process memory | **No** |
| App data, distributed | **`IDistributedCache`** (Redis, SQL, Cosmos) | Serialized bytes | **Yes** |
| App data, two-level | **`HybridCache`** (.NET 9) | L1 memory + L2 distributed, stampede protection, tags | Yes (L2) |

## IMemoryCache: the simplest layer, and its one serious limitation {b}

```csharp
builder.Services.AddMemoryCache(o => o.SizeLimit = 10_000);    // optional size budget (each entry must then set Size)

public sealed class CountryService(IMemoryCache cache, ShopDb db)
{
    public async Task<IReadOnlyList<Country>> GetAllAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync("countries", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
            entry.SetSize(1);
            return await db.Countries.AsNoTracking().OrderBy(c => c.Name).ToListAsync(ct);
        }))!;
}
```

| Expiration | Meaning |
|---|---|
| **Absolute** | Expires at a fixed time/duration after creation: guarantees maximum staleness |
| **Sliding** | Expires if not accessed for N; keeps hot items alive (combine with absolute so they still refresh eventually) |
| **Priority / size** | Eviction under memory pressure or size limit |
| **Change tokens** | Evict when a file, config or `CancellationTokenSource` signals |

:::gotcha IMemoryCache with multiple instances
Here's the limitation that catches people as soon as an app scales past one instance: three instances behind a load balancer mean **three entirely independent caches**, each with its own copy and its own idea of when it was last refreshed. A user can load a page showing a new price, then hit a different instance on the very next request and see the old one. Reach for a distributed cache or `HybridCache` when consistency across instances genuinely matters, or deliberately accept the short inconsistency window for data where it doesn't — the country-list example above is a case where it plainly doesn't.
:::

## IDistributedCache and Redis: trading a memory lookup for a network hop {i}

```csharp
builder.Services.AddStackExchangeRedisCache(o =>
{
    o.Configuration = builder.Configuration.GetConnectionString("Redis");
    o.InstanceName = "shop:";                         // key prefix
});

public sealed class CartStore(IDistributedCache cache)
{
    public async Task<Cart?> GetAsync(string userId, CancellationToken ct)
    {
        var bytes = await cache.GetAsync($"cart:{userId}", ct);
        return bytes is null ? null : JsonSerializer.Deserialize<Cart>(bytes);
    }
    public Task SaveAsync(string userId, Cart cart, CancellationToken ct) =>
        cache.SetAsync($"cart:{userId}", JsonSerializer.SerializeToUtf8Bytes(cart),
            new DistributedCacheEntryOptions { SlidingExpiration = TimeSpan.FromDays(7) }, ct);
}
```

Notice what `IDistributedCache` deliberately *doesn't* do for you: it stores raw **bytes**, not objects, so serialization is your responsibility, and every access is a real network round trip rather than a memory lookup — the price paid for every instance seeing the same data. Implementations: Redis (the common choice; Azure Managed Redis in the cloud), SQL Server, Cosmos DB, NCache, or an in-memory stand-in for dev and tests.

## HybridCache: closing the gap between the two previous sections {i}

Look back at the last two sections and the tension should be obvious: `IMemoryCache` is fast but inconsistent across instances; `IDistributedCache` is consistent but pays a network hop on *every single access*, even for data that was just read a moment ago on the very same instance. `HybridCache` (`Microsoft.Extensions.Caching.Hybrid`, .NET 9+) exists specifically to get both: a fast **L1** in-memory cache in front of an optional **L2** distributed cache, with serialization handled for you, plus two capabilities neither older API gives you on its own — **stampede protection** and **tag-based invalidation**, both covered in the next section.

```csharp
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = redisCs);   // becomes L2 automatically
builder.Services.AddHybridCache(o => o.DefaultEntryOptions = new HybridCacheEntryOptions
{
    Expiration = TimeSpan.FromMinutes(10),          // L2 lifetime
    LocalCacheExpiration = TimeSpan.FromMinutes(1)  // L1 lifetime (shorter limits cross-instance staleness)
});

public sealed class ProductQueries(HybridCache cache, ShopDb db)
{
    public ValueTask<ProductDto?> GetAsync(int id, CancellationToken ct) =>
        cache.GetOrCreateAsync(
            $"product:{id}",
            async token => await db.Products.Where(p => p.Id == id)
                .Select(p => new ProductDto(p.Id, p.Name, p.Price)).FirstOrDefaultAsync(token),
            tags: ["products", $"category:{id % 10}"],
            cancellationToken: ct);

    public async Task OnProductChangedAsync(int id, CancellationToken ct)
    {
        await cache.RemoveAsync($"product:{id}", ct);
        // or invalidate a whole group:  await cache.RemoveByTagAsync("products", ct);
    }
}
```

Notice the deliberate asymmetry in the two expirations above: `LocalCacheExpiration` (L1) is set shorter than `Expiration` (L2) specifically so that no instance's local copy can drift stale for longer than a minute, while the shared Redis copy still saves everyone the trip back to the database for a full ten minutes.

## Caching strategies and invalidation: the part that's actually hard {i}

| Strategy | How | Trade-off |
|---|---|---|
| **Cache-aside** (lazy loading) | Read: check cache → on miss load from DB and store. Write: update DB, then **remove** the cache entry | Most common; first read after a change is a miss |
| **Read-through** | The cache library loads on miss (what `GetOrCreate` gives you) | Same as cache-aside, encapsulated |
| **Write-through** | Write to cache and DB together | Cache always fresh; slower writes |
| **Write-behind** | Write to cache; flush to DB asynchronously | Fast writes; risk of data loss |
| **Refresh-ahead** | Refresh popular entries before they expire | No miss latency; extra load |
| **TTL only** | Never invalidate; rely on expiry | Simple; bounded staleness |

Invalidation itself comes in a few recognisable shapes: **remove on write**, right in the same code path that updates the database; **events**, where a `ProductChanged` message goes out and every service or instance evicts its own copy on hearing it; **tags or versioned keys** (`product:v7:42`), where bumping a single version number invalidates an entire group at once; and **short TTLs** as a blunt but reliable safety net underneath whatever else you're doing.

:::gotcha Delete, don't update, on writes
Here's a subtle race worth seeing explicitly: after updating the database, **remove** the cache key rather than writing the freshly computed value directly into the cache. If two writers update concurrently, writing the new value directly can let the *slower* writer's update land in the cache **after** the faster one's, leaving the older value cached — permanently, until the TTL eventually clears it. Deleting the key instead forces the next reader to recompute from the database, which is guaranteed to see the latest committed state.
:::

### Cache stampede: what happens when a popular key expires

Picture a hot key — say, the homepage's featured-products list — expiring at the exact moment traffic is heavy. Every one of the hundreds of concurrent requests that were relying on it misses **simultaneously**, and without any coordination, every single one of them goes to the database to recompute the same answer at once — the "thundering herd." The defences: **request coalescing**, where only the first caller actually computes the value and every other concurrent caller simply awaits that same in-flight result (`HybridCache` does this automatically; plain `IMemoryCache.GetOrCreate` does **not**, which is one of its real limitations); **jittered** expirations, so a batch of keys cached at the same moment don't all expire at the same moment too; refresh-ahead for the hottest keys specifically; and serving the stale value while a refresh happens in the background, rather than making anyone wait.

### What to cache, and what not to

Good candidates share a trait: reference data, product catalogues, computed aggregates, permission lookups, external API responses, rendered fragments — things that are read far more often than they change. Poor candidates share the opposite trait: trivial per-request lookups by primary key on an already-indexed table (often not worth the added complexity for the latency you'd save), rapidly changing data that needs strong consistency (stock levels at checkout, account balances — exactly the "seconds, or no cache at all" end of the staleness question from the opening section), and personal data dropped into a shared cache without careful per-user keys.

## Output caching: caching the whole HTTP response, server-side {i}

Where the layers above cache *data*, output caching caches **entire responses**, keyed by path and query string (and optionally headers or route values), with tag-based eviction built in:

```csharp
builder.Services.AddOutputCache(o =>
{
    o.AddBasePolicy(b => b.Expire(TimeSpan.FromSeconds(30)));
    o.AddPolicy("Catalog", b => b.Expire(TimeSpan.FromMinutes(5)).SetVaryByQuery("page", "category").Tag("catalog"));
});
// .AddStackExchangeRedisOutputCache(...) to share across instances

app.UseOutputCache();                                   // after UseAuthorization / UseCors

app.MapGet("/catalog", GetCatalog).CacheOutput("Catalog");
app.MapPost("/admin/products", async (IOutputCacheStore store, CancellationToken ct) =>
{
    // ... update ...
    await store.EvictByTagAsync("catalog", ct);         // invalidate cached catalog pages
});
```

A safe default is baked in here, worth knowing explicitly: output caching **only caches anonymous GET/HEAD 200 responses** that carry no cookies — a deliberate choice that stops it from ever accidentally serving one logged-in user's personalised response to someone else.

**Response caching** (`UseResponseCaching`) is an older, different middleware that strictly follows HTTP `Cache-Control` semantics rather than giving you server-side policy control. Output caching gives you more control for server-side caching; use **HTTP headers** for the separate job of letting browsers and CDNs cache on the client side:

```csharp
app.MapGet("/assets/config", () => cfg).WithMetadata(new ResponseCacheAttribute { Duration = 3600, Location = ResponseCacheLocation.Any });
// or set headers directly: ctx.Response.Headers.CacheControl = "public,max-age=3600";
// ETags + If-None-Match → 304 Not Modified saves bandwidth for unchanged resources
```

## Rate limiting: protecting the API from its own popularity {i}

Rate limiting caps how many requests a given client can make in a given window — protecting the API from abuse, from a runaway client retrying too aggressively, from scraping, and from accidentally denial-of-servicing yourself, while also letting you enforce fair-use or pricing-tier limits. It's been built into the framework since .NET 7 (`Microsoft.AspNetCore.RateLimiting`).

| Algorithm | How it works | Good for |
|---|---|---|
| **Fixed window** | N requests per window (e.g. 100/minute); the counter resets each window | Simple quotas; allows bursts at window edges |
| **Sliding window** | Window split into segments; smooths the edge burst | Fairer per-minute limits |
| **Token bucket** | Bucket refills at a rate; each request takes a token; bucket size = burst | Allowing short bursts with a steady average |
| **Concurrency** | Max N requests **in flight** at once | Protecting expensive endpoints or downstream resources |

Worth noticing in that table: fixed window is the easiest to reason about but has a real weakness — a client can send 100 requests in the last second of one window and another 100 in the first second of the next, getting 200 requests in effectively two seconds. Sliding window and token bucket both exist specifically to smooth that edge case out.

```csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = (ctx, _) =>
    {
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
            ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString();
        return ValueTask.CompletedTask;
    };

    // Per-user (or per-IP for anonymous) token bucket
    o.AddPolicy("per-user", http => RateLimitPartition.GetTokenBucketLimiter(
        partitionKey: http.User.FindFirstValue("sub") ?? http.Connection.RemoteIpAddress?.ToString() ?? "anon",
        factory: _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 100, TokensPerPeriod = 20, ReplenishmentPeriod = TimeSpan.FromSeconds(10),
            QueueLimit = 0, AutoReplenishment = true
        }));

    o.AddConcurrencyLimiter("reports", c => { c.PermitLimit = 4; c.QueueLimit = 10; });   // heavy endpoint

    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>     // safety net for everything
        RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "x",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 1000, Window = TimeSpan.FromMinutes(1) }));
});

app.UseRateLimiter();                                   // after UseAuthentication if partitioning by user
app.MapGet("/search", Search).RequireRateLimiting("per-user");
app.MapPost("/reports", BuildReport).RequireRateLimiting("reports");
app.MapGet("/health", () => "ok").DisableRateLimiting();
```

:::gotcha In-process limits are per instance
This is the same scaling trap `IMemoryCache` fell into earlier in this chapter, wearing a different costume: the built-in limiter keeps its counters **in memory**, local to each instance. Run 5 instances behind a load balancer, and a limit you configured as "100 requests per minute" is, in effect, 500 requests per minute across the fleet, split however the load balancer happens to route traffic. For a genuinely strict global limit, enforce it at the gateway (Azure API Management, Front Door WAF rate rules, NGINX) or use a Redis-backed limiter that all instances share. And if you're behind a proxy, make sure forwarded headers are configured — exactly as covered in [ASP.NET Core architecture](ch:aspnet-hosting#why-production-traffic-rarely-hits-kestrel-directly) — or partitioning "by IP" will partition by the proxy's IP, collapsing every real client into one bucket.
:::

## CORS: a rule browsers enforce on your behalf, for your users' protection {b}

Browsers enforce the **same-origin policy**: JavaScript running on `https://shop.com` cannot read a response from `https://api.shop.com` — a different origin, since origin means scheme + host + port together — **unless the API explicitly says it's allowed to**, through a set of CORS response headers.

Here's the detail that trips people up the first time they debug a "CORS error": **CORS protects users' browsers, not your API.** curl, Postman, and any server-to-server call ignore CORS completely — there's no browser involved to enforce it. Your API's actual protection against unauthorized access is authentication and authorization, covered in [Auth](ch:auth); CORS is purely about which *websites* a *browser* will let read your responses on a user's behalf.

### Simple vs preflight requests

- **Simple requests** (GET/HEAD/POST with basic content types and no custom headers) go out directly; the browser only checks `Access-Control-Allow-Origin` on the response afterward, before letting the page's JavaScript actually read it.
- **Preflighted requests** (PUT/DELETE/PATCH, a `Content-Type: application/json` body, an `Authorization` header…) are different: the browser sends an **`OPTIONS`** request first, asking permission before the real request goes out at all:

```http
OPTIONS /api/orders HTTP/1.1
Origin: https://shop.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://shop.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Max-Age: 600
```

```csharp
builder.Services.AddCors(o =>
{
    o.AddPolicy("web", p => p
        .WithOrigins("https://shop.com", "https://admin.shop.com")     // explicit list from config
        .WithMethods("GET", "POST", "PUT", "DELETE")
        .WithHeaders("authorization", "content-type")
        .AllowCredentials()                                          // only if you need cookies cross-origin
        .SetPreflightMaxAge(TimeSpan.FromMinutes(10)));
});

app.UseCors();                                  // AFTER UseRouting, BEFORE UseAuthentication/UseAuthorization
app.MapGroup("/api").RequireCors("web");
```

:::gotcha The classic CORS mistakes
- `AllowAnyOrigin()` combined with `AllowCredentials()` is **invalid** — browsers reject the combination outright, by design. And never reflect back whatever `Origin` header the request happened to carry, with credentials enabled; doing that effectively lets *any* site act as the logged-in user.
- Placing `UseCors` **after** authentication is the single most common ordering mistake here, and the exact scenario [Middleware](ch:middleware#the-correct-order-and-precisely-what-breaks-when-you-get-it-) warned about generically: a preflight `OPTIONS` request carries no credentials at all, so if authentication runs first, it rejects the preflight with a 401 — which the browser then reports to the page simply as "a CORS error," hiding the real cause.
- A plain 500 error page with no CORS headers attached *also* shows up in the browser console as a "CORS error," even though CORS has nothing to do with it — the browser can't distinguish "server refused CORS" from "server crashed before it could say anything." Check the actual server logs before assuming it's a CORS configuration problem.
:::

## Response compression and request timeouts {i}

```csharp
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;                    // consider BREACH risk for responses that mix secrets with user input
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
});
app.UseResponseCompression();

builder.Services.AddRequestTimeouts(o => o.AddPolicy("fast", TimeSpan.FromSeconds(2)));
app.UseRequestTimeouts();
app.MapGet("/quote", GetQuote).WithRequestTimeout("fast");     // RequestAborted token fires after 2 s
```

Before enabling this in the app itself, check what's already sitting in front of it: a reverse proxy or CDN frequently compresses better and more cheaply than your app process can, since it's doing it once for many backend instances rather than redundantly in each one. Enable compression here specifically when nothing upstream already does it.

:::qa What caching options does ASP.NET Core provide?
IMemoryCache (in-process objects), IDistributedCache (shared byte cache backed by Redis, SQL, etc.), HybridCache (.NET 9: two-level memory plus distributed with stampede protection and tags), output caching (whole server-side responses with tag eviction), and HTTP response caching via Cache-Control/ETag headers for browsers and CDNs.
:::

:::qa In-memory vs distributed cache?
In-memory is fastest but per instance (not shared, lost on restart, inconsistent across a farm). Distributed (Redis) is shared and survives app restarts, but costs a network hop and serialization. HybridCache combines both.
:::

:::qa What is the cache-aside pattern?
Check the cache first; on a miss, load from the source and store it with an expiry; on writes, update the source and invalidate (remove) the cache entry. It's the most common caching pattern.
:::

:::qa What is a cache stampede and how do you prevent it?
Many concurrent requests miss the same expired hot key and all recompute it, overloading the database. Prevent it with request coalescing (one computes, the rest wait, as HybridCache does), locks, jittered expirations, refresh-ahead, or serve-stale-while-revalidate.
:::

:::qa How do you invalidate cached data?
Remove keys when the underlying data changes (in the write path or via change events), use tags or versioned keys to evict groups, and keep TTLs as a safety net. Prefer deleting over updating cache entries to avoid races.
:::

:::qa What rate limiting algorithms exist and how do you apply them in ASP.NET Core?
Fixed window, sliding window, token bucket and concurrency. Register policies with AddRateLimiter (partitioned per user/IP/API key), add UseRateLimiter, and attach with RequireRateLimiting or [EnableRateLimiting]. Rejections return 429 with Retry-After. Counters are per instance, so enforce global limits at a gateway or with a distributed store.
:::

:::qa What is CORS and does it protect your API?
A browser mechanism that relaxes the same-origin policy when the server returns Access-Control-Allow-* headers, letting JS from another origin read responses. It protects users' browsers from malicious sites, not your API, because non-browser clients ignore it. API protection comes from authentication and authorization.
:::

:::qa What is a preflight request?
An automatic OPTIONS request the browser sends before "non-simple" cross-origin requests (custom headers like Authorization, JSON content type, PUT/DELETE) to ask which origins, methods and headers are allowed. The CORS middleware answers it; it must run before authentication.
:::

:::qa What's the difference between output caching and response caching?
Response caching follows HTTP Cache-Control semantics and is mainly for client/proxy caching. Output caching is server-controlled: policies per endpoint, vary-by rules, tag-based eviction, storage in memory or Redis, independent of client headers, and safe defaults (anonymous GETs only).
:::

## Further reading

- [Caching overview](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/overview)
- [HybridCache library](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid)
- [Output caching middleware](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output)
- [Rate limiting middleware](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit)
- [Enable CORS in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/cors)

## Verify this chapter

The checks below hand-roll a minimal cache, token bucket and fixed-window limiter (no Redis, no `AddRateLimiter`, no `HybridCache` package) to verify the *mechanics* this chapter describes in isolation. CORS preflight behaviour needs a real browser making a real cross-origin HTTP request, so it isn't something a console program can verify — see the MDN/Microsoft Learn links above for that one. Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`.

```csharp
// Verifies claims from this chapter: cache-aside should delete (not overwrite) a
// stale entry to avoid a race, two IMemoryCache-like instances don't share state (the "per instance"
// limitation), and a token bucket allows a burst up to its capacity, then throttles.
// CORS preflight behaviour needs a real browser/HTTP round trip and isn't runtime-verifiable in a
// console app — see Further reading (MDN / learn.microsoft.com CORS docs) for that one.
using System;
using System.Collections.Generic;
using System.Threading;

int fails = 0;
void Ok(string s) => Console.WriteLine($"OK: {s}");
void Check(bool cond, string s)
{
    if (cond) Ok(s);
    else { Console.WriteLine($"FAIL: {s}"); fails++; }
}

// --- Delete, don't overwrite, on writes: avoids a slow writer re-caching a stale value ---
var cache = new SimpleCache();
cache.Set("product:1", "price=10");

// Two concurrent writers: writer A reads old price, writer B updates DB + cache first, A "finishes" after.
// If writes overwrote the cache directly, A's stale write could land after B's and stick.
cache.Remove("product:1");                 // B's write: delete the key instead of writing a new value directly
var afterB = cache.TryGet("product:1", out var staleOrMissing);
Check(!afterB, "Cache-aside: deleting the key on write means the next read is a guaranteed miss, never a stale value");
cache.Set("product:1", "price=12");        // next reader recomputes from the "database" and repopulates
Check(cache.TryGet("product:1", out var fresh) && fresh == "price=12", "Cache-aside: the next read after a delete repopulates with the fresh value");

// --- IMemoryCache limitation: two instances never share state ---
var instanceA = new SimpleCache();
var instanceB = new SimpleCache();
instanceA.Set("countries", "cached-on-A");
Check(!instanceB.TryGet("countries", out _), "IMemoryCache-style cache: a second instance has no knowledge of the first instance's entries");

// --- Token bucket: allows a burst up to capacity, then throttles until tokens refill ---
var bucket = new TokenBucket(capacity: 5);   // no refill modelled, to test the burst limit deterministically
int allowed = 0;
for (int i = 0; i < 8; i++) if (bucket.TryTake()) allowed++;
Check(allowed == 5, "Token bucket: exactly `capacity` requests are allowed in a burst (5 of 8 attempts succeeded)");
Check(!bucket.TryTake(), "Token bucket: once empty, further requests are rejected until tokens refill");

// --- Fixed window: the counter resets at a window boundary, allowing a new burst ---
var window = new FixedWindowLimiter(limit: 3, window: TimeSpan.FromMilliseconds(50));
int firstWindowAllowed = 0;
for (int i = 0; i < 5; i++) if (window.TryAcquire()) firstWindowAllowed++;
Thread.Sleep(60);                           // cross into the next window
bool afterReset = window.TryAcquire();
Check(firstWindowAllowed == 3, "Fixed window: only `limit` requests are allowed within one window (3 of 5 attempts succeeded)");
Check(afterReset, "Fixed window: the counter resets once the window elapses, allowing requests again");

Console.WriteLine(fails == 0 ? "\nAll checks passed." : $"\n{fails} check(s) failed.");
if (fails > 0) Environment.Exit(1);

sealed class SimpleCache
{
    private readonly Dictionary<string, string> _store = new();
    public void Set(string key, string value) => _store[key] = value;
    public void Remove(string key) => _store.Remove(key);
    public bool TryGet(string key, out string? value) => _store.TryGetValue(key, out value);
}

sealed class TokenBucket(int capacity)
{
    private double _tokens = capacity;
    public bool TryTake()
    {
        if (_tokens < 1) return false;
        _tokens -= 1;
        return true;
    }
}

sealed class FixedWindowLimiter(int limit, TimeSpan window)
{
    private DateTime _windowStart = DateTime.UtcNow;
    private int _count;
    public bool TryAcquire()
    {
        if (DateTime.UtcNow - _windowStart >= window) { _windowStart = DateTime.UtcNow; _count = 0; }
        if (_count >= limit) return false;
        _count++;
        return true;
    }
}
```
