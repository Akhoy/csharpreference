---
id: exceptions-disposal
title: "Exceptions and Cleanup: Failing Safely (try/catch, using, IDisposable)"
summary: "Episode 7. The payment provider fails mid-checkout, stock stays reserved and database connections leak until the site goes down. Exceptions stop the work and climb the call stack to whoever can handle them; finally and using make sure cleanup always happens. Covers unwinding, the exception hierarchy, throw vs throw ex, filters, custom exceptions, when not to throw, async exceptions, IDisposable, using, the Dispose pattern and IAsyncDisposable."
layer: language
where: C# language › Errors & resources
fits: Layer 1 mechanics that layer 3 builds on. ASP.NET Core turns unhandled exceptions into HTTP responses ([Errors & logging](ch:errors-logging)), the Result pattern ([CQRS & Result](ch:cqrs-mediator-result)) is the architectural alternative for expected failures, and disposal is how DbContext and HttpClient release their connections.
levels: b,i,a
prereqs: oop
next: errors-logging, async-await, cqrs-mediator-result
---

## The 30-second version

- When code **throws**, normal execution stops. The runtime **unwinds** the call stack, walking back through the callers until it finds a `catch` whose type matches. Every `finally` on the way still runs.
- Rethrow with **`throw;`**, never `throw ex;`, which wipes out the stack trace. Wrap with `new XException("context", ex)` to add meaning.
- `catch (X ex) when (condition)` (a **filter**) decides *before* unwinding. Catch the narrowest type you can, and never write an empty `catch {}`.
- Exceptions are for the *unexpected*. For normal "no" answers (bad input, out of stock), use `TryParse`-style methods or a `Result`.
- The GC frees **memory**, but not connections, files or locks. **`IDisposable`** + **`using`** releases them **now**, even when an exception is thrown, because `using` is a hidden `try/finally`.

## Previously, and the bug {b}

In [Episode 6](ch:linq) Kettle got readable reports. Then the payment provider had a bad afternoon, and checkout looked like this:

```csharp norun
public void Checkout(Order order)
{
    var conn = pool.Open();          // borrow a database connection
    ReserveStock(conn, order);       // stock is now held for this order
    ChargeCard(order);               // ← the provider times out and THROWS
    MarkPaid(conn, order);           // never runs
    conn.Close();                    // never runs: the connection is never returned
}
```

Each failed checkout leaves stock reserved for an order that will never complete, and **one database connection that's never given back**. The pool only has a fixed number of connections. After enough failures it's empty, and *every* request on the site starts timing out, including ones that have nothing to do with payments.

Two problems need two tools: handling the failure *somewhere sensible*, and making sure cleanup *always* happens.

## The lightbulb: an exception climbs the call stack {b}

When `ChargeCard` throws, it doesn't just stop. It creates an **exception**, an object describing what went wrong. Then the runtime hands it back through the callers, one frame at a time, asking each one: *"is this yours to handle?"*

That walk back through the callers has a name: **unwinding the stack**. A caller says "yes" with a **`catch`** block whose type matches the exception. On the way past, every **`finally`** block runs, whether or not it catches. So `finally` is where cleanup goes.

:::scene visuals/scenes/ex-unwind.svg | A failed payment, unwinding
1. `Checkout` called `PlaceOrder`, which called `ChargeCard`. Each call is a **frame** on the stack, with the newest on top.
2. `ChargeCard` **throws** `PaymentFailedException`. Normal execution stops right there. The runtime starts walking back through its callers, looking for a matching `catch`.
3. `PlaceOrder` has no matching `catch`, but it has a `finally`, so **the finally runs** (releasing the stock) and its frame is torn down. Cleanup happened even though nobody has handled the error yet.
4. `Checkout` has `catch (PaymentFailedException)`, which matches. Unwinding stops, and the code continues in that `catch`: "Payment failed, please try another card."
5. If no frame catches it, the exception reaches the top. In ASP.NET Core the exception-handling middleware catches it there and returns a 500 response ([Errors & logging](ch:errors-logging)).
:::

