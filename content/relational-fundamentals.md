---
id: relational-fundamentals
title: Relational Database Fundamentals for .NET Developers
summary: What EF Core generates and why it's fast or slow. Tables, keys and relationships, normalisation, SQL you must be able to write, joins, indexes (clustered, non-clustered, covering, composite), execution plans, transactions and ACID, isolation levels and their anomalies, locking and deadlocks, and connection pooling.
layer: data
where: Data & state › Relational databases › SQL fundamentals
fits: This is the bottom of layer 5, the actual database underneath EF Core ([EF Core fundamentals](ch:efcore-fundamentals)) and Dapper ([ADO.NET & Dapper](ch:ado-dapper)). In the cloud it's Azure SQL or PostgreSQL ([Azure data](ch:azure-data-messaging)). Most API performance problems trace back to this chapter.
levels: b,i,a
prereqs: big-picture
next: ado-dapper, efcore-fundamentals
---

## TL;DR

- Tables are linked by **keys** (primary/foreign); normalise to avoid duplicate facts, denormalise only on purpose for read speed.
- **Indexes** are what make queries fast: a B+tree that lets the engine *seek* instead of *scanning* every row. Composite index column order matters (leftmost-prefix rule).
- **Transactions** give you ACID; **isolation levels** are a menu of which race-condition anomalies (dirty read, phantom, lost update, …) you're willing to risk in exchange for less blocking.
- **Deadlocks** happen when two transactions each wait on a lock the other holds; the database kills one and your code should retry it.
- **Connection pooling** reuses expensive-to-open connections; most "pool exhausted" errors trace back to code not disposing connections/DbContexts promptly.

## The relational model {b}

A relational database stores data in **tables** (relations) of **rows** with typed **columns**. Tables are linked by **keys**:

| Concept | Meaning | Example |
|---|---|---|
| **Primary key (PK)** | Uniquely identifies a row; not null | `Orders.Id` |
| **Foreign key (FK)** | Column referencing another table's PK; enforces **referential integrity** | `Orders.CustomerId → Customers.Id` |
| **Unique constraint** | No duplicates in a column set | `Customers.Email` |
| **Check constraint** | Row-level rule | `Quantity > 0` |
| **Natural vs surrogate key** | Business value (email, ISBN) vs generated ID (`int IDENTITY`, `uniqueidentifier`) | Prefer surrogate PKs plus unique constraints on natural keys |

### Relationships

| Type | Modelled as | Example |
|---|---|---|
| One-to-many | FK on the "many" side | Customer 1 → * Orders (`Orders.CustomerId`) |
| One-to-one | FK with a unique constraint (or shared PK) | User 1 → 1 UserProfile |
| Many-to-many | **Join table** with two FKs | Products * ↔ * Categories via `ProductCategories(ProductId, CategoryId)` |

```sql
CREATE TABLE Customers (
    Id        INT IDENTITY PRIMARY KEY,
    Email     NVARCHAR(256) NOT NULL UNIQUE,
    Name      NVARCHAR(200) NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Orders (
    Id         INT IDENTITY PRIMARY KEY,
    CustomerId INT NOT NULL REFERENCES Customers(Id),
    Status     TINYINT NOT NULL,
    Total      DECIMAL(18,2) NOT NULL CHECK (Total >= 0),
    CreatedAt  DATETIME2 NOT NULL,
    RowVersion ROWVERSION                     -- optimistic concurrency token
);
```

## Normalisation (and when to break it) {i}

**Normalisation** removes redundancy so each fact is stored exactly once, which is the whole point: with one copy of a customer's name, changing it means one `UPDATE`. Without normalisation, the same fact duplicated across 500 order rows means an update anomaly waiting to happen — update 499 of them and miss one, and now the database contains a contradiction with no way to tell which copy is right.

| Form | Rule (simplified) | Violation example |
|---|---|---|
| **1NF** | Atomic values; no repeating groups | `Phones = "123, 456"` in one column |
| **2NF** | 1NF + every non-key column depends on the **whole** key | In `OrderLines(OrderId, ProductId, ProductName)`, ProductName depends only on ProductId |
| **3NF** | 2NF + no column depends on another **non-key** column | `Orders(CustomerId, CustomerCity)`: city depends on the customer, not the order |

