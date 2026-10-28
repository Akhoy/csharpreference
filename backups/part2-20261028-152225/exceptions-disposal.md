---
id: exceptions-disposal
title: Exceptions, Error Handling and Resource Disposal
summary: How exceptions work, the hierarchy, try/catch/finally and filters, rethrowing correctly, custom exceptions, when not to throw, and deterministic cleanup with IDisposable, using, IAsyncDisposable and finalizers.
layer: language
where: C# language › Errors & resources
fits: Layer 1 mechanics that layer 3 builds on. ASP.NET Core turns unhandled exceptions into HTTP responses ([Errors & logging](ch:errors-logging)), the Result pattern ([CQRS & Result](ch:cqrs-mediator-result)) is the architectural alternative for expected failures, and disposal is how DbContext and HttpClient release connections.
levels: b,i,a
prereqs: oop
next: errors-logging, async-await, cqrs-mediator-result
---

## TL;DR

- Throwing an exception stops normal execution and **unwinds the call stack** looking for a matching `catch`, running every `finally` along the way.
- Pick the exception type from the standard hierarchy (`ArgumentException`, `InvalidOperationException`, ...) so callers can tell failures apart without parsing message strings.
- `throw;` keeps the original stack trace; `throw ex;` resets it — always prefer `throw;` or wrap in a new exception.
- Exceptions are for the unexpected. For routine "might not work" outcomes (parsing, lookups, validation), prefer `TryParse`-style patterns or a `Result<T>` instead.
- `IDisposable`/`using` give you **deterministic** cleanup (close this connection *now*) that the garbage collector, which runs on its own schedule, can't give you.
- In async code, an exception lives inside the `Task` until something `await`s it — if nothing ever does, it's silently lost.

## What actually happens when code throws {b}

An **exception** is an object — always deriving from `System.Exception` — that represents an error. The moment code **throws** one, normal execution stops dead, right there, and the runtime starts **unwinding the call stack**: walking back up through method after method, looking for a `catch` block whose type matches the exception, running any `finally` block it passes along the way regardless of whether it finds a match yet. If it unwinds all the way to the top of the call stack without finding anything, the thread terminates — though in ASP.NET Core specifically, you almost never see that happen, because the framework's own exception-handling middleware sits near the top of the pipeline and catches it first, turning it into a 500 response instead of a crash.

```csharp
try
{
    var order = await repo.GetAsync(id) ?? throw new NotFoundException($"Order {id}");
    order.Cancel();                    // may throw InvalidOperationException
    await uow.SaveChangesAsync();
}
catch (NotFoundException)              // most specific first
{
    return Results.NotFound();
}
catch (DbUpdateConcurrencyException ex)
{
    logger.LogWarning(ex, "Concurrency conflict on order {Id}", id);
    return Results.Conflict();
}
finally
{
    metrics.RecordAttempt();           // ALWAYS runs: success, exception, or early return
}
```

That `finally` block is worth noting precisely: it runs on **every** path out of the `try` — a clean success, a caught exception, an uncaught one still unwinding past it, even an early `return` from inside the `try`. There's no way to leave this method, through any route, without `metrics.RecordAttempt()` running.

An exception object carries a handful of properties worth knowing by name: `Message`, `StackTrace`, `InnerException` (the underlying cause, when one exception is deliberately wrapped around another), `Data` (a bag for extra key/value context), `HResult`, and `ToString()`, which — unlike `Message` alone — prints the *entire* picture, inner exceptions included. That last point matters enough to call out as a rule: always log the **exception object itself**, never just its `.Message` string — you lose the stack trace, the inner exception chain, and everything else that actually helps you find the bug, for the sake of a shorter log line.

## The exception hierarchy: a map for picking the right one {b}

