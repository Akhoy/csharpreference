---
id: system-design
title: System Design for .NET Interviews
summary: Putting every layer together under interview conditions. A repeatable framework for system design questions, estimating scale, the building-block vocabulary with .NET/Azure choices, three worked designs (URL shortener, e-commerce checkout, notification service), common trade-offs to discuss, and how to talk through code-level design questions.
layer: arch
where: Interview preparation › System design
fits: This chapter uses **all eight layers** at once: it's where the map from [The Big Picture](ch:big-picture) becomes a whiteboard. Each decision you make in a design maps to a chapter: storage ([Relational fundamentals](ch:relational-fundamentals), [NoSQL](ch:nosql-redis)), caching ([Caching](ch:caching-ratelimit-cors)), messaging ([Messaging & events](ch:messaging-events)), resilience ([Resilience](ch:resilience)), compute ([Azure compute](ch:azure-compute)) and observability ([Observability](ch:observability-aspire)).
levels: i,a
prereqs: microservices, messaging-events, caching-ratelimit-cors
next: study-plan-resources
---

## TL;DR

- Interviewers care about your **process** (clarify → estimate → design → scale → handle failure), not one "correct" answer.
- Do rough capacity estimates (users, RPS, storage) **before** drawing boxes — the numbers decide the architecture, not the other way round.
- Know the standard building blocks (CDN, gateway, cache, SQL vs NoSQL, queue, search) and a concrete .NET/Azure pick for each.
- Practice the three worked designs here (URL shortener, checkout, notifications) — each reuses patterns from earlier chapters: outbox, idempotency, sagas, bulkheads.
- Always name the **trade-off**, not just the choice: "I'd use X because Y; the cost is Z."

## What interviewers are looking for {i}

A system design interview isn't about the "right" answer. It tests whether you can:

1. **Clarify** ambiguous requirements and identify what matters.
2. **Structure** a solution from high level to detail.
3. **Choose** components with **reasons** and **trade-offs** ("I'd use X because…, the cost is…").
4. **Scale** it: find the bottlenecks and fix them.
5. **Handle failure**: what breaks, and what happens then.
6. **Communicate**: think out loud, draw clearly, and adapt to hints.

For .NET backend roles, interviewers also like hearing **concrete .NET and Azure choices** (EF Core vs Dapper, Service Bus vs Event Hubs, Container Apps vs AKS) and **code-level patterns** (outbox, idempotency, caching strategy) — exactly the vocabulary the rest of this book has spent dozens of chapters building up. This chapter is where all of it gets exercised at once, under time pressure, on a whiteboard.

## A repeatable framework (45 minutes) {i}

| Step | Time | What you do |
|---|---|---|
| **1. Requirements** | 5–8 min | **Functional**: what the system must do (core use cases only). **Non-functional**: scale, latency, availability, consistency, durability, security, cost. **Out of scope**: say what you won't cover |
| **2. Estimates** | 3–5 min | Users, requests/s (peak), read/write ratio, data size per item, storage over 5 years, bandwidth. Keep it rough; it drives decisions |
| **3. API design** | 3–5 min | The main endpoints or messages: `POST /orders`, `GET /orders/{id}`, events |
| **4. Data model** | 5 min | Entities, keys, relationships, access patterns → choice of store and partitioning |
| **5. High-level design** | 10 min | Boxes and arrows: clients → gateway/CDN → services → caches → databases → queues → workers |
| **6. Deep dives** | 10–15 min | The 2–3 hardest parts: hot paths, consistency, scaling the database, failure handling |
| **7. Wrap up** | 2–3 min | Bottlenecks, monitoring, what you'd do next with more time |

Step 2 is placed right after requirements and before any architecture on purpose: the estimates **drive** the decisions that follow, they don't just decorate the answer. A read:write ratio of 100:1 points straight at caching and read replicas; a ratio closer to 1:1 points at write-optimised storage instead. Skip the estimate and jump straight to architecture, and you're guessing at exactly the number that should have decided it.

## Back-of-the-envelope numbers {i}