**Denormalisation** is the deliberate, informed decision to reintroduce exactly that duplication, in exchange for read speed: storing `Order.Total` instead of recomputing a sum over its lines every time, or maintaining a dedicated read-model table for a dashboard. It's a reasonable trade specifically when reads vastly outnumber writes and you've consciously decided how to keep the duplicate in sync — often via CQRS read models, see [CQRS](ch:cqrs-mediator-result).

:::tip Snapshot data is not duplication
An order line should store the **price at the time of purchase**, even though the product has a different, current price today. That's worth being precise about: it isn't redundancy at all, because it's recording a genuinely different fact — "what the customer actually paid" — not a stale copy of "what the product costs."
:::

## SQL you must be able to write {b}

```sql
-- Filter, sort, page
SELECT Id, Name, Price
FROM Products
WHERE CategoryId = @categoryId AND Price BETWEEN @min AND @max AND Name LIKE @search + '%'
ORDER BY Price DESC, Id
OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;            -- SQL Server; Postgres: LIMIT @take OFFSET @skip

-- Aggregate with grouping and a filter on the aggregate
SELECT c.Country, COUNT(*) AS Orders, SUM(o.Total) AS Revenue
FROM Orders o
JOIN Customers c ON c.Id = o.CustomerId
WHERE o.CreatedAt >= '2026-01-01'
GROUP BY c.Country
HAVING SUM(o.Total) > 10000
ORDER BY Revenue DESC;

-- Customers with NO orders (anti-join)
SELECT c.* FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerId = c.Id);

-- Top order per customer (window function)
SELECT * FROM (
    SELECT o.*, ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY Total DESC) AS rn
    FROM Orders o
) x WHERE rn = 1;

-- Upsert
MERGE Stock AS t
USING (VALUES (@sku, @qty)) AS s(Sku, Qty) ON t.Sku = s.Sku
WHEN MATCHED THEN UPDATE SET Quantity = t.Quantity + s.Qty
WHEN NOT MATCHED THEN INSERT (Sku, Quantity) VALUES (s.Sku, s.Qty);
-- Postgres: INSERT … ON CONFLICT (Sku) DO UPDATE SET …
```

Also know: `UNION` vs `UNION ALL` (the latter skips the duplicate-removal sort), CTEs (`WITH x AS (…)`), `CASE WHEN`, `COALESCE`, `IN` vs `EXISTS`, and `DISTINCT`.

## Joins {b}

| Join | Returns |
|---|---|
| `INNER JOIN` | Only rows with a match on both sides |
| `LEFT [OUTER] JOIN` | All left rows; right columns NULL when no match |
| `RIGHT JOIN` | All right rows (rare; flip to LEFT) |
| `FULL OUTER JOIN` | All rows from both, matched where possible |
| `CROSS JOIN` | Every combination (Cartesian product) |
| Self join | A table joined to itself (employee → manager) |

```text
Customers            Orders               INNER JOIN on CustomerId   LEFT JOIN Customers → Orders
Id Name              Id CustomerId        Ana  #1                    Ana  #1
1  Ana               1  1                 Ana  #2                    Ana  #2
2  Bo                2  1                                            Bo   NULL   ← Bo has no orders
```

## Indexes: the single most important performance tool in this chapter {i}

Here's the problem an index solves, stated plainly: without one, finding a matching row means a **table scan** — the database reading every single row, one by one, to check if it matches. On a table with a few hundred rows that's instant and nobody notices. On a table with fifty million rows, it's the difference between a 2-millisecond query and a 4-second one, and it's the single most common cause of "why is this endpoint slow" tickets in real production systems. An index is a sorted **B+tree** structure built specifically so the database can **seek** directly to matching rows in O(log n) time instead of scanning everything.

### Clustered vs non-clustered (SQL Server)

| | Clustered index | Non-clustered index |
|---|---|---|
| What it is | **The table itself**, stored in key order (leaf pages contain the full rows) | A separate B-tree of key columns + a pointer (the clustered key) to the row |
| How many | **One** per table | Many (up to 999) |
| Default | The primary key | Created explicitly (and for unique constraints) |
| Lookup cost | Seek straight to the row | Seek in the index, then a **key lookup** into the clustered index per row (unless covering) |

