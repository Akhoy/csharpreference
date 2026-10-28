---
id: delegates-events
title: Delegates, Lambdas, Closures and Events
summary: Treating behaviour as data. Delegate types, Func and Action, lambdas, closures and what the compiler generates for them, events and the observer pattern, and how ASP.NET Core is built out of delegates.
layer: language
where: C# language › Functions as values
fits: Layer 1. This is the hidden key to understanding layer 3. A middleware is a `Func<RequestDelegate, RequestDelegate>`, a minimal API endpoint is a delegate, LINQ operators take delegates, and configuration callbacks (`options => …`) are lambdas. Once delegates click, `Program.cs` stops looking like magic.
levels: b,i,a
prereqs: oop, generics
next: linq, middleware, async-await
---

## TL;DR

- A **delegate** is a variable that holds a reference to a method, so you can pass behaviour around like data.
- `Func<...>` (returns a value) and `Action<...>` (returns nothing) are the built-in delegate types you'll use almost always, instead of declaring your own.
- A **lambda** (`x => x * x`) is just an inline, unnamed function that gets converted into a delegate.
- A **closure** happens when a lambda keeps using a local variable after its method has returned — the compiler keeps that variable alive on the heap, which costs an allocation and means captured variables are shared, not copied.
- An **event** is a delegate field with subscribing (`+=`/`-=`) allowed from outside but invoking and overwriting restricted to the owner — the built-in Observer pattern.
- ASP.NET Core's whole pipeline (`Program.cs`, middleware, minimal API endpoints) is just delegates passed around.

## Treating a method like a value you can pass around {b}

Everything in this chapter — lambdas, closures, events, and eventually the entire shape of `Program.cs` — grows out of one simple capability: being able to hold a reference to a *method* in a variable, the same way you'd hold a reference to a string or a number, and call it later without caring, at that moment, exactly which method it actually points to.

```csharp
// 1. Declare a delegate type (a method signature with a name)
public delegate decimal PriceRule(decimal basePrice);

// 2. Methods that match the signature
static decimal BlackFriday(decimal p) => p * 0.7m;
static decimal NoDiscount(decimal p) => p;

// 3. Use it like a variable
PriceRule rule = BlackFriday;
decimal final = rule(100m);          // 70; calls BlackFriday through the delegate
rule = NoDiscount;                    // swap behaviour at runtime
```

A **delegate** is what makes that possible: a type-safe object that points to a method, which you can store in a variable, pass as an argument, and invoke later — exactly as the `rule` variable does above. Notice that last line especially: `rule` gets reassigned from `BlackFriday` to `NoDiscount` at runtime, and whatever code calls `rule(...)` doesn't need to change at all to pick up the new behaviour.

:::why Why this capability matters so much
It lets you **pass behaviour** around using the same mechanism you'd use to pass data. A sort algorithm doesn't need to know, hard-coded, *how* to compare two items — you hand it a comparison function, and it stays generic forever. A retry helper doesn't need to know *what* operation it's retrying — you hand it the operation as a value. A web framework doesn't need to know your specific endpoint logic — you hand it a function, and it calls that function when a request arrives. This single idea is the foundation underneath callbacks, LINQ, events, middleware, and — as the final section of this chapter shows directly — most of how modern ASP.NET Core is actually built.
:::

## Func, Action and Predicate: delegates you never have to declare yourself {b}

In practice, you'll almost never write `public delegate ... ;` the way the example above did. The BCL already ships generic delegate types covering nearly every signature you'd ever need:

| Delegate | Signature | Example |
|---|---|---|
| `Action` | `() → void` | `Action log = () => Console.WriteLine("hi");` |
| `Action<T1..T16>` | `(T…) → void` | `Action<string> print = s => Console.WriteLine(s);` |
| `Func<TResult>` | `() → TResult` | `Func<DateTime> now = () => DateTime.UtcNow;` |
| `Func<T1..T16, TResult>` | `(T…) → TResult` (last type is the return) | `Func<int, int, int> add = (a, b) => a + b;` |
| `Predicate<T>` | `T → bool` | `Predicate<Order> big = o => o.Total > 1000;` |
| `Comparison<T>` | `(T, T) → int` | `list.Sort((a, b) => a.Price.CompareTo(b.Price));` |
| `EventHandler<TArgs>` | `(object? sender, TArgs e) → void` | Events |

