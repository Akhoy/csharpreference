---
id: advanced-csharp
title: "Advanced C#: One Long Night at Kettle (Span, ref, Interop, Reflection, Generators)"
summary: "Episode 10, the finale, told as one long night and day at Kettle in seven acts. A 2-million-row import drowns the GC (Span, stackalloc, Memory), 1 MB buffers pile up (ArrayPool), repricing copies millions of structs (ref, in, ref safety), the warehouse printer only speaks C (unsafe, fixed, LibraryImport), compliance wants every refund audited (attributes, reflection), a serverless cold start is too slow (source generators, Native AOT), and the owner wants a report builder (expression trees built by hand)."
layer: language
where: C# language › Advanced & low-level features
fits: Layer 1 features with deep layer 2 roots. Span and ref structs exist because of how the runtime manages memory ([Memory & GC](ch:memory-gc)), and source generators exist because reflection fights trimming and Native AOT ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)). In layer 3, Kestrel, System.Text.Json and EF Core use every technique in this chapter.
levels: i,a
prereqs: type-system, generics, async-await
next: memory-gc, performance-engineering
---

## The 30-second version

Advanced C# is the toolbox for when the normal tools **cost too much**: too many allocations, too many copies, a C library you have to call, or work done at runtime that could have been done at build time. Each act of this episode is one of those moments:

| Act | Kettle's problem | The tool | The idea in one line |
|---|---|---|---|
| 1 | The import creates 10 million throwaway strings | `Span<T>`, `stackalloc`, `Memory<T>` | look at memory, don't copy it |
| 2 | A new 1 MB buffer for every chunk | `ArrayPool<T>` | borrow buffers, give them back |
| 3 | Repricing copies 2 million structs | `ref` locals and returns, `in` | point at the slot, don't copy it out |
| 4 | The label printer only has a C library | `unsafe`, `fixed`, `LibraryImport` | pin memory while native code reads it |
| 5 | Every refund must be audited | attributes, reflection | label code, read the labels at runtime |
| 6 | The serverless cold start takes 2.4 s | source generators, Native AOT | do reflection's work at build time |
| 7 | The owner wants a "filter by anything" screen | expression trees, built by hand | build the query as data |

## Previously, and the night ahead {b}

In [Episode 9](ch:modern-csharp) Kettle's code got safer and shorter. Kettle is a real business now: a warehouse, a nightly supplier feed, an admin team and a finance department. Over one night and the following day, seven things go wrong. Each one hits a limit of the "normal" C# from Episodes 1–9, and each one has an advanced tool built for exactly that limit.

:::scene visuals/scenes/adv-night.svg | One long night, seven problems
1. **01:00, the import.** The supplier's 2-million-line price file. `Split` creates ten million throwaway strings, and the garbage collector can't keep up.
2. **01:40, the chunks.** The file is read in 1 MB chunks, and each chunk allocates a new 1 MB array that's garbage seconds later.
3. **02:30, repricing.** Every price goes up 5%. The stock is two million *structs*, and the obvious loop changes copies, not the real data.
4. **04:00, labels.** The warehouse's new label printer comes with only a C library. C# has to hand it raw bytes.
5. **09:00, the audit.** Finance wants every refund and cancellation logged. Developers keep forgetting to call the logger.
6. **11:00, the cold start.** The price-check API moves to serverless. Every cold start takes 2.4 seconds, mostly reflection discovering things at startup.
7. **14:00, reports.** The owner wants to filter orders by *any* field, chosen on screen, and still have it run as SQL.
:::

## Act 1 · 01:00 — The import: look, don't copy {i}

Every night Kettle imports lines like `2026-11-27,TEA-01,6.50,GBP`. Here's the parsing code with an allocation counter attached. Run it:

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

`Split` builds a new array and four new strings for every line, copying every character, and all of it is thrown away a moment later. Two million lines means **ten million objects** for the GC to find and free.

**The lightbulb:** you don't need copies of the fields. You only need to *look at* part of a line that's already in memory. That's a **`Span<T>`**: a **window** onto memory that already exists, just "start here, this many items long". Slicing a span gives you a smaller window, **never a copy**. For text it's `ReadOnlySpan<char>`, and most parsing methods (`int.Parse`, `decimal.Parse`, `Guid.Parse`…) accept one directly.

:::scene visuals/scenes/adv-span.svg | Copying fields vs looking through a window
1. One line of the CSV is already in memory as a single string. You need four fields from it, two million times a night.
2. **`Split(',')`** creates a `string[]` and **four brand-new strings**, copying every character. That's 5 objects per line, or 10 million objects a night.
3. **`line.AsSpan(0, 10)`** is a window over the date characters, just a start and a length over the *same* memory. Nothing is copied.
4. Move the window to the price and call `decimal.Parse(window)`. It reads straight from the original text. **Zero allocations per line.**
5. A span can point at **stack** memory, which vanishes when a method returns. So the compiler never lets a span reach the heap: no fields, no lambdas, no `await`. Those rules are what make "zero-copy" safe.
:::

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

