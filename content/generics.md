---
id: generics
title: "Generics: Write It Once, for Any Type"
summary: "Episode 3. Kettle has OrderCache, CustomerCache and ProductCache: the same code three times. Generics let you write a Cache<T> once and have the compiler fill in the type, with full type checking and no boxing. Covers generic types and methods, constraints, how the runtime implements generics, variance (in/out), generic math, and the generics you already use in ASP.NET Core."
layer: language
where: C# language › Types › Generics
fits: Layer 1, but used everywhere above it. `List<T>` (collections), `ILogger<T>` and `IOptions<T>` (ASP.NET Core), `DbSet<T>` (EF Core), `Result<T>` (architecture). Variance explains why some assignments compile and others don't.
levels: b,i,a
prereqs: type-system, oop
next: delegates-events, collections
---

## The 30-second version

- A generic type is a type **with a blank in it**. In `Cache<T>`, `T` is a **type parameter**, and `Cache<Order>` fills the blank with `Order`.
- You write and test one class. The compiler checks every use, so putting a `Customer` into a `Cache<Order>` is a compile error. You need no casts, and value types aren't boxed.
- **Constraints** (`where T : IEntity`) promise what `T` can do, so your generic code can use those members.
- .NET generics are **real at runtime** ("reified"). `List<int>` gets its own fast machine code. Java erases generics instead.
- **Variance**: a read-only `IEnumerable<Cat>` can be used as an `IEnumerable<Animal>` (`out`), but a read-write `List<Cat>` can't be used as a `List<Animal>`.

## Words you'll meet

| Word | In plain words |
|---|---|
| **generic type** | A type with a blank in it, like `List<T>` or `Cache<T>`. |
| **type parameter** | The blank itself: the `T`. |
| **type argument** | What you fill the blank with: the `Order` in `Cache<Order>`. |
| **closed / open generic** | `Cache<Order>` is closed (blank filled). `Cache<>` is open (blank still empty). |
| **constraint** | A rule about what may fill the blank: `where T : IEntity`. |
| **JIT** | The part of .NET that turns your compiled code into machine code while the app runs ([How code runs](ch:how-code-runs)). |
| **reified** | The filled-in types still exist while the app runs, so `typeof(T)` works. |
| **variance** | Whether a "something of Cat" may be used as a "something of Animal". |

## Previously, and the problem {b}

In [Episode 2](ch:oop) Kettle's objects learned to guard their own rules. Pages got slow, so you added a cache for orders:

```csharp norun
class OrderCache
{
    private readonly Dictionary<int, Order> _items = new();
    public void Add(Order item) => _items[item.Id] = item;
    public Order? Get(int id) => _items.GetValueOrDefault(id);
}
```

Then you needed one for customers, and then for products. Now there are three files that are identical except for the type name. Every bug fix has to be made three times.

The old-school fix is one cache that stores `object`, since every type is an `object`:

```csharp
using System.Collections;

var cache = new Hashtable();          // stores object → object
cache[1] = new Order(1);
cache[2] = "oops, a string";          // compiles fine

var order = (Order)cache[1]!;         // you must cast everything back out
Console.WriteLine(order.Id);
try { var bad = (Order)cache[2]!; }    // the mistake only shows up at RUNTIME
catch (InvalidCastException) { Console.WriteLine("crash: that wasn't an Order"); }

record Order(int Id);
```

It compiles, but the compiler has stopped helping. It can't stop a string going in, every read needs a cast, and value types get boxed ([Episode 1](ch:type-system#boxing-a-value-type-in-a-cardboard-box)). You've swapped copy-paste for runtime crashes.

## The lightbulb: a type with a blank in it {b}

What you want is to write the cache once, with a **blank where the type goes**, and let each user fill the blank in.

That's a **generic type**. The blank is called a **type parameter**, written `T` by convention: `class Cache<T>`. When you write `Cache<Order>`, `Order` is the **type argument**, and `Cache<Order>` is a real, fully checked type in which every `T` has become `Order`. The compiler does the filling-in, not you.

