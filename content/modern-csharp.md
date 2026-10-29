---
id: modern-csharp
title: "Modern C#: Let the Compiler Catch It (Nullability, Patterns, Records)"
summary: "Episode 9. A 3 a.m. NullReferenceException and 40-line data classes. Modern C# makes the compiler warn about nulls before you ship, replaces if/else chains with pattern matching, and turns data classes into one-line records. Covers nullable reference types, switch expressions and patterns, records, init and required, tuples, extension methods and members, top-level statements, primary constructors, collection expressions, raw strings, and a version-by-version map."
layer: language
where: C# language › Modern language features
fits: Layer 1. These are mostly compiler features with no new runtime abilities, but modern ASP.NET Core code (layer 3) uses them everywhere. File-scoped namespaces, top-level `Program.cs`, records as DTOs and primary-constructor services all come from here. Knowing them lets you read current code fluently.
levels: b,i,a
prereqs: type-system, oop
next: advanced-csharp, building-apis
---

## The 30-second version

- **Nullable reference types**: write `string?` for "may be null". The compiler then **tracks nulls through your code** and warns before you ship. It's compile-time only, so still check data at the edges of your app.
- **Pattern matching**: `switch` expressions test a value's *shape* (`{ Total: >= 100 }`, `"GB" or "IE"`, `[first, .., last]`), and the compiler checks you covered every case.
- **Records**: `record OrderDto(int Id, decimal Total);` is one line with value equality, `ToString` and `with`-copies built in. Use them for data, and classes for things with identity.
- **`init` and `required`**: set once while the object is built, and *must* be set.
- Plus **less ceremony**: top-level `Program.cs`, global usings, file-scoped namespaces, primary constructors, `[1, 2, 3]` collection expressions and raw `"""strings"""`.

## Words you'll meet

| Word | In plain words |
|---|---|
| **nullable reference type** | Writing `string?` to say "this might be null". Plain `string` then means "never null". |
| **flow analysis** | The compiler following your code line by line to work out what's safe at each point. |
| **null-forgiving `!`** | "Trust me, it isn't null." It silences a warning and checks nothing. |
| **pattern** | A description of a value's shape, like `{ Total: >= 100 }` or `"GB" or "IE"`. |
| **switch expression** | `x switch { pattern => result, … }`: a table of rules, tried from top to bottom. |
| **record** | A type for data: two records with the same values are equal. |
| **`with`** | Make a copy of a record with some values changed. |
| **`init` / `required`** | Settable only while the object is built / must be set while it's built. |
| **extension method** | A static method you can call with a dot, as if the type had it. |

## Previously, and the 3 a.m. page {b}

In [Episode 8](ch:async-await) Kettle survived Black Friday. At 3 a.m. the pager goes off. Shipping-label generation is crashing:

:::walk The 3 a.m. crash, step by step
```csharp
var customers = new[]
{
    new Customer("Ada", new Address("SW1A 1AA")),
    new Customer("Bob", null),                    // signed up, never entered an address
};

foreach (var c in customers)
    Console.WriteLine($"Label for {c.Name}: {c.Address.Postcode}");   // 💥 for Bob

record Address(string Postcode);
record Customer(string Name, Address Address);
```
@10-11 | -
`Customer` has an `Address`. The type says nothing about whether it can be missing.
@1-5 | customers = [Ada → Address(SW1A 1AA), Bob → null]
Bob signed up and never entered an address, so his `Address` is `null`: an arrow that points at nothing.
@7-8 | c = Ada ; c.Address = → Address(SW1A 1AA) | > Label for Ada: SW1A 1AA
Ada's address exists, so `.Postcode` follows the arrow and reads it.
@7 | c = Bob ; c.Address = null
Next customer.
@8 | c = Bob ; c.Address = null | ! NullReferenceException: Object reference not set to an instance of an object.
`c.Address.Postcode` tries to follow an arrow that points nowhere, and the program crashes. Everything after this, every other customer's label, never happens. Press **Run** to see the real crash.
:::

Ada's label prints, then **`NullReferenceException`**. It's the most common crash in C# history. The type said `Address`, the data said "nothing", and nothing warned anyone until a customer hit it in production.

And the crash didn't just skip Bob. The label job ran as one loop over the night's orders, so one bad customer stopped it halfway. Four hundred parcels missed the morning van. The fix took one line. Finding it took two hours, at night, from a stack trace.

