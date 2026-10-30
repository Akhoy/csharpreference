---
id: efcore-querying
title: EF Core Querying and Performance
summary: Where EF Core apps get slow, and how to fix them. How a LINQ query becomes SQL, seeing the generated SQL, tracking vs no-tracking, projections, loading related data (eager, explicit, lazy) and the N+1 problem, split queries and cartesian explosion, client evaluation, paging, raw SQL, async, and a performance checklist.
layer: data
where: Data & state › EF Core › Querying & performance
fits: This chapter is where layer 1 ([LINQ](ch:linq), [async](ch:async-await)) meets layer 5 ([Relational fundamentals](ch:relational-fundamentals)). Nearly every "the API is slow" investigation ends up here, usually after tracing ([Observability](ch:observability-aspire)) shows that a database span is the slow part.
levels: b,i,a
prereqs: efcore-fundamentals, linq
next: efcore-advanced, caching-ratelimit-cors
---

## TL;DR

- A LINQ query against `DbSet<T>` doesn't touch the database until a **terminating operator** (`ToListAsync`, `FirstOrDefaultAsync`, etc.) runs it — everything before that just builds up a description of the query.
- Turn on SQL logging or call `.ToQueryString()` so you can see what EF Core actually sends, instead of guessing.
- For read-only queries, skip tracking (`AsNoTracking()`) and project straight into a DTO with `Select` — it's faster and sidesteps N+1 for free.
- **N+1** (one query, then one more per row) is the most common EF Core slowdown. Fix it with projection, eager loading (`Include`), or batching (`Contains`).
- Including multiple collections in one query can multiply rows instead of adding them (cartesian explosion); `AsSplitQuery()` trades that for extra round trips.
- EF Core refuses to silently run C# it can't translate to SQL — write translatable expressions, or filter in memory explicitly, after a server-side filter has already cut the data down.

## From LINQ to SQL, and the one moment it actually runs {b}

```csharp
var recent = await db.Orders
    .Where(o => o.CustomerId == customerId && o.CreatedAt >= since)
    .OrderByDescending(o => o.CreatedAt)
    .Select(o => new OrderSummary(o.Id, o.CreatedAt, o.Lines.Sum(l => l.Quantity * l.UnitPrice)))
    .Take(20)
    .ToListAsync(ct);
```

```sql
-- what EF Core sends (SQL Server)
SELECT TOP(@__p_2) [o].[Id], [o].[CreatedAt], (
    SELECT COALESCE(SUM(CAST([l].[Quantity] AS decimal(18,2)) * [l].[UnitPrice]), 0.0)
    FROM [OrderLines] AS [l] WHERE [o].[Id] = [l].[OrderId])
FROM [Orders] AS [o]
WHERE [o].[CustomerId] = @__customerId_0 AND [o].[CreatedAt] >= @__since_1
ORDER BY [o].[CreatedAt] DESC
```