```text
System.Exception
├── SystemException
│   ├── ArgumentException
│   │   ├── ArgumentNullException
│   │   └── ArgumentOutOfRangeException
│   ├── InvalidOperationException
│   │   └── ObjectDisposedException
│   ├── NullReferenceException          ← a bug; never throw or catch it deliberately
│   ├── IndexOutOfRangeException
│   ├── InvalidCastException
│   ├── FormatException
│   ├── NotSupportedException / NotImplementedException
│   ├── IOException → FileNotFoundException …
│   ├── OperationCanceledException → TaskCanceledException
│   ├── TimeoutException
│   ├── OutOfMemoryException, StackOverflowException   ← can't be meaningfully handled
│   └── …
├── HttpRequestException, JsonException, DbException → SqlException …
└── AggregateException                  ← wraps several (Task.Wait, Parallel)
```

Picking the right exception type to throw isn't just etiquette — it's how callers further up the stack can actually distinguish "bad input" from "wrong state" from "not found" without parsing your message string. Microsoft's own framework design guidelines boil down to a short, memorable table:

| Situation | Throw |
|---|---|
| A bad argument | `ArgumentException` / `ArgumentNullException` / `ArgumentOutOfRangeException` |
| Object is in the wrong state for this call | `InvalidOperationException` |
| Called after Dispose | `ObjectDisposedException` |
| Operation intentionally unsupported | `NotSupportedException` |
| A domain rule violated | A custom exception (`DomainException`), or a Result instead |

Modern .NET ships static guard helpers specifically so you don't have to hand-write the same `if (x is null) throw new ArgumentNullException(...)` boilerplate a thousand times: `ArgumentNullException.ThrowIfNull(x)`, `ArgumentException.ThrowIfNullOrWhiteSpace(s)`, `ArgumentOutOfRangeException.ThrowIfNegative(n)`, `ObjectDisposedException.ThrowIf(_disposed, this)` — each one throws the exact right type from that table, with a correctly populated message, in a single line.

## throw; vs throw ex; — one character of difference, one real consequence {i}

```csharp
catch (Exception ex)
{
    logger.LogError(ex, "Payment failed");
    throw;                     // ✔ rethrows the SAME exception, stack trace preserved
}

catch (Exception ex)
{
    throw ex;                  // ✘ resets the stack trace to this line: you lose where it really failed
}

catch (SqlException ex)
{
    throw new RepositoryException("Saving order failed", ex);  // ✔ wrap with context, keep the cause as InnerException
}
```

These two lines look almost interchangeable, but the difference has cost real debugging time. A bare `throw;` rethrows the **exact same exception object** with its stack trace untouched — it still points at the original line where it actually failed. `throw ex;` throws the same *object*, but the runtime treats it as a **new** throw happening right here, so the trace gets overwritten to point at this `catch` block, and the real origin is lost. If a stack trace starts somewhere suspiciously unhelpful, `throw ex;` upstream is a common culprit.

The third block shows a deliberate third option: **wrapping**. `throw new RepositoryException("Saving order failed", ex)` throws a brand-new exception with its own fresh stack trace, while keeping the original as `InnerException`. Do this when the original exception wouldn't mean much to whoever reads it later — a raw `SqlException` is less useful three layers up than a `RepositoryException` that says what you were trying to do, with the `SqlException` still attached underneath for anyone who needs it.

### Exception filters: deciding whether to catch, without unwinding first

```csharp
catch (HttpRequestException ex) when (ex.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable)
{
    // only transient errors handled here; others propagate untouched
}

catch (Exception ex) when (LogAndReturnFalse(ex)) { }   // log without catching (filter returns false)
```

A `when (condition)` clause changes *when* the stack unwinds. Without a filter, the runtime has to unwind the stack — tearing down frames, running `finally` blocks — just to get inside the `catch` body and check whether you actually wanted this exception. With a filter, the condition runs **before** any of that, while the exception is still sitting where it was thrown, full original state intact. That helps diagnostics, but the more useful trick is the second example: a filter that returns `false` after logging lets you **observe** an exception without catching it — it keeps propagating to whatever would have handled it anyway.

