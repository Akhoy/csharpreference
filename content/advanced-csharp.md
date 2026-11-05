---
id: advanced-csharp
title: "Advanced C#: One Long Night at Kettle (Span, ref, Interop, Reflection, Generators)"
summary: "Episode 10, the finale, told as one long night and day at Kettle in seven acts. A 2-million-row import drowns the GC (Span, stackalloc, Memory), 1 MB buffers pile up (ArrayPool), repricing copies millions of structs (ref, in, ref safety), the warehouse printer only speaks C (unsafe, fixed, LibraryImport), compliance wants every refund audited (attributes, reflection), a serverless cold start is too slow (source generators, Native AOT), and the owner wants a report builder (expression trees built by hand). An encore adds SIMD. Each act has a plain-words summary, a from-zero primer and an in-depth section with C# 11–14 changes and interview follow-ups."
layer: language
where: C# language › Advanced & low-level features
fits: Layer 1 features with deep layer 2 roots. Span and ref structs exist because of how the runtime manages memory ([Memory & GC](ch:memory-gc)), and source generators exist because reflection fights trimming and Native AOT ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)). In layer 3, Kestrel, System.Text.Json and EF Core use every technique in this chapter.
levels: i,a
prereqs: type-system, generics, async-await
next: advanced-csharp-span
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

:::note What you need first
- **[Types: Copied or Shared? (Value vs Reference)](ch:type-system)**: value types are copied, reference types are shared through a reference; classes, structs and records differ in exactly that.
- **[Generics: Write It Once, for Any Type](ch:generics)**: `List<T>` and friends work for any type `T` while staying type-checked, and constraints say what `T` must support.
- **[Async and Await: Don't Hold a Thread While You Wait](ch:async-await)**: `await` waits for a `Task` without blocking a thread, so one server thread can serve many requests while they wait on I/O.
:::

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

Each of those seven problems, plus an encore on SIMD, is its own chapter below, so you can jump straight to the one you need from the sidebar. [Start with Act 1 →](ch:advanced-csharp-span)
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

Kettle's C# is solid. But so far it's been a program on its own. Customers reach it over **HTTP**, through a web server, with dependency injection wiring the services together, middleware checking every request, and configuration that's different in each environment. That's **ASP.NET Core**, and almost every page of it uses what you've just learned. Delegates for middleware, interfaces for DI, generics for `ILogger<T>`, attributes for `[Authorize]`, source generators for JSON, and async everywhere. [Part III · Kettle Goes Online →](ch:aspnet-story)

## Further reading

- [Memory and Span usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines)
- [ref keyword and ref safety](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/ref)
- [Native interoperability and P/Invoke source generation](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation)
- [Reflection in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/reflection)
- [Source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview) and [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [Expression trees: building](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/expression-trees-building)
- Stephen Toub's yearly *Performance Improvements in .NET* posts show these techniques used throughout the BCL. Book: *Pro .NET Memory Management* (Konrad Kokosa).