## The lightbulb: make the compiler worry about it {b}

The bug wasn't really the missing address. The bug was that the *code* had no way to say **"an address might be missing"**. So the compiler couldn't remind you to handle it.

Modern C# lets you say it. With **nullable reference types** turned on (`<Nullable>enable</Nullable>`, the default in new projects), a plain `Address` means **"never null"** and `Address?` means **"might be null"**. The compiler then follows your code line by line, a technique called **flow analysis**, and warns wherever you use a maybe-null value without checking it.

That's the theme of this whole episode: modern C# features mostly **move mistakes from runtime to compile time**, and cut the boilerplate while they're at it.

## Nullable reference types: the compiler tracks maybe-null {b}

:::scene visuals/scenes/mod-null-flow.svg | Following a maybe-null value through your code
1. `Address?` says "this can be missing". From now on the compiler treats `Address` as **maybe null**.
2. `c.Address.Postcode` uses it without a check, so you get **warning CS8602: possible null dereference**. The 3 a.m. crash shows up as a squiggle while you type.
3. `if (c.Address is null) return …;` After this line the compiler **knows** `Address` isn't null.
4. The same `c.Address.Postcode` is now provably safe, with no warning. The compiler followed your logic.
5. The catch: this is **compile-time only**. JSON with a missing field, a database `NULL` or old un-annotated code can still give you `null` at runtime. Check data where it enters your app.
:::

The fixed Kettle code:

:::walk The fix: say "might be missing", then handle it
```csharp
var customers = new[] { new Customer("Ada", new Address("SW1A 1AA")), new Customer("Bob", null) };
foreach (var c in customers) Console.WriteLine(LabelFor(c));

static string LabelFor(Customer c)
{
    if (c.Address is null) return $"{c.Name}: no address, so offer click & collect";
    return $"{c.Name}: ship to {c.Address.Postcode}";    // the compiler knows Address isn't null here
}

record Address(string Postcode);
record Customer(string Name, Address? Address);         // ← the ? is the whole fix: "may be missing"
```
@11 | -
The whole fix starts with one character: `Address?`. Now the type **says** an address may be missing, and the compiler holds you to it. Writing `c.Address.Postcode` without a check would now be a warning in your editor.
@2 | c = Ada
Make a label for each customer.
@6 | c = Ada ; c.Address = → Address(SW1A 1AA)
Check first. Ada has an address, so carry on.
@7 | | > Ada: ship to SW1A 1AA
After the check, the compiler **knows** `Address` isn't null here, so there's no warning.
@6 | c = Bob ; c.Address = null | > Bob: no address, so offer click & collect
Bob has no address. Instead of crashing, the code takes the path for missing addresses, and the loop carries on to the next customer.
:::

The null toolkit:

| Syntax | Meaning |
|---|---|
| `string?` | may be null |
| `x?.Prop` | `null` if `x` is null, otherwise `x.Prop` |
| `x ?? fallback` | use `fallback` if `x` is null |
| `x ??= value` | assign only if `x` is null |
| `x!` | **null-forgiving**: "trust me". It silences the warning and checks nothing. Use it rarely |
| `[NotNullWhen(true)]` and friends | teach the compiler your method's null rules |

:::walk The null operators
```csharp
string? coupon = null;
Console.WriteLine(coupon?.ToUpper() ?? "(no coupon)");   // ?. then ??
coupon ??= "WELCOME10";
Console.WriteLine(coupon);
```
@1 | coupon = null
A coupon that hasn't been entered.
@2 | | > (no coupon)
`coupon?.ToUpper()` means "call `ToUpper` only if `coupon` isn't null". It's null, so the whole expression is `null`. Then `??` supplies a fallback.
@3 | coupon = "WELCOME10"
`??=` assigns only if the variable is currently null.
@4 | | > WELCOME10
:::

That last row matters for your own `Try…` methods:

```csharp norun
public bool TryFind(int id, [NotNullWhen(true)] out Order? order) { … }

if (TryFind(5, out var o)) Console.WriteLine(o.Total);   // no warning: o is non-null when it returned true
```

**EF Core and ASP.NET Core read these annotations too.** A `string` property becomes a `NOT NULL` column and `string?` becomes nullable. A non-nullable property in a request model is treated as required.

