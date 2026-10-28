---
id: api-design
title: API Design: REST, HTTP Semantics, Versioning and OpenAPI
summary: Designing APIs clients love. HTTP methods and status codes in depth, safety and idempotency, resource and URL design, pagination, filtering and sorting, partial updates, idempotency keys, optimistic concurrency with ETags, long-running operations, versioning strategies, and OpenAPI documentation.
layer: comms
where: Service communication › Synchronous HTTP › API contract design
fits: This chapter is about the **contract** your layer-3 endpoints ([Building APIs](ch:building-apis)) expose to the outside world, which belongs to layer 6: it's how services and clients communicate. Good HTTP semantics make caching ([Caching](ch:caching-ratelimit-cors)), retries ([Resilience](ch:resilience)) and gateways work correctly.
levels: b,i,a
prereqs: building-apis
next: app-models, resilience, microservices
---

## TL;DR

- REST = resources (nouns in URLs) manipulated with standard HTTP verbs, stateless, cacheable.
- **Safe** = doesn't change state (GET); **idempotent** = same effect no matter how many times you call it (GET, PUT, DELETE). This is what makes retries safe.
- Know the status codes: 200/201/202/204 for success, 400/401/403/404/409/412/422/429 for client problems, 500/502/503/504 for server/upstream problems.
- Page large lists with cursor/keyset pagination, not offset, once the table is big — offset gets slower the deeper you page.
- POST isn't idempotent by default; fix that for payments/writes with an **idempotency key**. Fix "last write wins" conflicts with **ETags** (optimistic concurrency).
- Version only when a change would break an existing client's assumptions; additive, optional changes usually don't need a new version.

## REST in one page {b}

**REST** (Representational State Transfer) is an architectural style for HTTP APIs, built around a small set of ideas:

- **Resources** are the nouns, identified by URLs: `/orders/42`, `/customers/7/addresses`.
- **Standard methods** are the verbs: GET, POST, PUT, PATCH, DELETE.
- **Representations** carry state: JSON (usually), negotiated with `Accept`/`Content-Type`.
- **Stateless**: each request carries everything needed (auth token, parameters); the server keeps no client session.
- **Cacheable**: responses say whether and how long they can be cached.
- **Uniform interface** and, strictly, **HATEOAS** (responses include links to next actions), which few real APIs implement fully.

The **Richardson Maturity Model** gives a way to measure how far along this spectrum an API actually sits: Level 0 (one endpoint, RPC over POST), Level 1 (resources), Level 2 (**HTTP verbs + status codes**, where most good APIs sit), Level 3 (hypermedia). Most of this chapter is about getting Level 2 genuinely right — which turns out to be harder than it sounds, because the HTTP verbs carry real semantic promises that are easy to accidentally break.

## HTTP methods: the promises hiding behind "safe" and "idempotent" {b}

| Method | Purpose | Request body | Safe | Idempotent | Typical success |
|---|---|---|---|---|---|
| **GET** | Read a resource/collection | No | ✔ | ✔ | 200 |
| **HEAD** | GET without the body | No | ✔ | ✔ | 200 |
| **POST** | Create a child resource / trigger an action | Yes | ✘ | ✘ | 201 + `Location`, or 202, 200 |
| **PUT** | Replace a resource entirely (or create at a known URL) | Yes | ✘ | ✔ | 200 / 204 (201 if created) |
| **PATCH** | Partial update | Yes | ✘ | ✘ (can be made so) | 200 / 204 |
| **DELETE** | Remove | Usually no | ✘ | ✔ | 204 (or 404/204 on repeat) |
| **OPTIONS** | Capabilities / CORS preflight | No | ✔ | ✔ | 204 |

Two columns in that table carry more weight than they look. **Safe** means the method doesn't change server state at all — which is exactly why browsers, crawlers, and CDN prefetchers feel free to call GET requests speculatively, without asking: nothing bad can happen if GET runs twice, or zero times, or in a different order than you expected. **Idempotent** is a related but distinct promise: making the same request *N* times has the same effect on the server as making it once — though the *response itself* may legitimately differ, since a second `DELETE` on an already-deleted resource might reasonably return 404 instead of 204. Here's why this distinction earns its own row in the table rather than being a footnote: idempotency is exactly what makes **retries safe**. A client, a proxy, or a resilience policy can automatically retry an idempotent request after a timeout without worrying about double effects — which is precisely why `POST`, being neither safe nor idempotent by default, needs the special handling covered later in this chapter under idempotency keys.