One narrower tool: `ExceptionDispatchInfo.Capture(ex).Throw()` rethrows an exception caught somewhere else entirely (another thread, say) while preserving *its* original stack trace — the same guarantee `throw;` gives locally. You'll rarely write this by hand; `await` already does it for you, as the async section below explains.

## Writing your own exception types {i}

```csharp
public class DomainException : Exception
{
    public string Code { get; }
    public DomainException(string code, string message, Exception? inner = null) : base(message, inner) => Code = code;
}

public sealed class InsufficientStockException(string sku, int requested, int available)
    : DomainException("stock.insufficient", $"Requested {requested} of {sku}, only {available} available")
{
    public string Sku { get; } = sku;
}
```

A short checklist: name it ending in `Exception`; derive from `Exception` directly, never the legacy `ApplicationException`; include the standard constructors so callers can wrap or rethrow it; add real, typed properties for anything a caller might need to act on (`Sku` above, not buried in the message string); and keep the message genuinely useful to whoever reads the log. Map your custom exceptions to HTTP status codes in exactly **one** central place ([Errors & logging](ch:errors-logging) shows how), rather than scattering `catch` blocks that each decide independently.

## When *not* to reach for an exception at all {i}

Exceptions exist for **exceptional** situations — things the caller couldn't reasonably have prevented, or wouldn't expect as part of normal flow. They're also mechanically **expensive**: capturing a full stack trace and unwinding through it costs real time compared to an ordinary return. And they're **invisible in a method's signature** — nothing about `Task<Order> PlaceAsync(...)` tells a caller it might throw five different exception types under entirely normal conditions.

| Expected outcome | Better than throwing |
|---|---|
| Parsing user input | `int.TryParse`, `DateTime.TryParseExact` |
| Lookup might miss | `TryGetValue`, return `null` / `T?` |
| Validation failure | Validation result (FluentValidation, `ValidationProblem`) |
| Business rule rejection ("card declined", "out of stock") | `Result<T>` / `OneOf` / discriminated union style return |

```csharp
// Try-pattern: the BCL convention for "might fail, that's normal"
public bool TryReserve(string sku, int qty, [NotNullWhen(true)] out Reservation? reservation) { /* ... */ }
```

The **Try-pattern** above is the BCL's long-standing answer: a `bool` return that costs nothing when the "failure" is routine, with the actual result handed back through an `out` parameter only on success. "Exceptions vs the Result pattern" is a genuinely live architectural debate — [CQRS, Mediator & Result](ch:cqrs-mediator-result#the-result-pattern-making-expected-failure-part-of-the-metho) walks through where each one earns its place.

:::gotcha An empty catch block is one of the most dangerous things you can write
`catch { }` or `catch (Exception) { }` with nothing inside doesn't make a problem go away — it just makes it **invisible**, while whatever bad state caused the exception quietly persists and keeps causing damage somewhere downstream, with no record anywhere that anything went wrong. If you genuinely, deliberately need to ignore a specific exception, catch the *narrowest* type that actually applies, leave a comment explaining exactly why ignoring it is correct here, and log it anyway — "ignored, and silent" is almost never the behaviour you actually want, even when "ignored" genuinely is.
:::

## Exceptions in async code behave differently from what you'd expect {i}

A quick preview before [Async/await](ch:async-await) covers `Task` and `await` properly: a `Task` is an object representing work that finishes later, and `await` is how you wait for it without blocking a thread. Even without the full chapter, the exception mechanics below are worth knowing, because they genuinely diverge from synchronous exception handling:

