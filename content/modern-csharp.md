---
id: modern-csharp
title: Modern C#: Nullability, Pattern Matching, Records and the C# 9–14 Toolkit
summary: The features that make modern C# look different from old tutorials. Nullable reference types, pattern matching and switch expressions, records, init and required, tuples and deconstruction, extension methods and members, primary constructors, collection expressions, raw strings, and a version-by-version map.
layer: language
where: C# language › Modern language features
fits: Layer 1. These features don't add new runtime capabilities; they are mostly compiler features. But modern ASP.NET Core templates and samples (layer 3) use them everywhere: file-scoped namespaces, top-level `Program.cs`, records as DTOs, primary-constructor services. Knowing them lets you read current code fluently.
levels: b,i,a
prereqs: type-system, oop
next: advanced-csharp, building-apis
---

## TL;DR

- None of this chapter's features add new runtime behavior — they're compiler conveniences that make modern code *look* different from older tutorials.
- **Nullable reference types** are a compile-time-only warning system for possible nulls; they add **zero** runtime checks, so bad data from JSON/EF Core can still sneak a null through.
- **Pattern matching** lets you test a value's *shape* (its type, its properties, a range) in `is`/`switch`, not just whether it equals a constant.
- **Records** are for data that's equal by *value*, not identity; `with` gives you a non-destructively modified copy, never mutating the original.
- **`init`/`required`** let a type force callers to set certain properties exactly once — checked by the compiler, and by JSON deserialization too.
- **Extension methods/members** add capability to an existing type without touching its source — this is the exact mechanism behind `IServiceCollection.AddX()` everywhere in ASP.NET Core.

## Why this chapter exists {b}

Picture a concrete moment: you open a pull request on a modern ASP.NET Core repo for the first time, and nothing looks like the tutorial you learned from. `Program.cs` has nine lines total and no `class`, no `Main`. A model class has one line and no body. A `switch` is missing its `default`, and somehow the compiler isn't complaining about it. None of that is new language *capability* — the CLR could always do everything this chapter describes — it's new *syntax*, added version by version, specifically to remove ceremony from code you'd otherwise have written longhand. We'll keep coming back to that one pull request through this chapter: each feature below is one more line in it starting to make sense.

None of these features add new runtime capabilities the CLR couldn't already do — they're almost entirely compiler conveniences, syntax that compiles down to things you've already met elsewhere in this book. The goal here isn't to memorise which C# version introduced what; it's to recognise each feature on sight and know *why* someone reached for it, so reading real code stops requiring a lookup every few lines.

| C# | .NET | Headline features |
|---|---|---|
| 7.x | Core 2.x | Tuples, deconstruction, `out var`, pattern matching (`is`), local functions, `ref` returns, `Span<T>` support |
| 8 | Core 3.x | **Nullable reference types**, switch expressions, property patterns, async streams, `using` declarations, ranges `^1`/`..`, default interface methods |
| 9 | 5 | **Records**, `init`, **top-level statements**, relational/logical patterns (`and`, `or`, `not`), target-typed `new()` |
| 10 | 6 | **Global usings**, **file-scoped namespaces**, record structs, extended property patterns, constant interpolated strings |
| 11 | 7 | **Raw string literals**, **`required` members**, list patterns, generic math (static abstract members), UTF-8 literals `"x"u8`, `file` types |
| 12 | 8 | **Primary constructors** for classes, **collection expressions** `[1, 2]`, default lambda parameters, alias any type, `[Experimental]` |
| 13 | 9 | `params` collections, new `System.Threading.Lock`, `\e` escape, partial properties, `ref struct` in generics (`allows ref struct`) |
| 14 | 10 | **Extension members** (properties, static extensions), **`field` keyword**, null-conditional assignment `a?.B = x`, `nameof` with unbound generics, implicit span conversions |

## Nullable reference types: making a silent killer visible at compile time {b}