| Quantity | Rough value |
|---|---|
| Seconds per day | ~86,400 ≈ **10⁵** |
| 1 million requests/day | ≈ **12 RPS** average (peak usually 2–10× the average) |
| 100 million requests/day | ≈ 1,200 RPS average |
| Memory read / SSD read / same-datacentre round trip / cross-region round trip | ~100 ns / ~100 µs / **~0.5 ms** / **~50–150 ms** |
| Redis GET | < 1 ms |
| Indexed SQL point query | 1–5 ms |
| One ASP.NET Core instance (simple JSON, no DB) | Tens of thousands of RPS; realistic CRUD with a DB: hundreds to a few thousand RPS per instance |
| Single SQL Server / Azure SQL instance | Thousands to tens of thousands of simple queries/s, depending on tier and queries |
| Kafka/Event Hubs partition | MB/s per partition; scale by partitions |

**Example:** 10M daily active users, each making 20 reads and 1 write per day → reads ≈ 200M/day ≈ 2,300 RPS average (~10k peak); writes ≈ 10M/day ≈ 115 RPS average. That's a **read-heavy** system, so caching and read replicas matter more than write sharding.

## Building blocks and their .NET/Azure choices {i}

| Building block | Purpose | .NET / Azure options |
|---|---|---|
| DNS + CDN + WAF | Global entry, static content, edge caching, attack filtering | Azure Front Door (+ WAF), Azure CDN |
| API gateway | Routing, auth, rate limiting, aggregation | Azure API Management, YARP |
| Load balancer | Distribute across instances | Built into App Service/Container Apps/AKS ingress, Application Gateway |
| Stateless services | Business logic, horizontally scalable | ASP.NET Core minimal APIs on Container Apps / App Service / AKS |
| Cache | Cut read latency and DB load | HybridCache + Azure Managed Redis, output caching |
| Relational DB | Transactions, relationships, reporting | Azure SQL (Hyperscale for scale), PostgreSQL Flexible Server; EF Core/Dapper |
| NoSQL | Massive scale by key, flexible schema, global | Cosmos DB |
| Object storage | Files, media, exports | Blob Storage (+ SAS, CDN) |
| Queue / broker | Asynchronous work, decoupling, load levelling | Service Bus, Storage Queues; MassTransit/Wolverine |
| Event stream | High-volume events, replay, analytics | Event Hubs (Kafka) |
| Search | Full-text, facets, vector search | Azure AI Search, Elasticsearch |
| Background workers | Process queues, scheduled jobs | Worker services, Azure Functions, Container Apps jobs |
| Real-time push | Live updates | SignalR / Azure SignalR Service |
| Identity | Users and service auth | Entra ID / External ID, managed identities |
| Observability | Logs, metrics, traces | OpenTelemetry + Azure Monitor/App Insights |

## Worked design 1: URL shortener {a}

**Requirements:** create a short link for a long URL; redirect a short link to the long URL; optional custom aliases and expiry; analytics (click counts). Non-functional: very **read-heavy** (100:1), **low redirect latency** (< 50 ms), high availability, links must never collide.

**Estimates:** 100M new links/month ≈ 40 writes/s; 10B redirects/month ≈ 4,000 RPS average (peak ~20k). Storage: ~500 bytes per link × 100M × 12 × 5 years ≈ 3 TB.

**API:**

```http
POST /api/links        { "url": "https://…", "alias": "promo26", "expiresAt": "…" }  → 201 { "code": "aZ3k9Q", "shortUrl": "https://sho.rt/aZ3k9Q" }
GET  /{code}           → 301/302 Location: https://…          (302 if you want to count every click server-side)
GET  /api/links/{code}/stats
```

**Key design decisions:** notice that the 100:1 read:write ratio from the requirements is what decides nearly every row below — this is the estimates-drive-decisions principle from the framework section, playing out concretely.