- An exception thrown inside an `async Task` method isn't thrown immediately — it's **captured and stored inside the returned `Task`**. It only surfaces, rethrown with its original stack trace preserved, the moment someone `await`s that `Task`. (This is the same mechanism as the `ExceptionDispatchInfo` trick above: `await` does that rethrow-with-preserved-trace for you automatically.)
- Follow that through: if nobody ever `await`s the `Task`, its exception is simply **never observed**. This is how "fire-and-forget" bugs happen — code that looks like it's handling errors but is actually losing them quietly.
- `async void` methods break this pattern entirely: there's no `Task` to store an exception in. The exception is raised directly on the synchronization context or thread pool, and with nothing there to catch it, it **crashes the entire process**. This is the real reason `async void` is reserved for event handlers (the one place the signature is forced on you) and avoided everywhere else.
- `Task.WhenAll` over several tasks rethrows only the **first** exception it hits when you `await` the combined result — but every exception from every failed task is still there, in `task.Exception.InnerExceptions`, if you need the full picture.
- Cancellation has its own exception type, `OperationCanceledException` (or its cousin `TaskCanceledException`), worth treating as a different *category* from a real error: a client disconnecting mid-request is normal, not a bug, so logging it at `Error` level every time just buries real errors in noise.

```csharp
var tasks = ids.Select(id => client.GetAsync(id)).ToArray();
try { await Task.WhenAll(tasks); }
catch
{
    var all = tasks.Where(t => t.IsFaulted).SelectMany(t => t.Exception!.InnerExceptions);
    foreach (var e in all) logger.LogError(e, "One call failed");
    throw;
}
```

The `catch` block here isn't really handling the exception `Task.WhenAll` rethrew — it's using that as a signal to dig through *every* task's own exception, log each failure individually (since `WhenAll` alone would only surface the first), then `throw;` to propagate the original failure once everything is recorded.

## Resources and IDisposable: the problem the GC doesn't solve {b}

The GC, as [Memory & GC](ch:memory-gc) covered in detail, frees **memory** — but it does so whenever it decides to, on its own schedule, which could be anywhere from microseconds to minutes after an object becomes unreachable. Some resources genuinely can't wait that long and need releasing **now**, deterministically, the moment you're done with them:

- database connections (which need to return to a pool promptly, or the pool runs dry)
- file handles, sockets, network streams
- locks, semaphores, timers
- native memory and OS handles

The contract that makes "release this now, deterministically" possible is **`IDisposable`**:

```csharp
public interface IDisposable { void Dispose(); }
```

And the **`using`** statement is what guarantees `Dispose()` actually gets called, even when an exception is thrown partway through — because, as the final block below shows, it compiles directly into a `try`/`finally`, the exact same construct that guaranteed the `finally` block ran in the very first example of this chapter:

```csharp
using (var conn = new SqlConnection(cs))      // classic form
{
    conn.Open();
    // ...
}                                              // conn.Dispose() here

using var file = File.OpenRead(path);          // C# 8 using declaration: disposed at end of enclosing scope
await using var db = await factory.CreateDbContextAsync();   // IAsyncDisposable

// What the compiler generates for `using var x = ...;`
var x = new Resource();
try { /* rest of scope */ }
finally { x?.Dispose(); }
```

:::fits Who's actually responsible for disposing what, in ASP.NET Core
A rule worth having precisely, because getting it wrong in either direction causes real bugs: you usually **don't** call `Dispose` on anything the DI container handed you. [Dependency injection](ch:dependency-injection#who-disposes-what) covers this in full, but the short version is that the container disposes scoped services — `DbContext` among them — the moment the request's scope ends, and disposes singletons at app shutdown. You only ever dispose what **you** personally created with `new` or a factory call — resources the container never knew existed in the first place.
:::

## Implementing IDisposable yourself {i}

For a class that only wraps **other already-managed disposables** — no raw native handles of its own — this simple version is enough; you don't need the full ceremony in the next section:

```csharp
public sealed class ReportExporter : IDisposable
{
    private readonly FileStream _file;
    private readonly Timer _timer;
    private bool _disposed;

    public ReportExporter(string path) { _file = File.Create(path); _timer = new Timer(Flush, null, 1000, 1000); }

    public void Write(string line)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        // ...
    }

    public void Dispose()
    {
        if (_disposed) return;      // Dispose must be safe to call multiple times
        _timer.Dispose();
        _file.Dispose();
        _disposed = true;
    }
}
```