```csharp
Checkout();

static void Checkout()
{
    try { PlaceOrder(); }
    catch (PaymentFailedException ex)                  // matches: unwinding stops here
    {
        Console.WriteLine($"4. Checkout caught it: {ex.Message}. Ask for another card.");
    }
}

static void PlaceOrder()
{
    try
    {
        Console.WriteLine("1. stock reserved");
        ChargeCard();
        Console.WriteLine("never printed");
    }
    finally
    {
        Console.WriteLine("3. finally: stock released (runs even though nobody caught it yet)");
    }
}

static void ChargeCard()
{
    Console.WriteLine("2. charging card... provider timed out");
    throw new PaymentFailedException("card provider timeout");
}

class PaymentFailedException(string message) : Exception(message);
```

An exception object carries `Message`, `StackTrace` (where it happened), `InnerException` (the underlying cause, if it wraps another), and `ToString()`, which prints all of them. **Always log the exception object, not just `.Message`**, or you throw away the stack trace.

:::qa What happens when an exception is thrown?
Normal execution stops and the runtime unwinds the call stack, looking for a `catch` whose type matches. Each `finally` block it passes runs. The first matching `catch` handles the exception and execution continues after it. If nothing catches it, the thread terminates; in ASP.NET Core, the exception middleware turns it into a 500 response first.
:::

## Which exception to throw {b}

The exception's **type** is how callers tell problems apart without reading your message text. Here's the part of the family tree you'll actually use:

```text
Exception
├── ArgumentException            → ArgumentNullException, ArgumentOutOfRangeException
├── InvalidOperationException    → ObjectDisposedException
├── NotSupportedException
├── FormatException, InvalidCastException, KeyNotFoundException
├── OperationCanceledException   → TaskCanceledException
├── TimeoutException, IOException, HttpRequestException, DbException …
├── NullReferenceException       ← always a bug: never throw or catch it on purpose
└── AggregateException           ← wraps several (Task.Wait, Parallel)
```

| Situation | Throw |
|---|---|
| The caller passed a bad argument | `ArgumentException` / `ArgumentNullException` / `ArgumentOutOfRangeException` |
| The object is in the wrong state ("ship an unpaid order") | `InvalidOperationException` |
| Used after `Dispose` | `ObjectDisposedException` |
| Deliberately unsupported | `NotSupportedException` |
| A domain rule was broken | your own exception type, or a `Result` (see below) |

Modern .NET has one-line **guard helpers** that throw the right type with a good message:

```csharp
try { PlaceOrder(null!, 2); } catch (ArgumentNullException ex) { Console.WriteLine(ex.Message); }
try { PlaceOrder("TEA-01", -1); } catch (ArgumentOutOfRangeException ex) { Console.WriteLine(ex.Message); }

static void PlaceOrder(string sku, int qty)
{
    ArgumentException.ThrowIfNullOrWhiteSpace(sku);
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(qty);
    Console.WriteLine("placed");
}
```

## `throw;` vs `throw ex;` {i}

Inside a `catch` you often log and then pass the exception on. *How* you rethrow decides whether you can still find the bug afterwards:

```csharp
try { Checkout(properRethrow: true); }
catch (Exception ex) { Console.WriteLine($"throw;     trace still shows ChargeCard? {ex.StackTrace!.Contains("ChargeCard")}"); }

try { Checkout(properRethrow: false); }
catch (Exception ex) { Console.WriteLine($"throw ex;  trace still shows ChargeCard? {ex.StackTrace!.Contains("ChargeCard")}"); }

try { Save(); }
catch (Exception ex) { Console.WriteLine($"wrapped:   {ex.Message} ← caused by: {ex.InnerException!.Message}"); }

static void Checkout(bool properRethrow)
{
    try { ChargeCard(); }
    catch (Exception ex)
    {
        // (log it here)
        if (properRethrow) throw;     // ✓ the SAME exception, with its original stack trace
        throw ex;                     // ✗ the stack trace now starts HERE: the real origin is lost
    }
}

static void Save()
{
    try { throw new IOException("disk full"); }
    catch (IOException ex) { throw new InvalidOperationException("Saving order 42 failed", ex); }   // ✓ add context, keep the cause
}

static void ChargeCard() => throw new InvalidOperationException("card declined");
```

