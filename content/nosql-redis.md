---
id: nosql-redis
title: NoSQL, Redis and Choosing a Data Store
summary: Beyond relational. The NoSQL families and their trade-offs, CAP and consistency models, document modelling and partitioning (Cosmos DB, MongoDB), Redis data structures and patterns (cache, locks, rate limits, pub/sub, streams), search and vector stores, and a decision guide for picking storage.
layer: data
where: Data & state › Non-relational stores & caches
fits: These are alternative layer-5 stores. Redis is also the backing store for distributed caching ([Caching](ch:caching-ratelimit-cors)), SignalR scale-out ([App models](ch:app-models)) and distributed locks ([Background work](ch:background-work)). On Azure they're managed services ([Azure data & messaging](ch:azure-data-messaging)).
levels: b,i,a
prereqs: relational-fundamentals
next: azure-data-messaging, caching-ratelimit-cors, design-principles
---

## TL;DR

- "NoSQL" is a grab-bag, not one thing: key-value, document, wide-column, graph, search, time-series and vector stores each trade away general-purpose flexibility to be very good at one access pattern.
- **CAP theorem**: during a network partition, a distributed store must pick consistency (always correct) or availability (always responding, maybe stale) — not both. **PACELC** adds that even without a partition, you still trade latency for consistency.
- Document databases model by **access pattern, not normal form**: store together what you read together, even if that duplicates data (and that duplication is often correct, not a bug).
- In Cosmos DB, the **partition key** you pick decides cost and scalability for the container's lifetime — a low-cardinality key like `date` creates a hot partition that every write piles onto.
- **Redis** is an in-memory data-structure server, not just a cache: strings, hashes, lists, sets, sorted sets and streams give you ready-made algorithms (ranking, rate limiting, locks), not just key-value storage.
- Default to relational for business data; reach for a NoSQL store for a specific, deliberate reason (scale, flexible schema, a specialised access pattern) — not just to dodge schema migrations.

## The NoSQL families: optimised for an access pattern, not a feature list {b}

"NoSQL" is really a negative definition — "not (only) relational tables" — which hides how different the actual families are from each other. Each one made a deliberate trade to get extremely good at one access pattern, usually at the cost of the general-purpose flexibility a relational table gives you for free:

| Family | Data model | Examples | Good at | Weak at |
|---|---|---|---|---|
| **Key-value** | Key → value (opaque or simple structures) | **Redis**, Azure Table Storage, DynamoDB (KV mode) | Ultra-fast lookups by key, caching, counters, sessions | Queries by anything but the key |
| **Document** | JSON-like documents, flexible schema | **Cosmos DB (NoSQL API)**, **MongoDB**, Couchbase | Aggregates read and written as a whole, varying schemas, horizontal scale | Joins across documents, multi-document transactions (limited) |
| **Wide-column** | Rows with dynamic columns, partitioned | Cassandra, ScyllaDB, Cosmos DB for Cassandra | Massive write throughput, time series | Ad-hoc queries |
| **Graph** | Nodes + edges | Neo4j, Cosmos DB for Gremlin | Relationship traversal (social, recommendations, fraud) | Bulk aggregations |
| **Search** | Inverted indexes | Elasticsearch/OpenSearch, Azure AI Search | Full-text, faceting, relevance | Being the source of truth |
| **Time series** | Timestamped measurements | InfluxDB, Azure Data Explorer, TimescaleDB | Metrics, IoT | General-purpose data |
| **Vector** | Embeddings + similarity indexes | Azure AI Search, Cosmos DB vector search, pgvector, Qdrant | Semantic search, RAG for AI features | Exact queries |

:::why Why not always use SQL?
Relational databases are the right default for business data: strong consistency, transactions, joins, mature tooling. NoSQL wins when you need **horizontal scale beyond one server**, **very low latency at huge volume**, **flexible or nested schemas**, **global distribution**, or a **specialised access pattern** (search, graph, vectors). Many systems use both: **polyglot persistence**.
:::

## CAP, PACELC and consistency models: the trade-off a distributed store can't avoid {i}

