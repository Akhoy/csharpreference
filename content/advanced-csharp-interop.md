---
id: advanced-csharp-interop
title: "The Label Printer Only Speaks C: unsafe, fixed and LibraryImport"
summary: "04:00: the warehouse's new printer ships with one C library and no .NET bindings. Calling it means handing over raw pointers, which means pinning memory against a GC that likes to move things. Fourth of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Interop
fits: Needs the GC-moves-objects fact from [Memory & GC](ch:memory-gc). Spans ([Act 1](ch:advanced-csharp-span)) are the safe 95% case; this chapter is what's left when a C library forces raw pointers on you.
levels: a
prereqs: advanced-csharp-ref
next: advanced-csharp-reflection
---

:::plain
.NET can call functions in C libraries. The catch is that the GC likes to move objects around, so while C code is reading your bytes you must pin them in place.
:::

## Start from zero: what a pointer is

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

## Interop in depth {a}

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