:::qa What are nullable reference types and do they prevent NullReferenceException at runtime?
A compiler feature, enabled with `<Nullable>`, that treats reference types as non-null by default. `T?` then means "may be null", and the compiler uses flow analysis to warn about possible null dereferences. It's compile-time only, with no runtime checks, so values from deserialisation, reflection or unannotated code can still be null. Validate at the boundaries.
:::

:::qa What does the null-forgiving operator (!) do?
`x!` tells the compiler to treat `x` as non-null and suppresses the warning. It does nothing at runtime: if `x` is actually null, you still get a NullReferenceException later. Use it only when you know something the compiler can't, such as values set by a framework, and prefer real checks or nullability attributes.
:::

## Pattern matching: test the shape of a value {b}

Next, the shipping-fee rules. Written the old way, they turn into an `if/else` maze:

```csharp norun
if (order.Total >= 100) fee = 0;
else if (order.Customer.IsVip) fee = 0;
else if (order.Country == "GB" || order.Country == "IE") fee = 3.95m;
else if (order.Country != null) fee = 12.90m;
else throw new InvalidOperationException("No country");
```

A **switch expression** says the same thing as a table of rules. Each arm is a **pattern**, a description of the *shape* a value must have:

:::walk Rules as a table, tried from the top
```csharp
Console.WriteLine(Fee(new Order(120m, false, "FR")));   // 0
Console.WriteLine(Fee(new Order(40m, true, "FR")));     // 0
Console.WriteLine(Fee(new Order(40m, false, "IE")));    // 3.95
Console.WriteLine(Fee(new Order(40m, false, "US")));    // 12.90

static decimal Fee(Order o) => o switch
{
    { Total: >= 100 }            => 0m,        // property + relational pattern
    { IsVip: true }              => 0m,
    { Country: "GB" or "IE" }    => 3.95m,     // logical "or" pattern
    { Country: not null }        => 12.90m,
    _                            => throw new InvalidOperationException("No country"),
};

record Order(decimal Total, bool IsVip, string? Country);
```
@6-13 | -
Each arm is a **pattern**: a description of a shape. The first arm that matches wins.
@1 | o = Order(Total 120, not VIP, FR)
A £120 order to France.
@8 | o = Order(Total 120, not VIP, FR) | > 0
First arm: is `Total` at least 100? Yes, so free shipping. The other arms aren't even checked.
@2 | o = Order(Total 40, VIP, FR)
A £40 order from a VIP.
@9 | o = Order(Total 40, VIP, FR) | > 0
The first arm fails (40 < 100). The second asks "is `IsVip` true?", and it is.
@3 | o = Order(Total 40, not VIP, IE)
A £40 order to Ireland.
@10 | o = Order(Total 40, not VIP, IE) | > 3.95
Not over 100, not VIP, but `Country` is `"GB" or "IE"`.
@4 | o = Order(Total 40, not VIP, US)
A £40 order to the US.
@11 | o = Order(Total 40, not VIP, US) | > 12.90
Only "has a country at all" matches.
@12 | -
And an order with no country falls through to `_`, which matches anything. If you deleted this arm, the compiler would warn that some inputs aren't handled.
:::

:::scene visuals/scenes/mod-switch.svg | One order, tried against each arm
1. The arms are tried **from the top**. The first asks: is `Total` at least 100? For this order it's 40, so no.
2. Next arm: is this a VIP customer? No.
3. Next: is `Country` "GB" or "IE"? Yes. The **first match wins**.
4. The result is `3.95m`, and the arms below are never even checked. So order matters: put specific rules first.
:::

The arms are tried **top to bottom**, and the first match wins. The compiler also checks two things for you. **Exhaustiveness**: you get a warning if some input matches no arm. **Subsumption**: you get an error if an arm can never be reached because an earlier one already catches everything it would.

The pattern kinds:

| Pattern | Example | Matches when… |
|---|---|---|
| Type | `o is Order order` | it's an `Order`, and it's bound to `order` |
| Constant | `status is OrderStatus.Paid`, `x is null` | it equals the constant |
| Relational | `qty is > 0 and <= 10` | the comparison holds |
| Logical | `s is "y" or "yes"`, `x is not null` | `and` / `or` / `not` combine |
| Property | `{ Status: Paid, Total: > 100 }` | its properties match |
| Nested property | `{ Customer.Country: "GB" }` | a member path matches |
| List | `[var first, .., var last]`, `[]` | a sequence has that shape |
| Discard | `_` | anything |

