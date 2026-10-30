---
id: how-code-runs
title: How Your Code Runs: Compilation, IL, the CLR and the JIT
summary: What happens between saving a .cs file and the CPU executing instructions: Roslyn, IL, assemblies and metadata, the CLR's job, the JIT with tiered compilation and PGO, and the ahead-of-time alternatives.
layer: runtime
where: Runtime & platform › Execution engine (CLR)
fits: This is the bottom of layer 2, directly under the language. Everything in C# eventually becomes IL that this machinery executes. The GC ([Memory & GC](ch:memory-gc)) and the thread pool ([Threading](ch:threading-concurrency)) are other services of the same runtime.
levels: b,i,a
prereqs: what-is-dotnet
next: projects-sdk-nuget, csharp-story, memory-gc
---

## TL;DR

- Compiling happens **twice**: Roslyn turns C# into **IL** (a CPU-independent format) at build time; the **JIT** turns IL into real machine code at run time, the first time each method is actually called.
- Splitting it this way means one build runs on any CPU, lets C#/F#/VB interoperate (same IL), and lets the runtime optimise based on how your code *actually* behaves, not just a guess.
- The JIT compiles most methods **twice**: a rough **Tier 0** pass immediately, then a fully optimised **Tier 1** pass once a method proves it's called often — using **Dynamic PGO** data recorded from real usage.
- **ReadyToRun** and **Native AOT** skip some or all of this at startup, trading flexibility (reflection, dynamic code) for faster cold starts.
- "The first request is slow" has one root cause: everything on that code path is being JIT-compiled, DI/EF Core models built, and connection pools filled for the very first time.

## Let's follow one line of code, start to finish {b}

Here's the smallest program you can write:

```csharp
public static int Add(int a, int b) => a + b;
```

You've written this. You know what it does. But what actually *happens* to it between you hitting save and a CPU somewhere producing the number `5`? Let's trace it, step by step, because every term in this chapter is really just a closer look at one moment in this sequence.

1. You save the file and run `dotnet build`.
2. The C# compiler reads `Add` and writes it down — but not as machine code. It writes it in a different, in-between format. That happens **once**, right now, at build time, and never again for this particular method.
3. The result gets saved into a file called an **assembly**.
4. Time passes. Maybe seconds, maybe you deploy it and it's months. You run the app with `dotnet run`. Nothing from step 2 has been turned into something your CPU can actually execute yet — that hasn't happened. Not even once.
5. Then, the moment something finally *calls* `Add(2, 3)` — and not a moment before — the runtime translates that in-between format into real instructions for your exact CPU, runs them, and hands back `5`.

Notice something odd there: step 2 and step 5 are *both* "compiling". Same word, two completely different jobs, done by two completely different pieces of software, at two completely different times. Why would .NET deliberately do that twice instead of once? That question is the whole chapter.

## So why split it into two steps at all? {b}

Here's a fair challenge: C++ doesn't do this. It compiles straight to machine code, once, at build time, and never touches the result again. Why does .NET add this extra step?

