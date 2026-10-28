---
id: advanced-csharp
title: "Advanced C#: Zero-Waste Code (Span, Pooling, Reflection, Source Generators)"
summary: "Episode 10, the finale. The nightly 2-million-row import drowns the garbage collector in throwaway strings. Span<T> reads data without copying it, ArrayPool reuses buffers, and source generators replace slow runtime reflection with code written at build time. Covers Span and Memory, ref structs and stackalloc, ArrayPool, ref returns, unsafe code, reflection, attributes, source generators and hand-built expression trees."
layer: language
where: C# language › Advanced & low-level features
fits: Layer 1 features with deep layer 2 roots. Span and ref structs exist because of how the runtime manages memory ([Memory & GC](ch:memory-gc)), and source generators exist because reflection fights trimming and Native AOT ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)). In layer 3, Kestrel and System.Text.Json use these techniques everywhere.
levels: i,a
prereqs: type-system, generics, async-await
next: memory-gc, performance-engineering
---

## The 30-second version

- **`Span<T>`** is a **window** onto memory you already have (part of a string, an array or the stack). Slicing it copies nothing, so parsing can run with **zero allocations**.
- It's a **`ref struct`**: it may point at stack memory, so it can never reach the heap. That rules out class fields, lambdas, `await` and boxing. **`Memory<T>`** is the heap-safe version for those cases.
- **`ArrayPool<T>`**: **rent** big buffers and **return** them, instead of allocating new ones every time.
- **Reflection** lets code inspect types at runtime. It's powerful but slow and invisible to the compiler. **Attributes** are labels that do nothing until something reads them.
- **Source generators** do reflection's job **at build time** by writing ordinary C#. That gives faster startup, errors at compile time, and Native AOT support. This is where .NET is heading.

## Previously, and the problem {b}

In [Episode 9](ch:modern-csharp) Kettle's code got safer and shorter. Now the last problem. Every night Kettle imports a supplier's price file, a CSV with **2 million lines** like `2026-11-27,TEA-01,6.50,GBP`. The import takes 40 minutes, and the profiler says the CPU is mostly busy with **garbage collection**.

Here's the parsing code, with an allocation counter attached. Run it:

```csharp
using System.Globalization;

var lines = Enumerable.Range(0, 20_000).Select(i => $"2026-11-27,TEA-{i:00000},{6 + i % 5}.50,GBP").ToArray();

var before = GC.GetAllocatedBytesForCurrentThread();
decimal total = 0;
foreach (var line in lines)
    total += decimal.Parse(line.Split(',')[2], CultureInfo.InvariantCulture);   // the "obvious" way
var bytes = GC.GetAllocatedBytesForCurrentThread() - before;

Console.WriteLine($"20,000 lines: £{total:N2}, {bytes:N0} bytes of garbage created");
Console.WriteLine($"2,000,000 lines would be ~{bytes * 100 / 1_000_000:N0} MB of garbage, every night");
```

`Split` doesn't *look* expensive, but for every line it builds a new array plus four new strings, copying every character, only for them to be thrown away a moment later. Two million lines means **ten million objects** for the GC to find and free.

## The lightbulb: look at the data, don't copy it {b}

You don't need copies of the fields. You only need to *look at* a part of the line that's already in memory.

That's exactly what **`Span<T>`** is: a **window** onto memory that already exists. It's just "start here, this many items long". Slicing a span makes a smaller window, **never a copy**. Read-only text uses `ReadOnlySpan<char>`. Most of .NET's parsing methods (`int.Parse`, `decimal.Parse`, `Guid.Parse`…) accept a span directly.

:::scene visuals/scenes/adv-span.svg | Copying fields vs looking through a window
1. One line of the CSV is already in memory as a single string. You need four fields from it, two million times a night.
2. **`Split(',')`** creates a `string[]` and **four brand-new strings**, copying every character. That's 5 objects per line, or 10 million objects a night, all garbage a moment later.
3. **`line.AsSpan(0, 10)`** is a window over the date characters, just a start and a length over the *same* memory. Nothing is copied.
4. Move the window to the price and call `decimal.Parse(window)`. It reads straight from the original text. **Zero allocations per line.**
5. A span can point at **stack** memory, which vanishes when a method returns. So the compiler never lets a span reach the heap: no fields, no lambdas, no `await`. Those rules are what make "zero-copy" safe.
:::