:::scene visuals/scenes/gen-template.svg | One template, many real types
1. You write `Cache<T>` once. Every place a type would go says `T`, which is the blank.
2. Somewhere you write `Cache<Order>`. The compiler fills every `T` with `Order`, so `Add` now takes an `Order` and `Get` returns one.
3. `Cache<Customer>` is the same template with a different fill. It's a completely separate, fully typed class.
4. Try to put a `Customer` into a `Cache<Order>` and it's a **compile error**. The mistake from the `Hashtable` version can't happen any more.
5. One class to write, test and fix. There are no casts and no boxing, and every use is checked.
:::

```csharp
var orders = new Cache<Order>();
orders.Add(new Order(1, 25m));
Order? o = orders.Get(1);                // no cast: it's already an Order
Console.WriteLine(o);

var customers = new Cache<Customer>();
customers.Add(new Customer(7, "Ada"));
Console.WriteLine(customers.Get(7)?.Name);

// orders.Add(new Customer(2, "Bob"));   // ← compile error: Add takes an Order

class Cache<T> where T : IEntity         // "where": explained in the next section
{
    private readonly Dictionary<int, T> _items = new();
    public void Add(T item) => _items[item.Id] = item;
    public T? Get(int id) => _items.GetValueOrDefault(id);
}

interface IEntity { int Id { get; } }
record Order(int Id, decimal Total) : IEntity;
record Customer(int Id, string Name) : IEntity;
```

You've used generics since your first C# program: `List<string>` is `List<T>` with `T` filled in as `string`.

### Generic methods: the blank can be on one method

A method can have its own type parameter. Usually you don't even write it, because the compiler **infers** `T` from the arguments:

```csharp
Console.WriteLine(FirstOr(new[] { 3, 4 }, 0));         // T inferred as int
Console.WriteLine(FirstOr(Array.Empty<string>(), "none"));   // T inferred as string

static T FirstOr<T>(IEnumerable<T> items, T fallback)
{
    foreach (var item in items) return item;
    return fallback;
}
```

Two conventions: use `T` when there's one type parameter, and descriptive names (`TKey`, `TValue`, `TRequest`) when there are several. `default(T)` is the "empty" value for any `T`: `null` for a reference type and zero for a value type.

