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

## Words you'll meet

| Word | In plain words |
|---|---|
| **exception** | An object describing something that went wrong. *Throwing* it stops normal execution. |
| **catch** | A block that says "I'll handle this kind of exception". |
| **finally** | A block that always runs on the way out, whether things worked or not. |
| **unwinding** | The runtime walking back through the callers, looking for a matching `catch`. |
| **stack trace** | The record of which methods the exception passed through: your best clue for debugging. |
| **inner exception** | The original exception, kept inside a new one that adds context. |
| **`IDisposable` / `Dispose()`** | The standard "release this right now" method, for files, connections and locks. |
| **`using`** | Makes sure `Dispose()` is called, even if an exception is thrown. |
| **finalizer** | A last-resort cleanup the GC runs if someone forgot to dispose. Slow; rarely needed. |
| **connection pool** | A fixed set of open database connections that requests borrow and must give back. |

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

That's what made the afternoon so confusing. The alerts said "database timeout" on the product pages, the search and the login. The database itself was fine and nearly idle. The real cause was a payment provider having a bad hour, three calls away, in code nobody was looking at.

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

:::walk A failed payment, unwinding
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
@1 | call stack = Checkout
Start at the top.
@5 | call stack = Checkout → PlaceOrder
`Checkout` calls `PlaceOrder` inside a `try`. Each call adds a **frame** to the call stack.
@16 | call stack = Checkout → PlaceOrder | > 1. stock reserved
`PlaceOrder` reserves stock. Its own `try` has a `finally` but no `catch`.
@17 | call stack = Checkout → PlaceOrder → ChargeCard
Call `ChargeCard`.
@28 | call stack = Checkout → PlaceOrder → ChargeCard | > 2. charging card... provider timed out
@29 | call stack = Checkout → PlaceOrder → ChargeCard ; exception = PaymentFailedException
`throw` creates an exception object and **stops normal execution**. Now the runtime walks back down the stack, asking each frame "do you have a matching `catch`?".
@18 | call stack = Checkout → PlaceOrder ; exception = PaymentFailedException
`ChargeCard` has no `catch`, so its frame is torn down. Back in `PlaceOrder`, line 18 is **skipped**: execution never resumes mid-`try` after a throw.
@22 | call stack = Checkout → PlaceOrder ; exception = PaymentFailedException | > 3. finally: stock released (runs even though nobody caught it yet)
`PlaceOrder` has no matching `catch` either, but it has a `finally`. That **always runs** on the way out, so the stock is released. Then this frame is torn down too.
@6 | call stack = Checkout ; exception = PaymentFailedException
`Checkout` has `catch (PaymentFailedException ex)`, and the type matches. The unwinding stops here.
@8 | call stack = Checkout | > 4. Checkout caught it: card provider timeout. Ask for another card.
The exception is handled, and the program carries on normally after the `catch`. The error was handled two frames up from where it happened, by the code that knew what to do about it.
:::

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

:::walk Guards that throw the right type for you
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
@4-9 | -
Two guard lines at the top of the method check the arguments before anything happens.
@1 | sku = null ; qty = 2
Call it with no SKU.
@6 | | > Value cannot be null. (Parameter 'sku')
`ThrowIfNullOrWhiteSpace` throws `ArgumentNullException`. It even fills in the parameter name for you.
@2 | sku = "TEA-01" ; qty = -1
Now a negative quantity.
@7 | | > qty ('-1') must be a non-negative and non-zero value. (Parameter 'qty') | > Actual value was -1.
`ArgumentOutOfRangeException`, with the bad value in the message. Line 8 never runs in either case.
:::

## `throw;` vs `throw ex;` {i}

:::plain
When you catch an exception just to log it, pass it on with plain `throw;`. Writing `throw ex;` erases the record of where the error really happened.
:::

Inside a `catch` you often log and then pass the exception on. *How* you rethrow decides whether you can still find the bug afterwards:

:::scene visuals/scenes/ex-rethrow.svg | What happens to the stack trace
1. `ChargeCard` throws. The exception records the path it took, the **stack trace**, which points at line 31. `Checkout` catches it to log it and then needs to pass it on.
2. **`throw;`** passes on the *same* exception, untouched. The trace still points at line 31, where it really failed.
3. **`throw ex;`** is treated as a *new* throw from inside the `catch`. The trace now starts at the catch block (line 14), and the real origin is gone.
4. **Wrapping**: `throw new PaymentException("Checkout of order 42 failed", ex)` gives a clearer message *and* keeps the original exception inside as `InnerException`. Nothing is lost.
:::

