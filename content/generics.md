---
id: generics
title: Generics, Constraints and Variance
summary: Writing code once for many types without losing type safety or speed. Generic types and methods, constraints, how the runtime implements generics, covariance and contravariance, and generic math.
layer: language
where: C# language › Types › Generics
fits: Layer 1, but used everywhere above: `List<T>` (collections), `ILogger<T>` and `IOptions<T>` (ASP.NET Core), `DbSet<T>` (EF Core), `Result<T>` and `IRequestHandler<TReq,TRes>` (architecture). Understanding variance explains why some assignments compile and others don't.
levels: b,i,a
prereqs: type-system, oop
next: delegates-events, collections
---

## TL;DR

- Generics let you write one class/method that works for any type, with the compiler still checking types at compile time instead of at runtime.
- Without generics, you'd store everything as `object`, which loses type safety and boxes value types (see [Type system](ch:type-system#boxing-what-happens-when-a-value-type-has-to-pretend-to-be-a)).
- **Constraints** (`where T : ...`) tell the compiler what `T` is guaranteed to support, unlocking members you couldn't otherwise call.
- .NET generics are **reified** (real types at runtime, no boxing for value types) unlike Java, which erases them.
- **Variance** (`out T`/`in T`) lets `IEnumerable<Cat>` act as `IEnumerable<Animal>` safely — but only for interfaces/delegates that only read or only write `T`, never both.
- You already use generics constantly: `ILogger<T>`, `IOptions<T>`, `DbSet<T>`, `Task<T>` all lean on them.

:::analogy A warehouse story to hold onto
Picture a warehouse that only has one size of crate, labelled "contents: anything." Every item — a book, a bag of flour, a car battery — gets shoved into the same crate, so pulling an item back out means guessing what's inside before you can use it, and every book was wasted effort because it never needed that crate's padding in the first place. Generics are the warehouse switching to crates sized and labelled for what's actually going in: a `Crate<Book>` only ever holds books, the forklift (the compiler) refuses to load a car battery into one, and a book goes in without any extra padding at all. Keep that picture running through this chapter — "the one-size-crate problem" is `ArrayList`, and everything below is really about how C# builds better crates.
:::

## The problem before generics existed {b}

Before generics arrived in C# 1, if you wanted one reusable collection class that could hold *any* type, there was only one way to do it: store everything as `object`, since `object` is the one type every other type can be treated as.

```csharp
var list = new ArrayList();
list.Add(42);              // boxes
list.Add("oops");          // compiles: no type safety
int n = (int)list[0];      // cast + unbox needed; list[1] would throw at RUNTIME
```

Look at what that costs you. `list.Add("oops")` **compiles without complaint** right next to an `int` — `ArrayList` has no way to say "only ints, please," because its `Add` method takes a plain `object`, and a string is just as valid an `object` as an int is. The mistake doesn't surface until `(int)list[0]` runs, and then only if you happen to touch the wrong element; `list[1]` would throw an `InvalidCastException` the moment anyone actually tried to read it back as an int. On top of the lost type safety, you also saw in [Type system](ch:type-system#boxing-what-happens-when-a-value-type-has-to-pretend-to-be-a) exactly what `list.Add(42)` costs: that `int` has to be **boxed** — heap-allocated — purely so it can fit through a parameter typed as `object`.

Generics fix both problems at once, by letting the *caller* choose the type, and having the compiler remember and enforce that choice everywhere afterward:

```csharp
var list = new List<int>();
list.Add(42);              // no boxing
list.Add("oops");          // compile ERROR
int n = list[0];           // no cast
```

Same two lines, opposite outcome: `list.Add("oops")` is now a compile error, not a runtime surprise, and `list[0]` comes back out already typed as `int`, with no cast and — as the next section explains properly — no boxing either. Three wins, all from the one idea of a **type parameter**: real **type safety** (caught at compile time, not discovered at runtime), real **performance** (no boxing, no casting), and genuine **reuse** (one implementation serving every type, instead of writing `IntList`, `StringList`, `OrderList` by hand).

