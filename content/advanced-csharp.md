---
id: advanced-csharp
title: "Advanced C#: One Long Night at Kettle (Span, ref, Interop, Reflection, Generators)"
summary: "Episode 10, the finale, told as one long night and day at Kettle in seven acts. A 2-million-row import drowns the GC (Span, stackalloc, Memory), 1 MB buffers pile up (ArrayPool), repricing copies millions of structs (ref, in, ref safety), the warehouse printer only speaks C (unsafe, fixed, LibraryImport), compliance wants every refund audited (attributes, reflection), a serverless cold start is too slow (source generators, Native AOT), and the owner wants a report builder (expression trees built by hand). An encore adds SIMD. Each act has a plain-words summary, a from-zero primer and an in-depth section with C# 11–14 changes and interview follow-ups."
layer: language
where: C# language › Advanced & low-level features
fits: Layer 1 features with deep layer 2 roots. Span and ref structs exist because of how the runtime manages memory ([Memory & GC](ch:memory-gc)), and source generators exist because reflection fights trimming and Native AOT ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)). In layer 3, Kestrel, System.Text.Json and EF Core use every technique in this chapter.
levels: i,a
prereqs: type-system, generics, async-await
next: memory-gc, performance-engineering
---

## The 30-second version

Advanced C# is the toolbox for when the normal tools **cost too much**. Too many allocations, too many copies, a C library you have to call, or runtime work that could have been done at build time. Each act of this episode is one of those moments:

| Act | Kettle's problem | The tool | The idea in one line |
|---|---|---|---|
| 1 | The import creates 10 million throwaway strings | `Span<T>`, `stackalloc`, `Memory<T>` | look at memory, don't copy it |
| 2 | A new 1 MB buffer for every chunk | `ArrayPool<T>` | borrow buffers, give them back |
| 3 | Repricing copies 2 million structs | `ref` locals and returns, `in` | point at the slot, don't copy it out |
| 4 | The label printer only has a C library | `unsafe`, `fixed`, `LibraryImport` | pin memory while native code reads it |
| 5 | Every refund must be audited | attributes, reflection | label code, read the labels at runtime |
| 6 | The serverless cold start takes 2.4 s | source generators, Native AOT | do reflection's work at build time |
| 7 | The owner wants a "filter by anything" screen | expression trees, built by hand | build the query as data |
| Encore | The nightly totals take minutes | `Vector<T>`, SIMD | add many numbers in one instruction |

Every act has the same three layers. A **plain-words** box says the idea in two sentences. A **start from zero** section explains the computer-science underneath, assuming you've never met it. Then the act tells the Kettle story with runnable code, and finishes with an **in depth** section: the full rules, what changed in C# 11 to 14, the traps, and the follow-up questions a senior interviewer asks.

## Words you'll meet

| Word | In plain words |
|---|---|
| **allocation** | Creating an object on the heap. Each one is future work for the garbage collector. |
| **`Span<T>`** | A window onto memory you already have. No copy is made. |
| **ref struct** | A type that may only live on the stack, which is what keeps spans safe. |
| **`stackalloc`** | Grab a small buffer on the stack instead of the heap. |
| **Large Object Heap (LOH)** | Where objects of 85 KB or more go. Expensive to clean. |
| **`ArrayPool<T>`** | A shelf of reusable arrays to borrow and give back. |
| **`ref` local / return** | A variable or result that *points at* a slot instead of copying what's in it. |
| **pinning** | Telling the GC "don't move this object" while native code reads it. |
| **P/Invoke** | Calling a function in a native (C) library from .NET. |
| **metadata** | The catalogue of types and methods stored inside every compiled `.dll`. |
| **reflection** | Code reading that catalogue while the program runs. |
| **attribute** | A label on code, like `[Audit("refund")]`. Does nothing until something reads it. |
| **source generator** | A compiler plugin that writes extra C# for you during the build. |
| **Native AOT / trimming** | Compiling straight to machine code ahead of time / deleting code that looks unused. |
| **address** | The number of a byte in memory. Every piece of data sits at some address. |
| **managed pointer** (a `ref`) | An address the GC knows about, which may point into the *middle* of an object (one array slot, one field). |
| **escape** | A value "escapes" a method when something still holds it after the method returns. |
| **marshalling** | Converting data between .NET's layout and a native library's layout (strings, bools, structs). |
| **blittable** | A type whose memory layout is identical in .NET and C, so it can be passed with no conversion. |
| **DLR** | The Dynamic Language Runtime, which decides what a `dynamic` call means while the program runs. |
| **SIMD** | "Single instruction, multiple data": one CPU instruction that works on 4, 8 or 16 numbers at once. |

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

:::plain
Splitting text into pieces copies every character into new strings. A span lets you *point at* the piece you need inside the original text instead, so nothing is copied and nothing is left for the GC.
:::

### Start from zero: memory is a long row of numbered boxes

Picture the computer's memory as one very long row of boxes, each holding one byte. Every box has a number, its **address**. When your program creates the string `"6.50"`, the runtime finds a free stretch of boxes and writes four characters into them, one after another (two bytes each, because .NET stores text as UTF-16).

Now some other code needs those four characters. There are only two ways to give them to it:

1. **Copy them.** Find a new free stretch, write the same four characters again, and hand over the new stretch. This is what `Substring` and `Split` do. The copy costs time, and it's a new object the GC must find and free later.
2. **Point at them.** Hand over "start at box 1,036, read 4". Nothing is written, nothing is created. That pair, a starting address and a length, is all a span is.

The rest of this act is about option 2: how C# lets you point at memory safely, and the rules that stop a pointer from outliving the memory it points at.

Every night Kettle imports lines like `2026-11-27,TEA-01,6.50,GBP`. Here's the parsing code with an allocation counter attached. Run it:

:::walk Measure it: the obvious parser
```csharp
using System.Globalization;

var lines = Enumerable.Range(0, 20_000).Select(i => $"2026-11-27,TEA-{i:00000},{6 + i % 5}.50,GBP").ToArray();

var before = GC.GetAllocatedBytesForCurrentThread();
decimal total = 0;
foreach (var line in lines)
    total += decimal.Parse(line.Split(',')[2], CultureInfo.InvariantCulture);   // the "obvious" way
var bytes = GC.GetAllocatedBytesForCurrentThread() - before;

Console.WriteLine($"20,000 lines: £{total:N2}, {bytes / 1_048_576.0:N1} MB of garbage created");
Console.WriteLine($"2,000,000 lines would be ~{bytes * 100 / 1_000_000:N0} MB of garbage, every night");
```
@3 | lines = 20,000 lines like "2026-11-27,TEA-00000,6.50,GBP"
A scaled-down night: 20,000 lines instead of 2 million. They're already in memory, so this part doesn't count.
@5-6 | before = (bytes allocated so far) ; total = 0
Read the allocation counter.
@7-8 | line = "2026-11-27,TEA-00000,6.50,GBP" ; Split gives = new string[4] + "2026-11-27" + "TEA-00000" + "6.50" + "GBP"
For each line, `Split(',')` builds a **new array** and **four new strings**, copying every character. We use one field (the price) and throw the other four objects away.
@9 | total = 170,000.00 ; bytes = about 3,048,000
Three megabytes of objects nobody needed. That's about 150 bytes of garbage per line.
@11-12 | | > 20,000 lines: £170,000.00, 2.9 MB of garbage created | > 2,000,000 lines would be ~304 MB of garbage, every night
Scale it up to the real file and the GC has to find and free hundreds of megabytes of tiny strings, at the same time as the import is trying to run.
:::

`Split` builds a new array and four new strings for every line, copying every character, and all of it is thrown away a moment later. Two million lines means **ten million objects** for the GC to find and free.

**The lightbulb:** you don't need copies of the fields. You only need to *look at* part of a line that's already in memory. That's a **`Span<T>`**: a **window** onto memory that already exists, just "start here, this many items long". Slicing a span gives you a smaller window, **never a copy**. For text it's `ReadOnlySpan<char>`, and most parsing methods (`int.Parse`, `decimal.Parse`, `Guid.Parse`…) accept one directly.

:::scene visuals/scenes/adv-span.svg | Copying fields vs looking through a window
1. One line of the CSV is already in memory as a single string. You need four fields from it, two million times a night.
2. **`Split(',')`** creates a `string[]` and **four brand-new strings**, copying every character. That's 5 objects per line, or 10 million objects a night.
3. **`line.AsSpan(0, 10)`** is a window over the date characters, just a start and a length over the *same* memory. Nothing is copied.
4. Move the window to the price and call `decimal.Parse(window)`. It reads straight from the original text. **Zero allocations per line.**
5. A span can point at **stack** memory, which vanishes when a method returns. So the compiler never lets a span reach the heap: no fields, no lambdas, no `await`. Those rules are what make "zero-copy" safe.
:::

:::walk Measure it: the same parser with a window
```csharp
using System.Globalization;

var lines = Enumerable.Range(0, 20_000).Select(i => $"2026-11-27,TEA-{i:00000},{6 + i % 5}.50,GBP").ToArray();

var before = GC.GetAllocatedBytesForCurrentThread();
decimal total = 0;
foreach (var line in lines) total += PriceOf(line);
var bytes = GC.GetAllocatedBytesForCurrentThread() - before;
Console.WriteLine($"20,000 lines: £{total:N2}, {(bytes < 16_384 ? "almost no" : $"{bytes:N0} bytes of")} garbage created");

static decimal PriceOf(string line)
{
    ReadOnlySpan<char> rest = line;                  // a window over the whole line
    rest = rest[(rest.IndexOf(',') + 1)..];          // skip the date   (a smaller window, no copy)
    rest = rest[(rest.IndexOf(',') + 1)..];          // skip the SKU
    var price = rest[..rest.IndexOf(',')];           // just "6.50"
    return decimal.Parse(price, CultureInfo.InvariantCulture);   // parses straight from the window
}
```
@7 | line = "2026-11-27,TEA-00000,6.50,GBP"
Same lines, same total. Jump into `PriceOf`.
@13 | rest = window over "2026-11-27,TEA-00000,6.50,GBP"
A `ReadOnlySpan<char>` over the whole line. It's just "start here, this long" over the string's existing characters. No copy.
@14 | rest = window over "TEA-00000,6.50,GBP"
Slice past the first comma. Slicing a span makes a **smaller window**, never a new string.
@15 | rest = window over "6.50,GBP"
Past the second comma.
@16 | rest = window over "6.50,GBP" ; price = window over "6.50"
Up to the next comma: a window over exactly the four price characters.
@17 | price = window over "6.50" → 6.50
`decimal.Parse` accepts a span, so it reads the digits straight out of the original line.
@8 | total = 170,000.00 ; bytes = about 1,000
After all 20,000 lines: about a kilobyte, and that comes from the runtime itself, not the parsing. The parser allocated nothing; the obvious version made about 3 MB.
@9 | | > 20,000 lines: £170,000.00, almost no garbage created
Same answer, thousands of times less garbage.
:::