## Status codes you must know {b}

| Code | Name | When |
|---|---|---|
| **200** | OK | Successful GET/PUT/PATCH with a body |
| **201** | Created | POST created something; include a `Location` header and usually the resource |
| **202** | Accepted | Work queued for async processing; return a status URL |
| **204** | No Content | Success with no body (DELETE, PUT/PATCH without returning the resource) |
| **301/308** | Moved permanently | Resource URL changed (308 keeps the method) |
| **304** | Not Modified | Conditional GET: client's cached copy (ETag) is still valid |
| **400** | Bad Request | Malformed request or validation errors (ValidationProblemDetails) |
| **401** | Unauthorized | **Not authenticated**: missing/invalid/expired token |
| **403** | Forbidden | Authenticated but **not allowed** |
| **404** | Not Found | Resource doesn't exist (or you're hiding it from this caller) |
| **405** | Method Not Allowed | e.g. DELETE on a read-only resource |
| **406 / 415** | Not Acceptable / Unsupported Media Type | Content negotiation failures |
| **409** | Conflict | State conflict: duplicate, a business rule ("already shipped"), a concurrency clash |
| **412** | Precondition Failed | `If-Match` ETag didn't match (optimistic concurrency) |
| **422** | Unprocessable Content | Well-formed but semantically invalid (some teams use this for validation instead of 400) |
| **429** | Too Many Requests | Rate limited; include `Retry-After` |
| **500** | Internal Server Error | Unhandled server bug |
| **502 / 503 / 504** | Bad Gateway / Service Unavailable / Gateway Timeout | Upstream failures, overload/maintenance (+ `Retry-After`), upstream timeout |

Return errors as **ProblemDetails** ([Errors & logging](ch:errors-logging)). Whichever you pick between 400 and 422 for validation, the important thing is picking **one** convention and applying it consistently across the whole API — a client building retry logic against your API needs to know, once, which code means "don't bother retrying this without changing the request."

## Resource and URL design {b}

```text
✔ GET    /orders                      list (filter/sort/page with query params)
✔ GET    /orders/42                   one order
✔ POST   /orders                      create
✔ PATCH  /orders/42                   partial update
✔ DELETE /orders/42                   delete
✔ GET    /customers/7/orders          sub-collection (one level of nesting)
✔ POST   /orders/42/cancellation      an action modelled as a resource ("create a cancellation")
✔ POST   /orders/42:cancel            Google-style custom method (also acceptable)

✘ GET    /getOrders?id=42             verbs in URLs
✘ POST   /orders/42/delete            using POST for everything
✘ GET    /customers/7/orders/42/lines/3/product   deep nesting: use /order-lines/3 or /products/{id}
```

The last two "wrong" examples share a root cause worth naming: both are reaching for a verb-shaped URL or an ever-deepening path because the method vocabulary from the previous section felt too limited for the action in mind. The fix each time is the same: model the action itself as a resource — a cancellation you `POST` into existence — rather than smuggling a verb into the URL. Conventions worth adopting as defaults: **plural nouns**, **lowercase kebab-case** paths (`/order-lines`), **camelCase** JSON, IDs that are opaque to clients (GUIDs or numbers, never anything a client could infer meaning from), ISO 8601 UTC timestamps (`2026-10-27T14:00:00Z`), money as `{ "amount": "19.99", "currency": "EUR" }` (decimal as a string or a minor-unit integer, never a floating-point number), and enums as strings rather than raw integers that mean nothing without the source code.

## Pagination, filtering and sorting: never return an unbounded list {i}

```csharp
public sealed record PageRequest(int Page = 1, int PageSize = 20)
{
    public int Size => Math.Clamp(PageSize, 1, 100);       // cap the page size server-side
}
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount)
{
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
}
```

There are two genuinely different strategies for paging through a collection, and the choice between them isn't cosmetic — it changes how the database query performs as the dataset grows:

| | Offset / page | Cursor / keyset |
|---|---|---|
| Request | `?page=3&pageSize=20` | `?limit=20&after=eyJpZCI6MTA0Mn0` |
| SQL | `OFFSET 40 ROWS FETCH NEXT 20` | `WHERE Id > @lastId ORDER BY Id FETCH NEXT 20` |
| Jump to page N | ✔ | ✘ |
| Performance on deep pages | Degrades: the DB still scans skipped rows | Constant: uses the index |
| Stable when data changes | ✘ Items shift between pages | ✔ |
| Use for | Admin grids, small datasets | Feeds, infinite scroll, large tables, sync APIs |

Trace through why offset pagination degrades: `OFFSET 40` doesn't mean "jump straight to row 41" — the database still has to walk through and discard the first 40 rows before it can start returning anything, so page 1,000 of a million-row table does real, scanning work for every single request, no matter how good the index is. Keyset pagination sidesteps this entirely by asking a different question — "give me rows after this specific key" — which the index answers directly, in roughly constant time regardless of how deep you are.

```csharp
app.MapGet("/products", async ([AsParameters] ProductQuery q, ShopDb db, CancellationToken ct) =>
{
    var query = db.Products.AsNoTracking();
    if (q.CategoryId is { } cat) query = query.Where(p => p.CategoryId == cat);           // filtering
    if (!string.IsNullOrWhiteSpace(q.Search)) query = query.Where(p => p.Name.Contains(q.Search));
    query = q.Sort switch                                                                   // whitelisted sorting
    {
        "price" => query.OrderBy(p => p.Price).ThenBy(p => p.Id),
        "-price" => query.OrderByDescending(p => p.Price).ThenBy(p => p.Id),
        _ => query.OrderBy(p => p.Name).ThenBy(p => p.Id)                                  // deterministic tie-breaker
    };
    var total = await query.CountAsync(ct);
    var items = await query.Skip((q.Page - 1) * q.Size).Take(q.Size)
        .Select(p => new ProductDto(p.Id, p.Name, p.Price)).ToListAsync(ct);
    return TypedResults.Ok(new PagedResult<ProductDto>(items, q.Page, q.Size, total));
});
```

:::gotcha Never sort or filter by raw client strings
Building an `OrderBy` clause directly from an arbitrary field name a client sent — via dynamic LINQ or raw SQL string concatenation — opens the door to injection, and separately, to a client silently sorting by some unindexed column and making the query scan the entire table. **Whitelist** which fields are sortable and filterable (notice the `switch` above only recognises two literal strings, with everything else falling through to a safe default), cap page sizes server-side, and always add a unique tie-breaker (`ThenBy(Id)`) — without one, rows that tie on the sort column can appear in a different relative order on different pages, silently duplicating or skipping rows as a client pages through.
:::

## Updates: PUT vs PATCH {i}

- **PUT** replaces the whole representation. Omitted fields are reset, so clients must send everything — which is exactly what makes it idempotent: sending the same full representation twice leaves the resource in the same state both times.
- **PATCH** changes only what's sent, and comes in two standard shapes:
  - **JSON Merge Patch** (RFC 7396, `application/merge-patch+json`): send a partial object, `null` means remove. Simple and common.
  - **JSON Patch** (RFC 6902, `application/json-patch+json`): a list of operations (`[{ "op": "replace", "path": "/status", "value": "Paid" }]`). Precise, supports array operations, more complex.

Many APIs sidestep generic PATCH for business operations entirely, preferring **task-based endpoints** instead (`POST /orders/42/cancellation`, `POST /orders/42/shipments`). The reason connects back to the URL-design section above: "set status to Cancelled" via PATCH describes a *data mutation*, while "create a cancellation" via POST describes a *business action* — and the second maps far more naturally onto how a domain model (see [DDD](ch:ddd)) actually thinks about what's happening.

## Idempotency keys for POST: making the one unsafe-by-default method safe to retry {a}

POST isn't idempotent, and that has a sharp real-world consequence: a client that sends a payment request, times out waiting for a response, and retries — reasonably, since it has no way to know whether the first attempt succeeded — may end up **charging the customer twice**. The standard fix, used by Stripe and most serious payment APIs, is an **idempotency key**: a client-generated identifier that makes the *second* identical request a no-op rather than a second charge.

```http
POST /payments
Idempotency-Key: 4f9d2c1e-8b6a-4c51-9a77-1c2e3d4f5a6b
```