## Writing your own generic types and methods {b}

```csharp
// Generic class
public class Result<T>
{
    public T? Value { get; }
    public string? Error { get; }
    public bool IsSuccess => Error is null;
    private Result(T? value, string? error) { Value = value; Error = error; }
    public static Result<T> Ok(T value) => new(value, null);
    public static Result<T> Fail(string error) => new(default, error);
}

// Generic interface with two type parameters
public interface IRequestHandler<in TRequest, TResponse>
{
    Task<TResponse> Handle(TRequest request, CancellationToken ct);
}

// Generic method: type inferred from arguments
public static T FirstOrFallback<T>(IEnumerable<T> items, T fallback)
{
    foreach (var item in items) return item;
    return fallback;
}

var x = FirstOrFallback(new[] { 1, 2 }, 0);   // T inferred as int
```

Notice the last line doesn't say `FirstOrFallback<int>(...)` anywhere — the compiler looks at the arguments you actually passed (`new[] { 1, 2 }` and `0`), works out that `T` must be `int` to make both fit, and fills it in silently. This is why you rarely see explicit type arguments on everyday generic method calls; the compiler almost always figures it out for you from context.

Two small conventions worth knowing, because you'll see them everywhere: use `T` alone when there's a single type parameter with no real ambiguity about what it represents, and switch to a descriptive name — `TKey`, `TValue`, `TRequest`, `TEntity` — the moment there's more than one, so the parameter list actually reads like documentation. And `default(T)` (or the shorthand `default`) is how you get a type-parameter-generic "empty" value: it resolves to `null` when `T` ends up being a reference type, and to all-zero-bits when `T` ends up being a value type — exactly the default-value rule from [Type system](ch:type-system#one-question-that-predicts-a-huge-amount-of-c-behaviour), just expressed generically.

## Constraints: telling the compiler what `T` is allowed to be {i}

With a bare `T`, the compiler doesn't know what type you'll plug in, so it only lets you call members that *every* type has — in practice, just the handful inherited from `object`. A **constraint** is a promise about `T` ("it will always derive from `Entity`", "it will always implement `IComparable<T>`"). Once you make that promise, the compiler trusts it and unlocks the matching members inside your generic code.