:::walk Patterns for the shape of a list
```csharp
Console.WriteLine(Describe([]));
Console.WriteLine(Describe(["Sencha"]));
Console.WriteLine(Describe(["Sencha", "Assam", "Rooibos", "Chai"]));

static string Describe(string[] teas) => teas switch
{
    []                                   => "empty basket",
    [var only]                           => $"just {only}",
    [var first, .. var middle, var last] => $"{first} … {last} ({middle.Length} in between)",
};
```
@1 | teas = [ ]
An empty basket.
@7 | teas = [ ] | > empty basket
`[]` matches an empty array.
@2 | teas = [Sencha]
One tea.
@8 | teas = [Sencha] ; only = Sencha | > just Sencha
`[var only]` matches exactly one item and **names** it.
@3 | teas = [Sencha, Assam, Rooibos, Chai]
Four teas.
@9 | first = Sencha ; middle = [Assam, Rooibos] ; last = Chai | > Sencha … Chai (2 in between)
`[var first, .. var middle, var last]` names the first and last, and `..` collects everything between them.
:::

:::qa Explain switch expressions and property patterns.
A switch expression (`x switch { pattern => value, … }`) evaluates arms top to bottom and returns the first match. The compiler warns when the arms aren't exhaustive and errors on unreachable arms. Property patterns like `{ Status: Paid, Total: > 100 }` match on members, and can nest, combine with `and`/`or`/`not`, and use relational operators.
:::

## Records: data classes in one line {b}

Kettle has dozens of small "just data" types: API requests, responses, events. As classes, each one needs equality, `ToString` and copying written by hand, about 40 lines of boilerplate per type that has to be kept in sync.

A **record** is a type designed for **data**. Two records with the same values *are* equal, and the compiler writes everything else.

:::scene visuals/scenes/mod-records.svg | 40 lines of boilerplate, or one line
1. A plain class with three fields. Two instances with **identical data** are **not** `==`, because a class compares references (two objects means "different").
2. To make it behave like data, you'd hand-write `Equals`, `GetHashCode`, `==`, `!=`, `ToString`, `Deconstruct` and a copy method. That's about 40 lines to keep in sync every time a field changes.
3. **`record OrderDto(int Id, string Tea, decimal Total);`** is one line. The compiler generates all of it, so identical data is now `==`, and `ToString` is readable.
4. **`with`** makes a changed **copy**. The original is untouched, so records are safe to pass around and share.
:::

:::walk What a one-line record gives you
```csharp
var a = new OrderDto(1, "Sencha", 6m);
var b = a with { Total = 9m };                            // a copy with one change

Console.WriteLine(a);                                     // OrderDto { Id = 1, Tea = Sencha, Total = 6 }
Console.WriteLine(a == new OrderDto(1, "Sencha", 6m));    // True: compared by value
Console.WriteLine($"{a.Total} → {b.Total}");              // 6 → 9: a didn't change
var (id, tea, _) = a;                                     // deconstruction
Console.WriteLine($"{id}: {tea}");

public record OrderDto(int Id, string Tea, decimal Total);        // record class (a reference type)
public readonly record struct Money(decimal Amount, string Currency);   // record struct (a value type)
```
@10 | -
One line. The compiler writes the constructor, the properties, `Equals`, `GetHashCode`, `==`, `ToString`, `Deconstruct` and copying.
@1 | a = → OrderDto { Id = 1, Tea = Sencha, Total = 6 }
Create one.
@2 | a = → OrderDto { 1, Sencha, 6 } ; b = → OrderDto { 1, Sencha, 9 } (a new object)
`with` makes a **copy** with one property changed. `a` is untouched.
@4 | | > OrderDto { Id = 1, Tea = Sencha, Total = 6 }
The generated `ToString` shows the data. That's useful in logs.
@5 | | > True
A separate object with the same values is `==`, because records compare by value.
@6 | | > 6 → 9
The original kept its 6, so a record is safe to pass around: nobody can change it under you.
@7-8 | id = 1 ; tea = Sencha | > 1: Sencha
Deconstruction pulls the values out into variables. `_` skips the one you don't need.
:::

