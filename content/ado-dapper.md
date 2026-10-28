---
id: ado-dapper
title: ADO.NET and Dapper: Working Close to SQL
summary: The data-access layer everything else is built on. ADO.NET's connection, command, reader and parameter model, async and disposal, transactions, then Dapper, the micro-ORM: queries, multi-mapping, multiple result sets, stored procedures and bulk patterns, plus when to choose Dapper over EF Core.
layer: data
where: Data & state › Relational databases › ADO.NET & micro-ORMs
fits: ADO.NET is the **foundation** under both EF Core ([EF Core fundamentals](ch:efcore-fundamentals)) and Dapper: every query either of them runs goes through a `DbConnection` and a `DbCommand`. Dapper is a thin layer that suits CQRS read sides ([CQRS](ch:cqrs-mediator-result)) and performance-critical queries.
levels: b,i,a
prereqs: relational-fundamentals, async-await
next: efcore-fundamentals, cqrs-mediator-result
---

## TL;DR

- **ADO.NET** (`DbConnection`, `DbCommand`, `DbDataReader`, `DbParameter`) is the low-level API every .NET data-access tool — EF Core, Dapper, hand-rolled code — is eventually built on.
- Always parameterize SQL: it stops SQL injection and lets the database reuse cached query plans.
- **Dapper** is a thin layer over ADO.NET: you write the SQL, Dapper maps the rows to objects. No change tracking, no migrations, near-raw performance.
- For bulk inserts, row-by-row `INSERT`s are too slow — use `SqlBulkCopy`/`COPY`, table-valued parameters, or set-based updates instead.
- A common pattern: EF Core for writes (business rules, change tracking, migrations), Dapper or raw SQL for fast, flat reads.

## The layer every other data-access tool is secretly built on {b}

Whichever way you query a .NET database — EF Core's LINQ, Dapper's SQL strings, or a hand-rolled reader loop — every single one of them eventually bottoms out in the same four objects. **ADO.NET** (`System.Data`) is that provider-agnostic, low-level database API, and each database ships a **provider** implementing it:

| Abstract class | SQL Server (`Microsoft.Data.SqlClient`) | PostgreSQL (`Npgsql`) | SQLite |
|---|---|---|---|
| `DbConnection` | `SqlConnection` | `NpgsqlConnection` | `SqliteConnection` |
| `DbCommand` | `SqlCommand` | `NpgsqlCommand` | `SqliteCommand` |
| `DbDataReader` | `SqlDataReader` | `NpgsqlDataReader` | `SqliteDataReader` |
| `DbParameter` | `SqlParameter` | `NpgsqlParameter` | `SqliteParameter` |
| `DbTransaction` | `SqlTransaction` | `NpgsqlTransaction` | … |
| `DbDataSource` (.NET 7) | `SqlDataSource`* | `NpgsqlDataSource` | … |

*Use `Microsoft.Data.SqlClient`, not the legacy `System.Data.SqlClient`.

```csharp
await using var conn = new SqlConnection(connectionString);          // borrows from the pool on Open
await conn.OpenAsync(ct);

await using var cmd = new SqlCommand(
    "SELECT Id, Name, Price FROM Products WHERE CategoryId = @cat AND Price <= @max ORDER BY Name", conn);
cmd.Parameters.Add(new SqlParameter("@cat", SqlDbType.Int) { Value = categoryId });
cmd.Parameters.Add(new SqlParameter("@max", SqlDbType.Decimal) { Precision = 18, Scale = 2, Value = maxPrice });

await using var reader = await cmd.ExecuteReaderAsync(ct);           // forward-only, streaming cursor
var products = new List<ProductDto>();
while (await reader.ReadAsync(ct))
{
    products.Add(new ProductDto(
        reader.GetInt32(0),
        reader.GetString(1),
        reader.GetDecimal(2)));
}
```

| Method | Returns | Use |
|---|---|---|
| `ExecuteReaderAsync` | `DbDataReader` | Row sets |
| `ExecuteScalarAsync` | First column of first row | `COUNT(*)`, `SCOPE_IDENTITY()` |
| `ExecuteNonQueryAsync` | Rows affected | INSERT/UPDATE/DELETE |