A span can view almost any memory: part of an array, part of a string, or memory on the **stack** that the GC never sees.

:::walk Three kinds of memory, one kind of window
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
@1 | stock = → array [12, 0, 7, 3, 9]
An ordinary array of stock counts.
@2 | stock = → array [12, 0, 7, 3, 9] ; middle = window over stock[1..4] → [0, 7, 3]
A span over part of an **array**.
@3 | stock = → array [12, 50, 7, 3, 9] ; middle = window → [50, 7, 3]
Writing through the window writes into the array, because there's only one copy of the data.
@4 | | > 50
@6 | word = window over "Sencha tea"[0..6] → "Sencha"
A span over part of a **string**. No new string exists until you ask for one.
@7 | | > Sencha
`ToString()` makes one, here, only because we want to print it.
@9 | label = 16 chars on the stack, all empty
`stackalloc` reserves 16 characters in this method's **stack frame**. The GC never sees them, and they vanish when the method returns.
@10 | label = "ORD-" + 12 empty chars
Copy "ORD-" into the start of the buffer.
@11 | label = "ORD-42" + 10 empty chars ; written = 2
`TryFormat` writes the digits of 42 straight into the rest of the buffer, with no temporary string.
@12 | | > ORD-42
Print the part that was used.
:::

:::qa What is Span<T> and why is it useful?
A stack-only struct that represents a contiguous region of memory (an array, a string, the stack or native memory) as a pointer plus a length. Slicing creates views without copying, so parsing and formatting can run with zero allocations, which reduces GC pressure in hot paths.
:::

### Why Span has strict rules: ref structs

**What's inside a span.** A `Span<T>` is a struct with just two fields: a **managed pointer** to the first element and an `int` length. A managed pointer is what C# calls a `ref`. It's different from an ordinary object reference in one important way:

| | An object reference (`Order o`) | A managed pointer (`ref`) |
|---|---|---|
| Points at | the **start** of a whole object | **any** storage location: one array slot, one field, a local variable, stack memory, native memory |
| The GC… | finds it anywhere: stack, registers, other objects' fields | finds it **only on the stack and in CPU registers** |

That second row is the key. When the GC compacts the heap and moves an array, it updates every reference to that array, and it also updates every managed pointer into the middle of it. A span over an ordinary, **unpinned** array is completely fine. The GC moves the array and fixes the span's pointer as it goes. But the GC only *looks for* managed pointers on thread stacks. The runtime was designed that way on purpose: scanning every heap object for pointers into the middle of other objects would make every collection slower.

So a span must never be stored on the heap, for three reasons:

1. **The GC couldn't track it.** Stored inside a heap object, the span's pointer would be invisible to the GC. After the next compaction it would point at whatever moved into that spot. This is the main reason.
2. **Stack memory dies with its method.** A span over `stackalloc` memory, stored somewhere that outlives the method, would point into a stack frame that's been reused for something else.
3. **Torn reads.** A span is two fields. On the heap, another thread could read it halfway through an update and see the **new pointer with the old length**. That pair could reach past the end of the buffer, and the bounds check would approve it. A value on the stack is only ever visible to one thread, so it can't tear.

A common wrong answer to "why is Span stack-only?" is "because the GC would move the memory". The GC moving memory is fine; the GC *not knowing about the pointer* is the problem.

So `Span<T>` is declared as a **`ref struct`**: a struct the compiler guarantees will never end up on the heap. Every restriction is one of the ways something could reach the heap:

