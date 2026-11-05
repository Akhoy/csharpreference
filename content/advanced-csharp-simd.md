---
id: advanced-csharp-simd
title: "Encore: SIMD and Vector<T>"
summary: "16:00: the end-of-day report sums 50 million order lines, and it's the last slow step of the night. A modern CPU can add 8 or 16 numbers in a single instruction, and most span methods already use that for you. Eighth and last of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › SIMD
fits: The one place in this book that reaches past [spans](ch:advanced-csharp-span) into the CPU's own registers. Closes out the series started in [Act 1](ch:advanced-csharp-span): every chapter here traded code that's harder to write for work the runtime no longer has to do.
levels: a
prereqs: advanced-csharp-exprtrees
next: memory-gc, performance-engineering
---

:::plain
A modern CPU can add 8 or 16 numbers with a single instruction. Most .NET methods on spans already use that for you; you only write it by hand for a measured hot loop.
:::

## Start from zero: one instruction, many numbers

An ordinary loop adds one number per step. But CPU registers have grown wide: a 256-bit register holds **eight** `int`s side by side, and one instruction can add two such registers, eight pairs at once. That's **SIMD**: *single instruction, multiple data*. Think of a checkout with eight tills that all scan at the same moment.

Kettle's end-of-day report sums the quantity column for 50 million order lines. The plain loop is fine, but it's the last slow step of the night.

## Ask the library first

Before writing SIMD yourself, check whether the base library already does it. Many span methods are vectorised (`IndexOf`, `IndexOfAny`, `SequenceEqual`, `Contains`), and so are LINQ's `Sum`, `Min` and `Max` over arrays of numbers, plus `TensorPrimitives` (in the `System.Numerics.Tensors` package) for maths over `float` and `double` spans. Calling those gets you SIMD with no extra code.

## Writing it by hand

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

## Verify this chapter

```csharp
int[] nums = Enumerable.Range(1, 1000).ToArray();
var lanes = System.Numerics.Vector<int>.Zero; int idx = 0;
for (; idx <= nums.Length - System.Numerics.Vector<int>.Count; idx += System.Numerics.Vector<int>.Count) lanes += new System.Numerics.Vector<int>(nums.AsSpan(idx));
int vsum = System.Numerics.Vector.Sum(lanes); for (; idx < nums.Length; idx++) vsum += nums[idx];
Check(vsum == 500500, "a SIMD sum matches the ordinary sum");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