```sql
-- Composite index for: WHERE CustomerId = @c AND CreatedAt >= @from ORDER BY CreatedAt DESC
CREATE INDEX IX_Orders_Customer_Created ON Orders (CustomerId, CreatedAt DESC)
INCLUDE (Status, Total);          -- INCLUDE makes it COVERING: no key lookups for these columns
```

### Index design rules

1. Index columns used in **WHERE, JOIN, ORDER BY and GROUP BY** on large tables. **Foreign keys** usually need an index (EF Core creates them).
2. **Column order matters in composite indexes**: an index on `(CustomerId, CreatedAt)` serves `WHERE CustomerId = …` and `WHERE CustomerId = … AND CreatedAt > …`, but **not** `WHERE CreatedAt > …` alone (leftmost-prefix rule). Put equality columns first, then range/sort columns.
3. **Covering indexes** (`INCLUDE`) avoid lookups for hot queries.
4. **Selectivity**: indexes help when they filter to a small fraction of rows. An index on a boolean `IsDeleted` alone rarely helps (consider a **filtered index**: `WHERE IsDeleted = 0`).
5. Indexes **cost writes and storage**: every INSERT/UPDATE/DELETE maintains every index. Don't index everything.
6. **Sargability**: the predicate must let the engine use the index.

Rule 2's leftmost-prefix rule isn't an arbitrary restriction — it falls directly out of how a B-tree is physically sorted. An index on `(CustomerId, CreatedAt)` stores rows sorted first by `CustomerId`, and *within* each `CustomerId`, by `CreatedAt`. Think of a phone book sorted by last name, then first name. You can jump straight to "Smith" (equality on the leading column), and from there to "Smith, John" (a range on the trailing column). But there's no way to jump straight to "everyone named John" without checking every last name, because the book was never sorted that way. Same with the index: query by `CreatedAt` alone, with no `CustomerId` filter, and the index can't help — the engine falls back to a scan.

```sql
WHERE YEAR(CreatedAt) = 2026                          -- ✘ function on the column → scan
WHERE CreatedAt >= '2026-01-01' AND CreatedAt < '2027-01-01'   -- ✔ range → seek

WHERE Name LIKE '%board'                               -- ✘ leading wildcard → scan
WHERE Name LIKE 'Key%'                                 -- ✔ seek
WHERE CAST(Sku AS INT) = 5  /  WHERE NVarcharCol = @varcharParam   -- ✘ implicit conversions can kill seeks
```

Notice the shared pattern across all three "✘" lines: each one wraps the indexed column in a function, a leading wildcard, or an implicit conversion before comparing it. The engine can't use a sorted structure to answer "what does `YEAR(CreatedAt)` equal" without first computing `YEAR(CreatedAt)` for every row — which is a scan by another name. Rewrite the predicate so the *raw column* is what's being compared, as the range-based version does, and the seek comes back.

### Clustered key choice and GUIDs