:::walk `throw;` keeps the evidence, `throw ex;` destroys it
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
@1 | properRethrow = true
First, the right way.
@12 | properRethrow = true ; ex.StackTrace = "at ChargeCard … at Checkout …"
`ChargeCard` throws. The exception's stack trace records where it really came from.
@16 | properRethrow = true ; ex.StackTrace = "at ChargeCard … at Checkout …"
After logging, `throw;` passes on **the same exception, untouched**.
@2 | | > throw;     trace still shows ChargeCard? True
The trace still points at `ChargeCard`, so whoever reads the log can find the bug.
@4 | properRethrow = false
Now the wrong way.
@17 | properRethrow = false ; ex.StackTrace = "at Checkout …" (ChargeCard is gone)
`throw ex;` counts as a **new** throw from this line. The runtime resets the trace to start here.
@5 | | > throw ex;  trace still shows ChargeCard? False
The real origin is gone. At 3 a.m. the log says the problem is in `Checkout`, and it isn't.
@23-24 | ex = IOException("disk full")
The third option: catch, then throw a **new** exception that explains what you were doing, and pass the original in as the inner exception.
@8 | | > wrapped:   Saving order 42 failed ← caused by: disk full
Both messages survive: the context ("saving order 42") and the cause ("disk full").
:::

- **`throw;`** passes on the same exception with its stack trace untouched.
- **`throw ex;`** treats it as a *new* throw from inside the `catch`, which overwrites the trace. If a stack trace starts somewhere unhelpful, look for a `throw ex;`.
- **Wrapping** (`new X("what we were doing", ex)`) gives a clearer message and keeps the original as `InnerException`.

### Exception filters: decide before unwinding

:::plain
A `when` clause lets a `catch` say "only if this condition is true". The condition is checked before anything is torn down, so exceptions you don't want pass straight through.
:::

:::walk Catch only the errors worth retrying
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
@1 | status = 503
First, a 503 ("service unavailable"), which usually goes away if you wait.
@3 | status = 503 ; ex = SupplierException(503)
The supplier call throws.
@4 | status = 503 ; ex = SupplierException(503)
The type matches, so the `when` filter runs: is the status 429 or 503? Yes.
@6 | status = 503 | > 503: transient, so retry later
So this `catch` handles it.
@1 | status = 404
Next, a 404 ("not found"). Retrying won't help.
@4 | status = 404 ; ex = SupplierException(404)
The type matches the first `catch`, but the filter says **no**. The filter runs *before* anything is unwound, so the exception simply moves on to the next `catch`, untouched.
@10 | status = 404 | > 404: permanent, so give up
The second `catch` takes it.
:::

A `when` clause runs **before** the stack unwinds, so a non-matching filter leaves the exception untouched for someone else. A filter that logs and returns `false` lets you *observe* an exception without catching it.

:::qa What is the difference between throw and throw ex?
`throw;` rethrows the current exception and preserves its original stack trace. `throw ex;` rethrows the same object but resets the stack trace to the current line, so you lose where it actually failed. To add context, throw a new exception and pass the original as `InnerException`.
:::

:::qa What are exception filters and why are they useful?
`catch (X ex) when (condition)` only catches when the condition is true. The filter runs before the stack unwinds, which preserves the original state for diagnostics, lets non-matching exceptions propagate untouched, and allows logging-only filters that return false.
:::

## Your own exception types {i}

:::plain
Make your own exception type when callers need to recognise *this* problem and act on it, and give it properties for the facts they'll need.
:::

:::walk An exception that carries the facts
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
@9-18 | -
A base `DomainException` with a machine-readable `Code`, and a specific `InsufficientStockException` that adds the `Sku` as a typed property.
@1 | requested = 5 ; available = 2
Try to reserve 5 when only 2 are left.
@6 | ex = InsufficientStockException { Code = stock.insufficient, Sku = TEA-01 }
The rule fails, so throw the specific type.
@2 | | > [stock.insufficient] Requested 5 of TEA-01, only 2 left (sku TEA-01)
The caller catches **this type** and reads typed properties. It never has to parse the message text, so you can reword the message later without breaking anyone.
:::