| Use a **record** for | Use a **class** for |
|---|---|
| API requests and responses (DTOs) | EF Core entities (they have identity and a lifecycle) |
| Commands, queries, events, messages | Services with dependencies and behaviour |
| Value objects (`Money`, `Address`) | Objects with complex rules that change over time |

:::gotcha Record equality is shallow
`record Basket(List<string> Items)` compares the **list reference**, not its contents. Two baskets with identical items in different `List` objects are **not** equal. And `basket.Items.Add(…)` still works, because the record is immutable but the list inside it isn't. For real value semantics, use immutable collections or override `Equals`.
:::

:::qa What is a record and how is it different from a class?
A record is a type with compiler-generated value-based equality, `GetHashCode`, `ToString`, `Deconstruct` (for positional records) and `with`-expression support. It's designed for immutable data. Classes compare by reference by default. A `record` is a reference type and a `record struct` is a value type.
:::

## init and required: set once, and don't forget {b}

:::plain
Some properties should be set exactly once, when the object is created, and some must never be forgotten. `init` handles the first and `required` the second, and the compiler enforces both.
:::

:::scene visuals/scenes/mod-init.svg | The window where init and required apply
1. `new CreateOrderRequest { … }` runs the **constructor** first, as always.
2. Then comes the **`{ … }` window**, the object initialiser. Here `init` properties may be set, and `required` ones must be.
3. Leave out a `required` member and it's **compile error CS9035**. You find out now, not at 3 a.m.
4. Once the object is built, it's **locked**: assigning an `init` property later is also a compile error.
5. In short, **`init`** answers "*when* may this be set?" (only during creation), and **`required`** answers "*must* it be set?" (yes). Together they mean set once and never forgotten.
:::

:::walk Set once, and you can't forget
```csharp
var req = new CreateOrderRequest { CustomerId = 42, Teas = ["Sencha"] };
Console.WriteLine($"{req.CustomerId}: {string.Join(",", req.Teas)}, coupon {req.Coupon ?? "none"}");

// var bad = new CreateOrderRequest { CustomerId = 42 };   // ✗ CS9035: required member 'Teas' not set
// req.CustomerId = 7;                                      // ✗ init-only: locked after creation

class CreateOrderRequest
{
    public required int CustomerId { get; init; }
    public required List<string> Teas { get; init; }
    public string? Coupon { get; init; }                     // optional, but still locked once set
}
```
@9-11 | -
`required` means "you must set this when you create the object". `init` means "you can only set it then".
@1 | req = → CreateOrderRequest { CustomerId = 42, Teas = [Sencha], Coupon = null }
Both required properties are set. `Coupon` is optional, so it's left as `null`.
@2 | | > 42: Sencha, coupon none
@4 | ! CS9035: Required member 'CreateOrderRequest.Teas' must be set in the object initializer
Forget `Teas` and the build fails. With a plain property, you'd find out from a customer whose order had no items. (Commented out so the rest runs.)
@5 | ! CS8852: Init-only property 'CustomerId' can only be assigned in an object initializer
And once the object exists, it's locked. A request can't be quietly changed halfway through handling it.
:::

- **`init`** decides *when* a property can be set: only while the object is being created.
- **`required`** decides *whether* it must be set. Forget it and you get a **compile error**. `System.Text.Json` respects it too, so missing JSON fields become errors instead of silent defaults.

:::qa What's the difference between init and required?
`init` makes a property settable only during object initialisation, after which it's read-only. `required` forces callers to set the member when they create the object, or they get a compile error. They're often combined as `required … { get; init; }`, and `System.Text.Json` enforces `required` during deserialisation.
:::

## Tuples: quick multi-value returns {b}

:::walk Return two things without a class
```csharp
var teas = new[] { 6.50m, 4.25m, 9.00m };
var (count, total) = Summarise(teas);              // deconstruct into two variables
Console.WriteLine($"{count} teas, £{total}");

var a = 1; var b = 2;
(a, b) = (b, a);                                   // swap without a temp variable
Console.WriteLine($"{a} {b}");

static (int Count, decimal Total) Summarise(decimal[] prices) => (prices.Length, prices.Sum());
```
@1 | teas = [6.50, 4.25, 9.00]
Three prices.
@9 | -
The return type `(int Count, decimal Total)` is a **tuple**: two values with names, no class needed.
@2 | count = 3 ; total = 19.75
Deconstruct the result straight into two variables.
@3 | | > 3 teas, £19.75
@5 | a = 1 ; b = 2
Two variables.
@6 | a = 2 ; b = 1
Tuples also swap two variables in one line, without a temporary.
@7 | | > 2 1
:::

