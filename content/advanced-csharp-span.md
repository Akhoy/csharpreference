---
id: advanced-csharp-span
title: "Look, Don't Copy: Span<T>, stackalloc and Memory<T>"
summary: "01:00 at Kettle: a 2-million-line supplier file makes Split allocate ten million throwaway strings. Span<T> points at memory that already exists instead of copying it, stackalloc borrows a few bytes of stack, and Memory<T> is the heap-safe version for code that awaits. First of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Memory
fits: Layer 1 syntax over layer 2 memory management ([Memory & GC](ch:memory-gc)). The ref struct rules exist because of how the GC tracks pointers, and this is also why spans can't cross an `await` ([the async state machine](ch:async-internals#the-big-idea)).
levels: i
prereqs: advanced-csharp
next: advanced-csharp-pool
---

:::plain
Splitting text into pieces copies every character into new strings. A span lets you *point at* the piece you need inside the original text instead, so nothing is copied and nothing is left for the GC.
:::

## Start from zero: memory is a long row of numbered boxes

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

## Why Span has strict rules: ref structs

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
| be a parameter of an `async` method or an iterator | the state machine stores parameters on the heap ([the async state machine](ch:async-internals#the-big-idea)) |
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

## stackalloc without the crash

`stackalloc` is fast because the stack is already there: reserving space just moves a pointer. But the stack is small (about 1 MB per thread by default), and **running out of it kills the process**. A `StackOverflowException` can't be caught. Two rules keep it safe:

- **Only for small, bounded sizes.** Never `stackalloc` a size that comes from user input or a file.
- **Never inside a loop.** Stack memory isn't released until the method returns, so each iteration grows the frame.

The standard pattern switches to a pooled array when the size is too big for the stack ([Act 2](ch:advanced-csharp-pool) explains the pool):

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

## Inline arrays: a fixed-size buffer inside a struct (C# 12)

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

## Memory<T>: the version that can wait

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

## Span-friendly APIs you should know

Most of the base library accepts spans now, and many of these methods are **vectorised**: they use SIMD (see the [encore](ch:advanced-csharp-simd)) to check 16 or 32 characters per instruction.

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

## Verify this chapter

```csharp
using System.Globalization;

int[] arr = [1, 2, 3, 4];
var view = arr.AsSpan(1, 2); view[0] = 99;
Check(arr[1] == 99, "a span slice is a view over the same memory");
var line = "2026-11-27,TEA-01,6.50,GBP";
var before = GC.GetAllocatedBytesForCurrentThread();
var price = decimal.Parse(line.AsSpan(18, 4), CultureInfo.InvariantCulture);
Check(price == 6.50m && GC.GetAllocatedBytesForCurrentThread() - before < 100, "parsing from a span doesn't allocate a substring");
Span<byte> s = stackalloc byte[8]; s.Fill(7);
Check(s[7] == 7, "stackalloc memory is usable through a span");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
