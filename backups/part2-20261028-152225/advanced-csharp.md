---
id: advanced-csharp
title: Advanced C#: Span, Memory, ref, Reflection, Attributes and Source Generators
summary: The tools for high-performance and meta-programming. Span<T> and Memory<T>, ref structs and stackalloc, ArrayPool, unsafe code and interop, reflection and its costs, attributes, and source generators, which replace reflection for speed and Native AOT.
layer: language
where: C# language › Advanced & low-level features
fits: Layer 1 features with deep layer 2 roots: Span and ref structs exist because of how the runtime manages memory ([Memory & GC](ch:memory-gc)), and source generators exist because reflection fights trimming and Native AOT ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)). In layer 3, Kestrel and System.Text.Json use these techniques heavily.
levels: i,a
prereqs: type-system, generics, async-await
next: memory-gc, performance-engineering
---

## TL;DR

- `Span<T>` is a **view** into existing memory (array, string, stack, native) — slicing it never copies, which is why hot-path parsing code uses it to avoid allocating.
- `Span<T>` is a `ref struct`: the compiler forces it to stay on the stack, so it can never outlive the memory it points at (including `stackalloc`'d memory).
- `Memory<T>` is `Span<T>`'s heap-friendly cousin — use it when you need to store a span-like value in a field or carry it across an `await`, then call `.Span` for the synchronous part.
- `ArrayPool<T>` lets you reuse large buffers instead of allocating (and eventually GC-ing) a new one every request.
- **Reflection** reads a program's own metadata at runtime (what powers DI containers, serializers, test runners) but is slow, allocation-heavy, and hostile to trimming/Native AOT.
- **Source generators** do reflection's job at *build time* instead, producing ordinary, fast, trimmer-visible code — which is why the ecosystem is moving toward them.

## Why a web framework needs tools this low-level {i}

ASP.NET Core can serve millions of requests per second on one machine, mostly because it avoids **allocating** on the hot path. [Memory & GC](ch:memory-gc) already established that allocation rate, not raw CPU work, usually limits throughput — so parsing HTTP headers, routing a request, and serializing a JSON response all work on *slices* of buffers that already exist, instead of carving out new strings and arrays per request. You'll rarely write this kind of code yourself, but you'll run into these types constantly in APIs you call every day — `ReadOnlySpan<char>` overloads, `IBufferWriter<byte>`, `PipeReader` — and interviews ask about them because knowing *why* they exist explains how a fast .NET system is actually built.

## Span<T>: a view, not a copy {i}

`Span<T>` is a **view over contiguous memory** — part of an array, a string, stack memory, or native memory — represented as nothing more than a pointer plus a length. The single idea that makes it useful: **slicing a span creates a new, narrower view, never a copy.**

```csharp
string line = "2026-10-27,ORD-1042,149.90,EUR";

// Classic: Split allocates an array + 4 strings
var parts = line.Split(',');
var amount = decimal.Parse(parts[2], CultureInfo.InvariantCulture);

// Span: zero allocations
ReadOnlySpan<char> span = line;
int i1 = span.IndexOf(',');
int i2 = span[(i1 + 1)..].IndexOf(',') + i1 + 1;
int i3 = span[(i2 + 1)..].IndexOf(',') + i2 + 1;
decimal amount2 = decimal.Parse(span[(i2 + 1)..i3], CultureInfo.InvariantCulture);  // Parse accepts ReadOnlySpan<char>

// .NET 9+: Split over spans without allocating
foreach (Range r in span.Split(',')) Console.WriteLine(span[r].ToString());
```

Compare the two approaches to the same four-field line: `line.Split(',')` allocates a whole new `string[]`, plus four brand-new strings — a full copy of every character, duplicated. The span version never copies a single character; `span[(i1 + 1)..]` is just a different pointer-and-length pair into the exact same memory `line` already occupies. For a hot endpoint parsing thousands of lines a second, that difference is the entire reason `Span<T>` exists.

```csharp
Span<int> fromArray = new int[10];                 // array
Span<int> part = fromArray.Slice(2, 5);            // slice of it
ReadOnlySpan<char> fromString = "hello".AsSpan(1, 3);  // "ell", no new string
Span<byte> onStack = stackalloc byte[256];         // stack memory, no GC at all
Span<int> listView = CollectionsMarshal.AsSpan(list);  // List<T>'s internal array
```

Notice how varied the memory a span can point at is — an array, a slice of that array, a substring with no new allocation, raw stack memory via `stackalloc`, even `List<T>`'s own hidden internal array via `CollectionsMarshal`. That's deliberate: `Span<T>` is a *uniform way to describe "a contiguous chunk of memory,"* regardless of where it came from. That's why the BCL exposes span overloads so widely: `int.TryParse(ReadOnlySpan<char>)`, `Encoding.UTF8.GetBytes(ReadOnlySpan<char>, Span<byte>)`, `Stream.Read(Span<byte>)`, `string.Create`, and the whole `MemoryExtensions` family (`IndexOf`, `Trim`, `StartsWith`, `SequenceEqual`, `Contains`).

## ref structs: the restriction that makes stack memory safe {a}

That `stackalloc` line above raises an obvious question: if a `Span<int>` can point at raw *stack* memory, and stack frames disappear the instant their method returns, what stops you from holding onto a span after its underlying stack memory is already gone, and reading garbage?

The answer: `Span<T>` is a **`ref struct`** — a value type the compiler only ever allows to live on the stack, no exceptions. Every other restriction on `ref struct` types follows from that one rule:

| A ref struct can't… | Because… |
|---|---|
| Be a field of a class or normal struct | That would put it on the heap |
| Be boxed or cast to `object`/interface | Boxing allocates on the heap |
| Be captured by a lambda | Closures live on the heap |
| Be used across `await` or `yield` | The state machine lives on the heap |
| Be an array element | Arrays live on the heap |

Every row is the same answer, five times over: each operation would, one way or another, force the `Span<T>` onto the **heap**. [Delegates, lambdas and closures](ch:delegates-events#closures-when-a-lambda-outlives-the-method-it-was-written-in) showed exactly what happens when a lambda captures a local — the compiler moves it into a heap-allocated `DisplayClass`. If a `Span<T>` pointing at `stackalloc`'d memory got moved there, the span would outlive the stack memory it points at, and reading through it afterward means reading freed, possibly reused memory — the kind of memory-safety hole C# normally makes structurally impossible. The `ref struct` restriction is the compiler refusing to let that situation arise at all.

C# 13 relaxed this slightly, without reopening that hole: ref structs can now implement interfaces (without ever being boxed to do it) and appear as generic arguments, via the `where T : allows ref struct` constraint you met briefly in [Generics](ch:generics#constraints-telling-the-compiler-what-t-is-allowed-to-be).

## Memory<T>: the heap-friendly cousin, for exactly the cases Span<T> forbids {a}

Given that list of forbidden operations, what do you do when you need something span-like **stored in a field**, or used **across an `await`** — both things `Span<T>` can never do? **`Memory<T>`** (and `ReadOnlyMemory<T>`) is the answer: an ordinary struct — not a `ref struct` — built from the same pieces (an array, an offset, a length), but without the stack-only restriction, because it's never allowed to point at `stackalloc`'d memory in the first place.

```csharp
public async Task<int> ReadIntoAsync(Stream s, Memory<byte> buffer, CancellationToken ct)
{
    int read = await s.ReadAsync(buffer, ct);      // fine across await
    return Checksum(buffer.Span[..read]);          // drop to Span for synchronous processing
}
```

Notice the pattern in `ReadIntoAsync`: the parameter and everything crossing the `await` is `Memory<byte>`, but the moment we're back to purely synchronous code — `Checksum`, called right after the `await` completes — we call `.Span` to drop down to the faster `Span<T>` view. Rule of thumb: **synchronous** methods take `Span<T>`/`ReadOnlySpan<T>`; **async** methods take `Memory<T>`/`ReadOnlyMemory<T>`, converting to a `Span` only for the synchronous stretches between awaits.

## Pooling buffers: paying the allocation cost once instead of every request {a}

[Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap) already established that anything **≥ 85 KB** goes straight onto the Large Object Heap, and allocating there repeatedly leads to frequent, expensive full GCs. Allocating a large temporary buffer fresh on every request is exactly that pattern. **`ArrayPool<T>`** breaks it: rent a buffer when you need one, return it when done, and let the pool hand that same physical array to the next caller instead of the GC having to reclaim and re-allocate it.

```csharp
byte[] buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);   // may return a LARGER array than requested
try
{
    int n = await stream.ReadAsync(buffer.AsMemory(0, 64 * 1024), ct);
    Process(buffer.AsSpan(0, n));                          // only use the part you asked for
}
finally
{
    ArrayPool<byte>.Shared.Return(buffer);                 // never use it after returning
}
```

Two details in that `finally` block are easy to get wrong. First, `Rent` may hand back an array **larger** than what you asked for — the pool deals in fixed bucket sizes, not exact matches — so slice down to the length you actually requested rather than trusting `.Length`. Second, and more dangerous: once you've called `Return`, that array can be handed to a different caller at any moment, so using it afterward means reading or writing data that now belongs to someone else's operation.

Related tools worth knowing by name for when `ArrayPool` alone isn't quite the right shape: `RecyclableMemoryStream` (Microsoft.IO) for pooled, growable memory streams; `ObjectPool<T>` (Microsoft.Extensions.ObjectPool, commonly used for pooling `StringBuilder` instances); `MemoryPool<T>`; `IBufferWriter<T>`/`ArrayBufferWriter<T>`; and **System.IO.Pipelines** (`PipeReader`/`PipeWriter`), the pooled-buffer abstraction Kestrel itself is built directly on top of.

## ref locals, ref returns, in and scoped {a}

```csharp
// Return a reference into an array instead of a copy, so callers can modify in place
public static ref Order FindRef(Order[] orders, int id)
{
    for (int i = 0; i < orders.Length; i++)
        if (orders[i].Id == id) return ref orders[i];
    throw new KeyNotFoundException();
}

ref var o = ref FindRef(arr, 7);
o.Status = Status.Shipped;       // modifies the array element directly (useful for structs)
```

A normal method return hands back a *copy* — for `Order` as a `struct`, mutating `o` afterward would mutate a throwaway copy, touching nothing in `arr`. `ref Order FindRef(...)` changes that: it returns a genuine reference *into the array itself*, so `o.Status = Status.Shipped` writes straight back into `arr[i]`, no copy involved.

The rest of this family exists for increasingly specialized control: `scoped` restricts how long a `ref` can live, so the compiler can *prove*, statically, that it never escapes its intended scope — a safety mechanism, not a performance one. `ref readonly` returns a reference the caller is guaranteed can't modify through. `Unsafe.As`, `MemoryMarshal.Cast` and `CollectionsMarshal` give expert-level control over memory representation. All four matter mainly inside library and infrastructure code — application-level backend code rarely needs any of them directly.

## unsafe code and interop {a}

```csharp
// <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
unsafe
{
    int x = 10;
    int* p = &x;
    *p = 20;
    fixed (byte* ptr = buffer) { /* pin a managed array so the GC won't move it */ }
}

// Calling native code: P/Invoke with a source-generated marshaller (AOT-friendly)
internal static partial class Native
{
    [LibraryImport("libc", EntryPoint = "getpid")]
    internal static partial int GetPid();
}
```

Raw pointers step entirely outside the type-safety and bounds-checking guarantees the rest of this book takes for granted — the CLR's "managed code" promises from [How code runs](ch:how-code-runs#meanwhile-the-clr-is-doing-a-lot-more-than-just-this) don't apply inside an `unsafe` block. Reach for this only for genuine native interop, or a hot spot you've actually measured and proven needs it — not as a general performance habit. `fixed` deserves its own callout: it **pins** a managed object, telling the GC "don't move this one during compaction," which is necessary before handing its address to native code. The cost (see [Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap)) is that a long-lived pin sits immovably in the middle of the heap, forcing the GC to compact *around* it and fragmenting the heap over time.

## Reflection: reading your own program's metadata, from inside the program {i}

**Reflection** is code that reads an assembly's own metadata — covered back in [How code runs](ch:how-code-runs#what-build-time-actually-hands-you) as the structured description bundled into every compiled `.dll` — while the program is actually running, and can use that metadata to create instances and invoke members it only discovered by name, not by a compile-time reference.

```csharp
Type t = typeof(Order);                                   // or obj.GetType(), or Type.GetType("Shop.Order")
foreach (PropertyInfo p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
    Console.WriteLine($"{p.Name}: {p.PropertyType.Name}");

object instance = Activator.CreateInstance(t)!;
t.GetProperty("Status")!.SetValue(instance, OrderStatus.Paid);
var result = t.GetMethod("Cancel")!.Invoke(instance, null);

// Assembly scanning: how DI auto-registration and MediatR-style handler discovery work
var handlerTypes = typeof(Program).Assembly.GetTypes()
    .Where(x => x is { IsAbstract: false, IsInterface: false })
    .SelectMany(x => x.GetInterfaces(), (impl, iface) => (impl, iface))
    .Where(p => p.iface.IsGenericType && p.iface.GetGenericTypeDefinition() == typeof(IRequestHandler<,>));
```

That last block is worth recognizing on sight: scanning *every type in an assembly*, filtering down to the ones implementing a particular generic interface, is exactly how DI auto-registration tools and MediatR-style handler discovery find every `IRequestHandler<,>` in your codebase without you registering each one by hand.

This same capability powers a surprisingly large share of .NET: **DI containers** use it to find a type's constructor and parameters; **serializers** use it to read an object's properties; **ASP.NET Core** uses it to discover controllers and bind models; **EF Core** uses it to build its entity model; **test frameworks** use it to find every `[Fact]`-attributed method; **AutoMapper-style mappers** use it to match source and destination properties by name.

That power has a real, measurable **cost**: reflective calls are slow compared to a direct method call, because they involve string-based lookups, security checks, and boxing every argument into an `object[]` to pass through a generic `Invoke`. They're allocation-heavy on top of that. They're **invisible to the compiler** — rename a property reflection looks up by string, and nothing breaks until that code actually runs and fails to find it. And reflection is **hostile to trimming and Native AOT** (see [How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely) on trimming): a trimmer can't know a method accessed only by a runtime string lookup is still needed, and will happily remove it.

Mitigations, roughly in order of how much they help: cache the `PropertyInfo`/`MethodInfo` once, rather than re-resolving it every call; compile an **expression tree** (covered at the end of this chapter) or use `Delegate.CreateDelegate` to turn a one-time reflective lookup into a fast, reusable delegate; reach for `UnsafeAccessor` (.NET 8) for private-member access that doesn't need full reflection; or, best for new code, use a **source generator** instead — the rest of this chapter builds toward that.

## Attributes: metadata that does nothing until something reads it {i}

**Attributes** attach declarative metadata directly to code — but, on their own, an attribute does *nothing at all*. It's inert until some other piece of code — the compiler, the runtime, or a framework, almost always via reflection or a dedicated metadata-reading path — specifically goes looking for it and acts on what it finds.

```csharp
[ApiController]
[Route("api/orders")]
[Authorize(Policy = "CanReadOrders")]
public class OrdersController : ControllerBase
{
    [HttpGet("{id:int}")]
    [ProducesResponseType<OrderDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult Get(int id) => Ok();
}

public class CreateUser
{
    [Required, EmailAddress, MaxLength(256)] public string Email { get; set; } = "";
    [JsonPropertyName("display_name")] public string? Name { get; set; }
}

// Your own attribute
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class AuditAttribute(string action) : Attribute
{
    public string Action { get; } = action;
}

// Reading it (e.g. in an endpoint filter or middleware)
var audit = endpoint?.Metadata.GetMetadata<AuditAttribute>();
```

| Read by | Examples |
|---|---|
| **Compiler** | `[Obsolete]`, `[CallerMemberName]`, `[NotNullWhen]`, `[SetsRequiredMembers]`, `[Experimental]` |
| **Runtime** | `[Serializable]`, `[StructLayout]`, `[MethodImpl(AggressiveInlining)]`, `[ThreadStatic]` |
| **Frameworks** | `[HttpGet]`, `[Authorize]`, `[FromBody]`, `[Required]`, `[Key]`, `[JsonPropertyName]`, `[Fact]` |
| **Source generators** | `[LoggerMessage]`, `[JsonSerializable]`, `[GeneratedRegex]`, `[LibraryImport]` |

Notice how differently "reader" behaves across rows — the same `[Attribute]` syntax feeds four genuinely different consumers, each acting at a different stage: compile time, runtime, framework startup, or build-time code generation. In ASP.NET Core, endpoint attributes like `[Authorize]` get converted into **endpoint metadata** that middleware can read *after* routing has selected the endpoint — [Routing](ch:routing) covers how that connection works, and it's why middleware ordering matters so much for anything reading endpoint metadata.

## Source generators: doing reflection's job, but at build time instead of runtime {a}

A **source generator** is a plugin that hooks into the Roslyn compiler itself, inspects your code **during compilation**, and **adds new, real C# source files** to the build. The crucial difference from reflection: the output is ordinary, compiled code — fast to run, debuggable like anything else you wrote, and, because it's genuinely present in the compiled output rather than discovered by a runtime string lookup, **fully visible to the trimmer**.

```csharp
// 1. Logging: generates an efficient, strongly-typed logging method
public static partial class Log
{
    [LoggerMessage(EventId = 1001, Level = LogLevel.Information, Message = "Order {OrderId} placed by {CustomerId}")]
    public static partial void OrderPlaced(this ILogger logger, int orderId, int customerId);
}
logger.OrderPlaced(order.Id, order.CustomerId);   // no boxing, no template parsing at runtime, level checked first

// 2. JSON: serializer metadata generated at compile time (required for Native AOT)
[JsonSerializable(typeof(OrderDto))]
[JsonSerializable(typeof(List<OrderDto>))]
internal partial class ShopJsonContext : JsonSerializerContext { }
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, ShopJsonContext.Default));

// 3. Regex: compiled to C# at build time
public static partial class Patterns
{
    [GeneratedRegex(@"^[A-Z]{2}-\d{4}$", RegexOptions.CultureInvariant)]
    public static partial Regex Sku();
}
bool ok = Patterns.Sku().IsMatch("KB-1234");
```

Notice the shared shape across all three examples: each declares a `partial` method or class, with no body of its own, plus an attribute telling the generator *what* to produce. The generator writes the actual implementation into a separate, generated file, compiled alongside your own code as if you'd written it by hand. `[LoggerMessage]` writes a logging method that parses its message template once, at build time, instead of re-parsing it on every call the way `logger.LogInformation($"...")` effectively would. `[JsonSerializable]` pre-generates the type metadata `System.Text.Json` would otherwise need reflection to discover at runtime — which is why it's **required**, not just an optimization, for Native AOT. `[GeneratedRegex]` compiles a regex pattern into actual matching code at build time, instead of the runtime regex engine interpreting the pattern on first use.

Beyond these three: configuration binding (`EnableConfigurationBindingGenerator`), minimal API request delegates (RDG), options validation (`[OptionsValidator]`), `[LibraryImport]` native interop, and Blazor/Razor compilation. Popular third-party ones include Mapperly (object-to-object mapping), Mediator (a source-generated alternative to reflection-based MediatR), Refit, StronglyTypedId and Vogen.

:::why Why the whole .NET ecosystem is actively moving from reflection to generators
Reflection does its discovery work **every time the app starts** — slowing startup every time, for every process — and hides the code it touches from the trimmer, which is why reflection-heavy libraries tend to be Native-AOT-incompatible. Generators do the *same* discovery work **once, at build time**, and emit plain, ordinary code. The payoff: faster startup (nothing left to discover at runtime), lower allocations, errors caught at compile time instead of surfacing deep in production, and generated code that's fully visible to the trimmer — which is what makes the app AOT-compatible at all. When choosing between similar libraries, "ships a source-generator mode" is a real advantage, not a minor detail.
:::

## Expression trees for metaprogramming: building code as data, by hand {a}

[LINQ](ch:linq#expression-trees-what-ef-core-is-actually-reading) already showed expression trees from the consuming side — EF Core walking a tree the compiler built for you from a lambda. There's a second, less common use: you can **build** an expression tree yourself, by hand, from its individual pieces, then compile it into a real, runnable delegate at runtime. This is a classic technique inside object mappers and ORMs that generate fast property-access code for types they only discover dynamically.

```csharp
// Build: (Order o) => o.Total   then compile once and cache
var param = Expression.Parameter(typeof(Order), "o");
var body = Expression.Property(param, nameof(Order.Total));
var getter = Expression.Lambda<Func<Order, decimal>>(body, param).Compile();
decimal t = getter(order);      // as fast as a normal delegate call after compilation
```

This genuinely assembles a lambda from raw pieces: `Expression.Parameter` creates the `o` parameter node, `Expression.Property` builds the `o.Total` member-access node, and `Expression.Lambda<...>(...).Compile()` turns that whole tree into an actual, callable delegate — functionally equivalent to writing `(Order o) => o.Total` directly in source, just built programmatically at runtime.

The catch: `.Compile()` itself is expensive — milliseconds, not microseconds — and isn't available at all under Native AOT, where it falls back to a slower interpreter instead of genuinely compiling. The practical rule: **cache the compiled delegate** rather than recompiling on every call, and for new code, prefer a source generator over hand-built expression trees wherever one is available — same "fast, type-specific code" outcome, without paying the runtime compilation cost.

:::qa What is Span<T> and why is it useful?
A stack-only struct that represents a contiguous region of memory (array, string, stack or native) as a pointer plus length. Slicing creates views without copying, so parsing and formatting can run with zero allocations, reducing GC pressure in hot paths.
:::

:::qa Why can't Span<T> be used in async methods or stored in a class field?
It's a ref struct that may point to stack memory, so it must never end up on the heap. Async methods and iterators store locals in a heap-allocated state machine, and class fields live on the heap, so both are forbidden. Use Memory&lt;T&gt; instead and call .Span when working synchronously.
:::

:::qa Span<T> vs Memory<T>?
Span&lt;T&gt; is a ref struct: stack-only, fastest, usable in synchronous code. Memory&lt;T&gt; is a regular struct that can live on the heap, be stored in fields and cross awaits; you get a Span from it via .Span.
:::

:::qa What is ArrayPool and when would you use it?
A pool of reusable arrays (ArrayPool&lt;T&gt;.Shared). Rent large temporary buffers instead of allocating them per operation, which avoids LOH allocations and GC pressure, and return them in a finally block. Remember that Rent may return a larger array than requested.
:::

:::qa What is reflection and what are its downsides?
Runtime inspection and invocation of types and members via metadata. It powers DI, serializers, ORMs and test runners, but it's slow, allocates, bypasses compile-time checking, and isn't compatible with trimming/Native AOT unless annotated. Cache reflection results, compile delegates, or use source generators instead.
:::

:::qa What are attributes and who reads them?
Declarative metadata attached to code elements. They are passive and read by the compiler (Obsolete, nullable attributes), the runtime (StructLayout), frameworks via reflection or endpoint metadata (HttpGet, Authorize, Required), or source generators (LoggerMessage, JsonSerializable).
:::

:::qa What is a source generator and why are they replacing reflection?
A compiler plugin that analyses your code during the build and adds generated C# source. It moves work from runtime to compile time, giving faster startup, fewer allocations and compile-time errors, and the generated code is visible to the trimmer, enabling Native AOT. Examples: LoggerMessage, System.Text.Json source generation, GeneratedRegex.
:::

:::qa What does the fixed statement do?
It pins a managed object in memory for the duration of the block so the GC can't move it, letting you take a stable pointer to it (for unsafe code or native interop). Long or frequent pinning fragments the heap.
:::

## Further reading

- [Memory and Span usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines)
- [Source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview)
- [Reflection in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/reflection)
- Stephen Toub's annual *Performance Improvements in .NET N* blog posts, which show these techniques used throughout the BCL.
- Book: *Pro .NET Memory Management* by Konrad Kokosa.

## Verify this chapter

Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`. It checks that slicing a `Span` is a view (not a copy), `stackalloc`, `Memory<T>` crossing an `await`, `ArrayPool` sizing, `ref` returns, reflection (property discovery, construction, invocation), reading a custom attribute, and a hand-built expression tree.

```csharp
using System.Buffers;
using System.Linq.Expressions;
using System.Reflection;

int failures = 0;
void Check(string claim, bool ok)
{
    if (ok) Console.WriteLine($"OK: {claim}");
    else { Console.WriteLine($"FAIL: {claim}"); failures++; }
}

// 1. Slicing a Span is a VIEW, not a copy: mutating through the slice mutates the original array
int[] array = [1, 2, 3, 4, 5];
Span<int> slice = array.AsSpan(1, 2);
slice[0] = 99;
Check("mutating a Span slice writes through to the original array (it's a view, not a copy)", array[1] == 99);

// 2. stackalloc gives real, usable stack memory
Span<byte> onStack = stackalloc byte[4];
onStack[0] = 42;
Check("stackalloc produces a Span you can read and write", onStack[0] == 42);

// 3. Memory<T> can cross an await; .Span gives the fast synchronous view
async Task<int> SumViaMemoryAsync(Memory<int> buffer)
{
    await Task.Yield();               // crossing an await — Memory<T> survives this, Span<T> couldn't be a local here
    int total = 0;
    foreach (var v in buffer.Span) total += v;   // drop to Span for the synchronous part
    return total;
}
int sum = await SumViaMemoryAsync(new[] { 1, 2, 3 });
Check("Memory<T> can be used across an await and converted to Span for synchronous work", sum == 6);

// 4. ArrayPool: Rent may return an array >= requested size; Return lets it be reused
byte[] rented = ArrayPool<byte>.Shared.Rent(1000);
bool bigEnough = rented.Length >= 1000;
ArrayPool<byte>.Shared.Return(rented);
Check("ArrayPool<T>.Shared.Rent returns an array at least as large as requested", bigEnough);

// 5. ref return: writing through a ref return modifies the original array element
int[] numbers = [10, 20, 30];
ref int FindRef(int[] arr, int value)
{
    for (int i = 0; i < arr.Length; i++) if (arr[i] == value) return ref arr[i];
    throw new KeyNotFoundException();
}
ref int found = ref FindRef(numbers, 20);
found = 999;
Check("a ref return lets you modify the original array element, not a copy", numbers[1] == 999);

// 6. Reflection: discover properties, create an instance, set a property, invoke a method
Type t = typeof(Order);
var propertyNames = t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name).ToHashSet();
Check("reflection discovers a type's public properties by name", propertyNames.Contains("Total") && propertyNames.Contains("Status"));

object instance = Activator.CreateInstance(t)!;
t.GetProperty("Status")!.SetValue(instance, "Paid");
var afterInvoke = t.GetMethod("Describe")!.Invoke(instance, null);
Check("reflection can construct an instance, set a property, and invoke a method by name",
    (string)afterInvoke! == "Order: Paid");

// 7. Attributes are inert until something reads them via reflection
var method = typeof(Order).GetMethod("Describe")!;
var audit = method.GetCustomAttribute<AuditAttribute>();
Check("a custom attribute attached to a method can be read back via reflection", audit?.Action == "describe");

// 8. Hand-built expression tree compiles into a working delegate
var param = Expression.Parameter(typeof(Order), "o");
var body = Expression.Property(param, nameof(Order.Status));
var getter = Expression.Lambda<Func<Order, string>>(body, param).Compile();
var orderForTree = new Order { Status = "Shipped" };
Check("a hand-built Expression<Func<T,TResult>> compiles into a delegate that reads the right property",
    getter(orderForTree) == "Shipped");

Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
if (failures > 0) Environment.Exit(1);

class Order
{
    public decimal Total { get; set; }
    public string Status { get; set; } = "New";

    [Audit("describe")]
    public string Describe() => $"Order: {Status}";
}

[AttributeUsage(AttributeTargets.Method)]
sealed class AuditAttribute(string action) : Attribute
{
    public string Action { get; } = action;
}
```

Not runtime-verifiable here: `ref struct`/stack-only enforcement is a *compile-time* restriction (try putting a `Span<T>` in a class field yourself to see the compiler reject it); raw pointer/`unsafe` code needs `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>` in the project file, which this single-file script doesn't set; and source generators ([LoggerMessage], [JsonSerializable], [GeneratedRegex]) only run as part of a real build with the generator package referenced — their output can be inspected in `obj/generated` after building a project that uses them, but not from a standalone script. See [Further reading](#further-reading) for all three.