**CAP theorem**, in plain terms: imagine two servers holding the same data, and the network link between them breaks (a **P**artition). Networks genuinely do this — it's not a hypothetical edge case. While they're cut off from each other, each server must pick one of two bad options: refuse to answer, or guarantee correctness (**C**onsistency), or answer anyway and risk giving out stale data, but stay responsive (**A**vailability). You can't have both *during that break* — that's the whole theorem. Once the network heals, both are possible again.

**PACELC** asks the question CAP doesn't: what do you trade when there's *no* partition at all (the **E**lse case)? Even then, you trade **L**atency against **C**onsistency — because waiting for every replica to confirm a write (strong consistency) is always slower than writing to one and letting the others catch up later (eventual consistency, with a small window where they disagree).

Consistency models, in practice, form a spectrum from strongest to weakest, and the right choice depends entirely on what the data is actually for:

| Model | Guarantee |
|---|---|
| **Strong / linearizable** | Reads always return the latest committed write |
| **Bounded staleness** | Reads lag by at most K versions or T time |
| **Session** | Within a client session: read-your-writes, monotonic reads (Cosmos DB's default; ideal for most apps) |
| **Consistent prefix** | You never see writes out of order |
| **Eventual** | Replicas converge eventually; no ordering guarantees |

Cosmos DB lets you choose any of these five per account (and relax per request) — which is a useful thing to know specifically because it means the consistency decision isn't locked in once at the infrastructure level; it's a knob you can turn per query based on what that particular read actually needs.

## Document databases: modelling by access pattern, not by normal form {i}

The relational instinct, drilled into you by [Relational fundamentals](ch:relational-fundamentals#normalisation-and-when-to-break-it), is to normalise: store each fact once, join at read time. Document modelling runs in the opposite direction on purpose: **design for the access pattern** — store together whatever gets *read* together, even if that means the same fact appears in more than one document.

```json
// Cosmos DB document: an order as one aggregate, with lines embedded
{
  "id": "ord-1042",
  "customerId": "cust-7",          // partition key
  "type": "order",
  "status": "Paid",
  "createdAt": "2026-10-27T14:00:00Z",
  "shippingAddress": { "street": "Main St 1", "city": "Berlin", "country": "DE" },
  "lines": [
    { "sku": "KB-01", "name": "Keyboard", "qty": 1, "unitPrice": 49.90 },
    { "sku": "MS-02", "name": "Mouse", "qty": 2, "unitPrice": 19.90 }
  ],
  "total": 89.70,
  "_etag": "\"0000d...\""          // optimistic concurrency
}
```

| Embed when… | Reference (store an ID) when… |
|---|---|
| Data is read together (order + lines) | Data is shared by many parents (product catalogue) |
| Child data is bounded in size | It grows without bound (all of a customer's orders) |
| Child changes with the parent | It changes independently and often |
| You need atomic updates of the whole | You'd otherwise duplicate large data |

**Denormalisation is normal here, by design**: copying a product's *name* into the order line isn't a mistake to clean up later — it's genuinely the correct historical record of what that line said at the time of purchase, exactly the same "snapshot data is not duplication" principle [Relational fundamentals](ch:relational-fundamentals#normalisation-and-when-to-break-it) raised for relational schemas too. Where copies do need to stay roughly in sync with a source of truth, change feeds or events are the usual mechanism, covered next.

## Partitioning: the one modelling decision you can't easily undo {a}

Distributed databases split data across physical **partitions** by a **partition key**, and in Cosmos DB specifically, this single choice ends up determining **scalability, cost, and which queries are cheap** for the lifetime of the container:

- **High cardinality** (many distinct values) so data and load spread evenly.
- **Even request distribution**: avoid **hot partitions** (e.g. partitioning by `date` sends all of today's writes to one partition).
- **Most queries filter by it**: single-partition queries are cheap; cross-partition fan-out queries cost more Request Units and are slower.
- Transactions (stored procedures, transactional batch) are limited to **one logical partition**.
- A logical partition has a size limit (20 GB), so use **hierarchical partition keys** (e.g. tenantId → userId) for large tenants.

Notice how directly the first three bullets connect: picking `customerId` as the partition key (as the JSON document above does) means every query scoped to one customer — the overwhelmingly common case for an e-commerce order history — stays within a single partition, cheap and fast. Had the key been `createdAt` instead, every write for "today" would pile onto the same partition while yesterday's sat idle, exactly the hot-partition failure the second bullet warns about.

Cosmos DB charges in **Request Units (RU/s)**, provisioned or serverless/autoscale. A 1 KB point read by id + partition key costs about 1 RU; queries cost more, which is precisely why the SDK example below reads `RequestCharge` directly — it's the concrete feedback loop for whether a given access pattern is actually cheap.

```csharp
// Cosmos DB .NET SDK (singleton CosmosClient)
builder.Services.AddSingleton(_ => new CosmosClient(endpoint, new DefaultAzureCredential(),
    new CosmosClientOptions { SerializerOptions = new() { PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase } }));

var container = cosmos.GetContainer("shop", "orders");
await container.CreateItemAsync(order, new PartitionKey(order.CustomerId), cancellationToken: ct);

var read = await container.ReadItemAsync<OrderDoc>("ord-1042", new PartitionKey("cust-7"), cancellationToken: ct);   // point read: cheapest
Console.WriteLine(read.RequestCharge);                                                                                 // RU cost

var query = container.GetItemLinqQueryable<OrderDoc>(requestOptions: new() { PartitionKey = new PartitionKey("cust-7") })
    .Where(o => o.Status == "Paid").OrderByDescending(o => o.CreatedAt).ToFeedIterator();
while (query.HasMoreResults) foreach (var o in await query.ReadNextAsync(ct)) { /* … */ }

// Optimistic concurrency with ETag
await container.ReplaceItemAsync(updated, updated.Id, new PartitionKey(updated.CustomerId),
    new ItemRequestOptions { IfMatchEtag = read.ETag }, ct);          // 412 if changed meanwhile
```

Notice that last call leans on the exact same optimistic-concurrency idea as EF Core's `RowVersion` from [EF Core advanced](ch:efcore-advanced#optimistic-concurrency-catching-a-lost-update-without-ever-l) — an `ETag` here plays precisely the same role, detecting a concurrent write rather than preventing it with a lock.

The **change feed** streams every insert and update, in order, per partition, and it's the foundation most Cosmos DB integrations are quietly built on top of: materialised views, event-driven integration with other services, and keeping a search index in sync without the application code ever having to explicitly push updates to it. MongoDB offers the equivalent capability as change streams; EF Core does ship a Cosmos provider, but the native SDK shown above gives more direct control, especially over RU cost.

## Redis: an in-memory data-structure server, not just a cache {b}

**Redis** is often introduced purely as "a cache," which undersells what it actually is: an in-memory data-structure server offering sub-millisecond operations, optional persistence (RDB snapshots, an AOF log), replication, and clustering. On Azure: **Azure Managed Redis** (successor of Azure Cache for Redis). Client: **StackExchange.Redis**. Open-source forks and alternatives include **Valkey** and **Garnet** (Microsoft's Redis-compatible server written in C#).

### Data structures

| Type | Commands | Backend uses |
|---|---|---|
| **String** | `GET`, `SET key val EX 60 NX`, `INCR` | Cache values, counters, distributed locks, idempotency keys |
| **Hash** | `HSET`, `HGET`, `HINCRBY` | Objects with fields (session, cart) |
| **List** | `LPUSH`, `RPOP`, `BLPOP` | Simple queues, recent-items lists |
| **Set** | `SADD`, `SISMEMBER`, `SINTER` | Unique visitors, tags, "who's online" |
| **Sorted set** | `ZADD`, `ZRANGE`, `ZINCRBY` | Leaderboards, priority queues, sliding-window rate limits, time indexes |
| **Stream** | `XADD`, `XREADGROUP`, `XACK` | Durable-ish event log with consumer groups |
| **Pub/Sub** | `PUBLISH`, `SUBSCRIBE` | Fire-and-forget broadcast (SignalR backplane, cache invalidation) |
| **HyperLogLog, Bitmaps, Geo** | `PFADD`, `SETBIT`, `GEOSEARCH` | Approximate counts, flags, location queries |
| **JSON, Search, Vector** (modules) | `JSON.SET`, `FT.SEARCH` | Document storage, secondary indexes, vector similarity |

```csharp
builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConnectionString));   // ONE per app: thread-safe, multiplexed

public sealed class RedisPatterns(IConnectionMultiplexer mux)
{
    private readonly IDatabase _db = mux.GetDatabase();

    // Counter with expiry: simple fixed-window rate limit
    public async Task<bool> AllowAsync(string user, int limit)
    {
        var key = $"rl:{user}:{DateTime.UtcNow:yyyyMMddHHmm}";
        var count = await _db.StringIncrementAsync(key);
        if (count == 1) await _db.KeyExpireAsync(key, TimeSpan.FromMinutes(1));
        return count <= limit;
    }

    // Leaderboard
    public Task AddScoreAsync(string player, double points) => _db.SortedSetIncrementAsync("leaderboard", player, points);
    public Task<SortedSetEntry[]> TopAsync(int n) => _db.SortedSetRangeByRankWithScoresAsync("leaderboard", 0, n - 1, Order.Descending);

    // Distributed lock: SET NX with expiry, release only if we own it
    public async Task<bool> TryRunExclusiveAsync(string name, TimeSpan ttl, Func<Task> work)
    {
        var token = Guid.NewGuid().ToString();
        if (!await _db.LockTakeAsync($"lock:{name}", token, ttl)) return false;
        try { await work(); return true; }
        finally { await _db.LockReleaseAsync($"lock:{name}", token); }
    }
}
```

That rate-limiter and leaderboard both lean on the same insight: Redis's data structures aren't just storage, they're the *algorithm* — a sorted set naturally maintains ranking as scores update, so "top 10" is a direct `ZRANGE` call rather than something your application code has to compute by sorting a fetched list itself.

:::gotcha Redis pitfalls
- **Create one `ConnectionMultiplexer`** and reuse it for the app's lifetime — creating one per request is the exact same mistake as the HttpClient socket-exhaustion bug from [Calling other services](ch:http-client#the-two-classic-bugs-and-why-theyre-opposite-mistakes), just against a different protocol.
- **Big keys and hot keys** (a 50 MB value, one key hit by every single request) hurt latency for *everyone* sharing that shard, because Redis processes commands mostly single-threaded per shard — a slow operation on one key blocks the queue behind it.
- **`KEYS *`** blocks the server while it scans the entire keyspace. Use `SCAN`, which walks it incrementally instead.
- **Memory is the limit**: set `maxmemory` and an eviction policy (`allkeys-lru` for caches), and always set TTLs on cache keys — without one, a cache silently becomes a permanent, ever-growing store.
- **Pub/Sub isn't durable**: a subscriber that's offline when a message is published simply never receives it, with no retry or queue underneath. Use Streams or a real broker for anything that must be delivered.
- Locks with a TTL can expire while the protected work is still running, letting a second caller start before the first has actually finished. Use fencing tokens, or simply make the protected work idempotent, for genuinely critical sections.
:::

## Search and vector stores {a}

Databases, relational or document, are poor at relevance-ranked full-text search, typo tolerance, facets, and synonyms — that's simply not the problem they were built to solve. The common pattern keeps the **source of truth** in SQL or Cosmos and **projects** a copy into a dedicated search index, kept in sync via the change feed or events covered earlier:

- **Azure AI Search** (managed; full-text + vector + hybrid search, semantic ranking), **Elasticsearch/OpenSearch**.
- **Vector search** powers AI features (semantic search, RAG): store embeddings next to documents in Azure AI Search, Cosmos DB, PostgreSQL **pgvector**, SQL Server 2025/Azure SQL vector type, Redis, Qdrant. .NET's **Microsoft.Extensions.VectorData** abstractions and **Microsoft.Extensions.AI** give provider-neutral APIs.

## Choosing a data store {i}

```text
Business data with relationships, transactions, reporting?          → SQL Server / PostgreSQL (default)
Aggregates read/written whole, flexible schema, global scale, low latency by key? → Cosmos DB / MongoDB
Cache, sessions, counters, locks, leaderboards, rate limits?          → Redis
Files, images, exports, backups, large blobs?                         → Blob storage (store the URL in the DB)
Full-text search, facets, relevance, semantic/vector search?          → Azure AI Search / Elasticsearch (as a projection)
Event stream for many consumers, replay, high volume?                 → Event Hubs / Kafka
Metrics, logs, telemetry analytics?                                    → Azure Monitor / Data Explorer / time-series DB
Highly connected data, path queries?                                   → Graph DB
```

**Don't** put large files in the database (use Blob Storage and store references), **don't** use a cache as the system of record, and **don't** choose NoSQL just to avoid schema migrations: schema-on-read still needs versioning (add a `schemaVersion` field and handle old shapes).

:::qa When would you choose a NoSQL database over a relational one?
When access patterns are mostly by key or aggregate, the schema is flexible or nested, you need horizontal scale or global distribution beyond a single SQL server, or very low latency at high throughput, or a specialised model (graph, search, time series). Relational remains the default for transactional business data with joins and reporting.
:::

:::qa Explain the CAP theorem.
In a distributed system, when a network partition occurs you can provide either consistency (all reads see the latest write or fail) or availability (all requests get a response, possibly stale), not both. PACELC adds that, even without partitions, you trade latency against consistency.
:::

:::qa How do you choose a partition key in Cosmos DB?
High cardinality, even distribution of storage and requests (no hot partitions), and present in most queries so they stay single-partition. Consider transactional scope (single partition only) and the 20 GB logical partition limit; use hierarchical keys for big tenants.
:::

:::qa Embed vs reference in document modelling?
Embed data that's read and updated together and bounded in size (order lines in an order). Reference data that's shared, unbounded, or updated independently (products, a customer's orders). Model for the access patterns, and accept some denormalisation.
:::

:::qa What is Redis used for in .NET backends?
Distributed caching (IDistributedCache/HybridCache L2), session and cart storage, rate-limit counters, distributed locks, leaderboards and sorted indexes, pub/sub (SignalR backplane, cache invalidation) and streams. Use one shared ConnectionMultiplexer.
:::

:::qa How would you implement a distributed lock with Redis, and what are the risks?
SET key token NX PX ttl to acquire (only if absent, with expiry), and release only if the value still matches your token (LockTake/LockRelease in StackExchange.Redis, or a Lua script). Risks: the TTL can expire while work continues, and failover can lose locks. Use fencing tokens and idempotent work for critical cases.
:::

:::qa Why shouldn't you use Redis Pub/Sub for important events?
It's fire-and-forget: messages aren't persisted, and subscribers that are offline or slow miss them. Use Redis Streams with consumer groups or a real message broker (Service Bus, RabbitMQ, Kafka) for reliable delivery.
:::

## Further reading

- [Azure Cosmos DB: modelling data](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/modeling-data)
- [Partitioning and horizontal scaling in Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [StackExchange.Redis documentation](https://stackexchange.github.io/StackExchange.Redis/)
- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- Book: *Designing Data-Intensive Applications* (Kleppmann), chapters 2, 5, 6 and 9.

## Verify this chapter

Run with `dotnet run` (a plain console app, .NET 8/9, no extra packages, no live Redis or Cosmos DB server needed). It re-implements, in-process, the exact algorithms the chapter describes — hot-partition math, the fixed-window rate limiter, sorted-set ranking, and ETag-based optimistic concurrency — and checks their behavior directly. CAP/PACELC during a real network partition, actual Cosmos DB RU pricing, and live `StackExchange.Redis` behavior need a real distributed system to observe, so those are left to the Further reading links instead of faked here.

```csharp
// Verify this chapter: run with `dotnet run`. No external packages or live
// Redis/Cosmos DB server needed -- those claims require a real network
// service and are left to the Further reading links instead of faked here.
using System;
using System.Collections.Generic;
using System.Linq;

void Check(string name, bool ok)
{
    if (!ok) throw new Exception($"FAIL: {name}");
    Console.WriteLine($"OK: {name}");
}

// 1. Partition key choice: partitioning by customerId spreads today's writes
//    across many partitions; partitioning by date concentrates them into one.
// This reproduces, in miniature, the exact claim in "Partitioning": picking a
// low-cardinality key like `date` creates a hot partition.
const int customers = 500;
const int ordersToday = 2000;
var rng = new Random(42);

var byCustomerId = new Dictionary<int, int>();
var byDate = new Dictionary<string, int>();
string today = "2026-10-28";
for (int i = 0; i < ordersToday; i++)
{
    int customerId = rng.Next(customers);
    byCustomerId[customerId] = byCustomerId.GetValueOrDefault(customerId) + 1;
    byDate[today] = byDate.GetValueOrDefault(today) + 1; // every write lands on "today"
}
int hottestByCustomerId = byCustomerId.Values.Max();
int hottestByDate = byDate.Values.Max();
Check("partitioning by customerId spreads load (busiest partition holds a small share)",
    hottestByCustomerId < ordersToday / 10);
Check("partitioning by date concentrates ALL of today's writes onto one partition",
    hottestByDate == ordersToday);

// 2. Fixed-window rate limiter: the same algorithm as RedisPatterns.AllowAsync,
// re-implemented over an in-memory dictionary instead of StringIncrementAsync,
// to verify the counting/window logic itself (not the Redis client).
var windowCounts = new Dictionary<string, int>();
bool Allow(string user, string window, int limit)
{
    var key = $"{user}:{window}";
    windowCounts[key] = windowCounts.GetValueOrDefault(key) + 1;
    return windowCounts[key] <= limit;
}
int allowedInWindow = 0;
for (int i = 0; i < 7; i++) if (Allow("user-1", "w1", 5)) allowedInWindow++;
Check("fixed-window limiter allows exactly `limit` requests per window (5 of 7 allowed)", allowedInWindow == 5);
bool allowedInNewWindow = Allow("user-1", "w2", 5);
Check("a new window resets the counter, so the next request is allowed again", allowedInNewWindow);

// 3. Sorted-set leaderboard: ZADD/ZINCRBY + ZRANGE keep "top N" always sorted
// without the caller re-sorting. SortedSet<T> here plays the role Redis's
// native sorted set plays server-side -- the property under test is that
// ranking stays correct after incremental score updates, same as ZINCRBY.
var scores = new SortedSet<(double Score, string Player)>(
    Comparer<(double Score, string Player)>.Create((a, b) =>
        a.Score != b.Score ? b.Score.CompareTo(a.Score) : string.CompareOrdinal(a.Player, b.Player)));

void AddScore(string player, double delta)
{
    var existing = scores.FirstOrDefault(s => s.Player == player);
    if (!default((double, string)).Equals(existing)) scores.Remove(existing);
    scores.Add((existing.Score + delta, player));
}
AddScore("alice", 10);
AddScore("bob", 25);
AddScore("carol", 15);
AddScore("alice", 20); // alice now has 30, should become #1
var top2 = scores.Take(2).Select(s => s.Player).ToArray();
Check("leaderboard stays ranked after an incremental score update (alice overtakes bob)",
    top2.SequenceEqual(new[] { "alice", "bob" }));

// 4. Optimistic concurrency via a version/ETag match -- the same pattern as
// Cosmos DB's IfMatchEtag / EF Core's RowVersion, reduced to its essence.
string Replace(Dictionary<string, (string Value, string ETag)> store, string id, string newValue, string expectedETag)
{
    var (_, currentETag) = store[id];
    if (currentETag != expectedETag) return "412 Precondition Failed";
    store[id] = (newValue, Guid.NewGuid().ToString("N")[..8]);
    return "200 OK";
}
var docs = new Dictionary<string, (string Value, string ETag)> { ["ord-1"] = ("Pending", "etag-v1") };
var staleResult = Replace(docs, "ord-1", "Shipped", "etag-stale"); // someone else already changed it
Check("a replace with a stale ETag is rejected (optimistic concurrency catches the lost update)",
    staleResult == "412 Precondition Failed");
var freshResult = Replace(docs, "ord-1", "Paid", "etag-v1"); // matches current ETag
Check("a replace with the current ETag succeeds", freshResult == "200 OK");

// Not runtime-verifiable here (need a live Redis/Cosmos DB server or a
// multi-node cluster to observe for real): CAP/PACELC trade-offs during an
// actual network partition, Cosmos DB consistency levels, RU pricing, and
// StackExchange.Redis/ConnectionMultiplexer behavior against a live server --
// see Further reading: Azure Cosmos DB docs, StackExchange.Redis docs,
// and Kleppmann's "Designing Data-Intensive Applications".

Console.WriteLine("All checks passed.");
```