The pattern worth internalising: `Action` is "does something, returns nothing"; `Func` is "does something, returns a value" — and `Func`'s *last* type parameter is always the return type, with everything before it being the parameters. That convention lets a method like `RetryAsync` below stay completely ignorant of what operation it's actually retrying:

```csharp
public static async Task<T> RetryAsync<T>(Func<Task<T>> operation, int attempts = 3)
{
    for (int i = 1; ; i++)
    {
        try { return await operation(); }
        catch when (i < attempts) { await Task.Delay(200 * i); }
    }
}

var user = await RetryAsync(() => api.GetUserAsync(42));   // pass the "what" as a lambda
```

`RetryAsync` has no idea it's fetching a user — it just knows it has some `Func<Task<T>>` to call, and retries it if it throws. That's exactly the "pass behaviour, not just data" idea from the `:::why` box above, made concrete. (The `async`/`await`/`Task<T>` in this snippet are about pausing work without blocking a thread — the dedicated [Async/await](ch:async-await) chapter covers that; here they're just a method signature, no different from any other `T` you'd pass.)

## Lambdas: writing the delegate inline {b}

A **lambda expression** is an inline, anonymous function — instead of declaring `BlackFriday` as a named method somewhere else and then referencing it, you write the function body right where you need it. The compiler converts a lambda into a delegate (or, in one specific situation covered later in this chapter, into an **expression tree** instead — see [LINQ](ch:linq#expression-trees-what-ef-core-is-actually-reading) for exactly when and why).

```csharp
Func<int, int> square = x => x * x;                          // expression lambda
Func<int, int, int> add = (a, b) => a + b;
Func<string, bool> isEmail = s => { var at = s.IndexOf('@'); return at > 0 && at < s.Length - 1; }; // statement lambda
Action noArgs = () => Console.WriteLine("hi");
Func<int, int> typed = (int x) => x + 1;                       // explicit parameter type
var inferred = (string s) => s.Length;                          // C# 10: natural type → Func<string,int>
Func<int, int> discard = _ => 42;                               // discard parameter
var withDefault = (int x = 10) => x * 2;                        // C# 12: default parameter values
static int Helper(int x) => x + 1;                              // local function (named, inside a method)
```

One shortcut worth knowing, because it comes up constantly in real code: when a method you already have matches the delegate's signature exactly, you can pass the **method group** — just the method's name, no lambda wrapper at all — and the compiler builds the delegate for you: `names.Select(int.Parse)`, `app.MapGet("/", GetAll)`. If you find yourself writing `x => int.Parse(x)`, that's almost always exactly equivalent to the shorter `int.Parse`.

## Closures: when a lambda outlives the method it was written in {i}

Here's a strange-sounding claim: a lambda can keep using a local variable from the method it was written in, **even after that method has already returned**. Watch it happen:

```csharp
Func<int> MakeCounter()
{
    int count = 0;                 // local variable...
    return () => ++count;          // ...captured by the lambda
}

var next = MakeCounter();
next(); next();
Console.WriteLine(next());         // 3: 'count' survived after MakeCounter returned
```

By the normal rule from [Type system](ch:type-system#value-types-live-on-the-stack-a-useful-lie), `count` is a local variable, so it should live in a stack frame that's popped the instant `MakeCounter` returns. But `MakeCounter` *has already returned* by the time `next()` runs — so how does `count` survive?

A lambda that uses a local variable from its enclosing scope is said to **capture** that variable. Here's how the compiler actually pulls that off:

:::deep What the compiler actually generates for a captured local
A captured local can't stay on the stack, so the compiler doesn't try. It rewrites the whole method, moving the captured variable into a hidden heap-allocated class made just for this purpose:

```csharp
// roughly what MakeCounter becomes
sealed class DisplayClass { public int count; public int Lambda() => ++count; }

Func<int> MakeCounter()
{
    var closure = new DisplayClass();   // heap allocation
    closure.count = 0;
    return closure.Lambda;              // delegate pointing at an instance method → another allocation
}
```

Once you see this generated code, three things stop looking arbitrary: capturing **allocates** — a heap object (`DisplayClass`) plus a delegate wrapping one of its methods, neither of which existed before. Captured variables are **shared**, not copied, by every lambda that captures them — they're all reading and writing the *same field* on the *same* object. And a captured variable lives exactly as long as the delegate holding it does, because it's now just a field on an ordinary heap object, kept alive by the same reachability rules as any other object (see [Memory & GC](ch:memory-gc)).

Non-capturing lambdas pay none of this cost: with nothing to capture, the compiler caches one instance and reuses it, allocating nothing on repeated calls. To catch an *accidental* capture before it costs you anything, mark the lambda `static` (`static x => x * 2`) — the compiler then refuses to compile it if it secretly captures something.
:::

### The loop-capture trap: a bug that only shows up because of exactly this mechanism

```csharp
var actions = new List<Action>();
for (int i = 0; i < 3; i++)
    actions.Add(() => Console.Write(i));
actions.ForEach(a => a());     // prints 333: all lambdas share ONE 'i'

foreach (var n in new[] { 0, 1, 2 })
    actions.Add(() => Console.Write(n));   // prints 012: since C# 5 each foreach iteration gets a fresh variable
```

The `for` loop prints `333`, not `012`, because closures share the *variable*, not a snapshot of its value. There's exactly **one** `i` for the whole loop, declared once in the `for` header, and all three lambdas capture a reference to that same field. By the time any of them actually runs, the loop has finished and `i` is already `3` — so all three print `3`.

The `foreach` version avoids this because C# 5 changed the language to give each iteration its own fresh variable. Each lambda there captures a genuinely distinct `n`. If you're stuck with `for` and need `foreach`-style behavior, copy the loop variable into a fresh local *inside* the loop body (`var copy = i;`) before the lambda captures it.

### Capturing something that gets disposed out from under you

This causes a real production bug: capturing a scoped object (a `DbContext`, an `HttpContext`) inside a lambda that outlives the request it came from — a background task, a cached delegate, a static event handler — means the lambda holds onto an object that gets **disposed** when the request ends, whether the lambda is done with it or not. The next time it runs, it touches a disposed object (`ObjectDisposedException`), or if nothing calls it again but nothing releases it either, you've built a memory leak.

## Multicast delegates: one delegate, several methods {i}

Delegates aren't limited to pointing at exactly one method — they can hold an entire **list** of methods, all with the same signature:

```csharp
Action notify = () => Console.WriteLine("email");
notify += () => Console.WriteLine("sms");
notify();      // email, sms
```

`+=` appends a method to the delegate's internal list; `-=` removes one; invoking the delegate calls every method in that list, in order. Two sharp edges: for delegates with a return value, invoking a multicast delegate only gives you the **last** method's result — the earlier ones ran, but their return values are discarded. And if one handler throws partway through, the rest of the list **never runs** — the exception propagates immediately.

One more useful fact: delegates are **immutable**. `notify += ...` doesn't modify the existing delegate — it creates a new delegate instance (old list plus the new method) and reassigns `notify` to it. That's what makes `?.Invoke(...)` safe to call from multiple threads: another thread reassigning the variable to a new delegate can never corrupt an instance that's currently being invoked elsewhere, because that instance never changes once created.

## Events: a delegate with the dangerous parts removed {i}

An **event** is, underneath, just a delegate field — with deliberately restricted access bolted on. Outside code is only ever allowed to **subscribe** (`+=`) or **unsubscribe** (`-=`); only the class that declared the event can actually **raise** it, or replace the whole subscriber list with `=`. This restricted shape is the entire Observer pattern, built directly into the language rather than something you assemble by hand.

```csharp
public sealed class OrderPlacedEventArgs(int orderId, decimal total) : EventArgs
{
    public int OrderId { get; } = orderId;
    public decimal Total { get; } = total;
}

public class Checkout
{
    public event EventHandler<OrderPlacedEventArgs>? OrderPlaced;   // the event

    public void Complete(Order o)
    {
        // ...save...
        OnOrderPlaced(new OrderPlacedEventArgs(o.Id, o.Total));
    }

    protected virtual void OnOrderPlaced(OrderPlacedEventArgs e) => OrderPlaced?.Invoke(this, e);  // raise

}

var checkout = new Checkout();
checkout.OrderPlaced += (sender, e) => Console.WriteLine($"Order {e.OrderId} for {e.Total}");
// checkout.OrderPlaced = null;   // ✘ compile error outside the class: that's the point of 'event'
// checkout.OrderPlaced(...);     // ✘ only the owner can raise it
```

The two commented-out lines are the whole point of `event`: a plain delegate *field* would let any outside code overwrite the whole subscriber list with `=` (wiping out every other subscriber), or invoke it directly, pretending to be the publisher. `event` closes both doors while leaving `+=`/`-=` open.

| | Delegate field | Event |
|---|---|---|
| Outsiders can `+=` / `-=` | Yes | Yes |
| Outsiders can `=` (replace all) | Yes | **No** |
| Outsiders can invoke | Yes | **No** |

:::gotcha Event subscriptions are a classic, silent memory leak
The publisher's event field holds a reference to every subscriber through the delegate — that's just how `+=` works (same reachability rule as [Memory & GC](ch:memory-gc)). If a long-lived publisher (a singleton, a static event) accumulates subscribers from short-lived objects that never unsubscribe, every one of them stays reachable forever through the publisher's field, so the GC can never collect them. Always `-=` in `Dispose`, or use a weak-event pattern when the subscriber's lifetime can't be tied to a clean unsubscribe point.
:::

### What "events" usually mean once you leave this one language feature

C# `event`s are in-process and synchronous — the publisher calls subscribers directly, on its own thread, and waits for them to finish. That's a narrow fit for most backend work, so you'll rarely use the `event` keyword itself in API code. "Event" as a *word*, though, shows up constantly elsewhere in this book, meaning something related but mechanically different each time:

| Kind | Mechanism | Chapter |
|---|---|---|
| C# `event` | Delegate in the same process | here |
| Domain events | Objects raised by aggregates, dispatched in-process after save | [DDD](ch:ddd) |
| Integration events | Messages published to a broker for other services | [Messaging](ch:messaging-events) |
| Host lifetime events | `IHostApplicationLifetime.ApplicationStarted/Stopping` | [Hosting](ch:aspnet-hosting) |
| Options change | `IOptionsMonitor<T>.OnChange` callback | [Configuration](ch:configuration-options) |

Keep this table in mind so "domain event" and "C# `event`" don't blur together later — they share a name and a general spirit (something happened, tell interested parties) but almost nothing about their actual mechanics.

## The payoff: delegates are how ASP.NET Core is actually built {i}

Look at a typical `Program.cs` again, this time noticing every lambda:

```csharp
builder.Services.AddDbContext<ShopDb>(options => options.UseSqlServer(cs));   // Action<DbContextOptionsBuilder>
builder.Services.Configure<JwtOptions>(o => o.Issuer = "shop");                // Action<JwtOptions>
builder.Services.AddScoped<IClock>(sp => new SystemClock());                   // Func<IServiceProvider, IClock>: factory

app.Use(async (context, next) => { /* ... */ await next(context); });         // middleware: Func<HttpContext, RequestDelegate, Task>
app.MapGet("/orders/{id}", (int id, IOrderService s) => s.GetAsync(id));       // endpoint handler: any delegate
```

Every one of those lambdas is exactly the mechanism this chapter opened with: a method, held as a value, handed to someone else to call later. `AddDbContext`'s lambda is an `Action<DbContextOptionsBuilder>` — "here's how to configure options; I don't care when you run this." `AddScoped`'s lambda is a `Func<IServiceProvider, IClock>` — a factory the container calls whenever it needs a new `IClock`. It's the same `Func`/`Action` vocabulary from the start of this chapter, not special configuration syntax.

The core type the whole pipeline is built from makes this explicit:

```csharp
public delegate Task RequestDelegate(HttpContext context);
```

A **middleware** (full coverage in [Middleware](ch:middleware)) is a function that takes the *next* `RequestDelegate` in the pipeline and returns a *new* `RequestDelegate` wrapping it — a `Func<RequestDelegate, RequestDelegate>`. The whole pipeline is built by composing a list of these, each wrapping the next. Once delegates click as "methods held as values," `app.Use(...)` stops looking like framework magic.

## Expression trees vs delegates: the same lambda, compiled two different ways {a}

One loose thread from the "Lambdas" section: a lambda doesn't *always* compile into a delegate. Which one it becomes depends on what type you assign it to:

```csharp
Func<Order, bool> asDelegate = o => o.Total > 100;                 // compiled IL: can be executed
Expression<Func<Order, bool>> asTree = o => o.Total > 100;         // a data structure describing the code
```

`asDelegate` is ordinary, runnable IL — the delegate mechanism this chapter has covered. `asTree`, despite looking identical on the right, is categorically different: an **object graph** — made of types like `BinaryExpression`, `MemberExpression`, `ConstantExpression` — that *describes* the lambda's logic as data, instead of compiling it into code you can run directly.

```csharp
Console.WriteLine(asTree.Body);   // (o.Total > 100)
```

That's `ToString()` on a real object graph, printing back roughly the code it represents, not a hand-written string. This is what makes EF Core possible: `IQueryable.Where` takes an `Expression<Func<T,bool>>`, not a `Func<T,bool>`, so EF Core can **inspect and translate** that tree into SQL instead of running it as C#. `IEnumerable.Where` takes a plain `Func<T,bool>`, because LINQ to Objects just runs your predicate in-process — nothing to translate. [LINQ](ch:linq#expression-trees-what-ef-core-is-actually-reading) walks through that translation, node by node.

:::qa What is a delegate?
A type-safe reference to a method (or a list of methods) with a specific signature. It lets you store behaviour in variables and pass it as arguments: callbacks, strategies, LINQ predicates, event handlers, middleware.
:::

:::qa Func vs Action vs Predicate?
Func&lt;…, TResult&gt; returns a value (the last type argument is the return type). Action&lt;…&gt; returns void. Predicate&lt;T&gt; is a T → bool function, equivalent to Func&lt;T, bool&gt;, used by older APIs like List.FindAll.
:::

:::qa What is a closure and what does it cost?
A lambda that captures variables from its enclosing scope. The compiler hoists captured variables into a heap-allocated class, so they outlive the method and are shared by every lambda that captures them. Each capturing lambda costs allocations (closure plus delegate), which matters in hot paths; static lambdas prevent accidental capture.
:::

:::qa Why does a for-loop capturing the loop variable print the same number?
All lambdas capture the same single variable `i`, which has its final value by the time they run. foreach creates a new variable per iteration (since C# 5) so it's safe; in a for-loop, copy to a local inside the body.
:::

:::qa What is the difference between a delegate and an event?
An event wraps a delegate so external code can only subscribe and unsubscribe. It can't invoke the event or overwrite the subscriber list with `=`. Only the declaring class can raise it.
:::

:::qa How can events cause memory leaks?
The publisher's delegate holds strong references to subscribers. A long-lived publisher keeps short-lived subscribers alive if they never unsubscribe. Unsubscribe in Dispose, or use weak references.
:::

:::qa How does ASP.NET Core use delegates?
The pipeline's core type is `RequestDelegate` (HttpContext → Task). Middleware are functions that wrap the next RequestDelegate; minimal API endpoints are arbitrary delegates whose parameters are bound from the request; configuration APIs take Action&lt;TOptions&gt; lambdas; DI supports Func&lt;IServiceProvider, T&gt; factories.
:::

:::qa What is the difference between Func<T,bool> and Expression<Func<T,bool>>?
A Func is compiled code that can be invoked. An Expression is a data structure describing the code, which providers like EF Core can analyse and translate to another language such as SQL. You can compile an expression into a delegate with `.Compile()`, but not the other way round.
:::

## Further reading

- [Delegates and events](https://learn.microsoft.com/en-us/dotnet/csharp/delegates-overview)
- [Lambda expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions)
- [Expression trees](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/)

## Verify this chapter

Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`. It checks delegate reassignment, method-group conversion, closures (including the for-loop vs foreach capture trap), multicast delegate behavior, delegate immutability, event subscribe/unsubscribe, and expression trees vs delegates.

```csharp
using System.Linq.Expressions;

int failures = 0;
void Check(string claim, bool ok)
{
    if (ok) Console.WriteLine($"OK: {claim}");
    else { Console.WriteLine($"FAIL: {claim}"); failures++; }
}

// 1. Delegate can be reassigned to swap behavior at runtime
PriceRule rule = BlackFriday;
decimal r1 = rule(100m);
rule = NoDiscount;
decimal r2 = rule(100m);
Check("reassigning a delegate variable swaps behavior at runtime", r1 == 70m && r2 == 100m);

// 2. Method group conversion
Func<string, int> parse = int.Parse;
Check("a method group converts to a matching delegate type", parse("42") == 42);

// 3. Closure: a lambda keeps using a local after the method returns
Func<int> counter = MakeCounter();
counter(); counter();
Check("a closure keeps a captured local alive after its method returns", counter() == 3);

// 4. Captured variables are shared, not copied: the classic for-loop trap
var trapActions = new List<Action>();
var trapResults = new List<int>();
for (int i = 0; i < 3; i++)
    trapActions.Add(() => trapResults.Add(i));
foreach (var a in trapActions) a();
Check("a for-loop capturing its loop variable shares ONE variable (all lambdas see the final value)",
    trapResults.Count == 3 && trapResults[0] == 3 && trapResults[1] == 3 && trapResults[2] == 3);

var foreachResults = new List<int>();
var foreachActions = new List<Action>();
foreach (var n in new[] { 0, 1, 2 })
    foreachActions.Add(() => foreachResults.Add(n));
foreach (var a in foreachActions) a();
Check("a foreach loop gives each iteration its own variable (lambdas see distinct values)",
    foreachResults.SequenceEqual(new[] { 0, 1, 2 }));

// 5. Multicast delegate: invoking calls every subscriber, in order; return value is the LAST one
var order = new List<string>();
Func<int> multi = () => { order.Add("first"); return 1; };
multi += () => { order.Add("second"); return 2; };
int multiResult = multi();
Check("a multicast delegate invokes every subscriber in order", order.SequenceEqual(new[] { "first", "second" }));
Check("invoking a multicast delegate returns only the LAST subscriber's result", multiResult == 2);

// 6. Delegate immutability: += creates a new delegate instance, doesn't mutate the old one
Action original = () => { };
Action afterAdd = original;
afterAdd += () => { };
Check("delegates are immutable: += produces a new instance, the original is untouched",
    !ReferenceEquals(original, afterAdd));

// 7. Event: outside code can subscribe/unsubscribe but not invoke or overwrite with '='
var checkout = new Checkout();
int notified = 0;
EventHandler<int> handler = (s, total) => notified += total;
checkout.OrderPlaced += handler;
checkout.Complete(50);
checkout.OrderPlaced -= handler;
checkout.Complete(50); // handler removed, shouldn't fire again
Check("event subscription (+=) and unsubscription (-=) work from outside the class", notified == 50);

// 8. Expression<Func<T,bool>> is data describing the lambda, not compiled code
Expression<Func<int, bool>> asTree = x => x > 100;
Func<int, bool> asDelegate = asTree.Compile();
Check("an Expression<Func<T,bool>> can be inspected as a BinaryExpression body", asTree.Body is BinaryExpression);
Check("an Expression can be compiled into a runnable delegate", asDelegate(150) == true && asDelegate(50) == false);

Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
if (failures > 0) Environment.Exit(1);

static decimal BlackFriday(decimal p) => p * 0.7m;
static decimal NoDiscount(decimal p) => p;

static Func<int> MakeCounter()
{
    int count = 0;
    return () => ++count;
}

delegate decimal PriceRule(decimal basePrice);

class Checkout
{
    public event EventHandler<int>? OrderPlaced;
    public void Complete(int total) => OrderPlaced?.Invoke(this, total);
}
```

Not runtime-verifiable here: that `event` actually produces a *compile error* for `checkout.OrderPlaced(...)` or `checkout.OrderPlaced = null` from outside the class — that's a compile-time restriction, not something a running program can assert. Try uncommenting those lines yourself to see the compiler reject them.