A tuple is a mutable struct with no real name. That's great for a quick **private** return of two or three values. For anything public, persisted or sent over the wire, use a record: it gets real names and can evolve.

:::qa What are tuples good for and when would you avoid them?
They're lightweight `ValueTuple` structs for returning or grouping a few values locally, with names and deconstruction. Avoid them in public APIs, persisted data or anything that crosses a boundary. Use a record there instead, for clear names, versioning and serialisation.
:::

## Extension methods and extension members {i}

:::plain
An extension method lets you call your own helper with a dot, as if the type had always had it. Underneath, it's an ordinary static method that takes the object as its first argument.
:::

An **extension method** adds a method to a type you don't own. It's really a static method whose first parameter has `this`:

:::scene visuals/scenes/mod-extension.svg | What `price.AsPounds()` really is
1. `price.AsPounds()` looks as if `decimal` suddenly has a new method.
2. It doesn't. The compiler rewrites the call into a plain static call: `KettleExtensions.AsPounds(price)`.
3. The word **`this`** on the first parameter is what allows the dot syntax. `price` becomes that argument.
4. That's why an extension can't see private members: it's just an outside method that's handed the object. All of LINQ, and every `builder.Services.AddXyz()`, is this same trick.
:::

:::walk A method that looks built in, but isn't
```csharp
var price = 12.5m;
Console.WriteLine(price.AsPounds());            // reads like a built-in method
Console.WriteLine("earl grey".ToTitle());

static class KettleExtensions
{
    public static string AsPounds(this decimal amount) => $"£{amount:0.00}";
    public static string ToTitle(this string s) =>
        string.Join(" ", s.Split(' ').Select(w => char.ToUpper(w[0]) + w[1..]));
}
```
@1 | price = 12.5
A price.
@2 | amount = 12.5
`price.AsPounds()` looks like a method on `decimal`. The compiler rewrites it into `KettleExtensions.AsPounds(price)`.
@7 | amount = 12.5 | > £12.50
The `this` on the first parameter is what makes the dot syntax work. The method is ordinary static code outside the type, so it can't see `decimal`'s private members.
@3 | s = "earl grey"
Same trick on `string`.
@8-9 | s = "earl grey" | > Earl Grey
Split into words, capitalise each first letter, join again.
:::

You've used hundreds of them already. **All of LINQ** is extension methods on `IEnumerable<T>` ([Episode 6](ch:linq)). So is every `builder.Services.AddXyz()` and `app.MapXyz()` in ASP.NET Core. That's how libraries plug themselves in:

```csharp norun
public static IServiceCollection AddKettleOrdering(this IServiceCollection services, IConfiguration config)
{
    services.AddScoped<IOrderService, OrderService>();
    services.AddOptions<OrderingOptions>().Bind(config.GetSection("Ordering")).ValidateOnStart();
    return services;    // returned so calls can be chained
}

builder.Services.AddKettleOrdering(builder.Configuration);
```