- **`throw;`** passes on the same exception with its stack trace untouched.
- **`throw ex;`** treats it as a *new* throw from inside the `catch`, which overwrites the trace. If a stack trace starts somewhere unhelpful, look for a `throw ex;`.
- **Wrapping** (`new X("what we were doing", ex)`) gives a clearer message and keeps the original as `InnerException`.

### Exception filters: decide before unwinding

```csharp
foreach (var status in new[] { 503, 404 })
{
    try { CallSupplier(status); }
    catch (SupplierException ex) when (ex.Status is 429 or 503)       // only transient errors
    {
        Console.WriteLine($"{ex.Status}: transient, so retry later");
    }
    catch (SupplierException ex)
    {
        Console.WriteLine($"{ex.Status}: permanent, so give up");
    }
}

static void CallSupplier(int status) => throw new SupplierException(status);
class SupplierException(int status) : Exception($"HTTP {status}") { public int Status { get; } = status; }
```

A `when` clause runs **before** the stack unwinds, so a non-matching filter leaves the exception untouched for someone else. A filter that logs and returns `false` lets you *observe* an exception without catching it.

:::qa What is the difference between throw and throw ex?
`throw;` rethrows the current exception and preserves its original stack trace. `throw ex;` rethrows the same object but resets the stack trace to the current line, so you lose where it actually failed. To add context, throw a new exception and pass the original as `InnerException`.
:::

:::qa What are exception filters and why are they useful?
`catch (X ex) when (condition)` only catches when the condition is true. The filter runs before the stack unwinds, which preserves the original state for diagnostics, lets non-matching exceptions propagate untouched, and allows logging-only filters that return false.
:::

## Your own exception types {i}

```csharp
try { Reserve("TEA-01", requested: 5, available: 2); }
catch (InsufficientStockException ex) { Console.WriteLine($"[{ex.Code}] {ex.Message} (sku {ex.Sku})"); }

static void Reserve(string sku, int requested, int available)
{
    if (requested > available) throw new InsufficientStockException(sku, requested, available);
}

class DomainException(string code, string message, Exception? inner = null) : Exception(message, inner)
{
    public string Code { get; } = code;
}

sealed class InsufficientStockException(string sku, int requested, int available)
    : DomainException("stock.insufficient", $"Requested {requested} of {sku}, only {available} left")
{
    public string Sku { get; } = sku;
}
```

A short checklist: end the name with `Exception`, derive from `Exception` (not the old `ApplicationException`), and put anything a caller might act on in **typed properties** (`Sku`), not hidden in the message. Map exceptions to HTTP status codes in **one central place** ([Errors & logging](ch:errors-logging)).

## When *not* to throw {i}

Exceptions are for situations the caller couldn't reasonably expect. They're also **slow** (the stack trace has to be captured) and **invisible** in a method's signature. For outcomes that are *normal*, return them instead:

| Normal outcome | Better than throwing |
|---|---|
| The user typed "abc" into a quantity box | `int.TryParse` |
| A lookup might find nothing | `TryGetValue`, or return `null` |
| Validation failed | a validation result |
| "Card declined", "out of stock" | a `Result<T>` (see [CQRS & Result](ch:cqrs-mediator-result#the-result-pattern-making-expected-failure-part-of-the-metho)) |

```csharp
Console.WriteLine(int.TryParse("abc", out var qty) ? $"qty {qty}" : "not a number: ask again");   // no exception

var result = TryReserve("TEA-01", 5);
Console.WriteLine(result.Ok ? "reserved" : $"refused: {result.Error}");

static (bool Ok, string? Error) TryReserve(string sku, int qty) =>
    qty <= 2 ? (true, null) : (false, $"only 2 {sku} left");
```

:::gotcha An empty catch hides the fire
`catch { }` doesn't make a problem go away. It makes it **invisible**, while the bad state keeps doing damage. If you really must ignore an exception, catch the **narrowest** type, add a comment explaining why, and log it anyway.
:::

:::qa When should you not use exceptions?
For expected, frequent outcomes: invalid user input, lookups that miss, validation failures, business rejections. Use Try-methods, nullable returns, validation results or a Result type instead. Exceptions are expensive, invisible in signatures and meant for exceptional or programming errors.
:::

## Exceptions in async code {i}

[Episode 8](ch:async-await) covers `async`, but four exception rules are worth knowing now:

- An exception inside an `async Task` method is **stored inside the returned `Task`**. It's rethrown, with its original stack trace, only when someone **`await`s** that task.
- So if nobody awaits the task, the exception is **never seen**. That's the "fire-and-forget" bug.
- **`async void`** has no `Task` to store the exception in, so an unhandled exception **crashes the process**. Use `async void` only for UI event handlers.
- `await Task.WhenAll(...)` rethrows only the **first** failure. The rest are in `task.Exception.InnerExceptions`.

```csharp norun
var tasks = ids.Select(id => client.GetAsync(id)).ToArray();
try { await Task.WhenAll(tasks); }
catch
{
    foreach (var e in tasks.Where(t => t.IsFaulted).SelectMany(t => t.Exception!.InnerExceptions))
        logger.LogError(e, "One call failed");
    throw;
}
```

Also treat **`OperationCanceledException`** as its own category. A user who closes the browser mid-request isn't an error worth paging anyone about.

:::qa What happens to an exception thrown in an async method?
It's captured in the returned `Task`, which becomes faulted, and it's rethrown with its original stack trace when the task is awaited. If nobody awaits it, the exception goes unobserved. In `async void` methods there's no Task, so the exception is raised directly and can crash the process.
:::

## The cleanup problem: the GC doesn't close things {b}

Back to the leaked database connections. Doesn't .NET have a garbage collector? It does, but the GC frees **memory**, **whenever it decides to**, which could be minutes later. Some resources must be released **right now**:

- database connections (the pool runs dry)
- files, sockets and network streams
- locks, timers and native handles

The contract for "release this now" is **`IDisposable`**, which has one method, `Dispose()`. The keyword that guarantees it gets called is **`using`**. Underneath, `using` is just a `try/finally`: the same "always runs" guarantee you saw in the unwinding diagram.

:::scene visuals/scenes/ex-using.svg | Why the site went down, and the one-word fix
1. The database **connection pool** has 4 open connections that it lends to requests.
2. A checkout borrows one, and then `Charge` throws. `conn.Close()` never runs, so that connection is **never returned**.
3. Another failed checkout leaks another one.
4. After a few more, the pool is **empty**. Every request on the site now waits for a connection, then fails with "Timeout expired obtaining a connection". The site is down because of a payment glitch.
5. With **`using`**, the compiler wraps the code in `try { … } finally { conn.Dispose(); }`. The connection goes back on **every** path out: success, early return or exception.
:::

```csharp
var pool = new Pool(size: 3);

for (int i = 1; i <= 4; i++)
{
    try { CheckoutLeaky(pool); } catch (Exception ex) { Console.WriteLine($"  leaky #{i} failed: {ex.Message}"); }
    Console.WriteLine($"  pool: {pool.Free} free");
}

pool = new Pool(size: 3);
for (int i = 1; i <= 4; i++)
{
    try { CheckoutSafe(pool); } catch (Exception ex) { Console.WriteLine($"  safe #{i} failed: {ex.Message}"); }
    Console.WriteLine($"  pool: {pool.Free} free");
}

static void CheckoutLeaky(Pool pool)
{
    var conn = pool.Open();
    ChargeCard();                // throws
    conn.Dispose();              // never reached
}

static void CheckoutSafe(Pool pool)
{
    using var conn = pool.Open();   // disposed at the end of the method, whatever happens
    ChargeCard();
}

static void ChargeCard() => throw new InvalidOperationException("card provider timeout");

class Pool(int size)
{
    public int Free { get; private set; } = size;
    public Connection Open()
    {
        if (Free == 0) throw new TimeoutException("Timeout expired obtaining a connection");
        Free--;
        return new Connection(() => Free++);
    }
}

sealed class Connection(Action giveBack) : IDisposable
{
    private bool _disposed;
    public void Dispose() { if (_disposed) return; _disposed = true; giveBack(); }
}
```

The three forms you'll see:

```csharp norun
using (var conn = new SqlConnection(cs)) { /* … */ }     // classic block: disposed at the closing brace
using var file = File.OpenRead(path);                     // declaration (C# 8): disposed at the end of the scope
await using var db = await factory.CreateDbContextAsync(); // async disposal (IAsyncDisposable)

// what `using var x = …;` compiles into:
var x = new Resource();
try { /* rest of the scope */ }
finally { x?.Dispose(); }
```

:::fits Who disposes what in ASP.NET Core
**Don't dispose things the DI container gave you.** The container disposes scoped services (like `DbContext`) when the request ends, and singletons at shutdown ([DI](ch:dependency-injection#who-disposes-what)). You dispose only what **you** created with `new` or a factory.
:::

:::qa What is IDisposable and why does .NET need it if it has a garbage collector?
The GC reclaims memory non-deterministically. It doesn't promptly release connections, file handles, sockets, locks or native resources. `IDisposable.Dispose()` releases them deterministically, and `using` guarantees the call even when an exception is thrown.
:::

:::qa How does `using` work under the hood?
The compiler turns it into a try/finally that calls `Dispose()` (null-checked) in the finally block. A `using` declaration disposes at the end of the enclosing scope. `await using` calls `DisposeAsync()` and awaits it.
:::

:::qa Who disposes services created by the DI container?
The container does. Scoped and transient disposables are disposed when their scope ends (the request), and singletons when the root provider is disposed at shutdown. You shouldn't dispose injected services yourself. Dispose only what you create.
:::

## Implementing IDisposable yourself {i}

If your class *holds* other disposables (a file, a timer), it should be disposable too, and pass the `Dispose` on:

```csharp
using (var export = new ReportExporter())
{
    export.Write("order 42");
}                                                    // Dispose runs here
var again = new ReportExporter(); again.Dispose(); again.Dispose();   // twice is safe
try { again.Write("late"); } catch (ObjectDisposedException) { Console.WriteLine("used after dispose: refused"); }

sealed class ReportExporter : IDisposable
{
    private readonly MemoryStream _file = new();     // stands in for a FileStream
    private bool _disposed;

    public void Write(string line)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _file.Write(System.Text.Encoding.UTF8.GetBytes(line));
        Console.WriteLine($"wrote: {line}");
    }

    public void Dispose()
    {
        if (_disposed) return;      // must be safe to call more than once
        _file.Dispose();
        _disposed = true;
        Console.WriteLine("disposed");
    }
}
```

### The full pattern, with a finalizer (rarely needed) {a}

Only needed when your class **directly owns an unmanaged resource**, such as a raw `IntPtr` handle. Even then, prefer wrapping it in a `SafeHandle`, which does this for you.

```csharp norun
public class NativeBuffer : IDisposable
{
    private IntPtr _ptr = Marshal.AllocHGlobal(1024);
    private bool _disposed;

    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);      // cleaned up already, so the finalizer can be skipped
    }

    protected virtual void Dispose(bool disposing)
    {
        if (_disposed) return;
        if (disposing) { /* dispose other MANAGED objects: only safe on this path */ }
        Marshal.FreeHGlobal(_ptr);      // free the UNMANAGED resource on both paths
        _disposed = true;
    }

    ~NativeBuffer() => Dispose(disposing: false);   // the finalizer: a safety net if someone forgot
}
```

The `disposing` flag says *who called*. `true` means your code called `Dispose()`, so it's safe to touch other objects. `false` means the GC's finalizer called it, and other managed objects may already be gone. `SuppressFinalize` matters because objects with pending finalizers survive an extra GC cycle ([Memory & GC](ch:memory-gc#finalizers-the-gcs-last-resort-and-why-its-slow)).

:::qa Explain the Dispose pattern. When do you need a finalizer?
A public `Dispose()` calls `Dispose(true)` and `GC.SuppressFinalize(this)`. A protected virtual `Dispose(bool disposing)` frees managed resources only when `disposing` is true, and unmanaged ones on both paths. You only need a finalizer if the class directly owns an unmanaged resource, and usually a `SafeHandle` is better. Classes that only wrap managed disposables need just a simple `Dispose()`.
:::

### IAsyncDisposable: cleanup that needs to await

Some cleanup does I/O itself, like flushing a buffer to the network. `Dispose()` can't `await`, so there's `IAsyncDisposable` with `DisposeAsync()`, and `await using` to call it. `DbContext`, `Stream` and `SqlConnection` all support it. Prefer `await using` where a type offers it.

```csharp norun
public sealed class BlobBatchWriter : IAsyncDisposable
{
    public async ValueTask DisposeAsync() { await FlushAsync(); await _stream.DisposeAsync(); }
}
await using var writer = new BlobBatchWriter();
```

## Common disposal mistakes {i}

| Mistake | What happens | Fix |
|---|---|---|
| `new HttpClient()` per request | Socket exhaustion | `IHttpClientFactory` ([HttpClient](ch:http-client)) |
| Not disposing a connection you opened | The pool runs dry, and the site times out (this episode!) | `await using` |
| Returning a lazy `IEnumerable` from inside `using` | `ObjectDisposedException` when the caller loops | `.ToList()` before the scope ends |
| Disposing something DI gave you | Others receive a disposed object | Let the container own it |
| Keeping a scoped disposable in a singleton | Used after the request disposed it | `IServiceScopeFactory` ([DI](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug)) |
| Not disposing `CancellationTokenSource`, `Timer`, `SemaphoreSlim` | Leaked timers and handles | `using` |

## Next episode {b}

Checkout now fails cleanly and never leaks a connection. Then comes **Black Friday**. Traffic is 20 times normal and the site freezes, yet the server's CPU sits at 5%. A memory dump shows hundreds of threads, every one of them *waiting* for the payment API to reply. The server isn't busy. It's **stuck waiting**: [Episode 8 · Async/await →](ch:async-await)

## Further reading

- [Exceptions and exception handling](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/exceptions/)
- [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions)
- [Implement a Dispose method](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose)
- [Implement a DisposeAsync method](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync)

## Verify this chapter

```csharp
var log = new List<string>();

// finally runs during unwinding; the first matching catch stops it
try { Outer(log); } catch (InvalidOperationException) { log.Add("caught"); }
Check(string.Join(",", log) == "inner-finally,outer-finally,caught", "finally blocks run while unwinding, before the catch");

// throw; keeps the original stack trace, throw ex; resets it
Check(Trace(true).Contains("Boom"), "throw; preserves the original stack trace");
Check(!Trace(false).Contains("Boom"), "throw ex; resets the stack trace");

// filters
bool handled = false;
try { throw new ArgumentException("x"); } catch (Exception ex) when (ex is ArgumentException) { handled = true; }
Check(handled, "a when filter selects which exceptions to catch");

// using disposes even when an exception is thrown
var r = new Res();
try { using (r) { throw new Exception(); } } catch { }
Check(r.Disposed, "using disposes even when the body throws");

static void Outer(List<string> log) { try { Inner(log); } finally { log.Add("outer-finally"); } }
static void Inner(List<string> log) { try { throw new InvalidOperationException(); } finally { log.Add("inner-finally"); } }
static void Boom() => throw new InvalidOperationException();
static string Trace(bool proper)
{
    try { try { Boom(); } catch (Exception ex) { if (proper) throw; throw ex; } }
    catch (Exception ex) { return ex.StackTrace ?? ""; }
    return "";
}
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

class Res : IDisposable { public bool Disposed; public void Dispose() => Disposed = true; }
```