```csharp
app.MapPost("/payments", async ([FromHeader(Name = "Idempotency-Key")] Guid key, PaymentRequest req, IIdempotencyStore store, IPayments payments, CancellationToken ct) =>
{
    if (await store.TryGetAsync(key, ct) is { } previous)
        return Results.Json(previous.Body, statusCode: previous.Status);          // replay the original response

    if (!await store.TryBeginAsync(key, requestHash: req.GetHashCode(), ct))     // unique constraint = one winner
        return Results.Conflict(new ProblemDetails { Title = "Request with this key is in progress" });

    var result = await payments.ChargeAsync(req, ct);
    await store.CompleteAsync(key, 201, result, ct);                              // store response for ~24 h
    return Results.Created($"/payments/{result.Id}", result);
});
```

Three details in that code are each guarding against a specific failure mode: storing keys with a TTL stops the store growing forever; detecting reuse of the same key with a *different* payload (returning 422) catches a client bug where a key got reused for an unrelated request; and making the "begin" step atomic via a unique index — rather than a check-then-insert that two concurrent requests could both pass — is what actually guarantees only one charge happens even if the client somehow fires the retry before the first attempt has finished.

## Optimistic concurrency with ETags {a}

A different concurrency problem: two *different* clients editing the same resource, where whichever one saves last silently overwrites the other's changes — a **lost update**. ETags solve this by making "has this changed since I last read it?" a question the server can answer cheaply:

```text
GET /orders/42             →  200, ETag: "v7"
PUT /orders/42  If-Match: "v7"   → 200, ETag: "v8"          (nobody else changed it)
PUT /orders/42  If-Match: "v7"   → 412 Precondition Failed   (someone saved v8 in between: reload and retry)
```

Walk through what's actually happening: the client's `GET` captured the resource's version at that moment. Its later `PUT` says, in effect, "apply this change, but only if the version is still what I last saw" — and if someone else saved in between, the version has moved on to `v8`, the precondition fails, and the server refuses the write rather than silently clobbering the intervening change. This maps directly onto EF Core's `rowversion` concurrency token, covered in [EF Core advanced](ch:efcore-advanced) — the ETag is really just that token, surfaced over HTTP. As a bonus, the same mechanism works for reads too: a `GET` with `If-None-Match: "v8"` returns a bodyless **304 Not Modified** when nothing has changed, saving bandwidth on every request where the client's cached copy is still current.

## Long-running operations {a}

Work that genuinely takes longer than a reasonable HTTP request — more than a few seconds — shouldn't hold the connection open waiting. The pattern mirrors the "defer and poll" idea from [Background work](ch:background-work#work-that-shouldnt-make-a-request-wait):

```text
POST /reports              → 202 Accepted
                             Location: /reports/operations/abc123
                             Retry-After: 5
GET  /reports/operations/abc123  → 200 { "status": "running", "progress": 40 }
GET  /reports/operations/abc123  → 303 See Other  Location: /reports/987   (or 200 { status: "succeeded", resultUrl })
```

Where polling itself is too chatty or too slow to notice completion, the alternatives are: webhooks (the server calls back to a URL the client provided), SignalR or Server-Sent Events for genuinely live progress updates, or simply having the client poll a resource's own `status` field rather than a dedicated operation resource.

## Versioning: deciding what counts as a promise you can't break {i}

The question to ask before anything else here: does this change break an existing client's reasonable assumptions? Removing or renaming a field or endpoint does. Changing a field's type or meaning does. Making a previously optional input required does. Changing an error code a client might be branching on does. **Adding** a new optional field or a new endpoint does **not** break anything — provided clients are built to ignore fields they don't recognise, which is worth stating explicitly in your API's own documentation so clients actually do it.

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| **URL segment** | `/v2/orders` | Visible, easy to route, cache-friendly, most common | URL changes per version |
| Query string | `/orders?api-version=2.0` | Simple; Azure APIs use it | Easy to forget; caching nuances |
| Header | `Api-Version: 2` | Clean URLs | Less discoverable; harder to test in a browser |
| Media type | `Accept: application/vnd.shop.v2+json` | Most "RESTful" | Complex for clients |

