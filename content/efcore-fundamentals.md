---
id: efcore-fundamentals
title: EF Core Fundamentals: DbContext, Modelling, Relationships and Migrations
summary: Microsoft's ORM from the ground up. What an ORM does, DbContext and DbSet, registering and lifetimes, entities and conventions, the Fluent API, keys and value generation, relationships (one-to-many, one-to-one, many-to-many), owned and complex types, value conversions, change tracking and SaveChanges, and migrations from dev to production.
layer: data
where: Data & state › Relational databases › EF Core (ORM)
fits: EF Core is a **layer-3 framework** whose job is **layer 5** (data). It sits on ADO.NET ([ADO.NET & Dapper](ch:ado-dapper)), translates LINQ ([LINQ](ch:linq)) into SQL ([Relational fundamentals](ch:relational-fundamentals)), and is registered in DI as scoped ([Dependency injection](ch:dependency-injection)). In Clean Architecture it lives in the Infrastructure layer ([App architectures](ch:app-architectures)).
levels: b,i,a
prereqs: relational-fundamentals, linq, dependency-injection
next: efcore-querying, efcore-advanced, ddd
---

## TL;DR

- EF Core does four jobs: map classes↔tables, translate LINQ↔SQL, track what changed, and turn `SaveChanges()` into INSERT/UPDATE/DELETE statements.
- `DbContext` = one unit of work, scoped to one request/job — never a singleton, never shared across threads.
- EF infers a lot from naming conventions (`Id`, nullability, navigation properties); Fluent API (`IEntityTypeConfiguration<T>`) overrides conventions and keeps persistence detail out of the domain classes.
- Change tracking works by snapshotting each entity's values when loaded, then diffing against that snapshot — which is why read-only queries should use `AsNoTracking()` to skip the diffing entirely.
- Migrations are a versioned diff of your model over time; in production, generate a SQL script/bundle rather than calling `MigrateAsync()` at startup across multiple replicas (they'd race).

## What an ORM is actually for {b}

Think back to [ADO.NET & Dapper](ch:ado-dapper#the-layer-every-other-data-access-tool-is-secretly-built-on): raw ADO.NET gives you a connection, a command, and a reader that hands back columns one at a time, by index or name. Every entity you want to work with needs its own hand-written SQL, its own mapping code from columns to properties, and its own tracking of what changed since you loaded it. An **Object-Relational Mapper** exists to take that repetitive, error-prone work off your hands. **Entity Framework Core** does four specific jobs:

1. **Mapping:** classes ↔ tables, properties ↔ columns, references ↔ foreign keys.
2. **Querying:** LINQ ↔ SQL, then results → objects ("materialisation").
3. **Change tracking:** remembers loaded entities and detects what changed.
4. **Persistence:** `SaveChanges()` generates INSERT/UPDATE/DELETE in one transaction.

Plus **migrations**, covered later in this chapter, to evolve the database schema in step with your model as it changes over time.

:::why Why use an ORM
Without one, every entity needs hand-written SQL for each operation plus manual mapping code, relationships and transactions and change detection are all your problem, and schema changes are manual scripts. EF Core removes most of that boilerplate, gives type-safe queries checked by the compiler, and keeps the schema versioned with the code. The cost is a learning curve — tracking, loading, translation rules — and the risk of generating bad SQL if you don't understand what it's doing, which the next chapter covers.
:::

## DbContext and DbSet: your session with the database {b}

The **`DbContext`** is the object that holds everything an ORM needs to do its four jobs: a database connection, the **model** (metadata describing how classes map to tables), and the **change tracker**. Each **`DbSet<T>`** is your entry point to one table — something you can query and add new entities to.

```csharp
public sealed class ShopDb(DbContextOptions<ShopDb> options) : DbContext(options)
{
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Product> Products => Set<Product>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ShopDb).Assembly);   // picks up IEntityTypeConfiguration<T> classes
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        b.Properties<decimal>().HavePrecision(18, 2);                              // global convention
        b.Properties<string>().HaveMaxLength(256);
    }
}

builder.Services.AddDbContext<ShopDb>(o => o
    .UseSqlServer(builder.Configuration.GetConnectionString("Shop"), sql => sql.EnableRetryOnFailure())
    .UseQueryTrackingBehavior(QueryTrackingBehavior.TrackAll));
```

| Registration | Lifetime | Use |
|---|---|---|
| `AddDbContext<T>` | **Scoped** (one per request) | Normal web requests |
| `AddDbContextPool<T>` | Scoped, but instances reused from a pool (state reset) | High-throughput APIs: avoids setup cost |
| `AddDbContextFactory<T>` / `AddPooledDbContextFactory<T>` | Factory is singleton; you create contexts | Background services, Blazor Server, parallel work |

:::gotcha DbContext is not thread-safe and should be short-lived
Hold onto this mental model: one context = one unit of work = one request (or one message, or one job) — never longer. Never share a single context across threads (no `Task.WhenAll` on operations sharing the same context), never make one a singleton, and don't keep one alive for minutes at a time, because its change tracker only ever grows while entities stay attached to it, and a long-lived context slowly accumulates tracked entities nobody's using anymore.
:::

## Entities and conventions: what EF Core infers without being told {b}

EF Core infers a surprising amount of the model purely by **convention** — shape and naming tell it what it needs to know, without a single attribute or Fluent API call:

| Convention | Result |
|---|---|
| Property named `Id` or `<Type>Id` | Primary key; `int`/`long` → identity column, `Guid` → sequential GUID generated client-side |
| Non-nullable reference types (`string`) / value types | `NOT NULL` columns; `string?` / `int?` → nullable |
| Navigation property + `<Nav>Id` property | Foreign key relationship |
| `DbSet<Order> Orders` | Table name `Orders` |
| `List<OrderLine>` navigation | One-to-many |
| `string` | `nvarchar(max)` on SQL Server (configure a max length!) |
| `decimal` | `decimal(18,2)` with a warning; configure precision |
| Enum | Stored as int (configure `HasConversion<string>()` to store names) |

```csharp
public sealed class Customer
{
    public int Id { get; private set; }
    public required string Email { get; set; }
    public required string Name { get; set; }
    public List<Order> Orders { get; } = [];          // collection navigation
}

public sealed class Order
{
    public int Id { get; private set; }
    public int CustomerId { get; private set; }        // FK property
    public Customer Customer { get; private set; } = null!;  // reference navigation
    public OrderStatus Status { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public List<OrderLine> Lines { get; } = [];
    public byte[] RowVersion { get; private set; } = [];
}
```

Notice every setter above is `private`. EF Core can still set **private setters** and **backing fields**, and construct entities through **constructors with parameters**, specifically so entity classes can protect their own invariants instead of exposing every property as a freely settable public field — important groundwork for [DDD](ch:ddd), where an entity is supposed to enforce its own business rules rather than trusting every caller to.

## Configuration: attributes vs Fluent API {i}

```text
Which to reach for first:   simple, obvious constraint  ──▶  data annotation
                             relationship, conversion,   ──▶  Fluent API (IEntityTypeConfiguration<T>)
                             keeping the domain clean
```

| | Data annotations | Fluent API |
|---|---|---|
| Where | Attributes on entity classes (`[Key]`, `[Required]`, `[MaxLength]`, `[Table]`, `[Column]`, `[Index]`) | `OnModelCreating` / `IEntityTypeConfiguration<T>` |
| Power | Common cases | **Everything** (keys, relationships, conversions, owned types, filters, seeding…) |
| Entity purity | Persistence concerns on domain classes | Keeps the domain model clean |
| Precedence | Lower | **Fluent API wins** |

The "entity purity" row is worth taking seriously if you're building toward a clean domain model: an attribute like `[MaxLength(256)]` on a property is a *persistence* concern — it describes a database column, not a business rule — sitting directly inside a class that's meant to represent a business concept. Fluent API configuration, kept in a separate `IEntityTypeConfiguration<T>` class, lets the entity itself stay free of that kind of noise entirely:

```csharp
public sealed class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> b)
    {
        b.ToTable("Orders", "sales");
        b.HasKey(o => o.Id);
        b.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);
        b.Property(o => o.RowVersion).IsRowVersion();                       // concurrency token
        b.HasIndex(o => new { o.CustomerId, o.CreatedAt });
        b.HasOne(o => o.Customer).WithMany(c => c.Orders).HasForeignKey(o => o.CustomerId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(o => o.Lines).WithOne().HasForeignKey("OrderId").OnDelete(DeleteBehavior.Cascade);
        b.Navigation(o => o.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);   // map a private backing field
    }
}
```

## Keys and value generation {i}

```csharp
b.HasKey(x => x.Id);                                    // single key
b.HasKey(x => new { x.OrderId, x.LineNo });             // composite key
b.HasAlternateKey(x => x.Sku);                          // unique, can be an FK target
b.Property(x => x.Id).UseIdentityColumn();              // IDENTITY (default for int)
b.Property(x => x.Id).HasDefaultValueSql("NEWSEQUENTIALID()");
b.Property(x => x.CreatedAt).HasDefaultValueSql("SYSUTCDATETIME()");
b.Property(x => x.Total).HasComputedColumnSql("[Quantity] * [UnitPrice]", stored: true);
```

**Strongly typed IDs** (`OrderId` record struct) — which make it impossible to accidentally pass a `CustomerId` where an `OrderId` was expected, since they're different types — are mapped with a value converter: `b.Property(o => o.Id).HasConversion(id => id.Value, v => new OrderId(v));`.

## Relationships {i}

### One-to-many

```csharp
modelBuilder.Entity<Order>()
    .HasOne(o => o.Customer).WithMany(c => c.Orders)
    .HasForeignKey(o => o.CustomerId)
    .IsRequired()
    .OnDelete(DeleteBehavior.Restrict);
```

### One-to-one

```csharp
modelBuilder.Entity<Customer>().HasOne(c => c.Profile).WithOne(p => p.Customer).HasForeignKey<CustomerProfile>(p => p.CustomerId);
```

### Many-to-many

```csharp
public class Product { public int Id { get; set; } public List<Category> Categories { get; } = []; }
public class Category { public int Id { get; set; } public List<Product> Products { get; } = []; }
// EF Core 5+ creates the join table ProductCategory automatically.
// To add payload columns (e.g. SortOrder), map an explicit join entity:
modelBuilder.Entity<Product>().HasMany(p => p.Categories).WithMany(c => c.Products)
    .UsingEntity<ProductCategory>(j => j.Property(pc => pc.SortOrder).HasDefaultValue(0));
```

### Delete behaviours

| `DeleteBehavior` | When the principal is deleted |
|---|---|
| `Cascade` | Dependents deleted (default for **required** relationships) |
| `Restrict` / `NoAction` | Error if dependents exist |
| `SetNull` | FK set to NULL (default for **optional** relationships) |
| `ClientCascade` / `ClientSetNull` | Done by EF for **tracked** entities only |

SQL Server rejects multiple cascade paths; set `Restrict` where needed.

## Owned types, complex types and value conversions {a}

Recall from [Type system](ch:type-system#value-types-live-on-the-stack-a-useful-lie) that value objects like `Address` or `Money` are meant to be compared by their contents, not by identity — they have no primary key of their own, and EF Core has dedicated mapping strategies specifically for that shape:

```csharp
public sealed record Address(string Street, string City, string PostalCode, string Country);
public sealed record Money(decimal Amount, string Currency);

// Owned type: columns inline in the owner's table (ShippingAddress_Street, …) or a separate table
b.OwnsOne(o => o.ShippingAddress, a => { a.Property(x => x.Country).HasMaxLength(2); });
b.OwnsMany(c => c.Addresses);                         // separate table with an FK

// Complex type (EF Core 8): true value semantics; can't be null in EF 8, nullable since EF 9/10
b.ComplexProperty(o => o.Total, m => { m.Property(x => x.Amount).HasColumnName("TotalAmount"); });

// JSON columns: store a nested object/collection as JSON in one column, still queryable
b.OwnsOne(p => p.Specs, s => s.ToJson());

// Value conversions: custom type ↔ column type
b.Property(p => p.Tags).HasConversion(
    v => string.Join(',', v),
    v => v.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList());
```

Other modelling features worth knowing exist, even without the full depth here: **inheritance mapping** (TPH: one table with a discriminator, the default and fastest; TPT: a table per type; TPC: a table per concrete type), **shadow properties** (tracked in the model but absent from the class, e.g. `UpdatedAt`), **keyless entities** for views, **table splitting**, **temporal tables**, and **primitive collections** (`List<int>` stored as JSON, EF 8).

## Change tracking and SaveChanges: how EF Core knows what to write {b}

Here's the mechanism underneath "EF Core figures out what changed": every entity a context loads or attaches gets tagged with a **state**, and that state is what decides what `SaveChanges()` eventually does with it:

| State | Meaning | On SaveChanges |
|---|---|---|
| `Added` | New, not in the DB | INSERT |
| `Unchanged` | Loaded, not modified | nothing |
| `Modified` | Loaded, some properties changed | UPDATE (only changed columns) |
| `Deleted` | Marked for removal | DELETE |
| `Detached` | Not tracked | nothing |

```csharp
// Create
var order = new Order(customerId, lines);
db.Orders.Add(order);                                   // state: Added

// Update: load, change, save. EF detects the change by comparing with a snapshot.
var product = await db.Products.FindAsync([id], ct);    // FindAsync checks the tracker first, then the DB
product!.Price = 24.99m;                                // state becomes Modified on DetectChanges

// Delete
db.Products.Remove(product);

var rows = await db.SaveChangesAsync(ct);               // ONE transaction, batched SQL; returns rows affected
```

Notice that nothing in the `product!.Price = 24.99m;` line told EF Core "this changed" — there's no explicit notification. The `:::deep` box below explains exactly how it figures that out anyway.

**Disconnected scenarios** — an API endpoint receives a DTO, and there's no entity already loaded into this context's tracker — need a different approach: load-then-update (clear, safe, costs an extra read), or attach a stub entity and mark specific properties modified directly (fewer queries, more care required, since you're asserting what changed rather than letting EF Core detect it):

```csharp
db.Products.Attach(new Product { Id = dto.Id }).Property(p => p.Price).CurrentValue = dto.Price;   // UPDATE only Price
// or set-based without tracking at all (EF 7+):
await db.Products.Where(p => p.Id == dto.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, dto.Price), ct);
```

:::deep How change detection works
When an entity is tracked, EF stores a **snapshot** of its original property values the moment it's loaded. `DetectChanges()` — called automatically by `SaveChanges`, `Entries()` and others — walks every tracked entity and compares its *current* values against that stored snapshot, property by property. That comparison work is exactly why tracking thousands of entities is costly: every `SaveChanges()` call has to diff all of them, whether or not they actually changed, which is why read-only queries should use `AsNoTracking()` or projections to skip the snapshot and diffing entirely. `db.ChangeTracker.DebugView.LongView` shows exactly what's tracked, useful the first time this mechanism's cost surprises you in a profiler.
:::

## Migrations: evolving the schema in step with the model {b}

**Migrations** turn a change in your C# model into a versioned, reviewable change to the actual database schema — the bridge between "I added a property" and "there's now a column for it."

```bash
dotnet tool install --global dotnet-ef
dotnet ef migrations add AddOrderStatus -p src/Shop.Infrastructure -s src/Shop.Api   # -p: project with DbContext, -s: startup project
dotnet ef database update                                                              # apply to the dev database
dotnet ef migrations remove                                                            # undo the last unapplied migration
dotnet ef migrations script --idempotent -o deploy.sql                                 # SQL script for production
dotnet ef migrations bundle -o efbundle --self-contained                               # executable that applies migrations
```

Each migration carries `Up()` and `Down()` methods plus an updated **model snapshot** — EF Core's own record of what the model looked like at that point, which is what lets the *next* migration be computed as a diff against it. The database itself records which migrations have already been applied in a table called `__EFMigrationsHistory`, so running `database update` twice in a row is safe — it simply applies nothing the second time.

```csharp
public partial class AddOrderStatus : Migration
{
    protected override void Up(MigrationBuilder m)
    {
        m.AddColumn<string>(name: "Status", table: "Orders", maxLength: 20, nullable: false, defaultValue: "Placed");
        m.Sql("UPDATE Orders SET Status = 'Shipped' WHERE ShippedAt IS NOT NULL");    // data migration (edit by hand when needed)
    }
    protected override void Down(MigrationBuilder m) => m.DropColumn(name: "Status", table: "Orders");
}
```

### Applying migrations in production

| Approach | Notes |
|---|---|
| **Idempotent SQL script** in the CD pipeline | Reviewable by DBAs; most controlled |
| **Migration bundle** executed by the pipeline | Self-contained, no SDK needed |
| `Database.MigrateAsync()` at app startup | Simple, but **races with multiple instances**, needs DDL permissions for the app identity, and slows startup. OK for dev and demos |

That third row's warning is worth tracing through concretely: with three replicas starting up simultaneously, all three could attempt `MigrateAsync()` at roughly the same moment, racing to apply the same migration — not a safe pattern for anything beyond a single-instance dev setup. The deeper discipline for zero-downtime deploys is writing **backward-compatible** migrations, since old and new code genuinely run side by side during a rolling deployment: add nullable columns first, backfill them, and only make a column required in a later release once every instance is running the new code; never rename a column in one step — add the new one, copy the data across, switch the code over, then drop the old one in a later release entirely. This sequencing is known as the **expand/contract** pattern.

### Code-first vs database-first

- **Code-first** (above): the model is the source of truth.
- **Database-first / reverse engineering**: `dotnet ef dbcontext scaffold "<cs>" Microsoft.EntityFrameworkCore.SqlServer -o Models` generates entities from an existing schema. Common with legacy databases or DBA-owned schemas.

## Seeding data {i}

```csharp
// Model seed data (part of migrations): good for static reference data
modelBuilder.Entity<Country>().HasData(new Country { Code = "DE", Name = "Germany" }, new Country { Code = "FR", Name = "France" });

// EF 9+: UseSeeding / UseAsyncSeeding: runs on EnsureCreated / Migrate; good for dev/test data
optionsBuilder.UseAsyncSeeding(async (ctx, _, ct) =>
{
    if (!await ctx.Set<Product>().AnyAsync(ct)) { ctx.Set<Product>().Add(new Product { Name = "Keyboard", Price = 49m }); await ctx.SaveChangesAsync(ct); }
});
```

## Providers {a}

| Database | Provider package |
|---|---|
| SQL Server / Azure SQL | `Microsoft.EntityFrameworkCore.SqlServer` |
| PostgreSQL | `Npgsql.EntityFrameworkCore.PostgreSQL` |
| SQLite | `Microsoft.EntityFrameworkCore.Sqlite` |
| MySQL / MariaDB | `Pomelo.EntityFrameworkCore.MySql` |
| Cosmos DB | `Microsoft.EntityFrameworkCore.Cosmos` (document DB; very different query capabilities) |
| Oracle | `Oracle.EntityFrameworkCore` |
| In-memory | `Microsoft.EntityFrameworkCore.InMemory`: **testing only, and not recommended**; see [Integration testing](ch:integration-testing) |

:::qa What is DbContext and what lifetime should it have?
The EF Core session with the database: it owns the connection, the model and the change tracker, and implements the Unit of Work and Repository patterns. Register it as scoped (one per request or unit of work). It's not thread-safe and shouldn't be long-lived; use IDbContextFactory for background or parallel work.
:::

:::qa What's the difference between AddDbContext and AddDbContextPool?
Both give scoped contexts. Pooling reuses DbContext instances from a pool (resetting their state) instead of constructing new ones, reducing allocation and setup cost in high-throughput apps. The context then must not hold custom per-request state in fields.
:::

:::qa Data annotations or Fluent API?
Fluent API (often in IEntityTypeConfiguration&lt;T&gt; classes) is more powerful, keeps persistence concerns out of the domain model, and takes precedence. Annotations are convenient for simple cases. Many teams use Fluent API exclusively.
:::

:::qa Explain EF Core's entity states.
Added (INSERT on save), Unchanged (no action), Modified (UPDATE of changed columns), Deleted (DELETE) and Detached (not tracked). EF detects modifications by comparing current values with snapshots taken when entities were loaded or attached.
:::

:::qa How do migrations work and how do you apply them in production?
`dotnet ef migrations add` generates a migration class (Up/Down) from the difference between the model and the last snapshot; applied migrations are recorded in __EFMigrationsHistory. In production, generate an idempotent SQL script or a migration bundle and run it in the deployment pipeline rather than calling Migrate() at startup across many instances. Keep migrations backward-compatible for zero-downtime deploys.
:::

:::qa What are owned types and when do you use them?
Types without their own identity that belong to an owner entity (value objects like Address or Money). They're stored inline as columns in the owner's table (OwnsOne), in a separate table (OwnsMany), or as JSON (ToJson). EF 8 complex types are an alternative with value semantics.
:::

:::qa How do you configure a many-to-many relationship?
Add collection navigations on both sides; EF Core 5+ creates the join table automatically. Use UsingEntity with an explicit join entity when you need extra columns on the relationship.
:::

:::qa What does SaveChanges do?
Runs DetectChanges, orders the pending INSERT/UPDATE/DELETE commands to respect FKs, batches them, executes them in a single transaction (unless one is already active), propagates generated keys, and resets entity states to Unchanged. It throws DbUpdateException or DbUpdateConcurrencyException on failure.
:::

## Further reading

- [EF Core overview](https://learn.microsoft.com/en-us/ef/core/)
- [Creating and configuring a model](https://learn.microsoft.com/en-us/ef/core/modeling/)
- [Relationships](https://learn.microsoft.com/en-us/ef/core/modeling/relationships)
- [Migrations overview](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/)
- Book: *Entity Framework Core in Action* (2nd ed.) by Jon P Smith.

## Verify this chapter

Run with `dotnet run` in a project that references `Microsoft.EntityFrameworkCore.Sqlite` (the EF Core in-memory relational provider closest to the chapter's SQL-Server examples — `dotnet add package Microsoft.EntityFrameworkCore.Sqlite`). It checks entity states and `SaveChanges`, change detection via snapshot comparison, `AsNoTracking` actually skipping tracking, and `OnDelete(DeleteBehavior.Cascade)` actually cascading.

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

var options = new DbContextOptionsBuilder<ShopDb>().UseSqlite("DataSource=:memory:").Options;
using var db = new ShopDb(options);
await db.Database.OpenConnectionAsync(); // keep the in-memory SQLite connection alive for the whole run
await db.Database.EnsureCreatedAsync();

// --- Added entity, then SaveChanges turns it into Unchanged (an INSERT happened) ---
var customer = new Customer { Email = "a@b.com" };
db.Customers.Add(customer);
if (db.Entry(customer).State != EntityState.Added) throw new Exception("FAIL: a newly Added entity should be State.Added before saving");
await db.SaveChangesAsync();
if (db.Entry(customer).State != EntityState.Unchanged) throw new Exception("FAIL: after SaveChanges, a saved entity should be Unchanged");
if (customer.Id == 0) throw new Exception("FAIL: the generated identity key should have been populated after insert");
Console.WriteLine($"OK: Add -> SaveChanges moved the entity Added -> Unchanged and generated Id={customer.Id}");

// --- Change detection: mutating a tracked property flips state to Modified, by comparison with a snapshot ---
customer.Email = "changed@b.com";
var entry = db.Entry(customer);
if (entry.State != EntityState.Modified) throw new Exception("FAIL: mutating a tracked property should flip state to Modified");
Console.WriteLine("OK: changing a property on a tracked entity was detected as Modified (snapshot comparison)");
await db.SaveChangesAsync();

// --- AsNoTracking really doesn't track: the returned entity isn't in the change tracker ---
var untracked = await db.Customers.AsNoTracking().FirstAsync(c => c.Id == customer.Id);
var isTracked = db.ChangeTracker.Entries<Customer>().Any(e => ReferenceEquals(e.Entity, untracked));
if (isTracked) throw new Exception("FAIL: AsNoTracking() should not add the entity to the change tracker");
Console.WriteLine("OK: AsNoTracking() returned an entity that the change tracker has no entry for");

// --- Cascade delete: deleting the parent removes dependent rows (OnDelete(Cascade)) ---
var order = new Order { CustomerId = customer.Id };
order.Lines.Add(new OrderLine { Sku = "KB-01" });
db.Orders.Add(order);
await db.SaveChangesAsync();
db.Customers.Remove(customer);
await db.SaveChangesAsync();
var remainingLines = await db.OrderLines.CountAsync(l => l.OrderId == order.Id);
if (remainingLines != 0) throw new Exception("FAIL: deleting the customer should have cascaded to delete its order's lines too");
Console.WriteLine("OK: deleting the parent (Customer) cascaded through Order to OrderLine, as OnDelete(Cascade) configured");

// Not runtime-verifiable here — see Further reading: EF Core overview, Migrations overview (Microsoft Learn)
// (migration tooling, production deployment strategy, and multi-provider behavior aren't single-process runtime facts)

class Customer { public int Id { get; set; } public string Email { get; set; } = ""; public List<Order> Orders { get; } = []; }
class Order { public int Id { get; set; } public int CustomerId { get; set; } public List<OrderLine> Lines { get; } = []; }
class OrderLine { public int Id { get; set; } public int OrderId { get; set; } public string Sku { get; set; } = ""; }

class ShopDb(DbContextOptions<ShopDb> options) : DbContext(options)
{
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Order>().HasOne<Customer>().WithMany(c => c.Orders).HasForeignKey(o => o.CustomerId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<OrderLine>().HasOne<Order>().WithMany(o => o.Lines).HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
    }
}
```