A short checklist. End the name with `Exception`. Derive from `Exception`, not the old `ApplicationException`. And put anything a caller might act on in **typed properties** (`Sku`), not hidden in the message. Map exceptions to HTTP status codes in **one central place** ([Errors & logging](ch:errors-logging)).

## When *not* to throw {i}

:::plain
Exceptions are for surprises. If "no" is a normal answer, like bad input or an empty shelf, return it as an ordinary value instead.
:::

Exceptions are for situations the caller couldn't reasonably expect. They're also **slow** (the stack trace has to be captured) and **invisible** in a method's signature. For outcomes that are *normal*, return them instead:

| Normal outcome | Better than throwing |
|---|---|
| The user typed "abc" into a quantity box | `int.TryParse` |
| A lookup might find nothing | `TryGetValue`, or return `null` |
| Validation failed | a validation result |
| "Card declined", "out of stock" | a `Result<T>` (see [CQRS & Result](ch:cqrs-mediator-result#the-result-pattern-making-expected-failure-part-of-the-metho)) |

:::walk Normal "no"s as values
```csharp
Console.WriteLine(int.TryParse("abc", out var qty) ? $"qty {qty}" : "not a number: ask again");   // no exception

var result = TryReserve("TEA-01", 5);
Console.WriteLine(result.Ok ? "reserved" : $"refused: {result.Error}");

static (bool Ok, string? Error) TryReserve(string sku, int qty) =>
    qty <= 2 ? (true, null) : (false, $"only 2 {sku} left");
```
@1 | qty = 0 | > not a number: ask again
A shopper typing "abc" isn't exceptional, it happens all day. `TryParse` returns `false` instead of throwing, so there's no stack trace to capture and no `try/catch` to write.
@3 | result = (Ok: false, Error: "only 2 TEA-01 left")
Same idea for a business rule. "Out of stock" is a normal answer, so return it as a value. The return type tells every caller that this can fail, which an exception never does.
@4 | | > refused: only 2 TEA-01 left
:::

:::gotcha An empty catch hides the fire
`catch { }` doesn't make a problem go away. It makes it **invisible**, while the bad state keeps doing damage. If you really must ignore an exception, catch the **narrowest** type, add a comment explaining why, and log it anyway.
:::

:::qa When should you not use exceptions?
For expected, frequent outcomes: invalid user input, lookups that miss, validation failures, business rejections. Use Try-methods, nullable returns, validation results or a Result type instead. Exceptions are expensive, invisible in signatures and meant for exceptional or programming errors.
:::

## Exceptions in async code {i}

:::plain
In async code an exception doesn't fly out straight away. It's stored inside the `Task` and only comes out when someone `await`s that task. If nobody does, nobody ever sees it.
:::

[Episode 8](ch:async-await) covers `async` properly, but these exception rules are worth seeing now:

:::scene visuals/scenes/ex-async.svg | Where an async exception goes
1. An `async Task` method throws. The exception doesn't fly out. It's caught and **stored inside the returned `Task`**, like a note in an envelope, and the task's status becomes *Faulted*.
2. **`await`** opens the envelope and rethrows the exception right there, with its original stack trace. So a `try/catch` around the `await` works normally.
3. If nobody awaits the task (`_ = ChargeAsync();`), nobody ever opens the envelope. The payment failed silently. That's the fire-and-forget bug.
4. **`async void`** has no `Task`, so there's no envelope. The exception has nowhere to go, and it **crashes the whole process**.
:::

You can see the envelope without any real waiting. This method throws, but the caller doesn't crash, because the exception is put inside the task:

:::walk The exception goes into the Task
```csharp
Task t = ChargeAsync();
Console.WriteLine("after the call: no crash, nothing printed");
Console.WriteLine($"task status: {t.Status}");
Console.WriteLine($"stored inside: {t.Exception!.InnerException!.Message}");

static async Task ChargeAsync()
{
    await Task.CompletedTask;
    throw new InvalidOperationException("card declined");
}
```
@1
Call the async method, and don't `await` it.
@8-9
Inside, the method throws.
@1 | t = Task (Faulted, holding: card declined)
But because it's an `async Task` method, the compiler catches the exception and **stores it in the returned task**. The caller just gets a task back.
@2 | | > after the call: no crash, nothing printed
Execution carries on as if nothing happened. If this were checkout, the card was declined and nobody knows.
@3 | | > task status: Faulted
The task knows: its status is `Faulted`.
@4 | | > stored inside: card declined
The exception is sitting inside it, waiting for someone to `await` the task. `await t` would rethrow it right there, and a `try/catch` around the `await` would catch it.
:::

The rules, in short:

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

:::walk Leak the pool, then fix it with one word
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
@1 | pool.Free = 3
A connection pool with 3 connections to lend.
@5 | i = 1 ; pool.Free = 3
First leaky checkout.
@18 | i = 1 ; pool.Free = 2
Borrow a connection.
@19 | i = 1 ; pool.Free = 2
The card call throws. Line 20, which would give the connection back, **never runs**.
@5-6 | i = 1 ; pool.Free = 2 | >   leaky #1 failed: card provider timeout | >   pool: 2 free
One connection gone for good.
@5-6 | i = 3 ; pool.Free = 0 | >   leaky #2 failed: card provider timeout | >   pool: 1 free | >   leaky #3 failed: card provider timeout | >   pool: 0 free
Two more failures, two more leaks. The pool is empty.
@5-6 | i = 4 ; pool.Free = 0 | >   leaky #4 failed: Timeout expired obtaining a connection | >   pool: 0 free
The 4th checkout can't even get a connection. On the real site, so does every other page. That's the outage.
@9 | pool.Free = 3
A fresh pool, and the safe version.
@25 | i = 1 ; pool.Free = 2
`using var` borrows a connection. The compiler wraps the rest of the method in `try { … } finally { conn.Dispose(); }`.
@26 | i = 1 ; pool.Free = 2
The card call throws again.
@27 | i = 1 ; pool.Free = 3
But on the way out, the hidden `finally` calls `Dispose`, which gives the connection back.
@12-13 | i = 4 ; pool.Free = 3 | >   safe #1 failed: card provider timeout | >   pool: 3 free | >   safe #2 failed: card provider timeout | >   pool: 3 free | >   safe #3 failed: card provider timeout | >   pool: 3 free | >   safe #4 failed: card provider timeout | >   pool: 3 free
Every checkout still fails, because the provider is still down. But the pool stays full, so the rest of the site keeps working.
:::

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

:::plain
If your class holds things that need disposing, it must be disposable too, and its `Dispose` passes the call on to each of them. Make it safe to call twice.
:::

If your class *holds* other disposables (a file, a timer), it should be disposable too, and pass the `Dispose` on:

:::walk A class that holds a disposable must be one
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
@8-11 | -
`ReportExporter` holds a stream (a disposable), so it implements `IDisposable` itself, and keeps a flag saying whether it has been disposed.
@1 | export = ReportExporter (open)
Create the exporter in a `using` block.
@3 | | > wrote: order 42
Write a line.
@4 | export = ReportExporter (disposed)
The closing brace of the `using` block calls `Dispose`.
@22-25 | | > disposed
`Dispose` passes the call on to the stream it owns, then sets the flag.
@5 | again = ReportExporter (disposed) | > disposed
Dispose another one **twice**. The second call sees `_disposed` is already true and returns at once (line 22). Calling `Dispose` twice must always be safe.
@6 | | > used after dispose: refused
Using it after disposal throws `ObjectDisposedException` from line 15, rather than failing somewhere confusing inside the stream.
:::

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

The `disposing` flag is the confusing part, so here it is as a picture:

:::scene visuals/scenes/ex-dispose-pattern.svg | One cleanup method, two ways in
1. There's one cleanup method, `Dispose(bool disposing)`, and two ways to reach it. The `bool` says which way you came.
2. **Path 1, the normal one:** your code calls `Dispose()` (or `using` does), which calls `Dispose(true)`. Everything is still alive, so it's safe to dispose the other objects you hold too. Then `GC.SuppressFinalize(this)` tells the GC that path 2 isn't needed.
3. **Path 2, the safety net:** nobody disposed, so eventually the GC's **finalizer** calls `Dispose(false)`. Other managed objects may already have been collected, so *only* free the raw native resource.
4. You only need any of this if you hold a **raw** native handle. Better still, wrap it in a `SafeHandle`, which already does it correctly.
:::

`SuppressFinalize` matters for speed too: objects waiting to be finalized survive an extra garbage collection ([Memory & GC](ch:memory-gc#finalizers-the-gcs-last-resort-and-why-its-slow)).

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

:::plain
Almost every disposal bug is one of two things: something you created was never disposed, or something you *didn't* create was disposed by you.
:::

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