| Constraint | Meaning |
|---|---|
| `where T : class` | Reference type (`class?` allows nullable) |
| `where T : struct` | Non-nullable value type |
| `where T : notnull` | Non-nullable reference or value type |
| `where T : unmanaged` | Struct with no references (can be used with pointers/`stackalloc`) |
| `where T : new()` | Has a public parameterless constructor |
| `where T : BaseEntity` | Derives from a base class |
| `where T : IComparable<T>` | Implements an interface |
| `where T : U` | Derives from another type parameter |
| `where T : allows ref struct` (C# 13) | Permits `Span<T>`-like types as arguments |

```csharp
public abstract class Entity { public Guid Id { get; protected set; } = Guid.NewGuid(); }

public class InMemoryRepository<T> where T : Entity
{
    private readonly Dictionary<Guid, T> _items = new();
    public void Add(T item) => _items[item.Id] = item;          // .Id is usable because of the constraint
    public T? Find(Guid id) => _items.GetValueOrDefault(id);
}

public static T Max<T>(T a, T b) where T : IComparable<T> => a.CompareTo(b) >= 0 ? a : b;

public static T Create<T>() where T : new() => new T();
```

Why does `item.Id` compile above? Because `where T : Entity` guarantees `T` is always an `Entity` (or something derived from it), so the compiler lets you touch `Entity`'s members on a bare `T`. Without that constraint, `.Id` wouldn't compile at all. `Max<T>` works the same way: `a.CompareTo(b)` only compiles because `where T : IComparable<T>` guarantees every `T` has a `CompareTo` method. `Create<T>` is a different kind of promise, about construction rather than members: plain `new T()` is illegal in generic code (the compiler can't assume `T` has a parameterless constructor), so `where T : new()` exists specifically to grant that.

## What the runtime actually does with a generic type {a}

Does `List<int>` and `List<string>` still exist as two separate things once the program is actually running, or does that distinction disappear after compilation? This matters for performance, and .NET and Java answer it differently (see [Further reading](#further-reading) for the source on both).

Java **erases** generics at compile time: at runtime, `List<Cat>` and `List<Dog>` both collapse into the same type-blind `List`. .NET's generics are **reified** instead: `List<int>` and `List<string>` stay genuinely distinct types at runtime, and `typeof(T)` inside generic code returns the real type it was called with.

That split works differently depending on whether `T` is a value type or a reference type:

- **Value types** (`int`, `Guid`, ...): the JIT compiles a separate, specialised copy of the method for each one — `List<int>` and `List<Guid>` each get their own machine code. That's why there's no boxing: `List<int>`'s code was built to hold raw `int`s directly, the same way hand-written `IntList` code would.
- **Reference types**: every reference is the same size (a pointer), so there's nothing to specialise — the JIT shares one compiled implementation across all of them, looking up type-specific details in a small hidden table only when needed.

![List<T> compiled two ways: a specialised, inline copy per value-type T with no boxing, versus one shared implementation for every reference-type T](visuals/generics-reification.svg)

Back to the warehouse: a `Crate<int>` is like a crate built with int-shaped dividers baked right into its walls — the int sits directly in the slot, no wrapping needed. A `Crate<string>` is more like a crate that just holds a shelf of pointers to wherever the actual strings live elsewhere in the warehouse — one crate *design* serves every reference type, because a pointer is a pointer regardless of what it points to.

One useful side effect: **static fields are per closed type**, not shared across instantiations. `Cache<int>.Instance` and `Cache<string>.Instance` are two unrelated fields. That gives you a simple, lock-free per-type cache:

```csharp
static class TypeName<T> { public static readonly string Value = typeof(T).Name; } // computed once per T
```

`TypeName<Order>.Value` runs its field initializer once, caches `"Order"`, and never recomputes it. `TypeName<Customer>` has its own independent field, computed the first time *it's* touched.

## Variance: when is `List<Cat>` actually a `List<Animal>`? {a}

If `Cat` inherits from `Animal`, is `List<Cat>` also a `List<Animal>`? This trips up even experienced developers. The honest answer: **it depends which interface you're asking about.**

First, see why `List<Cat>` itself can never safely be treated as a `List<Animal>` — watch what would go wrong if the compiler allowed it:

```csharp
List<Cat> cats = new();
List<Animal> animals = cats;     // suppose this compiled
animals.Add(new Dog());          // now a Dog is in the List<Cat>!
```

If that first assignment were legal, the second line lets you add a `Dog` through `animals` — but `animals` and `cats` are the same list in memory, so you'd have just put a `Dog` inside what's supposedly a `List<Cat>`. The next `foreach (Cat c in cats)` would throw, trying to treat that `Dog` as a `Cat`. This is why generic types are **invariant** by default: `List<T>` lets you both *read and write* `T`, and allowing this substitution would make writing unsafe.

The danger comes from **writing**, not reading. So for an interface or delegate where `T` only ever flows **one direction** — only read out, or only accepted in, never both — the danger disappears, and C# lets you declare that one-directional promise explicitly:

| Kind | Keyword | Allowed when T is… | Effect | Examples |
|---|---|---|---|---|
| **Covariance** | `out T` | only **returned** (output) | `I<Derived>` → `I<Base>` | `IEnumerable<out T>`, `IReadOnlyList<out T>`, `IAsyncEnumerable<out T>` (a sequence of values produced over time — see [async/await](ch:async-await)), `Func<out TResult>` — a delegate, a type representing "a method with this signature", covered in [Delegates & events](ch:delegates-events) (not `Task<T>`: it's a class, so invariant) |
| **Contravariance** | `in T` | only **accepted** (input) | `I<Base>` → `I<Derived>` | `Action<in T>`, `IComparer<in T>`, `IEqualityComparer<in T>`, `Func<in T, …>` (delegates, see [Delegates & events](ch:delegates-events)) |

```csharp
IEnumerable<Cat> cats = new List<Cat>();
IEnumerable<Animal> animals = cats;          // ✔ covariant: you can only READ Animals out

Action<Animal> feedAny = a => a.Feed();
Action<Cat> feedCat = feedAny;               // ✔ contravariant: something that can feed any Animal can feed a Cat

IComparer<Animal> byWeight = Comparer<Animal>.Create((x, y) => x.Kg.CompareTo(y.Kg));
var sortedCats = cats.Order(byWeight);       // ✔ an Animal comparer works for Cats
```

Why is each one actually safe, not just permitted? `IEnumerable<Cat>` only ever hands `Cat`s *out* — there's no `Add` method — so treating it as `IEnumerable<Animal>` can never let a `Dog` sneak in; everything you pull out really is a `Cat`, and a `Cat` really is a valid `Animal`. `Action<Animal>` only ever *accepts* an `Animal` as input, never hands one back — so using it where an `Action<Cat>` is expected is equally safe: something that already knows how to handle *any* `Animal` obviously handles the more specific case of a `Cat`.

:::analogy Remember it with producers and consumers
**Out = producer.** Something that only ever *produces* Cats is also, trivially, something that produces Animals — anyone expecting Animals back is perfectly happy receiving Cats specifically. **In = consumer.** Something that can *consume* any Animal can certainly consume a Cat, since a Cat always qualifies as an Animal. Interfaces that do **both** — produce and consume the same `T`, the way `IList<T>` does with its `Add` and its indexer — can't safely claim either direction, and have to stay invariant.
:::

Three rules, so you don't have to rediscover them by trial and error:

1. Variance only applies to **interfaces and delegates** — never to classes like `List<T>`, which is why the first example in this section fails.
2. It only applies to **reference type** arguments — `IEnumerable<int>` can never be an `IEnumerable<object>`, because that would require silent boxing, which C# variance doesn't do.
3. **Arrays** are a historical exception: `object[] o = new string[1]; o[0] = 1;` compiles (arrays have been covariant in C# since before generics existed, for backward compatibility) but throws `ArrayTypeMismatchException` at runtime — because, unlike `IEnumerable<T>`, an array *does* let you write into it. Arrays trade the compile-time safety interfaces give you for a runtime check instead.

## Generic math: interfaces that require static members {a}

```csharp
public static T Sum<T>(ReadOnlySpan<T> values) where T : INumber<T>
{
    T total = T.Zero;
    foreach (var v in values) total += v;
    return total;
}

Sum<int>([1, 2, 3]);         // 6
Sum<decimal>([1.5m, 2.5m]);  // 4.0
```

`T.Zero` and `total += v` are calls to **static** members (`Zero`, the `+` operator) on a type the method only knows as a generic parameter. Before C# 11, constraints could only describe *instance* members, so this couldn't be written. **Static abstract interface members** (C# 11 / .NET 7) close that gap: `Sum` can now be written once and work for `int`, `decimal`, or anything else implementing `INumber<T>`, instead of a hand-written overload per numeric type. `INumber<T>`, `IAdditionOperators<…>`, `IParsable<T>` and friends live in `System.Numerics`. Most backend code never writes its own generic-math code, but you'll meet `IParsable<T>` when binding custom types from route/query parameters (see [Building APIs](ch:building-apis)).

## Spotting generics you already use every day {i}

Framework APIs lean on generics constantly, and recognising *what role* `T` is actually playing in each one takes most of the mystery out of reading unfamiliar code:

| API | What `T` does |
|---|---|
| `ILogger<OrderService>` | `T` is only a **category name** for logs (the full type name) |
| `IOptions<PaymentOptions>` | Which options class to bind |
| `DbSet<Order>` | Which entity/table |
| `IValidator<CreateOrder>` | Which type to validate |
| `services.AddScoped<IRepo, Repo>()` | Interface → implementation mapping |
| `services.AddScoped(typeof(IRepository<>), typeof(EfRepository<>))` | **Open generic** registration: any `IRepository<X>` resolves to `EfRepository<X>` |
| `Task<T>`, `ValueTask<T>` | Result type of async work |
| `IAsyncEnumerable<T>` | Async stream of `T` |
| `Results<Ok<T>, NotFound>` | Union of possible HTTP results for OpenAPI |

The `ILogger<OrderService>` row surprises people: `T` does nothing functional here — `ILogger<T>` never constructs or calls a `T`. It's purely a label, tagging every log line with `OrderService`'s full type name so you can filter logs by which class produced them. Same generic mechanism, used for a purpose that has nothing to do with type safety.

The open-generic registration is worth a second look, since the syntax is unusual the first time you see it:

```csharp
// Open generic registration: one line covers every entity type
builder.Services.AddScoped(typeof(IRepository<>), typeof(EfRepository<>));
```

`IRepository<>` — no type argument inside the brackets — is an **open** generic: a description of a whole family of types, not one specific closed type like `IRepository<Order>`. Registering it once lets the DI container (see [Dependency injection](ch:dependency-injection)) build a matching `EfRepository<X>` for *any* `IRepository<X>` requested later, without a separate registration line per entity.

:::qa What are generics and what problems do they solve?
Type parameters that let you write classes, interfaces and methods once for any type. They give compile-time type safety, avoid boxing and casts (better performance), and enable reuse, unlike object-based code.
:::

:::qa What generic constraints are available?
class, class?, struct, notnull, unmanaged, new(), a base class, an interface, another type parameter, default (for overrides), and allows ref struct (C# 13). Constraints let you use the members of the constrained type inside generic code.
:::

:::qa Explain covariance and contravariance.
Covariance (`out T`) lets `I<Derived>` be used as `I<Base>`; safe when T only appears in output positions (IEnumerable&lt;out T&gt;). Contravariance (`in T`) lets `I<Base>` be used as `I<Derived>`; safe when T only appears in input positions (Action&lt;in T&gt;, IComparer&lt;in T&gt;). It applies to interfaces and delegates with reference-type arguments.
:::

:::qa Why isn't List<Cat> assignable to List<Animal>?
Because List&lt;T&gt; both reads and writes T. If it were allowed, you could add a Dog through the List&lt;Animal&gt; reference into what is actually a List&lt;Cat&gt;. Use IEnumerable&lt;Animal&gt; or IReadOnlyList&lt;Animal&gt; (covariant) if you only need to read.
:::

:::qa How are .NET generics different from Java generics?
.NET generics are reified: closed generic types exist at runtime, `typeof(T)` works, and value-type instantiations get specialised code with no boxing. Java uses type erasure, so generic type info is gone at runtime and primitives must be boxed.
:::

:::qa What is an open generic registration in DI?
Registering a generic type definition, e.g. `AddScoped(typeof(IRepository<>), typeof(EfRepository<>))`, so the container can create any closed version (IRepository&lt;Order&gt;) on demand without registering each one.
:::

:::qa Are static fields shared across generic instantiations?
No. Each closed generic type (Foo&lt;int&gt;, Foo&lt;string&gt;) has its own copy of static fields, which is useful for per-type caches.
:::

## Further reading

- [Generics in .NET](https://learn.microsoft.com/en-us/dotnet/standard/generics/)
- [Covariance and contravariance](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance) — confirmed against this page: variance applies only to generic interfaces/delegates with reference-type arguments, never to classes, never to value types.
- [Generic math](https://learn.microsoft.com/en-us/dotnet/standard/generics/math)

## Verify this chapter

Save this as `Program.cs` in a new console project (`dotnet new console`) and run it with `dotnet run`. It exercises type inference, constraints, reification, variance, array-covariance's runtime check, and generic math from this chapter; each line should print `OK:`.

```csharp
using System.Numerics;

int failures = 0;
void Check(string claim, bool ok)
{
    if (ok) Console.WriteLine($"OK: {claim}");
    else { Console.WriteLine($"FAIL: {claim}"); failures++; }
}

// 1. Type inference picks T from arguments
static T FirstOrFallback<T>(IEnumerable<T> items, T fallback)
{
    foreach (var item in items) return item;
    return fallback;
}
var inferred = FirstOrFallback(new[] { 1, 2 }, 0);
Check("generic method type argument is inferred from the call", inferred == 1);

// 2. Constraint unlocks members: InMemoryRepository<T> where T : Entity
var repo = new InMemoryRepository<Order>();
var order = new Order();
repo.Add(order);
Check("where T : Entity lets generic code use T.Id", repo.Find(order.Id) == order);

// 3. where T : IComparable<T>
Check("Max<T> with IComparable constraint picks the larger value", Max(3, 7) == 7);

// 4. where T : new()
var created = Create<Order>();
Check("where T : new() allows new T() inside generic code", created is Order);

// 5. Reification: closed generic types are genuinely distinct at runtime, typeof(T) works
Check("typeof(T) inside a generic method returns the real closed type",
    typeof(List<int>) != typeof(List<string>) && GetTypeName<int>() == "Int32" && GetTypeName<string>() == "String");

// 6. Static fields are per closed generic type, not shared
Check("static fields are independent per closed generic type (Cache<int> vs Cache<string>)",
    Cache<int>.Value != Cache<string>.Value);

// 7. Variance: IEnumerable<Cat> usable as IEnumerable<Animal> (covariance)
IEnumerable<Cat> cats = new List<Cat> { new Cat() };
IEnumerable<Animal> animalsOut = cats;
Check("IEnumerable<out T> covariance: IEnumerable<Cat> assignable to IEnumerable<Animal>", animalsOut.Count() == 1);

// 8. Variance: Action<Animal> usable as Action<Cat> (contravariance)
int fedCount = 0;
Action<Animal> feedAny = a => fedCount++;
Action<Cat> feedCat = feedAny;
feedCat(new Cat());
Check("Action<in T> contravariance: Action<Animal> assignable to Action<Cat>", fedCount == 1);

// 9. Array covariance is a runtime-checked exception, not compile-time safe
bool threw = false;
try
{
    object[] arr = new string[1];
    arr[0] = 1; // compiles, but...
}
catch (ArrayTypeMismatchException) { threw = true; }
Check("writing a non-string into a string[] via object[] throws ArrayTypeMismatchException at runtime", threw);

// 10. Generic math: one Sum<T> implementation works for int and decimal
Check("Sum<int> via INumber<T> generic math", Sum<int>([1, 2, 3]) == 6);
Check("Sum<decimal> via INumber<T> generic math", Sum<decimal>([1.5m, 2.5m]) == 4.0m);

Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
if (failures > 0) Environment.Exit(1);

static T Max<T>(T a, T b) where T : IComparable<T> => a.CompareTo(b) >= 0 ? a : b;
static T Create<T>() where T : new() => new T();
static string GetTypeName<T>() => typeof(T).Name;
static T Sum<T>(ReadOnlySpan<T> values) where T : INumber<T>
{
    T total = T.Zero;
    foreach (var v in values) total += v;
    return total;
}

abstract class Entity { public Guid Id { get; protected set; } = Guid.NewGuid(); }
class Order : Entity { }

class InMemoryRepository<T> where T : Entity
{
    private readonly Dictionary<Guid, T> _items = new();
    public void Add(T item) => _items[item.Id] = item;
    public T? Find(Guid id) => _items.GetValueOrDefault(id);
}

static class Cache<T> { public static readonly string Value = Guid.NewGuid().ToString(); }

class Animal { }
class Cat : Animal { }
```

Not runtime-verifiable here (needs disassembly, not just execution): that the JIT emits genuinely separate native code per value-type instantiation, and that no boxing occurs for `List<int>`. For those, see [Further reading](#further-reading) or inspect the generated IL/assembly in SharpLab.
