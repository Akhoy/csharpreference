---
id: efcore-advanced
title: EF Core Advanced: Concurrency, Transactions, Interceptors, Filters and Bulk Operations
summary: The features you need at production scale. Optimistic concurrency with row versions, explicit transactions and execution strategies, ExecuteUpdate and ExecuteDelete, SaveChanges and command interceptors for auditing, global query filters for soft delete and multi-tenancy, domain events on save, and testing strategies.
layer: data
where: Data & state › EF Core › Advanced features
fits: These features sit where layer 5 meets layer 4. Concurrency and transactions protect data integrity ([Relational fundamentals](ch:relational-fundamentals#transactions-and-acid-the-unit-the-database-actually-guarantees)); interceptors and filters implement cross-cutting rules; dispatching domain events and the outbox on save connect EF Core to DDD ([DDD](ch:ddd)) and messaging ([Messaging & events](ch:messaging-events)).
levels: i,a
prereqs: efcore-fundamentals, efcore-querying
next: ddd, messaging-events, integration-testing
---

## TL;DR

- `SaveChanges()` is already transactional on its own; reach for an explicit transaction only when something wider needs to be atomic with it (several `SaveChanges` calls, raw SQL, Dapper on the same connection).
- **Optimistic concurrency** uses a version column, not locks: EF Core puts the original version in the `UPDATE`'s `WHERE` clause, and throws `DbUpdateConcurrencyException` if zero rows matched because someone else already changed the row.
- `ExecuteUpdate`/`ExecuteDelete` write straight to the database without loading entities first — fast, but they skip the change tracker and `SaveChanges` interceptors.
- Interceptors (`SaveChangesInterceptor`, `DbCommandInterceptor`, etc.) let you add cross-cutting behavior — auditing, soft delete, outbox — without scattering calls through business code.
- **Global query filters** (soft delete, multi-tenancy) apply automatically to every query against that entity — watch for a required navigation pulling a filtered-out row back in through an `INNER JOIN`.
- Writing outbox rows in the *same* `SaveChanges` transaction as the business data is what makes "save the order and record the event" atomic, without needing a real distributed transaction.

## Optimistic concurrency: catching a lost update without ever locking {i}

Here's the concrete failure this section exists to prevent: two users both load order 42 at the same moment. Alice changes the shipping address and saves. Bob, still holding the version he loaded a moment earlier — before Alice's save — changes the status and saves too, and his save **overwrites Alice's change** with the old address he never actually touched. Nobody did anything wrong individually; the collision is purely a timing accident. This is a **lost update**, the same anomaly named in [Relational fundamentals](ch:relational-fundamentals#isolation-levels-and-the-anomalies-each-one-actually-prevent).

**Optimistic concurrency** is built on a bet that pays off most of the time: conflicts like this are rare, so don't pay the cost of locking on every read — instead, **detect** a conflict only at the moment of writing, using a version column that changes on every update.

```csharp
public class Order
{
    public int Id { get; set; }
    public string ShippingAddress { get; set; } = "";
    [Timestamp] public byte[] RowVersion { get; set; } = [];   // SQL Server rowversion: auto-incremented by the DB on each update
}
// Fluent: b.Property(o => o.RowVersion).IsRowVersion();
// Postgres: b.Property<uint>("xmin").IsRowVersion(); (or a manually incremented Version property with IsConcurrencyToken())
```

EF Core adds the original version to the `WHERE` clause of the generated `UPDATE`:

```sql
UPDATE Orders SET ShippingAddress = @p0
WHERE Id = @p1 AND RowVersion = @p2;      -- 0 rows affected ⇒ someone else changed it
```

Trace through what that `WHERE` clause actually buys you: if Bob's update runs after Alice's already committed, the row's `RowVersion` has already moved past what Bob loaded, so his `UPDATE` matches **zero rows** — not because the `Id` is wrong, but because the version he's asserting against no longer exists. EF Core throws **`DbUpdateConcurrencyException`** on exactly that outcome:

```csharp
try
{
    await db.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException ex)
{
    var entry = ex.Entries.Single();
    var dbValues = await entry.GetDatabaseValuesAsync(ct);
    if (dbValues is null) return Results.NotFound();                 // deleted meanwhile

    // Options: (1) tell the client → 409/412 with current state; (2) client-wins: entry.OriginalValues.SetValues(dbValues) and retry;
    // (3) store-wins: entry.Reload(); (4) merge field by field
    return Results.Conflict(new ProblemDetails { Title = "Order was modified by someone else. Reload and try again." });
}
```

In APIs, expose this same version as an **ETag** and require `If-Match` on updates — the exact mechanism covered end-to-end in [API design](ch:api-design#optimistic-concurrency-with-etags), where the HTTP layer and this database mechanism turn out to be the same idea wearing two different outfits.

:::tip Concurrency tokens for business invariants
Optimistic concurrency isn't only about preventing overwritten edits — it also protects business invariants directly. Two requests both racing to reserve the last unit of stock will **conflict on the product's own version column**, so one of them loses the race, retries, and correctly sees zero stock left rather than both succeeding and overselling. It's a genuinely lighter-weight alternative to taking a pessimistic row lock for that same guarantee.
:::

## Transactions: when SaveChanges's own transaction isn't enough {i}

`SaveChanges` is **already transactional** on its own — every change made in one call commits or rolls back together, with no extra code needed. You need an *explicit* transaction specifically when that single-call guarantee isn't wide enough, which happens when:

- several `SaveChanges` calls must be atomic together,
- you mix EF changes with raw SQL / `ExecuteUpdate`,
- you share a transaction with Dapper/ADO.NET on the same connection,
- you need a specific isolation level.

```csharp
await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
try
{
    db.Orders.Add(order);
    await db.SaveChangesAsync(ct);                                          // order gets its Id

    await db.Products.Where(p => p.Id == order.ProductId)
        .ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock - order.Qty), ct);

    await db.Database.GetDbConnection().ExecuteAsync(                      // Dapper on the same connection + transaction
        "INSERT INTO AuditLog (Action, EntityId) VALUES ('OrderPlaced', @id)", new { id = order.Id }, tx.GetDbTransaction());

    await tx.CommitAsync(ct);
}
catch { await tx.RollbackAsync(ct); throw; }
```

**Savepoints:** `await tx.CreateSavepointAsync("before-lines")` and `RollbackToSavepointAsync` for partial rollback (EF also uses savepoints automatically when you call SaveChanges inside a user transaction).

### Execution strategies (connection resiliency)

`UseSqlServer(cs, o => o.EnableRetryOnFailure())` retries **transient** failures automatically — Azure SQL failovers, throttling, deadlock victims from exactly the deadlock-detection mechanism [Relational fundamentals](ch:relational-fundamentals#locking-blocking-and-deadlocks) described. There's a catch: a retry has to redo the *whole* unit of work, not just the failed statement. So if you open a transaction manually, wrap it in an execution strategy too — otherwise a retry won't cover the `BEGIN TRANSACTION` itself:

```csharp
var strategy = db.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    // ... all the work ...
    await db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
});
```

:::gotcha No distributed transactions across services
A transaction, no matter how it's opened, covers **one database connection**. You genuinely cannot wrap "save the order in SQL + publish to Service Bus + call the payment API" in a single atomic transaction — those are three entirely separate systems with no shared commit protocol. The real answer for cross-service consistency is the **outbox pattern** (covered later in this chapter, and in full in [Messaging & events](ch:messaging-events)) and sagas, not a bigger transaction.
:::

## Set-based updates and deletes: skipping the entity entirely {i}

EF 7+ offers a second way to write to the database that deliberately skips the tracking machinery altogether, running a set-based SQL statement **without loading any entities into memory first**:

```csharp
// UPDATE Products SET Price = Price * 1.1 WHERE CategoryId = 3
var updated = await db.Products.Where(p => p.CategoryId == 3)
    .ExecuteUpdateAsync(s => s
        .SetProperty(p => p.Price, p => p.Price * 1.1m)
        .SetProperty(p => p.UpdatedAt, DateTime.UtcNow), ct);

// DELETE FROM Carts WHERE UpdatedAt < @cutoff
var deleted = await db.Carts.Where(c => c.UpdatedAt < cutoff).ExecuteDeleteAsync(ct);
```

Three consequences follow directly from "no entities loaded," and each is worth knowing before you reach for this:

- They run **immediately** — not deferred until the next `SaveChanges()`.
- They **bypass the change tracker**: any already-tracked entity for the same rows stays stale in memory.
- They **bypass SaveChanges interceptors**: auditing or soft-delete logic registered there simply won't run.

Global query filters still apply to the generated `WHERE` clause, though, since those are baked into query translation rather than into `SaveChanges`.

## Interceptors: cross-cutting behaviour without touching business code {a}

Interceptors hook into specific points in EF Core's own pipeline, letting you add behaviour that applies uniformly without scattering calls throughout your business logic:

| Interceptor | Hooks | Uses |
|---|---|---|
| `SaveChangesInterceptor` | Before/after SaveChanges | Audit fields, soft delete, domain events, outbox |
| `DbCommandInterceptor` | Before/after SQL commands | Query hints, logging slow SQL, tagging, modifying SQL |
| `DbConnectionInterceptor` | Connection open/close | Setting session context (e.g. `SESSION_CONTEXT` for row-level security), access tokens |
| `DbTransactionInterceptor` | Transaction events | Diagnostics |
| `IMaterializationInterceptor` | Entity materialised | Injecting services into entities, decryption |

```csharp
public interface IAuditable { DateTimeOffset CreatedAt { get; set; } string? CreatedBy { get; set; } DateTimeOffset? UpdatedAt { get; set; } string? UpdatedBy { get; set; } }

public sealed class AuditInterceptor(TimeProvider clock, ICurrentUser user) : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> result, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        foreach (var entry in e.Context!.ChangeTracker.Entries<IAuditable>())
        {
            if (entry.State == EntityState.Added) { entry.Entity.CreatedAt = now; entry.Entity.CreatedBy = user.Id; }
            if (entry.State == EntityState.Modified) { entry.Entity.UpdatedAt = now; entry.Entity.UpdatedBy = user.Id; }
        }
        return base.SavingChangesAsync(e, result, ct);
    }
}

builder.Services.AddScoped<AuditInterceptor>();
builder.Services.AddDbContext<ShopDb>((sp, o) => o.UseSqlServer(cs).AddInterceptors(sp.GetRequiredService<AuditInterceptor>()));
```

This interceptor is never called explicitly anywhere. Every `IAuditable` entity gets its timestamps stamped automatically just by sitting in the change tracker when `SaveChanges` runs — that's the appeal: uniform behavior, with nothing for a developer to remember to call.

## Global query filters: soft delete and multi-tenancy {a}

A filter defined once in the model gets automatically appended to **every** query against that entity type, with no need to repeat it anywhere it's queried:

```csharp
public sealed class ShopDb(DbContextOptions<ShopDb> o, ITenantContext tenant) : DbContext(o)
{
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>().HasQueryFilter(p => !p.IsDeleted);                       // soft delete
        b.Entity<Order>().HasQueryFilter(o => o.TenantId == tenant.TenantId);         // multi-tenancy: evaluated per context instance
    }
}

var all = await db.Products.ToListAsync();                         // WHERE IsDeleted = 0 (automatically)
var incl = await db.Products.IgnoreQueryFilters().ToListAsync();   // admin views, restore screens
```

The multi-tenancy line deserves a second look: because the filter closes over `tenant.TenantId` from a *scoped* `ITenantContext`, it's evaluated fresh for each `DbContext` instance — meaning the same model configuration automatically scopes every single query to whichever tenant the current request belongs to, with no developer anywhere having to remember to add `WHERE TenantId = ...` by hand.

Soft delete itself usually pairs this filter with an interceptor that intercepts the *delete* and turns it into an update instead:

```csharp
public sealed class SoftDeleteInterceptor : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> r, CancellationToken ct = default)
    {
        foreach (var entry in e.Context!.ChangeTracker.Entries<ISoftDeletable>().Where(x => x.State == EntityState.Deleted))
        {
            entry.State = EntityState.Modified;
            entry.Entity.IsDeleted = true;
            entry.Entity.DeletedAt = DateTimeOffset.UtcNow;
        }
        return base.SavingChangesAsync(e, r, ct);
    }
}
```

:::gotcha Filters and required navigations
Here's a subtle interaction worth watching for: if `Order` has a *required* navigation to a soft-deleted `Customer`, `Include(o => o.Customer)` generates an **INNER JOIN**, and the customer's own soft-delete filter applies to that join too — which can make the **order itself silently disappear** from results, even though nobody asked to filter orders at all. The fix is to configure the navigation as optional, or apply filters consistently across every entity in a relationship chain so this mismatch can't arise. EF 10 adds **named filters**, letting you disable one specific filter selectively rather than all-or-nothing. For multi-tenancy specifically, also consider database-level **row-level security** as a second line of defence — the application-level filter is one safeguard, not the only one.
:::

## Domain events and the outbox on SaveChanges {a}

Aggregates raise **domain events** ([DDD](ch:ddd)) as things happen inside them; the question this section answers is how those events reliably get out of the aggregate and into something that can actually publish them:

```csharp
public abstract class Entity
{
    private readonly List<IDomainEvent> _events = [];
    public IReadOnlyList<IDomainEvent> DomainEvents => _events;
    protected void Raise(IDomainEvent e) => _events.Add(e);
    public void ClearDomainEvents() => _events.Clear();
}

// Outbox interceptor: turn domain events into outbox rows IN THE SAME TRANSACTION as the business data
public sealed class OutboxInterceptor(TimeProvider clock) : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> r, CancellationToken ct = default)
    {
        var ctx = e.Context!;
        var events = ctx.ChangeTracker.Entries<Entity>().SelectMany(x => { var list = x.Entity.DomainEvents.ToList(); x.Entity.ClearDomainEvents(); return list; }).ToList();
        ctx.Set<OutboxMessage>().AddRange(events.Select(ev => new OutboxMessage
        {
            Id = Guid.NewGuid(), Type = ev.GetType().FullName!, Payload = JsonSerializer.Serialize(ev, ev.GetType()), OccurredAt = clock.GetUtcNow()
        }));
        return base.SavingChangesAsync(e, r, ct);
    }
}
// A background worker then publishes unprocessed OutboxMessages to the broker (see Messaging & events).
```

This shape matters because the outbox rows are written inside the *same* `SaveChanges()` transaction as the business data: the order and its "order placed" event either both commit or both roll back. There's no window where one happens without the other — which sidesteps the "no distributed transaction" problem from earlier in this chapter entirely, rather than solving it. MassTransit, NServiceBus and Wolverine ship **ready-made EF Core outboxes**, so this pattern rarely needs to be hand-rolled in practice.

## Other advanced features {a}

| Feature | What it gives you |
|---|---|
| **Temporal tables** (SQL Server) | `b.ToTable(t => t.IsTemporal())`; query history with `TemporalAsOf(date)` |
| **JSON columns** | Nested objects/collections in one column, queryable (`ToJson()`) |
| **Primitive collections** | `List<string> Tags` stored as JSON, queryable with `Contains` |
| **Raw SQL for unmapped types** | `Database.SqlQuery<T>` |
| **Keyless entity types** | Map views/functions (`HasNoKey().ToView("v_Sales")`) |
| **User-defined function mapping** | Call SQL functions from LINQ (`HasDbFunction`) |
| **Sequences, HiLo** | Key generation strategies that reduce round trips |
| **Multiple DbContexts** | One per bounded context or module (modular monolith), each with its own migrations/schema |
| **Vector search** (EF 10 / SQL Server 2025 / Azure SQL) | `SqlVector<float>` with `VECTOR_DISTANCE` for AI similarity search |
| **Read replicas** | A second context/connection string pointing at a read-only replica for queries |

## Testing EF Core code {i}

| Approach | Fidelity | Speed | Verdict |
|---|---|---|---|
| EF **InMemory** provider | Low: no SQL, no constraints, no transactions, different query semantics | Fast | **Avoid** (Microsoft discourages it for testing) |
| **SQLite in-memory** | Medium: real SQL, but a different dialect than SQL Server/Postgres | Fast | OK for simple cases |
| **Real database in a container** (Testcontainers) | **High** | Seconds per suite | **Recommended** for repositories/queries |
| Repository interface mocked | N/A (doesn't test EF at all) | Fast | For unit-testing *application* logic only |

Take that low InMemory rating seriously: it isn't a relational database at all, so it can't enforce constraints, doesn't support real transactions, and translates some LINQ differently than any real provider does (Microsoft's own docs say as much — see Further reading). A test can pass against InMemory while the same query fails, or behaves differently, against the real SQL Server it runs on in production. See [Integration testing](ch:integration-testing) for Testcontainers and Respawn, which close that gap by testing against the real engine.

:::qa How does optimistic concurrency work in EF Core?
Mark a concurrency token (a SQL Server rowversion with [Timestamp]/IsRowVersion, or a property with IsConcurrencyToken). EF includes the original value in the UPDATE/DELETE WHERE clause; if no row is affected, it throws DbUpdateConcurrencyException, which you handle by reloading, merging, retrying or returning 409/412 to the client.
:::

:::qa Optimistic vs pessimistic concurrency?
Optimistic: no locks on read; conflicts are detected at write time via versions. It scales well and suits web apps where conflicts are rare. Pessimistic: lock rows when reading (UPDLOCK / FOR UPDATE) so others wait. It suits high-contention critical sections but reduces concurrency and risks deadlocks.
:::

:::qa Is SaveChanges transactional? When do you need an explicit transaction?
Yes: one SaveChanges is a single transaction. Use BeginTransaction when multiple SaveChanges, ExecuteUpdate/raw SQL or Dapper calls must be atomic, or you need a specific isolation level. With retrying execution strategies, wrap the whole transaction in strategy.ExecuteAsync.
:::

:::qa What are ExecuteUpdate and ExecuteDelete, and what are their caveats?
EF 7+ methods that run set-based UPDATE/DELETE statements directly from a LINQ filter without loading entities, which is much faster for bulk changes. They execute immediately, bypass the change tracker and SaveChanges interceptors (so auditing and soft delete there won't run), and tracked entities in memory aren't updated.
:::

:::qa How would you implement soft delete in EF Core?
An IsDeleted (and DeletedAt) column, a global query filter `HasQueryFilter(e => !e.IsDeleted)` so normal queries exclude deleted rows, and a SaveChanges interceptor that converts Deleted states into Modified with IsDeleted = true. Use IgnoreQueryFilters for admin or restore scenarios, and consider filtered unique indexes.
:::

:::qa How would you implement multi-tenancy with EF Core?
Options: a TenantId column with a global query filter based on a scoped tenant service (plus row-level security as defence in depth); a schema per tenant; or a database per tenant with the connection string chosen per request. Each trades isolation against cost and operational complexity.
:::

:::qa What are EF Core interceptors used for?
Cross-cutting hooks into EF operations: SaveChanges interceptors for auditing, soft delete, domain events and outbox; command interceptors for logging, hints or tagging SQL; connection interceptors for session context or tokens; materialization interceptors for post-processing entities.
:::

:::qa Why not use the InMemory provider for tests?
It isn't a relational database: it doesn't enforce constraints, transactions or SQL semantics, and it translates queries differently, so tests can pass while real queries fail. Use the real engine via Testcontainers (or at least SQLite) for data access tests.
:::

## Further reading

- [Handling concurrency conflicts](https://learn.microsoft.com/en-us/ef/core/saving/concurrency)
- [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- [ExecuteUpdate and ExecuteDelete](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete)
- [Interceptors](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors)
- [Global query filters](https://learn.microsoft.com/en-us/ef/core/querying/filters)
- [Choosing a testing strategy](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy)

## Verify this chapter

The checks below exercise optimistic concurrency, `ExecuteUpdate`, global query filters and a `SaveChangesInterceptor` against a real (if tiny) SQLite database. Save as a console app (`dotnet new console`, `dotnet add package Microsoft.EntityFrameworkCore.Sqlite`), then `dotnet run`.

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

var connString = "DataSource=file:verifydb2?mode=memory&cache=shared";
await using var conn = new Microsoft.Data.Sqlite.SqliteConnection(connString);
await conn.OpenAsync();
var opts = new DbContextOptionsBuilder<ShopDb>().UseSqlite(conn).Options;

await using (var seed = new ShopDb(opts))
{
    await seed.Database.EnsureCreatedAsync();
    seed.Products.Add(new Product { Id = 1, Name = "Widget", Price = 10, Version = 1, IsDeleted = false });
    seed.Products.Add(new Product { Id = 2, Name = "Gizmo", Price = 5, Version = 1, IsDeleted = true });
    await seed.SaveChangesAsync();
}

// Claim: optimistic concurrency — a stale version throws DbUpdateConcurrencyException.
{
    await using var ctx1 = new ShopDb(opts);
    var p1 = await ctx1.Products.IgnoreQueryFilters().SingleAsync(p => p.Id == 1); // Version = 1

    await using (var ctx2 = new ShopDb(opts))
    {
        var p2 = await ctx2.Products.IgnoreQueryFilters().SingleAsync(p => p.Id == 1);
        p2.Price = 20;
        p2.Version++; // app increments the token manually, as the chapter describes for non-SQL-Server providers
        await ctx2.SaveChangesAsync(); // succeeds: DB Version was 1, matches p2's original value
    }

    p1.Name = "Gadget";
    p1.Version++; // p1 still thinks the current version is 1, but the DB is now at 2
    var threw = false;
    try { await ctx1.SaveChangesAsync(); }
    catch (DbUpdateConcurrencyException) { threw = true; }
    if (!threw) throw new Exception("FAIL: expected DbUpdateConcurrencyException");
    Console.WriteLine("OK: a stale concurrency token throws DbUpdateConcurrencyException");
}

// Claim: ExecuteUpdate bypasses the change tracker — an already-tracked entity is not refreshed.
{
    await using var ctx = new ShopDb(opts);
    var tracked = await ctx.Products.IgnoreQueryFilters().SingleAsync(p => p.Id == 1); // Price = 20 after the test above

    await ctx.Products.IgnoreQueryFilters().Where(p => p.Id == 1)
        .ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, 999m));

    if (tracked.Price == 999m) throw new Exception("FAIL: ExecuteUpdate updated the tracked instance");
    Console.WriteLine("OK: ExecuteUpdate leaves an already-tracked in-memory entity stale");

    await using var fresh = new ShopDb(opts);
    var reread = await fresh.Products.IgnoreQueryFilters().SingleAsync(p => p.Id == 1);
    if (reread.Price != 999m) throw new Exception("FAIL: the database wasn't actually updated");
    Console.WriteLine("OK: ExecuteUpdate did write the new value to the database");
}

// Claim: a global query filter (soft delete) excludes rows by default, and IgnoreQueryFilters() includes them.
{
    await using var ctx = new ShopDb(opts);
    var visible = await ctx.Products.ToListAsync();
    if (visible.Any(p => p.Id == 2)) throw new Exception("FAIL: soft-deleted row leaked through the default filter");
    Console.WriteLine("OK: a global query filter hides soft-deleted rows by default");

    var all = await ctx.Products.IgnoreQueryFilters().ToListAsync();
    if (!all.Any(p => p.Id == 2)) throw new Exception("FAIL: IgnoreQueryFilters() didn't bring the row back");
    Console.WriteLine("OK: IgnoreQueryFilters() brings soft-deleted rows back");
}

// Claim: a SaveChangesInterceptor runs for every SaveChanges, without being called explicitly anywhere.
{
    var auditOpts = new DbContextOptionsBuilder<AuditedShopDb>()
        .UseSqlite(conn)
        .AddInterceptors(new StampingInterceptor())
        .Options;

    await using var ctx = new AuditedShopDb(auditOpts);
    var p = await ctx.Products.IgnoreQueryFilters().SingleAsync(p => p.Id == 1);
    p.Name = "Stamped";
    await ctx.SaveChangesAsync();
    if (p.UpdatedBy != "interceptor") throw new Exception("FAIL: interceptor did not stamp the entity");
    Console.WriteLine("OK: the SaveChangesInterceptor stamped the entity without being called explicitly");
}

Console.WriteLine("All checks passed.");

// Not runtime-verifiable here (needs SQL Server/Postgres-specific features or real infra failures):
// - rowversion columns auto-incremented by the database itself (SQL Server/Postgres xmin) — see Further reading: "Handling concurrency conflicts"
// - execution-strategy retries against real transient Azure SQL failures — see Further reading: "Transactions"
// - temporal tables, JSON columns, vector search — SQL Server/Azure SQL-specific; see the EF Core docs linked in Further reading

class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public int Version { get; set; }
    public bool IsDeleted { get; set; }
    public string? UpdatedBy { get; set; }
}

class ShopDb(DbContextOptions<ShopDb> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>().Property(p => p.Version).IsConcurrencyToken();
        b.Entity<Product>().HasQueryFilter(p => !p.IsDeleted);
    }
}

class AuditedShopDb(DbContextOptions<AuditedShopDb> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>().Property(p => p.Version).IsConcurrencyToken();
        b.Entity<Product>().HasQueryFilter(p => !p.IsDeleted);
    }
}

class StampingInterceptor : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
    {
        foreach (var entry in eventData.Context!.ChangeTracker.Entries<Product>().Where(e => e.State == EntityState.Modified))
            entry.Entity.UpdatedBy = "interceptor";
        return base.SavingChangesAsync(eventData, result, ct);
    }
}
```