:::qa What are generics and what problems do they solve?
Type parameters let you write classes, interfaces and methods once for any type. They give you compile-time type safety, avoid boxing and casts (so they're faster), and allow reuse. Code written against `object` gives you none of those.
:::

## Constraints: a job description for T {b}

Inside `Cache<T>`, the line `_items[item.Id] = item` needs `item.Id`. But a bare `T` could be *anything*: an `int`, a `string`, a `Stream`. The compiler won't let you call `.Id` on "anything".

A **constraint** is a promise about `T`, written with `where`. `where T : IEntity` says "only types that implement `IEntity` may fill this blank". The compiler enforces that at every use, and in return it lets your code use `IEntity`'s members on `T`.

:::scene visuals/scenes/gen-constraint.svg | What a constraint unlocks
1. With a bare `T`, the compiler only lets you use what *every* type has: `ToString`, `Equals`, `GetHashCode`, `GetType`. So `item.Id` is an error, because `T` might be a `string`.
2. Add `where T : IEntity`. Now every `T` is promised to have `Id`, so the line compiles.
3. The promise is checked from the other side too. `Cache<Order>` is fine because `Order` implements `IEntity`. `Cache<string>` is now a compile error.
4. A constraint is a deal: you accept fewer types for `T`, and in return you get to use their members. The compiler checks both halves.
:::

:::analogy A job advert
"Applicants must hold a driving licence." That constraint limits who can apply. But it also means that once someone's hired, you can hand them the van keys without checking. `where T : IEntity` limits who can fill `T`, and in return you can call `.Id` on it.
:::

| Constraint | `T` must be… |
|---|---|
| `where T : class` | a reference type |
| `where T : struct` | a non-nullable value type |
| `where T : notnull` | non-nullable (reference or value) |
| `where T : new()` | creatable with `new T()` |
| `where T : SomeBase` | `SomeBase` or a subclass of it |
| `where T : ISomething` | something that implements the interface |
| `where T : unmanaged` | a struct containing no references (for low-level code) |
| `where T : allows ref struct` (C# 13) | allowed to be a `Span`-like type |

```csharp
Console.WriteLine(Max(3, 9));                     // 9
Console.WriteLine(Max("earl grey", "sencha"));    // sencha
var fresh = Create<List<int>>();                  // new() constraint at work
Console.WriteLine(fresh.Count);

static T Max<T>(T a, T b) where T : IComparable<T> => a.CompareTo(b) >= 0 ? a : b;
static T Create<T>() where T : new() => new T();
```

:::qa What generic constraints are available?
`class`, `class?`, `struct`, `notnull`, `unmanaged`, `new()`, a base class, an interface, another type parameter, `default` (for overrides), and `allows ref struct` (C# 13). A constraint lets you use the constrained type's members inside generic code.
:::

## What the runtime does with `List<int>` vs `List<string>` {a}

:::plain
.NET builds real machine code for your generic types while the app runs. Each value type gets code made just for it, so nothing is boxed. All the reference types share one copy, because every reference is the same size.
:::

Are `List<int>` and `List<string>` still different things while the app runs? In .NET, yes. Generics are **reified**: they exist for real at runtime, and `typeof(T)` gives the real type. Java **erases** generics, so at runtime every `List` is the same type-blind list.

:::scene visuals/scenes/gen-reify.svg | One `List<T>`, several kinds of machine code
1. For a **value type** like `int`, the JIT writes machine code made just for `int`. The numbers sit directly in the list's array, so there's no boxing.
2. Every *different* value type, like `Money`, gets **its own copy** of that code, sized exactly for that type.
3. Every **reference type** is just a pointer (8 bytes), whatever it points at. So `List<string>`, `List<Order>` and the rest **share one copy** of the code.
4. And the filled-in types stay real while the app runs. That's **reification**. Java instead **erases** them: at runtime every `List` is the same, and an `int` must be boxed to go in one.
:::

One useful side effect: **static fields are per filled-in type**. `Counter<Order>.Count` and `Counter<Customer>.Count` are two separate fields, which gives you a free per-type cache:

```csharp
Counter<Order>.Hit(); Counter<Order>.Hit(); Counter<Customer>.Hit();
Console.WriteLine($"Order: {Counter<Order>.Count}, Customer: {Counter<Customer>.Count}");   // 2, 1

static class Counter<T> { public static int Count; public static void Hit() => Count++; }
record Order; record Customer;
```

:::qa How are .NET generics different from Java generics?
.NET generics are reified: closed generic types exist at runtime, `typeof(T)` works, and value-type instantiations get specialised code with no boxing. Java uses type erasure, so the type information is gone at runtime and primitives must be boxed.
:::

:::qa Are static fields shared across generic instantiations?
No. Each closed generic type (`Foo<int>`, `Foo<string>`) has its own copy of the static fields, which is handy for per-type caches.
:::

## Variance: is a box of cats a box of animals? {a}

:::plain
Can a "something of Cat" be used where a "something of Animal" is wanted? It depends on one thing: do Cats only ever come **out** of it, only go **in**, or both? If both, it's not allowed, because someone could sneak a Dog in.
:::

If `Cat` is an `Animal`, can a `List<Cat>` be used where a `List<Animal>` is expected? It seems obvious that it should. It isn't allowed, and the reason is the key to the whole topic. It comes down to whether things go **in**, come **out**, or both.

:::scene visuals/scenes/gen-variance.svg | When does "of Cat" count as "of Animal"?
1. A `List<Cat>` is a basket. You can **take cats out** and **put cats in**.
2. Suppose C# let you treat it as a `List<Animal>`. Then someone could `Add` a `Dog`, since a dog is an animal, straight into your cat basket. So it's **not allowed**. `List<T>` is **invariant**.
3. `IEnumerable<T>` only **gives things out**. It has no `Add`. Everything it hands you is a Cat, and every Cat is an Animal, so treating it as `IEnumerable<Animal>` is safe. This is **covariance**, marked `out T`.
4. `Action<T>` only **takes things in**. A vet who can treat *any* animal can certainly treat a cat, so an `Action<Animal>` can be used as an `Action<Cat>`. This is **contravariance**, marked `in T`.
:::

```csharp
List<Cat> cats = [new Cat("Tom"), new Cat("Mog")];

IEnumerable<Animal> animals = cats;          // ✓ covariant (out): read-only
foreach (var a in animals) Console.WriteLine(a.Name);

Action<Animal> checkUp = a => Console.WriteLine($"vet sees {a.Name}");
Action<Cat> catCheckUp = checkUp;            // ✓ contravariant (in): input-only
catCheckUp(cats[0]);

// List<Animal> broken = cats;               // ✗ compile error: List<T> is invariant

record Animal(string Name);
record Cat(string Name) : Animal(Name);
```

The rules:

| | Keyword | Allowed when `T` only… | Examples |
|---|---|---|---|
| **Covariance** | `out T` | comes **out** (returned) | `IEnumerable<out T>`, `IReadOnlyList<out T>`, `Func<out TResult>` |
| **Contravariance** | `in T` | goes **in** (parameters) | `Action<in T>`, `IComparer<in T>`, `IEqualityComparer<in T>` |
| **Invariant** | *(none)* | goes both ways | `List<T>`, `IList<T>`, `Dictionary<K,V>`, `Task<T>` (a class) |

A way to remember the direction: **`out`** (things come out) lets you treat it as something *more general*, so cats come out as animals. **`in`** (things go in) lets you treat it as something *more specific*: anything that accepts any animal accepts a cat.

- Variance works only on **interfaces and delegates**, never on classes.
- It works only with **reference types**. `IEnumerable<int>` is never an `IEnumerable<object>`, because that would need boxing.
- **Arrays** are an old exception: `object[] o = new string[1];` compiles, but `o[0] = 1;` throws `ArrayTypeMismatchException` at runtime.

:::qa Explain covariance and contravariance.
Covariance (`out T`) lets `I<Derived>` be used as `I<Base>`. It's safe when T only appears in output positions, as in `IEnumerable<out T>`. Contravariance (`in T`) lets `I<Base>` be used as `I<Derived>`. It's safe when T only appears in input positions, as in `Action<in T>` and `IComparer<in T>`. It applies to interfaces and delegates with reference-type arguments.
:::

:::qa Why isn't List<Cat> assignable to List<Animal>?
Because `List<T>` both reads and writes T. If it were allowed, you could add a Dog through the `List<Animal>` reference into what is really a `List<Cat>`. If you only need to read, use `IEnumerable<Animal>` or `IReadOnlyList<Animal>`, which are covariant.
:::

## Generic math {a}

:::plain
Generic code used to be unable to add two `T`s, because `+` belongs to the type itself rather than to any one value. C# 11 lets an interface require static members like `+` and `Zero`, so one generic method can now do maths for every number type.
:::

The missing piece was **static** members. `+` and `Zero` aren't called on a particular number; they belong to the type (`int.Zero`, `decimal.Zero`). Interfaces used to only describe instance members. Since C# 11, an interface can say "every type that implements me has a static `Zero` and a static `+`", and `INumber<T>` says exactly that:

```csharp
using System.Numerics;

Console.WriteLine(Sum(new[] { 1, 2, 3 }));          // 6
Console.WriteLine(Sum(new[] { 1.5m, 2.25m }));      // 3.75

static T Sum<T>(IEnumerable<T> values) where T : INumber<T>
{
    T total = T.Zero;                  // a static member, called on a type parameter
    foreach (var v in values) total += v;
    return total;
}
```

You'll rarely write this in backend code, but you'll meet its cousin `IParsable<T>` when binding custom types from routes and query strings ([Building APIs](ch:building-apis)).

## The generics you already use every day {i}

:::plain
Most of the generics you'll meet in ASP.NET Core are blanks the framework fills with your types. Once you read `T` as "the type goes here", the long names stop looking strange.
:::

Once you know `T` is "the blank", ASP.NET Core code becomes much easier to read:

| API | What the `T` is doing |
|---|---|
| `List<Order>`, `Dictionary<int, Order>` | What the collection holds |
| `Task<Order>` | What the async work eventually returns |
| `ILogger<OrderService>` | Just a **label**: log lines are tagged with the class name |
| `IOptions<PaymentOptions>` | Which settings class to bind config into |
| `DbSet<Order>` | Which table EF Core maps |
| `services.AddScoped<IRepo, Repo>()` | Interface → implementation |
| `AddScoped(typeof(IRepository<>), typeof(EfRepository<>))` | An **open generic**, which covers every `IRepository<X>` at once |

`IRepository<>`, with the brackets left empty, is an **open** generic: the template with its blank still unfilled.

:::scene visuals/scenes/gen-open.svg | One registration for every entity
1. At startup you register the **open** generic, `IRepository<>` → `EfRepository<>`, with the blank left empty.
2. Later, some code asks the [DI container](ch:dependency-injection) for `IRepository<Order>`. The container fills the same blank with `Order` and builds an `EfRepository<Order>`.
3. `IRepository<Customer>` works the same way, and so will any entity you add next year, with no extra registration.
:::

:::qa What is an open generic registration in DI?
Registering a generic type definition, such as `AddScoped(typeof(IRepository<>), typeof(EfRepository<>))`. The container can then create any closed version (`IRepository<Order>`) on demand, without a separate registration for each.
:::

## Next episode {b}

Kettle's caching is now one class, `Cache<T>`. Next, the owner changes the discount rule: 10% off orders over £50. Next week it's "buy two, get one free" on Tuesdays. Then it's a Christmas special. Each change means editing and redeploying checkout code. What if the *rule itself* could be handed to checkout like any other value? [Episode 4 · Delegates →](ch:delegates-events)

## Further reading

- [Generics in .NET](https://learn.microsoft.com/en-us/dotnet/standard/generics/)
- [Covariance and contravariance](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance)
- [Generic math](https://learn.microsoft.com/en-us/dotnet/standard/generics/math)

## Verify this chapter

```csharp
using System.Numerics;

// type safety: the filled-in type is enforced, with no casts
var c = new Cache<Order>(); c.Add(new Order(1));
Check(c.Get(1) is Order, "Cache<Order>.Get returns an Order with no cast");

// inference
Check(FirstOr(new[] { 5 }, 0) == 5, "T is inferred from the arguments");

// reified: the real type exists at runtime
Check(typeof(List<int>) != typeof(List<string>), "List<int> and List<string> are different runtime types");

// statics are per closed type
Counter<int>.Count++; Counter<int>.Count++; Counter<string>.Count++;
Check(Counter<int>.Count == 2 && Counter<string>.Count == 1, "static fields are per closed generic type");

// variance
IEnumerable<Animal> animals = new List<Cat> { new() };
Check(animals.Count() == 1, "IEnumerable<Cat> can be used as IEnumerable<Animal> (out)");
Action<Animal> any = _ => { }; Action<Cat> cat = any;
Check(cat is not null, "Action<Animal> can be used as Action<Cat> (in)");

// array covariance is checked at runtime
object[] arr = new string[1];
Check(Throws(() => arr[0] = 1), "array covariance throws ArrayTypeMismatchException on a bad write");

// generic math
Check(Sum(new[] { 1, 2, 3 }) == 6 && Sum(new[] { 0.5m, 0.25m }) == 0.75m, "one Sum<T> for int and decimal");

static T FirstOr<T>(IEnumerable<T> xs, T fallback) { foreach (var x in xs) return x; return fallback; }
static T Sum<T>(IEnumerable<T> xs) where T : INumber<T> { var t = T.Zero; foreach (var x in xs) t += x; return t; }
static bool Throws(Action a) { try { a(); return false; } catch (ArrayTypeMismatchException) { return true; } }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

class Cache<T> where T : IEntity
{
    private readonly Dictionary<int, T> _items = new();
    public void Add(T item) => _items[item.Id] = item;
    public T? Get(int id) => _items.GetValueOrDefault(id);
}
interface IEntity { int Id { get; } }
record Order(int Id) : IEntity;
static class Counter<T> { public static int Count; }
class Animal { }
class Cat : Animal { }
```