| Problem | Options and choice |
|---|---|
| Generating unique short codes | (a) Hash the URL (MD5 → base62, take 7 chars): collisions need handling. (b) **Counter + base62 encoding**: unique by construction, using a distributed ID source (database sequence ranges handed out in blocks per instance, or Snowflake-style IDs). (c) Random 7-char base62 (62⁷ ≈ 3.5 trillion) with a uniqueness check. **Choose (b) or (c)**; 7 chars is plenty |
| Storage | Simple key → value access, huge volume, global: **Cosmos DB** (partition key = code; point reads ~1 RU) or Azure SQL with a clustered index on code. Cosmos for global distribution and low-latency point reads |
| Read path latency | **Cache** hot codes in Redis/HybridCache (L1 in-memory per instance + L2 Redis), plus CDN/Front Door caching of redirects for very hot links. Cache hit rates of 90%+ are typical |
| Analytics without slowing redirects | Publish a click event **asynchronously** (Event Hubs), aggregate with a consumer/stream job into counts; don't write to the DB on every redirect |
| Expiry | TTL in Cosmos DB and cache |
| Abuse | Rate-limit creation per user/IP, scan URLs against malware lists, auth for custom aliases |

```text
Client ─▶ Front Door (CDN cache for hot redirects) ─▶ Redirect service (ASP.NET Core minimal API, autoscaled)
                                                        ├─ L1 memory cache → L2 Redis → Cosmos DB (code → url)
                                                        └─ publish ClickEvent → Event Hubs → Analytics worker → stats store
Create path: API → ID allocator (sequence block) → Cosmos DB → (prime cache)
```

```csharp
app.MapGet("/{code:regex(^[a-zA-Z0-9]{{6,10}}$)}", async (string code, HybridCache cache, ILinkStore store, IClickPublisher clicks, HttpContext ctx) =>
{
    var url = await cache.GetOrCreateAsync($"link:{code}", async ct => await store.GetUrlAsync(code, ct),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromHours(1), LocalCacheExpiration = TimeSpan.FromMinutes(5) });
    if (url is null) return Results.NotFound();
    clicks.TryPublish(new ClickEvent(code, DateTimeOffset.UtcNow, ctx.Request.Headers.Referer));   // non-blocking, best effort (buffered)
    return Results.Redirect(url, permanent: false);
}).ShortCircuit();      // skip unnecessary middleware for the hottest path
```

Notice `clicks.TryPublish` is fire-and-forget on the hot path — exactly the "don't write to the DB on every redirect" decision from the table above, made concrete: the redirect itself never waits on the analytics write, which is precisely why the redirect can stay under the 50 ms target even while click data accumulates reliably in the background.

## Worked design 2: e-commerce checkout {a}

**Requirements:** place an order from a cart: validate stock, take payment, confirm, notify, update inventory. Non-functional: **correctness first** (no overselling, no double charges), checkout p95 < 1 s, resilient to payment provider outages, peak load during sales (10× normal).

**Bounded contexts / services:** Catalog, Cart, **Ordering**, **Inventory**, **Payments**, Notifications, Shipping. Start as a **modular monolith**; split Payments and Inventory out if scaling or team ownership requires it ([Microservices](ch:microservices)) — exactly the "start coarse, extract when you have a concrete reason" guidance from that chapter.

**Flow (saga with orchestration):**

```text
POST /checkout (Idempotency-Key) ─▶ Ordering API
   1. Validate cart; create Order (status: Pending) + OrderSubmitted in OUTBOX  — one SQL transaction
   2. Return 202 Accepted + /orders/{id} (or wait briefly for fast success)
Outbox relay ─▶ Service Bus ─▶ Order saga (state machine):
   3. ReserveStock → Inventory: conditional update "UPDATE Stock SET Reserved += @q WHERE Sku=@s AND Available >= @q" (no overselling)
   4. ChargePayment → Payments: call the PSP with an idempotency key = orderId; handle webhooks for async confirmation
   5a. PaymentSucceeded → ConfirmOrder → OrderConfirmed event → Notifications (email), Shipping
   5b. PaymentFailed / timeout → ReleaseStock (compensation) → Order Cancelled → notify the user
```

This single flow is practically a tour of the book: step 1 is the transactional outbox, step 3 is atomic-conditional-update concurrency control, step 4 is idempotent external side effects, and 5a/5b together are a saga with compensation — four separate chapters' worth of mechanisms, cooperating in one checkout.

**Deep-dive talking points:**