```csharp
builder.Services.AddApiVersioning(o =>
{
    o.DefaultApiVersion = new ApiVersion(1, 0);
    o.AssumeDefaultVersionWhenUnspecified = true;
    o.ReportApiVersions = true;                               // api-supported-versions response header
    o.ApiVersionReader = new UrlSegmentApiVersionReader();
}).AddApiExplorer(o => { o.GroupNameFormat = "'v'VVV"; o.SubstituteApiVersionInUrl = true; });   // Asp.Versioning.Http

var orders = app.NewVersionedApi("Orders");
var v1 = orders.MapGroup("/v{version:apiVersion}/orders").HasApiVersion(1.0);
var v2 = orders.MapGroup("/v{version:apiVersion}/orders").HasApiVersion(2.0);
v1.MapGet("/{id:int}", GetOrderV1);
v2.MapGet("/{id:int}", GetOrderV2);      // new response shape
```

Whichever breaking change eventually forces a new version, have a **deprecation policy** ready before you need it: announce the deprecation, add `Deprecation`/`Sunset` response headers so clients (and their tooling) can detect it programmatically, monitor actual traffic per version so you know when it's genuinely safe to remove the old one, and only then remove it.

## OpenAPI documentation {b}

**OpenAPI** (formerly Swagger) is a machine-readable description of your API — endpoints, parameters, schemas, responses, and auth requirements, all in one document. Once that description exists, a surprising amount becomes possible almost for free: interactive docs, client SDK generation (Kiota, NSwag), contract testing, gateway import (Azure API Management), and automated breaking-change detection in CI by diffing one version's spec against the next.

```csharp
builder.Services.AddOpenApi(o =>                       // Microsoft.AspNetCore.OpenApi (.NET 9+), built in
{
    o.AddDocumentTransformer((doc, ctx, ct) => { doc.Info.Title = "Shop API"; return Task.CompletedTask; });
});

app.MapOpenApi();                                       // /openapi/v1.json
if (app.Environment.IsDevelopment())
    app.MapScalarApiReference();                        // Scalar UI (Scalar.AspNetCore); or Swagger UI via Swashbuckle

orders.MapGet("/{id:int}", GetById)
    .WithName("GetOrder")
    .WithSummary("Get an order by id")
    .WithDescription("Returns 404 if the order doesn't exist or isn't visible to the caller.")
    .Produces<OrderDto>(200)
    .ProducesProblem(404);                              // TypedResults usually make Produces* unnecessary
```

A few names worth recognising in this space: **Swashbuckle** (Swagger UI and generator) was the default before .NET 9 and remains widely used in existing codebases; **NSwag** is an alternative generator with its own client-generation story; XML doc comments and `TypedResults` both feed richer documents into the generated spec automatically, with no extra attributes needed. And one design choice worth naming explicitly: **design-first** (write the OpenAPI spec by hand, generate server stubs from it) versus **code-first** (generate the spec from the running code, as the example above does) — code-first is the more common approach in .NET, mostly because `TypedResults` already makes the code itself an accurate, type-checked source of truth for the contract.

:::qa What makes an API RESTful?
Resources identified by URLs, manipulated through standard HTTP methods with correct status codes, stateless requests, cacheable responses, and representations like JSON. Strictly, it also includes hypermedia (HATEOAS), which most practical "REST" APIs (maturity level 2) omit.
:::

:::qa What do safe and idempotent mean? Which methods are which?
Safe methods don't change server state: GET, HEAD, OPTIONS. Idempotent methods have the same effect whether called once or many times: GET, HEAD, OPTIONS, PUT, DELETE. POST and PATCH aren't idempotent by default. Idempotency is what makes automatic retries safe.
:::

:::qa PUT vs PATCH vs POST?
POST creates a subordinate resource or triggers an action (not idempotent; 201 with a Location header). PUT replaces the entire resource at a known URL (idempotent). PATCH applies a partial update via JSON Merge Patch or JSON Patch.
:::

:::qa 401 vs 403?
401 means the request isn't authenticated (no/invalid/expired credentials, and the response includes WWW-Authenticate). 403 means the caller is authenticated but not permitted to perform the action.
:::

:::qa How do you make a POST endpoint safe to retry?
Require an Idempotency-Key header. Store the key atomically (unique constraint) along with the response, and on a repeat with the same key, return the stored response instead of re-executing. Reject reuse of the same key with a different payload.
:::