The `if (_disposed) return;` guard at the top of `Dispose()` exists because `Dispose` must be **safe to call more than once**. Code elsewhere might legitimately call it twice (an explicit call, then a `using` block's automatic call on the same object), and without the guard, calling `_file.Dispose()` a second time could itself throw.

### The full Dispose pattern, with a finalizer — only when you genuinely need one {a}

You only need this heavier version when your class **directly owns an unmanaged resource** — a raw native handle or `IntPtr`, not another managed `IDisposable` wrapping one. Even then, prefer wrapping that handle in a `SafeHandle`, which already implements the finalizer correctly for you, so you never have to write one by hand:

```csharp
public class NativeBuffer : IDisposable
{
    private IntPtr _ptr = Marshal.AllocHGlobal(1024);
    private bool _disposed;

    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);       // finalizer no longer needed: saves the GC work
    }

    protected virtual void Dispose(bool disposing)
    {
        if (_disposed) return;
        if (disposing) { /* dispose MANAGED disposables here */ }
        Marshal.FreeHGlobal(_ptr);       // free UNMANAGED resources in both paths
        _ptr = IntPtr.Zero;
        _disposed = true;
    }

    ~NativeBuffer() => Dispose(disposing: false);   // safety net if someone forgot to Dispose
}
```

The `disposing` boolean does real work. `Dispose(bool)` can be called from two different situations: a normal `Dispose()` call (`disposing: true`, where it's safe to also touch other *managed* objects), or the finalizer running as a last-resort safety net (`disposing: false`, where other managed objects might already be collected, so only the unmanaged pointer is guaranteed to still be valid). `GC.SuppressFinalize(this)` matters too: once `Dispose()` has already cleaned up, the finalizer doesn't need to run — and skipping it is worth doing, because an object with a *pending* finalizer gets promoted a generation early and survives an extra GC cycle (see [Memory & GC](ch:memory-gc#finalizers-the-gcs-last-resort-and-why-its-slow)).

### IAsyncDisposable: for cleanup that itself needs to be awaited

```csharp
public sealed class BlobBatchWriter : IAsyncDisposable
{
    public async ValueTask DisposeAsync() { await FlushAsync(); await _stream.DisposeAsync(); }
}
await using var writer = new BlobBatchWriter(...);
```

Some cleanup involves I/O of its own — flushing a stream to the network, closing a database connection gracefully — and a plain synchronous `Dispose()` has no way to `await` anything inside it. `IAsyncDisposable` exists for exactly this, and `await using` is its counterpart to `using`: same `try`/`finally` shape, but calling `DisposeAsync()` instead. `DbContext`, `Stream`, `SqlConnection`, DI scopes and `Utf8JsonWriter` all implement it — prefer `await using` over plain `using` wherever a type offers it.

## Common disposal mistakes {i}

| Mistake | Consequence | Fix |
|---|---|---|
| `new HttpClient()` per request inside `using` | Socket exhaustion (sockets in TIME_WAIT) | `IHttpClientFactory`; see [HttpClient](ch:http-client) |
| Forgetting to dispose a `SqlConnection` you created | Connection pool exhaustion: "Timeout expired obtaining a connection" | `await using` |
| Returning a lazy `IEnumerable` from inside a `using` block | `ObjectDisposedException` when the caller enumerates | Materialise before the scope ends |
| Disposing something injected by DI | Other consumers get a disposed object | Let the container own it |
| Storing a scoped `IDisposable` in a singleton | Used after the request scope disposed it | `IServiceScopeFactory`; see [DI](ch:dependency-injection) |
| Not disposing `CancellationTokenSource`, `Timer`, `SemaphoreSlim` | Leaked timers / handles | `using` |

"Disposing something injected by DI" and "storing a scoped `IDisposable` in a singleton" are the same underlying bug in different clothes: both are the **captive dependency** problem from [Dependency injection](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug) — an object outliving, or being disposed independently of, the scope meant to own its lifetime.

:::qa What is the difference between throw and throw ex?
`throw;` rethrows the current exception and preserves its original stack trace. `throw ex;` throws the same object but resets the stack trace to the current line, so you lose where the error originated. Wrap with `throw new X("context", ex)` when adding information.
:::

:::qa What are exception filters and why are they useful?
A `when (condition)` clause on a catch. The condition is evaluated before the stack unwinds, so if it's false the exception continues untouched with its full original state (good for diagnostics), and you can catch selectively (only certain status codes, for example) without catch-and-rethrow.
:::

:::qa When should you not use exceptions?
For expected outcomes: parsing input, lookups that may miss, validation failures and business rule rejections. Use Try-patterns, nullable returns, validation results or a Result type instead. Exceptions are costly and invisible in signatures; keep them for unexpected failures.
:::

:::qa What happens to an exception thrown in an async method?
It's captured in the returned Task and rethrown when the Task is awaited, with its original stack trace preserved. If the Task is never awaited, the exception goes unobserved. In async void methods, there's no Task, so the exception crashes the process.
:::

:::qa What is IDisposable and why does .NET need it if it has a garbage collector?
The GC only manages memory and runs non-deterministically. IDisposable gives deterministic release of other resources (connections, handles, sockets, locks) at a known point, typically via using / await using, which compile to try/finally.
:::

:::qa Explain the Dispose pattern. When do you need a finalizer?
Implement Dispose() to release resources, make it idempotent, and throw ObjectDisposedException afterwards. The full pattern with Dispose(bool) and a finalizer is only needed when the class directly owns unmanaged resources; Dispose() then calls Dispose(true) and GC.SuppressFinalize(this). Prefer SafeHandle so you never need your own finalizer.
:::

:::qa Who disposes services created by the DI container?
The container. Scoped services are disposed when their scope (the HTTP request) ends; singletons when the root provider is disposed at shutdown; transients when their owning scope ends. Don't dispose injected dependencies yourself.
:::

:::qa How does `using` work under the hood?
It compiles to a try/finally block that calls Dispose (or DisposeAsync for await using) in the finally, with a null check, so the resource is released even if an exception is thrown or the method returns early.
:::

## Further reading

- [Exceptions and exception handling](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/exceptions/)
- [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions)
- [Implement a Dispose method](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose)

## Verify this chapter

Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`. It checks `finally` semantics, `throw;` vs `throw ex;` stack traces, exception filters, wrapped exceptions, `using`/`await using` disposal (including idempotent `Dispose`), and how exceptions behave inside async `Task`s. The compiler will warn about `throw ex;` (CA2200) — that warning is itself the chapter's point, so it's expected here.

```csharp
int failures = 0;
void Check(string claim, bool ok)
{
    if (ok) Console.WriteLine($"OK: {claim}");
    else { Console.WriteLine($"FAIL: {claim}"); failures++; }
}

// 1. finally runs on both the success path and the exception path
bool finallyRanOnSuccess = false, finallyRanOnException = false;
try { } finally { finallyRanOnSuccess = true; }
try { try { throw new InvalidOperationException(); } finally { finallyRanOnException = true; } }
catch (InvalidOperationException) { }
Check("finally runs on the success path", finallyRanOnSuccess);
Check("finally runs when an exception is thrown", finallyRanOnException);

// 2. throw; preserves the original stack trace; throw ex; resets it
string ReThrowProperly()
{
    try { ThrowsDeep(); return ""; }
    catch (Exception ex) { try { throw; } catch (Exception e2) { return e2.StackTrace ?? ""; } }
}
string ReThrowBadly()
{
    try { ThrowsDeep(); return ""; }
    catch (Exception ex) { try { throw ex; } catch (Exception e2) { return e2.StackTrace ?? ""; } }
}
static void ThrowsDeep() => throw new InvalidOperationException("boom");

var properTrace = ReThrowProperly();
var badTrace = ReThrowBadly();
Check("throw; keeps ThrowsDeep in the stack trace (original origin preserved)", properTrace.Contains("ThrowsDeep"));
Check("throw ex; loses ThrowsDeep from the stack trace (origin overwritten)", !badTrace.Contains("ThrowsDeep"));

// 3. Exception filters (when) catch selectively without catching everything
bool caughtSpecific = false, propagatedOthers = false;
try
{
    try { throw new InvalidOperationException("transient"); }
    catch (InvalidOperationException ex) when (ex.Message == "transient") { caughtSpecific = true; }
}
catch { }
try
{
    try { throw new InvalidOperationException("permanent"); }
    catch (InvalidOperationException ex) when (ex.Message == "transient") { }
}
catch (InvalidOperationException) { propagatedOthers = true; }
Check("a catch filter (when) catches only matching exceptions", caughtSpecific);
Check("a catch filter lets non-matching exceptions keep propagating", propagatedOthers);

// 4. Custom exception carries InnerException
var inner = new InvalidOperationException("low level");
var wrapped = new RepositoryException("Saving order failed", inner);
Check("a wrapped custom exception keeps the original as InnerException", wrapped.InnerException == inner);

// 5. using calls Dispose even when the body throws
var resource = new TrackedResource();
try { using (resource) { throw new InvalidOperationException(); } }
catch (InvalidOperationException) { }
Check("using calls Dispose even when the body throws", resource.Disposed);

// 6. Dispose is safe to call more than once
var resource2 = new TrackedResource();
resource2.Dispose();
Exception? thrown = null;
try { resource2.Dispose(); } catch (Exception ex) { thrown = ex; }
Check("Dispose is idempotent: calling it twice doesn't throw", thrown is null);

// 7. await using calls DisposeAsync
var asyncResource = new TrackedAsyncResource();
await using (asyncResource) { }
Check("await using calls DisposeAsync when the scope ends", asyncResource.Disposed);

// 8. An exception in an async Task method is stored, not thrown, until awaited
var faultedTask = FailAsync();
await Task.Delay(10); // give it time to complete
Check("an exception inside an async Task is captured in the Task, not thrown immediately", faultedTask.IsFaulted);
bool observedOnAwait = false;
try { await faultedTask; } catch (InvalidOperationException) { observedOnAwait = true; }
Check("awaiting a faulted Task rethrows the captured exception", observedOnAwait);

// 9. Task.WhenAll rethrows only the first exception, but all are in task.Exception
var t1 = FailAsync();
var t2 = FailAsync();
try { await Task.WhenAll(t1, t2); } catch { }
Check("Task.WhenAll's await only surfaces one exception, but both tasks' exceptions are available via .Exception",
    t1.Exception!.InnerExceptions.Count == 1 && t2.Exception!.InnerExceptions.Count == 1);

Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
if (failures > 0) Environment.Exit(1);

static async Task FailAsync()
{
    await Task.Yield();
    throw new InvalidOperationException("async failure");
}

class RepositoryException(string message, Exception inner) : Exception(message, inner) { }

class TrackedResource : IDisposable
{
    public bool Disposed { get; private set; }
    public void Dispose() { Disposed = true; } // idempotent by construction: nothing to double-free
}

class TrackedAsyncResource : IAsyncDisposable
{
    public bool Disposed { get; private set; }
    public ValueTask DisposeAsync() { Disposed = true; return ValueTask.CompletedTask; }
}
```

Not runtime-verifiable here: `async void` crashing the process can't be safely demonstrated inside a program that also needs to keep running and report its other results — crashing it is the entire point. Take that one on trust from [Further reading](#further-reading) or trigger it deliberately in a throwaway project.