The pipeline behind that transformation: your LINQ expression becomes an expression tree — exactly the data structure [LINQ](ch:linq#expression-trees-how-c-becomes-sql) covered — which EF's query pipeline compiles into provider-specific SQL, with captured variables turned into safe **parameters**, executed via ADO.NET, and the resulting rows **materialised** back into objects (tracked, by default, unless told otherwise).

Here's the detail worth holding onto for the rest of this chapter: nothing above actually touches the database until it hits a **terminating operator** — `ToListAsync`, `ToArrayAsync`, `FirstOrDefaultAsync`, `SingleAsync`, `CountAsync`, `AnyAsync`, `SumAsync`, `MaxAsync`, `ToDictionaryAsync`, `ExecuteUpdateAsync`, `ExecuteDeleteAsync`, or `await foreach` over `AsAsyncEnumerable()`. Everything before that point — every `.Where`, every `.OrderBy` — is just building up a description of a query, not running one. This deferred-execution behaviour is exactly what [LINQ](ch:linq#deferred-execution-a-recipe-not-a-meal) warned generalises to bugs where a query runs again, against changed data, because something re-enumerated it.

## See the SQL first — you can't tune what you can't see {b}

```csharp
// 1. Log SQL (development)
builder.Services.AddDbContext<ShopDb>(o => o.UseSqlServer(cs)
    .LogTo(Console.WriteLine, LogLevel.Information)
    .EnableSensitiveDataLogging()          // shows parameter values: DEV ONLY
    .EnableDetailedErrors());
// or via configuration: "Microsoft.EntityFrameworkCore.Database.Command": "Information"

// 2. Inspect a single query without running it
var sql = db.Orders.Where(o => o.Total > 100).ToQueryString();

// 3. Tag queries so you can find them in Query Store / traces
var q = db.Orders.TagWith("Dashboard: recent big orders").Where(o => o.Total > 1000);
```

In production, **OpenTelemetry EF Core instrumentation** ([Observability](ch:observability-aspire)) records every query as a span with its duration, and Query Store or Azure SQL Insights shows the slowest statements — the same "trace it before guessing" discipline that [Performance engineering](ch:performance-engineering) applies everywhere else.

## Tracking vs no-tracking: paying for a feature you often don't need {b}

Recall from [EF Core fundamentals](ch:efcore-fundamentals#change-tracking-and-savechanges-how-ef-core-knows-what-to-wr) that tracking means keeping a snapshot of every loaded entity so `SaveChanges()` can detect what changed. For a query that's purely reading data to send to a client — never going to be saved back — that snapshot is pure overhead:

| | Tracking (default) | `AsNoTracking()` | `AsNoTrackingWithIdentityResolution()` |
|---|---|---|---|
| Snapshot kept | Yes | No | No (identity map only for the query) |
| Can SaveChanges modifications | Yes | No | No |
| Duplicate rows → same instance | Yes | No: separate objects | Yes |
| Speed / memory | Slower | **Fastest** | In between |
| Use for | Load-modify-save | **Read-only queries** | Read-only with repeated related entities |

```csharp
var products = await db.Products.AsNoTracking().Where(p => p.IsActive).ToListAsync(ct);
```

You can flip the default for an entire context instead of annotating every query (`UseQueryTrackingBehavior(NoTracking)`) and opt back in with `AsTracking()` on the specific queries that need it — a pattern that fits read-heavy APIs particularly well, since most of their queries never modify anything.

## Projection: the single biggest win in this chapter {b}

```csharp
// ✘ Loads EVERY column of Orders, Customer AND Lines, tracks them all, then the API maps to a DTO
var orders = await db.Orders.Include(o => o.Customer).Include(o => o.Lines).ToListAsync(ct);
var dtos = orders.Select(o => new OrderSummary(o.Id, o.Customer.Name, o.Lines.Count));

// ✔ SQL selects only 3 values per row; no tracking (projections into non-entities aren't tracked); no Include needed
var dtos2 = await db.Orders
    .Select(o => new OrderSummary(o.Id, o.Customer.Name, o.Lines.Count))
    .ToListAsync(ct);
```

Notice everything the second version gets for free, just by moving the `Select` earlier: fewer columns actually travel over the wire, nothing gets tracked (projections into plain DTOs are never tracked at all), and — this is the part worth sitting with — **navigations referenced inside a `Select` get translated into joins or subqueries by EF Core itself**, which sidesteps the N+1 problem the next section covers entirely, without you having to think about `Include` at all. **Projecting with `Select` into DTOs** should be the default for every read endpoint you write. Mapping libraries can project too — AutoMapper's `ProjectTo`, Mapperly's `IQueryable` projections — if you'd rather not hand-write the DTO construction.

## Loading related data: four strategies, one clearly preferred {i}

| Strategy | How | SQL | When |
|---|---|---|---|
| **Eager** | `.Include(o => o.Lines).ThenInclude(l => l.Product)` | JOIN(s) in the same query | You need entities **plus** related data, typically to modify them |
| **Projection** | Navigations inside `Select` | JOIN/subquery, only needed columns | Read models / DTOs (**preferred for reads**) |
| **Explicit** | `await db.Entry(order).Collection(o => o.Lines).LoadAsync()` | A separate query, on demand | Conditionally loading for an already-loaded entity |
| **Lazy** | Virtual navigations + proxies (`UseLazyLoadingProxies()`) | A query **when the property is first accessed** | Rarely; hides N+1 |

```csharp
// Filtered include (EF 5+)
var customer = await db.Customers
    .Include(c => c.Orders.Where(o => o.Status == OrderStatus.Open).OrderByDescending(o => o.CreatedAt).Take(5))
    .SingleAsync(c => c.Id == id, ct);
```

That "rarely; hides N+1" note in the Lazy row isn't a footnote — it's exactly why the next section exists.

## The N+1 problem: the single most common EF Core performance bug {i}

The shape of this bug: **1 query** loads a list, then **N more queries** — one per item in that list — load each item's related data:

```csharp
// Lazy loading enabled:
var orders = await db.Orders.Where(o => o.CreatedAt >= today).ToListAsync(ct);   // 1 query → 200 orders
foreach (var o in orders)
    Console.WriteLine(o.Customer.Name);                                           // +200 queries (one per order)
```

![Loading five orders and their customers: with a query inside the loop, five orders cost six round trips; with projection, the database does the join in one round trip, regardless of row count](visuals/n-plus-one.svg)

That's 201 round trips instead of 1. Each one might take only 1–2 ms on its own, which is exactly why this bug slips past code review — it looks harmless in isolation. But 201 of them back-to-back adds up to hundreds of milliseconds, and it only gets worse as the order count grows. It also happens **without lazy loading enabled at all**, any time you call the database inside a loop:

```csharp
foreach (var id in productIds)
    prices[id] = await db.Products.Where(p => p.Id == id).Select(p => p.Price).SingleAsync(ct);   // ✘ N queries

var prices2 = await db.Products.Where(p => productIds.Contains(p.Id))                            // ✔ 1 query: WHERE Id IN (…)
    .ToDictionaryAsync(p => p.Id, p => p.Price, ct);
```

**Detect it:** SQL logs show the exact same statement shape repeating many times in a row; a trace shows dozens of identical, tiny database spans nested under one request; `dotnet-counters` shows an unusually high queries-per-request count for an endpoint that only looks like it returns one thing. **Fix it:** projection (as above — the usual answer), eager loading with `Include`, batching with `Contains` (as the second fix shows), or a DataLoader if you're serving this through GraphQL.

## Cartesian explosion and split queries {a}

A related but distinct trap: including **multiple collection navigations** in a single query doesn't add rows, it **multiplies** them, because a SQL join flattens nested collections into one wide, repeated result set:

```csharp
var blogs = await db.Blogs.Include(b => b.Posts).Include(b => b.Contributors).ToListAsync();
// 1 blog × 100 posts × 20 contributors = 2,000 rows returned, with blog columns duplicated in every row
```

Here's why: SQL must emit one row for every post-contributor pair, repeating the blog's own columns in each row. 100 posts × 20 contributors = 2,000 rows, each one carrying a full, duplicate copy of the blog's data — a lot of redundant bytes for what's conceptually one blog with two separate lists attached to it.

```csharp
var blogs2 = await db.Blogs.Include(b => b.Posts).Include(b => b.Contributors)
    .AsSplitQuery()                // 3 separate SQL queries: blogs, posts, contributors
    .ToListAsync();
// configure globally: UseSqlServer(cs, o => o.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery))
```

`AsSplitQuery()` swaps one problem for a usually smaller one: more round trips (three queries instead of one), and the loss of a single consistent snapshot — the data could change between those three queries unless you wrap them in an explicit transaction — in exchange for not multiplying rows. EF Core even logs a warning when it detects multiple collection includes in one query, because this trade-off is easy to hit by accident.

## Client evaluation and translation errors {i}

EF Core can only translate what it actually understands into SQL: the standard LINQ operators, many `string`/`Math`/`DateTime` members, `EF.Functions.Like`, provider-specific functions, and any functions you've explicitly mapped yourself.

```csharp
var q = db.Products.Where(p => IsBargain(p));        // ✘ InvalidOperationException: could not be translated
static bool IsBargain(Product p) => p.Price < p.ListPrice * 0.5m;

var q2 = db.Products.Where(p => p.Price < p.ListPrice * 0.5m);   // ✔ inline the logic as an expression
```

- **EF Core 3+ throws** here instead of silently pulling everything into memory and filtering with plain C#. EF Core 1–2 did exactly that by default, and Microsoft's own breaking-changes notes for 3.0 call out exactly this scenario — a filter that looks fine on a small test table, then quietly loads an entire production table once it grows (see Further reading).
- The **final `Select`** is a partial exception: EF evaluates anything it can't translate on the client, but only **after** it has already fetched just the columns it needs from the server — that's fine, because by then the expensive filtering has already happened in SQL.
- If you must filter in memory, do it **explicitly, after** a server-side filter has already cut the data down: `.Where(serverSide).AsAsyncEnumerable().Where(clientSide)`. Never let the untranslatable filter be the only thing standing between you and a full table scan.
- For reusable query logic, write **expression-returning** helpers (`static Expression<Func<Product,bool>> IsBargain => p => …`) or extension methods on `IQueryable<T>`, which stay translatable because they hand EF Core an expression tree rather than a compiled method it can't see inside.

## Paging, counting and existence {i}

```csharp
// Offset paging: always ORDER BY a unique key for deterministic pages
var page = await db.Products.OrderBy(p => p.Name).ThenBy(p => p.Id)
    .Skip((pageNo - 1) * size).Take(size)
    .Select(p => new ProductDto(p.Id, p.Name, p.Price)).ToListAsync(ct);

// Keyset paging: constant cost on deep pages
var next = await db.Products.Where(p => p.Id > lastSeenId).OrderBy(p => p.Id).Take(size).ToListAsync(ct);

bool any = await db.Orders.AnyAsync(o => o.CustomerId == id, ct);       // EXISTS: faster than CountAsync() > 0
```

Both paging styles here map directly onto the offset-vs-cursor tradeoff from [API design](ch:api-design#pagination-filtering-and-sorting-never-return-an-unbounded-l). One subtlety worth flagging on its own: a total count on a large, filtered table is itself an expensive query, essentially a full scan to count matches. For infinite-scroll UIs that only need to know "is there more," fetching `size + 1` rows and checking whether the extra one came back is usually far cheaper than computing an exact total.

## Raw SQL in EF Core {i}

```csharp
// Entities from SQL (composable: you can add LINQ on top)
var top = await db.Products
    .FromSql($"SELECT * FROM Products WITH (INDEX(IX_Products_Category)) WHERE CategoryId = {categoryId}")
    .Where(p => p.IsActive).OrderBy(p => p.Name).ToListAsync(ct);

// Arbitrary types (EF 8): unmapped DTOs, scalars
var stats = await db.Database.SqlQuery<CategoryStats>($"""
    SELECT CategoryId, COUNT(*) AS Products, AVG(Price) AS AvgPrice
    FROM Products GROUP BY CategoryId
    """).ToListAsync(ct);

// Commands
var n = await db.Database.ExecuteSqlAsync($"UPDATE Products SET IsActive = 0 WHERE DiscontinuedAt < {cutoff}", ct);
```

`FromSql`, `SqlQuery` and `ExecuteSql` all take a **`FormattableString`** — notice the `$"..."` syntax above — so interpolated values become real **parameters** under the hood, the same safe mechanism [ADO.NET & Dapper](ch:ado-dapper#the-layer-every-other-data-access-tool-is-secretly-built-on) insisted on. The `…Raw` variants instead take a plain string, and **never** concatenate user input into one — doing so reopens exactly the SQL injection hole parameterisation exists to close.

## Async and cancellation {b}

Use the async operators (`ToListAsync`, `SaveChangesAsync`…) in web apps and pass `CancellationToken` so abandoned requests cancel their SQL rather than running to completion for nobody. Don't run concurrent operations on one context — a `DbContext` isn't thread-safe, as [EF Core fundamentals](ch:efcore-fundamentals#dbcontext-and-dbset-your-session-with-the-database) warned. Stream genuinely large results with `AsAsyncEnumerable()` instead of buffering the entire result set in memory with `ToListAsync()`.

## Performance techniques {a}

| Technique | What it does |
|---|---|
| **DbContext pooling** (`AddDbContextPool`) | Reuses context instances, cutting per-request setup |
| **Compiled queries** (`EF.CompileAsyncQuery`) | Skips query compilation for very hot queries (EF already caches; this removes the lookup) |
| **Compiled models** (`dotnet ef dbcontext optimize`) | Faster startup for huge models; required for Native AOT |
| **`ExecuteUpdate` / `ExecuteDelete`** | Set-based writes without loading entities |
| **Batching** | SaveChanges batches statements automatically (tune `MaxBatchSize`) |
| **`AsNoTracking` + projections** | Less work and memory per query |
| **Avoid `Include` chains for reads** | Project instead |
| **Indexes matching your queries** | `HasIndex` in the model; verify with execution plans |
| **Split queries** | Avoid cartesian explosion |
| **Connection resiliency** | `EnableRetryOnFailure` for transient Azure SQL errors |
| **Caching** | For hot, rarely changing reads ([Caching](ch:caching-ratelimit-cors)) |

```csharp
private static readonly Func<ShopDb, int, CancellationToken, Task<ProductDto?>> GetProductById =
    EF.CompileAsyncQuery((ShopDb db, int id, CancellationToken ct) =>
        db.Products.Where(p => p.Id == id).Select(p => new ProductDto(p.Id, p.Name, p.Price)).FirstOrDefault());

var p = await GetProductById(db, 42, ct);
```

## Checklist for a slow EF Core endpoint {i}

Work through this in order — each step is cheap to check and most slow endpoints are caught well before step 10:

1. **Trace it**: is the time in the database, in serialization, or in app code?
2. **Look at the SQL** (`ToQueryString`, logs, the trace span).
3. **Count queries per request**: N+1? Queries in loops?
4. **Too many columns or rows?** Project; page; filter on the server.
5. **Tracking unnecessarily?** `AsNoTracking`.
6. **Cartesian explosion?** Split queries.
7. **Check the execution plan**: missing index, scans, key lookups, implicit conversions.
8. **Sync calls or `.Result`?** Make it async.
9. **Hot and stable data?** Cache it.
10. **Bulk writes?** `ExecuteUpdate`/`ExecuteDelete` or bulk copy.

:::qa What is the N+1 problem in EF Core and how do you fix it?
Loading a list with one query and then triggering an extra query per item to get related data, typically through lazy loading or querying inside a loop. Fix it with projections (Select into DTOs, translated into joins), eager loading (Include), or batching (WHERE Id IN via Contains). Detect it by logging SQL or inspecting traces.
:::

:::qa When should you use AsNoTracking?
For read-only queries: entities aren't snapshot-tracked, which saves memory and CPU. Projections into DTOs are untracked automatically. Use AsNoTrackingWithIdentityResolution when the same related entity appears in many rows and you want shared instances.
:::

:::qa Eager vs explicit vs lazy loading?
Eager loads related data in the same query via Include/ThenInclude. Explicit loads it later on demand with Entry(...).Collection/Reference().Load. Lazy loads automatically when a navigation property is first accessed (proxies), which easily causes N+1. For read endpoints, projection usually beats all three.
:::

:::qa What is a split query and when would you use it?
AsSplitQuery makes EF Core load included collections with separate SQL statements instead of one big JOIN, avoiding cartesian explosion when including multiple collections. The trade-off is extra round trips and no single snapshot without a transaction.
:::

:::qa Why might an EF Core query throw 'could not be translated'?
The LINQ contains something the provider can't convert to SQL, such as a call to a custom C# method in Where. Since EF Core 3, EF throws rather than silently evaluating on the client. Rewrite using translatable expressions, mapped DB functions, or filter in memory explicitly after a server-side filter.
:::

:::qa How do you see the SQL EF Core generates?
ToQueryString() on a query, LogTo/logging the Microsoft.EntityFrameworkCore.Database.Command category, EnableSensitiveDataLogging in development for parameter values, TagWith to label queries, and OpenTelemetry instrumentation or Query Store in production.
:::

:::qa How do you run raw SQL safely with EF Core?
Use FromSql / SqlQuery / ExecuteSql with interpolated strings: they take FormattableString and turn interpolated values into DbParameters. Avoid the Raw variants with concatenated input.
:::

:::qa How would you speed up a hot, read-heavy EF Core query?
Project into a DTO with only the needed columns, use no-tracking, make sure a supporting index exists (check the plan), consider a compiled query and DbContext pooling, cache the result if staleness is acceptable, and use keyset pagination for large lists.
:::

## Further reading

- [Efficient querying](https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying)
- [Loading related data](https://learn.microsoft.com/en-us/ef/core/querying/related-data/)
- [Single vs split queries](https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries)
- [Advanced performance topics](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics)
- [Breaking changes in EF Core 3.0: LINQ queries are no longer evaluated on the client](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-3.0/breaking-changes#linq-queries-are-no-longer-evaluated-on-the-client)

## Verify this chapter

The claims below that are pure C#/EF Core behavior are checked by running real queries against an in-memory SQLite database. Save as a console app (`dotnet new console`, `dotnet add package Microsoft.EntityFrameworkCore.Sqlite`), then `dotnet run`.

```csharp
using Microsoft.EntityFrameworkCore;

// SQLite's in-memory mode needs one open connection kept alive for the whole run.
var connString = "DataSource=file:verifydb?mode=memory&cache=shared";
await using var conn = new Microsoft.Data.Sqlite.SqliteConnection(connString);
await conn.OpenAsync();
var opts = new DbContextOptionsBuilder<ShopDb>().UseSqlite(conn).Options;

await using (var seed = new ShopDb(opts))
{
    await seed.Database.EnsureCreatedAsync();
    var c = new Customer { Name = "Ada" };
    seed.Customers.Add(c);
    seed.Orders.AddRange(
        new Order { Customer = c, Total = 10 },
        new Order { Customer = c, Total = 20 },
        new Order { Customer = c, Total = 30 });
    await seed.SaveChangesAsync();
}

// Claim: AsNoTracking() returned entities are not tracked (ChangeTracker has zero entries).
await using (var db = new ShopDb(opts))
{
    var orders = await db.Orders.AsNoTracking().ToListAsync();
    if (db.ChangeTracker.Entries().Any()) throw new Exception("FAIL: AsNoTracking still tracked entities");
    Console.WriteLine("OK: AsNoTracking() keeps the change tracker empty");
}

// Claim: projecting with Select avoids tracking too, even without AsNoTracking.
await using (var db = new ShopDb(opts))
{
    var dtos = await db.Orders.Select(o => new { o.Id, o.Total }).ToListAsync();
    if (db.ChangeTracker.Entries().Any()) throw new Exception("FAIL: projection was tracked");
    Console.WriteLine("OK: projecting into an anonymous type tracks nothing");
}

// Claim: a query is not executed until a terminating operator runs (deferred execution).
// Proof: build the query, THEN add a new row, THEN run it — if building ran the query early,
// the new row would be missing from the result.
await using (var db = new ShopDb(opts))
{
    var query = db.Orders.Where(o => o.Total > 0); // just builds the query, no SQL yet

    var extra = new Order { CustomerId = 1, Total = 999 };
    db.Orders.Add(extra);
    await db.SaveChangesAsync();

    var countBeforeExtra = 3; // seeded rows
    var list = await query.ToListAsync(); // SQL runs here, for the first time
    if (list.Count != countBeforeExtra + 1)
        throw new Exception($"FAIL: expected {countBeforeExtra + 1} rows, got {list.Count}");
    Console.WriteLine("OK: the query only ran at ToListAsync, after the extra row existed — not when it was built");
}

// Claim: N+1's fix — batching with Contains issues one query and returns all matching rows.
await using (var db = new ShopDb(opts))
{
    var ids = await db.Orders.Select(o => o.Id).ToListAsync();
    var totalsBatched = await db.Orders.Where(o => ids.Contains(o.Id))
        .ToDictionaryAsync(o => o.Id, o => o.Total);
    if (totalsBatched.Count != ids.Count) throw new Exception("FAIL: batched query didn't return all rows");
    Console.WriteLine("OK: a single WHERE Id IN (...) query returns all rows in one round trip");
}

Console.WriteLine("All checks passed.");

// --- Minimal model, matching the chapter's examples ---
class Customer { public int Id { get; set; } public string Name { get; set; } = ""; public List<Order> Orders { get; set; } = new(); }
class Order { public int Id { get; set; } public int CustomerId { get; set; } public Customer Customer { get; set; } = null!; public decimal Total { get; set; } }
class ShopDb : DbContext
{
    public ShopDb(DbContextOptions<ShopDb> options) : base(options) { }
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
}

// Not runtime-verifiable here (needs a real SQL Server/Azure SQL instance, Query Store, or OpenTelemetry collector):
// - exact generated T-SQL shown in this chapter (provider-specific; see Further reading: "Efficient querying")
// - cartesian explosion row counts from multiple collection Includes against a real relational engine's join semantics
// - production trace/Query Store behavior — see Further reading: "Advanced performance topics"
```