:::gotcha Always parameterise
```csharp
var sql = $"SELECT * FROM Users WHERE Email = '{email}'";   // ✘ SQL injection: email = "' OR 1=1 --"
cmd.Parameters.AddWithValue("@email", email);              // ✔ (prefer typed Add over AddWithValue to avoid type-inference issues)
```
Parameters also let the database **reuse cached plans**, exactly the mechanism [Relational fundamentals](ch:relational-fundamentals#execution-plans-watching-the-database-explain-its-own-decisi) covered — concatenated literals compile a brand-new plan for every distinct value, throwing that caching away entirely on top of the injection risk.
:::

### DataSet and DataTable

The old disconnected in-memory model (`DataSet`, `DataTable`, `DataAdapter`) is still around in legacy code and for bulk-copy staging. Modern apps map to POCOs with readers, Dapper or EF Core.

## Transactions in ADO.NET {i}

```csharp
await using var conn = new SqlConnection(cs);
await conn.OpenAsync(ct);
await using var tx = await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
try
{
    await using (var debit = new SqlCommand("UPDATE Accounts SET Balance -= @a WHERE Id = @id AND Balance >= @a", conn, (SqlTransaction)tx))
    {
        debit.Parameters.AddWithValue("@a", amount); debit.Parameters.AddWithValue("@id", fromId);
        if (await debit.ExecuteNonQueryAsync(ct) == 0) throw new InsufficientFundsException();
    }
    // ... credit, insert transfer row (each command enlisted with tx) ...
    await tx.CommitAsync(ct);
}
catch
{
    await tx.RollbackAsync(ct);
    throw;
}
```

`TransactionScope` (System.Transactions) gives ambient transactions spanning multiple connections — convenient, but it silently **escalates to a distributed transaction (MSDTC)** the moment more than one connection or resource manager is involved, and MSDTC is unavailable or unwanted in most cloud setups. If you use it with async code, pass `new TransactionScope(TransactionScopeAsyncFlowOption.Enabled)`, or the ambient transaction won't flow across the `await`.

## Bulk operations: when row-by-row stops being viable {i}

Inserting 100,000 rows one `INSERT` at a time takes minutes, because each one pays its own network round trip and transaction-log write. The options that avoid that cost each trade something for speed:

| Approach | Speed | Notes |
|---|---|---|
| `SqlBulkCopy` (SQL Server) / `COPY` binary import (Npgsql) | **Fastest** | Streams rows into a table; great for imports and staging tables |
| Table-valued parameters (SQL Server) | Fast | Pass a set of rows to a stored proc / MERGE |
| Batched multi-row INSERTs | Good | EF Core batches automatically on SaveChanges |
| EF Core `ExecuteUpdate`/`ExecuteDelete` | Fast for set-based updates | No entity loading |
| Libraries (EFCore.BulkExtensions, linq2db) | Fast | Commercial licences for some |

```csharp
using var bulk = new SqlBulkCopy(conn) { DestinationTableName = "StagingPrices", BatchSize = 10_000 };
bulk.ColumnMappings.Add("Sku", "Sku");
bulk.ColumnMappings.Add("Price", "Price");
await bulk.WriteToServerAsync(dataReaderOrDataTable, ct);
// then a set-based MERGE from staging into the real table
```

## Dapper: the micro-ORM that stays out of your way {b}

**Dapper** (by Stack Overflow) is, at its core, just a set of extension methods on `IDbConnection`. The division of labour it offers is deliberately minimal: **you write the SQL; Dapper maps the resulting rows to objects** (and your objects to parameters), with performance close enough to hand-written ADO.NET that the difference rarely matters. There's no change tracking, no LINQ translation layer, and no migrations — Dapper simply isn't trying to be a full ORM.

```csharp
await using var conn = new SqlConnection(cs);      // Dapper opens/closes it if it's closed

// Query → IEnumerable<T>; anonymous object → parameters
var products = await conn.QueryAsync<ProductDto>(
    "SELECT Id, Name, Price FROM Products WHERE CategoryId = @CategoryId ORDER BY Name",
    new { CategoryId = categoryId });

var one = await conn.QuerySingleOrDefaultAsync<ProductDto>("SELECT Id, Name, Price FROM Products WHERE Id = @id", new { id });
var count = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Orders WHERE CustomerId = @customerId", new { customerId });

var affected = await conn.ExecuteAsync(
    "UPDATE Products SET Price = @Price WHERE Id = @Id", new { Id = 5, Price = 19.99m });

// IN lists are expanded automatically
var some = await conn.QueryAsync<ProductDto>("SELECT * FROM Products WHERE Id IN @ids", new { ids = new[] { 1, 2, 3 } });

// Pass a CancellationToken via CommandDefinition
var rows = await conn.QueryAsync<OrderRow>(new CommandDefinition(sql, args, cancellationToken: ct));
```

The mapping itself works by matching **column name to property or constructor parameter name**, case-insensitively — no attributes, no configuration. Records with positional constructors work out of the box; where a column name doesn't match a property name, a SQL alias (`AS CustomerName`) closes the gap.

## Dapper: advanced usage {i}

### Multi-mapping: turning a join back into an object graph

The one thing Dapper's simplicity doesn't give you for free is what EF Core's navigation properties handle automatically — reconstructing a nested object from a flat, joined row. Multi-mapping is Dapper's answer:

```csharp
const string sql = """
    SELECT o.Id, o.Total, o.CreatedAt, c.Id, c.Name, c.Email
    FROM Orders o JOIN Customers c ON c.Id = o.CustomerId
    WHERE o.CreatedAt >= @since
    """;
var orders = await conn.QueryAsync<OrderView, CustomerView, OrderView>(
    sql,
    (order, customer) => order with { Customer = customer },
    new { since },
    splitOn: "Id");          // where the second object's columns start (the second "Id")
```

`splitOn` is doing the real work: the query returns one flat row with both an order's `Id` and a customer's `Id`, so Dapper has to be told explicitly where the first object's columns end and the second one's begin — a row is just a sequence of columns, with no structural hint of its own.

### Multiple result sets in one round trip

```csharp
using var multi = await conn.QueryMultipleAsync("""
    SELECT * FROM Orders WHERE Id = @id;
    SELECT * FROM OrderLines WHERE OrderId = @id;
    """, new { id });
var order = await multi.ReadSingleAsync<OrderDetail>();
var lines = (await multi.ReadAsync<OrderLineDto>()).ToList();
```

This is worth reaching for specifically when an "order with its lines" screen would otherwise need two separate round trips: here, both statements travel over the wire together, and the single open connection reads each result set in turn.

### Stored procedures, output parameters, transactions

```csharp
var p = new DynamicParameters();
p.Add("@CustomerId", customerId);
p.Add("@NewOrderId", dbType: DbType.Int32, direction: ParameterDirection.Output);
await conn.ExecuteAsync("dbo.CreateOrder", p, commandType: CommandType.StoredProcedure);
int newId = p.Get<int>("@NewOrderId");

await using var tx = await conn.BeginTransactionAsync();
await conn.ExecuteAsync(sql1, args1, tx);
await conn.ExecuteAsync(sql2, args2, tx);
await tx.CommitAsync();
```

### Type handlers

Map custom types (strongly typed IDs, JSON columns, `DateOnly` on older providers) with `SqlMapper.AddTypeHandler(new OrderIdHandler())`.

## Registering connections in DI {i}

```csharp
// Modern: DbDataSource (Npgsql) — a singleton factory for pooled connections
builder.Services.AddNpgsqlDataSource(builder.Configuration.GetConnectionString("Shop")!);
public sealed class ProductQueries(NpgsqlDataSource db)
{
    public async Task<IEnumerable<ProductDto>> ListAsync() { await using var c = await db.OpenConnectionAsync(); return await c.QueryAsync<ProductDto>("…"); }
}

// SQL Server: a small factory abstraction keeps code testable
public interface IDbConnectionFactory { SqlConnection Create(); }
public sealed class SqlConnectionFactory(IConfiguration cfg) : IDbConnectionFactory
{
    private readonly string _cs = cfg.GetConnectionString("Shop")!;
    public SqlConnection Create() => new(_cs);
}
builder.Services.AddSingleton<IDbConnectionFactory, SqlConnectionFactory>();
```

## Dapper vs EF Core: the real decision, not a popularity contest {i}

| | EF Core | Dapper |
|---|---|---|
| You write | LINQ (SQL optional) | SQL |
| Change tracking / unit of work | ✔ | ✘ |
| Migrations / schema management | ✔ | ✘ (use DbUp, Flyway, sqlproj/DACPAC) |
| Relationships & loading | ✔ Include, navigations | Manual (multi-mapping) |
| Compile-time query checking | Partially (LINQ is typed) | ✘ (SQL strings) |
| Raw performance | Very good (gap much smaller since EF Core 6–8) | Excellent, minimal overhead |
| Complex reporting SQL (CTEs, window functions, hints) | Possible via `FromSql`/`SqlQuery` | Natural |
| Learning curve | Higher (tracking, loading, translation rules) | Low (if you know SQL) |

This table describes two tools built for different jobs, which is why a pragmatic combination uses both at once, naturally falling out of CQRS: **EF Core for the write side** (aggregates, business rules, change tracking, migrations — where EF Core's extra machinery earns its keep) and **Dapper, or EF Core's own raw SQL, for the read side** (fast, flat, tailored queries returning DTOs directly, with no tracking overhead for data nobody's going to mutate). EF Core can run raw SQL this way too, without Dapper at all: `db.Database.SqlQuery<ProductDto>($"SELECT …")`.

:::qa What are the main ADO.NET classes?
DbConnection (a connection to the database, pooled), DbCommand (SQL text or stored procedure with parameters), DbDataReader (fast forward-only streaming over results), DbParameter, and DbTransaction, each implemented by providers such as SqlClient and Npgsql. Newer: DbDataSource as a connection factory.
:::

:::qa Why must you parameterise SQL?
To prevent SQL injection (input is sent as data, never parsed as SQL) and to let the database reuse cached execution plans. Concatenating input into SQL is a critical vulnerability.
:::

:::qa What is Dapper and how is it different from EF Core?
A micro-ORM: extension methods on IDbConnection that execute your SQL and map results to objects (and objects to parameters) with near-raw ADO.NET performance. It has no change tracking, LINQ provider, relationship management or migrations, unlike the full ORM EF Core.
:::

:::qa How do you map a join into nested objects with Dapper?
Multi-mapping: QueryAsync&lt;T1, T2, TResult&gt; with a mapping function that combines the objects per row, and splitOn naming the column where the second object's columns start. Use a dictionary to de-duplicate parents for one-to-many.
:::

:::qa How would you insert 1 million rows efficiently?
Use SqlBulkCopy (or Npgsql binary COPY) to stream rows into a staging or target table in batches, then a set-based MERGE/INSERT…SELECT if needed. Avoid row-by-row INSERTs and EF change tracking for large imports.
:::

:::qa When would you choose Dapper over EF Core?
For read-heavy, performance-critical or complex SQL (reports, CTEs, window functions, hints), when the team prefers explicit SQL, or for CQRS read models. EF Core for rich domain writes, change tracking, relationships and migrations. Using both is common.
:::

## Further reading

- [ADO.NET overview](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/ado-net-overview)
- [Microsoft.Data.SqlClient](https://learn.microsoft.com/en-us/sql/connect/ado-net/introduction-microsoft-data-sqlclient-namespace)
- [Dapper on GitHub](https://github.com/DapperLib/Dapper)
- [Npgsql documentation](https://www.npgsql.org/doc/)

## Verify this chapter

Needs two packages: `dotnet add package Dapper` and `dotnet add package Microsoft.Data.Sqlite` in a new console project, then `dotnet run`. It uses an in-memory SQLite database to check raw ADO.NET parameterized commands, that parameterization defuses SQL-injection-shaped input, Dapper's column-to-object mapping, `IN` list expansion, multi-mapping with `splitOn`, `QueryMultipleAsync`, and `ExecuteAsync`'s affected-row count.

```csharp
using Dapper;
using Microsoft.Data.Sqlite;

int failures = 0;
void Check(string claim, bool ok)
{
    if (ok) Console.WriteLine($"OK: {claim}");
    else { Console.WriteLine($"FAIL: {claim}"); failures++; }
}

await using var conn = new SqliteConnection("Data Source=:memory:");
await conn.OpenAsync();

await conn.ExecuteAsync("""
    CREATE TABLE Products (Id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Price REAL NOT NULL, CategoryId INTEGER NOT NULL);
    CREATE TABLE Customers (Id INTEGER PRIMARY KEY, Name TEXT NOT NULL);
    CREATE TABLE Orders (Id INTEGER PRIMARY KEY, Total REAL NOT NULL, CustomerId INTEGER NOT NULL);
    """);

// 1. Raw ADO.NET: parameterized command + DbDataReader
await using (var insert = conn.CreateCommand())
{
    insert.CommandText = "INSERT INTO Products (Name, Price, CategoryId) VALUES (@name, @price, @cat)";
    insert.Parameters.AddWithValue("@name", "Widget");
    insert.Parameters.AddWithValue("@price", 9.99);
    insert.Parameters.AddWithValue("@cat", 1);
    await insert.ExecuteNonQueryAsync();
}
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT Id, Name, Price FROM Products WHERE CategoryId = @cat";
    cmd.Parameters.AddWithValue("@cat", 1);
    await using var reader = await cmd.ExecuteReaderAsync();
    bool gotRow = false;
    while (await reader.ReadAsync())
    {
        gotRow = reader.GetString(1) == "Widget" && reader.GetDouble(2) == 9.99;
    }
    Check("a parameterized DbCommand + DbDataReader round-trips a row correctly", gotRow);
}

// 2. Parameterization defuses SQL injection: a malicious-looking value is stored as plain data
var maliciousName = "Robert'); DROP TABLE Products; --";
await conn.ExecuteAsync("INSERT INTO Products (Name, Price, CategoryId) VALUES (@Name, @Price, @CategoryId)",
    new { Name = maliciousName, Price = 1.0, CategoryId = 2 });
var stillThere = await conn.QuerySingleAsync<int>("SELECT COUNT(*) FROM Products");
var storedLiteral = await conn.QuerySingleAsync<string>(
    "SELECT Name FROM Products WHERE CategoryId = @cat", new { cat = 2 });
Check("a parameterized value containing SQL syntax is stored literally, not executed",
    stillThere == 2 && storedLiteral == maliciousName);

// 3. Dapper QueryAsync<T> maps columns to a record by name
var products = (await conn.QueryAsync<ProductDto>(
    "SELECT Id, Name, Price FROM Products WHERE CategoryId = @CategoryId", new { CategoryId = 1 })).ToList();
Check("Dapper QueryAsync<T> maps result columns onto a record's constructor parameters by name",
    products.Count == 1 && products[0].Name == "Widget" && products[0].Price == 9.99);

// 4. IN list expansion
var byIds = await conn.QueryAsync<ProductDto>("SELECT Id, Name, Price FROM Products WHERE Id IN @ids", new { ids = new[] { 1, 2 } });
Check("Dapper expands an array parameter into a SQL IN list", byIds.Count() == 2);

// 5. Multi-mapping: a joined flat row reconstructed into a nested object
await conn.ExecuteAsync("INSERT INTO Customers (Id, Name) VALUES (1, 'Ana')");
await conn.ExecuteAsync("INSERT INTO Orders (Id, Total, CustomerId) VALUES (1, 42.5, 1)");
var orders = await conn.QueryAsync<OrderJoinRow, CustomerRow, OrderWithCustomer>(
    "SELECT o.Id, o.Total, c.Id, c.Name FROM Orders o JOIN Customers c ON c.Id = o.CustomerId",
    (order, customer) => new OrderWithCustomer(order.Id, order.Total, customer),
    splitOn: "Id");
var joined = orders.Single();
Check("Dapper multi-mapping reconstructs a nested object from a joined row via splitOn",
    joined.Total == 42.5 && joined.Customer.Name == "Ana");

// 6. QueryMultiple: two result sets from one round trip
using var multi = await conn.QueryMultipleAsync(
    "SELECT * FROM Orders WHERE Id = @id; SELECT * FROM Customers WHERE Id = @cid;",
    new { id = 1, cid = 1 });
var order = await multi.ReadSingleAsync<OrderRow>();
var customer = await multi.ReadSingleAsync<CustomerRow>();
Check("QueryMultipleAsync reads two separate result sets from one round trip",
    order.Total == 42.5 && customer.Name == "Ana");

// 7. ExecuteAsync returns rows affected
var affected = await conn.ExecuteAsync("UPDATE Products SET Price = @Price WHERE Id = @Id", new { Id = 1, Price = 19.99 });
Check("ExecuteAsync returns the number of rows affected", affected == 1);

Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
if (failures > 0) Environment.Exit(1);

record ProductDto(long Id, string Name, double Price);
record OrderRow(long Id, double Total, long CustomerId);
record OrderJoinRow(long Id, double Total);
record CustomerRow(long Id, string Name);
record OrderWithCustomer(long Id, double Total, CustomerRow Customer);
```

Not runtime-verifiable here: `SqlBulkCopy` performance claims, `TransactionScope`'s MSDTC escalation, and connection pooling behavior are all SQL Server/network-specific and don't apply to the in-memory SQLite database used above. See [Further reading](#further-reading) for those.