- **No overselling:** the atomic conditional UPDATE (or optimistic concurrency on a stock row), reservations with expiry, and a single writer per SKU partition for extreme flash sales (or a queue in front of hot SKUs).
- **No double charge:** an `Idempotency-Key` on the checkout endpoint, the PSP's idempotency key, an inbox on payment consumers, and a unique constraint on `Payments(OrderId)` ([API design](ch:api-design#idempotency-keys-for-post-making-the-one-unsafe-by-default-m), [Messaging](ch:messaging-events#idempotent-consumers-and-the-inbox)).
- **Consistency:** each service owns its database; a saga with compensations instead of distributed transactions; the outbox for reliable events.
- **Resilience:** PSP calls with timeout, retry (idempotent) and circuit breaker; if the PSP is down, accept the order and charge later (queue), or fail fast with a clear message ([Resilience](ch:resilience)).
- **Peak load:** autoscale the API on RPS and the workers on queue length (KEDA); cache catalog and prices; a queue absorbs bursts; a virtual waiting room for extreme sales.
- **Data:** Azure SQL for orders, payments and inventory (transactions); Cosmos DB or Redis for carts (high write rate, TTL); Azure AI Search for the catalog.
- **Observability:** trace a checkout across services; business metrics (orders/min, payment failure rate); alerts on saga timeouts and DLQ depth.

## Worked design 3: notification service {a}

**Requirements:** other services send notifications (email, SMS, push, in-app) to users, with templates, user preferences (channel opt-outs, quiet hours), retries and delivery tracking. Scale: 50M notifications/day, with bursts (marketing campaigns).

```text
Producers (Ordering, Billing…) ─▶ Service Bus topic "notification-requested"
                                      └─▶ Notification service (consumer)
                                           1. Idempotency check (inbox on NotificationId)
                                           2. Load user preferences (cached) → filter channels, quiet hours → schedule
                                           3. Render template (localised) → per-channel queues
                     ┌──────────────────────┼───────────────────────┐
              email queue            sms queue                push queue        (separate queues = bulkheads + independent scaling and rate limits)
                  ▼                      ▼                        ▼
           Email worker (SendGrid/ACS)  SMS worker (ACS/Twilio)  Push worker (FCM/APNs/Notification Hubs)
                  └──────── delivery status ──▶ Status store (Cosmos DB / Table) ◀── provider webhooks
In-app: write to the user's inbox (Cosmos, partitioned by userId) + SignalR push if online
```