A span can view almost any memory: part of an array, part of a string, or memory on the **stack** that the GC never sees.

```csharp
int[] stock = [12, 0, 7, 3, 9];
Span<int> middle = stock.AsSpan(1, 3);       // a window over part of an array
middle[0] = 50;                               // writes INTO the array
Console.WriteLine(stock[1]);                  // 50

ReadOnlySpan<char> word = "Sencha tea".AsSpan(0, 6);   // part of a string, no new string
Console.WriteLine(word.ToString());

Span<char> label = stackalloc char[16];       // 16 chars on the STACK: no heap, no GC
"ORD-".AsSpan().CopyTo(label);
42.TryFormat(label[4..], out int written);    // format straight into the buffer
Console.WriteLine(label[..(4 + written)].ToString());   // ORD-42
```

:::qa What is Span<T> and why is it useful?
A stack-only struct that represents a contiguous region of memory (an array, a string, the stack or native memory) as a pointer plus a length. Slicing creates views without copying, so parsing and formatting can run with zero allocations, which reduces GC pressure in hot paths.
:::

### Why Span has strict rules: ref structs

`stackalloc` memory lives in the method's stack frame and disappears when the method returns ([Episode 1](ch:type-system#where-the-data-lives-stack-and-heap)). If a span pointing at it were stored somewhere that *outlives* the method, it would point at garbage. So `Span<T>` is a **`ref struct`**, a type the compiler only ever allows on the stack. Every restriction follows from that one rule:

| A ref struct can't… | because that would put it on the heap, via… |
|---|---|
| be a field of a class | the object, which lives on the heap |
| be boxed or cast to `object` or an interface | the box ([Episode 1](ch:type-system#boxing-a-value-type-in-a-cardboard-box)) |
| be captured by a lambda | the closure's backpack ([Episode 4](ch:delegates-events#closures-a-lambda-packs-a-backpack)) |
| be used across `await` or `yield` | the async state machine ([Episode 8](ch:async-await#under-the-hood-the-state-machine)) |
| be an array element | the array |

C# 13 relaxed this a little, safely: ref structs can implement interfaces (without boxing) and be generic arguments with `where T : allows ref struct` ([Generics](ch:generics#constraints-a-job-description-for-t)).

### Memory<T>: the version that can wait

The import reads the file asynchronously, and a `Span` can't cross an `await`. **`Memory<T>`** is the heap-safe version: an ordinary struct that never points at stack memory, so it can be stored in fields and survive an `await`.

```csharp norun
public async Task<int> ReadChunkAsync(Stream s, Memory<byte> buffer, CancellationToken ct)
{
    int read = await s.ReadAsync(buffer, ct);     // Memory is fine across an await
    return Checksum(buffer.Span[..read]);         // drop to a Span for the synchronous work
}
```

**Rule of thumb:** synchronous methods take `Span<T>`/`ReadOnlySpan<T>`. Async methods take `Memory<T>`/`ReadOnlyMemory<T>` and use `.Span` between awaits.

:::qa Why can't Span<T> be used in async methods or stored in a class field?
It's a ref struct that may point to stack memory, so it must never end up on the heap. Async methods and iterators store their locals in a heap-allocated state machine, and class fields live on the heap, so both are forbidden. Use `Memory<T>` instead, and call `.Span` in the synchronous parts.
:::

:::qa Span<T> vs Memory<T>?
`Span<T>` is a ref struct: stack-only, the fastest option, and usable in synchronous code. `Memory<T>` is a regular struct that can live on the heap, be stored in fields and cross awaits. You get a Span from it with `.Span`.
:::

## Act 2 · 01:40 — The chunks: borrow, don't buy {i}

The import reads the file in 1 MB chunks, and every chunk allocates a fresh 1 MB array. Anything of 85 KB or more goes on the **Large Object Heap**, which is only cleaned by an expensive full GC ([Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap)). So the import keeps triggering the most expensive kind of garbage collection there is.

**The lightbulb:** the import only ever needs a few buffers *at once*, so keep a shelf of them and reuse them. That shelf is **`ArrayPool<T>.Shared`**. You **rent** an array, use it, and **return** it.

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

## Act 3 · 02:30 — Repricing: change it where it lives {a}

The import finished. Now every price goes up 5%. Kettle keeps stock levels as a **struct**, `StockLevel` (it's small and there are two million of them, so a struct is the right call per [Episode 1](ch:type-system#when-should-kettle-use-a-struct)). The obvious code doesn't even compile:

```csharp norun
foreach (var s in stock) s.Price *= 1.05m;   // ✗ CS1654: s is a read-only COPY of each element
stock[0].Price *= 1.05m;                      // ✗ CS1612 on a List<T>: the indexer returns a COPY
```

You met this in Episode 1: a struct is **copied** whenever it's read out of a collection, so changing "it" changes a temporary copy. The workaround people reach for is "read, change, write back", which copies every struct out **and** back in.

**The lightbulb:** you want a variable that doesn't hold a copy of the struct but **points at the slot where the struct lives**. That's a **`ref` local**: `ref var s = ref stock[0];`. Writing `s.Price` writes straight into the array. The same idea appears as **`ref` returns** (a method hands back a slot, not a copy) and **`in` parameters** (pass a read-only reference instead of copying a big struct).

:::scene visuals/scenes/adv-ref.svg | A copy, or the slot itself?
1. `var s = stock[0]` gives you a **copy**. Changing the price changes the copy, and the array still says £10.00. That's why the compiler refuses `foreach (var s …) s.Price = …`.
2. `ref var s = ref stock[0]` gives you an arrow **into slot 0**. There's no copy: `s` *is* the slot, so writing `s.Price` changes the array.
3. `foreach (ref var s in span)` walks every slot with a ref and updates each one in place. That's 2 million structs and zero copies.
4. `in` passes a **read-only reference** to a method, so a big struct isn't copied on every call. (Mark the struct `readonly`, or the compiler may copy it anyway to protect it.)
5. Why this is safe: the compiler **proves** a ref can never outlive what it points at. Returning a ref to a local variable is a compile error. This is called **ref safety**, and the `scoped` keyword lets you tighten it further.
:::

```csharp
using System.Runtime.InteropServices;

var stock = new List<StockLevel> { new("TEA-01", 10.00m), new("TEA-02", 20.00m), new("TEA-03", 6.00m) };

foreach (ref var s in CollectionsMarshal.AsSpan(stock))   // a ref to each slot of the List's own array
    s.Price *= 1.05m;                                       // written in place: no copies
Console.WriteLine(string.Join(", ", stock.Select(s => $"{s.Sku} £{s.Price:0.00}")));

StockLevel[] shelf = [new("TEA-09", 4.00m), new("TEA-10", 0m)];
ref StockLevel tea10 = ref Find(shelf, "TEA-10");          // a ref RETURN: the slot, not a copy
tea10.Price = 7.50m;
Console.WriteLine($"{shelf[1].Sku} now £{shelf[1].Price}, valid: {IsValid(in shelf[1])}");

static ref StockLevel Find(StockLevel[] items, string sku)
{
    for (int i = 0; i < items.Length; i++)
        if (items[i].Sku == sku) return ref items[i];
    throw new KeyNotFoundException(sku);
}

static bool IsValid(in StockLevel s) => s.Price > 0;      // in: a read-only reference, no copy

struct StockLevel(string sku, decimal price)
{
    public string Sku = sku;
    public decimal Price = price;
}
```

:::gotcha `CollectionsMarshal.AsSpan` and resizing
`CollectionsMarshal.AsSpan(list)` gives you the `List`'s own internal array. Don't add or remove items while you hold it. A resize swaps in a new array ([Episode 5](ch:collections#inside-list-why-add-is-amortised-o-1)) and your span keeps pointing at the old one.
:::

The rest of this family is mostly for library authors: `ref readonly` returns, `scoped`, and `Unsafe`, `MemoryMarshal` and `CollectionsMarshal` for expert control over memory.

:::qa What is a defensive copy, and how do `in` and `readonly struct` relate to it?
When you call a member on a struct the compiler can't prove won't modify it, such as a method on a non-readonly struct passed by `in` or held in a `readonly` field, the compiler first copies the struct so the original can't change. That's a defensive copy. It silently undoes the point of `in`. Declaring the struct `readonly struct` (or its members `readonly`) tells the compiler mutation is impossible, so no copy is needed.
:::

## Act 4 · 04:00 — The label printer only speaks C {a}

The warehouse's new thermal printer comes with one thing: a C library, `labelprint.so`, with a single function:

```c
int print_label(const char* zpl, int len);   // zpl = the label as bytes
```

C# needs to hand that function a **pointer to raw bytes**. But C# objects live on the managed heap, and the GC is allowed to **move** them when it compacts the heap ([Memory & GC](ch:memory-gc)). A C function holding an address while the GC moves the array would read whatever happens to be there now.

**The lightbulb:** for the few microseconds the C code is reading, tell the GC "**don't move this one**". That's called **pinning**, and the `fixed` statement does it. Calling native functions from .NET is called **P/Invoke** (platform invoke). Working with raw pointers needs an **`unsafe`** block, because the CLR's usual safety checks don't apply there.

:::scene visuals/scenes/adv-interop.svg | Handing bytes to native code
1. Kettle builds the label as bytes, in an ordinary `byte[]` on the managed heap.
2. The GC compacts the heap and the array **moves**. A pointer taken earlier would now point at junk, and C code trusts pointers blindly.
3. `fixed (byte* p = zpl) { … }` **pins** the array: the GC must leave it where it is until the block ends.
4. `print_label(p, zpl.Length)` reads the bytes at that stable address. When the `fixed` block ends, the array is unpinned.
5. In practice, `[LibraryImport]` (a source generator) writes the pinning and conversion code for you. You pass a span, and the `unsafe` code stays in generated, reviewed code.
:::

```csharp norun
// The hand-written version: needs <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
static unsafe int Print(byte[] zpl)
{
    fixed (byte* p = zpl)                 // pin: the GC won't move zpl inside this block
        return Native.print_label(p, zpl.Length);
}

// The modern version: the generator writes the marshalling and pinning, and it works with Native AOT
internal static partial class Printer
{
    [LibraryImport("labelprint", EntryPoint = "print_label")]
    internal static partial int PrintLabel(ReadOnlySpan<byte> zpl, int len);
}

var zpl = "^XA^FO50,50^ADN,36,20^FDSencha 100g^FS^XZ"u8;   // UTF-8 bytes, no allocation
Printer.PrintLabel(zpl, zpl.Length);
```

Rules for this territory:

- Reach for `unsafe` only for native interop, or for a hot spot you've **measured**. Spans give you most of the speed with all of the safety.
- **Pin briefly.** Long or frequent pinning leaves holes the GC can't compact, which fragments the heap.
- Wrap native handles (files, sockets, device handles) in a **`SafeHandle`**, which releases them even if someone forgets to dispose ([Episode 7](ch:exceptions-disposal#the-full-pattern-with-a-finalizer-rarely-needed)).

:::qa What does the fixed statement do?
It pins a managed object in memory for the duration of the block, so the GC can't move it, which lets you take a stable pointer to it for unsafe code or native interop. Long or frequent pinning fragments the heap.
:::

:::qa How do you call native code from .NET, and what is LibraryImport?
Through P/Invoke: you declare an `extern` (or `partial`) method marked with the native library and entry point, and the runtime marshals arguments across the boundary. `[LibraryImport]` (.NET 7+) is the source-generated version of the older `[DllImport]`. The marshalling and pinning code is generated at build time instead of being produced at runtime, which makes it faster, debuggable and compatible with Native AOT.
:::

## Act 5 · 09:00 — The audit nobody can forget {i}

Morning. Finance has a new rule: every **refund** and every **cancellation** must be logged with who did it and when. The first version adds `audit.Log(...)` inside each admin method. Within a week someone adds `IssueStoreCredit` and forgets the line, and the auditors find the gap.

**The lightbulb:** don't rely on every method remembering. **Label** the methods that need auditing, and enforce the rule in **one place** that reads the labels. In C#, a label on code is an **attribute** (`[Audit("refund.issue")]`). Code that reads labels, types and methods *while the program runs* is called **reflection**. It works because every compiled assembly carries **metadata**, a full catalogue of its types, methods and attributes ([How code runs](ch:how-code-runs#what-build-time-actually-hands-you)).

:::scene visuals/scenes/adv-reflection.svg | Label the code, read the labels
1. Every compiled assembly carries **metadata**: a catalogue of every type, method and attribute, shipped inside the `.dll`.
2. You add `[Audit("refund")]` and `[Audit("cancel")]` labels. An attribute is just an entry in that catalogue. **On its own it does nothing at all.**
3. At startup, **reflection** reads the catalogue: `GetTypes()`, then `GetMethods()`, then `GetCustomAttribute<Audit>()`. It finds two labelled methods.
4. The one central dispatcher logs every call to a labelled method automatically. Label once, enforce in one place, and nobody can forget. `[Authorize]` and `[HttpGet]` work the same way.
5. The bill: calling a method by reflection is about **50× slower** than calling it directly, a rename breaks at runtime instead of at compile time, and the trimmer and Native AOT can't see what you look up by name. That bill comes due in Act 6.
:::

```csharp
using System.Reflection;

var admin = new OrderAdmin();
Call(admin, "Refund", 42, 12.50m);
Call(admin, "Cancel", 43);
Call(admin, "Get", 44);

Console.WriteLine("\nEvery audited action in the app (for the admin page):");
foreach (var type in typeof(OrderAdmin).Assembly.GetTypes())
    foreach (var m in type.GetMethods())
        if (m.GetCustomAttribute<AuditAttribute>() is { } a)
            Console.WriteLine($"  {type.Name}.{m.Name} → {a.Action}");

// The ONE place that enforces the rule, for every method, including ones not written yet
static void Call(object target, string methodName, params object[] args)
{
    MethodInfo m = target.GetType().GetMethod(methodName)!;          // find the method BY NAME
    if (m.GetCustomAttribute<AuditAttribute>() is { } audit)           // read its label, if it has one
        Console.WriteLine($"[audit] {audit.Action} by ada@kettle");
    Console.WriteLine("  " + m.Invoke(target, args));                 // call it, also by name
}

[AttributeUsage(AttributeTargets.Method)]
sealed class AuditAttribute(string action) : Attribute
{
    public string Action { get; } = action;
}

class OrderAdmin
{
    [Audit("refund.issue")] public string Refund(int orderId, decimal amount) => $"refunded £{amount} on order {orderId}";
    [Audit("order.cancel")] public string Cancel(int orderId) => $"cancelled order {orderId}";
    public string Get(int orderId) => $"order {orderId}: 2 × Sencha";
}
```

That's the real pattern behind much of .NET. **DI containers** find constructors this way, **serializers** read properties, **ASP.NET Core** finds controllers and `[Authorize]`, **EF Core** builds its model, and **test frameworks** find `[Fact]` methods.

Who reads attributes:

| Read by | Examples |
|---|---|
| **The compiler** | `[Obsolete]`, `[CallerMemberName]`, `[NotNullWhen]`, `[Experimental]` |
| **The runtime** | `[StructLayout]`, `[MethodImpl]`, `[ThreadStatic]` |
| **Frameworks, via reflection** | `[HttpGet]`, `[Authorize]`, `[FromBody]`, `[Required]`, `[Key]`, `[JsonPropertyName]`, `[Fact]` |
| **Source generators, at build time** | `[LoggerMessage]`, `[JsonSerializable]`, `[GeneratedRegex]`, `[LibraryImport]` |

### The bill

Measure it. Here's the same method called 200,000 times, three ways:

```csharp
using System.Diagnostics;
using System.Reflection;

var admin = new OrderAdmin();
MethodInfo refund = typeof(OrderAdmin).GetMethod("Refund")!;
object[] callArgs = [5m];
const int N = 200_000;

var sw = Stopwatch.StartNew();
for (int i = 0; i < N; i++) refund.Invoke(admin, callArgs);               // reflection, every time
Console.WriteLine($"MethodInfo.Invoke:   {sw.ElapsedMilliseconds} ms");

var fast = refund.CreateDelegate<Func<decimal, decimal>>(admin);       // reflect ONCE, then a normal delegate
sw.Restart();
for (int i = 0; i < N; i++) fast(5m);
Console.WriteLine($"cached delegate:     {sw.ElapsedMilliseconds} ms");

sw.Restart();
for (int i = 0; i < N; i++) admin.Refund(5m);                          // a plain call
Console.WriteLine($"direct call:         {sw.ElapsedMilliseconds} ms");

class OrderAdmin { public decimal Refund(decimal amount) => amount; }
```

- **It's slow and allocates.** There are string lookups, and arguments are boxed into an `object[]`. Cache the `MethodInfo`, or turn it into a delegate once, as above.
- **The compiler can't see it.** Rename `Refund` and `GetMethod("Refund")` still compiles, then returns `null` at runtime.
- **The trimmer can't see it.** Publishing with trimming or Native AOT may remove members you only mention by name. That's Act 6.

:::qa What is reflection and what are its downsides?
Runtime inspection and invocation of types and members through metadata. It powers DI, serializers, ORMs and test runners, but it's slow, it allocates, it bypasses compile-time checking, and it isn't compatible with trimming or Native AOT unless annotated. Cache reflection results, compile delegates, or use source generators instead.
:::

:::qa What are attributes and who reads them?
Declarative metadata attached to code elements. They're passive, and they're read by the compiler (`Obsolete`, the nullable attributes), the runtime (`StructLayout`), frameworks through reflection or endpoint metadata (`HttpGet`, `Authorize`, `Required`), or source generators (`LoggerMessage`, `JsonSerializable`).
:::

## Act 6 · 11:00 — The cold start: do the work at build time {a}

Kettle moves its price-check API to a serverless function, which starts a fresh process whenever traffic rises. Each **cold start takes 2.4 seconds**. A trace shows why: at startup the JSON serializer reflects over every DTO, the audit dispatcher from Act 5 scans every type, and regexes are parsed and compiled. Then the team tries **Native AOT** (compiling straight to machine code, [How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)) to start faster, and the build prints warnings like *IL2026: … uses reflection and may break when trimmed*.

**The lightbulb:** everything reflection discovers at startup was **already known when you compiled**. The DTOs, the `[Audit]` labels and the regex patterns are all right there in your source. So discover them **once, during the build**, and write the results out as ordinary code. A plugin for the C# compiler that reads your code and **adds new C# files** to the build is a **source generator**.

:::scene visuals/scenes/adv-generators.svg | Discover at runtime, or write it at build time?
1. **Reflection** happens at run time. On every start, the app asks "what properties does `OrderDto` have?", reads metadata, looks names up as strings and boxes values.
2. Rename a property and it still compiles, then **breaks at runtime**, because the lookup was a string.
3. **Native AOT and trimming** can't see string lookups, so code that's needed gets removed and the app fails.
4. A **source generator** runs inside the compiler. It reads your code and **writes plain C#** (for example `OrderDtoJson.g.cs`), compiled in with yours.
5. At run time there's **nothing left to discover**: fast startup, no boxing, errors at build time, and the trimmer sees everything, so Native AOT works.
:::

Generated code is less magic than it sounds. It's the boring code you'd write yourself if you had the patience. Here's what an `[Audit]` generator would emit in place of Act 5's reflection, and it runs with no reflection at all:

```csharp
var admin = new OrderAdmin();
Console.WriteLine(AuditedOrderAdmin.Refund(admin, 42, 12.50m));
Console.WriteLine(AuditedOrderAdmin.Cancel(admin, 43));
Console.WriteLine("audited actions: " + string.Join(", ", AuditedOrderAdmin.Actions));

// ↓ Imagine this file is AuditedOrderAdmin.g.cs, written by a generator at BUILD time
//   from the [Audit] labels. It's plain C#: no reflection, no lookups by name.
static class AuditedOrderAdmin
{
    public static readonly string[] Actions = ["refund.issue", "order.cancel"];
    public static string Refund(OrderAdmin a, int orderId, decimal amount) { Log("refund.issue"); return a.Refund(orderId, amount); }
    public static string Cancel(OrderAdmin a, int orderId) { Log("order.cancel"); return a.Cancel(orderId); }
    static void Log(string action) => Console.WriteLine($"[audit] {action} by ada@kettle");
}

// ↓ Your hand-written code: unchanged
[AttributeUsage(AttributeTargets.Method)]
sealed class AuditAttribute(string action) : Attribute { public string Action { get; } = action; }

class OrderAdmin
{
    [Audit("refund.issue")] public string Refund(int orderId, decimal amount) => $"refunded £{amount} on order {orderId}";
    [Audit("order.cancel")] public string Cancel(int orderId) => $"cancelled order {orderId}";
}
```

Rename `Refund` now and the **build** fails inside `AuditedOrderAdmin.g.cs`, where you can see it, instead of production failing at 3 a.m.

The three generators that fix Kettle's cold start, all built into .NET:

```csharp norun
// 1. JSON: serializer code generated at build time (required for Native AOT)
[JsonSerializable(typeof(PriceCheckResponse))]
internal partial class KettleJsonContext : JsonSerializerContext { }
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, KettleJsonContext.Default));

// 2. Logging: a fast, strongly typed log method (no boxing, template parsed at build time)
public static partial class Log
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Price check for {Sku} took {Ms} ms")]
    public static partial void PriceChecked(this ILogger logger, string sku, long ms);
}

// 3. Regex: compiled to C# at build time instead of parsed at startup
public static partial class Patterns
{
    [GeneratedRegex(@"^TEA-\d{2,5}$")]
    public static partial Regex Sku();
}
```

Each follows the same recipe: a **`partial`** declaration with **no body**, plus an **attribute** saying what to generate. The generator writes the body in a separate file, which is exactly why `partial` exists ([Episode 2](ch:oop#static-sealed-and-partial)). Others you'll meet: configuration binding, minimal-API request delegates, options validation, and libraries such as Mapperly, Refit and Vogen.

:::why Why all of .NET is moving from reflection to generators
Reflection pays its discovery cost **on every start, in every process**, and hides code from the trimmer. Generators pay it **once, at build time**. The result is faster startup (which matters for serverless and containers), fewer allocations, mistakes caught by the compiler, and apps that work with Native AOT. Kettle's price check went from 2.4 s to about 80 ms cold.
:::

:::qa What is a source generator and why are they replacing reflection?
A compiler plugin that analyses your code during the build and adds generated C# source. It moves work from runtime to compile time, which gives faster startup, fewer allocations and compile-time errors. The generated code is visible to the trimmer, so it enables Native AOT. Examples: `LoggerMessage`, System.Text.Json source generation, `GeneratedRegex`.
:::

## Act 7 · 14:00 — The report builder: build the query as data {a}

Afternoon. The owner wants an admin screen where they can **filter orders by any field**: "Total > 50 **and** Country = GB", or "Status = Unpaid **and** Total > 200", chosen from dropdowns. And it must run as **SQL** in the database, not by loading every order into memory ([Episode 6](ch:linq#where-does-the-query-run-ienumerable-vs-iqueryable)).

You can't write a lambda for every combination. Gluing SQL strings together (`"WHERE " + field + " > " + value`) is a textbook **SQL injection** hole.

**The lightbulb:** in Episode 6, EF Core *read* an expression tree that the compiler built from your lambda. Nothing stops **you** from building that tree yourself, node by node, from whatever the user picked. The `System.Linq.Expressions` API is a **code factory**: `Expression.Property`, `Expression.Constant`, `Expression.GreaterThan` and `Expression.AndAlso` assemble an `Expression<Func<Order, bool>>` at runtime, the same thing the compiler would have built from `o => o.Total > 50 && o.Country == "GB"`.

:::scene visuals/scenes/adv-exprbuild.svg | From dropdowns to a safe SQL query
1. The admin screen produces filter **rows** at runtime: `Total > 50`, `Country = "GB"`. You can't write a lambda in advance for every combination.
2. Each row becomes a few **nodes**: a `Property` access, a `Constant` value, and a comparison such as `GreaterThan`.
3. The rows are joined with `AndAlso` into **one** `Expression<Func<Order,bool>>`, the same tree the compiler would build from a lambda.
4. Use it two ways. `.Compile()` turns it into a delegate for in-memory lists. Or pass the tree to `db.Orders.Where(...)`, and EF Core writes SQL **with parameters**.
5. Why not just build a SQL string? `"WHERE " + userInput` is SQL injection waiting to happen. In a tree, whatever the user typed is only ever a `Constant` node, sent as a parameter.
:::

```csharp
using System.Globalization;
using System.Linq.Expressions;

var orders = new[] { new Order(1, 80m, "GB"), new Order(2, 30m, "GB"), new Order(3, 120m, "FR") };
Filter[] fromScreen = [new("Total", ">", "50"), new("Country", "=", "GB")];   // what the admin picked

Expression<Func<Order, bool>> where = Build(fromScreen);
Console.WriteLine($"built: {where}");

var matches = orders.Where(where.Compile());          // in memory: compile the tree to a delegate
Console.WriteLine("matches: " + string.Join(", ", matches.Select(o => $"#{o.Id}")));
// With EF Core you'd pass the tree itself:  db.Orders.Where(where)  → SQL with parameters

static Expression<Func<Order, bool>> Build(Filter[] rows)
{
    string[] allowed = ["Total", "Country", "Id"];                    // never let the screen reach any property
    var o = Expression.Parameter(typeof(Order), "o");
    Expression? body = null;
    foreach (var r in rows)
    {
        if (!allowed.Contains(r.Field)) throw new ArgumentException($"can't filter on {r.Field}");
        var prop = Expression.Property(o, r.Field);                                        // o.Total
        var value = Expression.Constant(Convert.ChangeType(r.Value, prop.Type, CultureInfo.InvariantCulture), prop.Type);   // 50m
        Expression test = r.Op switch
        {
            ">" => Expression.GreaterThan(prop, value),
            "<" => Expression.LessThan(prop, value),
            "=" => Expression.Equal(prop, value),
            _ => throw new NotSupportedException(r.Op),
        };
        body = body is null ? test : Expression.AndAlso(body, test);  // join rows with &&
    }
    return Expression.Lambda<Func<Order, bool>>(body ?? Expression.Constant(true), o);
}

record Order(int Id, decimal Total, string Country);
record Filter(string Field, string Op, string Value);
```

Two cautions:

- **Whitelist the fields.** Without the `allowed` list, a crafted request could filter on any property, including internal ones.
- **`.Compile()` is expensive** (milliseconds), and under Native AOT it falls back to a slower interpreter. Cache compiled delegates. For EF Core you don't compile at all, because EF reads the tree.

The same trick powers object mappers and ORMs: they build a property-reading tree once per type, compile it, cache the delegate, and from then on it runs as fast as hand-written code. That's the reflection "bill" from Act 5, paid once instead of on every call.

:::qa How would you build a dynamic, injection-safe filter for EF Core?
Build an `Expression<Func<T,bool>>` with the `System.Linq.Expressions` API (`Parameter`, `Property`, `Constant`, comparisons, `AndAlso`) from the user's choices, whitelisting which properties may be filtered, and pass it to `IQueryable.Where`. EF Core translates the tree to SQL and sends the constants as parameters, so user input never becomes SQL text. Conditionally chaining `.Where` calls on an `IQueryable` also works when the set of filters is fixed.
:::

## The end of the night {b}

| Act | Problem | Tool | What it costs you |
|---|---|---|---|
| 1 | 10 million throwaway strings | `Span<T>`, `stackalloc`, `Memory<T>` | ref struct rules: no fields, lambdas or awaits |
| 2 | 1 MB buffers on the Large Object Heap | `ArrayPool<T>` | return discipline, and arrays may be bigger than asked |
| 3 | changing copies of structs | `ref` locals and returns, `in` | readonly structs needed to avoid hidden copies |
| 4 | a C-only label printer | `fixed`, `unsafe`, `LibraryImport` | no safety net inside `unsafe`, and pinning fragments the heap |
| 5 | forgotten audit calls | attributes and reflection | slow, invisible to the compiler and the trimmer |
| 6 | 2.4 s cold starts | source generators, Native AOT | a build-time tool to learn, and less runtime flexibility |
| 7 | filter by any field, as SQL | hand-built expression trees | `Compile()` is slow, and inputs need whitelisting |

Every row is the same trade: **pay a cost once (at build time, or by writing more careful code) so you don't pay it millions of times at runtime.** And for every tool, the advice is the same: reach for it **after a profiler or a real requirement says so**, not before ([Performance engineering](ch:performance-engineering)).

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
| [10 · Advanced](ch:advanced-csharp) | one long night of costs | spans, pools, refs, interop, reflection, generators | pay once, not millions of times |

Notice how they lean on each other. Act 3's `ref` fixes Episode 1's copied structs. Act 1's span rules exist because of Episode 4's closures and Episode 8's state machine. Act 7 builds by hand the trees that Episode 6's EF Core reads. You now know the language that the rest of this book is written in.

## Next: the web {b}

Kettle's C# is solid. But so far it's been a program on its own. Customers reach it over **HTTP**, through a web server, with dependency injection wiring the services together, middleware checking every request, and configuration that's different in each environment. That's **ASP.NET Core**, and almost every page of it uses what you've just learned: delegates for middleware, interfaces for DI, generics for `ILogger<T>`, attributes for `[Authorize]`, source generators for JSON, and async everywhere. [Part III · ASP.NET Core →](ch:aspnet-hosting)

## Further reading

- [Memory and Span usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines)
- [ref keyword and ref safety](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/ref)
- [Native interoperability and P/Invoke source generation](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation)
- [Reflection in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/reflection)
- [Source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview) and [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [Expression trees: building](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/expression-trees-building)
- Stephen Toub's yearly *Performance Improvements in .NET* posts show these techniques used throughout the BCL. Book: *Pro .NET Memory Management* (Konrad Kokosa).

## Verify this chapter

```csharp
using System.Buffers;
using System.Globalization;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.InteropServices;

// Act 1: a span slice is a view, and parsing from it doesn't allocate
int[] arr = [1, 2, 3, 4];
var view = arr.AsSpan(1, 2); view[0] = 99;
Check(arr[1] == 99, "a span slice is a view over the same memory");
var line = "2026-11-27,TEA-01,6.50,GBP";
var before = GC.GetAllocatedBytesForCurrentThread();
var price = decimal.Parse(line.AsSpan(18, 4), CultureInfo.InvariantCulture);
Check(price == 6.50m && GC.GetAllocatedBytesForCurrentThread() - before < 100, "parsing from a span doesn't allocate a substring");
Span<byte> s = stackalloc byte[8]; s.Fill(7);
Check(s[7] == 7, "stackalloc memory is usable through a span");

// Act 2: ArrayPool may hand back a bigger array
var buf = ArrayPool<byte>.Shared.Rent(1000);
Check(buf.Length >= 1000, "Rent returns at least the requested size");
ArrayPool<byte>.Shared.Return(buf);

// Act 3: ref writes into the slot; a plain variable is a copy
var stock = new List<Level> { new() { Price = 10m } };
var copy = stock[0]; copy.Price = 99m;
Check(stock[0].Price == 10m, "reading a struct out of a list gives a copy");
foreach (ref var l in CollectionsMarshal.AsSpan(stock)) l.Price = 11m;
Check(stock[0].Price == 11m, "a ref over the list's storage updates in place");

// Act 5: attributes are read through reflection; a delegate can be made once
Check(typeof(Svc).GetMethod("Cancel")!.GetCustomAttribute<AuditAttribute>()?.Action == "cancel", "attributes are read through reflection");
var d = typeof(Svc).GetMethod("Double")!.CreateDelegate<Func<int, int>>(new Svc());
Check(d(21) == 42, "a MethodInfo can become a fast delegate");

// Act 7: a hand-built expression tree filters correctly
var p = Expression.Parameter(typeof(Order), "o");
var tree = Expression.Lambda<Func<Order, bool>>(
    Expression.AndAlso(Expression.GreaterThan(Expression.Property(p, "Total"), Expression.Constant(50m)),
                       Expression.Equal(Expression.Property(p, "Country"), Expression.Constant("GB"))), p);
var hits = new[] { new Order(80m, "GB"), new Order(30m, "GB"), new Order(90m, "FR") }.Where(tree.Compile()).Count();
Check(hits == 1, "a hand-built tree compiles to a working filter");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

struct Level { public decimal Price; }
sealed class AuditAttribute(string action) : Attribute { public string Action { get; } = action; }
class Svc { [Audit("cancel")] public void Cancel() { } public int Double(int x) => x * 2; }
record Order(decimal Total, string Country);
```