A clustered key should be **narrow, unique, static and ever-increasing** — and that last property deserves a concrete reason, not just a rule to memorise. Since the clustered index *is* the physical row order, every insert has to land in the correct sorted position. An ever-increasing key (like an identity column) always inserts at the *end* of the structure — cheap. A random `Guid.NewGuid()` key inserts at a random position somewhere in the *middle* of an already-full B-tree, forcing a **page split** to make room, which both fragments the structure and costs far more than an append. Options: `INT/BIGINT IDENTITY`; **sequential GUIDs** (`NEWSEQUENTIALID()`, EF Core's default GUID value generator for SQL Server, or **`Guid.CreateVersion7()`** in .NET 9, which is time-ordered); or a GUID PK kept as a non-clustered key, with a separate clustered identity column doing the physical ordering instead.

## Execution plans: watching the database explain its own decisions {i}

The **query optimiser** decides *how* to execute a piece of SQL — which indexes to use, which join algorithm, in which order — based on **statistics** it keeps about how the data is actually distributed. When a query is slow, the execution plan is where you go to see exactly what it decided and why:

| Operator | Meaning | Usually |
|---|---|---|
| **Index Seek** | Navigate the B-tree to matching rows | ✔ Good |
| **Index/Table Scan** | Read everything | ✘ on big tables (fine on small ones) |
| **Key Lookup** | Fetch extra columns from the clustered index per row | ⚠ Many lookups → add INCLUDE columns |
| **Nested Loops / Hash Match / Merge Join** | Join algorithms | Depends on row counts |
| **Sort** | Explicit sorting | ⚠ Can spill to tempdb; an index may provide order |
| **Implicit conversion warning** | Type mismatch | ✘ Fix parameter types |

Tools: SSMS / Azure Data Studio "Include Actual Execution Plan", `SET STATISTICS IO, TIME ON`, **Query Store** (tracks regressions over time), Azure SQL **Query Performance Insight** and automatic index recommendations, Postgres `EXPLAIN (ANALYZE, BUFFERS)`.

**Parameter sniffing** is a subtler trap. SQL Server compiles and caches a query plan the *first* time it sees that query, built around whatever parameter values happened to be passed in on that first call. Say a query for "a customer's orders" first runs for a customer with exactly one order — the cached plan gets optimised for tiny result sets. That same plan is then reused, unchanged, the next time the query runs for a customer with a million orders, where it performs terribly. Mitigations: `OPTION (RECOMPILE)` for that specific query, `OPTIMIZE FOR`, better indexes, Query Store plan forcing, or Parameter Sensitive Plan optimisation (SQL Server 2022 / Azure SQL).

## Transactions and ACID: the unit the database actually guarantees {b}

A **transaction** groups several statements into one all-or-nothing unit — and the four letters of ACID are really four separate promises the database is making about that unit:

| Property | Guarantee |
|---|---|
| **Atomicity** | All statements succeed, or none take effect (rollback) |
| **Consistency** | Constraints hold before and after |
| **Isolation** | Concurrent transactions don't see each other's partial work (to a configurable degree) |
| **Durability** | Once committed, it survives crashes (write-ahead log) |

```sql
BEGIN TRANSACTION;
    UPDATE Accounts SET Balance = Balance - @amount WHERE Id = @from AND Balance >= @amount;
    IF @@ROWCOUNT = 0 BEGIN ROLLBACK; THROW 50001, 'Insufficient funds', 1; END
    UPDATE Accounts SET Balance = Balance + @amount WHERE Id = @to;
    INSERT INTO Transfers (FromId, ToId, Amount) VALUES (@from, @to, @amount);
COMMIT;
```

That worked example earns its place in the chapter because it shows *why* atomicity matters, not just what it means: without the transaction wrapping all three statements, a crash between the debit and the credit would leave money subtracted from one account and never added to the other — a real, silent loss. In EF Core, a single `SaveChanges()` call is already wrapped in one transaction automatically; explicit transactions are for when you need to span multiple `SaveChanges()` calls, or mix EF Core with raw SQL. See [EF Core advanced](ch:efcore-advanced).

Keep transactions **short**, as a hard rule: never wait on an HTTP call or user input while a transaction is open, because every lock it holds stays held until commit — and the next section covers exactly how that turns into a very different kind of problem.

## Isolation levels and the anomalies each one actually prevents {a}

Run two transactions at the same time against overlapping data, and several specific, nameable things can go wrong depending on how strictly the database isolates them from each other:

| Anomaly | What happens |
|---|---|
| **Dirty read** | Reading another transaction's **uncommitted** changes (which may roll back) |
| **Non-repeatable read** | Reading the same row twice in a transaction gives different values (someone updated and committed in between) |
| **Phantom read** | Re-running a range query returns new rows (someone inserted) |
| **Lost update** | Two transactions read, modify and write the same row; one overwrites the other |
| **Write skew** | Two transactions read overlapping data and make disjoint writes that together break a rule (two doctors both go off call) |

Each isolation level is really a statement about which of these anomalies the database is willing to prevent, at the cost of more blocking:

| Isolation level | Dirty | Non-repeatable | Phantom | Notes |
|---|---|---|---|---|
| Read Uncommitted (`NOLOCK`) | ✘ possible | possible | possible | Almost never correct in business code |
| **Read Committed** | prevented | possible | possible | **SQL Server default** (locking); **Postgres default** (MVCC) |
| **Read Committed Snapshot (RCSI)** | prevented | possible | possible | Readers see the last committed version: **readers don't block writers**. Default in **Azure SQL** |
| Repeatable Read | prevented | prevented | possible (SQL Server) | Holds shared locks until commit |
| **Snapshot** | prevented | prevented | prevented | Transaction-consistent view via row versioning; update conflicts raise errors |
| **Serializable** | prevented | prevented | prevented | As if transactions ran one at a time; range locks; most blocking |

:::gotcha WITH (NOLOCK) is not a performance fix
It's tempting to reach for `NOLOCK` the moment a query feels slow, but look at what it actually gives up: Read Uncommitted can return data that was never actually committed, **skip rows entirely, or read the same row twice** if a page happens to split while the scan is running — none of which is a safe trade for speed in business code. RCSI or Snapshot isolation give you non-blocking reads **without** any of those correctness risks, which is almost always the fix people were actually reaching for.
:::

## Locking, blocking and deadlocks {a}

Under locking-based isolation, a writer takes an **exclusive lock** on the rows it's touching, and a reader takes a **shared lock** (at row, page, or table granularity, escalating as needed). **Blocking** is simply one transaction waiting for another's lock to release. A **deadlock** is the specific, unresolvable case where two transactions each hold a lock the *other* one needs — meaning neither can ever proceed, no matter how long either one waits:

```text
Tx A: UPDATE Accounts WHERE Id = 1   (locks row 1)  →  UPDATE Accounts WHERE Id = 2  (waits for B)
Tx B: UPDATE Accounts WHERE Id = 2   (locks row 2)  →  UPDATE Accounts WHERE Id = 1  (waits for A)   ⇒ DEADLOCK
```

![Transaction A locks row 1 and waits on row 2; transaction B locks row 2 and waits on row 1 — a cycle the database detects and breaks by killing one transaction as the deadlock victim](visuals/deadlock-cycle.svg)

The database can't wait this out — there's no amount of patience that resolves a genuine cycle — so it actively detects the cycle and kills one of the two transactions outright (the **deadlock victim**, surfacing to your code as SQL Server error **1205**). That victim transaction should always be **retried**, because the deadlock was a timing accident, not a real problem with the data.

Prevention strategies, each one attacking a different part of how the cycle forms: access tables and rows in a **consistent order** across your codebase (lowest ID first, say), so two transactions can never form the crossed pattern shown above; keep transactions short, so the window where a lock is held is small; add indexes so updates lock fewer rows (a scan, by contrast, locks far more); use RCSI so readers never contribute to the blocking in the first place; and **retry** on deadlock and transient errors automatically (EF Core's `EnableRetryOnFailure`).

**Pessimistic locking**, when you genuinely need it ("reserve this seat" — where you cannot allow even a brief race): `SELECT … WITH (UPDLOCK, ROWLOCK)` in SQL Server or `SELECT … FOR UPDATE` in Postgres, inside a short transaction. Most web apps, though, prefer **optimistic concurrency** (version columns, the ETag mechanism from [API design](ch:api-design#optimistic-concurrency-with-etags)) instead, because it avoids holding locks across the round trip to the client entirely.

## Connection pooling: the cost hiding behind every Open() call {i}

Opening a physical database connection — a TCP handshake, TLS negotiation, authentication — is expensive, in exactly the same way opening a fresh HTTP connection per request was expensive in [Calling other services](ch:http-client#what-an-httpclient-actually-is-underneath). ADO.NET providers solve it the same way: a **pool** of already-open connections, kept per unique connection string, where `Open()` just borrows one and `Dispose()`/`Close()` returns it rather than actually tearing it down.

- Default max pool size is **100** (SqlClient). Under load, if connections aren't returned quickly enough, you get *"Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool"*.
- Causes: not disposing connections or DbContexts, long transactions, slow queries, **sync-over-async** holding a connection open while a thread blocks on something that should have been awaited, or a sudden spike of parallel work exceeding the pool's capacity.
- The operating discipline that avoids all of this: don't open connections early or hold them open across unrelated work. Open late, close early.

```text
Server=tcp:shop.database.windows.net;Database=shop;Authentication=Active Directory Default;
Encrypt=True;Max Pool Size=200;Connect Timeout=15;Application Name=shop-api
```

## SQL Server vs PostgreSQL in .NET shops {i}

| | SQL Server / Azure SQL | PostgreSQL / Azure Database for PostgreSQL |
|---|---|---|
| Driver | `Microsoft.Data.SqlClient` | `Npgsql` |
| EF Core provider | `Microsoft.EntityFrameworkCore.SqlServer` | `Npgsql.EntityFrameworkCore.PostgreSQL` |
| Concurrency model | Locking (plus optional row versioning, RCSI) | MVCC by default |
| Identity | `IDENTITY`, sequences | `GENERATED … AS IDENTITY`, sequences |
| Notable features | Columnstore, temporal tables, Query Store, Always On | JSONB, arrays, rich extensions (PostGIS, pgvector), `ON CONFLICT` |
| Licence | Commercial (free Express/Developer editions) | Open source |

Both are excellent, genuinely mature databases. EF Core abstracts away most of the differences for everyday CRUD, but raw SQL and the fine details of performance tuning — the exact default isolation level, how each one physically organises a clustered table — do differ, which is why this chapter calls out SQL Server's locking model specifically rather than treating "the database" as one interchangeable thing.

:::qa What's the difference between a clustered and a non-clustered index?
A clustered index defines the physical order of the table: its leaf level is the data rows, and there can be only one (usually the PK). A non-clustered index is a separate B-tree of key columns pointing to rows via the clustered key, so non-covered columns need key lookups; there can be many. INCLUDE columns make a non-clustered index covering.
:::

:::qa How do you decide which columns to index?
Columns in frequent WHERE, JOIN, ORDER BY and GROUP BY clauses of important queries on large tables, especially foreign keys. Order composite indexes with equality columns first and range/sort columns after, add INCLUDE for covering, prefer selective columns, and balance against write overhead. Verify with execution plans and Query Store.
:::

:::qa What does sargable mean?
A predicate the engine can satisfy with an index seek. Wrapping the indexed column in a function, leading wildcards and implicit type conversions make predicates non-sargable, forcing scans.
:::

:::qa Explain ACID.
Atomicity (all or nothing), Consistency (constraints preserved), Isolation (concurrent transactions don't interfere beyond the chosen level) and Durability (committed data survives failures, via the transaction log).
:::

:::qa What are isolation levels and which anomalies do they prevent?
Read Uncommitted allows dirty reads. Read Committed prevents dirty reads (the default). Repeatable Read also prevents non-repeatable reads. Serializable prevents phantoms too. Snapshot/RCSI use row versioning so readers see committed versions without blocking writers. Higher isolation means more correctness but more blocking or conflicts.
:::

:::qa What is a deadlock and how do you handle it?
Two transactions each wait for a lock held by the other. The database kills one (SQL error 1205). Prevent it by accessing resources in a consistent order, keeping transactions short, indexing so fewer rows are locked, and using row versioning. Handle it by retrying the victim transaction.
:::

:::qa Why are random GUIDs bad clustered keys?
Inserts land at random positions in the B-tree, causing page splits, fragmentation and poor cache use; they're also 16 bytes, which widens every non-clustered index. Use sequential IDs (IDENTITY, NEWSEQUENTIALID, UUIDv7 via Guid.CreateVersion7) or keep GUIDs as non-clustered PKs.
:::

:::qa What is connection pooling and what causes pool exhaustion?
Reusing open physical connections per connection string so Open is cheap. Exhaustion (timeouts obtaining a connection) comes from connections not being disposed, long-running transactions or queries, sync-over-async blocking while holding connections, or more concurrent work than the pool size.
:::

:::qa What is parameter sniffing?
SQL Server compiles and caches a plan using the first parameter values it sees. If those are unrepresentative, later executions reuse a suboptimal plan. Fixes include OPTION(RECOMPILE), OPTIMIZE FOR, better indexing, Query Store plan forcing, or PSP optimisation.
:::

## Further reading

- [SQL Server index architecture and design guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-index-design-guide)
- [Transaction isolation levels](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql)
- [Use the Index, Luke](https://use-the-index-luke.com/): the best free guide to SQL indexing, for developers.
- Book: *Designing Data-Intensive Applications* by Martin Kleppmann (chapters 2, 3 and 7).

## Verify this chapter

This chapter is mostly about a real SQL engine's internals (B-trees, locking, the query optimiser), which a plain console app can't observe directly — trust [Further reading](#further-reading) for those, especially the isolation-level table and parameter sniffing. What the code below *can* genuinely check is the **logic** behind two claims: the INNER/LEFT JOIN results shown earlier, and the leftmost-prefix rule (why an index on `(CustomerId, CreatedAt)` can't serve a `CreatedAt`-only query). Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
var customers = new[] { (Id: 1, Name: "Ana"), (Id: 2, Name: "Bo") };
var orders = new[] { (Id: 1, CustomerId: 1), (Id: 2, CustomerId: 1) };

// Claim: INNER JOIN only returns customers that have a matching order.
var inner = customers.Join(orders, c => c.Id, o => o.CustomerId, (c, o) => (c.Name, o.Id));
if (inner.Count() != 2 || inner.Any(x => x.Name == "Bo"))
    throw new Exception("FAIL: INNER JOIN should return only Ana's 2 orders, never Bo");
Console.WriteLine("OK: INNER JOIN returns only rows with a match on both sides");

// Claim: LEFT JOIN keeps every customer, with NULL order columns when there's no match.
var left = customers.GroupJoin(orders, c => c.Id, o => o.CustomerId,
    (c, os) => (c.Name, OrderIds: os.Select(o => (int?)o.Id).DefaultIfEmpty(null).ToList()));
var bo = left.First(x => x.Name == "Bo");
if (bo.OrderIds.Count != 1 || bo.OrderIds[0] != null)
    throw new Exception("FAIL: LEFT JOIN should keep Bo with a NULL order");
Console.WriteLine("OK: LEFT JOIN keeps unmatched rows (Bo) with NULL on the right side");

// Claim: a composite index on (CustomerId, CreatedAt) sorts by CustomerId first, then CreatedAt —
// so it can serve "WHERE CustomerId = x" but is useless for "WHERE CreatedAt > y" alone.
var rows = new[]
{
    (CustomerId: 2, CreatedAt: new DateTime(2026, 1, 1)),
    (CustomerId: 1, CreatedAt: new DateTime(2026, 3, 1)),
    (CustomerId: 1, CreatedAt: new DateTime(2026, 1, 1)),
    (CustomerId: 2, CreatedAt: new DateTime(2026, 2, 1)),
};
var indexOrder = rows.OrderBy(r => r.CustomerId).ThenBy(r => r.CreatedAt).ToArray();
bool sortedByCreatedAtAlone = indexOrder.Zip(indexOrder.Skip(1), (a, b) => a.CreatedAt <= b.CreatedAt).All(x => x);
if (sortedByCreatedAtAlone)
    throw new Exception("FAIL: expected the composite order to NOT be a plain CreatedAt order");
Console.WriteLine("OK: sorting by (CustomerId, CreatedAt) does not give a usable CreatedAt-only order (leftmost-prefix rule holds)");

// Claim: ACID atomicity — a transfer either fully happens or leaves no partial trace.
var accounts = new Dictionary<string, int> { ["A"] = 100, ["B"] = 50 };
bool TryTransfer(string from, string to, int amount)
{
    if (accounts[from] < amount) return false;          // insufficient funds: no partial write
    accounts[from] -= amount;
    accounts[to] += amount;
    return true;
}
var before = accounts["A"] + accounts["B"];
if (TryTransfer("A", "B", 1000))
    throw new Exception("FAIL: an overdrawing transfer should have been rejected atomically");
if (accounts["A"] + accounts["B"] != before)
    throw new Exception("FAIL: a failed transfer must leave total balance unchanged (no partial effect)");
Console.WriteLine("OK: a failed transfer leaves no partial effect — total balance unchanged (atomicity)");

// Not runtime-verifiable here — see Further reading:
// - real index seeks vs. scans, execution plans, parameter sniffing (needs an actual query optimiser)
// - locking, blocking and deadlock detection (needs a real multi-connection database engine)
// - connection pool exhaustion and its default size of 100 (SqlClient-specific behaviour)
```