| A ref struct can't… | because that would put it on the heap, via… |
|---|---|
| be a field of a class, or of an ordinary struct | the object (an ordinary struct can itself be boxed or live inside a class) |
| be a `static` field | statics live on the heap |
| be an array element | the array |
| be boxed, or converted to `object` or an interface type | the box ([Episode 1](ch:type-system#boxing-a-value-type-in-a-cardboard-box)) |
| be captured by a lambda or local function | the closure object ([Episode 4](ch:delegates-events#closures-a-lambda-packs-a-backpack)) |
| be a parameter of an `async` method or an iterator | the state machine stores parameters on the heap ([Episode 8](ch:async-await#under-the-hood-the-state-machine)) |
| be used across an `await` or `yield` | the state machine stores live locals on the heap |
| be a type argument, like `List<Span<int>>` | `List<T>` might store a `T` in an array (C# 13 has an opt-in, below) |

```csharp norun
class Cache { Span<byte> _buffer; }                 // ✗ CS8345: a ref struct can't be a field of a class
object Box(Span<int> s) => s;                       // ✗ CS0029: no conversion to object
async Task Read(Span<byte> s) { await Task.Yield(); }   // ✗ CS4012: async methods can't take ref struct parameters
```

**How the rules have changed.** Each C# version since 7.2 has loosened a rule in a way the compiler can still prove safe:

| Version | Change |
|---|---|
| C# 7.2 (2017) | `ref struct`, `Span<T>`, `ReadOnlySpan<T>` |
| C# 11 (.NET 7) | **`ref` fields**: a ref struct can hold a `ref T` field. `Span<T>` itself is now written this way, instead of relying on a runtime-only trick. Also the **`scoped`** keyword (below). |
| C# 12 (.NET 8) | **Inline arrays**, a fixed-size buffer inside a struct (below) |
| C# 13 (.NET 9) | Ref structs can **implement interfaces**. Generics can opt in with **`where T : allows ref struct`**. Ref struct **locals** are allowed in async methods and iterators, provided they aren't used across an `await` or `yield`. `params` can take a `Span<T>` or `ReadOnlySpan<T>`. |
| C# 14 (.NET 10) | **First-class spans**: arrays, `Span<T>` and `ReadOnlySpan<T>` convert to each other implicitly in more places, including extension-method receivers and generic type inference. |

Implementing an interface doesn't let you *convert* a ref struct to that interface (that would box it). It lets generic code with `allows ref struct` call the interface's methods on it directly.

:::deep Ref safety: how the compiler proves a span can't outlive its memory
For every span or `ref`, the compiler works out how far it may **escape**: only within the current method, or out to the caller. A span over `stackalloc` memory may not leave the method. A span over a parameter's memory may be returned, because the caller's memory outlives this call.

```csharp norun
static Span<char> Broken()
{
    Span<char> buffer = stackalloc char[16];
    return buffer;                          // ✗ CS8352: would hand the caller a span into a dead stack frame
}

static ReadOnlySpan<char> FirstField(ReadOnlySpan<char> line) =>
    line[..line.IndexOf(',')];              // ✓ points into the caller's memory, which is still alive
```

The **`scoped`** keyword (C# 11) narrows a parameter or local to "this method only". A `scoped Span<T>` parameter is a promise that the method won't return or store it, so callers can safely pass stack memory into methods that would otherwise be rejected. You'll mostly see it in library code. When the compiler rejects span code you believe is safe, `scoped` is usually the missing piece.
:::

### stackalloc without the crash

`stackalloc` is fast because the stack is already there: reserving space just moves a pointer. But the stack is small (about 1 MB per thread by default), and **running out of it kills the process**. A `StackOverflowException` can't be caught. Two rules keep it safe:

- **Only for small, bounded sizes.** Never `stackalloc` a size that comes from user input or a file.
- **Never inside a loop.** Stack memory isn't released until the method returns, so each iteration grows the frame.

The standard pattern switches to a pooled array when the size is too big for the stack ([Act 2](ch:advanced-csharp#act-2-01-40-the-chunks-borrow-dont-buy) explains the pool):

```csharp norun
const int StackLimit = 256;
char[]? rented = null;
Span<char> buffer = length <= StackLimit
    ? stackalloc char[StackLimit]
    : (rented = ArrayPool<char>.Shared.Rent(length));
try
{
    // ... use buffer[..length] ...
}
finally
{
    if (rented is not null) ArrayPool<char>.Shared.Return(rented);
}
```

`stackalloc` memory is zeroed first, by default. In a measured hot path, `[SkipLocalsInit]` skips that step. It needs `<AllowUnsafeBlocks>`, because you might then read leftover data from earlier calls.

### Inline arrays: a fixed-size buffer inside a struct (C# 12)

Sometimes a struct needs a small fixed buffer of its own: say, the last 8 prices for a sparkline. An array field would be a separate heap object. An **inline array** stores the elements directly inside the struct:

```csharp norun
[System.Runtime.CompilerServices.InlineArray(8)]
struct LastEightPrices
{
    private decimal _first;              // the runtime repeats this field 8 times
}

var recent = new LastEightPrices();
recent[0] = 6.50m;                       // indexable like an array
Span<decimal> view = recent;             // and converts to a span
```

The runtime lays out 8 copies of `_first` side by side, and indexing is bounds-checked. Before C# 12, this needed `unsafe fixed` buffers, which only worked for primitive types.

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

:::deep Why Memory<T> is allowed on the heap
`Memory<T>` doesn't hold a managed pointer at all. Inside, it holds an ordinary **object reference** (to an array, a string, or a `MemoryManager<T>` for native or pooled memory) plus an **index** and a **length**. Object references are exactly what the GC tracks everywhere, so `Memory<T>` can live in fields, in arrays, and in async state machines. It also can never point at stack memory, because there's no object to refer to.

The price is that `.Span` has to work out the pointer each time you call it: check which kind of object it holds, then add the index. That's cheap, but in a loop, call `.Span` **once** and reuse the span:

```csharp norun
var span = memory.Span;                              // once, outside the loop
for (int i = 0; i < span.Length; i++) total += span[i];
```
:::

:::deep Who owns a buffer? IMemoryOwner and the usage rules
Spans and `Memory<T>` only *look at* memory. Something else **owns** it and decides when it's freed or returned to a pool. When buffers are pooled, the owner is an `IMemoryOwner<T>`:

```csharp norun
using IMemoryOwner<byte> owner = MemoryPool<byte>.Shared.Rent(64 * 1024);
Memory<byte> buffer = owner.Memory;                  // may be longer than 64 KB: slice what you need
int read = await stream.ReadAsync(buffer, ct);
Process(buffer.Span[..read]);
// Dispose returns the buffer to the pool. Any Memory<byte> still held now points at memory
// someone else will rent next.
```

The .NET usage guidelines boil down to three rules:

1. A method that takes a `Memory<T>` may use it **only until it returns**, unless the documentation says it takes ownership.
2. Exactly **one** owner disposes the buffer, once.
3. After disposal, every `Memory<T>` and `Span<T>` over that buffer is invalid, even though the compiler can't stop you using it.

Breaking rule 3 is the classic pooled-buffer bug: two requests end up reading and writing the same bytes, and the corrupted data only appears under load.
:::

### Span-friendly APIs you should know

Most of the base library accepts spans now, and many of these methods are **vectorised**: they use SIMD (see the [encore](ch:advanced-csharp#encore-16-00-the-totals-in-parallel-lanes)) to check 16 or 32 characters per instruction.

| Need | Span API |
|---|---|
| Find a character, or any of several | `span.IndexOf(',')`, `span.IndexOfAny(',', ';')` |
| Search for one of many characters, repeatedly | `SearchValues.Create(",;\t")` once, then `span.IndexOfAny(values)` (.NET 8) |
| Compare | `span.SequenceEqual(other)`, `span.StartsWith("TEA-")` |
| Parse without strings | `int.TryParse(span, out var n)`, `decimal.Parse(span, …)`, `Guid.TryParse(span, …)` |
| Format without strings | `value.TryFormat(destination, out int written)`, interpolation into a span with `destination.TryWrite($"…", out written)` |
| Split without arrays | `foreach (Range r in line.AsSpan().Split(','))` (.NET 9) |
| UTF-8 text with no conversion | `"TEA-01"u8` is a `ReadOnlySpan<byte>` stored in the program itself |
| Reinterpret bytes as other types | `MemoryMarshal.Cast<byte, int>(bytes)` (expert territory: alignment and byte order are your problem) |

:::qa Why can't Span<T> be used in async methods or stored in a class field?
Span contains a managed pointer, which can point into the middle of an array, into stack memory or into native memory. The GC only finds and updates managed pointers on thread stacks, never inside heap objects, so a span stored in a field would go stale when the GC moves the array. Spans over stack memory would also outlive the stack frame, and a two-field struct on the heap could be read half-updated by another thread. Async methods and iterators store their state on the heap, so ref structs can't be their parameters or live across an `await`/`yield`. Since C# 13, ref struct locals are allowed in async methods as long as they don't cross an `await`. Use `Memory<T>` across awaits and call `.Span` in the synchronous parts.
:::

:::qa Follow-up: does a Span over an array pin the array?
No. Only `fixed`, `GCHandle.Alloc(…, Pinned)` or the Pinned Object Heap pin. A span over an ordinary array lets the GC move the array, and the GC updates the span's pointer during the move, because the span lives on the stack where the GC looks for managed pointers.
:::

:::qa Span<T> vs Memory<T>?
`Span<T>` is a ref struct: stack-only, the fastest option, and usable in synchronous code. `Memory<T>` is a regular struct that can live on the heap, be stored in fields and cross awaits. You get a Span from it with `.Span`.
:::

## Act 2 · 01:40 — The chunks: borrow, don't buy {i}

:::plain
Instead of creating a big new buffer every time you need one, borrow one from a shared pool and give it back when you're done.
:::

The import reads the file in 1 MB chunks, and every chunk allocates a fresh 1 MB array. Anything of 85 KB or more goes on the **Large Object Heap**, which is only cleaned by an expensive full GC ([Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap)). So the import keeps triggering the most expensive kind of garbage collection there is.

**The lightbulb:** the import only ever needs a few buffers *at once*, so keep a shelf of them and reuse them. That shelf is **`ArrayPool<T>.Shared`**. You **rent** an array, use it, and **return** it.

:::scene visuals/scenes/adv-pool.svg | Rent, use, return
1. **Before:** a new 1 MB array for every chunk. They pile up on the Large Object Heap until an expensive full GC clears them.
2. **`ArrayPool<byte>.Shared`** is a shelf of reusable arrays, shared by the whole app.
3. **`Rent`** borrows one for this chunk.
4. **`Return`** it in a `finally`, so it's returned even if processing throws. The next chunk rents the **same** array, so there's no new allocation.
5. Two rules. `Rent` may give you a **bigger** array than you asked for, so use only the length you requested. And after `Return`, the array **belongs to someone else**, so never touch it again.
:::

:::walk Rent, use, give back
```csharp
using System.Buffers;

var pool = ArrayPool<byte>.Shared;
byte[]? first = null;
for (int chunk = 1; chunk <= 3; chunk++)
{
    byte[] buffer = pool.Rent(100_000);              // may be bigger than requested
    try
    {
        var usable = buffer.AsSpan(0, 100_000);      // only use what you asked for
        usable.Fill((byte)chunk);
        first ??= buffer;
        Console.WriteLine($"chunk {chunk}: rented {buffer.Length:N0} bytes, same array as chunk 1? {ReferenceEquals(buffer, first)}");
    }
    finally
    {
        pool.Return(buffer);                         // give it back, even on errors
    }
}
```
@3-4 | pool = the shared shelf of arrays ; first = null
The pool is shared by the whole app.
@7 | chunk = 1 ; buffer = → array A (131,072 bytes)
Rent a buffer of at least 100,000 bytes. The pool hands out arrays in fixed sizes, so you get **131,072** (2¹⁷). That's why you must only use the part you asked for.
@10-11 | chunk = 1 ; buffer = → array A ; usable = window over A[0..100,000]
A span limits the code to the 100,000 bytes we asked for.
@12-13 | first = → array A | > chunk 1: rented 131,072 bytes, same array as chunk 1? True
@17 | chunk = 1 ; buffer = → array A (back on the shelf)
`Return` in a `finally`, so the array goes back even if processing throws. From now on, array A belongs to the pool, not to us.
@7 | chunk = 2 ; buffer = → array A (131,072 bytes)
The next chunk rents again, and gets **the same array** back.
@13 | | > chunk 2: rented 131,072 bytes, same array as chunk 1? True
@5-18 | chunk = 3 ; buffer = → array A | > chunk 3: rented 131,072 bytes, same array as chunk 1? True
Three chunks, one array. For the real import, that's thousands of 1 MB chunks and no new large arrays at all, so the expensive full GCs stop.
:::

Related tools: `ObjectPool<T>` (often used to pool `StringBuilder`s), `RecyclableMemoryStream`, `IBufferWriter<T>`, and **System.IO.Pipelines**, the pooled-buffer machinery Kestrel is built on.

### Start from zero: why reuse beats "new"

Creating an array is cheap: the runtime bumps a pointer and zeroes the memory. The expensive part comes later, when the GC has to find out the array is no longer used and reclaim it. For small, short-lived objects that's still cheap, because they die in Gen 0 ([Memory & GC](ch:memory-gc#generations-why-the-gc-doesnt-scan-everything-every-time)). For big arrays it isn't: anything of 85,000 bytes or more goes straight to the Large Object Heap, and only a full, expensive collection cleans that.

A pool turns "allocate, use, throw away" into "borrow, use, give back". The same few arrays get used again and again, so the GC has nothing new to clean up.

### ArrayPool in depth {a}

**How the shared pool is organised.** `ArrayPool<T>.Shared` keeps arrays in **buckets by size**, in powers of two (16, 32, 64 … elements). Asking for 100,000 bytes rounds up to the next bucket, 131,072, which is why the walk above got a bigger array than it asked for. To keep `Rent` and `Return` fast when many threads use the pool at once, each thread keeps a small cache of its own, backed by per-processor stores. Most calls never touch a lock. Very large requests, past the pool's upper size limit, aren't pooled: `Rent` simply allocates and `Return` drops the array.

**The mistakes, from worst to mildest:**

| Mistake | What happens |
|---|---|
| **Using an array after returning it** | Another request rents the same array and writes into it. Both requests now share one buffer and corrupt each other's data, only under load, never in a unit test. This is the worst pooling bug there is. |
| **Returning the same array twice** | Two later renters receive the same array, with the same corruption as above. |
| **Trusting `buffer.Length`** | Code that loops to `buffer.Length` processes leftover bytes from whoever used the array before. Always carry the length you asked for, or slice a span to it. |
| **Pooling sensitive data** | The next renter can read the previous contents. Use `Return(buffer, clearArray: true)` for passwords, tokens and personal data. |
| **Forgetting to return** | Not a memory leak: the GC eventually collects the array. You simply lose the reuse, so the pool allocates new arrays as if it weren't there. |

**When not to pool.** Pooling makes objects long-lived. A pooled array survives many collections and ends up in Gen 2, and the pool's own bookkeeping costs something. For small buffers used briefly, a plain `new` is often faster. Pool large buffers, and buffers on paths you've **measured** as hot.

**Other pools:**

- **`ArrayPool<T>.Create(maxArrayLength, maxArraysPerBucket)`** builds a private pool, so one component's usage pattern doesn't affect anyone else's.
- **`MemoryPool<T>`** hands out `IMemoryOwner<T>` buffers for async code, where ownership is clearer with `using`.
- **`ObjectPool<T>`** (`Microsoft.Extensions.ObjectPool`) pools whole objects. `CreateStringBuilderPool()` is the common case; the pool's policy resets each builder on return.

:::qa What is ArrayPool and when would you use it?
A pool of reusable arrays (`ArrayPool<T>.Shared`), organised in power-of-two size buckets with per-thread caches. Rent large temporary buffers instead of allocating them for every operation, which avoids Large Object Heap allocations and the full GCs that clean them up, and return them in a `finally` block. `Rent` may return a larger array than you asked for, so track the length you need.
:::

:::qa Follow-up: what can go wrong with pooled buffers?
Using an array after returning it, or returning it twice, lets two operations share one buffer and silently corrupt each other's data under load. Looping to `buffer.Length` reads stale bytes from the previous user. Sensitive data leaks to the next renter unless you return with `clearArray: true`. Forgetting to return is the mildest failure: the GC collects the array and you just lose the reuse.
:::

## Act 3 · 02:30 — Repricing: change it where it lives {a}

:::plain
Reading a struct out of an array gives you a copy, so changing it changes the copy. A `ref` variable points at the struct's actual slot instead, so a change lands in the array itself.
:::

### Start from zero: "a reference" and "a ref" are different things

C# uses the word *reference* for two unrelated ideas, and mixing them up causes most of the confusion in this act.

1. **A reference to an object.** A variable of a class type, such as `Order o`, holds the address of an object on the heap. Copying the variable copies the address, so both copies point at the same object ([Episode 1](ch:type-system#the-lightbulb-copied-or-shared)).
2. **A `ref` to a variable.** `ref int n` doesn't point at an object. It points at a **storage location**: a local variable, a field, or one slot of an array. Writing to `n` writes into that location.

The test that shows the difference is a method that replaces its parameter:

```csharp norun
void Replace(Order o)     { o = new Order(); }   // changes the method's own copy of the address; the caller sees nothing
void Replace(ref Order o) { o = new Order(); }   // changes the caller's VARIABLE: it now points at the new order
```

Passing an `Order` without `ref` already lets the method change the order's *contents*, because both addresses point at the same object. What `ref` adds is the power to change **which object** the caller's variable points at, or, for structs, to change the caller's struct in place instead of a copy ([Passing to methods](ch:type-system#passing-to-methods-you-always-pass-a-copy)).

The import finished. Now every price goes up 5%. Kettle keeps stock levels as a **struct**, `StockLevel` (it's small and there are two million of them, so a struct is the right call per [Episode 1](ch:type-system#when-should-kettle-use-a-struct)). The obvious code doesn't even compile:

```csharp norun
foreach (var s in stock) s.Price *= 1.05m;   // ✗ CS1654: s is a read-only COPY of each element
stock[0].Price *= 1.05m;                      // ✗ CS1612 on a List<T>: the indexer returns a COPY
```

You met this in Episode 1: a struct is **copied** whenever it's read out of a collection, so changing "it" changes a temporary copy. The workaround people reach for is "read, change, write back", which copies every struct out **and** back in.

**The lightbulb:** you want a variable that doesn't hold a copy of the struct but **points at the slot where the struct lives**. That's a **`ref` local**: `ref var s = ref stock[0];`. Writing `s.Price` writes straight into the array. The same idea appears in two more places. A **`ref` return** is a method handing back a slot, not a copy. An **`in` parameter** passes a read-only reference instead of copying a big struct.

:::scene visuals/scenes/adv-ref.svg | A copy, or the slot itself?
1. `var s = stock[0]` gives you a **copy**. Changing the price changes the copy, and the array still says £10.00. That's why the compiler refuses `foreach (var s …) s.Price = …`.
2. `ref var s = ref stock[0]` gives you an arrow **into slot 0**. There's no copy: `s` *is* the slot, so writing `s.Price` changes the array.
3. `foreach (ref var s in span)` walks every slot with a ref and updates each one in place. That's 2 million structs and zero copies.
4. `in` passes a **read-only reference** to a method, so a big struct isn't copied on every call. (Mark the struct `readonly`, or the compiler may copy it anyway to protect it.)
5. Why this is safe: the compiler **proves** a ref can never outlive what it points at. Returning a ref to a local variable is a compile error. This is called **ref safety**, and the `scoped` keyword lets you tighten it further.
:::

:::walk Change it where it lives
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
@3 | stock = List [TEA-01 £10.00, TEA-02 £20.00, TEA-03 £6.00]
Three `StockLevel` structs in a `List`. Because they're structs, they sit **inside** the list's internal array, one after another.
@5 | s = ref → slot 0 of the list's array
`CollectionsMarshal.AsSpan` gives a span over the list's own array, and `ref var s` makes `s` an arrow **to the slot**, not a copy of the struct.
@6 | stock = List [TEA-01 £10.50, TEA-02 £20.00, TEA-03 £6.00]
`s.Price *= 1.05m` writes straight into slot 0.
@5-6 | stock = List [TEA-01 £10.50, TEA-02 £21.00, TEA-03 £6.30]
The loop does the same for every slot. No struct was copied out or back in.
@7 | | > TEA-01 £10.50, TEA-02 £21.00, TEA-03 £6.30
@9 | shelf = [TEA-09 £4.00, TEA-10 £0]
An array with a mistake in it: TEA-10 has no price.
@16-17 | i = 1
`Find` searches the array and returns `ref items[i]`: not the struct, but **the slot it lives in**.
@10 | tea10 = ref → shelf[1]
So `tea10` is an alias for `shelf[1]`.
@11 | shelf = [TEA-09 £4.00, TEA-10 £7.50]
Setting the price through the alias changes the array.
@21 | s = read-only ref → shelf[1]
`in` passes a **read-only** reference: the method can look but not change, and the struct isn't copied.
@12 | | > TEA-10 now £7.50, valid: True
:::

:::gotcha `CollectionsMarshal.AsSpan` and resizing
`CollectionsMarshal.AsSpan(list)` gives you the `List`'s own internal array. Don't add or remove items while you hold it. A resize swaps in a new array ([Episode 5](ch:collections#inside-list-why-add-is-amortised-o-1)) and your span keeps pointing at the old one.
:::

The rest of this family is mostly for library authors: `ref readonly` returns, `scoped`, and `Unsafe`, `MemoryMarshal` and `CollectionsMarshal` for expert control over memory.

### The ref family, in full {a}

Every place `ref` can appear, and what it means there:

| Form | Meaning | Typical use |
|---|---|---|
| `ref` parameter | The method reads **and writes** the caller's variable. The caller must have assigned it first. | Swapping, updating a big struct in place |
| `out` parameter | The method **must** assign it before returning. The caller needn't assign it first. | `TryParse(text, out var value)` |
| `in` parameter | A **read-only** reference. The caller may omit `in`, and may even pass a value like `5`, for which the compiler quietly makes a temporary. | Passing large structs without copying |
| `ref readonly` parameter (C# 12) | Like `in`, but the caller is expected to pass a **variable**, and gets a warning for a temporary value. | APIs that keep the reference, where a temporary would be a bug |
| `ref` local | An alias for a storage location. Since C# 7.3 you can point it somewhere else: `r = ref other;` | Updating array slots or struct fields in place |
| `ref` return | The method returns an alias to a location, not a copy. | Lookups that let the caller update in place |
| `ref readonly` local or return | An alias you can read through but not write through | Exposing big structs without copying them or letting callers change them |
| `ref` field (C# 11) | A field holding a `ref`. Only allowed inside a `ref struct`. | `Span<T>` itself |
| `scoped` | This `ref` or span can't escape the current method. | Letting callers pass stack memory |

**Two practical tools from `CollectionsMarshal`:**

- `CollectionsMarshal.AsSpan(list)`, used above, gives a span over a `List<T>`'s own array.
- `CollectionsMarshal.GetValueRefOrAddDefault(dictionary, key, out bool existed)` gives a `ref` to a dictionary entry's value, adding a default entry if the key is missing. Counting with it needs **one** hash lookup instead of two:

```csharp
using System.Runtime.InteropServices;

var counts = new Dictionary<string, int>();
foreach (var sku in new[] { "TEA-01", "TEA-02", "TEA-01", "TEA-01" })
{
    ref int n = ref CollectionsMarshal.GetValueRefOrAddDefault(counts, sku, out _);
    n++;                                    // writes straight into the dictionary's entry
}
Console.WriteLine(string.Join(", ", counts.Select(kv => $"{kv.Key}={kv.Value}")));   // TEA-01=3, TEA-02=1
```

The usual `counts[sku] = counts.GetValueOrDefault(sku) + 1` hashes the key twice: once to read, once to write. In a hot loop over millions of rows, that's half the work saved. As with `AsSpan`, don't add or remove entries while you hold the `ref`.

### Defensive copies, proved {a}

The Q&A below describes **defensive copies**. Here's one you can watch happen. A `readonly` field holds an ordinary (mutable) struct, and a method changes it:

:::walk The change that vanishes
```csharp
var holder = new Holder();
holder.Bump();
holder.Bump();
Console.WriteLine($"readonly field after 2 bumps: {holder.Peek()}");

var local = new Counter();
local.Increment();
local.Increment();
Console.WriteLine($"plain local after 2 bumps: {local.Value}");

class Holder
{
    private readonly Counter _counter;          // a readonly field holding a MUTABLE struct
    public void Bump() => _counter.Increment(); // compiles, but runs on a hidden copy
    public int Peek() => _counter.Value;
}

struct Counter
{
    public int Value;
    public void Increment() => Value++;
}
```
@1 | holder = Holder { _counter = Counter { Value = 0 } }
`_counter` is `readonly`: the class promises it never changes after construction.
@2 | holder = Holder { _counter.Value = 0 } ; hidden copy = Counter { Value = 1 }
`Increment` might change the struct, and the compiler can't see inside it to check. To keep the `readonly` promise, it copies `_counter` to a temporary and calls `Increment` **on the copy**. The copy goes to 1 and is thrown away.
@3 | holder = Holder { _counter.Value = 0 }
Same again. The field never changes.
@4 | | > readonly field after 2 bumps: 0
Two calls, no effect, and no warning from the compiler.
@6-8 | local = Counter { Value = 2 }
A plain local isn't `readonly`, so `Increment` runs on the real struct.
@9 | | > plain local after 2 bumps: 2
:::

The same hidden copy happens when you call a struct method through an `in` parameter or a `ref readonly` local. Here it changed the **result**. In the `in` case it only costs **speed**: you passed by reference to avoid a copy, and the compiler made one anyway.

The fix is to tell the compiler which methods don't change the struct:

- **`readonly struct`**: every field is readonly, and every method is checked not to change them. The compiler never needs a defensive copy.
- **`readonly` on individual members**, such as `public readonly decimal Total() => …`, for a struct that must stay mutable elsewhere.

With either fix, the compiler can call the method straight on the original. Any method that does try to change a field becomes a compile error, so the `Counter` above would refuse to compile instead of silently losing increments.

**How big is too big for a struct?** Copying a struct copies every byte. The long-standing guideline is to keep structs under about **16 bytes**, two or so fields. Larger structs can still be the right choice (for millions of elements in an array, as here), but then pass them with `in` or `ref readonly`, and make them `readonly struct` so those references don't trigger defensive copies.

:::qa What is a defensive copy, and how do `in` and `readonly struct` relate to it?
Some struct values are promised never to change: one passed as an `in` parameter, or one stored in a `readonly` field. Now you call a method on it, say `price.Round()`. Inside that method, `this` refers to the struct, and an ordinary struct method is allowed to assign to its own fields. The compiler can't see inside the method to know whether it does. So, to keep its promise, it calls the method **on a temporary copy** instead of on the original. That's a defensive copy. Nothing breaks, but you pay for copying the whole struct on every call, which silently undoes the point of `in` ("pass by reference so we *don't* copy"). Declaring the type `readonly struct`, or marking individual methods `readonly`, tells the compiler those methods can't write to fields. The compiler checks that, so it can safely call them directly on the original, with no copy.
:::

:::qa Follow-up: if a class is already passed "by reference", what does the ref keyword add?
A class variable holds a reference, and passing it copies that reference, so the method can change the object's contents but not which object the caller's variable points at. With `ref`, the method receives the caller's variable itself, so it can make that variable point at a different object, or, for a struct, change the caller's struct in place rather than a copy.
:::

:::qa Follow-up: in vs ref readonly parameters?
Both pass a read-only reference. With `in`, the caller may leave the keyword off and may pass a value like `5`, for which the compiler creates a hidden temporary. `ref readonly` (C# 12) expects a real variable and warns when given a temporary, which matters for APIs that keep or compare the reference. Either way, use a `readonly struct` so calls through the reference don't trigger defensive copies.
:::

## Act 4 · 04:00 — The label printer only speaks C {a}

:::plain
.NET can call functions in C libraries. The catch is that the GC likes to move objects around, so while C code is reading your bytes you must pin them in place.
:::

### Start from zero: what a pointer is

A **pointer** is a variable that holds an address: "the data is at box 1,036". Three operations are all there is to it:

| C# (inside `unsafe`) | Meaning |
|---|---|
| `byte* p = &value;` | `&` takes the address of a variable |
| `byte b = *p;` | `*` reads whatever is at that address |
| `p + 1` | the address of the **next** element (one `byte` further here, four bytes further for an `int*`) |

Nothing checks a pointer. `*(p + 1000)` happily reads memory that belongs to something else, and the GC doesn't know a raw pointer exists, so it won't update one when it moves an object. That's why C# makes you write `unsafe` and turn on `<AllowUnsafeBlocks>`: inside that block, the runtime's guarantees (bounds checks, type safety, GC tracking) are your job.

C libraries speak only in pointers, so calling one means giving it addresses that stay valid for as long as it uses them.

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

:::walk Pin, point, print
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
@2 | zpl = → byte[] on the managed heap (the GC may move it)
The label is an ordinary `byte[]`. The GC is free to move it while compacting the heap.
@4 | zpl = → byte[] (PINNED) ; p = address of zpl[0]
`fixed` pins the array for the length of the block, and gives you a raw pointer to its first byte. Inside this block the GC promises not to move it.
@5 | p = address of zpl[0] ; native code = reading bytes at p
The C function receives the pointer and the length, and reads the bytes directly. It knows nothing about .NET.
@6 | zpl = → byte[] (unpinned)
The block ends and the pin is released. Keep pins this short: a pinned object is a rock the GC has to compact around.
@11-12 | -
The modern way. `[LibraryImport]` is a source generator: you declare the method with no body, and the build writes the pinning and marshalling code for you.
@15-16 | zpl = UTF-8 bytes (a span over the program's data, no allocation)
You just pass a span. The `unsafe` code exists, but only in generated, reviewed code, not in yours.
:::

Rules for this territory:

- Reach for `unsafe` only for native interop, or for a hot spot you've **measured**. Spans give you most of the speed with all of the safety.
- **Pin briefly.** Long or frequent pinning leaves holes the GC can't compact, which fragments the heap.
- Wrap native handles (files, sockets, device handles) in a **`SafeHandle`**, which releases them even if someone forgets to dispose ([Episode 7](ch:exceptions-disposal#the-full-pattern-with-a-finalizer-rarely-needed)).

### Interop in depth {a}

**Blittable vs needs-marshalling.** A type is **blittable** when its bytes look the same in .NET and in C: `int`, `long`, `double`, `byte`, pointers, and structs made only of those (with `[StructLayout(LayoutKind.Sequential)]`, the default for structs). Blittable data is passed as-is, often by pinning and passing an address. Everything else has to be **marshalled**: converted to the native layout, sometimes by copying.

| .NET type | The catch | What to do |
|---|---|---|
| `string` | .NET strings are UTF-16; most C libraries expect UTF-8 with a terminating zero | `[LibraryImport(..., StringMarshalling = StringMarshalling.Utf8)]`, or pass a `ReadOnlySpan<byte>` of UTF-8 bytes yourself |
| `bool` | C has no single `bool` size: it may be 1 byte or 4 | Say which with `[MarshalAs(UnmanagedType.U1)]` or `U4`. With `LibraryImport` you must specify it. |
| `char` | 2 bytes in .NET, 1 in C | Use `byte` for C's `char` |
| classes, arrays of non-blittable types | Need copying in and back out | Prefer blittable structs and spans at the boundary |

**Callbacks: keep the delegate alive.** Some C libraries call *you* back, such as "call this function when the print finishes". Passing a C# delegate works, but native code holds only a raw function pointer, which the GC doesn't see. If nothing in .NET still references the delegate, the GC collects it, and the next callback jumps into freed memory. The crash happens long after the call that caused it. Keep the delegate in a field for as long as native code may call it. The modern alternative avoids delegates altogether: mark a static method `[UnmanagedCallersOnly]` and pass its address as a **function pointer** (`delegate* unmanaged<int, void>`). There's no object to collect, and it works under Native AOT.

```csharp norun
[UnmanagedCallersOnly]
static void OnPrinted(int status) => Console.WriteLine($"printer says {status}");

unsafe
{
    delegate* unmanaged<int, void> callback = &OnPrinted;   // a raw address of a static method
    Native.set_print_callback(callback);
}
```

**Who frees what.** Memory has to be freed by whoever allocated it, with the matching function. If the C library hands you a buffer, call *its* free function, never a .NET one. For your own unmanaged buffers, `NativeMemory.Alloc` and `NativeMemory.Free` (.NET 6) are the modern calls. For handles such as files, devices and sockets, derive from `SafeHandle`: it releases the handle exactly once, even if an exception or a forgotten `Dispose` gets in the way.

**Pinning for longer.** `fixed` pins only inside its block. When native code keeps a buffer for a long time, such as a device writing into it in the background, use `GCHandle.Alloc(array, GCHandleType.Pinned)` and free the handle when done, or allocate the buffer on the **Pinned Object Heap** with `GC.AllocateArray<byte>(size, pinned: true)`. That array is pinned from birth in its own area, so it never leaves an immovable rock in the middle of the normal heap.

**`DllImport` vs `LibraryImport`:**

| | `[DllImport]` (since .NET 1.0) | `[LibraryImport]` (.NET 7+) |
|---|---|---|
| Marshalling code is created | at **run time**, the first time the method is called | at **build time**, by a source generator |
| You can step into it in the debugger | no | yes, it's ordinary generated C# |
| Native AOT | partly | fully |
| Strings and `bool` | default rules that surprise people | must be stated explicitly |

:::qa What does the fixed statement do?
It pins a managed object in memory for the duration of the block, so the GC can't move it. That lets you take a stable pointer to it, for unsafe code or native interop. Long or frequent pinning fragments the heap.
:::

:::qa How do you call native code from .NET, and what is LibraryImport?
Through P/Invoke: you declare an `extern` (or `partial`) method marked with the native library and entry point, and the runtime marshals arguments across the boundary. `[LibraryImport]` (.NET 7+) is the source-generated version of the older `[DllImport]`. The marshalling and pinning code is generated at build time instead of being produced at runtime, which makes it faster, debuggable and compatible with Native AOT.
:::

:::qa Follow-up: why can passing a delegate to native code crash the process later?
Native code keeps only a raw function pointer, which the GC can't see. If no .NET object still references the delegate, the GC collects it, and the next callback jumps into freed memory, often minutes later and far from the cause. Keep the delegate referenced (for example in a field) for as long as native code may call it, or use an `[UnmanagedCallersOnly]` static method and a function pointer, which involves no collectable object.
:::

:::qa Follow-up: what does blittable mean?
A type whose memory layout is identical in managed and native code, such as `int`, `double`, pointers and sequential structs of them. Blittable values cross the boundary with no conversion, often by pinning and passing an address. Strings, `bool`, `char` and classes aren't blittable and must be marshalled, which costs conversions or copies.
:::

## Act 5 · 09:00 — The audit nobody can forget {i}

:::plain
Put a label on the methods that need auditing, and have one piece of code read those labels at runtime and do the logging. Nobody has to remember anything, but reading labels at runtime has a cost.
:::

### Start from zero: every .dll carries a catalogue of itself

When the compiler builds `Kettle.dll`, it writes two things: the IL (the instructions) and **metadata**, a set of tables listing every type, every method with its parameters, every property, and every attribute. The runtime needs that catalogue to load and JIT your code. Reflection simply lets *your* code read it too.

Reflection's view of the catalogue is a small family of classes:

| You want | You get | For example |
|---|---|---|
| a type | `Type` | `typeof(Order)`, or `order.GetType()` |
| its methods | `MethodInfo` | `type.GetMethod("Refund")` |
| its properties and fields | `PropertyInfo`, `FieldInfo` | `type.GetProperty("Total")` |
| its constructors | `ConstructorInfo` | `type.GetConstructors()` |
| a method's parameters | `ParameterInfo` | `method.GetParameters()` |
| the labels on any of these | attribute objects | `method.GetCustomAttribute<AuditAttribute>()` |

`typeof(Order)` is decided at **compile** time. `x.GetType()` asks the object what it **really** is at run time. They differ whenever the variable's type is broader than the object's:

```csharp
object thing = "Sencha";
Console.WriteLine(typeof(object).Name);    // Object: the declared type
Console.WriteLine(thing.GetType().Name);   // String: what's actually there
```

Morning. Finance has a new rule: every **refund** and every **cancellation** must be logged with who did it and when. The first version adds `audit.Log(...)` inside each admin method. Within a week someone adds `IssueStoreCredit` and forgets the line, and the auditors find the gap.

**The lightbulb:** don't rely on every method remembering. **Label** the methods that need auditing, and enforce the rule in **one place** that reads the labels. In C#, a label on code is an **attribute** (`[Audit("refund.issue")]`). Code that reads labels, types and methods *while the program runs* is called **reflection**. It works because every compiled assembly carries **metadata**, a full catalogue of its types, methods and attributes ([How code runs](ch:how-code-runs#what-build-time-actually-hands-you)).

:::scene visuals/scenes/adv-reflection.svg | Label the code, read the labels
1. Every compiled assembly carries **metadata**: a catalogue of every type, method and attribute, shipped inside the `.dll`.
2. You add `[Audit("refund")]` and `[Audit("cancel")]` labels. An attribute is just an entry in that catalogue. **On its own it does nothing at all.**
3. At startup, **reflection** reads the catalogue: `GetTypes()`, then `GetMethods()`, then `GetCustomAttribute<Audit>()`. It finds two labelled methods.
4. The one central dispatcher logs every call to a labelled method automatically. Label once, enforce in one place, and nobody can forget. `[Authorize]` and `[HttpGet]` work the same way.
5. The bill: calling a method by reflection is about **50× slower** than calling it directly. A rename breaks at runtime instead of at compile time. And the trimmer and Native AOT can't see what you look up by name. That bill comes due in Act 6.
:::

:::walk Label the code, read the labels
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
@29-34 | -
Two methods carry an `[Audit]` label, and `Get` doesn't. The label does nothing by itself: it's just an entry in the assembly's metadata.
@4 | methodName = "Refund" ; args = [42, 12.50]
Ask the dispatcher to call `Refund`, by name.
@17 | m = MethodInfo for OrderAdmin.Refund
Reflection looks the method up **by its name**, as a string, in the type's metadata.
@18-19 | m = MethodInfo for Refund ; audit = AuditAttribute { Action = refund.issue } | > [audit] refund.issue by ada@kettle
Read the label. It's there, so log it. This is the **one place** the rule is enforced.
@20 | | >   refunded £12.50 on order 42
Call the method, also by name, with the arguments packed in an `object[]`.
@5 | | > [audit] order.cancel by ada@kettle | >   cancelled order 43
`Cancel` has a label too.
@6 | | >   order 44: 2 × Sencha
`Get` has no label, so it isn't audited. Add a new `[Audit]` method next month and it's covered automatically, with nobody having to remember.
@8-12 | type = OrderAdmin ; m = each public method | > | > Every audited action in the app (for the admin page): | >   OrderAdmin.Refund → refund.issue | >   OrderAdmin.Cancel → order.cancel
Reflection can also **list** everything: every type in the assembly, every method, every label. That's how ASP.NET Core finds your controllers and test runners find your tests.
:::

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

:::walk Measure it: the price of calling by name
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
@4-7 | refund = MethodInfo for Refund ; callArgs = [5]
Look the method up once, and box the argument into an `object[]`.
@9-10 | i = 0 … 199,999
Call it 200,000 times through `MethodInfo.Invoke`. Each call checks the arguments, unpacks the array and boxes the result.
@11 | | > MethodInfo.Invoke:   … ms
@13 | fast = Func<decimal, decimal> → OrderAdmin.Refund
Reflect **once**, then turn the `MethodInfo` into an ordinary typed delegate.
@14-16 | | > cached delegate:     … ms
Much faster, because each call is now a normal delegate call with no checks and no boxing.
@18-20 | | > direct call:         … ms
The plain call is the baseline. The exact milliseconds depend on your machine; in your browser, `Invoke` is typically 10 to 30 times slower than the direct call. That's why frameworks cache reflection, or skip it with generators (next act).
:::

- **It's slow and allocates.** There are string lookups, and arguments are boxed into an `object[]`. Cache the `MethodInfo`, or turn it into a delegate once, as above.
- **The compiler can't see it.** Rename `Refund` and `GetMethod("Refund")` still compiles, then returns `null` at runtime.
- **The trimmer can't see it.** Publishing with trimming or Native AOT may remove members you only mention by name. That's Act 6.

### Reflection in depth {a}

**`BindingFlags`: why `GetMethod` returns null.** By default, `GetMethods()` and friends return only **public** members. Private members, or statics only, need explicit flags: `type.GetMethod("Recalculate", BindingFlags.NonPublic | BindingFlags.Instance)`. Once you pass any flags, you must include `Instance` or `Static` too, or nothing matches.

**Generic types at run time.** `typeof(List<>)` is the *open* generic type, with the blank still empty. `typeof(List<>).MakeGenericType(typeof(Order))` fills the blank and gives `List<Order>`. DI containers use this to turn a registration of `IRepository<>` into `IRepository<Order>` when asked.

**Attribute rules.**
- `[AttributeUsage]` says where an attribute may go (methods, classes…), whether it may appear twice (`AllowMultiple`), and whether subclasses inherit it (`Inherited`).
- Attribute arguments must be **compile-time constants**: numbers, strings, enums, `typeof(…)` and arrays of those. The values are written into the metadata tables, so they must be known at build time. You can't pass `DateTime.Now` or a `new` object.
- C# 11 added **generic attributes**: `[Validator<OrderValidator>]` instead of `[Validator(typeof(OrderValidator))]`, with the type checked by the compiler.

**Creating objects by type.** `Activator.CreateInstance(type)` works but is slow on every call. Frameworks create objects millions of times, so they build a factory **once**, usually a compiled expression tree ([Act 7](ch:advanced-csharp#act-7-14-00-the-report-builder-build-the-query-as-data)), and cache it per type. That's what `ActivatorUtilities` in the DI library does.

**`dynamic`: switching off the compiler's checks.** A variable typed `dynamic` compiles any member access you write. The decision is made at run time by the **Dynamic Language Runtime (DLR)**, which uses reflection the first time and caches the result for each call site.

```csharp norun
dynamic doc = GetComObject();    // say, an Excel workbook through COM
doc.Sheets[1].Name = "Prices";   // no compile-time checking at all; a typo throws RuntimeBinderException
```

It earns its place for COM automation (Office), talking to dynamic languages such as Python, and `ExpandoObject`. In ordinary code, generics, interfaces, pattern matching and `JsonNode` do the same jobs with compile-time checking, and `dynamic` doesn't work with trimming or Native AOT.

**Making reflection safe for trimming.** If code genuinely must reflect, annotations tell the trimmer what to keep:

- `[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicProperties)]` on a `Type` parameter means "keep the public properties of whatever type is passed here".
- `[RequiresUnreferencedCode("…")]` and `[RequiresDynamicCode("…")]` mark a method as unsafe for trimming or AOT. The warning then appears at every **caller**, so the problem stays visible all the way up.

**`[UnsafeAccessor]` (.NET 8): private access without reflection.** Serializers and test helpers sometimes need a private field. Reflection works but is slow and invisible to the trimmer. `UnsafeAccessor` declares a method with no body, and the runtime wires it straight to the private member:

```csharp norun
[UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_balance")]
static extern ref decimal BalanceOf(GiftCard card);

BalanceOf(card) = 25m;          // as fast as a direct field access, and fine under Native AOT
```

**Generating code at run time.** `System.Reflection.Emit` and `DynamicMethod` write IL while the program runs. That's how older serializers and mocking libraries (Castle DynamicProxy, used by Moq) build proxy classes. It's fast once built, but it's not available under Native AOT, which is one more reason the ecosystem is moving to source generators.

:::qa What is reflection and what are its downsides?
Runtime inspection and invocation of types and members through metadata. It powers DI, serializers, ORMs and test runners, but it's slow, it allocates, it bypasses compile-time checking, and it isn't compatible with trimming or Native AOT unless annotated. Cache reflection results, compile delegates, or use source generators instead.
:::

:::qa What are attributes and who reads them?
Declarative metadata attached to code elements. They're passive, and they're read by the compiler (`Obsolete`, the nullable attributes), the runtime (`StructLayout`), frameworks through reflection or endpoint metadata (`HttpGet`, `Authorize`, `Required`), or source generators (`LoggerMessage`, `JsonSerializable`).
:::

:::qa Follow-up: typeof(T) vs GetType()?
`typeof` is resolved at compile time and gives the type you name. `GetType()` is a run-time call on an object and returns its actual type, which may be a subclass of the variable's declared type. `GetType()` on a null reference throws, and on a boxed nullable value it returns the underlying type, never `Nullable<T>`.
:::

:::qa Follow-up: what is dynamic, and when is it justified?
A static type that turns off compile-time member checking: each operation is resolved at run time by the Dynamic Language Runtime, which caches the result per call site. It's justified for COM automation, dynamic-language interop and genuinely shapeless data. Elsewhere it trades compile-time errors for run-time `RuntimeBinderException`s, costs a slow first call, and isn't compatible with trimming or Native AOT.
:::

:::qa Follow-up: how do you make reflection-based code safe to trim?
Annotate it so the trimmer knows what to keep: `[DynamicallyAccessedMembers]` on `Type` parameters and fields, and `[RequiresUnreferencedCode]` or `[RequiresDynamicCode]` on APIs that can't be made safe, so their callers get warnings. Better still, replace the reflection with a source generator, or with `[UnsafeAccessor]` for private member access.
:::

## Act 6 · 11:00 — The cold start: do the work at build time {a}

:::plain
Everything reflection discovers at startup was already known when you compiled. A source generator does that discovery once, during the build, and writes ordinary C# code, so the app has nothing left to figure out when it starts.
:::

### Start from zero: what the compiler does with your code

The C# compiler, Roslyn, works in stages:

1. **Parse.** Turn the text of each `.cs` file into a **syntax tree**: classes containing methods containing statements, exactly as written.
2. **Bind.** Work out what every name means: which `Order` this is, which overload of `Parse` is called, what type each expression has. The result is the **semantic model**.
3. **Emit.** Write IL and metadata into the `.dll`.

A source generator runs between stages 2 and 3. It can read every syntax tree and ask the semantic model questions ("which methods carry `[Audit]`?"), and it can **add new source files** to the compilation. Then compilation carries on as if you'd written those files yourself.

Generators can only **add** code. They can't edit or delete yours. That's why generator-friendly APIs use `partial`: you write the declaration, and the generator writes the other half in its own file.

Kettle moves its price-check API to a serverless function, which starts a fresh process whenever traffic rises. Each **cold start takes 2.4 seconds**. A trace shows why: at startup the JSON serializer reflects over every DTO, the audit dispatcher from Act 5 scans every type, and regexes are parsed and compiled. Then the team tries **Native AOT** to start faster: compiling straight to machine code before the app runs ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)). The build prints warnings like *IL2026: … uses reflection and may break when trimmed*.

**The lightbulb:** everything reflection discovers at startup was **already known when you compiled**. The DTOs, the `[Audit]` labels and the regex patterns are all right there in your source. So discover them **once, during the build**, and write the results out as ordinary code. A plugin for the C# compiler that reads your code and **adds new C# files** to the build is a **source generator**.

:::scene visuals/scenes/adv-generators.svg | Discover at runtime, or write it at build time?
1. **Reflection** happens at run time. On every start, the app asks "what properties does `OrderDto` have?", reads metadata, looks names up as strings and boxes values.
2. Rename a property and it still compiles, then **breaks at runtime**, because the lookup was a string.
3. **Native AOT and trimming** can't see string lookups, so code that's needed gets removed and the app fails.
4. A **source generator** runs inside the compiler. It reads your code and **writes plain C#** (for example `OrderDtoJson.g.cs`), compiled in with yours.
5. At run time there's **nothing left to discover**: fast startup, no boxing, errors at build time, and the trimmer sees everything, so Native AOT works.
:::

Generated code is less magic than it sounds. It's the boring code you'd write yourself if you had the patience. Here's what an `[Audit]` generator would emit in place of Act 5's reflection, and it runs with no reflection at all:

:::walk What a generator would write for you
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
@20-24 | -
Your code is unchanged: the same labelled methods.
@8-14 | -
This class is what an `[Audit]` source generator would write **at build time**, after reading the labels. It's plain C#: a wrapper for each labelled method, and the list of actions as an array.
@2 | orderId = 42 ; amount = 12.50
Call the generated wrapper.
@11 | | > [audit] refund.issue by ada@kettle | > refunded £12.50 on order 42
It logs, then calls `Refund` **directly**. There's no lookup by name, no `object[]` and no boxing.
@3 | | > [audit] order.cancel by ada@kettle | > cancelled order 43
@4 | | > audited actions: refund.issue, order.cancel
The list of audited actions was worked out at build time, so at startup there's nothing to discover. And if someone renames `Refund`, line 11 stops compiling, so the build tells you.
:::

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

### Generators in depth {a}

**Writing one.** A generator is a separate project, targeting `netstandard2.0` and referencing `Microsoft.CodeAnalysis.CSharp`. Your app references it as an **analyzer**, not as a normal library. Modern generators implement `IIncrementalGenerator`, which describes a pipeline of steps:

```csharp norun
[Generator]
public sealed class AuditGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        // Step 1: find every method carrying [Audit], and pull out just the facts we need
        var audited = context.SyntaxProvider.ForAttributeWithMetadataName(
            "Kettle.AuditAttribute",
            predicate: static (node, _) => node is MethodDeclarationSyntax,
            transform: static (ctx, _) => new AuditedMethod(
                ctx.TargetSymbol.ContainingType.Name,
                ctx.TargetSymbol.Name,
                (string)ctx.Attributes[0].ConstructorArguments[0].Value!));

        // Step 2: gather them and write one file
        context.RegisterSourceOutput(audited.Collect(),
            static (output, methods) => output.AddSource("Audit.g.cs", Render(methods)));
    }
}

// The model: plain strings in a record, so two runs over unchanged code produce EQUAL models
public sealed record AuditedMethod(string Type, string Method, string Action);
```

```xml
<!-- In Kettle.Api.csproj -->
<ProjectReference Include="..\Kettle.Generators\Kettle.Generators.csproj"
                  OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
```

**Why "incremental" matters.** The IDE re-runs generators on every keystroke. An incremental pipeline caches the result of each step and only re-runs a step when its input **compares unequal** to last time. So your model types must have **value equality**, which is why they're records full of strings. The classic mistake is putting a Roslyn `ISymbol` or `SyntaxNode` into the model. Those never compare equal between runs, so every step re-runs on every keystroke and the IDE crawls. They also keep the whole previous compilation alive in memory. Extract strings and numbers in the `transform` step and keep nothing else.

**Seeing the output.** Add `<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>` to write generated files to `obj/`, or open *Dependencies › Analyzers* in Visual Studio or Rider. You can step into generated code in the debugger.

**Analyzers: the same machinery, for warnings.** Instead of adding code, an **analyzer** reports diagnostics, and a **code fix** offers to repair them. Kettle could ship an analyzer that warns "public method on `OrderAdmin` changes money but has no `[Audit]`", turning the auditors' rule into a red squiggle.

**Interceptors.** A generator can also say "at this exact call site in the user's code, call my generated method instead". ASP.NET Core uses this for minimal APIs and configuration binding: your `app.MapGet(…)` calls are rerouted to generated, reflection-free code, which is how those features work under Native AOT. It's a powerful, specialised compiler feature aimed at framework authors. Treat it as advanced, and check its status for your SDK version before using it in your own generators.

**Partial members, so generators have somewhere to write.** Partial methods have existed for years. C# 13 added **partial properties and indexers**, and C# 14 added **partial constructors and events**. That's what lets a generator implement a property you declared:

```csharp norun
public partial class ProductViewModel
{
    [ObservableProperty]                      // e.g. the MVVM Toolkit's generator
    public partial string Name { get; set; }  // you declare it; the generator writes the body that raises change events
}
```

**Native AOT: what you gain, what you give up.** AOT compiles the whole app to machine code at publish time.

| You gain | You give up |
|---|---|
| Start-up in tens of milliseconds, with no JIT warm-up | **Dynamic PGO**: the JIT can't re-optimise hot code using live data, so a long-running service may reach a lower **peak** throughput than JIT |
| Lower memory use and a smaller deployment | Run-time code generation: `Reflection.Emit`, `dynamic`, loading plugin assemblies |
| One self-contained file, no runtime install | Reflection the trimmer can't see, and libraries that rely on it |
| | `Expression.Compile()` falls back to a slower interpreter |
| | One build per operating system and processor |

So AOT is a clear win for serverless functions, CLI tools and fast-scaling containers. For a busy API that runs for days, the JIT's peak speed can matter more than start-up time. Measure both before you decide. Set `<IsAotCompatible>true</IsAotCompatible>` on libraries, and treat the trimming and AOT warnings (`IL2xxx`, `IL3xxx`) as errors.

:::qa What is a source generator and why are they replacing reflection?
A compiler plugin that analyses your code during the build and adds generated C# source. It moves work from runtime to compile time, which gives faster startup, fewer allocations and compile-time errors. The generated code is visible to the trimmer, so it enables Native AOT. Examples: `LoggerMessage`, System.Text.Json source generation, `GeneratedRegex`.
:::

:::qa Follow-up: what's the most common performance mistake in an incremental generator?
Putting Roslyn objects such as `ISymbol` or `SyntaxNode` into the pipeline's model. Incremental generators skip work when a step's output equals last run's, and those objects never compare equal, so every step re-runs on every keystroke. They also keep old compilations alive in memory. Extract plain values into records with value equality in the transform step.
:::

:::qa Follow-up: would you use Native AOT for a high-traffic web API?
It depends on what you're optimising. AOT gives fast start-up, lower memory and smaller images, which matter for serverless and fast scale-out. But it gives up dynamic PGO, so a long-running service may reach lower peak throughput than with the JIT, and it rules out run-time code generation and unannotated reflection. I'd benchmark both with production-like load and decide on whichever metric matters for that service.
:::

## Act 7 · 14:00 — The report builder: build the query as data {a}

:::plain
When the filters are chosen at runtime, build the query the same way the compiler builds a lambda, as a tree of small pieces. EF Core can still turn that tree into safe SQL.
:::

### Start from zero: the same lambda, compiled two ways

Write `o => o.Total > 50` and the compiler can turn it into one of two completely different things, depending on the type you assign it to:

| Assigned to | The compiler produces | What you can do with it |
|---|---|---|
| `Func<Order, bool>` | **IL code**, a normal method | Call it. You can't look inside. |
| `Expression<Func<Order, bool>>` | **Code that builds a tree** of objects describing the lambda | Read it, change it, translate it to SQL, or compile it into a `Func` later |

The tree for `o => o.Total > 50` is a handful of objects: a `Lambda` with one `Parameter` (`o`), whose body is a `GreaterThan` node, with a `Property` node (`o.Total`) on the left and a `Constant` node (`50`) on the right. EF Core walks that tree and writes SQL. LINQ to Objects doesn't need one, because it just calls the delegate.

In this act you build the tree yourself, from pieces, because the pieces aren't known until the admin picks them.

Afternoon. The owner wants an admin screen to **filter orders by any field**, chosen from dropdowns. For example "Total > 50 **and** Country = GB", or "Status = Unpaid **and** Total > 200". And it must run as **SQL** in the database, not by loading every order into memory ([Episode 6](ch:linq#where-does-the-query-run-ienumerable-vs-iqueryable)).

You can't write a lambda for every combination. Gluing SQL strings together (`"WHERE " + field + " > " + value`) is a textbook **SQL injection** hole.

**The lightbulb:** in Episode 6, EF Core *read* an expression tree that the compiler built from your lambda. Nothing stops **you** from building that tree yourself, node by node, from whatever the user picked. The `System.Linq.Expressions` API is a **code factory**. `Expression.Property`, `Expression.Constant`, `Expression.GreaterThan` and `Expression.AndAlso` assemble an `Expression<Func<Order, bool>>` at runtime. It's the same tree the compiler would have built from `o => o.Total > 50 && o.Country == "GB"`.

:::scene visuals/scenes/adv-exprbuild.svg | From dropdowns to a safe SQL query
1. The admin screen produces filter **rows** at runtime: `Total > 50`, `Country = "GB"`. You can't write a lambda in advance for every combination.
2. Each row becomes a few **nodes**: a `Property` access, a `Constant` value, and a comparison such as `GreaterThan`.
3. The rows are joined with `AndAlso` into **one** `Expression<Func<Order,bool>>`, the same tree the compiler would build from a lambda.
4. Use it two ways. `.Compile()` turns it into a delegate for in-memory lists. Or pass the tree to `db.Orders.Where(...)`, and EF Core writes the SQL itself.
5. Why not just build a SQL string? `"WHERE " + userInput` is SQL injection waiting to happen. In a tree, whatever the user typed is only ever a value node. EF Core formats it into the SQL itself, by its type, so it can never become SQL syntax.
:::

:::walk Build the query from what the admin picked
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
@4-5 | orders = [#1 £80 GB, #2 £30 GB, #3 £120 FR] ; fromScreen = [Total > 50, Country = GB]
Three orders, and two filter rows that came from dropdowns at runtime.
@7
Build a filter from the rows.
@16-18 | o = parameter "o" (an Order) ; body = null
`Expression.Parameter` makes the `o` in `o => …`. `body` will hold the condition as it grows.
@21-22 | r = Total > 50 ; prop = o.Total
First row. "Total" is on the allowed list. `Expression.Property` makes the node for `o.Total`.
@23 | r = Total > 50 ; prop = o.Total ; value = 50 (a decimal constant)
The user's text "50" is converted to the property's type and becomes a **constant node**. It's data, never code, which is what keeps this safe from injection.
@24-26 | test = (o.Total > 50)
`>` picks `Expression.GreaterThan`.
@31 | body = (o.Total > 50)
It's the first row, so it becomes the whole body.
@21-28 | r = Country = GB ; test = (o.Country == "GB")
Second row: the same steps, with `Equal`.
@31 | body = ((o.Total > 50) AndAlso (o.Country == "GB"))
Join it to what's there with `AndAlso`, which is `&&`.
@33 | where = o => ((o.Total > 50) AndAlso (o.Country == "GB"))
Wrap the body and the parameter into a lambda. This is exactly the tree the compiler would build from writing that lambda by hand.
@8 | | > built: o => ((o.Total > 50) AndAlso (o.Country == "GB"))
@10-11 | matches = [#1] | > matches: #1
`Compile()` turns the tree into a delegate for in-memory filtering. Only order 1 is over £50 *and* in GB. With EF Core you'd pass the tree to `db.Orders.Where(where)` instead, and EF Core would write the SQL. How the `50` and `'GB'` appear in that SQL turns out to matter; see *Expression trees in depth* below.
:::

Two cautions:

- **Whitelist the fields.** Without the `allowed` list, a crafted request could filter on any property, including internal ones.
- **`.Compile()` is expensive** (milliseconds), and under Native AOT it falls back to a slower interpreter. Cache compiled delegates. For EF Core you don't compile at all, because EF reads the tree.

The same trick powers object mappers and ORMs. They build a property-reading tree once per type, compile it and cache the delegate. From then on it runs as fast as hand-written code. That's the reflection "bill" from Act 5, paid once instead of on every call.

### Expression trees in depth {a}

**Constants become literals, and that fills EF Core's cache.** When EF Core translates a tree, it treats two kinds of value differently:

| In the tree | Where it comes from | In the SQL |
|---|---|---|
| A `Constant` node | `Expression.Constant(50m)`, or a literal written in a lambda | inlined as a **literal**: `WHERE Total > 50.0` |
| A member access on a captured variable | a lambda that uses a local variable, e.g. `o => o.Total > minimum` | sent as a **parameter**: `WHERE Total > @minimum` |

Literals are still injection-safe, because EF formats each value by its type rather than pasting text. But every different value produces a **different SQL string**. EF Core caches a compiled query per distinct tree shape and value, and the database caches an execution plan per distinct SQL text. A filter screen used with thousands of different values fills both caches with near-identical entries. For values that change per request, make them look like captured variables:

```csharp norun
// A tiny box. Reading .Value from it is a member access, which EF Core turns into a parameter
sealed record Box<T>(T Value);

static Expression AsParameter<T>(T value) =>
    Expression.Property(Expression.Constant(new Box<T>(value)), nameof(Box<T>.Value));
```

Use constants only for values that really are fixed, such as an enum value the code always filters on.

**Combining two trees needs a visitor.** Suppose you have `isPaid = o => o.Paid` and `isBig = o => o.Total > 100`, and want both. The two lambdas each have their **own** `o` parameter object. Gluing their bodies with `AndAlso` produces a tree that mentions two different `o`s, and most providers reject it. An **`ExpressionVisitor`** walks a tree and rebuilds it with changes. Here, it swaps one lambda's parameter for the other's:

```csharp
using System.Linq.Expressions;

Expression<Func<Order, bool>> isPaid = o => o.Paid;
Expression<Func<Order, bool>> isBig = x => x.Total > 100;
var both = And(isPaid, isBig);
Console.WriteLine(both);   // o => (o.Paid AndAlso (o.Total > 100))

var orders = new[] { new Order(true, 150), new Order(true, 20), new Order(false, 300) };
Console.WriteLine(orders.Count(both.Compile()));   // 1

static Expression<Func<T, bool>> And<T>(Expression<Func<T, bool>> a, Expression<Func<T, bool>> b)
{
    var p = a.Parameters[0];
    var bBody = new SwapParameter(b.Parameters[0], p).Visit(b.Body);   // b's body, rewritten to use a's parameter
    return Expression.Lambda<Func<T, bool>>(Expression.AndAlso(a.Body, bBody), p);
}

sealed class SwapParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
{
    protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : node;
}

record Order(bool Paid, decimal Total);
```

The same pattern, a visitor that rewrites one kind of node, is how EF Core itself works internally: dozens of visitors, each translating or simplifying one part of the tree.

**What a lambda can't contain.** The compiler only converts **expression** lambdas into trees, and only a subset of C#. Lambdas with statement bodies, assignments, `?.`, throw expressions and some newer syntax won't convert, and you get a compile error such as CS8072 for `?.`. The `Expression` API itself is broader (`Expression.Block`, `Expression.Loop`, assignments), so hand-built trees can do more than lambdas can. LINQ providers like EF Core only translate the query-shaped subset, though.

**Compiling, and caching what you compile.** `Compile()` generates IL, which takes a noticeable fraction of a millisecond. Cache the delegate per shape, never per call. Under Native AOT there's no run-time code generation, so `Compile()` returns an **interpreter** over the tree instead. It's correct, but much slower.

:::qa Follow-up: why might a dynamic filter built from Expression.Constant hurt performance in EF Core?
EF Core inlines `ConstantExpression` values as SQL literals, so every distinct value produces distinct SQL. That defeats both EF Core's compiled-query cache and the database's plan cache, which fill with near-identical entries. Values that vary per request should appear as member accesses on a closure-like object, so EF Core sends them as parameters and reuses one plan.
:::

:::qa Follow-up: how do you combine two predicate expressions?
Take the first lambda's parameter, rewrite the second lambda's body so it uses that parameter (with an `ExpressionVisitor` that replaces `ParameterExpression` nodes), then join the bodies with `Expression.AndAlso` or `OrElse` and wrap them in a new lambda. Wrapping the second lambda in `Expression.Invoke` works in memory but produces a tree many LINQ providers can't translate.
:::

:::qa How would you build a dynamic, injection-safe filter for EF Core?
Build an `Expression<Func<T,bool>>` with the `System.Linq.Expressions` API (`Parameter`, `Property`, `Constant`, comparisons, `AndAlso`) from the user's choices, whitelisting which properties may be filtered, and pass it to `IQueryable.Where`. EF Core translates the tree to SQL and formats the values itself, so user input never becomes SQL syntax. Raw `Expression.Constant` values are inlined as SQL literals, so for values that vary per request, put them behind a member access (as a closure does) so EF sends them as parameters and reuses one cached query plan. Conditionally chaining `.Where` calls on an `IQueryable` also works when the set of filters is fixed.
:::

## Encore · 16:00 — The totals, in parallel lanes {a}

:::plain
A modern CPU can add 8 or 16 numbers with a single instruction. Most .NET methods on spans already use that for you; you only write it by hand for a measured hot loop.
:::

### Start from zero: one instruction, many numbers

An ordinary loop adds one number per step. But CPU registers have grown wide: a 256-bit register holds **eight** `int`s side by side, and one instruction can add two such registers, eight pairs at once. That's **SIMD**: *single instruction, multiple data*. Think of a checkout with eight tills that all scan at the same moment.

Kettle's end-of-day report sums the quantity column for 50 million order lines. The plain loop is fine, but it's the last slow step of the night.

### Ask the library first

Before writing SIMD yourself, check whether the base library already does it. Many span methods are vectorised (`IndexOf`, `IndexOfAny`, `SequenceEqual`, `Contains`), and so are LINQ's `Sum`, `Min` and `Max` over arrays of numbers, plus `TensorPrimitives` (in the `System.Numerics.Tensors` package) for maths over `float` and `double` spans. Calling those gets you SIMD with no extra code.

### Writing it by hand

`Vector<T>` is a value as wide as the machine's SIMD registers. `Vector<int>.Count` says how many `int`s fit: 4, 8 or 16, depending on the CPU.

```csharp
using System.Numerics;

int[] quantities = Enumerable.Range(1, 1_000).ToArray();
Console.WriteLine($"{Vector<int>.Count} ints per instruction; sum = {Sum(quantities)}");   // sum = 500500

static int Sum(ReadOnlySpan<int> values)
{
    var lanes = Vector<int>.Zero;
    int i = 0;
    for (; i <= values.Length - Vector<int>.Count; i += Vector<int>.Count)
        lanes += new Vector<int>(values[i..]);      // add Count numbers in one step
    int total = Vector.Sum(lanes);                  // add the lanes together
    for (; i < values.Length; i++)
        total += values[i];                         // the few leftovers at the end
    return total;
}
```

The shape is always the same: a wide loop over full vectors, one step to combine the lanes, and an ordinary loop for the remainder. For exact control there are fixed-width types, `Vector128<T>`, `Vector256<T>` and `Vector512<T>`, and hardware-specific intrinsics under `System.Runtime.Intrinsics`.

:::gotcha When SIMD isn't worth it
Vectorised code is harder to read and review, and it only pays off on large arrays in loops a profiler has flagged. Integer sums can also **overflow** inside a lane where the plain loop would have thrown in a `checked` context. Measure with BenchmarkDotNet ([Performance engineering](ch:performance-engineering)) before keeping it.
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
| 7 | filter by any field, as SQL | hand-built expression trees | `Compile()` is slow, inputs need whitelisting, and constants become SQL literals |
| Encore | slow end-of-day totals | `Vector<T>`, SIMD | harder code; worth it only in measured hot loops |

Every row is the same trade: **pay a cost once, so you don't pay it millions of times at runtime.** The "once" is either at build time or in writing more careful code. And the advice is the same for every tool: reach for it **after a profiler or a real requirement says so**, not before ([Performance engineering](ch:performance-engineering)).

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

Kettle's C# is solid. But so far it's been a program on its own. Customers reach it over **HTTP**, through a web server, with dependency injection wiring the services together, middleware checking every request, and configuration that's different in each environment. That's **ASP.NET Core**, and almost every page of it uses what you've just learned. Delegates for middleware, interfaces for DI, generics for `ILogger<T>`, attributes for `[Authorize]`, source generators for JSON, and async everywhere. [Part III · ASP.NET Core →](ch:aspnet-hosting)

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

// Act 3 in depth: a readonly field holding a mutable struct is changed only through a hidden copy
var holder = new Holder(); holder.Bump();
Check(holder.Peek() == 0, "calling a mutating method on a readonly struct field changes a defensive copy");
var counts = new Dictionary<string, int>();
foreach (var k in new[] { "a", "b", "a" }) CollectionsMarshal.GetValueRefOrAddDefault(counts, k, out _)++;
Check(counts["a"] == 2 && counts["b"] == 1, "GetValueRefOrAddDefault updates the entry in place");

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
object boxed = "tea";
Check(boxed.GetType() == typeof(string), "GetType returns the run-time type, not the declared one");

// Encore: Vector<T> sums match a plain loop
int[] nums = Enumerable.Range(1, 1000).ToArray();
var lanes = System.Numerics.Vector<int>.Zero; int idx = 0;
for (; idx <= nums.Length - System.Numerics.Vector<int>.Count; idx += System.Numerics.Vector<int>.Count) lanes += new System.Numerics.Vector<int>(nums.AsSpan(idx));
int vsum = System.Numerics.Vector.Sum(lanes); for (; idx < nums.Length; idx++) vsum += nums[idx];
Check(vsum == 500500, "a SIMD sum matches the ordinary sum");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

struct Level { public decimal Price; }
class Holder { private readonly Counter _c; public void Bump() => _c.Increment(); public int Peek() => _c.Value; }
struct Counter { public int Value; public void Increment() => Value++; }
sealed class AuditAttribute(string action) : Attribute { public string Action { get; } = action; }
class Svc { [Audit("cancel")] public void Cancel() { } public int Double(int x) => x * 2; }
record Order(decimal Total, string Country);
```