**Extension members** (C# 14) extend the idea to **properties** and static members, with an `extension` block:

```csharp norun
public static class OrderExtensions
{
    extension(Order order)
    {
        public bool IsBig => order.Total > 1_000m;     // an extension PROPERTY
    }
}
if (order.IsBig) { … }
```

The rules: extensions can't see **private** members, and a real member with the same signature always wins over an extension.

:::qa How do extension methods work and how does ASP.NET Core use them?
They're static methods in a static class, with `this` on the first parameter. The compiler lets you call them like instance methods when the namespace is imported. They can't access private members, and real members take precedence. ASP.NET Core uses them for its whole configuration API (`AddControllers`, `AddDbContext`, `UseAuthentication`, `MapGet`), so libraries can add fluent methods to `IServiceCollection` and `WebApplication`.
:::

## Less ceremony {b}

None of these change what your code *does*. They remove typing that every file used to repeat.

:::scene visuals/scenes/mod-toplevel.svg | Where did `Main` go?
1. A modern `Program.cs` has no class and no `Main` method, though old tutorials always had both.
2. They're still there. The compiler **generates** them around your lines. That's also why `args` works without being declared.
3. Global usings and file-scoped namespaces are the same kind of thing: less to type, and identical compiled code.
:::

```csharp norun
// Program.cs: top-level statements (C# 9). The compiler writes the Main method for you.
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/", () => "Welcome to Kettle");
app.Run();
```

```csharp norun
// GlobalUsings.cs: one place for usings every file needs (C# 10)
global using Kettle.Domain;
global using Microsoft.EntityFrameworkCore;

// any file: a file-scoped namespace, so there's one less level of indentation (C# 10)
namespace Kettle.Api.Orders;
public class OrderEndpoints { }
```

`<ImplicitUsings>enable</ImplicitUsings>` in the project file adds the common ones (`System`, `System.Linq`, `System.Threading.Tasks` and so on) for you.

## Primary constructors, collection expressions, raw strings {i}

:::plain
You'll see three shortcuts in almost every modern file. Constructor parameters written on the class line. One bracket syntax for building any collection. And strings that need no escaping.
:::

:::walk Three shortcuts in one file
```csharp
var checkout = new CheckoutService(new FixedClock());
Console.WriteLine(checkout.Stamp());

int[] prices = [6, 9, 4];                    // one syntax for arrays, lists, spans...
List<string> teas = ["Sencha"];
int[] more = [..prices, 12];                 // spread
Console.WriteLine($"{more.Length} prices, {teas.Count} tea");

var json = """
    { "tea": "Sencha", "price": 6.50, "tags": ["green", "japanese"] }
    """;                                     // a raw string literal: no escaping needed
Console.WriteLine(json);

var id = 42;
var template = $$"""{ "orderId": {{id}}, "note": "braces { } are literal here" }""";
Console.WriteLine(template);

class CheckoutService(IClock clock)          // primary constructor: clock is in scope class-wide
{
    public string Stamp() => $"checked out at {clock.Now:HH:mm}";
}
interface IClock { DateTime Now { get; } }
class FixedClock : IClock { public DateTime Now => new(2026, 11, 27, 9, 30, 0); }
```
@18-21 | -
A **primary constructor**: the parameter `clock` is written on the class line and is usable in every member. No field, no constructor body.
@1-2 | checkout = → CheckoutService (clock = FixedClock) | > checked out at 09:30
`Stamp` reads `clock` directly.
@4-6 | prices = [6, 9, 4] ; teas = [Sencha] ; more = [6, 9, 4, 12]
**Collection expressions**: the same `[ ]` makes an array or a list, decided by the variable's type. `..` spreads another collection in.
@7 | | > 4 prices, 1 tea
@9-11 | json = { "tea": "Sencha", … }
A **raw string**: everything between the `"""` lines is taken exactly as written, quotes included. The indentation of the closing `"""` is removed from every line.
@12 | | > { "tea": "Sencha", "price": 6.50, "tags": ["green", "japanese"] }
@14-15 | id = 42 ; template = { "orderId": 42, … }
With `$$`, it takes **two** braces to interpolate (`{{id}}`), so single braces stay literal. That's handy for JSON.
@16 | | > { "orderId": 42, "note": "braces { } are literal here" }
:::

- **Primary constructors** (C# 12): the parameters are in scope for the whole class, which makes them ideal for injected services. They are **not** `readonly` ([Episode 2](ch:oop#primary-constructors-the-modern-shorthand)).
- **Collection expressions** (C# 12): `[...]` builds any collection type. The compiler picks the right construction from the target type.
- **Raw string literals** (C# 11): `"""…"""` holds JSON, SQL or regex exactly as written. With `$$`, `{{x}}` interpolates and single braces stay literal.

:::gotcha Don't interpolate log messages
`logger.LogInformation($"Order {id} placed")` flattens `id` into text, so your log store can't filter on it. Write `logger.LogInformation("Order {OrderId} placed", id)` instead ([Errors & logging](ch:errors-logging)).
:::

:::qa What are primary constructors and what's a gotcha?
Constructor parameters declared on the type (`class Svc(IRepo repo)`) that are in scope throughout the class body. They're ideal for DI. The gotcha is that they're ordinary mutable parameters, not readonly fields: any member can reassign them, and capturing them in several places can create hidden fields. Assign to a `readonly` field when you need immutability.
:::

## Small features you'll see everywhere {i}

:::plain
None of these is a big idea. Learn to recognise them so they don't slow you down when you read other people's code.
:::

| Feature | Example |
|---|---|
| Target-typed `new` | `Dictionary<string, List<int>> map = new();` |
| `nameof` | `throw new ArgumentNullException(nameof(order));` survives renames |
| Index from end and ranges | `items[^1]`, `items[1..^1]`, `text[..10]` |
| `using` declaration | `using var scope = logger.BeginScope(...);` |
| `static` lambdas | `list.Select(static x => x * 2)` gives a compile error if it captures by accident ([closures](ch:delegates-events#closures-a-lambda-packs-a-backpack)) |
| Local functions | helper methods declared inside a method |
| Type aliases | `using OrderMap = Dictionary<int, Order>;` |
| `params` spans (C# 13) | `void Log(params ReadOnlySpan<string> parts)` doesn't allocate an array |
| `Lock` type (C# 13) | `private readonly Lock _gate = new();` |
| `field` keyword (C# 14) | `public string Name { get; set => field = value.Trim(); }` |
| UTF-8 literals | `ReadOnlySpan<byte> h = "Content-Type"u8;` |

## Which version added what {i}

| C# | .NET | Headline features |
|---|---|---|
| 7.x | Core 2.x | tuples, `out var`, `is` patterns, local functions, `ref` returns |
| 8 | Core 3.x | **nullable reference types**, switch expressions, async streams, `using` declarations, ranges, default interface methods |
| 9 | 5 | **records**, `init`, **top-level statements**, `and`/`or`/`not` patterns |
| 10 | 6 | **global usings**, **file-scoped namespaces**, record structs |
| 11 | 7 | **raw strings**, **`required`**, list patterns, generic math |
| 12 | 8 | **primary constructors**, **collection expressions** |
| 13 | 9 | `params` collections, `Lock`, partial properties |
| 14 | 10 | **extension members**, **`field`** keyword, `a?.B = x` |

## Next episode {b}

Kettle's code is now safer and shorter, and Kettle is a real business: a warehouse, a nightly supplier feed, a finance team. The finale is one long night. At 01:00 the supplier's 2-million-row price file arrives, and `line.Split(',')` creates **ten million throwaway strings** that bury the garbage collector. By the next afternoon, six more problems hit limits that normal C# can't get past. Millions of struct copies. A printer that only speaks C. An audit rule people keep forgetting. A slow serverless cold start. And a report builder that must stay safe from SQL injection. [Episode 10 · Advanced C# →](ch:advanced-csharp)

## Further reading

- [What's new in C#](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/) (one page per version)
- [Nullable reference types](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references)
- [Pattern matching overview](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/functional/pattern-matching)
- [Records](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record)

## Verify this chapter

```csharp
// records: value equality, readable ToString, non-destructive with
var a = new Dto(1, "Sencha");
Check(a == new Dto(1, "Sencha"), "records with equal values are ==");
var b = a with { Tea = "Assam" };
Check(a.Tea == "Sencha" && b.Tea == "Assam", "with creates a modified copy and leaves the original alone");
Check(a.ToString() == "Dto { Id = 1, Tea = Sencha }", "records generate a readable ToString");

// record equality is shallow over collections
Check(new Bag(new List<int> { 1 }) != new Bag(new List<int> { 1 }), "record equality compares a list by reference");

// switch expressions take the first matching arm
Check(Fee(150m, "US") == 0m && Fee(20m, "IE") == 3.95m && Fee(20m, "US") == 12.90m, "switch arms are tried top to bottom");

// list patterns
Check(Shape([1, 2, 3]) == "1..3" && Shape([]) == "empty", "list patterns match on sequence shape");

// null operators
string? none = null;
Check((none?.Length ?? -1) == -1, "?. and ?? handle null without throwing");

// tuples
var (x, y) = (1, 2); (x, y) = (y, x);
Check(x == 2 && y == 1, "tuple swap");

static decimal Fee(decimal total, string country) => (total, country) switch
{
    ( >= 100, _) => 0m,
    (_, "GB" or "IE") => 3.95m,
    _ => 12.90m,
};
static string Shape(int[] xs) => xs switch { [] => "empty", [var f, .., var l] => $"{f}..{l}", _ => "one" };
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

record Dto(int Id, string Tea);
record Bag(List<int> Items);
```