Notice the parenthetical on the three channel queues — "bulkheads + independent scaling and rate limits" — naming the exact resilience pattern from [Resilience](ch:resilience#the-resilience-strategies): a slow or rate-limited SMS provider can never back up email delivery, because the two queues share nothing. Talking points: per-channel queues isolate failures and respect provider rate limits (token bucket per provider); retries with backoff and a DLQ per channel; campaigns are throttled through a separate low-priority queue so transactional notifications (password resets) aren't delayed (**priority queues**); templates are versioned and cached; deduplication by NotificationId; GDPR (preferences, unsubscribe links, data retention); and metrics on send rate, failure rate per provider, and end-to-end latency.

## Trade-offs to discuss explicitly {a}

| Trade-off | Discussion |
|---|---|
| **Consistency vs availability** | Strong consistency for money and stock; eventual consistency for feeds, counts and search indexes. Say which data needs which ([NoSQL](ch:nosql-redis#cap-pacelc-and-consistency-models-the-trade-off-a-distribute)) |
| **SQL vs NoSQL** | SQL: transactions, joins, flexible queries. NoSQL: scale by key, global distribution, schema flexibility. Decide from the access patterns |
| **Sync vs async** | Sync for user-facing reads needing immediate answers; async for side effects and long work (202 + status) |
| **Monolith vs microservices** | Team size, deployment independence and scaling differences justify a split; otherwise a modular monolith |
| **Cache freshness vs load** | TTLs, invalidation by events, stampede protection |
| **Latency vs cost** | More replicas, regions and premium tiers vs budget; autoscaling and reserved capacity |
| **Build vs buy** | Identity, payments, email and search are usually bought (SaaS/PaaS); the core domain is built |
| **Push vs pull** | Webhooks/SignalR vs polling; fan-out on write vs on read (social feeds) |
| **Normalisation vs denormalisation** | Write simplicity and integrity vs read performance (CQRS read models) |

Each row in this table is a decision this book has already made once, explicitly, in some earlier chapter — naming the trade-off out loud in an interview is really just demonstrating that you understand *why* that earlier decision was made, not merely that you remember the answer.

## Code-level design questions {i}

Many .NET interviews include "low-level design": design a parking lot, a rate limiter, an LRU cache, a library system, or "how would you structure this API?". Approach:

1. Clarify requirements and edge cases.
2. Identify **entities, value objects and behaviours** (nouns and verbs), and the **invariants**.
3. Sketch classes and interfaces, applying **SOLID** and relevant **patterns** (Strategy for pricing rules, State for lifecycles, Observer/events for notifications, Factory for creation) ([Design patterns](ch:design-patterns)).
4. Discuss **concurrency** (what's shared, how it's protected), **testability** (DI, interfaces at boundaries) and **extensibility** (new types without modification).
5. Write a little real C# for the core logic.

```csharp
// Classic: LRU cache, O(1) get/put with Dictionary + LinkedList, thread-safe with a lock
public sealed class LruCache<TKey, TValue>(int capacity) where TKey : notnull
{
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new(capacity);
    private readonly LinkedList<(TKey Key, TValue Value)> _order = new();       // most recent at the front
    private readonly Lock _gate = new();

    public bool TryGet(TKey key, out TValue value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _order.Remove(node); _order.AddFirst(node);                     // mark as most recently used
                value = node.Value.Value; return true;
            }
            value = default!; return false;
        }
    }

    public void Put(TKey key, TValue value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var existing)) { _order.Remove(existing); _map.Remove(key); }
            else if (_map.Count >= capacity)
            {
                var lru = _order.Last!;                                         // evict least recently used
                _order.RemoveLast(); _map.Remove(lru.Value.Key);
            }
            _map[key] = _order.AddFirst((key, value));
        }
    }
}
```

:::qa How do you approach a system design interview question?
Clarify functional and non-functional requirements and the scope; do quick capacity estimates; define the main APIs and data model; draw a high-level architecture; deep-dive into the hardest parts (scaling the hot path, data consistency, failure handling); and close with bottlenecks, monitoring and trade-offs, explaining the reasons behind every choice.
:::

:::qa How would you prevent overselling in a high-traffic shop?
Make stock decrement atomic and conditional in the database (UPDATE … WHERE Available >= @qty, checking rows affected) or use optimistic concurrency on the stock row; use time-limited reservations released by a compensating action if payment fails; and for extreme hot items, serialise writes per SKU through a queue or partition. Never check-then-update in application memory.
:::

:::qa How would you design a rate limiter?
Clarify per-user/IP/API-key limits and the algorithm (token bucket for bursts, sliding window for fairness). Within one instance, use ASP.NET Core's rate limiter; for a distributed limit, keep counters or buckets in Redis with atomic operations (INCR with expiry, or a Lua script for token bucket), or enforce it at the gateway (APIM/Front Door). Return 429 with Retry-After, and decide fail-open vs fail-closed if Redis is unavailable.
:::

:::qa How do you scale a read-heavy API?
Make the service stateless and scale out; add caching layers (CDN/output cache for public responses, HybridCache/Redis for data); use read replicas or CQRS read models; optimise queries and indexes; paginate and project; and move expensive work to async background processing.
:::

## Further reading

- *Designing Data-Intensive Applications* by Martin Kleppmann: the foundation for every system design discussion.
- *System Design Interview* Vol. 1 & 2 by Alex Xu.
- [Azure Architecture Center: reference architectures](https://learn.microsoft.com/en-us/azure/architecture/browse/) and [cloud design patterns](https://learn.microsoft.com/en-us/azure/architecture/patterns/)
- [eShop reference application (.NET Aspire, microservices)](https://github.com/dotnet/eShop)
- The System Design Primer (GitHub, donnemartin).

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
// 1) Back-of-the-envelope numbers table: "1 million requests/day ~= 12 RPS average".
double requestsPerDay = 1_000_000;
double secondsPerDay = 86_400;
double rps = requestsPerDay / secondsPerDay;
if (!(rps is > 11 and < 12)) throw new Exception($"FAIL: expected ~11.6 RPS, got {rps}");
Console.WriteLine($"OK: 1,000,000 requests/day / 86,400s = {rps:F2} RPS, matching the chapter's '~12 RPS average' estimate.");

// 2) The checkout example's capacity math: 10M DAU x 20 reads + 1 write/day.
double dau = 10_000_000;
double readsPerUserPerDay = 20;
double writesPerUserPerDay = 1;
double readsPerDay = dau * readsPerUserPerDay;
double writesPerDay = dau * writesPerUserPerDay;
double readRps = readsPerDay / secondsPerDay;
double writeRps = writesPerDay / secondsPerDay;
if (!(readRps is > 2200 and < 2400)) throw new Exception($"FAIL: expected ~2300 read RPS, got {readRps}");
if (!(writeRps is > 110 and < 120)) throw new Exception($"FAIL: expected ~115 write RPS, got {writeRps}");
double readWriteRatio = readRps / writeRps;
if (!(readWriteRatio is > 19 and < 21)) throw new Exception($"FAIL: expected ~20:1 read:write ratio, got {readWriteRatio}");
Console.WriteLine($"OK: 10M DAU x (20 reads + 1 write)/day => {readRps:F0} read RPS, {writeRps:F0} write RPS (~{readWriteRatio:F0}:1), confirming the 'read-heavy' conclusion.");

// 3) The LRU cache from "Code-level design questions", verbatim from the chapter: O(1) get/put, evicts least-recently-used.
var lru = new LruCache<int, string>(capacity: 2);
lru.Put(1, "a");
lru.Put(2, "b");
if (!lru.TryGet(1, out var v1) || v1 != "a") throw new Exception("FAIL: expected key 1 to be present with value 'a'");
lru.Put(3, "c");                              // capacity 2 reached; evicts the least-recently-used key.
                                               // key 1 was just accessed above, so key 2 (untouched since insertion) is evicted, not key 1.
if (lru.TryGet(2, out _)) throw new Exception("FAIL: expected key 2 to have been evicted as least-recently-used");
if (!lru.TryGet(1, out var v1Again) || v1Again != "a") throw new Exception("FAIL: expected key 1 to still be present");
if (!lru.TryGet(3, out var v3) || v3 != "c") throw new Exception("FAIL: expected key 3 to be present with value 'c'");
Console.WriteLine("OK: LruCache evicted the least-recently-used key (2), not the oldest-inserted key (1), exactly as an LRU cache should.");

// Claims NOT verified here (need a real cloud deployment, load test, or multi-service system to observe):
// - Absolute throughput figures for a single ASP.NET Core/SQL Server instance, Redis latency, cross-region RTT — these are rough,
//   environment-dependent reference points, not guarantees; see Further reading: https://learn.microsoft.com/en-us/azure/architecture/browse/
// - The worked designs' end-to-end behavior (saga compensation, outbox delivery, per-channel bulkheads) — see the dedicated
//   chapters' own Verify sections (Resilience, Messaging & events) for runnable checks of those individual mechanisms.
Console.WriteLine("All runtime-checkable claims verified.");

public sealed class LruCache<TKey, TValue>(int capacity) where TKey : notnull
{
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new(capacity);
    private readonly LinkedList<(TKey Key, TValue Value)> _order = new();       // most recent at the front
    private readonly Lock _gate = new();

    public bool TryGet(TKey key, out TValue value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _order.Remove(node); _order.AddFirst(node);                     // mark as most recently used
                value = node.Value.Value; return true;
            }
            value = default!; return false;
        }
    }

    public void Put(TKey key, TValue value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var existing)) { _order.Remove(existing); _map.Remove(key); }
            else if (_map.Count >= capacity)
            {
                var lruNode = _order.Last!;                                     // evict least recently used
                _order.RemoveLast(); _map.Remove(lruNode.Value.Key);
            }
            _map[key] = _order.AddFirst((key, value));
        }
    }
}
```