:::qa Offset vs cursor pagination?
Offset (page/pageSize, OFFSET/FETCH) is simple and supports jumping to any page, but it slows down on deep pages and shifts when data changes. Cursor/keyset pagination (WHERE key > lastKey) uses the index for constant performance and stable results, but can't jump to arbitrary pages.
:::

:::qa How do you version an API, and what counts as a breaking change?
Common strategies are URL segment (/v2), query string, header or media type, e.g. with Asp.Versioning. Breaking changes include removing or renaming fields/endpoints, changing types or semantics, making optional inputs required, and changing status codes. Additive optional changes are non-breaking if clients tolerate unknown fields.
:::

:::qa How do ETags help with concurrency?
The server returns an ETag (version) with a resource. Clients send If-Match with updates, and if the resource changed meanwhile the server returns 412 Precondition Failed, preventing lost updates. If-None-Match on GET enables 304 Not Modified responses.
:::

:::qa How would you design an endpoint that generates a large report?
Return 202 Accepted with a Location header pointing to an operation-status resource, process in the background (queue plus worker), let the client poll the status (with Retry-After) or receive a webhook/SignalR notification, and finally link to the result resource.
:::

## Further reading

- [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines)
- [Azure Architecture Center: API design best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [ASP.NET Core OpenAPI](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview)
- [Asp.Versioning on GitHub](https://github.com/dotnet/aspnet-api-versioning)
- Book: *RESTful Web APIs* (Richardson, Amundsen). Book: *API Design Patterns* (JJ Geewax).

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, no packages). It checks the claims that are actually checkable in isolated code: idempotency-key replay, offset-vs-keyset pagination cost shape, and ETag-style optimistic concurrency. Claims about HTTP method semantics, status codes and versioning are protocol conventions, not something a console program can "run" — see Further reading above for the specs they come from.

```csharp
using System.Collections.Concurrent;

// --- Idempotency key: second request with the same key replays the first response, doesn't recharge ---
var store = new ConcurrentDictionary<Guid, string>();
string Charge(Guid key, string payload)
{
    if (store.TryGetValue(key, out var previous)) return previous; // replay, no new charge
    var result = $"charged:{payload}";
    store[key] = result;
    return result;
}
var k = Guid.NewGuid();
var first = Charge(k, "$10");
var second = Charge(k, "$10"); // simulates a client retry after a timeout
if (first != second) throw new Exception("FAIL: idempotency key did not replay the original response");
if (store.Count != 1) throw new Exception("FAIL: idempotency key allowed a second charge to be stored");
Console.WriteLine("OK: idempotency key makes a repeated POST a no-op instead of a second charge");

// --- Offset pagination does more work the deeper you page; keyset pagination doesn't ---
var rows = Enumerable.Range(1, 100_000).ToList(); // stand-in for an indexed, sorted table
int OffsetScanCost(int page, int pageSize) => page * pageSize;                 // must walk & discard every prior row
int KeysetScanCost(int pageSize) => pageSize;                                  // index seek straight to the key, every time
if (OffsetScanCost(page: 4000, pageSize: 20) <= KeysetScanCost(pageSize: 20))
    throw new Exception("FAIL: offset pagination should cost more than keyset pagination on a deep page");
Console.WriteLine("OK: offset pagination's cost grows with page depth; keyset pagination's doesn't");

// --- ETag / If-Match: a write with a stale version is rejected instead of silently overwriting ---
var resource = new { Body = "original", Version = "v7" };
string? ApplyIfMatch(string ifMatchVersion, string currentVersion, string newBody)
    => ifMatchVersion == currentVersion ? newBody : null; // null = 412 Precondition Failed

var ok = ApplyIfMatch("v7", resource.Version, "edited by A");
if (ok is null) throw new Exception("FAIL: a matching If-Match version should be accepted");
// someone else saves in between, moving the version to v8 — our old "v7" token is now stale
var stale = ApplyIfMatch("v7", "v8", "edited by B, using a stale version");
if (stale is not null) throw new Exception("FAIL: a stale If-Match version should be rejected (412), not applied");
Console.WriteLine("OK: a write with a stale ETag is rejected instead of clobbering a newer save");

// Not runtime-verifiable here — see Further reading: Microsoft REST API Guidelines, Azure Architecture Center
// (which status/verb to use, versioning strategy, OpenAPI tooling behavior are conventions, not runtime facts)
```