Start with the problem that forces the split. Machine code isn't universal — it's written for one specific CPU family. Code compiled for an Intel/AMD chip (what's called x64) simply will not run on an Arm chip, the kind in a lot of phones and, increasingly, servers too. If .NET compiled your C# straight to machine code the moment you hit build, you'd need to know, right then, exactly which CPU your app would eventually run on — and build a separate version for each one you cared about.

So .NET stops one step short at build time. It compiles down to an in-between format instead of all the way to machine code, and saves the *last* translation — the CPU-specific one — for later, on whichever machine actually ends up running the code. That machine, by definition, already knows exactly what CPU it has. One build. Any CPU.

That in-between format has a name: **IL** (Intermediate Language — you'll also see it called CIL or MSIL; don't let the three names fool you, they're all the same thing). The compiler that writes it is **Roslyn**. The piece that reads IL later and turns it into real machine code is the **JIT** — short for "just-in-time" compiler, because it compiles each piece exactly when it's needed, not before. The specific JIT built into .NET even has its own name, **RyuJIT**, which you'll see mentioned in performance discussions.

Once you accept that the translation happens *later*, on the real machine, a few more nice things fall out of it almost for free — and they're worth knowing, because they come up again and again later in this book:

- **The CPU gets code tuned for itself.** Since the translation happens on the actual machine, the JIT can use whatever that specific CPU is good at — a fast modern instruction set on a beefy server, something plainer on an older box. A build-time-only compiler could never know that in advance; it wouldn't know what machine you'd eventually run on.
- **The runtime can watch your code run and keep making it faster.** This sounds almost magical the first time you hear it, but it's real, and you'll see exactly how in the Dynamic PGO section further down.
- **Different .NET languages can call each other directly, with zero friction.** C#, F# and VB all compile down to the very same IL. By the time anything is actually running, there's no language boundary left — it's just IL calling IL.

One more payoff, and it has nothing to do with CPUs at all: IL is **verifiable**, and it comes bundled with rich **metadata** — a structured description of every type and method in your code, sitting right there in the file alongside the IL itself. That one detail is what makes garbage collection, reflection and serialization possible, and it's worth slowing down for, which is exactly what the next section does.

## What build time actually hands you {b}

```text
  build time                                       run time
┌──────────┐  Roslyn   ┌──────────────────┐  CLR loads  ┌──────┐  ┌───────────────┐
│ .cs files│ ────────▶ │ assembly (.dll)  │ ──────────▶ │ JIT  │─▶│ native x64/Arm│ ─▶ CPU
└──────────┘ (csc)     │  IL + metadata   │             └──────┘  │ machine code  │
                       └──────────────────┘                       └───────────────┘
```

The file Roslyn produces — the **assembly** — is a PE file, the same container format Windows uses for a plain `.exe`. Open one up conceptually and you'll find four things packed inside it:

| Part | Contents |
|---|---|
| **Manifest** | Assembly name, version, culture, public key token, list of referenced assemblies |
| **Metadata tables** | Every type, method, field, property, attribute and its exact signature |
| **IL code** | The actual method bodies |
| **Resources** | Embedded files, localisation strings |

That metadata row deserves more than a passing glance, because it quietly explains three things you probably already take for granted. Ever wonder why .NET doesn't need separate header files the way C does? The metadata already says, precisely, what every type looks like — there's nothing left for a header file to repeat. Ever notice IntelliSense working perfectly against a compiled library you've never once seen the source code for? Same reason — the metadata is right there in the `.dll`, fully readable. And **reflection** — code that asks "what properties does this type have?" *while the program is running*, instead of knowing the answer at compile time — only works at all because that metadata exists to answer it. Without it, reflection would have nothing to inspect.

### Let's watch `Add` actually become IL

Back to our one-line method. Here's exactly what the compiler writes down for it:

```csharp
public static int Add(int a, int b) => a + b;
```

```text
.method public hidebysig static int32 Add(int32 a, int32 b) cil managed
{
  ldarg.0      // push a
  ldarg.1      // push b
  add          // pop two, push sum
  ret          // return top of stack
}
```

If that looks a little strange, here's the trick to reading it: IL doesn't use named variables sitting in CPU registers the way the final machine code eventually will. It works with a small, temporary pile of values called a **stack** — you can only ever add to the top of it, or take from the top of it. Nothing else. Let's walk through those four lines and watch exactly what's sitting on that stack at each point:

| Instruction | What it does | Stack after |
|---|---|---|
| `ldarg.0` | push argument `a` | `[a]` |
| `ldarg.1` | push argument `b` | `[a, b]` |
| `add` | pop two values, push their sum | `[a+b]` |
| `ret` | return whatever is on top of the stack | *(returns `a+b`)* |

That's genuinely the entire thing. Four instructions, each doing one small, obvious job to a pile of values. It reads almost like a recipe for a very literal-minded assistant — and that literalness is the whole point: it's simple enough that *any* CPU's JIT can turn it into real instructions, no matter how wildly different that CPU's actual registers are underneath.

Want to see this for yourself, right now, on real code? Go to **SharpLab.io**, paste in any C# snippet, and it shows you the IL *and* the JIT's final machine-code output, side by side. It's genuinely one of the best ways to understand what `async`, `foreach` and closures are secretly expanding into — each gets its own full chapter later in this book, and this trick will make those chapters click faster. **ILSpy** and **dotPeek** do the same thing for compiled `.dll` files you didn't write yourself.

### Three words that sound alike but aren't the same thing

Before moving on: there's a classic source of confusion worth clearing up here, because it'll save you grief later.

| Concept | What it is | Example |
|---|---|---|
| **Project** (`.csproj`) | Build instructions: what to compile, what to reference | `Shop.Api.csproj` |
| **Assembly** | The compiled *output* of one project — one file | `Shop.Api.dll` |
| **Namespace** | A naming scope *inside* your code, with no file-system meaning | `Shop.Api.Orders` |

These three sound like they should line up one-to-one, and they just don't. One assembly can quite happily contain many namespaces. One namespace — `System.Collections.Generic` is a good example — can be spread across several different assemblies. A namespace is purely about keeping names from colliding in your *code*; it has nothing whatsoever to say about how that code gets packaged or shipped.

## What run time actually does with all this {b}

So build time is done. You're sitting on a `.dll` full of IL and metadata that, remember, no CPU can run yet. Run time is where that finally changes.

When you start the app, the **CLR** (Common Language Runtime — the engine underneath everything .NET does while it's actually running) loads your assembly into memory. Here's the part that surprises people: it does **not** translate every method the moment it loads. It's lazier than that, on purpose. Watch:

1. Your code calls `Add(2, 3)` for the very first time.
2. The CLR checks: has this method's IL ever been translated before? No. So it hands the IL over to the JIT.
3. The JIT translates *just that one method's* IL into real x64 or Arm64 machine code, right there, for whatever CPU it happens to be running on at that moment.
4. That native code gets kept in memory for the rest of the process's life — it isn't thrown away after use.
5. Every later call to `Add` just reuses the native code from step 4. No re-translating, ever again, for this process.

So the translation cost is paid exactly **once per method**, the first time — and only the first time — it's called. Not once per call. That distinction matters a lot for everything that follows, because almost this entire chapter from here is about what happens around that one moment in step 3, plus one clever alternative that skips it entirely.

## Meanwhile, the CLR is doing a lot more than just this {b}

Loading assemblies and running the JIT is only one of the CLR's jobs — it's just the one this chapter cares about most. The whole time your process is alive, it's quietly doing several other things underneath your code, continuously:

| Service | What it means for you | Chapter |
|---|---|---|
| **Loading** | Finds and loads assemblies on demand (via `AssemblyLoadContext`) | — |
| **JIT compilation** | IL → machine code, the first time each method is called | this chapter |
| **Memory management** | Allocates objects on the managed heap; the GC frees them automatically | [Memory & GC](ch:memory-gc) |
| **Type safety** | You can't silently treat an `Order` as a `string`; casts are checked; array bounds are checked | [Type system](ch:type-system) |
| **Exception handling** | Structured exceptions that unwind cleanly across method calls | [Exceptions](ch:exceptions-disposal) |
| **Threading** | Managed threads, the thread pool, synchronisation primitives | [Threading](ch:threading-concurrency) |
| **Interop** | Calling native code (P/Invoke), COM | [Advanced C#](ch:advanced-csharp) |
| **Security** | Verification, no buffer overruns in safe code | [Web security](ch:web-security) |

Keep this table in your back pocket — it's basically a preview of the rest of Part I and II. Nearly every chapter coming up is really just one row of this table, told in full.

Here's a definition worth having precisely: code the CLR is doing all of this for is called **managed code**. Anything outside its control — a native C/C++ library, a raw OS file handle, a socket — is **unmanaged code**, and here's the catch: nothing cleans that up for you automatically. Nobody's watching it. That single fact is the entire reason `IDisposable` exists in C#: it's the language's way of flagging "this object is holding onto something the CLR genuinely cannot manage on your behalf — you, personally, have to let it go."

## Now, zoom into the JIT: why does it translate a method *twice*? {i}

You already know, from the run-time walkthrough above, that the JIT translates a method's IL the first time it's called. What that walkthrough didn't mention is this: for most methods, it actually does that translation **twice** — a quick, rough pass first, and then, sometimes, a second, much better pass later. Let's figure out why anyone would want that.

**Think about the problem first.** If the JIT fully, carefully optimised every single method the very first time it was called, your app would feel painfully slow to start up. Every method on the path from "the process launches" to "the very first response goes out" — *including* methods that might only ever run once in the app's whole lifetime — would sit there paying a heavy optimisation tax before anything could happen at all.

**Here's the fix .NET landed on, since .NET Core 3.0:** compile fast and rough the first time, and only come back and do it properly for the methods that actually prove they're worth the extra effort.

```text
first call ──▶ Tier 0: quick, unoptimised code (fast to produce)
                │  method called ≥ 30 times (and loops hit OSR)
                ▼
             Tier 1: fully optimised code (slower to produce, fast to run)
```

![How the JIT warms up a method from a quick first draft to a fully optimized rewrite](visuals/jit-tiers.svg)

### Let's trace this with real numbers, not just the diagram

Say your `PlaceOrder` method gets called, over and over, as orders come in. Here's exactly what happens, call by call:

- **Call #1:** nothing has been compiled for this method yet, anywhere. The JIT bangs out **Tier 0** code almost instantly — it's crude and unoptimised, but it's ready in microseconds. This very first call runs on that.
- **Calls #2 through #29:** still running on that same Tier 0 code. The JIT hasn't done anything more yet — it's watching, but not acting.
- **Call #30:** somewhere around here, the JIT's internal counter decides enough is enough — this method is genuinely "hot", called often enough that a better version would actually pay off. It kicks off a proper **Tier 1** recompile, *in the background*, while calls #30 onward just keep using the existing Tier 0 code. Your app never pauses for this.
- **The moment Tier 1 finishes compiling:** every call *after* that — #45, #100, #10,000, whatever comes next — gets silently switched over to the new, fully optimised version instead.

Notice what this means for a method that's only ever called twice in your app's entire life: it never earns a Tier 1 recompile at all, and that's completely fine — the cost of optimising it properly would never have paid for itself.

Here's a trickier case worth thinking through: what if a method gets stuck inside one *very* long-running loop on its very first call — before it's ever had the chance to be called a *second* time and pick up Tier 1 the normal way? It can't, because it never returns long enough to be "called again". This is exactly what **OSR (On-Stack Replacement)** is for. The JIT can swap that one *already-running* method over to its optimised Tier 1 version **mid-loop**, without waiting for it to finish first. The name makes more sense once you know why: the method's stack frame is still sitting there, mid-execution, "on the stack", at the exact moment the swap happens underneath it.

One more wrinkle, briefly: if the assembly was published with **ReadyToRun** (you'll meet this properly later in the chapter), methods don't start at Tier 0 at all — they start out already precompiled. But even then, they can still get re-jitted up to Tier 1 later if they turn out to be genuinely hot.

### Dynamic PGO: the JIT actually learns from your program's real behaviour

Tiered compilation explains *when* the JIT bothers recompiling a method. This next part explains something arguably more interesting: how that second compile can be *smarter* than a generic optimisation pass, because the JIT has been quietly watching.

Here's how, and it's on by default since **.NET 8**: while a method is running at Tier 0, the JIT adds tiny counters to it that record what actually happens, live, each time it runs — which branch of an `if` usually gets taken, which concrete class usually turns up behind an interface call. **PGO stands for Profile-Guided Optimisation** — and "profile" here means exactly what it means in "user profile": a recorded summary of real, observed behaviour, not a guess made in advance.

So when Tier 1 finally compiles, it isn't optimising blind — it's optimising *for the specific pattern this exact program has already shown it*. The clearest, most concrete payoff of this is called **guarded devirtualisation**, and it's worth slowing down for because it sounds intimidating and really isn't:

- Calling a method through an interface — something like `IRepository repo; repo.Get(id);` — normally costs a little extra: the CPU can't know in advance which concrete class's `Get` method to actually jump to, because `repo` could be any class that implements `IRepository`. Working that out at the last second, every single call, is called **virtual dispatch**. (Haven't met interfaces and virtual methods properly yet? Here's the short version: an interface lets totally different classes stand in for each other through one shared contract — great for flexibility, but it means the runtime genuinely has to re-check, every single time, which actual class it's dealing with.)
- Now suppose Dynamic PGO's counters show that, in this program, `IRepository` is *almost always*, in practice, actually `SqlRepository`. Tier 1 can then emit a fast shortcut: "quickly check — is this really a `SqlRepository`? If yes, jump straight there, no lookup needed." The slow, fully general lookup only ever runs for the rare case where it turns out to be something else.

If you're wondering whether any of this is just theoretical: it isn't. This is a genuine, measurable reason why .NET 8 and later apps got faster without a single line of application code changing. The exact same source, simply recompiled targeting .NET 8, started optimising itself around its own observed behaviour automatically.

### A quick tour of the other things the JIT does along the way

You don't need to memorise this list — just recognise the names when they come up elsewhere:

- **Inlining:** pastes a small method's body directly into wherever it's called from, removing the overhead of a separate call entirely. Simple property getters (`public int Count => _count;`) almost always get inlined this way — so don't worry that using a property instead of a raw field is "slower"; by the time Tier 1 is done, it usually isn't.
- **Bounds-check elimination:** a loop like `for (int i = 0; i < arr.Length; i++)` can safely skip the usual per-access array-bounds check, because the JIT can mathematically prove every access in that loop stays in range.
- **Devirtualisation of `sealed` classes:** the same idea as guarded devirtualisation above, except the JIT doesn't even need to guess — if a class is marked `sealed`, there is only ever one possible type, full stop, so the virtual-dispatch check can be skipped entirely rather than just made fast. This is a genuinely real reason to mark classes `sealed` when you never intended them to be base classes.
- **Constant folding, dead-code elimination, loop optimisations:** the classic compiler-textbook tricks you may already know from other languages — .NET just does them here, at JIT time, instead of purely ahead of time.
- **SIMD vectorisation**, via `Vector128/256/512<T>`: crunching several values with a single CPU instruction instead of one at a time. The BCL leans on this constantly behind the scenes — string search, LINQ's `Sum`, `Span` operations all quietly benefit from it.

### Here's what all of this actually looks like in milliseconds

Everything above explains *why* a freshly started process behaves so differently from one that's been running a while. Let's make that concrete, because "the first request is slow" is a sentence every .NET backend developer hears constantly, and now you'll actually know why instead of just repeating it:

| Request | Typical latency | Why |
|---|---|---|
| **1st request ever** | hundreds of ms | Every method on the path gets jitted at Tier 0 for the first time ever; static constructors, DI's resolution plans and EF Core's model are *also* all being built for the first time; connection pools start completely empty |
| **~30th request to the same endpoint** | starts dropping noticeably | The hottest methods on that path have now crossed the Tier 1 threshold and are being recompiled in the background |
| **Steady state** | single-digit ms | Everything on the path is running fully optimised Tier 1 code, and every pool is warmed up |

Lay it out this way and the usual list of "fixes" for slow cold starts stops being a random grab-bag you have to memorise — each one maps directly onto one row of that table. **ReadyToRun** and **Native AOT** remove row 1's Tier 0 cold compile entirely, before it can even happen. Warm-up requests (fired at a deployment slot or a readiness probe before real traffic arrives) absorb row 1's cost on a request nobody's actually waiting on. EF Core compiled models specifically remove the "building the model for the first time" piece of row 1. Nothing here is a coincidence — it's the same underlying cause, attacked from different angles.

## What if you skipped the JIT completely? {i}

Here's a thought worth having explicitly: everything described so far happens *as the app runs*, method by method, the first time each one is called. What if, instead, you translated absolutely everything, for every single method, before the app ever even starts — so that by the time it's running, there's no translation left to do, ever?

That's exactly what the next two options do, each taking it further than the last.

| Option | How | Startup | Peak perf | Restrictions |
|---|---|---|---|---|
| **JIT (default)** | — | Slowest | Best (with PGO) | None |
| **ReadyToRun (R2R)** | `<PublishReadyToRun>true</PublishReadyToRun>` | Faster | Same as JIT, once Tier 1 kicks in | Bigger binaries |
| **Native AOT** | `<PublishAot>true</PublishAot>` | Fastest (milliseconds) | Good, sometimes even below JIT+PGO | No runtime code generation, limited reflection, trimming required |

**ReadyToRun** is the gentler of the two. Methods are precompiled and shipped bundled inside the assembly itself, so there's no Tier 0 cold-start cost sitting in your way for them. But here's the thing: the JIT doesn't disappear — it's still present at runtime, quietly watching, and it can still step in and re-optimise a method up to Tier 1 later if Dynamic PGO's counters show it's genuinely hot.

**Native AOT** goes all the way and removes the JIT from the picture, full stop. The entire app — your code, *plus* whatever bits of the .NET runtime it actually needs to function — gets compiled into one single native executable at publish time. **There is no JIT at runtime. Not a reduced one. None.** Nothing is ever translated on the fly, which is exactly why startup time for a Native AOT app is measured in milliseconds rather than the hundreds you saw in the cold-start table above.

That speed isn't free, and it's worth really understanding the trade-off rather than just filing it away as a rule to follow:

- Native AOT needs **trimming** — the process of stripping out every bit of code the app can't prove it actually uses, so the final executable doesn't end up enormous.
- Here's where it bites: reflection, which you met earlier as something metadata makes possible, is precisely the kind of thing a trimmer *cannot* see coming. If nothing in your *visible* code ever calls a particular method by name, the trimmer has no way to predict that reflection might go hunting for it later at runtime — so, to keep things small, it just gets removed.
- This is exactly why AOT-friendly libraries lean so heavily on **source generators** instead of reflection: code that gets generated and made fully, explicitly visible at *compile* time (System.Text.Json's source generator, the minimal API request delegate generator, the configuration binding generator, `[LoggerMessage]`) sidesteps the whole problem — there's nothing left for the trimmer to have to guess about, because it's right there in plain sight.

So who actually wants Native AOT? It's a genuinely strong fit for serverless and scale-to-zero workloads, where that cold-start row from the earlier table *is* the entire problem you're trying to solve, plus CLI tools, small containers, and high-density hosting where every millisecond and every megabyte counts. It doesn't yet support MVC controllers or Razor, though, and EF Core support is still limited — both of those rely on patterns that clash with Native AOT's restrictions in ways that haven't been fully solved yet.

## Two more services, coming up properly in their own chapters {b}

Two more things the CLR is doing, the whole time, deserve a full chapter each rather than a rushed paragraph here — but you should at least know they exist, and that they're part of the exact same machinery this chapter has been describing:

- **The GC** (garbage collector): generational, with a "Server GC" mode on by default in ASP.NET Core, responsible for freeing memory your code no longer needs. See [Memory & GC](ch:memory-gc).
- **The thread pool**: a pool of worker threads that runs your request handlers and every `await` continuation. Blocking those threads (with `.Result` or `Thread.Sleep`) causes **thread pool starvation**, a classic production bug. See [async/await](ch:async-await) and [Threading](ch:threading-concurrency).

## The type system across languages: CTS and CLS {a}

Earlier in this chapter, you saw the claim that C#, F# and VB all compile down to the same IL, and can therefore call each other directly with zero friction. It's a nice claim, but *why* is it actually true? It's only possible because all three languages secretly agree, underneath their very different-looking syntax, on exactly what a "type" fundamentally is.

- **CTS (Common Type System):** the runtime's shared rulebook for types — classes, structs, interfaces, enums, delegates, and the value-vs-reference distinction you'll meet properly in [Type system](ch:type-system). Every .NET language maps its own type keywords onto this one shared system underneath. That's the real reason `int` in C# and `Integer` in VB turn out to be, underneath, literally the exact same thing: `System.Int32`. Not "similar" — the same.
- **CLS (Common Language Specification):** a smaller, stricter subset of rules that applies specifically to anything you expose *publicly*, chosen so that *every* .NET language — even one with narrower type support than C# has — can still consume it safely. A public `uint`, for example, actually breaks CLS compliance, because some .NET languages simply don't have unsigned integers at all. If you want the compiler to warn you whenever you've accidentally broken that promise, mark a library with `[assembly: CLSCompliant(true)]`.

## Assembly loading and versioning {a}

One last practical layer: a running .NET app isn't really just "the assembly" on its own — it's a small set of files that, together, tell the CLR exactly which assembly, and which *version* of it, to actually load.

- Assemblies are identified by name, version, culture and, optionally, a public key token from something called **strong naming**. Worth knowing, but don't over-invest here: modern .NET mostly ignores strong-name *validation* at runtime these days — it's largely a legacy identity mechanism now, not a real security boundary.
- **`AssemblyLoadContext`** is what replaced .NET Framework's old AppDomains for isolating loaded assemblies, and for loading and unloading plugins while the app is running.
- Two generated files sit right next to your published app and quietly drive all of this loading. **`.deps.json`** lists every dependency assembly your app needs, and exactly where to find each one. **`.runtimeconfig.json`** says which shared framework and version the app expects, plus runtime settings like GC mode.
- **Roll-forward** decides what happens when the *exact* version your app was built for isn't installed on the machine. By default, an app built for `8.0.x` happily runs on whatever the latest installed `8.0` *patch* release is — it rolls forward automatically to pick up fixes, no questions asked. Rolling forward across a *major* version — say, from 8 to 9 — is a different story: it's off by default, and has to be explicitly opted into with `<RollForward>Major</RollForward>`, precisely because major versions are allowed to carry breaking changes that a patch release never would.

```json
// Shop.Api.runtimeconfig.json (generated)
{
  "runtimeOptions": {
    "tfm": "net10.0",
    "framework": { "name": "Microsoft.AspNetCore.App", "version": "10.0.0" },
    "configProperties": { "System.GC.Server": true }
  }
}
```

:::qa Explain how C# code gets executed.
Roslyn compiles C# into IL plus metadata inside an assembly, at build time. At run time the CLR loads the assembly; when a method is first called, the JIT compiles its IL to native machine code — quickly at Tier 0, then re-optimised at Tier 1 if it's called often ("hot"), using Dynamic PGO data gathered while it ran. The CLR also provides GC, type safety, exceptions and threading throughout the process's life.
:::

:::qa What is IL and why does .NET use an intermediate language?
A CPU-independent, stack-based bytecode produced by the compiler instead of final machine code. It makes assemblies portable across OS/CPU (the JIT compiles it for whatever machine it actually runs on), lets multiple languages interoperate because they all compile down to the same format, enables verification and rich metadata (reflection, GC info), and lets the JIT optimise for the actual hardware and runtime behaviour rather than guessing at build time.
:::

:::qa What is tiered compilation and Dynamic PGO?
Tiered compilation JITs methods first with minimal optimisation (Tier 0) for fast startup, then recompiles frequently called ones with full optimisation (Tier 1) in the background. Dynamic PGO instruments Tier 0 code to observe what actually happens — such as which concrete type sits behind an interface call — and Tier 1 uses that recorded data to devirtualise, inline and lay out code better than a generic optimisation pass could.
:::

:::qa What is the difference between JIT, ReadyToRun and Native AOT?
JIT compiles at runtime: slowest startup, best peak performance, no restrictions. ReadyToRun ships precompiled code alongside IL for faster startup while keeping the JIT available to re-optimise hot methods later. Native AOT compiles everything to one native binary with no JIT at all: fastest startup and smallest memory, but it requires trimming unused code and avoids runtime reflection and code generation, which is why AOT-friendly libraries use source generators instead.
:::

:::qa What is managed vs unmanaged code?
Managed code runs under the CLR's control, which provides GC, type safety and exception handling automatically. Unmanaged code runs outside that control (native libraries, raw OS handles), so nothing frees its resources for you — you must release them explicitly, typically through IDisposable/SafeHandle.
:::

:::qa Why might marking a class sealed improve performance?
The JIT knows no subclass can ever override its virtual methods, so it can devirtualise calls to it (skip the indirect virtual-dispatch lookup and jump straight to the method) and inline them, and type checks (`is`/casts) become cheaper since there's only one possible type to check against.
:::

:::qa What is the difference between an assembly and a namespace?
An assembly is a compiled deployment unit — one physical .dll file. A namespace is a purely logical naming scope inside your code, with no connection to files or packaging. They're independent: one assembly can contain many namespaces, and a single namespace can span several different assemblies.
:::

## Further reading

- [Common Language Runtime overview](https://learn.microsoft.com/en-us/dotnet/standard/clr)
- [Managed execution process](https://learn.microsoft.com/en-us/dotnet/standard/managed-execution-process)
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- Book: *CLR via C#* by Jeffrey Richter, the classic deep dive (written for Framework; the concepts still apply).
- [SharpLab](https://sharplab.io): see IL and JIT output for any snippet.
- [Performance Improvements in .NET 8](https://devblogs.microsoft.com/dotnet/performance-improvements-in-net-8/) (.NET Blog) — backs the Dynamic PGO / guarded devirtualisation claims in this chapter.

## Verify this chapter

The JIT's internal tiering decisions, Dynamic PGO's counters, and exact ReadyToRun/Native AOT startup numbers aren't something a plain program can observe about itself from the inside — trust [Further reading](#further-reading) and tools like SharpLab/dotnet-trace for those. What the program below *can* check: that a method's IL really only gets translated once per process (not once per call, by timing a "cold" vs "warm" call), that `sealed` genuinely changes what the runtime can prove about a type, and that reflection really can see metadata the compiler didn't hard-code. Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
using System.Diagnostics;
using System.Reflection;

// Claim: the first call to a method pays a one-time JIT/warm-up cost; later calls are far cheaper.
var sw = Stopwatch.StartNew();
Add(2, 3);
var firstCallTicks = sw.ElapsedTicks;
sw.Restart();
for (int i = 0; i < 100_000; i++) Add(i, i);
var hundredKCallsTicks = sw.ElapsedTicks;
var avgWarmCallTicks = hundredKCallsTicks / 100_000.0;
if (avgWarmCallTicks >= firstCallTicks)
    throw new Exception("FAIL: expected warmed-up calls to be far cheaper per-call than the very first one");
Console.WriteLine($"OK: first call ≈{firstCallTicks} ticks, average of 100,000 later calls ≈{avgWarmCallTicks:F3} ticks each — later calls are far cheaper");

// Claim: a sealed class has exactly one possible runtime type, so a type check against it is exact.
if (typeof(SealedThing).IsSealed is false)
    throw new Exception("FAIL: SealedThing should report IsSealed == true");
Console.WriteLine("OK: the runtime itself reports a sealed type as sealed (nothing can subclass it)");

// Claim: metadata lets reflection discover a type's shape purely at runtime, with no compile-time reference to it.
Type discovered = Assembly.GetExecutingAssembly().GetTypes().First(t => t.Name == "SealedThing");
var prop = discovered.GetProperty("Value");
if (prop is null || prop.PropertyType != typeof(int))
    throw new Exception("FAIL: reflection should have found SealedThing.Value : int from metadata alone");
Console.WriteLine("OK: reflection discovered a property's name and type purely from assembly metadata");

static int Add(int a, int b) => a + b;

sealed class SealedThing
{
    public int Value { get; set; }
}

// Not runtime-verifiable here — see Further reading:
// - Tier 0 vs Tier 1 compilation actually happening (needs dotnet-trace / ETW events, not a stopwatch)
// - Dynamic PGO and guarded devirtualisation (observable via profilers, not plain timing)
// - ReadyToRun / Native AOT startup-time comparisons (needs `dotnet publish` with each mode)
```