`NullReferenceException` is, by most accounts, the single most common runtime crash in C# history — a reference you assumed couldn't be null, turning out to be null, discovered only when the line actually executes. **Nullable reference types**, turned on with `<Nullable>enable</Nullable>` (the default in new project templates), attack this problem at compile time instead of leaving it to be discovered at runtime: the compiler starts treating every reference type as **non-nullable by default**, and tracks, flow-sensitively, line by line, whether a given reference could possibly be null at each point in your code.

```csharp
public class Customer
{
    public string Email { get; set; } = "";     // never null
    public string? MiddleName { get; set; }      // may be null
}

void Print(Customer c)
{
    Console.WriteLine(c.Email.Length);           // fine
    Console.WriteLine(c.MiddleName.Length);      // ⚠ CS8602: possible null dereference
    if (c.MiddleName is not null)
        Console.WriteLine(c.MiddleName.Length);  // fine: compiler knows it's not null here
}
```

Notice the third line doesn't warn, even though it's accessing the exact same `MiddleName` property the second line warned about — the compiler is tracking the *flow* of your code, and by the time execution reaches inside the `if`, it has proven, from the `is not null` check, that a null dereference here is impossible. This is genuinely flow analysis, not a blunt "this property is marked nullable so always warn" rule.

| Syntax | Meaning |
|---|---|
| `string?` | May be null |
| `x?.Prop` | Null-conditional: `null` if x is null |
| `x ?? fallback` | Null-coalescing |
| `x ??= value` | Assign if null |
| `x!` | **Null-forgiving**: "trust me, it isn't null". Suppresses the warning only; use sparingly |
| `a?.B = x` (C# 14) | Assign only if `a` isn't null |
| `[NotNullWhen(true)]`, `[MaybeNull]`, `[NotNull]`, `[MemberNotNull]` | Attributes that teach the compiler about your API's null behaviour |

That last row matters more than it looks, because the compiler can only track what it's been told:

```csharp
public bool TryFind(int id, [NotNullWhen(true)] out Order? order) { /* ... */ }

if (TryFind(5, out var o)) Console.WriteLine(o.Total);   // no warning: o is known non-null here
```

Without `[NotNullWhen(true)]`, the compiler has no way to know that `order` is guaranteed non-null specifically when `TryFind` returns `true` — it would warn on `o.Total` regardless. The attribute is you teaching the compiler your own API's actual null-contract, so its flow analysis stays accurate through your own methods, not just the BCL's.

:::gotcha The analysis is entirely compile-time — nothing here checks anything at runtime
This is the single most important thing to understand about the whole feature: nullable reference types add **zero runtime checks**. They're purely a compile-time warning system, built from static analysis of code *you wrote*. JSON deserialisation can still hand you a null where you declared `string`, not `string?`, if the JSON itself was missing that field. EF Core materialising a row with a database `NULL` can do the same. Reflection, or a caller in an assembly built with nullability disabled, bypasses the whole system entirely, because the check never existed at runtime to bypass. The practical response: validate at your actual trust boundaries anyway (`ArgumentNullException.ThrowIfNull`), and seriously consider making nullable warnings into build errors (`<WarningsAsErrors>nullable</WarningsAsErrors>`) — a warning nobody's forced to fix tends to quietly accumulate until it's ignored entirely.
:::

The feature does reach further than your own code, though: **EF Core and ASP.NET Core both read these annotations and act on them.** In EF Core, a `string` property becomes a `NOT NULL` database column and `string?` becomes nullable, inferred directly from your nullability annotation rather than needing a separate `[Required]` attribute. In ASP.NET Core model validation, a non-nullable property is implicitly treated as `[Required]` for the same reason — the annotation you wrote for the compiler's benefit gets reused as real, meaningful metadata elsewhere in the framework.

## Pattern matching: testing a value's shape, not just its identity {b}

A **pattern** tests whether a value has a particular *shape* — not just "does it equal this constant", but "is it this type, with these properties, satisfying this condition". Patterns work inside `is` expressions, `switch` statements, and switch expressions alike:

| Pattern | Example | Matches when |
|---|---|---|
| Type / declaration | `o is Order order` | `o` is an `Order` (binds it) |
| Constant | `x is null`, `status is OrderStatus.Paid` | Equal to a constant |
| Relational | `age is >= 18` | Comparison holds |
| Logical | `c is >= 'a' and <= 'z'`, `x is not null`, `s is "y" or "yes"` | Combined |
| Property | `o is { Status: OrderStatus.Paid, Total: > 100 }` | Properties match nested patterns |
| Extended property | `o is { Customer.Country: "DE" }` | Nested member path |
| Positional | `point is (0, 0)` | Deconstruct and match |
| List | `args is [var first, .., var last]`, `[_, _]` | Sequence shape |
| Discard / var | `_`, `var x` | Anything |

```csharp
public static decimal ShippingFee(Order o) => o switch
{
    { Total: >= 100 }                                  => 0m,
    { Customer.IsVip: true }                           => 0m,
    { ShippingAddress.Country: "DE" or "AT" or "CH" }  => 4.90m,
    { ShippingAddress.Country: not null }              => 12.90m,
    _ => throw new InvalidOperationException("No shipping address")
};

public static IResult ToHttp<T>(Result<T> r) => r switch
{
    { IsSuccess: true } => Results.Ok(r.Value),
    { Error.Code: var c } when c.EndsWith("not_found") => Results.NotFound(),
    { Error.Code: "conflict" } => Results.Conflict(),
    _ => Results.BadRequest(r.Error)
};

string Describe(int[] xs) => xs switch
{
    [] => "empty",
    [var only] => $"one item: {only}",
    [var first, .. var middle, var last] => $"{first}…{last} ({middle.Length} in between)"
};
```

That's exactly the missing `default` from the pull request at the start of this chapter — it wasn't an oversight the reviewer should have caught. What makes `switch` expressions genuinely safer than an old-style `if`/`else` chain, not just shorter, is what the compiler checks on your behalf: it checks **exhaustiveness** — a compiler warning if your arms don't provably cover every possible case — and **subsumption**, an error if an earlier arm already matches everything a later arm would, making that later arm permanently unreachable dead code. A switch expression that genuinely finds no matching arm at runtime (something exhaustiveness checking is supposed to prevent, but — as Microsoft's own docs note — can't always guarantee for every pattern shape, list patterns among them) throws `SwitchExpressionException` rather than silently doing nothing.

![A switch expression tries each arm in source order and stops at the first match; arms after it never run](visuals/switch-arms-narrowing.svg)

## Records: types built for carrying data, not identity {b}

A **record** is designed around a different default assumption from a class: that two instances with the same data genuinely *are* the same thing, rather than being two distinct objects that happen to look alike. To make that assumption cheap to express, the compiler generates value-based `Equals`/`GetHashCode`, a readable `ToString`, `Deconstruct`, a copy constructor, and support for `with` — all automatically, from a one-line declaration:

```csharp
public record ProductDto(int Id, string Name, decimal Price);       // positional record class

var a = new ProductDto(1, "Mouse", 20m);
var b = a with { Price = 18m };                 // non-destructive mutation: a copy with one change
Console.WriteLine(a == new ProductDto(1, "Mouse", 20m));   // True: value equality
Console.WriteLine(a);                           // ProductDto { Id = 1, Name = Mouse, Price = 20 }
var (id, name, _) = a;                          // deconstruction

public record struct Point(int X, int Y);       // value-type record (mutable by default)
public readonly record struct Money(decimal Amount, string Currency);

public abstract record Shape;                   // records support inheritance (record classes)
public sealed record Circle(double Radius) : Shape;
```

That `a == new ProductDto(1, "Mouse", 20m)` line returning `True` is the whole point made concrete: these are two entirely separate objects in memory, yet `==` says they're equal, because a record's equality compares *values*, field by field, not references — exactly the "Records" row from [Type system](ch:type-system#equality-three-different-questions-similar-syntax)'s equality table. `with` gives you non-destructive updates on top of that: `b` is a brand-new object, a full copy of `a` except for the one property you named, leaving `a` itself completely untouched.

| Use a record for | Use a class for |
|---|---|
| DTOs, API request/response models | Entities with identity and lifecycle (EF Core entities) |
| Commands, queries, events, messages | Services with dependencies and behaviour |
| Value objects (Money, Address) | Mutable objects with complex invariants |
| Configuration snapshots, results | Anything where reference identity matters |

:::gotcha A record's generated equality is shallow — and that can genuinely surprise you
`public record Cart(List<Item> Items);` looks immutable, and in one sense it is — nothing stops you reassigning `Cart.Items` to a different list after construction, true, but that's not the trap. The real trap: `cart.Items.Add(...)` still works perfectly fine, because the `List<Item>` itself was never made immutable, only the record's own property is "init-only". And the generated equality compares the **list reference**, not its contents — two carts holding lists with identical items, added in the same order, won't be considered equal unless they happen to share the exact same `List<Item>` instance. If you need genuine deep immutability and deep equality, use `IReadOnlyList<T>` or `ImmutableArray<T>` for the property, and write custom equality logic if the default field-by-field comparison isn't what you actually need.
:::

## init and required: forcing the caller to set what matters {b}

```csharp
public class CreateOrderRequest
{
    public required int CustomerId { get; init; }        // must be set; can't change afterwards
    public required List<LineDto> Lines { get; init; }
    public string? CouponCode { get; init; }              // optional, still immutable after init
}

var req = new CreateOrderRequest { CustomerId = 42, Lines = [] };   // ✔
var bad = new CreateOrderRequest { CustomerId = 42 };               // ✘ CS9035: required member 'Lines' not set
req.CouponCode = "X";                                               // ✘ init-only
```

These two keywords solve two separate, complementary problems. `init` restricts *when* a property can be set — only during object initialisation, never afterward — giving you immutability without needing a big, repetitive constructor to enforce it. `required` (C# 11) goes further, forcing the *compiler* to check that a caller actually set a given property at all; skip `Lines` on construction and you get `CS9035`, a compile error, rather than discovering a silently-empty list of order lines at runtime. The combination of the two, `required ... { get; init; }`, is as close as C# gets to "the caller absolutely must provide this, and nothing can ever change it afterward" — all enforced before the code even runs.

This isn't purely a compile-time nicety either: `required` is understood by `System.Text.Json` too, so a missing JSON property for a `required` member causes an actual deserialisation error, rather than silently leaving it at its default. `[SetsRequiredMembers]` on a constructor is the escape hatch for when you're providing an alternative way to guarantee the required members are set, telling the compiler "trust this constructor, it covers them all."

## Tuples and deconstruction {b}

```csharp
(int Count, decimal Total) Summarise(IEnumerable<Order> orders) => (orders.Count(), orders.Sum(o => o.Total));

var (count, total) = Summarise(orders);              // deconstruct
var summary = Summarise(orders);
Console.WriteLine(summary.Total);                    // named elements
(a, b) = (b, a);                                     // swap without a temp variable

foreach (var (key, value) in dictionary) { }         // KeyValuePair deconstruction
```

`ValueTuple`, what `(int, decimal)` actually is underneath, is a **mutable struct** — which immediately tells you where it belongs and where it doesn't, by the same reasoning from [Type system](ch:type-system#when-a-struct-actually-earns-its-keep): fine for a quick, **private or internal** multi-value return where defining a whole named type feels like overkill, but the wrong choice for a public API or anything persisted. A record gives you named, evolvable, properly-serialisable members for a few extra characters — worth it the moment the value crosses a real boundary.

## Extension methods and extension members: adding capability without touching the original type {i}

**Extension methods** (a C# 3 feature — old enough that you've definitely already used dozens without necessarily naming the mechanism) let you add methods to an existing type without touching its source at all. Under the hood they're ordinary static methods in a static class, where the first parameter carries a `this` modifier. LINQ's entire operator set, `IServiceCollection.AddXyz()`, `app.MapXyz()` — all of these are extension methods. That's precisely why `IServiceCollection` itself, a tiny interface at its core, seems to have an enormous API surface once you count every library's extension methods on top of it.

```csharp
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddOrdering(this IServiceCollection services, IConfiguration config)
    {
        services.AddScoped<IOrderService, OrderService>();
        services.AddOptions<OrderingOptions>().Bind(config.GetSection("Ordering")).ValidateOnStart();
        return services;                 // return for fluent chaining
    }
}

builder.Services.AddOrdering(builder.Configuration);   // reads like a built-in method
```

This is the exact mechanism behind the `Add<Feature>()` / `Map<Feature>()` convention you'll see throughout [Dependency injection](ch:dependency-injection#a-tour-of-the-registration-api) and elsewhere in this book: it's how every library plugs itself cleanly into ASP.NET Core, and it's how you keep your own `Program.cs` from turning into a wall of raw registration calls.

**Extension members** (C# 14) extend the same idea beyond methods, to properties, static members and operators, using a new `extension` block:

```csharp
public static class OrderExtensions
{
    extension(Order order)
    {
        public bool IsBig => order.Total > 1_000m;               // extension property
        public Money TotalWithTax(decimal rate) => order.Total * (1 + rate);
    }
}
if (order.IsBig) { }
```

Three rules worth knowing before you reach for this (confirmed against Microsoft's [CS0122 reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs0122) and the [extension methods guide](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods)): extensions can never access an object's *private* members, the same restriction extension methods have always had; a real instance member always wins over an extension with the same signature, if both exist — the extension only fills in gaps, never overrides; and the extension's own namespace has to be imported at the call site, same as any other extension method, for the compiler to find it at all.

## Less ceremony: top-level statements, global usings, file-scoped namespaces {b}

```csharp
// Program.cs: top-level statements (C# 9). The compiler generates the Main method.
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/", () => "Hello");
app.Run();
```

```csharp
// GlobalUsings.cs (or <Using Include="..."/> in the csproj)
global using Shop.Domain;
global using Microsoft.EntityFrameworkCore;

// Any file: file-scoped namespace (C# 10), one less indentation level
namespace Shop.Api.Orders;
public class OrderEndpoints { }
```

None of these three change what the compiled code actually does — they exist purely to remove ceremony that every single C# file used to repeat. Top-level statements mean `Program.cs` is no longer wrapped in a `class Program { static void Main(string[] args) { ... } }` you never actually needed to think about; the compiler generates that scaffolding silently. Global usings move a `using` you'd otherwise retype at the top of every file into one shared place. File-scoped namespaces drop one level of `{ }` indentation that used to wrap an entire file's contents for no real benefit. `<ImplicitUsings>enable</ImplicitUsings>` goes further still, adding a set of SDK-specific global usings automatically (`System`, `System.Linq`, `System.Threading.Tasks`, `Microsoft.AspNetCore.Builder`, `Microsoft.Extensions.DependencyInjection`, and more) — which is a large part of why modern minimal API code can get away with no `using` statements at the top at all.

## Primary constructors and collection expressions {i}

```csharp
// Primary constructor (C# 12): perfect for DI-injected services
public sealed class CheckoutService(IOrderRepository orders, IPaymentGateway payments, TimeProvider clock)
{
    public async Task<Result<OrderId>> CheckoutAsync(Cart cart, CancellationToken ct)
    {
        var order = Order.Create(cart, clock.GetUtcNow());
        // orders, payments, clock are in scope everywhere in the class
        await payments.ChargeAsync(order.Total, ct);
        orders.Add(order);
        return order.Id;
    }
}

// Collection expressions (C# 12): one syntax for arrays, lists, spans, immutable collections…
int[] a = [1, 2, 3];
List<string> names = [];
ImmutableArray<int> imm = [1, 2];
ReadOnlySpan<byte> bytes = [0x48, 0x49];
int[] merged = [..a, ..other, 99];        // spread
```

[OOP](ch:oop#primary-constructors-the-modern-shorthand) already covered primary constructors properly, including the one genuine gotcha worth remembering (their parameters are reassignable, not automatically `readonly` fields). Collection expressions deserve a mention of their own, purely for the uniformity they bring. Before C# 12, an array, a `List<T>`, an `ImmutableArray<T>` and a `Span<T>` each needed their own distinct initialisation syntax. Now `[...]` works for all of them — the compiler picks the right concrete construction based on the variable's declared type. One syntax to learn, reused everywhere a sequence of values needs creating.

## Strings: interpolation and raw literals {i}

```csharp
var msg = $"Order {order.Id} total {order.Total:C2} placed {order.CreatedAt:yyyy-MM-dd}";
var aligned = $"|{name,-20}|{qty,5}|";          // alignment
var path = @"C:\data\orders";                    // verbatim: no escape processing

var json = """
    {
      "name": "Keyboard",
      "tags": ["office", "usb"]
    }
    """;                                         // raw string literal (C# 11): no escaping, indentation trimmed

var template = $$"""
    { "id": {{order.Id}}, "literal": "{braces}" }
    """;                                         // $$ means {{x}} interpolates and single { } are literal
```

Raw string literals exist specifically because embedding JSON, regex, or SQL inside a normal C# string means constantly escaping quotes and backslashes that mean something different in the two languages at once. A triple-quoted raw string sidesteps that entirely — what you see between the `"""` markers is exactly, literally, what you get, with no escaping required for anything inside it.

Worth knowing precisely: interpolated strings aren't naive string concatenation under the hood — they compile through `DefaultInterpolatedStringHandler`, which avoids boxing value-type arguments and avoids unnecessary intermediate string allocations along the way. That efficiency, though, comes with one important exception worth remembering: **don't use interpolated strings in log messages**. [Errors & logging](ch:errors-logging) explains exactly why — a log call needs its arguments to stay as separate, structured values a log store can query on, and string interpolation collapses them into one opaque, pre-formatted string before the logger ever sees them.

## Other quality-of-life features worth recognising on sight {i}

| Feature | Example |
|---|---|
| Target-typed `new` | `Dictionary<string, List<int>> map = new();` |
| `nameof` | `throw new ArgumentNullException(nameof(order));`, survives renames |
| Ranges and indices | `items[^1]`, `items[1..^1]`, `text[..10]` |
| `using` declaration | `using var scope = logger.BeginScope(...);` |
| Static lambdas | `list.Select(static x => x * 2)`: prevents accidental capture |
| Local functions | Helper methods inside a method; can be `static` |
| Default lambda parameters | `var greet = (string name = "you") => $"Hi {name}";` |
| Type aliases | `using OrderMap = System.Collections.Generic.Dictionary<int, Order>;`, any type since C# 12 |
| `params` collections | `void Log(params ReadOnlySpan<string> parts)`: no array allocation |
| New `Lock` type | `private readonly Lock _gate = new(); lock (_gate) { }`, faster than locking on object |
| `field` keyword | `public string Name { get; set => field = value.Trim(); }` |
| UTF-8 literals | `ReadOnlySpan<byte> h = "Content-Type"u8;` |

A couple of these are worth a second's thought rather than just filing away as syntax. `nameof(order)` isn't just a shorter way to write `"order"` — the key benefit is that it's checked by the compiler and tied to the actual identifier, so renaming the parameter and forgetting to update a hard-coded string message simply can't happen; the compiler won't let the two drift apart. Static lambdas are the direct, deliberate enforcement mechanism for the closure-cost discussion in [Delegates, lambdas and closures](ch:delegates-events#closures-when-a-lambda-outlives-the-method-it-was-written-in) — marking a lambda `static` is you telling the compiler "I don't intend to capture anything here, please fail to compile if I accidentally do."

:::qa What are nullable reference types and do they prevent NullReferenceException at runtime?
A compiler feature (enabled with &lt;Nullable&gt;) that treats reference types as non-null by default, so `T?` means "may be null", and it warns about possible null dereferences through flow analysis. It's compile-time only: there are no runtime checks, so values from deserialisation, reflection or unannotated code can still be null. Validate at boundaries.
:::

:::qa What does the null-forgiving operator (!) do?
It suppresses a nullable warning for that expression. It has no runtime effect. Overusing it defeats the feature.
:::

:::qa What is a record and how is it different from a class?
A record is a class (or struct with `record struct`) for which the compiler generates value-based equality and GetHashCode, ToString, Deconstruct and `with` support. Two records with equal property values are equal. Classes use reference equality by default. Use records for data (DTOs, messages, value objects) and classes for entities and services.
:::

:::qa What's the difference between init and required?
`init` makes a property settable only during object initialisation. `required` forces callers to set the property in the initialiser, checked by the compiler. They're often combined: `public required string Email { get; init; }`.
:::

:::qa Explain switch expressions and property patterns.
A switch expression evaluates arms top-down and returns the first matching arm's value: `x switch { pattern => value, _ => default }`. Property patterns match on members, `{ Status: Paid, Total: > 100 }`, and nest (`{ Customer.Country: "DE" }`). The compiler warns if not all cases are covered.
:::

:::qa How do extension methods work and how does ASP.NET Core use them?
They are static methods in static classes whose first parameter is marked with `this`. The compiler lets you call them as instance methods on that type. ASP.NET Core and libraries expose their setup as extension methods on IServiceCollection (AddX) and IEndpointRouteBuilder/IApplicationBuilder (MapX/UseX), which is the convention for organising Program.cs.
:::

:::qa What are primary constructors and what's a gotcha?
C# 12 lets classes declare constructor parameters in the type header, and those parameters are in scope throughout the class body, which suits DI. The gotcha: they're mutable captured parameters, not readonly fields, and capturing them in a struct or in several members stores them as hidden fields.
:::

:::qa What are tuples good for and when would you avoid them?
Lightweight multi-value returns and deconstruction for private or internal code. Avoid them in public APIs and persisted contracts, where a named record is clearer, can evolve, and has proper property names in serialisation.
:::

## Further reading

- [What's new in C# (every version)](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/)
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — extension members, the `field` keyword, null-conditional assignment, `nameof` on unbound generics
- [Nullable reference types](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references)
- [Pattern matching overview](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/patterns/pattern-matching) — exhaustiveness and subsumption, straight from the source
- [SwitchExpressionException class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.switchexpressionexception)
- [Records](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) — confirms `record struct` is mutable by default; only `readonly record struct` is immutable

## Verify this chapter

Run with `dotnet run` in a plain console project (`dotnet new console`) — no extra packages needed. It checks record value equality, `with`, the shallow-equality gotcha, `required` enforced through JSON, pattern matching, extension methods and collection expressions.

```csharp
using System.Text.Json;

void Check(bool condition, string claim)
{
    if (!condition) throw new Exception($"FAIL: {claim}");
    Console.WriteLine($"OK: {claim}");
}

// 1. Records have value equality: two separate instances with equal properties are ==.
var a = new ProductDto(1, "Mouse", 20m);
var sameValues = new ProductDto(1, "Mouse", 20m);
Check(!ReferenceEquals(a, sameValues) && a == sameValues, "Two separate record instances with equal properties are == (value equality)");

// 2. `with` produces a non-destructive copy: the original is untouched, the copy has the one changed property.
var b = a with { Price = 18m };
Check(a.Price == 20m, "The original record is untouched after `with`");
Check(b.Price == 18m && b.Id == a.Id && b.Name == a.Name, "`with` copies every property except the one(s) explicitly changed");

// 3. A record's generated equality is SHALLOW for reference-type members: two carts with equal-content
//    lists (different List<T> instances) are NOT equal, because the list REFERENCE is compared.
var cart1 = new Cart(new List<string> { "sku-1", "sku-2" });
var cart2 = new Cart(new List<string> { "sku-1", "sku-2" });
Check(cart1 != cart2, "Two records holding different List<T> instances with identical contents are NOT equal (equality is shallow/by-reference for that member)");
var cart3 = new Cart(cart1.Items);   // same list reference
Check(cart1 == cart3, "Two records sharing the SAME list reference ARE equal");

// 4. `required` is enforced by System.Text.Json: a missing required property fails deserialization.
var jsonMissingRequired = """{ "CustomerId": 42 }""";   // "Lines" is required and missing
bool threwOnMissingRequired = false;
try { JsonSerializer.Deserialize<CreateOrderRequest>(jsonMissingRequired); }
catch (JsonException) { threwOnMissingRequired = true; }
Check(threwOnMissingRequired, "System.Text.Json throws JsonException when a `required` property is missing from the JSON");

var jsonComplete = """{ "CustomerId": 42, "Lines": ["sku-1"] }""";
var deserialized = JsonSerializer.Deserialize<CreateOrderRequest>(jsonComplete);
Check(deserialized is { CustomerId: 42 }, "System.Text.Json deserializes successfully once every `required` property is present");

// 5. Pattern matching: property patterns and list patterns match the shapes the chapter describes.
Check(Describe(new[] { 1, 2, 3 }) == "first=1 last=3 middle=1", "A list pattern [first, .. middle, last] destructures a 3+ element array correctly");
Check(Describe(Array.Empty<int>()) == "empty", "A list pattern [] matches an empty array");
Check(ShippingFee(new Order(Total: 150, IsVip: false)) == 0m, "A property pattern on Total >= 100 matches and returns free shipping");
Check(ShippingFee(new Order(Total: 10, IsVip: true)) == 0m, "A property pattern on IsVip matches and returns free shipping regardless of total");

// 6. Extension methods add capability to an existing type without modifying its source.
Check("hello world".IsTitleCaseWord() == false, "An extension method (IsTitleCaseWord) works like an instance method on a type it didn't define");
Check("Hello".IsTitleCaseWord() == true, "An extension method correctly identifies a title-case word");

// 7. Collection expressions produce the right concrete type for the declared variable.
int[] arr = [1, 2, 3];
List<string> list = ["a", "b"];
Check(arr.Length == 3 && arr is int[], "A collection expression assigned to int[] produces an array");
Check(list.Count == 2 && list is List<string>, "The same [...] syntax assigned to List<string> produces a List<T>");

Console.WriteLine("All modern-csharp claims verified.");

string Describe(int[] xs) => xs switch
{
    [] => "empty",
    [var only] => $"one item: {only}",
    [var first, .. var middle, var last] => $"first={first} last={last} middle={middle.Length}"
};

decimal ShippingFee(Order o) => o switch
{
    { Total: >= 100 } => 0m,
    { IsVip: true } => 0m,
    _ => 12.90m
};

public record ProductDto(int Id, string Name, decimal Price);
public record Cart(List<string> Items);
public record Order(decimal Total, bool IsVip);

public class CreateOrderRequest
{
    public required int CustomerId { get; init; }
    public required List<string> Lines { get; init; }
}

public static class StringExtensions
{
    public static bool IsTitleCaseWord(this string s) => s.Length > 0 && char.IsUpper(s[0]) && s.Skip(1).All(char.IsLower);
}
```

Not attempted here: nullable reference type warnings are a compiler-time analysis, not something a running program can assert on — that claim is checked by reading the compiler's own warnings (`CS8602` etc.) when you build with `<Nullable>enable</Nullable>`, not by running anything.