The same import, rewritten with spans:

```csharp
using System.Globalization;

var lines = Enumerable.Range(0, 20_000).Select(i => $"2026-11-27,TEA-{i:00000},{6 + i % 5}.50,GBP").ToArray();

var before = GC.GetAllocatedBytesForCurrentThread();
decimal total = 0;
foreach (var line in lines) total += PriceOf(line);
var bytes = GC.GetAllocatedBytesForCurrentThread() - before;
Console.WriteLine($"20,000 lines: £{total:N2}, {bytes:N0} bytes of garbage created");   // almost nothing

static decimal PriceOf(string line)
{
    ReadOnlySpan<char> rest = line;                  // a window over the whole line
    rest = rest[(rest.IndexOf(',') + 1)..];          // skip the date   (a smaller window, no copy)
    rest = rest[(rest.IndexOf(',') + 1)..];          // skip the SKU
    var price = rest[..rest.IndexOf(',')];           // just "6.50"
    return decimal.Parse(price, CultureInfo.InvariantCulture);   // parses straight from the window
}
```

![Split copies each field into a new string; a Span just narrows its view over the same original characters](visuals/span-view-vs-copy.svg)

A span can view almost any memory:

```csharp
int[] stock = [12, 0, 7, 3, 9];
Span<int> middle = stock.AsSpan(1, 3);       // a window over part of an array
middle[0] = 50;                               // writes INTO the array
Console.WriteLine(stock[1]);                  // 50

ReadOnlySpan<char> word = "Sencha tea".AsSpan(0, 6);   // part of a string, no new string
Console.WriteLine(word.ToString());

Span<byte> scratch = stackalloc byte[16];     // memory on the STACK: the GC never sees it
scratch.Fill(0xFF);
Console.WriteLine(scratch.Length);
```

:::qa What is Span<T> and why is it useful?
A stack-only struct that represents a contiguous region of memory (an array, a string, the stack or native memory) as a pointer plus a length. Slicing creates views without copying, so parsing and formatting can run with zero allocations, which reduces GC pressure in hot paths.
:::

## ref structs: why Span has strict rules {a}

`stackalloc` memory lives in the method's stack frame and disappears when the method returns ([Episode 1](ch:type-system#where-the-data-lives-stack-and-heap)). If a span pointing at it got stored somewhere that *outlives* the method, it would point at garbage. So `Span<T>` is a **`ref struct`**, a type the compiler only ever allows on the stack. Every restriction follows from that one rule:

| A ref struct can't… | because that would put it on the heap, via… |
|---|---|
| be a field of a class | the object, which lives on the heap |
| be boxed or cast to `object` or an interface | the box ([Episode 1](ch:type-system#boxing-a-value-type-in-a-cardboard-box)) |
| be captured by a lambda | the closure's backpack ([Episode 4](ch:delegates-events#closures-a-lambda-packs-a-backpack)) |
| be used across `await` or `yield` | the async state machine ([Episode 8](ch:async-await#under-the-hood-the-state-machine)) |
| be an array element | the array |

C# 13 relaxed this a little, safely: ref structs can implement interfaces (without boxing) and be generic arguments with `where T : allows ref struct` ([Generics](ch:generics#constraints-a-job-description-for-t)).

:::qa Why can't Span<T> be used in async methods or stored in a class field?
It's a ref struct that may point to stack memory, so it must never end up on the heap. Async methods and iterators store their locals in a heap-allocated state machine, and class fields live on the heap, so both are forbidden. Use `Memory<T>` instead, and call `.Span` in the synchronous parts.
:::

## Memory<T>: the version that can wait {a}

What if you need a span-like window **across an `await`**, or **stored in a field**? Use **`Memory<T>`**. It's an ordinary struct (not a ref struct) that can live on the heap, because it never points at stack memory.

```csharp norun
public async Task<int> ReadChunkAsync(Stream s, Memory<byte> buffer, CancellationToken ct)
{
    int read = await s.ReadAsync(buffer, ct);     // Memory is fine across an await
    return Checksum(buffer.Span[..read]);         // drop to a Span for the synchronous work
}
```

**Rule of thumb:** synchronous methods take `Span<T>`/`ReadOnlySpan<T>`. Async methods take `Memory<T>`/`ReadOnlyMemory<T>` and use `.Span` between awaits.

:::qa Span<T> vs Memory<T>?
`Span<T>` is a ref struct: stack-only, the fastest option, and usable in synchronous code. `Memory<T>` is a regular struct that can live on the heap, be stored in fields and cross awaits. You get a Span from it with `.Span`.
:::

## Pooling buffers: borrow, don't buy {a}

The import reads the file in 1 MB chunks. Allocating a new 1 MB array per chunk is costly, because anything 85 KB or larger goes on the **Large Object Heap**, which is expensive to clean ([Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap)). So borrow a buffer and give it back:

:::scene visuals/scenes/adv-pool.svg | Rent, use, return
1. **Before:** a new 1 MB array for every chunk. They pile up on the Large Object Heap until an expensive full GC clears them.
2. **`ArrayPool<byte>.Shared`** is a shelf of reusable arrays, shared by the whole app.
3. **`Rent`** borrows one for this chunk.
4. **`Return`** it in a `finally`, so it's returned even if processing throws. The next chunk rents the **same** array, so there's no new allocation.
5. Two rules. `Rent` may give you a **bigger** array than you asked for, so use only the length you requested. And after `Return`, the array **belongs to someone else**, so never touch it again.
:::

```csharp
using System.Buffers;

var pool = ArrayPool<byte>.Shared;
for (int chunk = 1; chunk <= 3; chunk++)
{
    byte[] buffer = pool.Rent(100_000);              // may be bigger than requested
    try
    {
        var usable = buffer.AsSpan(0, 100_000);      // only use what you asked for
        usable.Fill((byte)chunk);
        Console.WriteLine($"chunk {chunk}: rented {buffer.Length:N0} bytes, hash {buffer.GetHashCode()}");
    }
    finally
    {
        pool.Return(buffer);                         // give it back, even on errors
    }
}
// the same hash each time: the SAME array, reused, never reallocated
```

Related tools: `ObjectPool<T>` (often used to pool `StringBuilder`s), `RecyclableMemoryStream`, `IBufferWriter<T>`, and **System.IO.Pipelines**, the pooled-buffer machinery Kestrel is built on.

:::qa What is ArrayPool and when would you use it?
A pool of reusable arrays (`ArrayPool<T>.Shared`). Rent large temporary buffers instead of allocating them for every operation, which avoids Large Object Heap allocations and GC pressure, and return them in a `finally` block. Remember that `Rent` may return a larger array than you asked for.
:::

## ref returns: hand back the real thing, not a copy {a}

Returning a struct from a method normally returns a **copy** ([Episode 1](ch:type-system)). A `ref` return hands back a reference to the original slot, so the caller can update it in place:

```csharp
var stock = new StockLevel[] { new("TEA-01", 5), new("TEA-02", 0) };

ref StockLevel slot = ref Find(stock, "TEA-02");   // a reference INTO the array
slot.Quantity = 40;                                // updates the array element directly
Console.WriteLine(stock[1].Quantity);              // 40

static ref StockLevel Find(StockLevel[] items, string sku)
{
    for (int i = 0; i < items.Length; i++)
        if (items[i].Sku == sku) return ref items[i];
    throw new KeyNotFoundException(sku);
}

struct StockLevel(string sku, int quantity)
{
    public string Sku = sku;
    public int Quantity = quantity;
}
```

The rest of this family is mostly for library authors: `scoped` (the compiler proves a `ref` can't escape), `ref readonly`, and `Unsafe`, `MemoryMarshal` and `CollectionsMarshal` for expert control over memory.

## unsafe code and native interop {a}

```csharp norun
// requires <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
unsafe
{
    int x = 10;
    int* p = &x;          // a raw pointer: no type safety, no bounds checks
    *p = 20;
    fixed (byte* ptr = buffer) { /* pin the array so the GC can't move it while you use the pointer */ }
}

// calling native code, with a source-generated marshaller (works with Native AOT)
internal static partial class Native
{
    [LibraryImport("libc", EntryPoint = "getpid")]
    internal static partial int GetPid();
}
```

Inside `unsafe`, the safety guarantees from [How code runs](ch:how-code-runs#meanwhile-the-clr-is-doing-a-lot-more-than-just-this) are off. Use it only for native interop, or a hot spot you've **measured**. `fixed` **pins** an object, which stops the GC from moving it. Long or frequent pinning fragments the heap.

:::qa What does the fixed statement do?
It pins a managed object in memory for the duration of the block, so the GC can't move it, which lets you take a stable pointer to it for unsafe code or native interop. Long or frequent pinning fragments the heap.
:::

## Reflection: code that reads its own program {i}

Every compiled assembly carries **metadata**, a full description of every type and member ([How code runs](ch:how-code-runs#what-build-time-actually-hands-you)). **Reflection** is code reading that description *while the program runs*, and then creating objects or calling members it only knows **by name**:

```csharp
using System.Reflection;

Type t = typeof(OrderDto);
foreach (PropertyInfo p in t.GetProperties())
    Console.WriteLine($"{p.Name}: {p.PropertyType.Name}");

object order = Activator.CreateInstance(t)!;                  // create one without writing `new OrderDto()`
t.GetProperty("Tea")!.SetValue(order, "Sencha");              // set a property chosen by a STRING
Console.WriteLine(t.GetMethod("Describe")!.Invoke(order, null));

public class OrderDto
{
    public int Id { get; set; }
    public string Tea { get; set; } = "";
    public string Describe() => $"order {Id}: {Tea}";
}
```

This is how a lot of .NET works under the hood. **DI containers** find constructors this way, **serializers** read properties, **ASP.NET Core** discovers controllers, **EF Core** builds its model, and **test frameworks** find `[Fact]` methods.

The costs:

- **It's slow and allocates.** There are string lookups, and every argument is boxed into an `object[]`.
- **It's invisible to the compiler.** Rename `Tea` and the code above still compiles, then fails at runtime.
- **It's hostile to trimming and Native AOT.** The trimmer can't see members you only mention as strings, so it may remove them.

Mitigations: cache the `PropertyInfo`/`MethodInfo`, turn lookups into compiled delegates (see the end of this chapter), or, best of all, use a **source generator**.

:::qa What is reflection and what are its downsides?
Runtime inspection and invocation of types and members through metadata. It powers DI, serializers, ORMs and test runners, but it's slow, it allocates, it bypasses compile-time checking, and it isn't compatible with trimming or Native AOT unless annotated. Cache reflection results, compile delegates, or use source generators instead.
:::

## Attributes: labels that do nothing until read {i}

An **attribute** is a label attached to code: `[Required]`, `[HttpGet]`, `[Obsolete]`. On its own it **does nothing**. It only matters when something reads it, whether that's the compiler, the runtime, a framework or a source generator.

```csharp
using System.Reflection;

foreach (var m in typeof(OrderService).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
{
    var audit = m.GetCustomAttribute<AuditAttribute>();            // reading the label
    Console.WriteLine(audit is null ? $"{m.Name}: not audited" : $"{m.Name}: audit as '{audit.Action}'");
}

[AttributeUsage(AttributeTargets.Method)]
sealed class AuditAttribute(string action) : Attribute
{
    public string Action { get; } = action;
}

class OrderService
{
    [Audit("order.cancel")] public void Cancel(int id) { }
    public void Get(int id) { }
}
```

| Read by | Examples |
|---|---|
| **The compiler** | `[Obsolete]`, `[CallerMemberName]`, `[NotNullWhen]`, `[Experimental]` |
| **The runtime** | `[StructLayout]`, `[MethodImpl]`, `[ThreadStatic]` |
| **Frameworks** | `[HttpGet]`, `[Authorize]`, `[FromBody]`, `[Required]`, `[Key]`, `[JsonPropertyName]`, `[Fact]` |
| **Source generators** | `[LoggerMessage]`, `[JsonSerializable]`, `[GeneratedRegex]`, `[LibraryImport]` |

In ASP.NET Core, endpoint attributes like `[Authorize]` become **endpoint metadata**, which middleware reads after routing has picked the endpoint ([Routing](ch:routing)).

:::qa What are attributes and who reads them?
Declarative metadata attached to code elements. They're passive, and they're read by the compiler (`Obsolete`, the nullable attributes), the runtime (`StructLayout`), frameworks through reflection or endpoint metadata (`HttpGet`, `Authorize`, `Required`), or source generators (`LoggerMessage`, `JsonSerializable`).
:::

## Source generators: do reflection's work at build time {a}

Reflection discovers your types **every time the app starts**, by name, at runtime. What if that discovery happened **once, while compiling**, and produced normal C# code?

That's a **source generator**: a plugin for the C# compiler (Roslyn) that reads your code during the build and **adds new C# files** to it. The output is ordinary code. It's fast, you can step through it in the debugger, and the compiler and trimmer can see all of it.

:::scene visuals/scenes/adv-generators.svg | Discover at runtime, or write it at build time?
1. **Reflection** happens at run time. On every start, the app asks "what properties does `OrderDto` have?", reads metadata, looks names up as strings and boxes values.
2. Rename a property and it still compiles, then **breaks at runtime**, because the lookup was a string.
3. **Native AOT and trimming** can't see string lookups, so code that's needed gets removed and the app fails.
4. A **source generator** runs inside the compiler. It reads your code and **writes plain C#** (for example `OrderDtoJson.g.cs`), compiled in with yours.
5. At run time there's **nothing left to discover**: fast startup, no boxing, errors at build time, and the trimmer sees everything, so Native AOT works.
:::

The three generators you'll meet first:

```csharp norun
// 1. Logging: a fast, strongly typed log method (no boxing, template parsed at build time)
public static partial class Log
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Order {OrderId} placed by {CustomerId}")]
    public static partial void OrderPlaced(this ILogger logger, int orderId, int customerId);
}
logger.OrderPlaced(order.Id, order.CustomerId);

// 2. JSON: serializer code generated at build time (required for Native AOT)
[JsonSerializable(typeof(OrderDto))]
internal partial class KettleJsonContext : JsonSerializerContext { }

// 3. Regex: compiled to C# at build time
public static partial class Patterns
{
    [GeneratedRegex(@"^TEA-\d{2}$")]
    public static partial Regex Sku();
}
```

Each one follows the same recipe: a **`partial`** declaration with **no body**, plus an **attribute** saying what to generate. The generator writes the body in a separate file, which is exactly why `partial` exists ([Episode 2](ch:oop#static-sealed-and-partial)). Others you'll see: configuration binding, minimal-API request delegates, options validation, and libraries such as Mapperly, Refit and Vogen.

:::why Why all of .NET is moving from reflection to generators
Reflection pays its discovery cost **on every start, in every process**, and hides code from the trimmer. Generators pay it **once, at build time**. The result is faster startup (which matters for serverless and containers), fewer allocations, mistakes caught by the compiler, and apps that work with Native AOT ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)).
:::

:::qa What is a source generator and why are they replacing reflection?
A compiler plugin that analyses your code during the build and adds generated C# source. It moves work from runtime to compile time, which gives faster startup, fewer allocations and compile-time errors. The generated code is visible to the trimmer, so it enables Native AOT. Examples: `LoggerMessage`, System.Text.Json source generation, `GeneratedRegex`.
:::

## Building code by hand: expression trees as a code factory {a}

In [Episode 6](ch:linq#expression-trees-how-c-becomes-sql) EF Core *read* expression trees that the compiler built. You can also **build** one yourself, piece by piece, and compile it into a real delegate. Object mappers use this trick to make reflection fast:

```csharp
using System.Linq.Expressions;

// build  (OrderDto o) => o.Total  from parts, at runtime
var o = Expression.Parameter(typeof(OrderDto), "o");
var body = Expression.Property(o, nameof(OrderDto.Total));
Func<OrderDto, decimal> getTotal = Expression.Lambda<Func<OrderDto, decimal>>(body, o).Compile();

Console.WriteLine(getTotal(new OrderDto(9.5m)));    // as fast as a normal delegate from now on

record OrderDto(decimal Total);
```

`.Compile()` is expensive (milliseconds), and under Native AOT it falls back to a slow interpreter. So **cache the compiled delegate**, and for new code prefer a source generator.

## The road so far: Part II, tied together {b}

That's the whole story. Here's what each episode gave Kettle, and the one idea underneath it:

| Episode | Kettle's problem | The fix | The idea underneath |
|---|---|---|---|
| [1 · Types](ch:type-system) | the saved basket changed by itself | know whether `=` copies or shares | value vs reference |
| [2 · Classes](ch:oop) | an order with −3 items | private data, methods as doors, interfaces | encapsulation and polymorphism |
| [3 · Generics](ch:generics) | three copy-pasted caches | `Cache<T>` | a type with a blank in it |
| [4 · Delegates](ch:delegates-events) | discount rules hard-coded in checkout | pass the rule as a value | methods are values |
| [5 · Collections](ch:collections) | slow order lookups | `Dictionary` instead of `List` | the container fits the question |
| [6 · LINQ](ch:linq) | 30-line report loops | describe the result | deferred pipelines and expression trees |
| [7 · Exceptions](ch:exceptions-disposal) | leaked connections took the site down | `try/finally`, `using` | unwinding and deterministic cleanup |
| [8 · Async](ch:async-await) | Black Friday starvation | `await` frees the thread | a Task is not a thread |
| [9 · Modern C#](ch:modern-csharp) | a 3 a.m. null crash and boilerplate | `?`, patterns, records | move mistakes to compile time |
| [10 · Advanced](ch:advanced-csharp) | the import drowned the GC | spans, pools, generators | don't allocate what you don't need |

Notice how they lean on each other. LINQ is generics plus delegates. Async's state machine stores your locals on the heap, which is why spans can't cross an `await`. Records are the equality rules from Episode 1 written for you. You now know the language that the rest of this book is written in.

## Next: the web {b}

Kettle's C# is solid. But so far it's been a program on its own. Customers reach it over **HTTP**, through a web server, with dependency injection wiring the services together, middleware checking every request, and configuration that's different in each environment. That's **ASP.NET Core**, and almost every page of it uses what you've just learned: delegates for middleware, interfaces for DI, generics for `ILogger<T>`, async everywhere. [Part III · ASP.NET Core →](ch:aspnet-hosting)

## Further reading

- [Memory and Span usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines)
- [Source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview)
- [Reflection in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/reflection)
- Stephen Toub's yearly *Performance Improvements in .NET* posts show these techniques used throughout the BCL.
- Book: *Pro .NET Memory Management* (Konrad Kokosa).

## Verify this chapter

```csharp
using System.Buffers;
using System.Globalization;
using System.Linq.Expressions;
using System.Reflection;

// a span slice is a view: writing through it changes the original
int[] arr = [1, 2, 3, 4];
var view = arr.AsSpan(1, 2); view[0] = 99;
Check(arr[1] == 99, "a span slice is a view over the same memory");

// span parsing allocates (almost) nothing
var line = "2026-11-27,TEA-01,6.50,GBP";
var before = GC.GetAllocatedBytesForCurrentThread();
var price = decimal.Parse(line.AsSpan(18, 4), CultureInfo.InvariantCulture);
Check(price == 6.50m && GC.GetAllocatedBytesForCurrentThread() - before < 100, "parsing from a span doesn't allocate a substring");

// stackalloc gives stack memory
Span<byte> s = stackalloc byte[8]; s.Fill(7);
Check(s[7] == 7, "stackalloc memory is usable through a span");

// ArrayPool may hand back a bigger array
var buf = ArrayPool<byte>.Shared.Rent(1000);
Check(buf.Length >= 1000, "Rent returns at least the requested size");
ArrayPool<byte>.Shared.Return(buf);

// ref return updates in place
int[] nums = [1, 2, 3];
ref int first = ref nums[0]; first = 10;
Check(nums[0] == 10, "a ref local writes straight into the array");

// reflection and attributes
Check(typeof(Svc).GetMethod("Cancel")!.GetCustomAttribute<AuditAttribute>()?.Action == "cancel", "attributes are read through reflection");
var dto = Activator.CreateInstance<Dto>(); typeof(Dto).GetProperty("Name")!.SetValue(dto, "x");
Check(dto.Name == "x", "reflection can set a property chosen by name");

// a hand-built expression tree compiles to a working delegate
var p = Expression.Parameter(typeof(Dto));
var getName = Expression.Lambda<Func<Dto, string>>(Expression.Property(p, "Name"), p).Compile();
Check(getName(dto) == "x", "a hand-built expression tree compiles to a delegate");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

sealed class AuditAttribute(string action) : Attribute { public string Action { get; } = action; }
class Svc { [Audit("cancel")] public void Cancel() { } }
class Dto { public string Name { get; set; } = ""; }
```
