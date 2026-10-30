---
id: breadth-first
title: "The Whole Book in One Pass: A Breadth-First Reading"
summary: Every chapter of the book on one page, in order. Each idea is explained in a few sentences (what it is, how it works, why it matters), including the advanced and staff-level material, with a link to the full chapter for depth.
layer: runtime
where: Orientation › The whole book, condensed
fits: Read this when you need the whole map quickly, or the night before an interview. Every heading links to the chapter it condenses, so you can drop into depth wherever you feel shaky.
levels: b,i,a
next: big-picture, csharp-story
---

## How to use this page

:::tip Prefer pictures?
The [Kettle Storybook](story.html) covers the same ground as 59 short animated scenes, each with one-line captions. Start there for the first pass, then use this page as your written summary.
:::

This page condenses the entire book, chapter by chapter, in reading order. It's meant to be read **top to bottom**: you get every topic at a useful depth first, and only then go deep where you need to. That's the opposite of reading chapter by chapter, where you can spend a week in one corner and never see the rest.

Three promises about what's here:

- **Nothing is left out on purpose.** Every chapter's main ideas are here, including the internals, trade-offs and edge cases that staff-level interviews probe. If a chapter has a section, this page has at least a sentence on it.
- **No bare claims.** Each point says what something is, *how* it works, and *why* it matters. If a sentence says "X is safe" or "X is faster", the reason is right next to it.
- **Every heading links to its chapter.** When a point feels thin, follow the link to its full chapter. That's where the step-through diagrams, runnable code and interview questions are.

Reading time is roughly three to four hours. If you have less, read each part's opening paragraph and the bold lead-ins.

## Part 0 · Orientation

### 0 · The big picture

[Full chapter →](ch:big-picture)

- **.NET is easiest to understand as eight layers**, each built on the one below: (1) the C# language, (2) the runtime and platform, (3) application frameworks like ASP.NET Core and EF Core, (4) application architecture, (5) data and state, (6) service communication, (7) hosting and infrastructure, and (8) cross-cutting concerns (testing, security, observability, performance) that apply to all of them. When a term confuses you, ask "which layer is this?" first. `Span<T>` is layer 1–2, `IOptionsMonitor` is layer 3, a saga is layer 6, a managed identity is layer 7. Once you know the layer, you know what it depends on and what it isn't.
- **The same word means different things at different layers**, and that's the biggest source of confusion. "Service" in `AddScoped<IOrderService, OrderService>()` means "a class the DI container can build"; in "microservices" it means "a separately deployed application". "Context" can be `HttpContext` (one request), `DbContext` (one unit of work), `SynchronizationContext` (where async code resumes) or a DDD bounded context. "Scope" can be a variable's scope, a DI scope (one request) or a logging scope. "Pipeline" can be the middleware pipeline, a CI/CD pipeline or MediatR's behaviour pipeline.
- **One HTTP request touches nearly every layer**, and tracing it is the classic "walk me through a request" question:
  1. A gateway or load balancer ends TLS and forwards to one of several stateless instances (layer 7).
  2. Inside, a long-running process hosts the CLR, which JIT-compiles your code, manages memory and supplies thread-pool threads (layer 2).
  3. Kestrel turns the socket bytes into an `HttpContext`, and a DI scope is created for the request (layer 3).
  4. Middleware runs in registration order: exception handling, HTTPS, routing, CORS, authentication (fills `HttpContext.User` from the JWT), authorization, rate limiting.
  5. The endpoint binds and validates the input, then calls application code: a command handler, a DDD aggregate enforcing its rules, a Result instead of an exception for expected failures (layer 4).
  6. I/O is awaited, so the thread goes back to the pool while the database works (layer 1).
  7. EF Core writes the order and an outbox message in one transaction (layer 5).
  8. A background service later publishes the outbox message to a broker, and calls to other services go through retries and a circuit breaker (layer 6).
  9. The response flows back out through the middleware in reverse; logs, metrics and traces are emitted throughout via OpenTelemetry; the DI scope is disposed, which disposes the `DbContext` (layer 8).
  10. And before any of it shipped, unit and integration tests ran in CI.
- **Microsoft names come in families**, and recognising the family tells you what something is for. The platform family: .NET (modern), .NET Framework (old, Windows-only), .NET Standard (an API contract, not a runtime), CLR, BCL, SDK, NuGet. The web family under ASP.NET Core: minimal APIs, controllers, Razor Pages, Blazor, SignalR, gRPC, with Kestrel as the server. The data family: ADO.NET at the bottom, then EF Core or Dapper on top. The cloud family: App Service, Container Apps, AKS and Functions to run code; Service Bus, Event Grid and Event Hubs for messaging; Key Vault, Entra ID and Application Insights around them.
- **DI, configuration, options, logging and hosting are not ASP.NET Core features.** They live in the general-purpose `Microsoft.Extensions.*` libraries and work in any .NET app: workers, console apps, Azure Functions. `WebApplication.CreateBuilder` just wires them up for you. Knowing that resolves a lot of "where does this come from?" confusion.

## Part I · The .NET Platform

This part is layer 2: what actually runs your code, and the tools that build it.

### 1.1 · What .NET actually is

[Full chapter →](ch:what-is-dotnet)

- **.NET is a platform, not a language.** It has four parts:
  - the **runtime (CLR)**, which loads and runs compiled code, JIT-compiles it, manages memory, threads and exceptions;
  - the **Base Class Library (BCL)**, thousands of ready-made types from `string` and `List<T>` to `HttpClient` and `JsonSerializer`;
  - the **SDK**, the build tools: the Roslyn compiler, MSBuild, the `dotnet` CLI and templates;
  - **shared frameworks**, big library sets installed alongside the runtime: `Microsoft.NETCore.App`, `Microsoft.AspNetCore.App` for web, `Microsoft.WindowsDesktop.App` for WPF and WinForms.

  C#, F# and VB all compile to the same output and run on the same platform. A server only needs the runtime ("the DVD player"); developer machines and CI need the SDK ("the studio"), which includes a runtime. Docker images mirror this: `sdk` to build, `aspnet` to run web apps, `runtime` for console apps, and `runtime-deps` (native dependencies only) for self-contained apps.
- **The names are history.** .NET Framework (2002–2019, up to 4.8) is Windows-only and installed into the OS. .NET Core (2016) was a ground-up rewrite. From version 5 (2020) it's just ".NET", and 4 was skipped to avoid confusion with Framework 4.x. "ASP.NET" without "Core" (Web Forms, MVC 5, `System.Web`, `Global.asax`, `HttpContext.Current`) is the old Framework web stack; ASP.NET Core is the rewrite.
- **Why the rewrite was necessary**, because it explains modern design choices:
  - Framework was Windows-only, while the industry moved to Linux and containers.
  - It was installed machine-wide, so upgrading it for one app upgraded it for every app on the server, and companies froze versions for years. .NET Core runs side by side, and apps can even carry their own runtime.
  - ASP.NET was tied to IIS through the monolithic `System.Web`, which loaded a huge pipeline even for a tiny API. ASP.NET Core is modular: you add only the middleware you use.
  - Performance couldn't be fixed without breaking compatibility; .NET Core was built for throughput from day one.
- **A new major version ships every November.** Even numbers are **LTS** with 3 years of support; odd numbers are **STS** with 2 years (extended from 18 months starting with .NET 9). .NET 8 and .NET 10 are LTS; .NET 10 shipped with C# 14. Production usually targets the current LTS and upgrades once per LTS cycle. Monthly patches arrive on "Patch Tuesday", and you get them by updating the runtime or rebuilding on a fresh base image.
- **Target framework monikers (TFMs)** say what a project builds for: `net10.0` (any OS), `net8.0-windows` (Windows-only APIs), `net8.0-android`, `netstandard2.0`, `net48`. A library can multi-target with `<TargetFrameworks>` (plural).
- **.NET Standard is a contract, not a runtime**: a list of APIs every compliant runtime promised to implement, so one library could run on Framework, Core and Mono during the transition years. Only `netstandard2.0` is still useful, because it's the version .NET Framework 4.6.1+ supports. Target it only when Framework apps must consume your library; otherwise target a modern TFM to get modern APIs.
- **Deployment modes are a trade-off.**
  - **Framework-dependent** (the default) ships only your DLLs: small, and the shared runtime gets patched centrally, but the machine must have it installed.
  - **Self-contained** bundles the runtime (about 70 MB or more): it's version-pinned and needs no install, but you must rebuild and redeploy to get runtime security patches.
  - **Single file** packs everything into one executable.
  - **ReadyToRun** adds precompiled native code to the IL for faster startup.
  - **Native AOT** produces a single native binary with no JIT, for instant startup and low memory, at the cost of reflection limits.

  A runtime identifier (RID) such as `linux-x64` or `linux-musl-arm64` says which platform a self-contained or native build targets.
- **The BCL already has most of what you'd reach to NuGet for**: System.Text.Json, `HttpClient`, concurrent, immutable and frozen collections, `Channel<T>`, `PriorityQueue`, `System.IO.Pipelines` (the high-performance I/O that Kestrel uses), `Activity` and `Meter` for telemetry, cryptography, and source-generated `Regex`. Two habits matter in production code. Prefer `DateTimeOffset` or UTC over `DateTime`, because a `DateTime`'s `Kind` is often `Unspecified`, so you can't tell which time zone it means. And inject `TimeProvider` (.NET 8) instead of calling `DateTime.Now`, so time becomes a dependency your tests can control.

### 1.2 · How your code runs: IL, the JIT and the CLR

[Full chapter →](ch:how-code-runs)

- **Compilation happens twice, by two different programs, at two different times.** At build time, **Roslyn** compiles C# into **IL** (Intermediate Language, also called CIL or MSIL), a CPU-independent, stack-based bytecode, and writes it into an **assembly** (a `.dll`). At run time, the **JIT** (RyuJIT) turns each method's IL into real machine code for the exact CPU it's running on, the first time that method is called.
- **Why split it?** Machine code only runs on one CPU family (x64 code won't run on Arm). Stopping at IL means one build runs anywhere, and the last translation happens on the machine that knows its own CPU. Three bonuses fall out of that:
  - the JIT can use instructions that CPU actually supports;
  - the runtime can watch the program run and re-optimise it (Dynamic PGO, below);
  - every .NET language compiles to the same IL, so they call each other with no boundary at all.
- **An assembly holds four things**: a manifest (name, version, referenced assemblies), **metadata tables** describing every type, method and signature, the IL bodies, and resources. The metadata is why .NET needs no header files, why IntelliSense works against compiled libraries, and why **reflection** (asking "what members does this type have?" at run time) is possible at all.
- **IL is a stack machine.** `a + b` compiles to `ldarg.0, ldarg.1, add, ret`: push `a`, push `b`, pop both and push the sum, return the top of the stack. It's deliberately simple, so any CPU's JIT can translate it. SharpLab.io shows IL and JIT output side by side; ILSpy and dotPeek decompile compiled DLLs.
- **Project, assembly and namespace are three independent things.** A `.csproj` is build instructions. An assembly is the compiled output of one project. A namespace is a naming scope in code with no packaging meaning. One assembly can hold many namespaces, and one namespace (like `System.Collections.Generic`) can be spread over several assemblies.
- **The JIT is lazy on purpose.** The CLR doesn't compile everything at load. A method is translated the first time it's called, the native code is kept for the life of the process, and every later call reuses it. So the cost is once per method, not once per call.
- **The CLR does much more than JIT**: assembly loading (`AssemblyLoadContext`), garbage collection, type safety (casts and array bounds are checked), structured exception handling, threads and the thread pool, interop with native code, and verification. Code running under all this is **managed**. Native libraries, OS handles and sockets are **unmanaged**: nothing frees them automatically, and that single fact is why `IDisposable` exists.
- **Tiered compilation compiles hot methods twice.** On the first call the JIT produces quick, unoptimised **Tier 0** code, ready in microseconds, so startup stays fast. Once a method has been called about 30 times, the JIT recompiles it fully optimised (**Tier 1**) in the background and switches later calls over. A method called twice in the app's life never pays for optimisation. A method stuck in one long loop on its first call can't be "called again", so **On-Stack Replacement (OSR)** swaps the running frame over to optimised code mid-loop.
- **Dynamic PGO** (on by default since .NET 8) makes Tier 1 smarter than a generic optimiser. Tier 0 code is instrumented with counters that record what actually happens: which branches are taken, and which concrete class usually sits behind an interface call. The headline payoff is **guarded devirtualisation**. An interface call normally needs a lookup on every call to find which class's method to run. If the profile shows `IRepository` is almost always `SqlRepository`, Tier 1 emits "is it a `SqlRepository`? Then jump straight there", which can then be inlined. The slow general path only runs for the rare other case. This is why apps got faster on .NET 8 with no code changes.
- **Other JIT optimisations you'll hear named**:
  - **inlining**: copies small method bodies into the caller, so property getters cost nothing;
  - **bounds-check elimination**: drops array checks the JIT can prove unnecessary in `for (i < arr.Length)` loops;
  - **devirtualising sealed classes**: a `sealed` class has only one possible implementation, so no guess is even needed. That's a real reason to seal classes by default;
  - constant folding, dead-code elimination and loop optimisations;
  - **SIMD vectorisation** through `Vector128/256/512<T>`, which the BCL uses heavily inside string search, `Span` operations and LINQ's `Sum`.
- **"The first request is slow" has one root cause**: everything on that path is being done for the first time. Methods are jitted at Tier 0, static constructors run, DI resolution plans and the EF Core model are built, and connection pools start empty. Around request 30, hot methods move to Tier 1. At steady state, latency is single-digit milliseconds. Each fix targets one of those causes: ReadyToRun or Native AOT remove the cold JIT; warm-up requests against a deployment slot or readiness probe absorb it before real users arrive; EF Core compiled models remove the model-building cost.
- **ReadyToRun vs Native AOT.** ReadyToRun ships precompiled code inside the assembly, so startup skips Tier 0. The JIT is still present, though, so hot methods can still be re-optimised with PGO to the same peak performance. Native AOT compiles the app plus the runtime pieces it needs into one native executable with **no JIT at all**: startup in milliseconds and a small memory footprint. The price is that AOT requires **trimming**, the removal of all code the build can't prove is used. Reflection that looks things up by name is invisible to the trimmer, so the code it needs may be removed and only fail at run time. That's why AOT-friendly libraries use **source generators** (System.Text.Json source generation, `[LoggerMessage]`, the minimal-API request delegate generator, configuration binding): generated code is ordinary code the trimmer can see. Native AOT suits serverless, scale-to-zero, CLI tools and dense hosting. It doesn't support MVC or Razor, and EF Core support is limited.
- **The CTS and CLS make cross-language work possible.** The **Common Type System** is the runtime's single definition of what a type is (classes, structs, interfaces, enums, delegates, value vs reference). That's why C#'s `int` and VB's `Integer` are literally the same type, `System.Int32`. The **Common Language Specification** is a stricter subset for *public* APIs, so every .NET language can consume them. A public `uint`, for example, breaks it, because some languages have no unsigned integers. `[assembly: CLSCompliant(true)]` makes the compiler warn about this.
- **Assembly loading and versioning.**
  - An assembly's identity is its name, version, culture and an optional strong-name key. Modern .NET largely ignores strong-name validation, so treat it as a legacy identity, not a security boundary.
  - `AssemblyLoadContext` replaced AppDomains for isolating and unloading plugins.
  - Two generated files drive loading: `.deps.json` lists every dependency and where to find it, and `.runtimeconfig.json` names the shared framework version and runtime settings such as Server GC.
  - **Roll-forward**: an app built for 8.0.x runs on the newest installed 8.0 patch automatically. Rolling to a new *major* version needs `<RollForward>Major</RollForward>`, because majors may contain breaking changes.

### 1.3 · Projects, the SDK, NuGet and the toolbox

[Full chapter →](ch:projects-sdk-nuget)

- **One `.csproj` builds one assembly.** A solution (`.sln`, or the newer XML `.slnx`) only groups projects for the IDE and the build. It has no effect on the output. **Project references** decide which assembly may use which, and that's how architecture rules ("the Domain project depends on nothing") get enforced physically: the compiler won't let you reference what isn't referenced.
- **SDK-style project files are short because they're mostly defaults.** Old Framework projects listed every `.cs` file, so every new file edited the project and caused merge conflicts. SDK-style projects include every file in the folder by default and import defaults from the SDK. The csproj then lists only what's different: the SDK flavour (`Microsoft.NET.Sdk`, `.Web`, `.Worker`, `.Razor`), `TargetFramework`, `Nullable`, `ImplicitUsings` (common `using`s added as global usings), and the package and project references.
- **MSBuild is the engine under `dotnet build`.** It evaluates **properties** (scalar settings) and **items** (lists of files and references), then runs **targets**: Restore → Compile → Copy → Publish. Properties can be passed on the command line (`-p:Version=1.2.3`) or made conditional (`Condition="'$(Configuration)' == 'Release'"`). Debug builds skip optimisation so code maps one-to-one to source. Release builds are optimised by the compiler and the JIT, so always benchmark and ship Release.
- **Repo-wide settings belong in `Directory.Build.props`**: MSBuild imports the nearest one above each project, so target framework, nullable, warnings-as-errors and analyzers are set once. `Directory.Build.targets` is imported *after* the project, for overrides. **`global.json`** pins the SDK version, so every developer and CI build use the same compiler.
- **The `dotnet` CLI** covers the whole lifecycle: `new`, `sln`, `add reference`, `add package`, `restore`, `build`, `run` and `watch` (hot reload), `test --filter`, `publish` (including `/t:PublishContainer`, which builds an image without a Dockerfile), `format`, `list package --outdated --vulnerable`, `user-secrets` and `dev-certs`. **Local tools** pinned in `.config/dotnet-tools.json` keep a team on the same tool versions.
- **NuGet resolves a full dependency graph on restore** and writes it to `obj/project.assets.json`. A package is a zip of assemblies per TFM plus a manifest of its dependencies; you get the packages your packages need (transitive dependencies) automatically. Two resolution rules: for each package, NuGet picks the **lowest version that satisfies every constraint**, and a **direct reference wins** over a transitive one.
- **Central Package Management** (`Directory.Packages.props` with `ManagePackageVersionsCentrally`) declares each package's version once. Without it, one project can drift to `9.0.1` and another to `9.0.3`, and the mismatch surfaces at run time as confusing binding errors far from the cause. **Transitive pinning** lets you upgrade a vulnerable transitive package centrally, without adding a direct reference everywhere.
- **Package hygiene that comes up in senior interviews.**
  - **Lock files** (`packages.lock.json`, plus `--locked-mode` in CI) make restores reproducible: everyone resolves the exact same versions, and CI fails loudly instead of quietly picking something new.
  - **NuGet Audit** (on by default since .NET 8) warns about packages with known CVEs; fail the build on those warnings in CI.
  - **Licences** must be checked before adopting a dependency, since some popular libraries have moved to commercial licences.
  - **Package source mapping** in `nuget.config` maps ID prefixes to specific feeds. That blocks *dependency confusion*, where an attacker publishes a public package with your internal package's name and hopes your build picks it up.
- **Code quality is enforced in the build, not by review comments.** Roslyn analyzers flag bugs and misuse (for example CA2016, "forward the `CancellationToken`"), `.editorconfig` sets style and each rule's severity, `dotnet format --verify-no-changes` runs in CI, and `TreatWarningsAsErrors` plus nullable warnings stop most null bugs reaching production. Third-party analyzers and SonarQube add quality gates on top.
- **`launchSettings.json` is for your machine only.** It sets URLs and `ASPNETCORE_ENVIRONMENT=Development` for `dotnet run` and the IDE, it isn't deployed, and production ignores it. Real environments get settings from environment variables, App Service configuration or Kubernetes manifests. `.http` files committed next to a project give everyone runnable sample requests.

## Part II · The C# Language

Part II follows one small online tea shop, **Kettle**, from its first bug to its first performance crisis. Each chapter is an episode: something breaks or hurts, and one language feature is the fix. Keeping that "why" in mind is what makes the features stick.

### 2.1 · The story of Part II

[Full chapter →](ch:csharp-story)

- **Ten problems, ten tools.** A saved basket changes by itself (value vs reference types). An order gets a quantity of −3 (encapsulation). Three caches are copy-pasted (generics). The discount rule is hard-coded in checkout (delegates). Order lookup is slow (collections). Reports are 30-line loops (LINQ). One payment failure takes the site down (exceptions and `using`). Black Friday starves the thread pool (async). A 3 a.m. null crash happens (nullable types and pattern matching). And one long night needs spans, pools, `ref`, interop, reflection and source generators (advanced C#).

### 2.2 · Types: copied or shared?

[Full chapter →](ch:type-system)

- **The one idea underneath everything: what does `=` copy?** A **value type** variable *is* its data (`int`, `decimal`, `DateTime`, `Guid`, any `struct`, `enum` or tuple), so assigning it copies the data, like a photocopy. A **reference type** variable (any `class`, `string`, arrays, delegates, records) holds an **address**, an arrow to an object on the heap, so assigning it copies only the arrow. Both variables then point at **one** object. Kettle's bug: `var savedForLater = basket;` didn't copy the basket, it made a second name for the same basket, so "saved" items appeared in the live basket. The fix is to copy the contents on purpose.
- **Why C# shares by default**: sharing is usually what you want for things with identity. The basket shown in the page, the header counter and checkout must be **the same** basket, and copying a 200-line order on every method call would be slow. Small values that *are* their data (a price, a date) are cheap to copy, and nobody expects `5` to change behind their back. Bugs come from thinking you have a copy when you have a share.
- **Stack vs heap, precisely.** The **stack** is a per-thread scratch pad: each method call pushes a frame for its locals and returning pops it, so it's automatic and free. The **heap** is shared, long-term memory where objects live until nothing references them and the GC frees them. The precise rule is: reference-type **objects always live on the heap**; value types live **wherever their container lives**. A local `int` sits in the stack frame; an `int` field of a class sits inside that object on the heap; the `int`s of an `int[]` sit inside the array on the heap. And two common cases move locals to the heap: a local captured by a lambda goes into a closure object, and the locals of an `async` method live in its boxed state machine. So the defining difference is copy semantics, not location.
- **When to use a struct**: Microsoft's guideline is to avoid structs unless all four are true: it represents a **single value**, it's **small** (about 16 bytes or less), it's **immutable**, and it **won't be boxed** often. Money, coordinates and IDs pass; an order (many fields, lists, changes over time) is a class. Declare value types as `readonly record struct`. `readonly` lets the compiler enforce immutability and skip defensive copies, and `record` generates value equality, `ToString` and `with`.
- **Strongly typed IDs**: wrap each kind of ID in its own tiny struct (`readonly record struct OrderId(Guid Value)`). When every ID is a `Guid`, swapping `Refund(customerId, orderId)` compiles and silently does the wrong thing. With distinct types it's a compile error (CS1503). Being a 16-byte struct, it costs nothing at run time: no allocation, no extra memory, just a check the compiler does for free.
- **Mutable structs bite** because reading a struct gives you a copy. `list[0].X = 5` on a `List<Point>` is a compile error (CS1612): the list's indexer is a *method* (`get_Item`) that returns a copy, and changing a temporary copy would be lost. `arr[0].X = 5` on an array works, because an array element is a real storage location. And `var p = list[0]; p.X = 5;` compiles but changes only the copy, a bug that looks like an ignored assignment. Making structs immutable removes the trap: the only way to "change" one is `list[0] = list[0] with { X = 5 }`.
- **Boxing**: treating a value type as `object` or an interface makes the runtime allocate a heap object (the box), copy the value into it and hand back a reference; unboxing type-checks and copies it back out. The box is a frozen copy, so changing the original afterwards doesn't affect it. It hides in old non-generic collections (`ArrayList`), interface-typed variables (`IComparable c = 5`) and `string.Format` with value arguments. Measured: adding 1,000 ints to an `ArrayList` allocates about 16 KB of boxes (24 bytes each on a 64-bit server); a `List<int>` allocates nothing. The fix is generics, because `List<int>` gets code specialised for `int`.
- **`string` is a reference type built to feel like a value**: it's immutable, `==` compares text, and identical literals are interned (shared). Immutability is what makes strings safe as dictionary keys and across threads, but every "change" allocates a new string. So `+=` in a loop copies everything built so far on every pass, which is O(n²): 1,000 appends allocated about 1 MB, against 4 KB for `StringBuilder`, which grows one buffer and copies each piece once. For keys, codes and paths, compare with `StringComparison.Ordinal` or `OrdinalIgnoreCase`, because culture-sensitive comparisons break under some cultures (in Turkish, `"i".ToUpper()` is `"İ"`).
- **Money is `decimal`**: `double` is binary, so 0.1 can't be stored exactly (just as ⅓ can't be written in decimal), and `0.1 + 0.2` prints `0.30000000000000004`. `decimal` stores base-10 digits, so `0.1m` is exact. **Casts can lie**: narrowing (`(byte)300`) silently keeps the low bits and gives 44, and `int.MaxValue + 1` wraps negative; wrap risky arithmetic in `checked` to get an `OverflowException` instead. To test a type, prefer `is` with a pattern (`o is Order order`), since `as` returns `null` and a cast throws.
- **Nullable value types** (`DateTime?`, which is `Nullable<DateTime>`) are a small struct of a `HasValue` flag plus the value. Using `DateTime.MinValue` to mean "not shipped" made Kettle's report claim an average shipping time of 2,024 years. `?.` and `??` handle the missing case explicitly.
- **Enums are named integers with no range check.** `(OrderStatus)42` compiles and runs, so values from JSON or the database must be validated with `Enum.IsDefined` or a `switch` with a default arm. Give every member an explicit number if you store them, because reordering the declaration otherwise silently changes stored meanings. In public APIs, send enums as strings. `[Flags]` enums use one bit per member, so members combine with `|`.
- **Equality means three things.** Reference equality asks "is it the same object?" (the default for classes, and what `ReferenceEquals` always asks). Value equality asks "do they hold the same data?" (the default for records; also what `Equals` does for structs, slowly, via reflection). And `==`, which a type can overload, as `string` does. Hash-based collections file each item by its **hash code** into a bucket and only call `Equals` inside that bucket. Hence the rules: **equal objects must return equal hash codes**, so override `Equals` and `GetHashCode` together (Kettle's `Tea` overrode only `Equals`, so `HashSet.Contains` searched the wrong bucket and said "not found"), and **never mutate a key** while it's in a set or dictionary, because it stays filed under its old hash.
- **Every argument is passed by value, meaning as a copy.** For a class, the copy is a copy of the arrow. So a method can change the caller's *object* (through its copy of the arrow), but reassigning its parameter only moves its own copy and never reaches the caller. `ref` passes the variable itself, so reassignment does reach the caller. `out` means the method must assign it (the `TryParse` pattern). `in` passes a read-only reference, to avoid copying big structs.
- **`var` vs `object` vs `dynamic`**: `var` is compile-time inference, so `var x = 5` compiles to exactly `int x = 5` and is fully typed. `object` is "any type", so you must cast to do anything with it. `dynamic` defers every member lookup to run time, so typos become exceptions in production and you lose IntelliSense and speed.
- **Object layout**: every heap object carries a 16-byte header on 64-bit (8 bytes the runtime uses for locks and hashing, plus a pointer to its type) before your fields, and fields are padded for alignment. An empty object costs about 24 bytes, so a million tiny objects is about 24 MB of headers. An **array of structs** has one header and stores the data side by side: 1,000 orders as structs took about two-thirds of the memory of 1,000 objects in the browser runtime, and about half on a 64-bit server, with one object for the GC instead of 1,001. The runtime may reorder a class's fields, but structs keep declaration order, which matters for interop (`[StructLayout]`).

### 2.3 · Classes: objects that guard their own rules

[Full chapter →](ch:oop)

- **Encapsulation is the fix for invalid state.** With public fields, any code can write `Quantity = -3` or mark an unpaid order shipped. Make the data private (`{ get; private set; }`) and expose **methods as the only doors**, each checking the rules (the **invariants**) before changing anything: the constructor refuses a quantity under 1; `Ship()` throws on an unpaid order; `Pay()` only works on a placed order. Why put the rule *in the object* rather than in the checkout page? Because there are many ways in (website, admin tool, CSV import, refund job), and the object is the only place every path must go through.
- **Class members**: fields (raw storage, keep them private), properties (the public face, with accessors that can check values), methods (behaviour), constructors (build a valid object from the start), static members (belong to the type), indexers and operators, and events. **`const` is pasted into callers at compile time**: change a public `const` in a library and callers keep the old value until they're recompiled. `static readonly` is read at run time, so it doesn't have that problem.
- **A property is two methods in disguise.** `tea.Stock = -1` compiles to a call to `set_Stock(-1)`, so the setter can reject bad values, and callers can't tell a property from a field, which means you can add rules later without breaking them. `init` makes a property settable only during object creation; `required` makes the compiler reject any `new` that doesn't set it; C# 14's `field` keyword lets an accessor use the compiler-generated backing field directly. Object initialisers run **after** the constructor, so a constructor can't see values set in `{ }`.
- **Construction order surprises people**: for `new Derived()`, it's derived field initialisers, then base field initialisers, then the base constructor body, then the derived constructor body. The base must be fully built before the derived body runs, because that body may use it. The trap that follows: a **virtual call from a base constructor** runs the derived override before the derived constructor has set its fields, so it sees a half-built object (Kettle logged every gift card as "gift card (null!)"). Never call virtual methods from constructors; pass what the base needs as constructor arguments. Static constructors run once per type, before first use, and the runtime makes them thread-safe.
- **Primary constructors** (`class OrderService(IOrderRepository repo)`) put constructor parameters in scope for the whole class, ideal for injected services. The parameters are **not** `readonly`, so assign them to a `readonly` field if you need that guarantee.
- **Polymorphism replaces growing `if` chains.** Instead of `if (method == "card") … else if ("paypal") …` repeated in checkout, refunds and receipts, define what every payment method can do (`interface IPaymentMethod { string Charge(decimal amount); }`) and let each class decide how. One line, `p.Charge(total)`, runs card, PayPal or gift-card code depending on the object. The mechanism is **virtual dispatch**: every object points at its type's method table, and the call follows the object to its table at run time. Adding Apple Pay means one new class and no change to checkout. The same seam is what lets dependency injection swap real implementations for fakes in tests.
- **The four pillars**: encapsulation (private state behind validating methods), abstraction (depend on *what*, not *how*), polymorphism (one call, the runtime type picks the body) and inheritance (reuse a base class in an "is-a" relationship).
- **Interface vs abstract class.** An interface is a pure contract: no fields, and a class can implement many of them. An abstract class is a half-built base with real shared code, fields and a constructor, plus `abstract` blanks to fill in, and a class can extend only one. Use interfaces for seams you'll swap or fake (repositories, gateways, clocks); use an abstract class when closely related types share real code and state. Newer interface features: **default interface methods** (C# 8) exist to add a member to a published interface without breaking implementers; **static abstract members** (C# 11) enable generic math; **explicit implementation** resolves name clashes.
- **`override` vs `new`.** `virtual` means subclasses may replace a method; `abstract` means they must. `override` replaces it for every caller, through virtual dispatch: the **object's** runtime type decides which method runs. `new` merely **hides** the base member: the **variable's declared** type decides, at compile time, so `A x = new B(); x.Plain()` runs `A.Plain`. Hiding is almost always a mistake. A virtual call costs one extra indirection and blocks inlining; `sealed` tells the JIT there is only one implementation, so it can call directly and inline.
- **Composition over inheritance.** Inheritance works for one shallow, real "is-a" relationship. Used to mix features, it explodes: email and SMS notifiers, each with and without logging, with and without retry, is 2 × 2 × 2 = 8 classes, and a change to the base can break any of them (the **fragile base class** problem). Composition builds behaviour from small pieces behind an interface that **wrap** each other: `new Retry(new Logging(new EmailNotifier()))` is 4 classes for any combination. That's the **Decorator** pattern, and it's how ASP.NET Core layers logging, retries and caching around services.
- **Access modifiers are rings of visibility.** `private` means this type only (the default for members). `protected` means this type and its subclasses, even in other assemblies. `internal` means anything in the same assembly (the default for top-level types). `public` means everyone. The rarer `protected internal` is "same assembly **or** subclass"; `private protected` is "subclass **and** same assembly"; `file` limits a type to one source file. Start small and widen only when needed, because making something less visible later breaks whoever used it. `internal` types aren't part of your public API, so you can change them freely; `[InternalsVisibleTo]` lets tests see them.
- **`static`, `sealed`, `partial`.** A static class can't be created or inherited; it's for helpers and extension methods. Avoid **mutable static fields**: they're shared by every request and thread in the process (Kettle's static basket counter showed every shopper's header the total for everyone). `sealed` documents "not designed for inheritance" and enables devirtualisation, so seal by default. `partial` splits a class across files, mainly so source generators can add code to it.
- **`System.Object`** gives every type `Equals`/`GetHashCode` (override together), `ToString` (override it for readable logs), `GetType` (the runtime type, the entry point to reflection) and a protected shallow `MemberwiseClone`.

### 2.4 · Generics: write it once, for any type

[Full chapter →](ch:generics)

- **The problem generics solve**: three identical caches for orders, customers and products means every bug fix must be made three times (and Kettle missed one, so a customer's old address stayed cached). The pre-generics fix, one cache of `object`, loses type safety: anything can go in, every read needs a cast that can fail at run time, and value types get boxed.
- **A generic type has a blank for a type**: `class Cache<T>`. `Cache<Order>` is a real, fully checked type in which every `T` is `Order`. So `Add` accepts only orders, `Get` returns an `Order` with no cast, and putting a customer in is a compile error. **Generic methods** have their own blank (`static T FirstOr<T>(IEnumerable<T> items, T fallback)`), and the compiler usually **infers** `T` from the arguments. `default(T)` is `null` for reference types and zero for value types.
- **Constraints are a deal.** A bare `T` could be anything, so the compiler only lets you use what every type has. `where T : IEntity` limits which types may fill the blank, and in return lets you call `IEntity`'s members on `T`. The compiler checks both sides: at the use site (`Cache<string>` won't compile) and inside the code. Available constraints: `class`, `class?`, `struct`, `notnull`, `unmanaged`, `new()`, a base class, an interface, another type parameter, `default`, and `allows ref struct` (C# 13, which lets `T` be a span-like type).
- **.NET generics are reified: they exist for real at run time**, unlike Java's, which are erased. So `typeof(T)` works, and the JIT generates code per instantiation in a specific way. Each **value type** gets its own specialised machine code (sized for that type, no boxing). All **reference types** share one copy, because every reference is the same size. One consequence: **static fields are per closed type**, so `Counter<Order>.Count` and `Counter<Customer>.Count` are separate, which gives you free per-type caches.
- **Variance answers "is a box of cats a box of animals?"** A `List<Cat>` can't be used as a `List<Animal>`, because the list accepts writes: someone could `Add` a `Dog` through the `List<Animal>` view into what is really a cat list. That's **invariance**. **Covariance** (`out T`) is safe when `T` only comes **out**: `IEnumerable<Cat>` can be an `IEnumerable<Animal>`, since everything that comes out is a cat and every cat is an animal. **Contravariance** (`in T`) is safe when `T` only goes **in**: an `Action<Animal>` can be used as an `Action<Cat>`, because whatever handles any animal handles a cat. Variance only works on interfaces and delegates, only with reference types (an `IEnumerable<int>` would need boxing to be an `IEnumerable<object>`). Arrays are an old unsafe exception: `object[] o = new string[1]; o[0] = 1;` compiles and throws `ArrayTypeMismatchException`.
- **Generic math** (C# 11): `+` and `Zero` belong to a *type*, not to a value, and interfaces used to describe only instance members. **Static abstract interface members** let `INumber<T>` require a static `Zero` and a `+` operator, so one `Sum<T>(…) where T : INumber<T>` works for every numeric type. You'll meet its cousin `IParsable<T>` when binding custom route and query types.
- **Generics you already use everywhere**: `List<Order>` (what's stored), `Task<Order>` (what eventually comes back), `ILogger<OrderService>` (`T` is just a label, used via `typeof(T).Name` as the log category), `IOptions<PaymentOptions>`, `DbSet<Order>`. **Open generics** registered in DI, such as `AddScoped(typeof(IRepository<>), typeof(EfRepository<>))`, let the container build `IRepository<Order>`, `IRepository<Customer>` and any future entity on demand from one registration.

### 2.5 · Delegates: passing behaviour around

[Full chapter →](ch:delegates-events)

- **A delegate is a variable that holds a method.** Its type describes the method's shape: `Func<decimal, decimal>` means "decimal in, decimal out", and any method with that shape fits. Kettle's checkout stopped hard-coding promotions by taking a `Func<decimal, decimal> rule` and calling `rule(subtotal)`. The current promotion is just a value passed in, so checkout never changes again. A **lambda** (`s => s * 0.9m`) writes such a method inline. Delegates are fully type-checked: a method with the wrong shape won't fit.
- **Ready-made delegate types**: `Func<…, TResult>` returns a value, and its **last** type argument is the return type; `Action<…>` returns nothing; `Predicate<T>` returns `bool`. A **method group** (`Console.WriteLine`, `int.Parse` without brackets) is the method itself and converts to a matching delegate, so `x => int.Parse(x)` can just be `int.Parse`. LINQ's `Where` takes a `Func<T, bool>`, so you've been passing delegates all along.
- **Closures**: when a lambda uses a local variable from the surrounding method, it **captures** it, and the local outlives its method. The compiler moves that variable off the stack into a hidden heap object (a "display class", the backpack) that the delegate holds. Three consequences. Capturing **allocates** (the backpack plus the delegate). Captured variables are **shared, not copied**, so every lambda capturing `count` sees the same field. And the backpack lives as long as the delegate, so a long-lived delegate keeps everything it captured alive. A lambda that captures nothing allocates nothing, because the compiler caches one instance in a static field.
- **Static lambdas** (`static x => x * 2`) follow the static-method rule: no `this`, and no access to the enclosing method's locals or parameters, only their own parameters and static members. So they can't capture: an accidental capture becomes a compile error (CS8820) instead of a silent allocation, or a silent leak if the lambda captured `this` and was stored somewhere long-lived. Measured, 1,000 capturing lambdas allocated about 80 KB and 1,000 non-capturing ones essentially nothing. The caching comes from not capturing; the keyword is what *guarantees* it stays that way.
- **The loop trap**: closures capture the *variable*, not its value. A `for` loop has **one** `i` for the whole loop, so three lambdas created inside it all print the final value (`333`). Declaring `var copy = i;` inside the body creates a fresh variable per pass, giving `012`. `foreach` already creates a fresh variable per iteration (since C# 5), which is why this is mainly a `for` problem.
- **Multicast delegates** hold a list of methods: `+=` adds, `-=` removes, and invoking calls them all in order. If they return values, only the **last** result survives, which is why events return `void`. If one throws, the rest don't run.
- **Delegates are immutable, and that's what makes events thread-safe to raise.** `+=` never edits a delegate; it builds a **new** delegate with the longer list and points the variable at it, and anyone holding the old one still has the old, complete list. The race this prevents: `if (Handler != null) Handler(...)` reads the field twice, and another thread can unsubscribe the last handler in between, turning the second read into `null` and a `NullReferenceException`. `Handler?.Invoke(...)` reads the field **once** into a temporary, then checks and calls that temporary. Because the object it points at can never change, the call can't see half a change or a sudden `null`. Two consequences: a handler that unsubscribes a moment before the raise can still be called once, so handlers should cope with that; and field-like events generate `add`/`remove` accessors that swap in the new delegate with `Interlocked.CompareExchange` in a retry loop, so concurrent subscriptions aren't lost.
- **Events are delegates with a safety lock.** An `event` field lets outside code only `+=` and `-=`; only the owning class can raise it or replace the list. A plain public delegate field would let anyone fire it (fake an order) or wipe everyone's subscriptions with `=`. This is the Observer pattern: checkout announces `OrderPlaced`, and email, stock and analytics subscribe without checkout knowing about them. C# events are in-process and synchronous: the publisher calls each subscriber directly and waits. Domain events and integration events, later in the book, are the same idea with different machinery.
- **The classic event leak**: subscribing stores a delegate that references the **subscriber** inside the publisher. A long-lived publisher (a singleton or static event) therefore keeps every subscriber alive, and the GC can't free closed pages that never unsubscribed. The demo showed a forgotten page still alive after a full GC, and an unsubscribed one freed. The fix is `-=` in `Dispose`, or weak events.
- **ASP.NET Core is built from delegates.** Option configuration is `Action<TOptions>`, DI factories are `Func<IServiceProvider, T>`, endpoints are delegates, and the core pipeline type is `delegate Task RequestDelegate(HttpContext context)`. A **middleware** is a function that receives the *next* `RequestDelegate` and returns a new one that wraps it with before and after code. Building `Logging(Auth(endpoint))` composes the onion; a request runs Logging's "before", then Auth, then the endpoint, then back out through Logging's "after". It's the decorator idea again.
- **The same lambda can become code or data.** Assigned to `Func<decimal, bool>`, it compiles to IL you can run but can't inspect. Assigned to `Expression<Func<decimal, bool>>`, the compiler builds an **expression tree**: objects describing the code (a `GreaterThan` node with the parameter on one side and the constant on the other). A provider like EF Core can walk that tree and write SQL. `IEnumerable.Where` takes the first kind; `IQueryable.Where` takes the second.

### 2.6 · Collections: pick the container that fits the question

[Full chapter →](ch:collections)

- **The data was fine; the container was wrong.** Finding 100 recent orders in a `List` of 100,000 took about 10 million comparisons, because `First(o => o.Id == id)` walks from the start every time. A `Dictionary` keyed by ID answers the same 100 lookups with about 100 comparisons. Pick the container whose shape matches the question you ask most.
- **Big-O says how work grows with the number of items, *n*.** O(1) is the same at any size: `dict[key]`, `set.Contains`, `list[5]`. O(log n) halves the problem each step, about 18 steps for 200,000 items: sorted collections, binary search. O(n) looks at everything: `list.Contains`, `First`. O(n²) is everything × everything, typically `list.Contains` inside a loop over a list: 40 billion operations at 200,000 items.
- **Hashing is how O(1) works.** The key's `GetHashCode()` produces a number, the number picks one small **bucket**, and only the one or two entries in that bucket are compared with `Equals`. So size doesn't matter, unless the hash is bad: a hash that always returns 0 puts everything in one bucket and you're back to O(n).
- **The everyday collections**:
  - `List<T>`: position access is O(1) and appending is cheap, but searching and inserting at the front are O(n).
  - `T[]`: fixed size, lowest overhead.
  - `Dictionary<K,V>`: lookup by key in O(1), but no order.
  - `HashSet<T>`: "is this in the set?" in O(1), and it guarantees uniqueness.
  - `Queue<T>` is first in, first out (fairness); `Stack<T>` is last in, first out (undo); `PriorityQueue<T,P>` always gives the lowest priority number, in O(log n).
  - `SortedDictionary` gives lookup and order together, in O(log n).
  - `LinkedList<T>` inserts in O(1) next to a node you already hold (LRU caches), and is slow at everything else.
- **The single best performance fix in real code**: replace `List.Contains` inside a loop with a `HashSet`. Checking 2,000 sign-ups against 2,000 blocked emails was 4,000,000 comparisons with a list (O(n×m)) and about 2,000 hash lookups with a set (O(n+m)). Pass `StringComparer.OrdinalIgnoreCase` to define equality for strings.
- **`List.Add` is amortised O(1).** A list is an array plus a count. When the array is full, `Add` allocates one twice as big and copies everything across, which is O(n) for that one call. Because the capacity doubles (4, 8, 16, 32…), copies get rarer as the list grows, so the average cost per `Add` is constant. If you know the size, pass a capacity and skip the copies entirely. `Insert(0)` and `RemoveAt(0)` are O(n) because everything shifts, so use a `Queue` for front removal.
- **Dictionary rules**:
  - Use `TryGetValue`, which does one lookup and gives both "found?" and the value; `ContainsKey` followed by the indexer does the lookup twice.
  - The indexer adds or overwrites; `Add` throws on a duplicate key.
  - **Keys must not change** while stored, because the bucket was chosen from the hash code at insertion.
  - Pass a comparer to define "same key".
  - **Never depend on iteration order.** It often looks like insertion order until a removal leaves a gap that a later insert reuses. When you need order, sort, or use `SortedDictionary` or .NET 9's `OrderedDictionary<K,V>`.
- **Interfaces: accept the least you need, return what you honestly have.** `IEnumerable<T>` only allows `foreach`; `IReadOnlyCollection<T>` adds `Count`; `IReadOnlyList<T>` adds indexing; `ICollection<T>` adds `Add` and `Remove`; `IList<T>` adds positional writes. A method that only loops should accept `IEnumerable<T>`, so lists, arrays and LINQ queries all fit. A class exposing its data should return `IReadOnlyList<T>`. One gotcha: an `IEnumerable<T>` may be a lazy query, so enumerating it twice runs it twice (two database trips). Call `ToList()` if you need it more than once.
- **Read-only, immutable and frozen are different promises.**
  - `IReadOnlyList<T>` is only a **view**: you can't add through it, but the owner still can, and your view will show it. A caller can even cast it back to `List<T>` and modify your internals. `list.AsReadOnly()` (a `ReadOnlyCollection<T>` wrapper) at least blocks the cast.
  - `ImmutableList<T>` can **never** change through any reference. "Adding" returns a new list that shares most of the old one's structure, so it's safe to share across threads.
  - `FrozenDictionary`/`FrozenSet` (.NET 8) are also unchangeable, but optimised for one job: being read millions of times. They're slow to build, because they study the actual keys to choose the fastest layout, and the fastest possible to read, which makes them ideal for lookup tables built at startup.
- **Ordinary collections are not safe for concurrent writes**: two threads adding to one `Dictionary` can corrupt it. Use `ConcurrentDictionary` (atomic `GetOrAdd`, `AddOrUpdate`, `TryRemove`), `ConcurrentQueue`/`ConcurrentStack`, or `Channel<T>` for async producer/consumer. The subtle bug is the **gap between check and act**: two requests both see "GB rates not cached", both load them, and the second overwrites the first. Each call was thread-safe on its own; the combination wasn't. `GetOrAdd` makes check-and-add one step. Under contention its factory may still run more than once, with only one result stored, so wrap expensive or side-effecting factories in `Lazy<T>` so only the winning one runs.
- **Arrays, spans and collection expressions.** `[1, 2, 3]` (C# 12) builds arrays, lists or spans depending on the target type, and `..` spreads another collection in. `^1` indexes from the end. A **range** on an array (`a[1..3]`) makes a **copy**; a **span** (`a.AsSpan(1, 2)`) is a **window** onto the same memory, so writing through it changes the array. Return `[]` or `Array.Empty<T>()` rather than `null`, so callers can always `foreach`.
- **Custom equality and ordering** can be supplied from outside the type: `EqualityComparer<T>.Create(equals, getHashCode)` for sets and dictionaries, and `Comparer<T>.Create` for sorted collections. The equals and hash functions must agree with each other.

### 2.7 · LINQ: ask for the result, not the loop

[Full chapter →](ch:linq)

- **LINQ describes the result instead of the mechanics.** "Paid orders, grouped by customer, totalled, biggest first, top 3" is `Where → GroupBy → Select → OrderByDescending → Take(3)`, against 11 lines of temporary dictionary, `TryGetValue`, copy, backwards sort comparison and index loop. LINQ isn't compiler magic: it's a library of **extension methods** on `IEnumerable<T>`, each taking a delegate. `Where` is a plain `foreach` with an `if`, and your lambda is the test. Query syntax (`from p in prices where … select …`) compiles to exactly the method calls; many operators (`Take`, `Any`, `Distinct`) exist only as methods.
- **Operators by job**:
  - filter: `Where`, `OfType`;
  - transform: `Select`, and `SelectMany`, which flattens: each order's tea list becomes one list of all teas;
  - sort: `OrderBy`, `ThenBy`;
  - slice: `Take`, `Skip`, `Chunk`;
  - group: `GroupBy`, `ToLookup`, `CountBy`;
  - combine: `Join`, `Zip`, `Concat`, `Union`;
  - sets: `Distinct`, `DistinctBy`, `Intersect`, `Except`;
  - pick one: `First`, `Single`, `MinBy`, `MaxBy`;
  - yes/no: `Any`, `All`, `Contains`;
  - totals: `Count`, `Sum`, `Average`, `Aggregate`;
  - materialise: `ToList`, `ToArray`, `ToDictionary`, `ToHashSet`.

  `ToLookup` is a dictionary of lists that is built **now**, not lazily, and a missing key gives an empty sequence instead of throwing.
- **`First` vs `Single` is a claim about your data.** `First` means "any match will do" (it stops at the first). `Single` means "there must be exactly one": it keeps looking after the first match and **throws if it finds a second**. Use `Single` for lookups by a key that should be unique. Kettle's refund page used `First` on a duplicated order ID and quietly refunded the wrong customer; `Single` would have failed loudly the first time. The `…OrDefault` variants return `default` instead of throwing on zero matches. `SingleOrDefault` still throws on two.
- **Deferred execution: a query is a recipe, not a meal.** Building `Where(…).Select(…)` runs nothing; it returns an object describing the work. The work happens only when something **enumerates** it (`foreach`, `ToList`, `Count`, `First`, `Any`), and it happens **again every time**. Four bugs follow:
  1. The query sees its source as it is when it **runs**, not when it was written.
  2. Every enumeration repeats the work (another database round trip).
  3. Exceptions surface where the query is enumerated, far from where it was written.
  4. Returning an unrun query over a resource you then dispose (a `DbContext`, a reader) fails with `ObjectDisposedException` when the caller loops.

  Materialise once with `ToList()` when you need results more than once. Streaming operators (`Where`, `Select`, `Take`) produce results immediately; buffering ones (`OrderBy`, `GroupBy`, `Reverse`) must read everything first. So `OrderBy(…).First()` sorts the whole source to keep one item, while `MinBy` does it in one pass.
- **`yield return` is how laziness works.** It hands one item to the caller and **pauses** the method, keeping its locals and position; the next `MoveNext()` resumes just after the `yield`. The compiler rewrites the method into a state-machine class implementing `IEnumerator<T>`. That's why infinite sequences are fine (`Fibonacci().Take(10)`), and why caller and iterator output interleave. A chain `Where().Select().Take()` is a pipeline of these, each pulling items from the one before, and `Take` stops pulling once it has enough.
- **`IEnumerable` vs `IQueryable` decides where the query runs.** `Enumerable.Where` takes a `Func` (compiled code) and runs in your process. `Queryable.Where` takes an `Expression<Func>` (a description) that a provider like EF Core translates to SQL and runs in the database. Which one you get depends **only on the declared type of the variable**. Typing `db.Orders` as `IEnumerable<Order>` fetches the **entire table** and filters it in memory, with no compiler warning. Four things silently cause this: assigning to an `IEnumerable` variable, `AsEnumerable()`, an early `ToList()`, or a repository method that returns `IEnumerable`. Keep queries as `IQueryable` until the last call, and `Select` only the columns you need.
- **Expression trees are how C# becomes SQL.** The provider walks the tree: a `BinaryExpression` becomes `(left op right)`, a `MemberExpression` (`o.Total`) becomes a column, a `ConstantExpression` a value. A call to your own C# method is a node with no SQL equivalent, so EF Core throws "could not be translated" (since EF Core 3; older versions silently ran it in memory after fetching everything). Captured variables become **SQL parameters**, never text pasted into the SQL, which is why LINQ queries are naturally safe from SQL injection. Because an `IQueryable` is a tree waiting to grow, you can add `Where` clauses conditionally and still send one query.
- **Performance.** LINQ to Objects allocates enumerators, delegates and closures, which is negligible in business code. In true hot paths a `for` loop over an array or span can be several times faster, so measure with BenchmarkDotNet first. `Any()` stops at the first match (101 items touched in the demo), while `Count() > 0` touches everything (10,000); in EF Core, `Any()` becomes `EXISTS`. Avoid `ToList()` in the middle of a chain. Newer .NET versions vectorise `Sum`/`Min`/`Max`, so upgrading is often a free speed-up.

### 2.8 · Exceptions and cleanup: failing safely

[Full chapter →](ch:exceptions-disposal)

- **Kettle's outage**: a payment provider timed out, `ChargeCard` threw, and the line returning the database connection to the pool never ran. Each failed checkout leaked one connection; when the pool emptied, **every** page on the site timed out, including product pages and search. The database was fine; the cause was three calls away in code nobody was looking at.
- **An exception climbs the call stack.** `throw` stops normal execution, creates an exception object, and the runtime **unwinds**: it walks back through the callers, frame by frame, looking for a `catch` whose type matches. Every `finally` it passes runs on the way, even though nothing has caught the exception yet, which is why cleanup goes in `finally`. The first matching `catch` handles it, and execution continues after that `catch`. If nothing catches it, ASP.NET Core's exception middleware turns it into a 500. Exception objects carry `Message`, `StackTrace`, `InnerException` and a `ToString()` that prints all of them, so **log the exception object, not just `.Message`**.
- **Throw the type that says what went wrong**, because callers distinguish problems by type, not by message text. Bad argument: `ArgumentException`, `ArgumentNullException`, `ArgumentOutOfRangeException`. Wrong state ("ship an unpaid order"): `InvalidOperationException`. Used after dispose: `ObjectDisposedException`. Deliberately unsupported: `NotSupportedException`. Never throw or catch `NullReferenceException` on purpose, because it always signals a bug. One-line guards (`ArgumentNullException.ThrowIfNull`, `ArgumentException.ThrowIfNullOrWhiteSpace`, `ArgumentOutOfRangeException.ThrowIfNegativeOrZero`) throw the right type with the parameter name filled in.
- **`throw;` vs `throw ex;`.** `throw;` rethrows the same exception with its stack trace intact, still pointing at the line that really failed. `throw ex;` counts as a **new throw from the catch block**: the trace is reset to start there, and the real origin is lost. In the demo, the trace no longer mentioned `ChargeCard`. To add context, **wrap**: `throw new InvalidOperationException("Saving order 42 failed", ex)` keeps the original as `InnerException`.
- **Exception filters** (`catch (SupplierException ex) when (ex.Status is 429 or 503)`) are evaluated **before** the stack unwinds. A non-matching filter leaves the exception completely untouched, so it moves on to the next `catch` or caller with the stack still intact for diagnostics. A filter that logs and returns `false` lets you observe an exception without catching it.
- **Custom exceptions** are for problems callers must recognise and act on. Name them `…Exception`, derive from `Exception` (not `ApplicationException`), and put actionable facts in **typed properties** (`Sku`, `Code`), so callers never parse message text. Map exceptions to HTTP status codes in one central place.
- **Don't throw for expected outcomes.** Exceptions are slow (the stack trace must be captured) and invisible in a method's signature. Invalid user input, lookups that miss, validation failures and business refusals ("out of stock") are normal: use `TryParse`, `TryGetValue`, nullable returns, validation results or a `Result<T>` type, whose return type tells every caller the operation can fail. An empty `catch { }` doesn't fix anything; it hides the fire while the bad state keeps doing damage.
- **Async exceptions live in the Task.** An exception thrown inside an `async Task` method is caught by the compiler-generated code and **stored in the returned task** (status `Faulted`); it's rethrown, with its original stack trace, only when someone `await`s the task. Consequences:
  - an un-awaited task's failure is never seen (fire-and-forget);
  - `async void` has no task to store the exception in, so it is raised directly and crashes the process (use it only for UI event handlers);
  - `await Task.WhenAll(...)` rethrows only the **first** failure, and the rest are in `task.Exception.InnerExceptions`;
  - treat `OperationCanceledException` as normal flow (a user closed the page), not an error worth alerting on.
- **The GC frees memory, not resources, and not on your schedule.** Connections, files, sockets, locks and timers must be released **now**, not whenever the GC next runs. The contract for "release this now" is `IDisposable.Dispose()`, and **`using`** guarantees the call: the compiler turns it into `try { … } finally { x?.Dispose(); }`, so the resource is released on every path out, including exceptions. The demo pool lost all its connections to three failed checkouts without `using`, and stayed full with it. Forms: the `using (…) { }` block, the `using var x = …;` declaration (disposed at the end of the scope) and `await using` for `IAsyncDisposable`. **Don't dispose what DI gave you**: the container disposes scoped services when the request ends and singletons at shutdown; you dispose only what you created.
- **Implementing `IDisposable`**: a class that holds disposables should itself be disposable and pass the call on. `Dispose` must be safe to call twice (track a `_disposed` flag), and members should throw `ObjectDisposedException.ThrowIf(_disposed, this)` after disposal. The **full pattern with a finalizer** is only for classes that directly own an **unmanaged** handle. Public `Dispose()` calls `Dispose(true)` and then `GC.SuppressFinalize(this)`; the finalizer calls `Dispose(false)`. The flag says which path you're on. On the normal path, other managed objects are still alive and can be disposed too. On the finalizer path they may already have been collected, so only the raw native resource is freed. `SuppressFinalize` matters for speed too, because objects awaiting finalization survive an extra GC. Better still, wrap handles in a `SafeHandle`, which does all of this correctly. **`IAsyncDisposable`** exists for cleanup that must await, such as flushing a buffer over the network.
- **Common disposal mistakes**:
  - `new HttpClient()` per request causes socket exhaustion; use `IHttpClientFactory`.
  - Not disposing a connection you opened drains the pool.
  - Returning a lazy query from inside a `using` means the caller hits `ObjectDisposedException` when it loops; materialise first.
  - Disposing an injected service breaks everyone else who received it.
  - Holding a scoped disposable in a singleton keeps using it after the request disposed it.
  - Forgetting to dispose `CancellationTokenSource`, `Timer` or `SemaphoreSlim` leaks timers and handles.

### 2.9 · Async and await: don't hold a thread while you wait

[Full chapter →](ch:async-await)

- **Black Friday: CPU at 5%, site frozen.** Every request thread was sitting blocked, waiting about 820 ms for SQL and a slow payment API. At 500 checkouts a second that's about 410 threads all waiting; the thread pool only adds roughly one thread per second under pressure, so requests queued for a free thread while existing threads did nothing. More threads isn't the fix (each costs about 1 MB of stack and OS scheduling); the problem is threads **doing nothing**.
- **`await` frees the thread while you wait.** "Start this; if it isn't finished, give my thread back and run the rest of the method when the result arrives." During the wait **no thread is blocked**: the OS tells .NET when the network bytes arrive, and any free pool thread runs the rest. A handful of threads can then keep thousands of requests in flight. Async doesn't make one request faster (it adds slight overhead); it makes the server **scale**, and total latency drops when independent calls run concurrently.
- **What `await` does, exactly.** If the awaited task is already complete, execution just continues synchronously. Otherwise the method saves its locals, records "resume here", and **returns an unfinished `Task` to its caller**. The rest of the method, the **continuation**, runs when the awaited task completes, possibly on a different thread. In the demo the output order was 1, 2, 4, 5: the method left in the middle and came back later, with its local `orderId` intact. `async` doesn't create threads; only `Task.Run` (or similar) explicitly queues work to the pool.
- **A `Task` is a receipt for work in progress**, ending in one of three states: **RanToCompletion** (`await` gives the result), **Faulted** (`await` rethrows the stored exception) or **Canceled** (`await` throws `OperationCanceledException`). Useful pieces: `Task.FromResult`, `Task.CompletedTask`, `Task.Delay` (never `Thread.Sleep` in async code), `WhenAll` and `WhenAny`.
- **I/O-bound vs CPU-bound.** Waiting for something outside (SQL, HTTP, files) is what `await` is for. CPU work needs a thread regardless, so `await Task.Run(...)` inside a web request just swaps one pool thread for another plus overhead. It helps in UI apps (to keep the UI thread free), not in ASP.NET Core.
- **The five rules**:
  1. **Async all the way**: once a method awaits, its callers should be async too.
  2. **Never block on a task** with `.Result`, `.Wait()` or `.GetAwaiter().GetResult()`: it brings back the starvation and can deadlock (below).
  3. **No `async void`** except UI event handlers, because exceptions in it crash the process.
  4. **Pass a `CancellationToken` everywhere**, so database and HTTP calls stop when the user leaves.
  5. **Use the real async APIs** (`ToListAsync`, `SaveChangesAsync`, `SemaphoreSlim.WaitAsync`), because a method named `…Async` that blocks inside frees nothing.

  Returning a task straight through without `async`/`await` saves a little, but keep the keywords when there's a `using`, a `try` or more than one statement, or the resource may be disposed before the task finishes.
- **Concurrency**: independent calls awaited one after another take the **sum** of their times, because the second doesn't even start until the first finishes. Starting both, then `await Task.WhenAll(a, b)`, takes the **longest** time. `WhenAny` gives first-to-finish (timeouts), `Task.WhenEach` (.NET 9) gives results as they complete, `Parallel.ForEachAsync` with `MaxDegreeOfParallelism` caps fan-out, and `task.WaitAsync(timeout, ct)` adds a timeout to anything. Never run two queries at once on one `DbContext`: it isn't thread-safe and throws "A second operation was started", so use separate contexts from `IDbContextFactory`.
- **Cancellation is cooperative.** A `CancellationTokenSource` raises the flag; code holding the token checks it (`ThrowIfCancellationRequested`) or passes it on to APIs that check it, and stops itself by throwing `OperationCanceledException`. Nothing is killed by force, which is why every level must pass the token down. Forget one level and it keeps working for nobody. ASP.NET Core supplies `RequestAborted`, which fires when the client disconnects. Linked sources plus `CancelAfter` add timeouts, and a `when (!requestToken.IsCancellationRequested)` filter tells "our timeout fired" (return 504) apart from "the user left". Dispose the sources you create, because they can hold timers.
- **Async streams** (`IAsyncEnumerable<T>` with `await foreach`) are the async version of `yield return`: items are handed over as they arrive, page by page, instead of after everything has loaded. ASP.NET Core streams them as a JSON array without buffering the whole result.
- **The state machine.** The compiler rewrites an async method into a struct whose fields are your locals and parameters, plus a state number ("paused at await #0"), a builder that creates and completes the `Task`, and awaiter fields. `MoveNext()` runs to the next incomplete await, registers itself as the continuation and returns. If every awaited task is already complete, it runs straight through synchronously and cheaply. On the **first real pause** the struct is boxed to the heap. It has to be: the method returns, its stack frame is popped, and the locals must survive until the continuation runs, maybe on another thread's stack. That's why async locals live on the heap, and why a `Span<T>` (which may point at stack memory) can't cross an `await`. `await` works on anything with a `GetAwaiter()` method.
- **Where code resumes: `SynchronizationContext`.** UI frameworks have one UI thread that alone may touch controls, so by default `await` posts the continuation back to that thread's queue. ASP.NET Core has **no** synchronization context, so any pool thread continues. `ConfigureAwait(false)` means "don't go back to the captured context". It matters in **libraries** that might run under a UI or legacy ASP.NET context (fewer context switches, and it avoids the deadlock below); in ASP.NET Core app code it changes nothing. `ExecutionContext` is separate: it carries `AsyncLocal` values (logging scopes, `Activity.Current`, culture) and **always** flows across awaits.
- **Deadlock vs starvation.** In a UI app, `GetDataAsync().Result` blocks the UI thread while the continuation needs that same UI thread: each waits for the other forever. In ASP.NET Core there's no context, so no deadlock, but every `.Result` holds a pool thread hostage, and under load the pool starves: latency climbs to seconds while CPU stays low and the thread count creeps up. Diagnose with `dotnet-counters` (thread pool queue length and thread count) and `dotnet-dump` or `dotnet-stack` (threads stuck in `Wait`/`GetResult`). The fix is removing sync-over-async; raising `SetMinThreads` only buys time.
- **`ValueTask<T>`** is a struct that can carry an already-known result with **no allocation**, while `Task<T>` is a class allocated on every call. It suits hot methods that usually complete synchronously, such as cache hits and buffered reads. Rules: await it **exactly once**, never concurrently, and call `.AsTask()` if you need to store it or await it twice. Default to `Task` everywhere else.
- **Fire-and-forget inside a request is broken three ways**: its exceptions are never observed; it's killed if the app shuts down mid-way; and the scoped services it uses (like `DbContext`) are disposed when the request ends, possibly while it's still running. Hand the work to a background queue (`Channel<T>` plus a hosted service) or a durable message broker.
- **You can't `await` inside `lock`.** A `Monitor` lock belongs to the **thread** that took it, and after an `await` the method may resume on a different thread, which would then try to release a lock it never acquired, so the compiler forbids it (CS1996). `SemaphoreSlim(1, 1)` counts permits instead of tracking an owner thread, offers `WaitAsync`, and must be released in a `finally`.

### 2.10 · Modern C#: let the compiler catch it

[Full chapter →](ch:modern-csharp)

- **The theme: move mistakes from run time to compile time**, and cut boilerplate while you're at it. Kettle's 3 a.m. page was a `NullReferenceException` in the shipping-label job: one customer had no address, and because the job was one loop, one bad record stopped 400 labels from printing.
- **Nullable reference types** (`<Nullable>enable</Nullable>`, the default in new projects) let the type say "might be missing". `Address` means never null; `Address?` means may be null. The compiler then does **flow analysis**: it follows your code line by line and warns (CS8602) wherever a maybe-null value is used without a check, and knows a value is safe after `if (x is null) return`. The null toolkit:
  - `?.` calls only if the value is non-null;
  - `??` supplies a fallback, and `??=` assigns only if null;
  - `!` is the null-forgiving operator: it silences the warning and checks **nothing**, so use it rarely;
  - attributes like `[NotNullWhen(true)]` teach the compiler your methods' null contracts (`TryFind(id, out Order? o)`).

  It's **compile-time only**: JSON with a missing field, a database `NULL` or un-annotated code can still produce null, so validate at your app's edges. EF Core and ASP.NET Core read the annotations too: `string` becomes `NOT NULL`, and non-nullable request properties count as required.
- **Pattern matching** tests the *shape* of a value. A switch expression is a table of rules tried top to bottom, where the first match wins: `{ Total: >= 100 } => 0m, { IsVip: true } => 0m, { Country: "GB" or "IE" } => 3.95m, _ => …`. The compiler warns when the arms aren't **exhaustive** and errors when an arm can never be reached (**subsumption**). Pattern kinds:
  - type: `o is Order order`;
  - constant: `x is null`;
  - relational: `> 0 and <= 10`;
  - logical: `and`, `or`, `not`;
  - property and nested property: `{ Customer.Country: "GB" }`;
  - list patterns: `[]`, `[var only]`, `[var first, .. var middle, var last]`;
  - the discard: `_`.
- **Records are types designed for data.** One line, `record OrderDto(int Id, string Tea, decimal Total)`, generates the constructor, properties, value-based `Equals`/`GetHashCode`/`==`, a readable `ToString`, `Deconstruct` and `with` (a non-destructive copy with changes). Two separate records with the same values are `==`. Use records for DTOs, commands, events, messages and value objects; use classes for EF Core entities (they have identity and a lifecycle) and for services. `record` is a reference type and `record struct` a value type. Record equality is **shallow**: a `List` inside one is compared by reference, and the list itself can still be mutated.
- **`init` and `required`.** `init` answers *when* a property may be set: only during object creation, after which it's locked. `required` answers *whether* it must be set: omitting it is compile error CS9035, and System.Text.Json enforces it during deserialization, so a missing field becomes an error instead of a silent default.
- **Tuples** (`(int Count, decimal Total)`) are `ValueTuple` structs with element names and deconstruction, handy for quick private multi-value returns and one-line swaps (`(a, b) = (b, a)`). Avoid them in public APIs, persisted data or anything crossing a boundary; use a record there.
- **Extension methods** are static methods whose first parameter has `this`. `price.AsPounds()` compiles to `KettleExtensions.AsPounds(price)`. They can't see private members, and a real member with the same signature always wins. All of LINQ is extension methods, and so is ASP.NET Core's whole configuration API (`AddDbContext`, `MapGet`), which is how libraries plug fluent methods into `IServiceCollection`. C# 14's **extension members** add extension *properties* and static members through `extension(Order order) { … }` blocks.
- **Less ceremony**: top-level statements (the compiler generates a `Program` class with a `<Main>$` method around your lines, which is where `args` comes from), global usings, file-scoped namespaces and implicit usings all reduce typing without changing the compiled code.
- **Primary constructors** put class parameters in scope everywhere (ideal for DI), but they're mutable parameters, not `readonly` fields. **Collection expressions** (`[..prices, 12]`) build any collection type. **Raw string literals** (`"""…"""`) hold JSON, SQL or regex exactly as written; with `$$`, interpolation takes `{{x}}` and single braces stay literal. Don't interpolate log messages (`$"Order {id}"`), because the value is flattened into text and can't be queried; use a template (`"Order {OrderId}"`).
- **Small features you'll see everywhere**:
  - target-typed `new()`;
  - `nameof(x)`, which survives renames;
  - indexes from the end and ranges (`^1`, `1..^1`);
  - `using` declarations;
  - static lambdas, which can't capture, so they never allocate a closure;
  - local functions;
  - type aliases (`using OrderMap = Dictionary<int, Order>;`);
  - `params` spans (C# 13), which avoid allocating an array per call;
  - the `Lock` type (C# 13);
  - the `field` keyword (C# 14);
  - UTF-8 literals (`"Content-Type"u8`).
- **Version landmarks**:
  - C# 8: nullable reference types, switch expressions, async streams;
  - C# 9: records, `init`, top-level statements;
  - C# 10: global usings, file-scoped namespaces, record structs;
  - C# 11: raw strings, `required`, list patterns, generic math;
  - C# 12: primary constructors, collection expressions;
  - C# 13: `params` collections, `Lock`;
  - C# 14: extension members, `field`, null-conditional assignment (`a?.B = x`).

### 2.11 · Advanced C#: one long night at Kettle

[Full chapter →](ch:advanced-csharp)

The theme of all seven acts: **pay a cost once, so you don't pay it millions of times at run time**. Reach for these tools after a profiler or a hard requirement says so, not before.

- **Act 1, spans: look, don't copy.** Parsing a 2-million-line price file with `Split` creates a new array and four new strings per line, copying every character, which is about 10 million throwaway objects per night (2.9 MB of garbage for 20,000 lines in the demo). `ReadOnlySpan<char>` is a **window**, "start here, this long", over memory that already exists. Slicing it makes a smaller window, never a copy, and `decimal.Parse`, `int.Parse` and friends accept spans, so the parser allocated less than 1 KB. A span can view part of an array (writes go into the array), part of a string, or **stack** memory from `stackalloc`, which the GC never sees.
- **Why spans have strict rules.** Because a span may point at a stack frame that disappears when its method returns, `Span<T>` is a **`ref struct`**: a type the compiler only allows on the stack. Every restriction follows from that. It can't be a field of a class, be boxed or cast to an interface, be captured by a lambda, cross an `await` or `yield`, or be an array element: each of those would put it on the heap, where it could outlive the memory it points at. C# 13 relaxed this safely: ref structs can implement interfaces without boxing, and be generic arguments with `allows ref struct`. **`Memory<T>`** is the heap-safe version (it never points at stack memory), so async methods take `Memory<T>` and use `.Span` in their synchronous parts.
- **Act 2, `ArrayPool<T>`: borrow, don't buy.** Allocating a fresh 1 MB buffer per chunk puts each one on the **Large Object Heap** (objects of 85 KB or more), which is only cleaned by expensive full GCs. `ArrayPool<byte>.Shared` is a shelf of reusable arrays. You `Rent` (and may get a **bigger** array than you asked for, such as 131,072 bytes for 100,000, so use only the length you requested) and `Return` in a `finally`. After `Return`, the array belongs to someone else, so never touch it again. Three chunks used one array, with no new allocations. Related tools: `ObjectPool<T>`, `RecyclableMemoryStream`, `IBufferWriter<T>` and System.IO.Pipelines (what Kestrel uses).
- **Act 3, `ref`: change it where it lives.** Two million `StockLevel` structs need a 5% price rise, but `foreach (var s in stock) s.Price *= 1.05m` won't compile (the loop variable is a read-only copy), and a list indexer returns a copy. A **`ref` local** (`ref var s = ref arr[0]`) is an alias for the **slot itself**, so writes land in the array. `foreach (ref var s in CollectionsMarshal.AsSpan(list))` walks the list's own internal array by reference, with zero copies; don't add or remove items while holding it, because a resize swaps the array underneath. A **ref return** hands back a slot instead of a copy. **`in`** passes a read-only reference. The compiler's **ref safety** rules prove a ref can never outlive what it points at (returning a ref to a local is an error), and `scoped` tightens them further. A **defensive copy** happens when you call a method on a value that must not change (an `in` parameter or `readonly` field): the compiler can't see inside the method to know whether it writes to fields, so it calls it on a temporary copy, silently undoing the point of `in`. A `readonly struct` or `readonly` members prove no writes happen, so no copy is needed.
- **Act 4, native interop.** The warehouse's label printer ships only a C library. **P/Invoke** calls native functions, but the GC may **move** managed objects when it compacts the heap, and C code trusts raw pointers blindly. `fixed (byte* p = zpl) { … }` **pins** the array so it can't move while native code reads it (inside `unsafe` code). Pin briefly, because pinned objects are obstacles the GC must compact around, which fragments the heap. `[LibraryImport]` (.NET 7+) is a source generator that writes the marshalling and pinning for you, works with spans and is compatible with Native AOT, so `unsafe` stays in generated code. Wrap native handles in `SafeHandle`.
- **Act 5, attributes and reflection: label once, enforce in one place.** Finance needs every refund and cancellation audited, and developers keep forgetting the logging call. An **attribute** (`[Audit("refund.issue")]`) is a passive label stored in the assembly's metadata; it does nothing by itself. **Reflection** reads metadata at run time (`GetTypes`, `GetMethods`, `GetCustomAttribute`, `MethodInfo.Invoke`), so one dispatcher can audit every labelled method, including ones written next year. That's how DI containers, serializers, ASP.NET Core (controllers, `[Authorize]`), EF Core and test runners work. Attributes are read by the compiler (`[Obsolete]`, nullability attributes), the runtime (`[StructLayout]`), frameworks through reflection, or source generators. **The bill**: `MethodInfo.Invoke` checks arguments, unpacks an `object[]` and boxes, typically 10–30× slower than a direct call. A rename compiles but fails at run time, because the lookup was a string. And the trimmer can't see members used only by name. Mitigate by reflecting once and creating a typed delegate (`CreateDelegate`), or avoid reflection altogether with a generator.
- **Act 6, source generators: do the work at build time.** A serverless cold start took 2.4 s, mostly reflection discovering DTOs, attributes and regexes at startup, and Native AOT builds warned (IL2026) that reflection might break once trimmed. Everything reflection discovers was **already known when you compiled**. A source generator is a compiler plugin that reads your code during the build and **adds ordinary C# files**, which compile in with yours. At run time there's nothing left to discover: fast startup, no boxing, errors at build time (rename a method and the generated code stops compiling), and the trimmer sees everything, so Native AOT works. The recipe is a `partial` declaration with no body, plus an attribute saying what to generate: `[JsonSerializable]`, `[LoggerMessage]`, `[GeneratedRegex]`, `[LibraryImport]`. Kettle's cold start went from 2.4 s to about 80 ms.
- **Act 7, building expression trees by hand.** An admin screen filters orders by any field chosen in dropdowns, and it must run as SQL. Gluing SQL strings is injection; writing a lambda per combination is impossible. So **build the tree yourself**: `Expression.Parameter`, `Expression.Property`, `Expression.Constant`, `Expression.GreaterThan`/`Equal`, joined with `Expression.AndAlso`, then `Expression.Lambda<Func<Order, bool>>`. It's the same tree the compiler would produce from a written lambda. Pass it to `IQueryable.Where`, and EF Core writes SQL with the user's values as **parameters**, because user input only ever becomes a constant node. Whitelist the filterable fields, because otherwise a crafted request could reach internal properties. `Compile()` turns a tree into a delegate, but it's expensive (milliseconds) and interpreted under Native AOT, so cache the result. Mappers and ORMs use the same trick: build a property-reading tree once per type, compile it and cache it, which turns reflection's per-call cost into a one-time cost.

## Part III · ASP.NET Core

Layer 3: the framework that turns a .NET process into a web server, and the shared plumbing (host, DI, configuration, logging) that everything else is built on.

### 3.1 · Architecture and hosting

[Full chapter →](ch:aspnet-hosting)

- **An ASP.NET Core app is a console program with a web server inside it.** There's no IIS or Apache process hosting your code from the outside. ASP.NET Core is a set of libraries (the `Microsoft.AspNetCore.App` shared framework), and your process contains **Kestrel**, its own web server. That's why one `Program.cs` both configures services and starts a server, why you can step from your handler straight into framework code, and why the whole thing fits in one small container image.
- **The Generic Host owns everything**: the DI container, configuration, logging, the environment, hosted services (`IHostedService`, which it starts and stops) and lifetime. It isn't web-specific: a Worker Service uses the same host with no HTTP at all (`Host.CreateApplicationBuilder`). The web server is just one of its hosted services. `WebApplication` (.NET 6+, the "minimal hosting model") is both the host and the object you configure the pipeline on. Older code used `Startup.ConfigureServices` (phase 1) and `Startup.Configure` (phase 2): same shape, different syntax.
- **`Program.cs` has two phases separated by `builder.Build()`.** Phase 1 is declarative: you add DI registrations, configuration sources and logging setup to a recipe list, and nothing is constructed yet. `Build()` turns the recipes into the real `IServiceProvider` and **freezes** them. Phase 2 adds middleware and endpoints, and the order you write them in becomes the order requests flow through. Three mistakes follow from this boundary:
  1. Registering services after `Build()` throws, because the container already exists.
  2. Calling `builder.Services.BuildServiceProvider()` in phase 1 silently builds a **second container**, so singletons are constructed twice and drift apart (analyzer ASP0000 warns about it).
  3. Wrong middleware order raises no error at all, just wrong behaviour: `UseAuthorization` before `UseAuthentication` makes every request look anonymous.
- **`CreateBuilder` comes with defaults**: content root and `wwwroot`; configuration from `appsettings.json` → `appsettings.{Env}.json` → user secrets (Development) → environment variables → command line; console, debug and EventSource logging; Kestrel configured from the `Kestrel` section; DI scope validation in Development. `CreateSlimBuilder` trims these for smaller, AOT-friendly apps, and `CreateEmptyBuilder` gives you nothing.
- **Kestrel** listens on sockets (QUIC for HTTP/3), handles TLS, parses HTTP/1.1, 2 and 3, builds an `HttpContext` per request and hands it to the pipeline. It's built on `System.IO.Pipelines` (pooled buffers), so per-request allocation stays low. Limits such as maximum body size and header timeouts, and `AddServerHeader = false`, are set in code or config. The listening URL comes from `ASPNETCORE_URLS`, `ASPNETCORE_HTTP_PORTS` (8080 by default in the .NET 8+ container images), `--urls`, or `launchSettings.json` in development.
- **Production puts a reverse proxy in front.** That's not because Kestrel is weak. Centralising TLS termination, load balancing, many apps behind one IP, caching, a WAF and edge rate limiting is better than duplicating them in every instance. The consequence: the proxy **is** the TCP client, so your app sees the proxy's IP and scheme. The proxy adds `X-Forwarded-For`/`-Proto`/`-Host`, but you must opt in with `UseForwardedHeaders()` (first in the pipeline) **and** list `KnownProxies`. Otherwise any client could forge its own IP. Without forwarded headers, client IPs, HTTPS redirection and generated URLs are all wrong. **YARP** is Microsoft's reverse-proxy library on ASP.NET Core, common for gateways and the BFF pattern.
- **IIS** hosts ASP.NET Core through the ASP.NET Core Module, either **in-process** (inside `w3wp.exe` using IIS's HTTP server, which is fastest) or **out-of-process** (IIS proxies to Kestrel). The generated `web.config` only configures IIS; it is not application configuration. HTTP.sys is a Windows-only server for Windows auth and port sharing without IIS.
- **Environments change configuration, never code paths.** `ASPNETCORE_ENVIRONMENT` (or `DOTNET_ENVIRONMENT`) defaults to `Production`: a deployment nobody configured fails toward hiding details, not leaking them. Development turns on the exception page, user secrets, scope validation and the OpenAPI UI. If business logic branches on `IsProduction()`, staging no longer tests the code that will actually run in production.
- **Lifetime and graceful shutdown, in order**:
  1. The container is built.
  2. Hosted services start in registration order (so background services registered before the web server start first).
  3. Kestrel listens and `ApplicationStarted` fires.
  4. On **SIGTERM** (a deploy, scale-in, `docker stop`), `ApplicationStopping` fires, Kestrel stops accepting new connections but **drains** in-flight requests, and hosted services get `StopAsync` with their stopping token cancelled, all within `ShutdownTimeout` (30 s by default).
  5. `ApplicationStopped` fires, and the container disposes singletons.

  Instances are replaced routinely in Kubernetes and Container Apps, so ungraceful shutdown means 502s on every deploy. Honour the stopping token, stay inside the platform's grace period, and make work **idempotent**, so an interrupted job can be safely redone.
- **`HttpContext` is the per-request object everything shares**:
  - `Request` and `Response`, with headers and body streams;
  - `User`, the `ClaimsPrincipal` set by authentication;
  - `RequestServices`, **the request's DI scope**, which is where "one scope per request" physically lives;
  - `Items`, a per-request dictionary for passing data between middleware;
  - `Features`, the low-level server interfaces;
  - `Connection`, with the remote IP and client certificate;
  - `RequestAborted`, cancelled when the client disconnects;
  - `TraceIdentifier`;
  - `GetEndpoint()`, the endpoint routing chose.

  It's **not thread-safe** and is only valid during its request, so never capture it in background work. `IHttpContextAccessor` reaches it from services, but passing what you need explicitly is usually better.
- **Hosting options**: Kestrel in a container (Kubernetes, Container Apps; the most common), App Service, IIS in-process, HTTP.sys, Azure Functions' isolated worker with ASP.NET Core integration, and `TestServer` (in-memory, for integration tests).

### 3.2 · Dependency injection in depth

[Full chapter →](ch:dependency-injection)

- **Why DI**: a class that `new`s its own `SqlOrderRepository` and `SmtpEmailSender` has four problems with one cause. It's welded to specific technologies, it can't be unit-tested without a real database and mail server, a connection string sits inside business code, and nobody owns its dependencies' lifetimes. With DI, the class only **declares** what it needs in its constructor (`OrderService(IOrderRepository repo, IEmailSender email)`) and something else supplies it. Tests pass fakes, and all four problems disappear together. Terms: the **Dependency Inversion Principle** is the design rule (depend on abstractions); **Inversion of Control** is the general idea (the framework creates objects and calls your code); **DI** is the technique; the **container** automates it.
- **The container works in three moments.** Registration builds a list of recipes ("for `IOrderRepository`, use `EfOrderRepository`, scoped"). `Build()` turns them into an `IServiceProvider`. Resolution looks at a type's constructor (the one with the most parameters it can satisfy), resolves each dependency recursively, then constructs the type. You never write `new OrderService(...)`. Services also arrive through minimal-API handler parameters, `[FromServices]` on controller actions, middleware `InvokeAsync` parameters (per request), and `@inject` in Razor.
- **Lifetimes answer "is this the same instance as last time?"**:
  - **Transient**: new on every resolution, for cheap stateless helpers.
  - **Scoped**: one per scope, which in ASP.NET Core means **one per HTTP request**; for `DbContext`, repositories, the current user or tenant.
  - **Singleton**: one for the whole app; for caches, configuration objects, `IConnectionMultiplexer`, clocks and expensive thread-safe objects. It **must be thread-safe**, because every request shares it at once.

  To choose: per-request state, or a dependency on anything scoped → scoped; stateless or genuinely thread-safe, and expensive to build → singleton; otherwise transient. When unsure, scoped is the safe default, because it can never outlive a request.
- **A scope is a child container** with its own cache of scoped instances, disposed as one unit. ASP.NET Core creates exactly one per request, early in the pipeline, and exposes it as `HttpContext.RequestServices`. **Outside a request there is no scope** unless you create one. A `BackgroundService` (always a singleton) that needs a `DbContext` must inject `IServiceScopeFactory` and `await using var scope = factory.CreateAsyncScope()` **per unit of work**.
- **The captive dependency is the most common DI bug.** Rule: a service must never depend on one with a **shorter** lifetime. A singleton is constructed once, so whatever scoped service it received then is held forever. Say `PriceCache` (a singleton) takes `ShopDb` (scoped): it keeps the **first request's** `DbContext`. That gives three symptoms from one cause: concurrent requests share a non-thread-safe context ("a second operation was started on this context"), the change tracker grows forever and serves stale data, and after the first request disposes it, everything throws `ObjectDisposedException`. `ValidateScopes` (on in Development, and worth enabling everywhere) turns this into a startup error. `ValidateOnBuild` checks that every registration can be constructed. The fix: make the consumer scoped, or inject `IServiceScopeFactory`/`IDbContextFactory<T>` and create per operation.
- **Registration API**:
  - interface → implementation, or a concrete type registered as itself;
  - an existing instance, which the container will **not** dispose;
  - factories (`sp => …`);
  - `TryAdd…`, which adds only if nothing is registered yet (what libraries use);
  - open generics (`typeof(IRepository<>)`), from which the container closes any `IRepository<T>` on demand.

  With **several implementations** of one interface, injecting the interface silently gives the **last** registered, and `IEnumerable<T>` gives all of them in order. **Keyed services** (.NET 8) let you pick one by name: `AddKeyedSingleton<IPaymentGateway, StripeGateway>("stripe")` plus `[FromKeyedServices("stripe")]` or `GetRequiredKeyedService`. Group registrations into `AddInfrastructure(...)` extension methods, so `Program.cs`, the **composition root** and the only place that knows every concrete type, stays readable.
- **Decorators and scanning** aren't built in. Decorate by hand by registering the inner type concretely and the interface with a factory that wraps it, or use **Scrutor** (`Decorate<TInterface, TDecorator>()`, assembly scanning). Autofac, Lamar and DryIoc add modules and interception, but most apps don't need them.
- **Disposal**: the container disposes `IDisposable`/`IAsyncDisposable` instances **it created**, when their scope ends (singletons at shutdown). It doesn't dispose instances you passed in. **Transient disposables resolved from the root provider** are tracked until shutdown, which is a slow memory leak if done repeatedly, so resolve from a scope. Never dispose something that was injected into you.
- **Anti-patterns**:
  - **Service Locator** (calling `GetService` inside business code): it hides dependencies, so missing registrations fail at run time instead of in startup validation, and tests need a configured container.
  - **Over-injection** (10+ constructor parameters): the class has too many responsibilities.
  - Static access to services or `HttpContext`.
  - `BuildServiceProvider()` in `Program.cs`.
  - An interface for every class, even where nothing is ever swapped.
  - Async work in constructors, which can't be async; use factories or a hosted service's startup instead.
- **Internals.** Each registration becomes a **call site** describing how to build that type. The first resolution analyses the dependency graph and builds a plan. Hot services switch from reflection to compiled expression trees or IL emit, so later resolutions are cheap. Singletons are cached in the root, scoped instances in each scope's dictionary, and transients aren't cached, only tracked for disposal. `ActivatorUtilities.CreateInstance<T>(sp, args)` builds an **unregistered** type by mixing DI services with explicit arguments; that's how conventional middleware is constructed.

### 3.3 · Configuration, options and secrets

[Full chapter →](ch:configuration-options)

- **The same compiled binary must run everywhere with different settings.** Hard-coding a connection string means rebuilding per environment (so you no longer ship the binary you tested), and any secret is in git history forever. **Layered configuration** merges several sources into one flat `IConfiguration`, and **later sources override earlier ones key by key**. Your code never knows which layer a value came from.
- **The default five layers, lowest priority first**: `appsettings.json` (defaults, committed, no secrets), `appsettings.{Environment}.json` (only the keys that differ), User Secrets (Development only), environment variables (how containers, App Service and Kubernetes inject settings), then command-line arguments. Key Vault or App Configuration added later override all of those. Because the merge is per key, a production file that only sets `Payments:BaseUrl` still inherits `TimeoutSeconds` from the base file, and the real connection string arrives as an environment variable, so it's never in the repo.
- **Keys are flat strings with `:` for nesting** (`Payments:BaseUrl`) and indexes for arrays (`AllowedOrigins:0`). You read them with the indexer, `GetValue<int>(key, default)`, `GetConnectionString` and `GetSection(...).Get<T>()`. Environment variables can't contain `:`, so they use **`__`** (`Payments__BaseUrl`). A single underscore silently matches nothing, and the app quietly falls back to the JSON value. Keys are case-insensitive. The `ASPNETCORE_` and `DOTNET_` prefixes are reserved for host settings.
- **The Options pattern replaces string keys with a typed class.** `config["Payments:TimeoutSeconds"]` with a typo compiles and silently returns null at run time. Binding a section once (`AddOptions<PaymentOptions>().BindConfiguration("Payments").ValidateDataAnnotations().ValidateOnStart()`) gives you type safety, data-annotation validation, tests that use `Options.Create(...)` instead of a configuration system, and classes that see only the settings they need. **`ValidateOnStart`** matters most: a missing API key makes the deployment fail its health check and roll back, instead of failing a real customer's payment hours later.
- **Three options interfaces, differing in *when they see a change*.**
  - `IOptions<T>` is a singleton computed once and never refreshed: right for most settings.
  - `IOptionsSnapshot<T>` is **scoped** and recomputed per request, so one request sees a consistent value and the next sees the change.
  - `IOptionsMonitor<T>` is a singleton whose `CurrentValue` is always the latest, with an `OnChange` callback, for reloadable settings in singletons and background services.

  Injecting `IOptionsSnapshot` into a singleton is a captive dependency, so use the monitor there. What can actually change at run time: JSON files reload on change; environment variables can't change for a running process; Key Vault and App Configuration refresh on the interval you configure.
- **Named options** give several instances of one shape (invoices storage vs images storage: `Configure<StorageOptions>("invoices", …)`, then `monitor.Get("invoices")`). `PostConfigure` adjusts values after binding. The source-generated `[OptionsValidator]` validates without reflection, which suits AOT.
- **Secrets never go in committed files**, and that includes `appsettings.Development.json`. In development, **User Secrets** store JSON in your user profile, outside the repo, loaded only in Development. It isn't encrypted: it protects against `git add`, not against someone on your machine. In production use **Key Vault** through a managed identity (`Payments--ApiKey` becomes `Payments:ApiKey`), platform settings that can reference Key Vault, or Kubernetes secrets. Best of all is **no secret at all**: managed identity to Azure SQL, Storage or Service Bus leaves nothing to leak or rotate.
- **Feature flags separate deploying from releasing.** With Azure App Configuration and `Microsoft.FeatureManagement`, you ship new code dark (deployed but switched off), enable it for 5% of users, watch error rates, and turn it off in seconds if something's wrong, with no redeploy. That makes gradual rollouts, A/B tests and instant kill switches possible.
- **How precedence works internally**: each provider loads its source into a flat dictionary, and `IConfigurationRoot` asks the providers **in reverse order** (last added first) and returns the first value found. That single rule is the whole precedence system. `builder.Configuration` is a `ConfigurationManager`, so sources added during phase 1 are visible to later reads immediately. Other providers: INI, XML, in-memory (handy in tests), key-per-file (mounted Docker/Kubernetes secrets). Binding uses reflection unless you enable the configuration binding source generator.

### 3.4 · Middleware and the request pipeline

[Full chapter →](ch:middleware)

- **Middleware is a chain every request walks through.** Each component can do work before the rest of the pipeline, call `next()` to continue, or **short-circuit** by writing the response itself, and then do work after `next()` returns. Cross-cutting concerns (errors, HTTPS, CORS, auth, compression, correlation IDs, rate limits) are written once, slotted into an explicit order, and switched on with one line. The pipeline is exactly what you wrote, unlike the old hidden `System.Web` pipeline.
- **It's functions wrapping functions.** The core type is `delegate Task RequestDelegate(HttpContext)`, and a middleware is a `Func<RequestDelegate, RequestDelegate>`: given "the rest of the pipeline", it returns a new delegate that wraps it. `app.Use` only appends to a list. `Build()` composes them **in reverse**, starting from a terminal 404 delegate, giving `A(B(C(endpoint)))`, and Kestrel calls the outermost one per request. That's why "before" code runs in registration order and "after" code runs in reverse: each `await next()` is a nested call, still on the stack, waiting for the inner ones to return. It's not a special rule, just how nested calls unwind.
- **Pipeline-building methods**: `Use` (may call next), `Run` (terminal; nothing after it runs), `Map("/path", …)` (branches by path prefix and never rejoins), `MapWhen` (branches on any condition), `UseWhen` (conditionally adds middleware, then rejoins). `app.Map` branches the middleware pipeline; `app.MapGet` registers a routing endpoint. They're unrelated, and you almost always want `MapGet`.
- **Order is behaviour.** The recommended order is forwarded headers, exception handler, HSTS, HTTPS redirection, static files, routing, CORS, authentication, authorization, rate limiting and caching, then endpoints. Each mistake has a signature symptom:
  - authorization before authentication: everyone is anonymous;
  - auth before routing: `[Authorize]` metadata is invisible;
  - exception handler not first: earlier exceptions aren't converted to ProblemDetails;
  - CORS after auth: preflight `OPTIONS` requests get 401, which the browser reports as a "CORS error";
  - static files after auth: every image pays for an auth check;
  - forwarded headers late: HTTPS redirect loops and wrong client IPs;
  - custom middleware that reads `User` placed before authentication: the user is empty.
- **The built-in catalogue** includes forwarded headers, exception handler, status code pages, HSTS, HTTPS redirection, static files and `MapStaticAssets`, routing, localization, CORS, authentication, authorization, antiforgery, the rate limiter, request timeouts, output caching, response caching, compression, session, WebSockets, health checks and HTTP/W3C logging. Many of them short-circuit: HTTPS redirect, static files when a file is found, CORS preflight, authorization 401/403, rate limiter 429, cache hits.
- **Writing your own: three styles, one trap.**
  - **Convention-based** classes (a constructor taking `RequestDelegate`, plus `InvokeAsync(HttpContext, …)`) are constructed **once** at startup, effectively singletons. A scoped service in the constructor is a captive dependency, so scoped services go in `InvokeAsync`'s **parameters**, which are resolved from the request scope on every call.
  - **`IMiddleware`** classes are resolved from DI **per request**, so constructor injection of scoped services is safe, at the cost of one DI resolution per request.
  - **Inline** `app.Use(async (context, next) => …)` is for a few lines you won't reuse. Use the overload where `next` is a `RequestDelegate` you call as `next(context)`. The older `Func<Task>` form had to allocate a closure capturing `context` on every request; this one reuses a single delegate built when the pipeline was assembled.
- **Short-circuiting** is deliberately not calling `next`: auth failures, 429s, cache hits, static files, health pings. `.ShortCircuit()` on an endpoint and `MapShortCircuit(404, "favicon.ico")` skip the remaining middleware entirely.
- **The "response has started" trap.** Once headers are flushed (the body began writing), status and headers are read-only, and changing them throws `Headers are read-only, response has already started`. It only fails *sometimes*, because small responses may still be buffered when your after-`next()` code runs. `Response.OnStarting(callback)` runs at exactly the safe moment; check `Response.HasStarted` before writing an error response; `OnCompleted` runs after the response has gone, which is useful for metrics only. The request body is a forward-only stream, so to read it in middleware call `EnableBuffering()`, read, and reset `Position = 0`. Rewriting the response body means buffering the whole response in a `MemoryStream`, which costs memory and breaks streaming, so prefer built-in compression or caching, or a filter.
- **Middleware vs filters.** Middleware sees raw HTTP (headers, a body stream) and runs for every request at its position. MVC filters and minimal-API **endpoint filters** run **after model binding**, so they see the typed arguments, action context and results. Use middleware for app-wide HTTP concerns, filters for endpoint-specific concerns that need typed inputs (validation, auditing, transactions).
- **Middleware can read endpoint metadata**: after `UseRouting`, `context.GetEndpoint()?.Metadata.GetMetadata<T>()` exposes attributes and `.WithMetadata(...)`. That's how authorization, CORS, rate limiting and output caching know what each endpoint needs, and your own middleware can do the same (for example auditing endpoints marked `[Audit]`). Test middleware with `TestServer`, or by calling `InvokeAsync` directly with a `DefaultHttpContext` and a fake `next`.

### 3.5 · Routing and endpoints

[Full chapter →](ch:routing)

- **Routing turns a method and path into an endpoint**: a `RequestDelegate` bundled with **metadata** (authorization policy, CORS, rate limits, cache policy, OpenAPI info) plus the **route values** extracted from the URL (`id = 42`).
- **Endpoint routing is split in two on purpose.** `UseRouting` **selects** the endpoint and stores it on the `HttpContext`; the endpoint middleware at the end **executes** it. Everything in between (CORS, authentication, authorization, rate limiting, output caching) can read the selected endpoint's metadata before acting. In ASP.NET Core 2.x, MVC routed at the very end, so authorization and CORS couldn't know which action would run. Now one routing system serves controllers, minimal APIs, Razor Pages, SignalR, gRPC and health checks. `WebApplication` inserts `UseRouting` automatically; call it explicitly only to control what runs before matching.
- **Route templates**: literals, `{id}` parameters (bound to handler arguments by name), constraints `{id:int}`, defaults `{page:int=1}`, optional `{term?}` and catch-all `{**path}`. Constraints include the primitive types, `guid`, `datetime`, `alpha`, length and range checks, `regex(...)`, `required` and custom `IRouteConstraint`s. **A failed constraint means "no match", so you get a 404, not a 400**: `/products/abc` against `{id:int}` is Not Found. Use constraints to **disambiguate** routes (`{id:int}` vs `{slug}`), and validate input inside the endpoint, returning 400 there.
- **Route groups** (`app.MapGroup("/api").RequireAuthorization()`) share a prefix and metadata across many endpoints, and groups nest. Metadata **stacks**: an endpoint can add a stricter policy on top of the group's, or opt out with `AllowAnonymous()`.
- **Controllers** use **attribute routing** (`[Route("api/[controller]")]`, `[HttpGet("{id:int}", Name = "GetOrder")]`), which is required for `[ApiController]`. MVC sites with views often use **conventional routing**, where one central pattern (`{controller=Home}/{action=Index}/{id?}`) maps URLs to controllers by naming convention.
- **Metadata is the shared vocabulary**: fluent calls and attributes are two spellings of the same objects. `RequireAuthorization`/`[Authorize]` is read by authorization; `RequireCors`/`[EnableCors]` by CORS; `RequireRateLimiting` by the limiter; `CacheOutput` by output caching; `WithName` by link generation; `WithTags`/`Produces` by OpenAPI; `WithRequestTimeout` by request timeouts; and `WithMetadata(obj)` by your own middleware.
- **Precedence when several routes match**: literals beat parameters, constrained beat unconstrained, complex segments beat simple ones, catch-alls come last, and the HTTP method filters candidates. A true tie throws `AmbiguousMatchException` at run time, and the fix is to make one route more specific. Matching uses a **DFA** (a precompiled state machine built at startup), so cost barely grows with the number of routes.
- **Generate links from route names**, not string concatenation, so URLs survive template changes: `LinkGenerator.GetUriByName(ctx, "GetOrder", new { id })`, plus `CreatedAtRoute`. `LinkGenerator` is a singleton, usable anywhere, including when building email links. `RouteOptions` controls lowercase URLs and trailing slashes, and route values are also available in `Request.RouteValues`.

### 3.6 · Building APIs: minimal APIs, controllers, binding, validation and filters

[Full chapter →](ch:building-apis)

- **Minimal APIs and controllers are two syntaxes over the same machinery**: the same routing, DI, authentication and middleware. Minimal APIs map routes to functions with fluent configuration. They have less ceremony, are slightly faster, support **Native AOT** (through the request delegate generator) and are Microsoft's default for new APIs. Controllers are classes with attributes and offer a richer filter pipeline, extensible model binders and content negotiation (XML and custom formatters). A good interview answer: minimal APIs organised into feature-based route groups for new services, consistency in an existing controller codebase, and controllers when you need MVC filters, conventions, content negotiation or views.
- **Handler shapes**: return a `string` (`text/plain`), any object (JSON), or an `IResult` for full control. Point at static methods (`OrderHandlers.Create`) so they're unit-testable. Keep `Program.cs` readable with `MapOrderEndpoints()` extension methods per feature; Carter and FastEndpoints push this into module or REPR-style (Request-Endpoint-Response) folders.
- **Prefer `TypedResults` over `Results`.** Returning `Task<Results<Ok<OrderDto>, NotFound>>` makes the handler's return type a compiler-checked contract listing every possible response. OpenAPI generation reads it with no extra annotations, and unit tests can `Assert.IsType<Ok<OrderDto>>` instead of executing an opaque `IResult`. Controllers use `ActionResult<T>` with `Ok`, `NotFound`, `CreatedAtAction`, `Problem` and `ValidationProblem`.
- **Parameter binding is inferred, and attributes override it.** Route values bind by name; other simple types come from the query string; one complex type comes from the JSON body; registered types come from DI; special types (`HttpContext`, `ClaimsPrincipal`, `CancellationToken`, `Stream`, `PipeReader`) are injected. You can be explicit with `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromBody]`, `[FromForm]` (and `IFormFile`), `[FromServices]` and `[FromKeyedServices]`. `[AsParameters]` binds a whole record of parameters. Custom types bind automatically if they have a static `TryParse` (or implement `IParsable<T>`) for route and query values, or a static `BindAsync(HttpContext)` for anything that needs the full context.
- **Over-posting**: binding the body straight onto an EF Core entity lets a client set any writable property (`IsAdmin`, `Price`, `CustomerId`), because binding copies whatever matches. Always bind to a **request DTO** with only the allowed fields, and map it explicitly.
- **Validate shape at the edge, keep business rules in the domain.** Shape problems (required, length, range, format) return **400** `ValidationProblemDetails`, an RFC 9457 body with an `errors` dictionary. Data annotations validate automatically for `[ApiController]` controllers, and for minimal APIs since .NET 10 via `builder.Services.AddValidation()`. **FluentValidation** handles rules that need the whole object or a dependency ("at least one line", "this SKU exists"). Business rules ("can't cancel a shipped order") depend on current state, not request shape, so they belong in the domain or application layer and return 409/422. Putting them in validators drags database access and domain knowledge into the edge.
- **Filters see the typed arguments; middleware can't**, because filters run inside endpoint execution, after binding. **Endpoint filters** (`IEndpointFilter`) wrap minimal-API handlers or whole groups, can read `ctx.Arguments` and replace the result. Controllers have a **five-stage MVC filter pipeline**:
  1. authorization filters;
  2. resource filters, which can short-circuit before binding (caching, feature gates);
  3. model binding and validation;
  4. action filters around the action (validation, transactions, argument logging);
  5. exception filters if something threw, then result filters around result execution (headers, wrapping), then the resource filters' after-code.

  Within a type, filters run global → controller → action on the way in and in reverse on the way out, and `Order` adjusts the sequence.
- **JSON uses System.Text.Json**: fast, UTF-8 based, with web defaults of camelCase, case-insensitive reading and numbers accepted as strings. Configure it with `ConfigureHttpJsonOptions` (minimal APIs) or `AddJsonOptions` (controllers). Common needs: `JsonStringEnumConverter`, ignore-null, `[JsonPropertyName]`, naming policies such as snake_case, `[JsonPolymorphic]`/`[JsonDerivedType]` for polymorphism, custom `JsonConverter<T>`, `JsonDocument`/`JsonNode` for unknown JSON, and a source-generated `JsonSerializerContext` for speed and AOT. Never serialize EF entities. Navigation properties create cycles (`Order → Customer → Orders → …`) or huge payloads, and `ReferenceHandler.IgnoreCycles` only hides the symptom while coupling your API to your schema. **Project to DTOs** with `Select`.
- **Formats and streaming**: controllers honour `Accept` through output formatters, while minimal APIs return JSON unless you return another `IResult`. `Results.File` and `Results.Stream` serve files, and `PhysicalFile` adds HTTP range support. `IAsyncEnumerable<T>` streams a JSON array as items arrive instead of buffering everything. `TypedResults.ServerSentEvents` (.NET 10) streams one-way updates.
- **Thin handlers**: an endpoint should only **bind → validate → delegate → map the result to HTTP**. Stock checks, pricing and order rules live in application and domain code that never sees `HttpContext` and can be tested without a web server.

### 3.7 · Error handling, ProblemDetails and logging

[Full chapter →](ch:errors-logging)

- **One failure, two audiences.** The **client** needs a safe, consistent, machine-readable error: the right status, a predictable shape, and **no stack traces**, which help attackers and are useless to legitimate callers. **Developers** need full, searchable detail: the exception, context (user, order ID) and trace. ProblemDetails serves the first, `ILogger` the second. Never mix them up.
- **The exception handler must be the outermost middleware.** Unhandled exceptions propagate outward through the middleware chain, so only the first-registered component can catch everything after it. `AddProblemDetails()`, then `AddExceptionHandler<T>()` for each handler, then `app.UseExceptionHandler()` first in the pipeline, plus `UseStatusCodePages()` so empty 4xx/5xx responses (like a routing 404) get bodies. Development shows the Developer Exception Page with the stack trace; production logs the exception and returns a generic 500.
- **`IExceptionHandler`** (.NET 8) maps exception types to responses. Handlers are tried **in registration order**, and each returns `false` to say "not mine", so register specific handlers (domain → 409, not-found → 404) before a catch-all. Throwing for **expected** outcomes is expensive (stack capture) and hides control flow, so many teams return a Result from the application layer, map it to HTTP in the endpoint, and reserve exception handlers for the truly unexpected.
- **ProblemDetails (RFC 9457, which replaced 7807)** is one JSON shape for every API error, served as `application/problem+json`: `type` (a URI identifying the *kind* of problem), `title`, `status`, `detail` (this occurrence), `instance`, plus extensions such as `traceId`, `errors` or `code`. Every client can then handle every endpoint's errors the same way. Customise all of them centrally with `CustomizeProblemDetails`, and always add a **`traceId`**: it's the bridge that lets a customer's "I got an error" jump you straight to that request's logs and distributed trace.
- **`ILogger<T>` is one API with pluggable providers.** The category is `T`'s full name, which lets you set log levels per namespace through configuration (`"Microsoft.AspNetCore": "Warning"`, `"Shop.Payments": "Debug"`, overridable per environment by environment variable). The levels:
  - `Trace` and `Debug`: diagnostics, off in production;
  - `Information`: normal business milestones;
  - `Warning`: unexpected but handled (retries, declines);
  - `Error`: the current operation failed;
  - `Critical`: a system-wide failure.
- **Structured logging keeps data as fields.** `"Charging order {OrderId}"` is a **message template**: `OrderId` is stored as a named, queryable property in Application Insights, Seq or Elasticsearch, so you can query "all errors for order 1042". An interpolated string (`$"Order {id}"`) produces visually identical text but loses the field, and it formats and allocates **even when the level is disabled** (analyzer CA2254). Use PascalCase placeholder names and the same name everywhere. `{@Order}` destructures objects in Serilog, so watch size and PII.
- **Scopes** attach properties (`OrderId`, `TenantId`) to every log line inside a block, across `await`s. The obvious implementation, a `[ThreadStatic]` field, breaks with async code, because the continuation may run on a thread holding another request's value. `AsyncLocal<T>` attaches the value to the flow of execution: the `ExecutionContext` (which holds all `AsyncLocal` values) is captured when a continuation is scheduled and restored when it runs, on whichever thread. Values flow down into awaited code but don't leak back up to callers. ASP.NET Core opens a scope per request with `RequestId`, `TraceId` and `SpanId`.
- **High-performance logging**: every ordinary log call boxes value arguments into an `object[]` before checking whether anything will be written. **`[LoggerMessage]`** source-generates strongly typed methods that check `IsEnabled` first, avoid boxing and pre-parse the template, so a disabled level costs almost nothing (analyzer CA1848). For expensive arguments, wrap the call in `if (logger.IsEnabled(...))`.
- **Destinations**: built-in console, debug and EventSource providers; **OpenTelemetry** (`WithLogging()`, exported over OTLP alongside traces and metrics); Application Insights through the Azure Monitor OpenTelemetry distro; **Serilog**, with rich sinks and enrichers, and NLog. In containers, log **JSON to stdout** and let the platform ship it, just as the app doesn't own its secrets on disk. `AddHttpLogging` logs requests, but choose fields deliberately, because headers and bodies contain tokens and personal data.
- **What to log**: business events with IDs, exceptions *with the exception object*, external calls (target, duration, outcome), retries and circuit-breaker changes, and a non-secret startup summary. Never log passwords, tokens, keys, connection strings, card data, unnecessary PII, full bodies or `Authorization` headers. Log a failure **once**, where it's handled, not at every layer it passes through. Don't log cancellations as errors. Log IDs rather than whole objects. Use `Microsoft.Extensions.Compliance.Redaction` for classified data. Correlate across services with W3C trace context (`traceparent`), which flows automatically through `HttpClient` with OpenTelemetry.

### 3.8 · Authentication and authorization

[Full chapter →](ch:auth)

- **Authentication asks "who are you?"; authorization asks "are you allowed?".** Authentication reads a cookie, bearer token, API key or certificate and produces a `ClaimsPrincipal` in `HttpContext.User`; failing it gives a **401** through a *challenge*. Authorization evaluates the user, the resource and the action; failing it gives a **403** through *forbid*. They run as separate middleware: authentication, then authorization (which reads the endpoint's policy metadata).
- **A user is a bag of claims**: key/value facts from a trusted issuer (`sub`, `email`, `role`, `scope`, `tenant_id`) inside a `ClaimsIdentity`, inside a `ClaimsPrincipal`. A **role is just a claim** of type `role`. Because identity is a flat bag of claims, the rest of the app works identically whether they came from your cookie, an Entra ID JWT or your own API-key handler.
- **Schemes are named handlers**, registered with `AddAuthentication(default).AddJwtBearer().AddCookie().AddOpenIdConnect().AddScheme<…>()`. Every handler implements up to five actions: **Authenticate** (build a principal from the request), **Challenge** (JWT: 401 with `WWW-Authenticate`; cookie: redirect to login; OIDC: redirect to the identity provider), **Forbid**, **SignIn** and **SignOut**. That's why "login" means different things for cookie apps and APIs.
- **Cookies vs JWTs, and why the risks trade places.** Browsers send cookies **automatically**. That's convenient, but it means a malicious site can trigger requests carrying them (**CSRF**), so cookies need `SameSite` and antiforgery tokens. An `HttpOnly` cookie can't be read by JavaScript, so XSS can't steal it, and cookies are easy to revoke. JWTs are attached **explicitly** by client code, so there's no CSRF, but JavaScript must be able to read them, so an XSS hole can steal them, and they stay valid until they expire. For browser SPAs, the recommended answer is the **BFF** pattern: a small server-side app runs the OIDC flow and keeps tokens server-side, and the browser holds only a secure `HttpOnly` `SameSite` cookie.
- **A JWT is `header.payload.signature`, base64url-encoded.** The payload holds claims: `iss` (issuer), `sub`, `aud` (which API it's for), `exp`/`nbf`/`iat`, `scp` (delegated scopes), `roles` and `azp` (the client). Validation needs **no call to the issuer per request**:
  1. Read the key ID (`kid`) from the header.
  2. Fetch the issuer's **public keys** from its OIDC discovery document (`jwks_uri`), cached.
  3. **Verify the signature**: only the issuer has the private key, so a valid signature proves who issued it and that nobody altered it.
  4. Check `iss`, `aud` (this API, not another API from the same provider) and `exp`/`nbf`, with about 5 minutes of clock skew.
  5. Build the principal from the claims.

  `MapInboundClaims = false` keeps short claim names like `sub`. JWTs are **signed, not encrypted**: anyone can read the payload, so never put secrets in one. Don't mint `HS256` tokens with a shared secret, because every API that validates would also hold a key that can *forge* tokens for every other service. Use an identity provider with asymmetric keys.
- **Token lifetimes**: nothing in validation checks a revocation list, so a stolen access token works until it expires. That's why access tokens live 5–60 minutes and **refresh tokens** (long-lived, stored securely, rotated on use) get new ones. To revoke, keep lifetimes short, revoke the refresh token at the identity provider, and use introspection or a deny list for high-risk APIs.
- **Cookie authentication** (`LoginPath`, `ExpireTimeSpan`, sliding expiration, `HttpOnly`, `Secure`, `SameSite`) encrypts the ticket with **Data Protection**. When you scale out, each instance generates its own keys by default, so a cookie from instance A is unreadable on instance B and users are randomly logged out. Persist the key ring to shared storage (Blob, Redis, a database) protected by Key Vault. Antiforgery tokens have the same requirement.
- **ASP.NET Core Identity** is a membership library: password hashing (PBKDF2), lockout, 2FA, email confirmation, external logins and roles, stored with EF Core, plus `MapIdentityApi` endpoints (.NET 8). It is **not an OAuth/OIDC server**. For single sign-on, third-party clients and OAuth flows, use Entra ID, Auth0, Okta or Keycloak, or Duende IdentityServer or OpenIddict on top of Identity.
- **Authorization basics**: `RequireAuthorization()`, `[Authorize]`, `AllowAnonymous` and roles. Secure by default with a **fallback policy** (`SetFallbackPolicy(RequireAuthenticatedUser)`), so a forgotten attribute means a locked endpoint rather than a silent data leak.
- **Policies** name rules once (`"CanRefund"` = role `support` plus claim `refund_limit`), so endpoints refer to the name instead of copying role checks. A policy is a set of **requirements**, and all must pass. Custom requirements get `AuthorizationHandler<TRequirement>` implementations, which are ordinary DI services, so they can query the database. A requirement passes if **any** handler calls `Succeed`, and any handler calling `Fail` vetoes it.
- **Resource-based authorization** handles rules that depend on *which row* ("your own orders only"): load the resource, then call `IAuthorizationService.AuthorizeAsync(user, order, requirement)` with an `AuthorizationHandler<TRequirement, Order>`. Return **404 instead of 403** for someone else's order, because a 403 confirms the order exists. This is the standard defence against **IDOR** (insecure direct object references), one of the most common real API vulnerabilities.
- **Other schemes**: custom API-key handlers (`AuthenticationHandler<T>`; compare **hashed** keys in constant time), mTLS client certificates for service-to-service, managed-identity tokens for Azure-to-Azure, and **policy schemes** (`ForwardDefaultSelector`) to choose a scheme per request. **Claims transformation** (`IClaimsTransformation`) enriches the principal with app-specific permissions on **every** authentication, so it must be cheap or cached, or you've added a database call to every request.

### 3.9 · Calling other services: HttpClient and IHttpClientFactory

[Full chapter →](ch:http-client)

- **`HttpClient` is a thin front end over a chain of message handlers.** Your `DelegatingHandler`s sit in the middle, and at the far end the **primary handler** (`SocketsHttpHandler`) owns the expensive parts: TCP connections, TLS and the **connection pool**. Both classic bugs come from misjudging which part is expensive.
- **Bug 1: a new `HttpClient` per call means socket exhaustion.** Each instance brings a new handler and connection pool, so every call pays a fresh TCP and TLS handshake. Disposing doesn't free the socket immediately either: the closing side must sit in `TIME_WAIT` for about 2–4 minutes, so under load thousands of sockets pile up until ephemeral ports run out ("Only one usage of each socket address…").
- **Bug 2: one static `HttpClient` forever means stale DNS.** Its connections are reused indefinitely and DNS is never re-resolved, so after a blue/green switch or failover it keeps calling the old IP.
- **The fixes**: **`IHttpClientFactory`** pools handlers and **recycles** them (every 2 minutes by default), so connections are reused while DNS changes are still picked up, and it integrates configuration, DI, logging and resilience. For simple apps and libraries, a long-lived client with `SocketsHttpHandler.PooledConnectionLifetime` works too.
- **Named vs typed clients.** Named clients are configured under a name and created with `factory.CreateClient("github")`. **Typed clients** (preferred) are classes that receive a configured `HttpClient` in their constructor and expose a domain API (`GetStockAsync(sku)`). They're registered transient, because the expensive part is the recycled handler underneath. **Never capture a typed client in a singleton**: its handler is then never recycled, which brings back stale DNS. Inject typed clients into transient or scoped services, or inject the factory into the singleton.
- **`DelegatingHandler`s are outbound middleware**: each wraps the next and calls `base.SendAsync`. Typical uses: attaching access tokens (cached client-credentials tokens), propagating correlation and tenant headers, logging, caching and request signing. Resilience (retries, circuit breakers) is also a handler, which is why `.AddStandardResilienceHandler()` slots into the chain. W3C `traceparent` propagation is automatic.
- **Timeouts and cancellation.** `HttpClient.Timeout` defaults to **100 seconds**, far too long for most APIs. A timeout surfaces as `TaskCanceledException` with an inner `TimeoutException`, which is how you tell it apart from caller cancellation (`ct.IsCancellationRequested`). Always pass the incoming request's token. With a resilience handler, rely on its total and per-attempt timeouts, and raise `HttpClient.Timeout` so it doesn't compete with them.
- **Response handling**: dispose every `HttpResponseMessage`, because with `ResponseHeadersRead` the connection only returns to the pool when you do. Use `ResponseHeadersRead` to stream large bodies. Switch on status codes (404 → `null`, 429 → honour `Retry-After`). Don't call `EnsureSuccessStatusCode` reflexively, because it throws away the `ProblemDetails` body the server sent.
- **Generated clients**: Refit (an interface plus attributes, implemented by a source generator), Kiota and NSwag (generated from OpenAPI), and gRPC clients (from `.proto`). **Service discovery** (`https+http://inventory` with `Microsoft.Extensions.ServiceDiscovery`) resolves logical names at run time in Aspire and Kubernetes. **Testing**: construct the typed client with an `HttpClient` over a stub `HttpMessageHandler` (don't mock `HttpClient` itself), or run WireMock.Net for realistic HTTP.

### 3.10 · Caching, rate limiting, CORS and compression

[Full chapter →](ch:caching-ratelimit-cors)

- **Every caching decision starts with "how stale can this be?"** A checkout price: seconds, or no cache at all. A product description: minutes to hours. A country list: days. Decide this per data type before picking a technology. Caching buys latency (microseconds instead of milliseconds), less load and resilience to slow dependencies; it costs staleness, invalidation logic, memory and cross-instance consistency.
- **The layers**: browser and CDN (driven by `Cache-Control` and `ETag`), server **output caching** (whole responses), then app data caches.
  - **`IMemoryCache`** stores objects in-process: the fastest, but **per instance**. Three instances means three independent copies that can disagree, so a user can see a new price on one request and the old one on the next.
  - **`IDistributedCache`** (Redis, SQL, Cosmos) is shared and survives restarts, but stores **bytes** (you serialize) and costs a network hop on **every** access.
  - **`HybridCache`** (.NET 9) puts a fast in-memory **L1** in front of a shared **L2**, handles serialization, adds **stampede protection** and **tag-based invalidation**, and should usually be the default. Set the L1 expiration shorter than L2 so no instance's local copy is stale for longer than you accept.
- **Expiration types**: **absolute** guarantees maximum staleness; **sliding** keeps hot items alive (combine it with absolute so they still refresh); size limits and priorities drive eviction; change tokens evict on a signal.
- **Strategies**:
  - **cache-aside** (check, load on miss, store; on write, update the database and **remove** the key);
  - read-through;
  - write-through (always fresh, slower writes);
  - write-behind (fast writes, risk of loss);
  - refresh-ahead;
  - TTL-only.

  Invalidate by removing on write, by events (`ProductChanged` makes every instance evict), by tags or versioned keys (`product:v7:42`), with short TTLs as the safety net.
- **Delete on write, don't overwrite.** If two writers update concurrently and each writes its new value into the cache, the slower writer's older value can land last and stay cached until the TTL. Deleting forces the next reader to load the latest committed state.
- **Cache stampede**: a hot key expires under heavy traffic and hundreds of concurrent misses all recompute it at once (the thundering herd). Defences: **request coalescing**, where one caller computes and the rest await the same result (`HybridCache` does this; `IMemoryCache.GetOrCreate` does **not**); jittered expirations, so keys cached together don't expire together; refresh-ahead; and serving stale data while refreshing in the background. Cache reference data, catalogues, aggregates, permission lookups and external API responses. Don't cache cheap indexed primary-key lookups, strongly consistent data (balances, checkout stock) or personal data in a shared cache without per-user keys.
- **Output caching** stores whole endpoint responses by path, query or route values, with tags for eviction and Redis available as shared storage. By default it **only caches anonymous GET/HEAD 200 responses without cookies**, so one user's personalised page can never be served to another. **Response caching** is the older middleware that follows `Cache-Control` semantics. For client and CDN caching, set headers, and use ETags with `If-None-Match` so unchanged resources return 304.
- **Rate limiting** (built in since .NET 7) protects against abuse, runaway clients and scraping, and enforces pricing tiers. The algorithms:
  - **fixed window**: simple, but allows double bursts at window edges, e.g. 100 requests at the end of one window and 100 at the start of the next;
  - **sliding window**: segments the window to smooth that edge;
  - **token bucket**: allows bursts up to the bucket size while keeping a steady average rate;
  - **concurrency**: caps requests in flight, to protect expensive endpoints.

  Policies are partitioned per user, IP or API key and return 429 with `Retry-After`. **Counters are per instance**, so "100/minute" on 5 instances is effectively 500/minute. Enforce strict global limits at the gateway (API Management, Front Door) or with a Redis-backed limiter. Behind a proxy, configure forwarded headers, or "per IP" means one bucket for the proxy.
- **CORS protects browsers, not your API.** The same-origin policy stops JavaScript on `https://shop.com` from reading responses from `https://api.shop.com` (a different origin: scheme, host and port together) unless the API sends `Access-Control-Allow-*` headers. curl and server-to-server calls ignore CORS entirely, so authentication is your API's real protection. **Simple requests** go straight out and only the response is checked. **Preflighted** requests (PUT/DELETE, JSON bodies, an `Authorization` header) first send an `OPTIONS` asking permission. Mistakes:
  - `AllowAnyOrigin` with `AllowCredentials` is rejected by browsers, and reflecting any `Origin` with credentials lets any site act as the user;
  - `UseCors` after authentication 401s the credential-less preflight, which surfaces as a "CORS error";
  - a plain 500 without CORS headers *also* looks like a CORS error, so read the server logs first.
- **Response compression** (Brotli, gzip) is often better done once at the proxy or CDN than in every app instance. Compressing HTTPS responses that mix secrets with user input carries **BREACH** risk. Request timeouts (`UseRequestTimeouts`) cancel slow requests per endpoint policy.

### 3.11 · Background work: hosted services, workers, channels and schedulers

[Full chapter →](ch:background-work)

- **Work that shouldn't make a request wait** falls into three shapes: deferred (emails, PDFs, image resizing, slow third parties, usually answered with **202 Accepted** plus a status URL), scheduled (nightly cleanup, hourly syncs) and continuous (queue consumers, outbox processors).
- **`IHostedService`** is the host's contract: `StartAsync` at startup and `StopAsync` at graceful shutdown. Kestrel itself is one of these. **`BackgroundService`** implements it for the common shape: write one `ExecuteAsync(stoppingToken)` loop, often with `PeriodicTimer.WaitForNextTickAsync(stoppingToken)`.
- **Facts and the pitfalls they create**:
  - Hosted services are **singletons**, so create a scope **inside the loop** for each unit of work (`IServiceScopeFactory.CreateAsyncScope()`) and never inject scoped services directly (captive dependency).
  - `StartAsync` calls are awaited **in order before the app serves traffic**, and `BackgroundService.StartAsync` only returns at `ExecuteAsync`'s first real `await`, so synchronous work at the top of `ExecuteAsync` blocks startup. Add `await Task.Yield()` first.
  - An unhandled exception in `ExecuteAsync` **stops the whole host** (since .NET 6, `BackgroundServiceExceptionBehavior.StopHost`), so catch and log inside the loop.
  - Honour `stoppingToken` within `ShutdownTimeout`.
  - **Every instance runs its hosted services**, so with 3 replicas the "nightly job" runs 3 times.
  - In-memory work is lost when the process dies.

  `ServicesStartConcurrently` (.NET 8) starts hosted services in parallel, and `IHostedLifecycleService` adds Starting/Started/Stopping/Stopped hooks.
- **Worker Services** are the Generic Host with hosted services and **no web server**, with the same configuration, logging, DI and graceful shutdown. They run as containers, Windows Services or systemd units. The common split is **Shop.Api** (HTTP plus writing to an outbox) and **Shop.Worker** (queue consumers, outbox publisher, schedules), sharing the inner projects but scaling independently, so slow jobs never steal request threads.
- **`Channel<T>` hands work off within one process**: an async producer/consumer queue. Prefer **bounded** channels with `FullMode = Wait`, which gives **backpressure**: when the queue is full, producers wait instead of memory growing without limit. Everything in a channel is **lost** on deploy, crash or scale-in, so use it only for work you can lose or redo (thumbnails, cache warm-ups). For emails, payments or anything important, **persist first** (database, outbox, broker), then process.
- **Durable job systems**: **Hangfire** (fire-and-forget, delayed, recurring cron jobs and continuations, SQL or Redis storage, a built-in dashboard, automatic retries, workers on any instance) and **Quartz.NET** (jobs plus triggers and calendars, clustered through database locks). Because retries are automatic, jobs **will** run more than once, so they must be **idempotent**: no duplicate invoices.
- **Choosing where work runs**: losable work goes to a channel and hosted service. Durable work within one service goes to Hangfire, Quartz or an outbox table with a worker. Work other services must react to goes to a message broker. Spiky or scale-to-zero work goes to Azure Functions or Container Apps jobs. Simple periodic work on a single instance goes to a `BackgroundService` with `PeriodicTimer`, plus a lock if it's replicated.
- **Running a job once across replicas**: take a **distributed lock or lease** (SQL `sp_getapplock`, Redis `SET NX PX`, a Blob lease, the `DistributedLock` package) and skip the run if another instance holds it; deploy a dedicated single-replica scheduler; use a clustered scheduler (Hangfire, Quartz); use a platform scheduler (Kubernetes CronJob, Container Apps jobs, a Functions timer trigger, which is a singleton by default); or for continuous work, **competing consumers** on a queue, where each message goes to exactly one instance anyway. Fire-and-forget `Task.Run` in a controller is broken: untracked on shutdown, exceptions unobserved, and it uses disposed request services.

### 3.12 · API design: REST, HTTP semantics, versioning and OpenAPI

[Full chapter →](ch:api-design)

- **REST** means resources (nouns in URLs) manipulated through standard HTTP methods, with stateless requests (each carries its own auth and parameters), cacheable responses and negotiated representations. Strict REST also includes **HATEOAS** (responses link to the next possible actions), which few real APIs implement. The **Richardson Maturity Model** grades this: level 0 is RPC over one POST endpoint, level 1 adds resources, level 2 adds proper verbs and status codes (where good APIs sit), and level 3 adds hypermedia.
- **Safe and idempotent are promises, and retries depend on them.** **Safe** (GET, HEAD, OPTIONS) means no state change, which is why browsers, crawlers and CDNs call GETs speculatively. **Idempotent** (GET, PUT, DELETE, plus the safe ones) means calling it N times has the same *effect* as calling it once, though the response may differ (a second DELETE may return 404). That's exactly what lets clients, proxies and resilience policies **retry automatically** after a timeout. POST and PATCH aren't idempotent by default, which is why POST needs idempotency keys.
- **Status codes**:
  - success: 200 OK, 201 Created (with `Location`), 202 Accepted (async work, with a status URL), 204 No Content;
  - redirects and caching: 301/308 moved (308 keeps the method), 304 Not Modified;
  - client problems: 400 (malformed or validation errors), **401** (not authenticated), **403** (authenticated but not allowed), 404, 405, 406/415 (content negotiation), **409** (a state conflict: duplicate, business rule or concurrency), **412** (`If-Match` failed), 422 (well-formed but semantically invalid; some teams use it for validation), **429** (rate limited, with `Retry-After`);
  - server problems: 500 (a bug), 502/503/504 (upstream failure, overload, upstream timeout).

  Pick one convention, 400 or 422 for validation, and apply it everywhere, so clients know once which errors are pointless to retry. Errors are ProblemDetails.
- **URL design**: plural nouns, kebab-case paths, one level of nesting (`/customers/7/orders`). Model **actions as resources** (`POST /orders/42/cancellation`) instead of verbs in URLs (`/cancelOrder`). IDs should be opaque, timestamps ISO 8601 UTC, money `{ "amount": "19.99", "currency": "EUR" }` (a decimal string or minor units, never a float), and enums strings.
- **Never return unbounded lists.** **Offset** pagination (`OFFSET 40 FETCH 20`) can jump to any page, but the database still walks and discards every skipped row, so deep pages get slower, and items shift between pages when data changes. **Keyset/cursor** pagination (`WHERE Id > @lastId ORDER BY Id`) asks the index directly: constant time at any depth and stable results, but no jumping to page N. Use it for feeds, infinite scroll, large tables and sync APIs. **Whitelist** sortable and filterable fields: building `OrderBy` from a client string risks injection and full-table scans on unindexed columns. Cap the page size server-side, and always add a unique tie-breaker (`ThenBy(Id)`), or rows that tie on the sort column can be duplicated or skipped across pages.
- **PUT vs PATCH**: PUT replaces the whole representation (omitted fields reset), which is what makes it idempotent. PATCH sends only changes, as **JSON Merge Patch** (RFC 7396: a partial object, where `null` removes) or **JSON Patch** (RFC 6902: a list of operations, precise and array-aware). For business operations, task-based endpoints (`POST …/cancellation`, `POST …/shipments`) express *actions* rather than data mutations, which fits a domain model much better.
- **Idempotency keys make POST safe to retry.** A client that times out on a payment can't know whether it succeeded, so retrying risks charging twice. The client sends an `Idempotency-Key` header. The server stores the key with the original response, and a repeat replays that stored response instead of re-executing. Three details each prevent a specific failure: keys expire (TTL) so the store doesn't grow forever; reusing a key with a **different** payload returns 422; and the "begin" step is **atomic** (a unique constraint), not check-then-insert, so two concurrent retries can't both pass.
- **ETags prevent lost updates.** `GET` returns `ETag: "v7"`. `PUT` with `If-Match: "v7"` succeeds only if nobody has saved since; otherwise it returns **412** and the client reloads. The ETag is EF Core's `rowversion` concurrency token exposed over HTTP. `If-None-Match` on GET returns a bodyless 304 when unchanged, saving bandwidth.
- **Long-running operations** return **202 Accepted** with a `Location` pointing at an operation resource and a `Retry-After`. The client polls until it gets 303 See Other to the result (or `status: succeeded` with a result URL). Webhooks, SignalR or SSE replace polling when it's too chatty.
- **Versioning is about not breaking promises.** Breaking changes: removing or renaming fields or endpoints, changing types or meaning, making optional input required, changing status codes clients branch on. Additive optional fields aren't breaking, *if* clients ignore unknown fields, so say that in your docs. Strategies: URL segment `/v2` (visible, most common), query string `?api-version=` (Azure's style), a header, or a media type. `Asp.Versioning.Http` implements them. Have a deprecation policy: announce it, send `Deprecation`/`Sunset` headers, monitor traffic per version, then remove.
- **OpenAPI** is the machine-readable contract (endpoints, schemas, responses, auth) that enables interactive docs, client generation (Kiota, NSwag), contract tests, gateway import and **breaking-change detection in CI** by diffing specs. .NET 9+ builds it in (`AddOpenApi`, `MapOpenApi`) with Scalar or Swagger UI; Swashbuckle was the earlier default. **Code-first** generation dominates in .NET because `TypedResults` make the code an accurate, compiler-checked source of truth. **Design-first** writes the spec first and generates from it.

### 3.13 · The other app models: gRPC, SignalR, MVC, Razor Pages and Blazor

[Full chapter →](ch:app-models)

- **One host, many endpoint types.** The same `WebApplication` (host, DI, middleware, routing) can serve JSON APIs, gRPC, SignalR hubs, Razor Pages, Blazor and health checks side by side, because they're all just endpoint types on the shared plumbing. Choose by job: public APIs and SPAs → REST; internal service calls and streaming → gRPC; server push → SignalR; server-rendered forms → Razor Pages or MVC; a rich interactive UI in C# → Blazor; client-shaped queries over a data graph → GraphQL (Hot Chocolate).
- **gRPC** assumes both ends are code you control, so it can be **contract-first** (a `.proto` file generates server base classes and clients), **binary** (Protobuf: smaller and faster to parse than JSON), on **HTTP/2** with built-in client, server and bidirectional **streaming**. Browsers can't speak raw gRPC (it needs HTTP/2 trailers), so it stays internal, with gRPC-Web or **JSON transcoding** for browser access. The golden rule: **field numbers are the contract**, not names. Add fields with new numbers, never reuse or renumber, and mark removed ones `reserved`. Protobuf skips unknown fields, which is what lets old and new clients interoperate.
- **SignalR** is for when the **server speaks first**: order shipped, new chat message, live dashboard. It negotiates the best transport (WebSockets, then Server-Sent Events, then long polling). **Hubs** expose methods to clients and can call methods on them; strongly typed hubs use `Hub<IOrderClient>`. You can address all clients, a connection, a **user** (all their tabs) or **groups**. Push from anywhere, such as a message consumer or background service, through `IHubContext<THub, TClient>`. **Scale-out problem**: each server only knows its own connections, so a message sent on server A can't reach a client connected to server B. Fix it with a **Redis backplane** or **Azure SignalR Service** (which holds all connections centrally); self-hosted WebSockets behind a load balancer also need sticky sessions.
- **MVC and Razor Pages** render HTML on the server with **Razor** (C# mixed into markup). MVC splits controllers and views and uses conventional or attribute routing. Razor Pages pairs each `.cshtml` with a `PageModel` and routes by file path, which is simpler for form-centred apps. Both share tag helpers, layouts, partials, view components, model binding, validation and antiforgery. **Post-Redirect-Get**: a successful POST redirects, so refreshing doesn't resubmit the form. Because browsers submit real forms with cookies, these apps use **cookie auth plus antiforgery tokens** (added automatically by form tag helpers) to defend against **CSRF**, where a malicious site makes your logged-in browser submit a form to the real site.
- **Blazor** builds interactive UIs from C# Razor components, and the key question is *where the C# runs*. Since .NET 8 you choose a **render mode** per component or per app:
  - **Static SSR**: HTML rendered once on the server; fastest, SEO-friendly, forms still work.
  - **Interactive Server**: events and UI diffs travel over a **SignalR** connection. The download is small and you have full .NET on the server, but every interaction has latency, each user holds server memory, and it needs a persistent connection plus SignalR's scale-out fix.
  - **Interactive WebAssembly**: the .NET runtime runs in the browser. It works offline and scales like a SPA, at the cost of a larger first download and calling APIs over HTTP.
  - **Interactive Auto**: server first, switching to WebAssembly once it's downloaded.

  MAUI Blazor Hybrid reuses the same components in native apps. (A full part on MVC and Blazor is coming.)
- **Others**: GraphQL via Hot Chocolate (exact-field queries over one endpoint; hard to cache over HTTP, needs query cost limits, and has an N+1 risk solved by DataLoaders), OData (`$filter`/`$select`/`$expand` over `IQueryable`), raw WebSockets, Server-Sent Events (`TypedResults.ServerSentEvents`, .NET 10) and health-check endpoints.

## Part IV · Data Access

Layer 5: where data lives and how to get it efficiently. Most real performance problems end up here.

### 4.1 · Relational database fundamentals

[Full chapter →](ch:relational-fundamentals)

- **Tables link through keys.** A primary key uniquely identifies a row; a foreign key references another table's primary key and enforces **referential integrity**; unique and check constraints enforce rules at the data level. Prefer **surrogate** primary keys (generated IDs) plus unique constraints on natural keys like email. One-to-many puts a foreign key on the "many" side; one-to-one uses a unique foreign key; many-to-many needs a **join table**.
- **Normalisation stores each fact once**, so changing it is one `UPDATE`. Duplicating a customer's name across 500 order rows invites an update that misses one, leaving a contradiction. 1NF means atomic values; 2NF means every non-key column depends on the *whole* key; 3NF means no column depends on another non-key column. **Denormalisation** deliberately duplicates for read speed (a stored `Order.Total`, a read-model table) when reads vastly outnumber writes and you've decided how to keep the copies in sync. **Snapshot data isn't duplication**: an order line's price at purchase is a different fact from the product's current price.
- **SQL you must be able to write**: filtering, sorting and paging (`OFFSET … FETCH`), `GROUP BY` with `HAVING`, CTEs, `CASE`, `COALESCE`, `EXISTS` vs `IN`, `UNION ALL` (which skips `UNION`'s duplicate-removing sort), and joins: inner, left (unmatched right side becomes NULL), full, cross (Cartesian product) and self joins.
- **Indexes turn scans into seeks.** Without one, finding rows means reading every row: fine at hundreds of rows, about 4 seconds instead of 2 ms at fifty million, and the most common cause of slow-endpoint tickets. An index is a sorted **B+tree**, so lookups are O(log n). In SQL Server, the **clustered** index *is* the table, stored in key order (one per table, usually the primary key). **Non-clustered** indexes are separate trees pointing back at the clustered key, so each row found needs a **key lookup** for any column the index lacks, unless `INCLUDE` makes it **covering**.
- **Index design rules**:
  - index columns used in WHERE, JOIN, ORDER BY and GROUP BY on large tables, including foreign keys;
  - in composite indexes, put **equality columns first, then range or sort columns**;
  - make hot queries covering with `INCLUDE`;
  - prefer selective columns, and use a filtered index (`WHERE IsDeleted = 0`) instead of indexing a boolean;
  - remember every index slows every write.

  The **leftmost-prefix rule** follows from the physical sort order. `(CustomerId, CreatedAt)` is sorted by customer, then by date within each customer, like a phone book sorted by surname then first name. It answers "this customer" and "this customer after this date", but not "everyone after this date", just as a phone book can't find everyone named John.
- **Sargability**: the raw column must be compared directly for a seek to work. `YEAR(CreatedAt) = 2026` (a function on the column), `LIKE '%board'` (a leading wildcard) and implicit type conversions all force scans, because the engine must compute the expression for every row. Rewrite as a range (`CreatedAt >= '2026-01-01' AND CreatedAt < '2027-01-01'`).
- **The clustered key should be narrow, unique, static and ever-increasing.** An increasing key always inserts at the end of the B-tree, which is cheap. A random `Guid` inserts mid-tree, causing **page splits** and fragmentation, and its 16 bytes widen every non-clustered index. Use `IDENTITY`, sequential GUIDs (`NEWSEQUENTIALID`, EF Core's default for SQL Server, or **`Guid.CreateVersion7()`** in .NET 9, which is time-ordered), or keep a GUID primary key non-clustered.
- **Execution plans** show the optimiser's decisions, which it bases on **statistics** about how data is distributed:
  - Index Seek: good;
  - Scan: bad on big tables;
  - Key Lookup: fix with `INCLUDE`;
  - join algorithms: nested loops, hash, merge;
  - Sort: may spill to tempdb;
  - implicit conversion warnings.

  Use SSMS actual plans, `SET STATISTICS IO, TIME`, Query Store for regressions, and `EXPLAIN (ANALYZE, BUFFERS)` in Postgres. **Parameter sniffing**: SQL Server caches a plan built for the *first* parameter values it saw. A plan optimised for a customer with one order is then reused for a customer with a million and performs terribly. Fixes: `OPTION (RECOMPILE)`, `OPTIMIZE FOR`, better indexes, Query Store plan forcing, or Parameter Sensitive Plan optimisation (SQL Server 2022).
- **ACID transactions**: **Atomicity** (all or nothing: a crash between debit and credit can't lose money), **Consistency** (constraints hold), **Isolation** (concurrent transactions don't see each other's partial work, to a chosen degree) and **Durability** (committed data survives crashes, through the write-ahead log). EF Core wraps each `SaveChanges` in a transaction; explicit ones are for spanning several calls or mixing in raw SQL. **Keep transactions short**, and never wait on HTTP or user input inside one, because every lock is held until commit.
- **Isolation levels choose which anomalies you accept in exchange for less blocking.** The anomalies:
  - **dirty read**: seeing another transaction's uncommitted data;
  - **non-repeatable read**: the same row read twice gives different values;
  - **phantom**: a range query gains new rows;
  - **lost update**: two read-modify-writes, one overwrites the other;
  - **write skew**: disjoint writes that together break a rule, like two doctors both going off call.

  The levels:
  - Read Uncommitted allows dirty reads.
  - **Read Committed** is the default in SQL Server (locking) and Postgres (MVCC).
  - **RCSI** (read committed snapshot) gives readers the last committed version, so **readers don't block writers**; it's Azure SQL's default.
  - Repeatable Read holds shared locks until commit.
  - **Snapshot** gives a transaction-consistent versioned view and raises update conflicts.
  - **Serializable** behaves as if transactions ran one at a time, using range locks, with the most blocking.

  `NOLOCK` is not a performance fix: it can return uncommitted data and **skip or double-read rows** during page splits. RCSI or Snapshot give non-blocking reads correctly.
- **Locks and deadlocks.** Writers take exclusive locks and readers shared ones (row, page or table, escalating as needed). **Blocking** is waiting for a lock. A **deadlock** is a cycle: transaction A holds row 1 and wants row 2 while B holds row 2 and wants row 1. Waiting can never resolve it, so the database kills a victim (SQL Server error **1205**), which you **retry**. Prevent deadlocks by touching rows in a consistent order, keeping transactions short, indexing so updates lock fewer rows, using RCSI, and enabling automatic retries (EF Core's `EnableRetryOnFailure`). **Pessimistic locking** (`WITH (UPDLOCK, ROWLOCK)` or `SELECT … FOR UPDATE`) is for cases like seat reservation where no race is tolerable; web apps usually prefer **optimistic** version columns, which hold no locks across client round trips.
- **Connection pooling**: opening a physical connection (TCP, TLS, authentication) is expensive, so providers keep a pool per connection string. `Open` borrows and `Dispose` returns, with a default maximum of 100 in SqlClient. "Timeout expired… obtaining a connection from the pool" comes from undisposed connections or contexts, long transactions, slow queries, sync-over-async holding connections while blocked, or more parallel work than the pool can serve. Open late, close early.
- **SQL Server vs PostgreSQL**: SqlClient vs Npgsql drivers. Locking with optional row versioning vs MVCC by default. Columnstore, temporal tables and Query Store vs JSONB, arrays, `ON CONFLICT` and extensions like PostGIS and pgvector. Commercial vs open source. EF Core hides most differences for CRUD, but tuning details differ.

### 4.2 · ADO.NET and Dapper

[Full chapter →](ch:ado-dapper)

- **ADO.NET is the layer everything else sits on**: `DbConnection` (pooled), `DbCommand` (SQL or stored procedure plus parameters), `DbDataReader` (fast forward-only streaming), `DbParameter`, `DbTransaction` and, since .NET 7, `DbDataSource` (a connection factory). Each database provides implementations (`SqlConnection`, `NpgsqlConnection`). Use `Microsoft.Data.SqlClient`, not the legacy `System.Data.SqlClient`. `ExecuteReader` returns rows, `ExecuteScalar` returns one value, and `ExecuteNonQuery` returns rows affected.
- **Always parameterise.** Concatenating input (`WHERE Email = '{email}'`) is SQL injection: `' OR 1=1 --` becomes part of the SQL. Parameters are sent as **data**, never parsed as SQL, and they let the database **reuse cached plans**, while concatenated literals compile a new plan for every value. Prefer typed `Add` over `AddWithValue` to avoid type-inference problems (and implicit conversions that kill seeks).
- **Transactions**: `BeginTransactionAsync(isolationLevel)`, then pass the transaction to every command, commit, or roll back on failure. `TransactionScope` gives ambient transactions but **silently escalates to MSDTC distributed transactions** when more than one connection is involved, which most cloud setups can't use. With async code it needs `TransactionScopeAsyncFlowOption.Enabled`, or the transaction won't flow across `await`.
- **Bulk operations**: inserting 100,000 rows one at a time takes minutes, because each pays a round trip and a log write. Use `SqlBulkCopy` or Npgsql binary `COPY` (fastest; stream into a staging table, then a set-based `MERGE`), table-valued parameters, batched multi-row inserts (EF Core batches automatically), or `ExecuteUpdate`/`ExecuteDelete` for set-based changes.
- **Dapper is a micro-ORM**: extension methods on `IDbConnection` where **you write the SQL and Dapper maps rows to objects** (and anonymous objects to parameters), matching column names to properties or constructor parameters case-insensitively. Performance is near raw ADO.NET, with no change tracking, LINQ or migrations. **Multi-mapping** (`QueryAsync<Order, Customer, Order>(sql, map, splitOn: "Id")`) rebuilds nested objects from flat joined rows; `splitOn` says where the second object's columns begin, because a row carries no structure of its own. For one-to-many, de-duplicate parents with a dictionary. `QueryMultiple` reads several result sets in one round trip; `DynamicParameters` handles stored procedures and output parameters; type handlers map custom types such as strongly typed IDs.
- **Connections in DI**: `AddNpgsqlDataSource` registers a singleton factory for pooled connections; for SQL Server, a small connection factory keeps code testable.
- **Dapper vs EF Core is about the job, not popularity.** EF Core gives LINQ, change tracking, a unit of work, migrations, relationships and typed queries, at the cost of a steeper learning curve; the performance gap has shrunk a lot since EF Core 6–8. Dapper gives explicit SQL, a natural fit for CTEs, window functions and hints, and minimal overhead. The common pragmatic split follows CQRS: **EF Core for writes** (aggregates, rules, migrations) and **Dapper or EF raw SQL for reads** (flat DTO queries with no tracking). EF Core alone can do raw reads with `Database.SqlQuery<T>($"…")`, which is still parameterised because it's an interpolated-string handler.

### 4.3 · EF Core fundamentals

[Full chapter →](ch:efcore-fundamentals)

- **An ORM does four jobs** you'd otherwise hand-write for every entity: **mapping** classes to tables (and references to foreign keys), **querying** (LINQ to SQL, then rows materialised into objects), **change tracking** (remembering what you loaded and detecting changes) and **persistence** (`SaveChanges` generating INSERT/UPDATE/DELETE in one transaction). **Migrations** version the schema alongside the code. The cost is a learning curve and the risk of bad SQL if you don't understand what it generates.
- **`DbContext` is one unit of work**: it holds the connection, the **model** (mapping metadata) and the **change tracker**, and each `DbSet<T>` is the entry point to one table. Register it **scoped** (one per request). `AddDbContextPool` reuses instances from a pool and resets their state, which saves setup cost at high throughput (but don't keep per-request state in fields). `AddDbContextFactory` suits background services, Blazor Server and parallel work. A context is **not thread-safe**: never share one across threads (no `Task.WhenAll` on one context), never make it a singleton, and never keep it alive for long, because its tracker only grows.
- **Conventions infer most of the model**:
  - a property named `Id` or `<Type>Id` is the key (`int` becomes an identity column; `Guid` gets a client-generated sequential GUID);
  - nullability decides `NULL`/`NOT NULL`;
  - a navigation plus a `<Nav>Id` property makes a foreign key;
  - a `List<T>` navigation means one-to-many;
  - a `string` becomes `nvarchar(max)` and a `decimal` becomes `decimal(18,2)` with a warning, so configure both;
  - enums become ints unless you use `HasConversion<string>()`.

  EF can use **private setters, backing fields and parameterised constructors**, so entities can protect their invariants (DDD).
- **Fluent API vs data annotations.** Annotations (`[MaxLength]`, `[Required]`, `[Index]`) cover simple cases. The Fluent API in `IEntityTypeConfiguration<T>` classes can do *everything* (keys, relationships, conversions, owned types, filters, seeding), **wins on conflicts**, and keeps persistence concerns like column lengths out of domain classes. Many teams use it exclusively.
- **Keys and generation**: composite keys, alternate keys (unique, and usable as foreign-key targets), identity columns, `HasDefaultValueSql`, computed columns. Strongly typed IDs map through value converters (`HasConversion(id => id.Value, v => new OrderId(v))`).
- **Relationships and delete behaviour**: `HasOne/WithMany/HasForeignKey`, one-to-one with `HasForeignKey<TDependent>`, and many-to-many with an automatic join table (EF 5+), or `UsingEntity` when the link needs extra columns. On delete: `Cascade` (the default for required relationships), `Restrict`/`NoAction`, `SetNull` (the default for optional ones) and client-side variants that only act on tracked entities. SQL Server rejects multiple cascade paths, so set `Restrict` somewhere.
- **Value objects**: **owned types** (`OwnsOne` puts columns inline, like `ShippingAddress_Street`; `OwnsMany` uses a separate table; `ToJson` stores JSON) and **complex types** (EF 8, true value semantics; nullable since EF 9/10). Also: inheritance mapping (**TPH**, one table with a discriminator, the default and fastest; **TPT**, a table per type; **TPC**, a table per concrete type), shadow properties, keyless entities for views, table splitting, temporal tables, and primitive collections stored as JSON.
- **Change tracking is snapshot diffing.** Every tracked entity has a state: `Added` (INSERT), `Unchanged`, `Modified` (UPDATE of only the changed columns), `Deleted` and `Detached`. When an entity is loaded, EF keeps a **snapshot** of its original values. `DetectChanges` (run by `SaveChanges`) compares every tracked entity's current values with its snapshot, property by property. Nothing told EF that `Price` changed; it found out by diffing. That's why tracking thousands of entities is expensive, and why read-only queries should use `AsNoTracking()` or projections. `SaveChanges` runs `DetectChanges`, orders commands to respect foreign keys, batches them, runs them in one transaction, propagates generated keys and resets states. **Disconnected updates** (a DTO arriving with nothing tracked): load and then update (safe, one extra read), attach a stub and mark specific properties modified, or use set-based `ExecuteUpdateAsync` (EF 7+), which loads nothing.
- **Migrations** turn model changes into versioned schema changes. Each one has `Up`/`Down` methods plus an updated **model snapshot**, which the next migration diffs against. Applied migrations are recorded in `__EFMigrationsHistory`, so `database update` is safe to rerun. In production, generate an **idempotent SQL script** (reviewable) or a **migration bundle** in the pipeline. Calling `MigrateAsync()` at startup races across replicas, needs DDL permissions and slows startup. For zero-downtime deploys, old and new code run side by side, so migrations must be **backward-compatible** (**expand/contract**): add nullable columns, backfill, make them required a release later; rename by adding the new column, copying, switching the code and dropping the old one later. Database-first `scaffold` generates entities from an existing schema.
- **Seeding**: `HasData` (reference data, part of migrations) and `UseSeeding`/`UseAsyncSeeding` (EF 9, development and test data). **Providers**: SQL Server, Npgsql, SQLite, Pomelo MySQL, Cosmos (a document database with very different query capabilities), Oracle. The InMemory provider is for testing only, and even there it's discouraged, because it isn't relational and hides real behaviour.

### 4.4 · EF Core querying and performance

[Full chapter →](ch:efcore-querying)

- **Nothing runs until a terminating operator.** `Where`, `OrderBy` and `Select` build an expression tree; `ToListAsync`, `FirstOrDefaultAsync`, `CountAsync`, `AnyAsync`, `ExecuteUpdateAsync` or `await foreach` over `AsAsyncEnumerable()` compile it into parameterised SQL, execute it through ADO.NET and **materialise** the rows (tracked by default). Re-enumerating a query runs it again.
- **See the SQL before tuning.** Use `LogTo` with `EnableSensitiveDataLogging` (parameter values, development only), the `Microsoft.EntityFrameworkCore.Database.Command` log category, `ToQueryString()` and `TagWith`. In production, OpenTelemetry EF instrumentation records every query as a span, and Query Store shows the slowest statements.
- **Tracking vs no-tracking.** Tracking keeps snapshots so changes can be saved. `AsNoTracking()` skips them: fastest and least memory, for read-only queries, but duplicate rows become separate objects. `AsNoTrackingWithIdentityResolution()` shares instances within one query. Read-heavy apps can make no-tracking the context default and opt in with `AsTracking()`.
- **Projection is the single biggest win.** `Select(o => new OrderSummary(o.Id, o.Customer.Name, o.Lines.Count))` fetches only the needed columns, tracks nothing (DTOs are never tracked) and **translates navigations into joins or subqueries**, which avoids N+1 without any `Include`. Make projection the default for read endpoints. AutoMapper's `ProjectTo` and Mapperly can generate the projection.
- **Loading related data**: **eager** (`Include`/`ThenInclude`, including filtered includes) when you need entities to modify; **projection** for reads; **explicit** (`Entry(o).Collection(...).LoadAsync()`) on demand; **lazy** (proxies) loads on first property access, which hides N+1, so avoid it.
- **N+1 is the most common EF performance bug**: one query loads 200 orders, then accessing `o.Customer.Name` in a loop (lazy loading), or querying inside a loop, issues 200 more. Each takes 1–2 ms and looks harmless in review, but 201 round trips add hundreds of milliseconds and grow with the data. Detect it with the same SQL shape repeating in logs, dozens of tiny identical spans in a trace, or a high queries-per-request count. Fix it with projection, `Include`, batching (`Where(p => ids.Contains(p.Id))` becomes `IN (…)`) or GraphQL DataLoaders.
- **Cartesian explosion**: including two collections in one query **multiplies** rows. One blog with 100 posts and 20 contributors returns 2,000 rows, each repeating the blog's columns. `AsSplitQuery()` (or the global `QuerySplittingBehavior.SplitQuery`) runs separate queries instead: more round trips and no single consistent snapshot without a transaction, but no multiplication. EF logs a warning when it spots the risk.
- **Translation errors**: EF Core can translate standard operators, many `string`/`Math`/`DateTime` members, `EF.Functions` and mapped database functions. A call to your own C# method in `Where` throws "could not be translated" (EF Core 3+). EF 1–2 silently loaded the whole table and filtered in memory, which looked fine on test data and dragged entire production tables over the network. The final `Select` may evaluate client-side, after the server has filtered. If you must filter in memory, do it explicitly, **after** a server-side filter. Reusable predicates should be `Expression<Func<…>>` properties or `IQueryable` extensions, so EF receives a tree it can read.
- **Paging and counting**: offset paging needs `OrderBy(...).ThenBy(Id)` for deterministic pages; keyset paging (`Where(p => p.Id > lastId)`) has constant cost. A total count on a large filtered table is itself a near-scan, so for "is there more?" fetch `size + 1` rows instead. Use `AnyAsync` rather than `CountAsync() > 0`.
- **Raw SQL**: `FromSql` (entities, composable with LINQ on top), `Database.SqlQuery<T>` (arbitrary DTOs and scalars, EF 8) and `ExecuteSql` all take a **`FormattableString`**, so `$"… {categoryId}"` becomes a real parameter. The `…Raw` variants take plain strings, and concatenating input into them is SQL injection.
- **Async**: use the async operators with a `CancellationToken` so abandoned requests cancel their SQL. Never run concurrent operations on one context. Stream large results with `AsAsyncEnumerable()` rather than buffering them all with `ToListAsync`.
- **Performance toolbox**:
  - context pooling;
  - **compiled queries** (`EF.CompileAsyncQuery`), which remove even the query-cache lookup for very hot queries;
  - **compiled models** (`dotnet ef dbcontext optimize`), for faster startup with huge models and required for Native AOT;
  - `ExecuteUpdate`/`ExecuteDelete`;
  - automatic `SaveChanges` batching;
  - no-tracking plus projection;
  - indexes matching your queries, checked in the plan;
  - split queries;
  - `EnableRetryOnFailure` for transient Azure SQL errors;
  - caching.
- **Slow-endpoint checklist, in order**:
  1. Trace it: is the time in the database, serialization or app code?
  2. Read the SQL.
  3. Count queries per request (N+1, queries in loops).
  4. Too many columns or rows? Project, page, filter on the server.
  5. Unnecessary tracking?
  6. Cartesian explosion?
  7. Read the execution plan: missing indexes, scans, key lookups, implicit conversions.
  8. Sync calls or `.Result`?
  9. Hot, stable data? Cache it.
  10. Bulk writes? Use set-based operations.

### 4.5 · EF Core advanced: concurrency, transactions, interceptors, filters

[Full chapter →](ch:efcore-advanced)

- **Optimistic concurrency detects lost updates without locks.** Alice and Bob both load order 42. Alice saves a new address, then Bob saves a status change from his older copy and silently overwrites her address. A **version column** (`[Timestamp] byte[] RowVersion`, a SQL Server `rowversion` incremented by the database on every update; Postgres uses `xmin` or a manually incremented token) is added to the `UPDATE`'s `WHERE` clause: `WHERE Id = @id AND RowVersion = @original`. Bob's version no longer exists, so his update matches **zero rows**, and EF throws **`DbUpdateConcurrencyException`**. You then reload, merge, retry, or return 409/412 (the API's ETag is this same token). It also protects business invariants: two requests reserving the last unit of stock conflict on the product's version, so one retries and sees zero stock instead of overselling, without a pessimistic lock.
- **`SaveChanges` is already one transaction.** Explicit transactions (`BeginTransactionAsync(isolationLevel)`) are for when several `SaveChanges` calls, `ExecuteUpdate` or raw SQL, or Dapper on the same connection must be atomic together, or you need a specific isolation level. Savepoints allow partial rollback. **`EnableRetryOnFailure`** retries transient errors (Azure SQL failovers, throttling, deadlock victims), but a retry must redo the *whole* unit of work, so manual transactions go inside `db.Database.CreateExecutionStrategy().ExecuteAsync(...)`.
- **No distributed transactions across services.** A transaction covers one database connection. "Save the order, publish to Service Bus, call the payment API" can't be one atomic unit, because those systems share no commit protocol. The answer is the **outbox** and sagas.
- **`ExecuteUpdate`/`ExecuteDelete`** (EF 7+) run set-based SQL without loading entities: much faster for bulk changes. Three consequences follow from loading nothing: they run **immediately** (not at the next `SaveChanges`), they **bypass the change tracker** (tracked copies stay stale), and they **bypass SaveChanges interceptors** (auditing and soft delete there won't run). Global query filters still apply to their `WHERE`.
- **Interceptors** add cross-cutting behaviour without touching business code:
  - `SaveChangesInterceptor`: audit fields, soft delete, domain events, outbox;
  - `DbCommandInterceptor`: hints, slow-SQL logging, tagging;
  - `DbConnectionInterceptor`: session context for row-level security, access tokens;
  - `DbTransactionInterceptor`;
  - `IMaterializationInterceptor`: post-processing loaded entities.

  An audit interceptor stamps `CreatedAt`/`UpdatedBy` on every `IAuditable` entity in the tracker, with nothing for developers to remember to call.
- **Global query filters** (`HasQueryFilter`) are appended to every query against an entity. Soft delete uses `!IsDeleted`, paired with an interceptor that turns `Deleted` states into `Modified` with `IsDeleted = true`; `IgnoreQueryFilters` covers admin and restore views. Multi-tenancy uses `TenantId == tenant.TenantId`, which closes over a **scoped** tenant service and so is evaluated per context, scoping every query to the current request's tenant. Trap: a **required** navigation to a filtered-out row becomes an INNER JOIN that makes the *parent* vanish from results, so make it optional or filter consistently. EF 10 adds **named filters** you can disable selectively. Add database row-level security as a second line of defence. Multi-tenancy alternatives are a schema per tenant or a database per tenant, trading isolation against cost.
- **Domain events and the outbox in `SaveChanges`.** Entities collect domain events; a `SaveChanges` interceptor (or override) converts them into **outbox rows in the same transaction** as the business data, so the order and its "order placed" event commit or roll back together, with no window where one exists without the other. A separate publisher then sends them. MassTransit, NServiceBus and Wolverine ship ready-made EF outboxes.
- **Other features**:
  - temporal tables (`TemporalAsOf`), JSON columns (`ToJson`), primitive collections;
  - `SqlQuery<T>` for unmapped types, keyless entities for views, user-defined function mapping;
  - sequences and HiLo key generation;
  - **multiple DbContexts**, one per bounded context or module, each with its own schema and migrations;
  - **vector search** (EF 10 with SQL Server 2025 or Azure SQL: `SqlVector<float>`, `VECTOR_DISTANCE`);
  - read-replica contexts.
- **Testing EF code**: avoid the **InMemory** provider, which isn't relational: no constraints or real transactions and different query semantics, so tests can pass while production fails. SQLite in-memory is real SQL but a different dialect. A **real database in a container (Testcontainers)** gives the highest fidelity and is recommended for repositories and queries. Mock repository interfaces only when unit-testing application logic.

### 4.6 · NoSQL, Redis and choosing a data store

[Full chapter →](ch:nosql-redis)

- **"NoSQL" is a set of families, each optimised for one access pattern**:
  - **key-value** (Redis, Table Storage): ultra-fast lookup by key, useless for anything else;
  - **document** (Cosmos DB, MongoDB): aggregates read and written whole, flexible schema, horizontal scale; weak at joins and multi-document transactions;
  - **wide-column** (Cassandra): massive write throughput;
  - **graph** (Neo4j, Gremlin): relationship traversal;
  - **search** (Elasticsearch, Azure AI Search): relevance, facets, typo tolerance; never the source of truth;
  - **time series**: metrics and IoT;
  - **vector**: embeddings for semantic search and RAG.

  Relational stays the default for business data. Reach for NoSQL for horizontal scale, very low latency at volume, nested or flexible schemas, global distribution or a specialised pattern. Many systems use several (**polyglot persistence**).
- **CAP and PACELC.** When the network between replicas breaks (a **P**artition, which really happens), each side must either refuse to answer (keeping **C**onsistency) or answer with possibly stale data (keeping **A**vailability); it can't do both until the network heals. **PACELC** adds the normal case: **E**lse, with no partition, you still trade **L**atency against **C**onsistency, because waiting for every replica to confirm is slower than letting them catch up. Consistency models run from **strong/linearizable** through **bounded staleness**, **session** (read-your-writes within a client: Cosmos DB's default and right for most apps) and **consistent prefix** to **eventual**. Cosmos lets you choose per account and relax per request.
- **Document modelling follows access patterns, not normal forms**: store together what's read together. **Embed** data that's read and updated together and bounded in size (order lines). **Reference** data that's shared, unbounded or independently changing (products, all of a customer's orders). Copying the product name into an order line is a correct historical record, not a bug. Keep copies that must stay in sync updated with change feeds or events.
- **The partition key is the decision you can't undo.** It decides scale, cost and which queries are cheap for the container's whole life. It needs **high cardinality**, **evenly distributed traffic** (partitioning by `date` sends every one of today's writes to one **hot partition**) and to appear in **most queries**: single-partition queries are cheap, cross-partition fan-outs cost more Request Units. Transactions are limited to one logical partition, and a logical partition holds 20 GB, so large tenants need **hierarchical keys** (tenantId → userId). Cosmos charges in **Request Units**: a 1 KB point read by id plus partition key costs about 1 RU, and queries cost more, so watch `RequestCharge`. Use one singleton `CosmosClient`; ETags give optimistic concurrency. The **change feed** streams every insert and update in order per partition. It's the basis for materialised views, event integration and keeping a search index in sync.
- **Redis is an in-memory data-structure server**, not just a cache: sub-millisecond operations, optional persistence (RDB snapshots, AOF log), replication and clustering. On Azure it's Azure Managed Redis; Valkey and Garnet (Microsoft's, written in C#) are compatible alternatives. Its structures **are** algorithms:
  - strings: cache values, `INCR` counters, `SET NX PX` locks, idempotency keys;
  - hashes: carts and sessions;
  - lists: simple queues;
  - sets: unique visitors, "who's online";
  - **sorted sets**: leaderboards (`ZRANGE` for the top 10, no app-side sorting), priority queues, sliding-window rate limits;
  - **streams**: an event log with consumer groups;
  - pub/sub: SignalR backplane, cache invalidation;
  - HyperLogLog, bitmaps, geo, and JSON, search and vector modules.
- **Redis pitfalls**:
  - Create **one `ConnectionMultiplexer`** for the app; one per request is the HttpClient socket bug again.
  - **Big or hot keys** hurt every client on that shard, because commands are processed mostly single-threaded per shard.
  - `KEYS *` blocks the server; use `SCAN`.
  - Set `maxmemory`, an eviction policy and TTLs, or the cache becomes an ever-growing permanent store.
  - **Pub/sub isn't durable**: offline subscribers miss messages, so use streams or a broker.
  - A lock's TTL can expire while the work is still running, letting a second holder start, so use **fencing tokens** or idempotent work. Acquire with `SET NX PX` and release only if your token still matches.
- **Search and vectors are projections**: keep the source of truth in SQL or Cosmos, and project into Azure AI Search or Elasticsearch through the change feed or events, for full-text, facets, synonyms, semantic ranking and hybrid vector search. Vector stores include Azure AI Search, Cosmos DB, pgvector, SQL Server 2025, Redis and Qdrant, accessed through `Microsoft.Extensions.VectorData` and `Microsoft.Extensions.AI`.
- **Choosing a store**: relational for business data; documents for whole aggregates and global scale; Redis for caches, sessions, counters, locks, leaderboards and limits; **Blob Storage** for files (store the URL in the database, never the file); search indexes for relevance; Event Hubs or Kafka for high-volume replayable streams; Data Explorer for telemetry; graph databases for path queries. Don't use a cache as the system of record, and don't pick NoSQL to dodge migrations: schema-on-read still needs versioning (a `schemaVersion` field plus code that handles old shapes).

## Part V · Architecture and Design

Layer 4: how you organise your own code so that change stays cheap as the system grows.

### 5.1 · Design principles: SOLID and beyond

[Full chapter →](ch:design-principles)

- **Every principle exists to make change cheap**, meaning a requirement change touches as few places as possible without breaking unrelated things.
- **S, Single Responsibility**: a module has **one reason to change**, meaning it answers to one actor (one source of requirements). An `OrderService` that prices (sales), persists (DBA) and emails (marketing) is edited by three teams for unrelated reasons, which brings merge conflicts and cross-breakage. Warning signs: names with Manager/Helper/Utils, 2,000-line services, 10+ constructor dependencies. SRP is about **cohesion around a reason to change**, not one method per class; over-splitting scatters logic.
- **O, Open/Closed**: add behaviour by adding code, not by editing working code. A carrier `switch` must be edited for every new carrier, risking the existing ones; an `IShippingRate` per carrier makes FedEx a new class plus one registration line. ASP.NET Core is built this way: middleware, DI registrations, filters, interceptors, `DelegatingHandler`s and configuration, logging and authorization providers are all extension points.
- **L, Liskov Substitution**: a subtype must be usable wherever its base is expected **without breaking correctness**. That means no stronger preconditions, no weaker postconditions, no surprising exceptions, and the base's invariants preserved. `Square : Rectangle` breaks callers who set width and height independently, because "is-a" must mean "behaves like". A `ReadOnlyOrderRepository` that throws on `Add` breaks everyone coding against `IOrderRepository`. .NET's own famous violation is arrays implementing `IList<T>` and throwing on `Add`. The test: would every test written for the base type pass for the subtype?
- **I, Interface Segregation**: clients shouldn't depend on methods they don't use. A fat `IUserService` forces a reporting job to depend on write methods and makes mocks implement 12 members. Split it by role (`IUserReader`, `IUserWriter`), and the read-only repository from the LSP example simply never implements the writer, so the problem disappears instead of being patched. .NET examples: `IEnumerable` → `IReadOnlyCollection` → `IList`, `IOptions<T>` per settings section, CQRS read/write split.
- **D, Dependency Inversion**: high-level policy and low-level detail both depend on abstractions, and **the high-level side owns the interface**, phrased in business terms. At run time, control still flows from `OrderService` to SQL. But at compile time `OrderService` mentions only `IOrderRepository`, defined in the domain or application project and implemented in infrastructure, so the source-code dependency points **inward**, opposite to the flow of control. DIP is the principle; DI is the mechanism that wires it up; Clean, Onion and Hexagonal architecture are DIP applied to a whole solution.
- **Coupling and cohesion are what SOLID is really about.** High **cohesion**: related things together (a `Money` type with its arithmetic, not a `Utils` grab-bag). Low **coupling**: modules don't depend on each other's internals. Coupling from worst to best:
  - **content**: reflecting into private state;
  - **common**: shared mutable statics, or one table written by two services;
  - **control**: flag parameters like `Save(order, sendEmail: true)`;
  - **stamp**: passing a whole object when one field is needed;
  - **data**: passing just the needed values;
  - **message**: communicating only through events or messages.

  **Connascence** names the ways two parts must change together (name, type, meaning, position, algorithm, timing). Keep strong forms inside one module, never across team boundaries.
- **DRY is about knowledge, not text.** Two snippets that look identical but change for different reasons (a shipping formula and a tax formula that both compute `base * rate` today) are not duplication, and merging them couples unrelated business rules. "Prefer duplication over the wrong abstraction"; the **Rule of Three** says abstract on the third occurrence, once the real pattern is clear. **KISS**: few moving parts, clear intent (simple isn't the same as easy). **YAGNI**: don't build for hypothetical requirements, but don't ignore known ones either.
- **Other principles**:
  - **composition over inheritance**;
  - **Law of Demeter**: `order.Customer.Address.City.Name` couples you to four classes' structure, so prefer `order.ShippingCity()`;
  - **Tell, Don't Ask**: `account.Withdraw(50)` enforces its own rule instead of `if (balance >= 50) balance -= 50` outside it, which is the root of rich domain models;
  - **separation of concerns**;
  - **least astonishment**: `GetUser` shouldn't create a user;
  - **fail fast**: constructor guards, `ValidateOnStart`;
  - **Command-Query Separation**: a method either changes state or returns data, never both; CQRS scales this up;
  - the **Hollywood principle** ("don't call us, we'll call you"), which is Inversion of Control;
  - **package principles**: depend toward stability; no cycles between projects, which the compiler enforces.
- **Over-applying principles is its own anti-pattern**:
  - an interface for every class, each with one never-mocked implementation;
  - abstracting stable things (wrapping `DateTime` is useful for testability; wrapping `string.Join` is not);
  - 40 classes for one feature;
  - plugin systems for variations that never come;
  - a shared `Customer` class across billing, shipping and marketing, coupling three teams.

  The test is whether the abstraction **pays for itself** through testability, a real variation point, or isolating something volatile (I/O, third parties, time). If not, keep it concrete and refactor later, which is cheap when tests exist.

### 5.2 · Design patterns: the GoF catalogue in modern .NET

[Full chapter →](ch:design-patterns)

- **A pattern is a named shape for a recurring problem**, and knowing the name lets you predict unfamiliar framework code ("that's a Decorator") without reading it. The Gang of Four catalogued 23 in three groups: **creational** (how objects are made), **structural** (how they're composed) and **behavioural** (how they collaborate). Modern C# and DI absorb many of them: a delegate replaces a one-method Strategy, `yield` *is* Iterator, and the container replaces hand-written Singletons and Factories. To answer "tell me about a pattern you used", give the problem, the pattern, the .NET example and the trade-off.
- **Creational**:
  - **Factory Method / simple factory**: a method decides which concrete type to create, so callers depend on an abstraction. Examples: `IHttpClientFactory`, `ILoggerFactory`, `IDbContextFactory`, DI factory lambdas; keyed services often replace hand-written factories.
  - **Abstract Factory** creates **families** that must be swapped together (Azure blob, queue and secrets vs local file, channel and user secrets); `DbProviderFactory` is one.
  - **Builder** constructs complex objects step by step with a fluent API and validates once at `Build()`. It's everywhere: `WebApplicationBuilder`, `IServiceCollection`, `ConfigurationBuilder`, `StringBuilder`, `ModelBuilder`, policy builders. **Test data builders** are a great use.
  - **Singleton**: the classic static `Instance` is hidden global state (invisible dependencies, not replaceable in tests, tests interfere with each other, a fixed lifetime). A **DI singleton** gives "one instance" with explicit, replaceable dependencies, and either way it must be thread-safe.
  - **Prototype** copies existing objects: record `with`, `MemberwiseClone`; `ICloneable` is discouraged because shallow vs deep is ambiguous.
- **Structural**:
  - **Adapter** translates an incompatible interface into the one your code expects. A `StripePaymentAdapter : IPaymentGateway` keeps vendor types out of your domain; it's the "adapter" in Ports & Adapters.
  - **Decorator** wraps an object with another implementing the **same interface** to add behaviour before or after delegating, and stacks: `Logging → Caching → Sql`, like nested middleware. N behaviours need N classes instead of 2^N subclasses. Examples: `DelegatingHandler`, `GZipStream`/`CryptoStream` around a `Stream`, MediatR behaviours.
  - **Proxy** also keeps the same interface, but **controls access**: lazy (EF lazy-loading proxies, `Lazy<T>`), remote (gRPC or Refit clients), protection, dynamic (`DispatchProxy`, Castle, which Moq and NSubstitute use). Decorator vs Proxy is about *why* you wrapped: adding behaviour vs controlling whether and when the real object is reached.
  - **Facade** puts a simple interface over a complex subsystem (`CreateBuilder`, `File.ReadAllTextAsync`, a `CheckoutFacade`).
  - **Composite** treats individual objects and groups uniformly (a `CompositeRule` *is* a rule; `CompositeFileProvider`; configuration sections).
  - **Bridge** separates abstraction from implementation (`ILogger` over providers, `DbConnection` over drivers).
  - **Flyweight** shares common state (string interning, `ArrayPool`, `Task.CompletedTask`, cached `JsonSerializerOptions`).
- **Behavioural**:
  - **Strategy** is interchangeable algorithms behind an interface, chosen at run time: keyed DI services, `IComparer`, `IEqualityComparer`, authentication schemes, `JsonNamingPolicy`, Polly strategies. It's the most used pattern in DI-based code.
  - **Observer**: a subject notifies observers without knowing them (C# events, `IObservable`, `IOptionsMonitor.OnChange`, change tokens, `DiagnosticListener`, MediatR notifications); at system scale it becomes pub/sub through a broker.
  - **Command** makes a request an object, so it can be queued, logged, retried or undone (CQRS commands, MediatR requests, queue messages, Hangfire jobs). Commands are imperative (`PlaceOrder`) and can be rejected; events are past tense (`OrderPlaced`) and already happened.
  - **Chain of Responsibility** passes a request along handlers that each handle, pass on, or both. The middleware pipeline is the defining example, along with `DelegatingHandler`, filters, MediatR behaviours and authorization handlers.
  - **Mediator** routes communication through a central object (MediatR, which has needed a commercial licence for larger companies since 2025; the source-generated Mediator library; Wolverine; Brighter; SignalR hubs; aggregate roots). The trade-off is decoupling plus a central pipeline vs indirection, since "go to definition" no longer finds the handler.
  - **Template Method**: a base class fixes the algorithm's skeleton and subclasses fill in steps (`BackgroundService.ExecuteAsync`, `AuthenticationHandler`, `OnModelCreating`, `JsonConverter<T>`). Strategy is preferred when steps vary independently.
  - **State**: each state is a class, so `Placed.Pay()` returns `Paid`, instead of status `if`s everywhere. Simpler lifecycles use an enum plus a transition table, or the Stateless library; MassTransit sagas are state machines across services.
  - **Iterator** is built in (`IEnumerable`, `yield`, `IAsyncEnumerable`). **Visitor** adds operations to a hierarchy through double dispatch (`ExpressionVisitor` is how EF translates queries; Roslyn syntax visitors); pattern matching often replaces simple visitors. **Memento** captures and restores state; **Interpreter** evaluates small languages.
- **Architecture-scale patterns** live in other chapters: DI and Service Locator, Options, Repository, Unit of Work and Specification, CQRS and Result, Aggregate and Value Object, Outbox, Inbox and Saga, Retry and Circuit Breaker, API Gateway, BFF and Strangler Fig, Cache-Aside.

### 5.3 · Application architectures: layered, Clean, hexagonal, vertical slice, modular monolith

[Full chapter →](ch:app-architectures)

- **At solution scale, architecture is about which parts may depend on which.** Good architecture keeps **business rules independent of delivery** (HTTP, UI, messages) **and infrastructure** (databases, queues, vendors). Logic is then testable without a server or database, frameworks can be swapped with local changes, teams don't collide, and the structure says what the system *does* (orders, payments), not what it's built with.
- **Classic layered (n-tier)** stacks presentation → business → data access → database. It's simple and familiar, but **business logic depends on data access**: rules couple to persistence, entities get shaped by tables, testing needs the data layer, and one feature is scattered across every layer. It tends toward anemic models with all the logic in "service" classes.
- **Onion (Palermo), Hexagonal / Ports & Adapters (Cockburn) and Clean (Uncle Bob) are one fix with three names**: put the **domain at the centre** and make **every compile-time dependency point inward**. Inner layers define the interfaces they need (ports: `IOrderRepository`, `IPaymentGateway`); outer layers implement them (adapters: `EfOrderRepository`, a Stripe adapter). Hexagonal distinguishes **driving** adapters (HTTP, CLI and tests call the core) from **driven** ones (the database and email, called by the core). It's DIP applied to the whole solution.
- **A Clean solution**: `Domain` references nothing (entities, value objects, domain events, repository interfaces); `Application` references Domain (use-case handlers, DTOs, validators, ports); `Infrastructure` implements the ports with EF Core, brokers and vendor SDKs; `Api` is the composition root. Domain tests run in milliseconds with nothing to fake. Swapping Stripe for Adyen is a new adapter, and a gRPC or message entry point reuses the same handlers. The use-case folders "scream" what the system does. Common mistakes: leaking EF into the domain (`[Table]`, `DbSet`, `IQueryable` from repositories); letting Application reference Infrastructure "just once" (the rule is binary); ceremony overload on trivial CRUD; and an anemic model behind a clean structure.
- **Repository and Unit of Work vs EF Core.** A repository acts as an in-memory collection of **aggregates** (clusters like an `Order` with its lines, saved and loaded as one unit), and a unit of work commits changes together. **EF Core already implements both**: `DbSet` is a repository and `DbContext` a unit of work. So the real question is whether to wrap them:
  - using the context directly gives full power but couples Application to EF;
  - a **generic repository** usually **adds nothing**, hiding EF features or leaking `IQueryable` (often called an anti-pattern);
  - **specific per-aggregate repositories** speak domain language, define how an aggregate loads, keep EF out of inner layers and are easy to fake.

  A common modern answer: **aggregate repositories for writes, direct projections (EF or Dapper) for reads**. Expose `IUnitOfWork` as the `DbContext` itself. The Specification pattern encapsulates query criteria as objects so repositories don't sprout `GetByXAndY` methods.
- **Vertical Slice Architecture** (Bogard) organises by **feature**, not technical role. Each use case owns its request, validator, handler and endpoint in one file, so a change touches one place and features share little. The risks are duplication and business logic leaking into handlers. It combines well with a rich shared domain: the slice's handler still calls `order.Cancel(...)`. Minimal APIs, CQRS and REPR (FastEndpoints) fit slices naturally.
- **A modular monolith** is one deployable split into strongly separated **modules**, one per bounded context, each with its own domain, its own schema or `DbContext`, and a small public API. Modules talk only through public contracts or integration events, never through another module's tables or internal classes. It delivers most of microservices' boundary benefits (clear ownership, independent evolution) **without** network failures, distributed transactions or many deployments. A module can be extracted into a service later with little rework, because the boundary already exists. Many teams now treat it as the **default starting architecture**.
- **Enforce boundaries, or they erode within a sprint**: project references (the compiler rejects undeclared dependencies, the strongest guarantee), `internal` by default, **architecture tests** (NetArchTest, ArchUnitNET: "Domain must not depend on EF Core", "modules must not reference each other's internals") in CI, analyzers, and **ADRs** (Architecture Decision Records) documenting why.
- **Choosing**: small CRUD → minimal APIs plus EF directly, in feature folders. Rich rules on a long-lived product → Clean with a DDD domain and CQRS reads. Many features and a fast team → slices over a shared domain. Several bounded contexts and few teams → modular monolith. Independent scaling, many teams and mature DevOps → microservices, often extracted from a modular monolith.

### 5.4 · CQRS, the mediator pipeline and the Result pattern

[Full chapter →](ch:cqrs-mediator-result)

- **CQS → CQRS.** CQS (Meyer) is a method rule: change state or return data, never both, so asking a question never changes the answer. **CQRS** (Greg Young) scales it to architecture: **separate models and code paths for writes and reads**. Their needs differ. Writes need rich behaviour and invariants (load an aggregate, apply rules, save atomically). Reads need speed and shape (flat DTOs per screen, joins across aggregates, no tracking, caching). One model serving both ends up mediocre at both, with UI fields polluting entities and N+1 queries. Reads usually outnumber writes 10–100×, so splitting lets each side scale and optimise separately.
- **CQRS is a spectrum.**
  - Level 0: one model for everything.
  - **Level 1**: separate command and query handlers over the **same database**, with immediate consistency and low complexity. **A great default.**
  - Level 2: denormalised read tables in the same database, updated in the same transaction or by triggers.
  - **Level 3**: separate read stores (Cosmos, Elasticsearch, Redis) updated **asynchronously** from events, which brings **eventual consistency**: an immediate GET after a POST may not see the change, and the UI must cope. This is where complexity jumps, with projections, replay and lag handling.
  - Event sourcing on top: store events, not state.

  CQRS **is not** event sourcing. They're independent, though event-sourced systems usually need CQRS read models.
- **Commands vs queries in code**: commands are imperative records (`PlaceOrderCommand`) handled by loading aggregates and calling their methods, returning little (an ID, a Result). Queries never modify state, can bypass the domain entirely and project straight from `DbSet` to DTOs. One handler per command or query.
- **The mediator's real value is the pipeline.** Dispatching a request to its single handler is a modest convenience. **Pipeline behaviours** that wrap every handler (logging, validation, authorization, transactions, caching) give cross-cutting concerns one home, the way middleware does for HTTP. A `ValidationBehavior` runs the FluentValidation validators and either calls `next()` or short-circuits with a failure; registration order decides the wrapping order. MediatR **notifications** provide in-process pub/sub for domain events.
- **Do you need a library?** MediatR has needed a commercial licence for larger organisations since v13 (2025); Mediator (source-generated, MIT, very fast); Wolverine (mediator plus messaging plus outbox); Brighter; or **no library**: inject handlers directly and use decorators or endpoint filters, which keeps it explicit and makes "go to definition" work. The honest trade-off: indirection that hides call graphs ("service locator in disguise" when overused) and ceremony in small apps, vs a uniform pipeline and a repeatable per-use-case structure that scales with the number of use cases.
- **The Result pattern makes expected failure part of the contract.** "Not found", "insufficient stock", "already registered" and "card declined" are normal outcomes. As exceptions they're **invisible in the signature** (`Task<Order> PlaceAsync()` hides five ways to fail), expensive under load, turn control flow into distant `try/catch`, and are easy to forget. A `Result<T>` is either a success value or a typed `Error(Code, Message, Type)`. Implicit conversions let handlers simply `return order.Id;` or `return OrderErrors.PaymentDeclined;`. Map Results to HTTP **once** at the edge (`ToHttp`, `ToProblem`), so every endpoint agrees on what "not found" means. Libraries: ErrorOr, FluentResults, Ardalis.Result, OneOf, CSharpFunctionalExtensions; "railway-oriented programming" chains them with `Map`/`Bind`. C# still has no built-in discriminated unions, which is why these exist.
- **Exceptions vs Results**: exceptions for bugs and broken invariants, infrastructure failures (database down, timeouts), things the caller can't meaningfully handle, and constructors or framework callbacks. Results for business rejections, validation failures and anything the caller is *expected* to branch on. Both coexist, with a global `IExceptionHandler` as the backstop for the unexpected.

### 5.5 · Domain-Driven Design

[Full chapter →](ch:ddd)

- **DDD's premise**: in complex domains (insurance, logistics, banking, healthcare, large e-commerce), the hardest problem is understanding and encoding the business correctly, not the technology. Rules scattered across controllers, services and SQL get duplicated, contradict each other and become impossible to change safely. DDD concentrates them in one explicit **domain model** built *with* domain experts, in their language. **Strategic DDD** splits a big system into parts (bounded contexts, language, subdomains, context maps) and shapes teams and service boundaries. **Tactical DDD** gives building blocks inside one part (entities, value objects, aggregates, events).
- **Ubiquitous language**: the same precise vocabulary in conversation, documents and code. If the business says a policy is "bound", the code says `policy.Bind()`, not `SetStatus(3)`, and when the language changes, the code changes.
- **Bounded contexts**: an explicit boundary within which a model and its language are consistent. The **same word legitimately means different things** in different contexts. "Product" is name and images in Catalog; prices and discounts in Pricing; stock and locations in Inventory; weight in Shipping; a snapshot of SKU, name and price in Ordering. One shared `Product` class for all five becomes a battleground where a Pricing change breaks Shipping. Give each context its own small model, connected by IDs, APIs and events.
- **Subdomains decide where to invest**: **core** (your competitive edge, like a pricing engine) gets the rich model and the best people; **supporting** (necessary but not differentiating) gets simpler models, maybe CRUD; **generic** (identity, payments, email) should be bought (Entra ID, Stripe, SendGrid). Full tactical DDD belongs in the core.
- **Context maps** describe how contexts relate: shared kernel, customer/supplier, conformist (adopt upstream's model as-is), **anti-corruption layer** (translate a legacy or third-party model into yours through adapters, so its quirks don't leak in), open host service with a published language, and separate ways. **Event Storming** is the sticky-note workshop for discovering events, commands, aggregates and boundaries.
- **Entities vs value objects.** An **entity** has an identity that outlives its state: two orders with identical data are still different orders, so equality is by ID (with strongly typed IDs, e.g. `Guid.CreateVersion7()`). A **value object** (`Money`, `Address`, `EmailAddress`, `DateRange`) has no identity, is immutable and is compared by value, which records give you for free. Value objects cure **primitive obsession** (`decimal price, string currency` passed separately and swappable; a `string email` never validated): validation runs **once at creation**, so holding an `EmailAddress` *guarantees* it's valid. Behaviour lives with the data (`Money.Add` rejects mixed currencies), and signatures document themselves (`Charge(Money amount)`).
- **Aggregates are the key tactical pattern**: a cluster of entities and value objects changed as **one unit**, behind one **root**, forming a **consistency boundary** whose invariants ("an order has at least one line", "no lines after placing", "can't cancel after shipping") hold within one transaction. Vaughn Vernon's rules:
  1. All changes go **through the root**: no public setters, nobody adds to `Lines` directly.
  2. **Keep aggregates small**, because big ones mean big loads, lock contention and concurrency conflicts.
  3. **Reference other aggregates by ID only** (`CustomerId`, not a `Customer` navigation). A navigation would let a transaction wander into and modify another aggregate, breaking the boundary.
  4. **One transaction modifies one aggregate**; other aggregates are updated **eventually** through domain events.
  5. Load and save whole aggregates through repositories.

  "Place order" therefore saves the `Order` and raises `OrderPlaced`, and handlers update Inventory and Loyalty afterwards. If the business truly needs one atomic rule spanning them, the boundaries are wrong.
- **Domain events** are past-tense facts in the ubiquitous language (`OrderPlaced`), collected by the aggregate root. When to dispatch them:
  - before commit, in the same transaction: atomic, but couples handlers to it;
  - after commit, in-process: simple, but lost if the process crashes between commit and dispatch;
  - **outbox**: events written in the same transaction and published by a worker, giving reliable at-least-once delivery with idempotent handlers. Use this for anything that matters.

  **Domain events** stay inside a context, in-process. **Integration events** cross contexts through a broker with stable, versioned schemas, and are often translated from domain events.
- **Building blocks**:
  - **domain services** hold domain logic that fits no single entity, in domain terms (`TransferService`), and can contain real rules;
  - **application services** (use-case handlers) only orchestrate (load, call domain methods, save, publish) and make **no business decisions**;
  - **factories** guarantee valid creation;
  - **repositories** give collection-like access to **aggregate roots only**;
  - **specifications** are reusable business predicates.
- **Rich vs anemic models**: in an anemic model, `Order` is a bag of public setters and the rule lives in `OrderService.Cancel`. Anyone can still write `order.Status = "Cancelled"` and bypass it, and in a big codebase someone will. Fowler calls this an anti-pattern: you pay for extra types and get none of the protection. Rich models put behaviour with data (`order.Cancel(reason)`), which is Tell, Don't Ask.
- **Persisting with EF Core** without polluting the model: Fluent API configuration, value converters for strongly typed IDs, `CustomerId` mapped as a plain property (enforcing "reference by ID" at the persistence layer), private setters, private constructors, backing fields, and owned or complex types. The purest alternative is separate persistence models plus mapping: more code, zero coupling.
- **When DDD is overkill**: tactical DDD costs types, mapping, a learning curve and eventual consistency, so use it for **complex core domains with rich, changing rules**. For CRUD and supporting subdomains, a simple EF model with validation is better. **Strategic DDD** (contexts and language) pays off almost everywhere.

### 5.6 · Monoliths, microservices and distributed architecture

[Full chapter →](ch:microservices)

- **One spectrum, not old vs new.**
  - A **monolith** has one deployable, often weak internal boundaries, one database and ACID everywhere.
  - A **modular monolith** has one deployable, **strong** modules with data owned per module, and events between modules.
  - **Microservices** have many deployables, boundaries enforced by the network, a **database per service**, local transactions only plus sagas, per-service scaling, high team autonomy and **high operational complexity**.

  A monolith isn't bad; a big ball of mud is. Shopify, Stack Overflow and Basecamp run well-structured monoliths at scale.
- **Real benefits**: independent deployment (no release train), independent scaling, fault isolation (if designed for it), technology freedom, and team ownership aligned to business capabilities (Conway's Law, Team Topologies). **Real costs** are the **fallacies of distributed computing**: assumptions in-process calls let you make for free ("the network is reliable, latency is zero…"), which microservices force you to confront:
  - every call can fail or be slow, so you need timeouts, retries and circuit breakers;
  - there are no distributed transactions, so you need eventual consistency, sagas, outbox and idempotency;
  - cross-service joins become API composition or replicated data;
  - you need distributed tracing;
  - contract testing;
  - compatible API and message versioning;
  - per-service pipelines, containers, discovery and gateways;
  - cognitive and on-call load.
- **"Should we use microservices?"** They solve **organisational scaling** (many teams needing independent deployment) and **uneven scaling**, at the cost of distributed-systems complexity. With one or two teams and an evolving domain, start with a **modular monolith** and extract a service only for a concrete reason: a different scaling profile, release cadence, team or isolation need.
- **Boundaries are the most expensive decision.** Services that must change together, call each other constantly or share data pay the full cost of distribution for no benefit. Good boundaries:
  - follow **bounded contexts and business capabilities**, not technical layers ("the validation service") or entities ("the Customer service everyone calls");
  - give high cohesion inside and low coupling outside;
  - **own their data and rules**;
  - let a service do its main job when others are down (local copies of data, fed by events);
  - fit one team.

  Start **coarse**: splitting later is a refactor, merging chatty nano-services is a rewrite.
- **Database per service**: other services access data only through the owner's API or events. A shared schema couples services at the deepest level: any change can silently break a team that wasn't told, which kills independent deployment, the whole point. Cross-service queries use **API composition** (a gateway or BFF fans out; fine for small fan-out), **data replication via events** (Shipping keeps customer addresses from `CustomerAddressChanged`), or a **CQRS read model** built from many services' events. All are eventually consistent.
- **Prefer async events between services.** Synchronous calls couple services in time and cascade failures. In a chain, the availabilities **multiply**: four services at 99.9% each give 0.999⁴ ≈ 99.6%, about **4×** the downtime of any single service, and longer chains are worse. Messaging decouples in time, buffers load and isolates failures, at the cost of eventual consistency. Use sync calls for queries needing an immediate answer.
- **Gateways and meshes**: an **API gateway** is the single entry point for routing, TLS, auth offload, rate limiting, caching, aggregation and versioning (YARP, Azure API Management, Front Door). A **BFF** is a gateway per client type that shapes responses and, for SPAs, holds tokens server-side. A **service mesh** uses sidecar proxies for **mTLS** (both sides prove their identity with certificates), retries, traffic splitting and telemetry (Istio, Linkerd, Dapr, Container Apps' built-in features). **Service discovery**: platform DNS (Kubernetes Services, Container Apps internal ingress) or `Microsoft.Extensions.ServiceDiscovery` (`https+http://ordering`), plus central configuration.
- **Strangler fig migration**: a big-bang rewrite hides all value behind one risky cutover. Instead:
  1. Put a proxy (YARP) in front of the monolith.
  2. Pick one well-bounded capability.
  3. Build it as a new service and route its paths to it.
  4. Sync data (events or **change data capture** such as Debezium) while both exist, then delete the old code.
  5. Repeat.

  Supporting techniques: anti-corruption layers, branch by abstraction, feature flags.
- **Anti-patterns**:
  - the **distributed monolith** (deploy-together services, a shared database, sync chains, one change touching five services): all the costs, without the independent deployment that justified them;
  - nano-services (a service per entity, every request fanning out to ten);
  - a shared domain library coupling every service's model and release cycle (sharing contracts and infrastructure helpers is fine);
  - chatty sync chains;
  - no observability;
  - microservices first (a new product, one team, 15 services).
- **Readiness checklist**: CI/CD and infrastructure as code per service, containers and an orchestrator or PaaS, centralised logs, metrics and **distributed tracing**, resilience on every outbound call, a broker with outbox and idempotency practices, API versioning and contract tests, health checks with autoscaling and graceful shutdown, service-to-service identity (managed identity, client credentials, mTLS) and clear on-call ownership.

## Part VI · Testing

Layer 8, first concern: proving the code does what you think, in a way that survives refactoring.

### 6.1 · Unit testing and test doubles

[Full chapter →](ch:unit-testing)

- **What is "one unit"?** The **classical** (Detroit) school says a unit is a *behaviour*: use real collaborators and replace only shared or out-of-process ones (database, network, clock). The **mockist** (London) school says a unit is *one class*, with every collaborator mocked: precise failure locations, but tests coupled to implementation. Current guidance (Khorikov) leans classical, because when you refactor internals without changing behaviour, behaviour tests survive and mock-everything tests break.
- **FIRST**: Fast (milliseconds), Isolated (no order dependence or shared state), Repeatable (no real time, randomness or network), Self-validating (pass or fail, no inspection), Timely (written with the code).
- **xUnit** (v3 is current) is the mainstream framework. `[Fact]` is a single test; `[Theory]` with `InlineData`, `MemberData`, `ClassData` or `TheoryData` is parameterised. Setup is the **constructor**, teardown is `Dispose` or `IAsyncLifetime`. xUnit creates a **new instance per test**, so leftover state can't leak between tests by construction. `IClassFixture` shares expensive setup across a class, and collection fixtures share across classes (a database container). Collections run in parallel; tests within one run sequentially. NUnit and MSTest v3 are equally fine; consistency matters most.
- **Naming and structure**: names state behaviour and condition (`Cancel_WhenOrderShipped_ReturnsAlreadyShippedError`, or plain English like `Shipped_order_cannot_be_cancelled`). Test one behaviour per test (several asserts are fine if they check one outcome), put **no logic in tests** (they must be obviously correct by inspection), and use Arrange-Act-Assert with a single Act. Assertion libraries: built-in `Assert` (including `Equivalent` for structural comparison), Shouldly (MIT), FluentAssertions (commercial since v8; v7 stays Apache), the AwesomeAssertions fork, and **Verify** for snapshot testing.
- **Test doubles (Meszaros)**: a **dummy** fills a parameter and is never used; a **stub** returns canned answers to feed inputs; a **fake** is a working lightweight implementation (in-memory repository, `FakeTimeProvider`); a **spy** records calls for later assertions; a **mock** has expectations that are verified. Stubs support **state verification** (check the result); mocks support **behaviour verification** (check an interaction happened). **Verify interactions only for outgoing side effects at the system boundary**: an email sent, a message published, a payment charged, or "the order was *not* saved when payment was declined". Never verify queries or internal calls. NSubstitute and Moq are the common libraries; FakeItEasy and hand-written fakes are often clearer.
- **Over-mocking makes tests brittle.** Mock every collaborator, verify every call, and any refactor breaks tests even though behaviour didn't change; the tests just restate the implementation. **Don't mock types you don't own with complex behaviour** (`HttpClient`, `DbContext`, `IQueryable`), because the mock won't behave like the real thing. Wrap them behind your own interface and integration-test the wrapper, or use a stub `HttpMessageHandler` or a real database container.
- **Non-determinism must be injected.** `DateTime.UtcNow`, `Guid.NewGuid()` and `Random` make a test pass today and fail tomorrow. Inject **`TimeProvider`**, and in tests `FakeTimeProvider` sets and `Advance`s time, which also drives timers and `PeriodicTimer` with no real waiting. Async tests are `async Task` (never `.Result`) with `Assert.ThrowsAsync`. `FakeLogger<T>` captures log records.
- **Test data builders** (the Builder pattern in tests) provide valid defaults, so each test states only what matters to it (`new OrderBuilder().Placed().Build()`). AutoFixture and Bogus generate anonymous or realistic data.
- **What's worth testing**: domain logic (invariants, calculations, state transitions), handlers' decision logic with fakes at the edges, algorithms, parsers, mappers with logic, edge cases and error paths, and regression tests for bugs. Not worth it: trivial properties, pass-through code, framework behaviour, private methods (test them through public behaviour). **Coverage is a diagnostic, not a goal**: a test can run every line and assert nothing. **Mutation testing** (Stryker.NET flips `>` to `>=` and checks a test fails) measures whether tests actually catch bugs.
- **TDD**: **Red** (a failing test for the next small behaviour) → **Green** (the simplest code that passes) → **Refactor** (improve the design under the tests' safety net), in minutes-long cycles. You get tests by construction and usage-driven, testable APIs. It can feel slow during exploratory design and is awkward around heavy framework code, so many teams use it selectively for domain logic and bug fixes, where the failing reproduction test is both the diagnosis and the regression guard. **BDD** (Given-When-Then, Reqnroll) writes executable specifications with business stakeholders.

### 6.2 · Integration, end-to-end testing and strategy

[Full chapter →](ch:integration-testing)

- **Integration tests catch what unit tests structurally can't**, because those bugs live *between* components: wrong middleware order (everything returns 401), missing DI registrations or captive dependencies, route and binding mismatches, JSON casing and enum differences, EF mapping errors, missing migrations, LINQ that can't translate or is slow in real SQL, unapplied authorization policies, and configuration binding failures.
- **Pyramid vs trophy vs honeycomb.** The classic pyramid (many unit, fewer integration, very few E2E tests) made sense when higher-level tests were slow and flaky. **Containers and in-memory hosting changed that calculation**: many .NET teams now put **most confidence in integration tests** for APIs, keep unit tests for complex domain logic and run a few E2E smoke tests. The real rule was always confidence per minute of effort. Also in the mix: **contract tests** (Pact, OpenAPI diffing, schema registries), **E2E** (Playwright; highest confidence but flaky and costly) and **load tests** (k6, NBomber, Azure Load Testing).
- **`WebApplicationFactory<Program>`** boots your **real `Program.cs`** in memory on a `TestServer` (no ports) and hands you an `HttpClient` wired into the pipeline. Configuration, DI, middleware order, routing, binding, validation, filters, serialization and ProblemDetails all run for real. Add `public partial class Program;` so the test project can see the generated `Program` class.
- **Replace only what's external, slow, non-deterministic or costly** (payment providers, email and SMS, third-party APIs, the clock) in `ConfigureTestServices`. Keep your own code, database and broker real; replacing more turns the test back into a unit test in disguise. **Fake authentication**: a test `AuthenticationHandler` builds the principal from a header, while your **real authorization policies still run**, so you can prove a customer gets 403 on an admin endpoint. Alternatively, mint real JWTs with a test signing key.
- **Testcontainers** starts throwaway Docker containers from test code: SQL Server, Postgres, Redis, RabbitMQ, Azurite, the Service Bus and Cosmos emulators, Kafka. Containers take seconds to start, so **share one per run or collection** and **reset data between tests**:
  - **Respawn** deletes all rows in foreign-key order: fast and the most popular;
  - a rolled-back transaction per test: very fast, but breaks if the code manages its own transactions;
  - unique data per test: no reset needed, and tests can run in parallel;
  - template database clones: strong isolation at a cost.

  One such test proves binding, real handler logic, database state and a side effect fired, together. **Never use the EF InMemory provider here.**
- **Dependencies you don't own**: **WireMock.Net** for third-party HTTP (realistic responses, delays and faults), real brokers in containers or library test harnesses (MassTransit's `ITestHarness` asserts what was published), Azurite, the Cosmos emulator, and a fake auth handler or test token issuer for identity.
- **Contract and architecture tests**: **consumer-driven contracts** (Pact) record what each consumer requests and expects, and the provider's CI verifies it still honours every contract, catching breaking changes without deploying both services together. Lighter options are OpenAPI diffing or schema-registry compatibility checks. **Snapshot** the generated OpenAPI document or message types with Verify so contract changes show up in review. Architecture tests enforce layering.
- **E2E, smoke, load and chaos**: keep E2E tests **few**, on critical paths (sign-up, checkout), and tolerant of async processing (poll with timeouts, never fixed sleeps). Run **smoke tests** after each deploy to gate promotion. Use load tests to set p50/p95/p99, throughput and error-rate baselines against production-like data. Chaos testing (Azure Chaos Studio, Polly chaos strategies) injects faults to verify resilience.
- **Tests in CI**: unit tests on every commit, integration tests on every PR (GitHub-hosted Ubuntu runners have Docker, so Testcontainers just works). Quarantine and fix **flaky tests** immediately, because they destroy trust in the whole suite. Keep the suite fast with parallel collections, shared containers and Respawn. Publish results and coverage, and make the test run a required merge check.

## Part VII · Distributed Systems

### 7.1 · Messaging and events

[Full chapter →](ch:messaging-events)

- **What a broker buys you.** With synchronous HTTP the caller waits, so a slow or down callee becomes the caller's failure, and latency adds up along the chain. A **broker** in the middle lets the sender hand off a message and move on. You get:
  - **temporal decoupling**: producer and consumer needn't be up at the same time;
  - **load levelling**: a spike of 10,000 orders queues up, and consumers work through it at their own pace;
  - **fault isolation**: Email being down doesn't stop checkout;
  - **extensibility**: a new subscriber (Analytics) reacts to an existing event without the publisher changing, which is the Observer pattern at the scale of services;
  - **scale-out** by adding competing consumers.

  The costs are eventual consistency, more infrastructure, harder debugging (you need tracing), duplicates, out-of-order delivery and message versioning. The rest of the chapter deals with each of these.
- **Commands, events, queries.** A **command** ("please do X", imperative name like `ChargePayment`) has **exactly one** handler, the sender knows who it is, and it **can be rejected**, so it goes on a **queue**. An **event** ("X happened", past tense like `OrderPlaced`) has **zero or many** subscribers that the publisher doesn't know about, and it **can't be rejected** because it already happened, so it goes on a **topic**. Queries ("tell me X") usually stay on HTTP/gRPC. Events come thin (**notification**: `OrderPlaced { OrderId }`, consumers call back for details) or fat (**event-carried state transfer**: the data travels with the event). Fat events remove the runtime callback but couple consumers to the schema.
- **Queue vs topic mechanics.** On a queue, each message goes to **one** consumer instance (competing consumers), so adding instances adds throughput without double processing. On a topic, each **subscription** gets its **own copy**, and within one subscription the instances compete again.
- **Broker choice comes down to whether messages are consumed or retained.**
  - **Azure Service Bus** removes a message once it's completed: messages are *work*. It has sessions (FIFO per session), dead-letter queues, scheduled messages, duplicate detection, transactions and filters, which suits business commands and workflows.
  - **RabbitMQ** routes through exchanges (direct, topic, fanout, headers) and is common on-premises or multi-cloud.
  - **Kafka / Azure Event Hubs** is a partitioned **append-only log**. Messages are **retained** (for days, or forever with compaction), and each consumer group tracks its own **offset**, so messages are a **replayable history**. That's why Kafka suits event streaming, telemetry and event-sourcing pipelines and Service Bus doesn't: replay only works if nothing was removed. Ordering is per partition.
  - **Storage Queues** are cheap and basic. **Event Grid** is push-based notification fan-out (a blob was created), not a work queue.
- **Delivery is at-least-once, so duplicates are normal.** Exactly-once isn't achievable end to end across independent systems, and it isn't a broker bug. Three ordinary ways a message arrives twice:
  - a consumer **finishes the work, then crashes before acknowledging**; the broker can't know the work happened, so it redelivers;
  - a producer **times out waiting for an ack** and republishes a message that had actually landed;
  - a **lock expires** during slow processing and a second instance picks the message up.

  The conclusion drives the rest of the chapter: **every consumer must be idempotent**, which gets you *effectively-once*.
- **The dual-write problem.** `SaveChangesAsync` then `bus.Publish` are two systems with no shared commit. Crash between them and the order exists with no event. Swap the order and you can publish an event for an order whose save then fails. Reordering only changes which failure you get.
- **Transactional outbox fixes it.** Insert the message into an `OutboxMessages` table **in the same database transaction** as the business change, so either both commit or neither does. A separate **relay** (a `BackgroundService` polling with `PeriodicTimer`, or change data capture such as Debezium) publishes unsent rows and marks them processed. The relay can still fail and retry, and that's fine: it publishes from committed, durable data, and a repeated publish is just at-least-once again. Multiple relay instances need row locking (`UPDLOCK, READPAST` so they skip each other's rows). In production, prefer a library outbox: MassTransit, NServiceBus, Wolverine and Brighter all ship EF Core outboxes.
- **Making consumers idempotent.** The aim is to make the second arrival a no-op, because you can't prevent it. Techniques:
  - **naturally idempotent writes** (`SET status = 'Paid'` rather than `balance = balance - 10`; upserts);
  - an **inbox table**: record the message ID **in the same transaction** as the handler's changes, with a unique key, and skip IDs already present;
  - **business-key unique constraints** (one `Payment` per `OrderId`);
  - **version checks**;
  - **broker duplicate detection** (Service Bus, by `MessageId` within a window). This only catches producer retries, not consumer crashes.

  The subtle part: the inbox protects **your database only**. If the consumer charges a card and crashes before the inbox row commits, redelivery charges again, because the payment provider can't see your inbox. External side effects need **their own idempotency key** passed to the provider, because your transaction can't roll back a card charge.
- **Retries, poison messages, DLQ.** Use immediate retries for brief glitches (deadlocks), then **delayed redelivery** with backoff (1 min → 5 → 30) for longer outages. After N attempts, move the message to a **dead-letter queue** so one bad message doesn't block the queue or burn resources. Alert on DLQ depth, inspect, fix and **resubmit**. Permanent errors (validation, unknown entity) should be dead-lettered immediately with no retries. In MassTransit that's `UseMessageRetry(...).Ignore<ValidationException>()` plus `UseDelayedRedelivery`.
- **Ordering is mostly not guaranteed.** Even if messages arrive in order, two competing consumers can finish them in either order, and retries reorder further. Options:
  - **partition by key**: Service Bus `SessionId = orderId` or a Kafka partition key gives FIFO **per entity**, with one consumer per session or partition at a time. You give up global order but keep it where it matters, within one entity's history;
  - **design for disorder**: carry a version or sequence number and drop stale updates (`if (msg.Version <= entity.Version) return;`);
  - make events **commutative** where you can, and avoid needing order across entities.
- **Sagas.** A business process across services (reserve stock → charge → ship) can't be one ACID transaction; it's the DDD "one transaction, one aggregate" rule applied across services. A saga is a chain of **local transactions**. When a step fails, **compensating actions** undo earlier steps *semantically* (refund, release stock), because there's nothing to roll back.
  - **Choreography**: services react to each other's events with no coordinator. It's loosely coupled, but the flow is implicit, scattered and hard to change, and it risks cycles.
  - **Orchestration**: a **state machine** (a MassTransit `MassTransitStateMachine<OrderState>` persisted with EF Core) sends commands, reacts to replies and owns timeouts ("15 minutes in any state → compensate → Cancelled"). It's the State pattern driven by messages. You pay for a central component, and in return you can see exactly where an order is stuck at 3 a.m.

  Alternatives for long-running workflows: Durable Functions, Temporal, Dapr Workflows.
- **Raw SDK vs library.** `Azure.Messaging.ServiceBus`, `RabbitMQ.Client` and `Confluent.Kafka` are fine for simple cases. The key discipline with a raw processor is `AutoCompleteMessages = false` and calling `CompleteMessageAsync` **only after** the handler succeeds (ack after processing), which turns a crash into a safe redelivery rather than a lost message. Set `MessageId`, `SessionId` and `CorrelationId` on send. Libraries add serialization, topology, retries, outbox/inbox, sagas, test harnesses and OpenTelemetry:
  - **MassTransit**: most popular; v9+ is commercial, v8 stays open source;
  - **NServiceBus**: commercial, very mature tooling;
  - **Wolverine**: MIT;
  - **Rebus**, **Brighter**;
  - **Dapr pub/sub**: a sidecar abstraction over many brokers.
- **Contracts are APIs.** Publish them as a small contracts package or a schema (Avro/Protobuf with a registry). Carry `MessageId`, `CorrelationId` (or trace context), `CausationId` (which message caused this one), `OccurredAt`, type and version; **CloudEvents** is a standard envelope. Evolve by **adding optional fields**. For breaking changes, run **v2 alongside v1** until consumers migrate. Consumers should be **tolerant readers**: ignore unknown fields and cope with missing optional ones. Large payloads use **claim-check**: store the blob and send a reference. Map internal **domain events** to stable **integration events** so your domain model doesn't leak across service boundaries.
- **Event sourcing.** Store the **sequence of events**, not the current state. State is a **left fold** over them: start blank, apply each event in order, like a bank statement's running balance. The benefits are a complete audit trail ("what did we know on 1 March?"), rebuilding or adding read models from history, and debugging by replay. The costs:
  - queries need CQRS projections;
  - schema evolution needs **upcasting** (converting old stored event shapes to the current shape when you read them, since history can't be edited);
  - long streams need **snapshots**, so replay starts from a saved state instead of event #1;
  - projections are eventually consistent.

  Tools: Marten (on PostgreSQL), EventStoreDB/KurrentDB, Cosmos DB change feed. Use it where history *is* the product (ledgers, compliance), not as a default.

### 7.2 · Resilience

[Full chapter →](ch:resilience)

- **Failure is normal in the cloud**: deployments restart instances, networks blip, databases fail over, dependencies throttle you (429) and noisy neighbours add latency. The goal is to turn a 2-second blip into a degraded experience, not an outage. **Match the response to the fault type**:
  - **transient** (timeouts, resets, 503, 429, 408, deadlock victims, SQL failover): **retry** with backoff;
  - **prolonged** (a dependency down for minutes): **stop calling** (circuit breaker), fall back and degrade;
  - **permanent** (400, 401/403, 404, validation, bugs): **don't retry**; fail fast and surface the error;
  - **slowness** (10 s instead of 100 ms): **timeout**, limit concurrency, hedge.
- **The toolbox:**
  - **Timeout**: a slow call otherwise holds threads, sockets and the user's patience indefinitely;
  - **Retry** with **exponential backoff and jitter**;
  - **Circuit breaker**: fail fast for a break period instead of hammering a failing dependency;
  - **Fallback**: cached, default or degraded value;
  - **Hedging**: after a delay, send a second request and take whichever answers first, which cuts tail latency;
  - **Rate and concurrency limiters**: protect yourself or the dependency from overload;
  - **Bulkhead**: separate pools or limits per dependency, so one can't exhaust shared resources (watertight compartments in a ship).
- **Retry, done properly.** Exponential backoff (200 ms → 400 → 800) gives the dependency time to recover. **Jitter** randomises delays so thousands of clients don't retry in synchronised waves (the thundering herd, the same stampede as expiring cache keys). Limit attempts (2–5) and the **total time**. Retry only transient faults and honour **`Retry-After`**. Retry only **idempotent** operations (GET, PUT, DELETE), or POSTs that carry an **idempotency key**, because a timed-out POST may have succeeded and a blind retry can charge a card twice.
- **Retry storms.** If gateway, API, service and database client each retry 3 times, one failure becomes **3 × 3 × 3 = 27** attempts on the bottom layer, exactly when it's struggling. Retry at **one layer** (usually closest to the failing dependency), keep counts low, add circuit breakers, and propagate **shrinking timeout budgets** down the call chain.
- **Circuit breaker states.**
  - **Closed**: calls flow and failures are counted.
  - **Open**: when the failure ratio passes a threshold (say 50%) within a sampling window, *with a minimum throughput so 2 failures out of 3 calls don't trip it*, calls fail immediately with `BrokenCircuitException` for the break duration.
  - **Half-open**: after that, one trial call is allowed. Success closes the breaker; failure re-opens it.

  Why: waiting on timeouts to a dead dependency wastes threads and connections, adds latency, and piles load on a service that needs quiet to recover. Open is deliberate rest. Log state changes and expose them as metrics; a breaker opening is worth paging someone over.
- **Two timeouts.** A **per-attempt** timeout (2 s) bounds one try; a **total** timeout (10 s) bounds the whole operation including retries and must fit inside the caller's own deadline. Always flow `CancellationToken`s: a timeout that only stops *waiting* leaves the dependency doing work for a caller who has gone. `HttpClient.Timeout` defaults to **100 s**; with a resilience pipeline, let the pipeline own timeouts.
- **Polly v8 and `Microsoft.Extensions.Http.Resilience`.** `.AddStandardResilienceHandler()` on an `IHttpClientFactory` registration stacks, from outermost to innermost: **rate limiter → total timeout → retry → circuit breaker → attempt timeout → the HTTP call**. Defaults retry 5xx, 408, 429, `HttpRequestException` and timeouts with exponential backoff and jitter, and honour `Retry-After`. Tune via options (`Retry.MaxRetryAttempts`, `AttemptTimeout`, `CircuitBreaker.FailureRatio`). The breaker's `SamplingDuration` must be at least **2× the attempt timeout**, or a window can close before a single timed-out attempt is counted. `AddStandardHedgingHandler()` gives hedging. For non-HTTP code, `AddResiliencePipeline("inventory-db", p => p.AddTimeout(...).AddRetry(new() { ShouldHandle = ..., BackoffType = Exponential, UseJitter = true }).AddCircuitBreaker(...))`, then resolve it with `ResiliencePipelineProvider<string>`.
- **Strategy order matters**, because each strategy wraps the next like middleware: outermost runs first.
  - A **total timeout outside the retry** bounds everything; an **attempt timeout inside** bounds each try.
  - A **circuit breaker inside the retry** counts every attempt, and once it's open, the retry should treat `BrokenCircuitException` as non-retryable (or delay) so it stops quickly.
  - **Fallback goes outermost** so it catches everything below it.

  Pre-v8 syntax (`Policy.Handle<>().WaitAndRetryAsync`, `AddPolicyHandler`, Microsoft.Extensions.Http.Polly) is deprecated but uses the same concepts.
- **Resilience beyond HTTP.**
  - EF Core: `EnableRetryOnFailure()`. Wrap manual transactions in `CreateExecutionStrategy().ExecuteAsync(...)` so the *whole* transaction retries.
  - Azure SDK clients: `ClientOptions.Retry`.
  - Brokers: redelivery and DLQ.
  - StackExchange.Redis: `AbortOnConnectFail = false` with reconnect backoff.
  - gRPC: retry and hedging policies in the channel's service config.
- **Graceful degradation is a design choice, not a library.**
  - **Fallbacks**: cached recommendations, hide the reviews widget, use the last known exchange rate and say so.
  - **Asynchronous by default**: accept the order and charge via a queue, so checkout works while Payments is down.
  - **Bulkheads**: a separate HttpClient, pool and concurrency limit per dependency, so slow reporting can't starve checkout.
  - **Load shedding**: reject early with 429/503 rather than collapse.
  - **Static stability**: keep working on the last known good config or identity metadata if the control plane is down.
  - **Timeouts and idempotency everywhere**.
- **Liveness vs readiness.** **Liveness** asks "is the process stuck?" and failing it **restarts** the instance. **Readiness** asks "can it serve traffic now (dependencies reachable, warm-up done)?" and failing it **removes the instance from the load balancer** without restarting it. Tag checks (`"live"` and `"ready"`) and map `/health/live` and `/health/ready` with predicates. **Never put dependencies in liveness**: if the database blips, the orchestrator restarts *every* instance and a hiccup becomes a full outage.
- **Chaos engineering** proves the strategies work before an outage does. **Polly chaos strategies** (v8.3+: `AddChaosLatency`, `AddChaosFault`, `AddChaosOutcome`, `AddChaosBehavior`) are switched on by configuration in test environments. **Azure Chaos Studio** injects platform faults (VM shutdown, network latency, AKS pod chaos). **Game days** are planned exercises to watch alerts and recovery.

### 7.3 · Observability and .NET Aspire

[Full chapter →](ch:observability-aspire)

- **Monitoring vs observability.** Monitoring answers questions you **knew to ask in advance** (CPU above 80%? error rate above 1%?) and drives dashboards and alerts. Observability lets you answer **new** questions from the data the system already emits, without shipping code ("why is checkout slow for mobile users in Germany since 14:05?"). When one click touches 8 services, nobody can pre-build a dashboard for every incident question, so you need both.
- **Three signals, correlated.**
  - **Logs**: detailed, structured, discrete events. They tell you *what happened*.
  - **Metrics**: cheap, pre-aggregated numbers over time. They tell you *how much, how often, how fast*.
  - **Traces**: the path of *one request* as a tree of timed spans. They tell you *where the time went*.

  Linked by **TraceId**, they chain: a metric spike says *that* something is wrong → exemplar traces say *where* → that trace's logs say *why*. Profiles and exceptions are increasingly treated as further signals.
- **.NET's APIs are already OpenTelemetry-shaped.** Logs use `ILogger`. Metrics use `System.Diagnostics.Metrics` (`Meter`, `Counter<T>`, `Histogram<T>`, `UpDownCounter<T>`, `ObservableGauge<T>`). Traces use `ActivitySource`/`Activity`, where **an `Activity` is an OTel span**. ASP.NET Core, HttpClient, SqlClient, EF Core, Azure SDKs, gRPC and MassTransit already emit through these, and the runtime publishes GC, thread pool and exception metrics. The **OpenTelemetry .NET SDK** just *listens* to these APIs and exports via **OTLP** (optionally through a Collector for batching, filtering, tail sampling and routing) to Azure Monitor, Grafana (Tempo/Loki/Prometheus), Jaeger, Datadog, Honeycomb or the Aspire dashboard. Emitting code never knows the backend.
- **Setup.** Call `AddOpenTelemetry()` with these pieces:
  - `.ConfigureResource(r => r.AddService("shop-api", serviceVersion: ...))`;
  - `.WithTracing(...)` with ASP.NET Core (filter out `/health`), HttpClient and EF Core instrumentation, plus `.AddSource("Shop.Checkout")` for your own spans;
  - `.WithMetrics(...)` with the ASP.NET Core, HttpClient and runtime instrumentation, plus `.AddMeter(...)`;
  - `.UseOtlpExporter()`.

  Endpoints come from `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`.
- **Distributed tracing.** Every span shares the **TraceId** and has its own SpanId, a parent SpanId, a name, timing, **attributes**, **events** and a **status**. The waterfall makes the cause obvious: of a 1.8 s checkout, one SQL span takes most of it, not the pricing call. Without the trace you'd investigate five services. **Context propagation** uses the W3C **`traceparent`** header: `00-<32-hex traceid>-<16-hex parent span id>-<flags, 01 = sampled>`. `tracestate` carries vendor data, and **`baggage`** carries app key/values (`tenant=acme`) downstream. ASP.NET Core reads the header, HttpClient and gRPC write it, and messaging libraries put it in message headers. `Activity.Current` flows through `await` via **`AsyncLocal`** (the same mechanism as log scopes), so every log line in a request carries TraceId and SpanId automatically.
- **Sampling.** **Head sampling** decides at the start (`TraceIdRatioBasedSampler`, keep 10%). It's cheap but blind: it may drop the one failing request. **Tail sampling** (in the Collector) decides after the trace completes, so it can **keep all errors and slow traces** and sample the boring ones, which keeps exactly what you need in an incident. **Never sample metrics**: they're already aggregates, and sampling only makes them less accurate without saving much.
- **Custom telemetry.** Use a static `ActivitySource` and `Meter` per component. `using var activity = Source.StartActivity("checkout.place-order")` returns **null when nobody is listening**, so use `activity?.SetTag(...)` and the cost is near zero. Record failures with `SetStatus(ActivityStatusCode.Error)`. Pick the instrument by shape:
  - `Counter<T>` for monotonic counts (orders, errors);
  - `UpDownCounter<T>` for values that rise and fall (active checkouts, queue depth);
  - `Histogram<T>` for distributions (durations, amounts), which is what gives you percentiles;
  - `ObservableGauge<T>` for a value sampled via callback (pool usage).

  Use the **semantic conventions** for names (`http.request.method`, `db.system`, `messaging.system`) so backends build standard views.
- **Cardinality is the cost trap.** Every unique combination of tag values is a separate time series. Tag a metric with `userId`, `orderId` or a raw URL and you get millions of series, huge bills or a crashed backend. Keep metric tags **low-cardinality** (status code, route *template*, payment method, region). Put IDs on **traces and logs**, which are per-event anyway.
- **What to measure.**
  - **RED** for request-driven services: Rate, Errors, Duration.
  - **USE** for resources: Utilisation, Saturation (queueing), Errors.
  - **Google's four golden signals**: latency, traffic, errors, saturation.

  Use **percentiles (p50/p95/p99), never averages**: an average of 100 ms can hide 5% of users waiting 4 s, because the many fast requests drag it down. For .NET, also watch GC pause time and heap size, **thread pool queue length and thread count** (starvation from sync-over-async), exception rate, connection pool usage, and outbox or queue lag.
- **SLIs, SLOs, error budgets.**
  - **SLI**: a measured ratio ("share of checkout requests under 1 s with a non-5xx status").
  - **SLO**: the target ("99.5% over 30 days").
  - **Error budget**: the 0.5% you're allowed to miss. When it's spent, reliability work beats features.

  **Alert on symptoms users feel** (SLO burn rate, error rate, latency), not on causes (one CPU spike). Every page must be actionable and link to a dashboard and a runbook.
- **Azure Monitor / Application Insights.** Data lands in a **Log Analytics** workspace, queried with **KQL**: `requests | where timestamp > ago(1h) | summarize percentile(duration, 95) by name`, or `union requests, dependencies, traces, exceptions | where operation_Id == "<traceid>"` to see everything for one trace. Features include the application map, end-to-end transaction view, live metrics, availability tests, profiler and snapshot debugger. In new code use the **Azure Monitor OpenTelemetry Distro** (`UseAzureMonitor()`); the classic SDK is in maintenance.
- **.NET Aspire** is development and deployment tooling, **not a production runtime**.
  - **AppHost**: a C# project that *describes the system* (`AddSqlServer("sql").AddDatabase("shopdb")`, `AddRedis`, `AddRabbitMQ`, `AddProject<Projects.Shop_Catalog>().WithReference(db).WaitFor(db)`). `dotnet run` starts the containers and projects, **injects connection strings and service URLs** as configuration, and opens the dashboard. It replaces docker-compose, README steps and tribal knowledge about environment variables.
  - **ServiceDefaults**: one shared `builder.AddServiceDefaults()` that configures OpenTelemetry, health checks (`/health`, `/alive`), service discovery and HttpClient resilience the same way in every service, so they don't drift.
  - **Integrations**: packages like `AddSqlServerDbContext<ShopDb>("shopdb")` and `AddAzureServiceBusClient("bus")` that register a client with health checks, telemetry and retries pre-wired.
  - **Dashboard**: logs, structured logs, traces and metrics over OTLP, so you have distributed tracing on your laptop from day one. It's also usable standalone.
  - **Deployment**: `azd up` provisions Azure Container Apps plus backing services, and tooling generates Kubernetes manifests, Compose and Bicep.
- **Incident workflow**, which walks the three signals in order:
  1. An SLO burn-rate alert fires.
  2. The dashboard shows which endpoint, since when, and whether it correlates with a deployment.
  3. Exemplar slow or failing traces show which span and which dependency.
  4. The **logs for that TraceId** show the exception and context.
  5. The service's runtime metrics show GC, thread pool, CPU and pool state.
  6. **Mitigate first** (roll back, scale, fail over, flip a feature flag), then find the root cause and hold a blameless post-mortem.
  7. Add the signal or alert you wished you'd had.

## Part VIII · Cloud and DevOps

### 8.1 · Cloud fundamentals and the Azure map

[Full chapter →](ch:cloud-azure-overview)

- **What "cloud" means**: renting compute, storage, databases and managed services **on demand, paying for what you use**. NIST names five characteristics: self-service (a database in minutes from code), broad network access, multi-tenant **resource pooling**, **rapid elasticity** and **measured service**.
- **Service models are a line of responsibility.** Read the stack from the top down (application, data, runtime, OS, virtualisation, hardware) and see where your job ends:
  - **IaaS** (VMs): you own the OS and everything above it, including patching.
  - **PaaS** (App Service, Azure SQL): the line moves above the *runtime*. Azure patches the OS and keeps .NET current, and you own the app and its configuration.
  - **Containers-as-a-service**: you own the image.
  - **Serverless** (Functions): pay per execution and scale to zero, at the cost of cold starts and time limits.
  - **SaaS**: you only use it.

  **Default for .NET backends: PaaS and managed services.** Every VM is patching, monitoring, backup and hardening work that buys little unless you specifically need OS control.
- **Shared responsibility.** The provider secures the cloud *itself* (datacentres, hardware, hypervisor). You secure what you put *in* it (code, data, identities, access policies, network rules, configuration), and **identities, data and access are always yours**, even in SaaS. Most cloud breaches are customer misconfigurations (public storage containers, leaked keys, over-privileged identities), not provider failures.
- **Regions and zones.** A **region** is a geographic area; you choose it for latency, data residency (GDPR), service availability and price. **Availability zones** are physically separate datacentres in one region with independent power, cooling and network, so **zone-redundant** deployments survive losing a datacentre. **Region pairs** are used for disaster recovery and staggered platform updates. The resilience ladder, each step costing more:
  1. Single instance: any deploy or failure is downtime.
  2. Multiple instances across zones: the production baseline.
  3. Multi-region **active-passive**: fail over to a standby region.
  4. Multi-region **active-active**: Front Door routing globally over replicated data (Cosmos multi-region writes, SQL geo-replication). It's the most available and the most complex.

  Size it with **RTO** (how long you may be down) and **RPO** (how much data, measured in time, you may lose). Pick the tier the requirement justifies, not the top one.
- **Scale up vs scale out.** **Up** means a bigger SKU: there's a ceiling, it usually needs a restart, and it's still one instance. **Out** means more instances behind a load balancer: effectively unlimited and it survives instance loss, **but only if the app is stateless** and keeps shared state in shared stores. **Autoscaling** works on metrics (CPU, requests/s, or **queue length via KEDA**, which scales on signals from outside the cluster) or on a schedule. **Elasticity** includes scaling *down*, so you stop paying for idle capacity.
- **Twelve-factor app**, the checklist that makes scale-out and redeploys safe. The three that matter most in ASP.NET Core:
  - **Config in the environment**: `IConfiguration` env vars, Key Vault, App Configuration;
  - **stateless processes**: no in-memory session, no local files;
  - **disposability**: fast start and **graceful shutdown** on SIGTERM via `stoppingToken`.

  The others: one codebase with many deploys; declared dependencies (lock files, images); backing services attached by URL; strictly separate build/release/run (an immutable image plus config); port binding (Kestrel on `ASPNETCORE_HTTP_PORTS`); concurrency via processes (separate web and worker); dev/prod parity (containers, Aspire, Testcontainers, IaC); **logs as stdout streams**; and admin tasks as separate processes (migration bundles).
- **"Works with one instance" bugs** all appear the first time you run 2 replicas:
  - in-memory sessions or caches assumed to be shared;
  - files written to local disk;
  - scheduled jobs running on **every** replica;
  - **Data Protection keys** not shared, so users get logged out and antiforgery fails;
  - SignalR without a backplane;
  - sticky-session assumptions.

  Design for N from day one.
- **Azure resource hierarchy**: **Entra tenant** (identity boundary) → **management groups** (policy and RBAC inherited across many subscriptions) → **subscriptions** (billing, quota and access boundary, often one per environment) → **resource groups** (things deployed and deleted together, like `rg-shop-prod-weu`) → resources. **ARM** is the control plane every tool goes through: portal, `az`, SDKs, Bicep, Terraform.
  - **RBAC** at any scope says *who can do what*. There are control-plane roles (Owner, Contributor, Reader) and separate **data-plane** roles such as *Storage Blob Data Reader*.
  - **Azure Policy** enforces rules ("no public storage", "only these regions").
  - **Tags** (`env`, `owner`, `costCenter`) drive cost reporting.
- **The Azure map for a .NET backend:**
  - **Compute**: App Service, Container Apps, AKS, Functions.
  - **Images**: ACR.
  - **Data**: Azure SQL (or PostgreSQL), Cosmos DB, Blob Storage, Azure Managed Redis.
  - **Messaging**: Service Bus, Event Grid, Event Hubs.
  - **Secrets and identity**: Key Vault, Entra ID and managed identities, App Configuration with feature flags.
  - **Gateway and edge**: API Management; Front Door (global edge, CDN, WAF) → Application Gateway (regional L7 + WAF) or Load Balancer (L4).
  - **Monitoring**: Azure Monitor, App Insights, Log Analytics.
  - **IaC**: Bicep, Terraform, azd.
- **Networking.** A **VNet** is your private network, split into subnets with **NSGs** filtering traffic. **Private Endpoints** give a PaaS service (SQL, Storage, Key Vault, Service Bus) a **private IP inside your VNet**, so you can then **disable public network access**. That's the usual production security bar, and it needs **Private DNS zones** so the normal hostname resolves to the private IP. **VNet integration** is the *outbound* side, letting App Service, Functions or Container Apps reach private resources. **Hub-and-spoke** puts shared firewall and gateways in a hub VNet with workloads in peered spokes.
- **Cost levers.** Costs grow from many individually reasonable choices. The levers:
  - **right-size** (a P3v3 at 10% CPU becomes a P1v3);
  - **autoscale and scale to zero**;
  - **reservations or savings plans** for steady load (1–3 year commitments);
  - serverless or auto-pause database tiers;
  - small dev SKUs that shut down at night;
  - blob lifecycle tiers (Hot → Cool → Cold → Archive);
  - **egress** (data leaving Azure or crossing regions costs money);
  - **telemetry ingestion** (sampling, log levels, retention), often a surprise line item.

  Tools: Cost Management budgets and alerts, Advisor, the Pricing Calculator.
- **Well-Architected Framework**: five pillars, used as the lens in system-design interviews:
  - **Reliability**: zones, redundancy, retries, health probes, backups, DR, chaos.
  - **Security**: Entra and managed identity, least privilege, Key Vault, private endpoints, WAF, encryption, Defender.
  - **Cost Optimization**: right-sizing, autoscale, reservations, tiering, tags.
  - **Operational Excellence**: IaC, CI/CD, observability, runbooks, safe deployments (slots, canaries).
  - **Performance Efficiency**: scale-out, caching, CDN, async processing, partitioning, load tests.

### 8.2 · Docker and containers

[Full chapter →](ch:docker)

- **A container is an isolated process that shares the host's kernel.** **Namespaces** give it its own filesystem, network and process view, and **cgroups** cap its CPU and memory. Because there's no guest OS or kernel, it's MBs not GBs, starts in seconds or less, and packs hundreds to a host. The same fact explains the weakness: isolation is good but **weaker than a VM's**, since a kernel exploit crosses containers. Why containers won: **one immutable image** runs identically on a laptop, in CI and in prod. Dependencies are explicit, rollback means redeploying the previous tag, and every platform accepts the image, which becomes the contract between dev and ops.
- **Image, layer, container, registry.**
  - An **image** is a read-only stack of **layers** (filesystem diffs, one per `FROM`/`COPY`/`RUN`, **cached** and shared between images) plus metadata: entrypoint, env, ports, user.
  - A **container** is a running instance with one thin **writable layer** on top. Many containers share one image.
  - **Registries**: Docker Hub, **ACR**, GHCR, and **MCR** for official .NET images.
  - A **tag** (`:1.4.2`, `:latest`) is a mutable label. A **digest** (`@sha256:…`) is immutable content addressing, which is what you pin for true reproducibility.
- **The .NET images** (mcr.microsoft.com/dotnet):
  - `sdk`: ~800 MB, **build stage only**;
  - `aspnet`: web apps;
  - `runtime`: console apps and workers;
  - `runtime-deps`: native OS libraries only, for **self-contained or Native AOT** apps;
  - variants: `-alpine` (small, but musl libc, so check native dependencies like ICU), `-noble` (Ubuntu 24.04), `-azurelinux3.0`, **`-noble-chiseled`** (distroless: **no shell, no package manager, non-root by default**, the smallest attack surface) and `-composite` (composite ReadyToRun for faster startup).

  **Since .NET 8**, ASP.NET Core images listen on **8080** (`ASPNETCORE_HTTP_PORTS`) instead of 80, because binding below 1024 needs root, and they ship a non-root **`app`** user (UID 1654).
- **The production Dockerfile, technique by technique:**
  1. **Multi-stage**: `FROM sdk AS build` to restore, build and publish, then `FROM aspnet` and `COPY --from=build` only the publish output. The final image has no SDK, source or tools.
  2. **Layer-cache ordering**: copy `Directory.Build.props`, `Directory.Packages.props`, `global.json` and the `.csproj` files, **run `dotnet restore`, and only then copy the source**. Docker reruns a layer, and everything after it, only when that layer's inputs change. So a `.cs` edit reuses the slow restore layer, because the slow, rarely changing work comes first.
  3. **`.dockerignore`** excludes `bin/`, `obj/`, `.git`, `.vs`, `node_modules` and local settings files. Builds get faster and you don't leak files.
  4. **Non-root** (`USER app`) on a **chiseled** base.
  5. **Exec-form `ENTRYPOINT ["dotnet", "Shop.Api.dll"]`**, not the shell form. Exec form makes `dotnet` **PID 1**, and `docker stop` and Kubernetes send `SIGTERM` to PID 1. With the shell form, `/bin/sh` is PID 1, it doesn't forward the signal, and your app never starts its graceful shutdown; it gets SIGKILLed after the grace period instead.
  6. **Pin versions** and **rebuild regularly** to pick up base-image security patches.
- **No Dockerfile needed for standard apps**: `dotnet publish -t:PublishContainer -p ContainerFamily=noble-chiseled -p ContainerRegistry=shopacr.azurecr.io` builds an OCI image with **no Docker daemon** and can push it straight to a registry, configured with `<ContainerRepository>` and `<ContainerPort>` in the csproj. Use a Dockerfile when you need extra OS packages or complex builds.
- **Configuration and state in containers.**
  - Config comes from **environment variables set at runtime** (`ConnectionStrings__Shop`), so **one image is promoted through every environment**.
  - **Never `COPY` secrets or pass them as build args**: they persist in image layers and anyone who pulls the image can read them. Use the platform secret store or, better, **managed identity**, so there's no secret at all.
  - The **filesystem is ephemeral** and vanishes when the container is replaced. Use Blob Storage or a database, and volumes only where truly needed.
  - **Persist Data Protection keys** (Blob + Key Vault) for multi-instance apps.
  - **Log to stdout**, and expose health endpoints for probes.
- **Local dev**: `compose.yaml` runs the API plus SQL, Redis and RabbitMQ (`docker compose up -d --build`, `down -v`), with `depends_on` (plus a health condition) for startup ordering. **Aspire's AppHost** solves the same problem in C#, adding connection-string wiring and a dashboard.
- **Size, startup and security.**
  - **Shrink the image**: chiseled or distroless (fewer packages means fewer CVEs and no shell for an attacker); Alpine; `InvariantGlobalization=true` to drop ICU; trimming plus self-contained on `runtime-deps`; **Native AOT** (tens of MB, millisecond startup); ReadyToRun or composite images for startup.
  - **Security practice**: scan images in CI (Trivy, Grype, Docker Scout, Defender for Containers); run non-root with a **read-only root filesystem**; drop Linux capabilities; never run privileged; **sign images** (Notation or cosign) and admit only signed images; produce an **SBOM**; let Dependabot or Renovate bump base images.
- **.NET is container-aware.** The GC and thread pool read the container's **cgroup limits**, not the host's RAM and cores, so a 2-CPU container doesn't size its thread pool for the host's 64 cores.
  - With a memory limit, the **GC heap hard limit defaults to 75%** of the container limit (`DOTNET_GCHeapHardLimitPercent`). The rest is left for native memory, thread stacks and the runtime.
  - **Server GC** is the ASP.NET Core default, and it used to make one heap per core and be memory-hungry in small containers. **.NET 9+ enables DATAS** (Dynamic Adaptation To Application Sizes), which grows and shrinks the heap count with load.
  - Set realistic Kubernetes **requests and limits**: too low gives **OOMKilled** restarts. `DOTNET_PROCESSOR_COUNT` overrides the detected CPU count.

### 8.3 · Azure compute: App Service, Functions, Container Apps, AKS

[Full chapter →](ch:azure-compute)

- **It's one spectrum: control versus operations work.** VMs (any software, you patch everything) → **AKS** (full Kubernetes; high ops) → **Container Apps** (serverless containers on managed K8s + KEDA + Envoy; low-medium) → **App Service** (classic managed web hosting; low) → **Functions** (event-driven code; lowest). Choose by how much operational burden you want, not by which sounds most powerful.
- **App Service.** It hosts web apps, APIs and WebJobs from code or a container, on Windows or Linux. An **App Service plan** is the shared compute (VM size × instance count) that one or more apps run on, and its tier sets the features. Free and Shared are dev only; **Basic** has no slots or autoscale; **Standard and Premium v3** add autoscale, **slots**, VNet integration and (Premium) zone redundancy; **Isolated v2** (an App Service Environment) is single-tenant and network-isolated.
- **Deployment slots.** A slot is a **live app with its own hostname** (`shop-api-staging.azurewebsites.net`) on the same plan. Deploy to `staging`, **warm it up** and smoke-test, then **swap**: production traffic moves to already-warm instances, so there are no cold-start errors. Rollback is swapping back. Mark settings **slot-specific ("sticky")**, like a staging connection string, so they stay with the slot and don't travel in the swap.
- **App Service configuration and features.**
  - **App settings become environment variables** (`Payments__ApiKey`). **Key Vault references** (`@Microsoft.KeyVault(SecretUri=...)`) resolve secrets at runtime, so they never appear in the settings.
  - **Managed identity** gives passwordless access to SQL, Storage and Key Vault.
  - Autoscale rules (CPU > 70% → +1 instance) or Premium's HTTP-based automatic scaling.
  - A **health check path**: unhealthy instances are pulled from the load balancer and replaced.
  - VNet integration for outbound traffic, private endpoints for inbound.
  - **Always On** stops idle unloading. **ARR affinity** (sticky sessions) should be **turned off** for stateless apps, or load spreads badly.
  - Easy Auth, Kudu, log streaming.
- **Azure Functions: triggers and bindings.** **Triggers** start a function: HTTP, **Timer** (CRON), Service Bus, Storage Queue, Blob, Event Grid, Event Hubs, the **Cosmos DB change feed**, Kafka, SQL change tracking. **Bindings** read or write Blob, Cosmos, Service Bus or SQL declaratively without SDK boilerplate. Use the **isolated worker model**: your code runs in **its own process**, separate from the Functions host, so you choose the .NET version and dependencies and get **normal DI, middleware and configuration** (`FunctionsApplication.CreateBuilder(args)`, `ConfigureFunctionsWebApplication()` for ASP.NET Core-style HTTP). The legacy in-process model is being retired. A Service Bus trigger **settles messages for you**: it completes on success, and on an exception it retries and eventually dead-letters by max delivery count.
- **Functions hosting plans.**
  - **Flex Consumption** (recommended): event-driven scale to zero, fast scale-out, optional **always-ready** instances to cut cold starts, VNet support, per-function scaling.
  - **Classic Consumption**: cold starts and a 5–10 minute timeout. Linux Consumption is being retired.
  - **Premium**: **pre-warmed instances, so no cold start**, plus VNet and long runs; you always pay for the minimum.
  - **Dedicated**: runs on an App Service plan for predictable cost.
  - **On Container Apps**.

  **Pitfalls**: cold starts for latency-sensitive HTTP; execution time limits; **no in-memory state** (instances come and go); triggers are at-least-once, so **be idempotent**; **share `HttpClient` and SDK clients as singletons** via DI rather than creating them per invocation (socket exhaustion); cap concurrency so a burst doesn't overwhelm the database.
- **Durable Functions** run stateful workflows in code. An **orchestrator** calls **activities**, and every step's result is appended to a **history** of events (event sourcing applied to workflow progress). After a restart, the orchestrator **replays** from the top, and completed `await`s return their recorded results instead of re-running. That's how it survives restarts and can wait **days** for a timer or a human approval while holding no resources. It's also why **orchestrator code must be deterministic**: no `DateTime.Now`, `Guid.NewGuid()`, random numbers or direct I/O, only `ctx.CurrentUtcDateTime`, `ctx.NewGuid()` and activities. Otherwise a replay takes a different path than the recorded history. `catch (TaskFailedException) { await ctx.CallActivityAsync(nameof(ReleaseStock), ...) }` is a saga compensation. Patterns: chaining, **fan-out/fan-in**, async HTTP APIs (202 plus a status URL built in), monitors, human interaction, durable entities. The **Durable Task Scheduler** is a managed backend.
- **Container Apps**: Kubernetes capability without running a cluster.
  - **Environment**: the shared VNet and Log Analytics boundary; apps inside it talk internally.
  - **Container app**: main container plus sidecars, with ingress, scale rules, secrets and identity.
  - **Revisions**: immutable versions that can run side by side with **traffic splitting** (90/10 canary, blue/green).
  - **Ingress**: external or internal.
  - **KEDA scale rules**: HTTP concurrency, CPU, **Service Bus queue length** (`messageCount: 50`, `minReplicas: 0`, so a worker scales to zero when idle), Kafka lag, cron.
  - **Jobs**: run-to-completion, manual, **scheduled** or **event-driven**.
  - Optional **Dapr** sidecars (service invocation, pub/sub, state); consumption or dedicated **workload profiles** (including GPUs).

  It's the sweet spot for .NET microservices (API, worker, outbox relay and cron jobs together), and **Aspire deploys here with `azd up`**.
- **AKS**: Azure runs the control plane; **you** own node pools and everything deployed. Choose it only when you need the full Kubernetes API and ecosystem (Helm, operators, service meshes, custom controllers), a shared multi-team platform, multi-cloud consistency or fine scheduling and network control, **and** you have platform engineers. Integrations: **Workload Identity** (pods get Entra identities), the Key Vault CSI driver, ACR pull, Azure CNI, KEDA and the cluster autoscaler, managed NGINX ingress, Container Insights and managed Prometheus/Grafana, and **AKS Automatic** for a more managed mode.
- **VMs** are for lift-and-shift of IIS/.NET Framework apps, special OS needs or licensing, and you own patching, hardening, backups and scaling. Also: **Static Web Apps** for SPAs with Functions APIs, **Batch** for parallel compute.
- **Decision guide and interview comparisons.**
  - Small, event- or timer-triggered, spiky → **Functions (Flex)**.
  - Long stateful workflows → **Durable Functions** (or sagas).
  - A simple web app or API → **App Service**.
  - Several containerised services, workers and jobs with scale-to-zero and no cluster ops → **Container Apps**.
  - Full Kubernetes and the team for it → **AKS**.
  - Legacy → **VMs**.

  The comparisons interviewers ask about:
  - **App Service vs Container Apps**: slots and always-on plans vs KEDA, scale to zero, revisions and Dapr.
  - **Container Apps vs AKS**: hidden Kubernetes (no cluster upgrades, no K8s API) vs the full API with full responsibility.
  - **Functions vs Container Apps**: a trigger/binding programming model with per-execution billing vs any container with KEDA scaling.
  - **Consumption vs Premium**: scale to zero with cold starts and time limits vs pre-warmed instances, VNet and always paying for the minimum.

### 8.4 · Azure data and messaging services

[Full chapter →](ch:azure-data-messaging)

- **These are managed versions of things covered earlier.** What changes in Azure is operations: HA, backups, scaling, identity and networking are configuration you set, not work you do yourself.
- **Azure SQL deployment options.**
  - **Single database**: the default.
  - **Elastic pool**: many databases sharing resources, the usual way to do SaaS **database-per-tenant**, where tenants peak at different times.
  - **SQL Managed Instance**: near-complete SQL Server compatibility (SQL Agent, cross-database queries, CLR) for lift-and-shift.
  - SQL Server on a VM, if you need full control.
- **Azure SQL purchasing.** Use the **vCore** model.
  - **General Purpose**: remote storage, balanced.
  - **Business Critical**: local SSD, a built-in **readable replica**, lowest latency.
  - **Hyperscale**: up to 128 TB, fast scaling, multiple read replicas, near-instant backups.
  - **Serverless**: auto-scales compute and **auto-pauses** when idle, so the first query after a pause waits. Good for dev and intermittent load.

  DTU is the legacy bundled model.
- **Azure SQL availability and DR.**
  - 99.99% HA built in, plus zone redundancy.
  - **Point-in-time restore** (7–35 days) and long-term retention (up to 10 years).
  - **Active geo-replication** gives readable secondaries in other regions.
  - **Failover groups** add automatic geo-failover behind a **stable listener endpoint**, so connection strings don't change after failover.
  - **Read scale-out** sends `ApplicationIntent=ReadOnly` connections to a replica.
- **Azure SQL security.** Use **passwordless Entra auth**: `Authentication=Active Directory Default` in the connection string, then `CREATE USER [app-shop-api-prod] FROM EXTERNAL PROVIDER` and grant `db_datareader`/`db_datawriter`, or narrower roles. Disable public access in favour of a private endpoint. Encryption and auditing:
  - **TDE** encrypts at rest and is on by default;
  - **Always Encrypted** encrypts columns client-side, so even DBAs can't read them;
  - **dynamic data masking** and **row-level security**;
  - auditing, Defender for SQL and the **ledger** (tamper evidence).
- **Azure SQL behaves differently from on-premises.** Failovers and reconfigurations are **normal transient faults**, so **always enable retries** (`EnableRetryOnFailure`). **RCSI is on by default**: readers see the last committed version instead of blocking on writers, which changes locking behaviour compared with an on-premises default. Query Store is on, and automatic tuning can create and drop indexes.
- **PostgreSQL Flexible Server**: managed Postgres with zone-redundant HA, read replicas, **built-in PgBouncer** connection pooling, extensions (**pgvector** for embeddings, PostGIS, pg_cron), Entra auth, and stop/start for dev. With Npgsql and EF Core it's first-class for .NET and often cheaper than SQL Server licensing.
- **Cosmos DB essentials.**
  - The hierarchy is account → database → **container** → items. The container is the unit of scale, and its **partition key** is the decision you can't easily undo.
  - Throughput is in **Request Units**: provisioned manually, autoscale, or serverless.
  - Five **consistency levels**: Strong, Bounded staleness, **Session** (the default: you read your own writes within your session), Consistent prefix, Eventual.
  - One-click global distribution with multi-region writes (99.999% SLA).
  - The **change feed** is an ordered stream of changes per partition, used for materialised views, events and search sync.
  - Everything is **auto-indexed** by default; tune the policy to cut write RU cost. There are vector indexes.
  - TTL expiry; transactions only **within one logical partition**.

  In code: a **singleton `CosmosClient`**, prefer **point reads** (id + partition key, the cheapest operation) over queries, log `RequestCharge`, and expect **429**s, which the SDK retries within limits.
- **Storage accounts.** Redundancy options: **LRS** (3 copies in one datacentre), **ZRS** (across zones), **GRS/RA-GRS** (copied to the paired region, optionally readable), **GZRS**. **Blob access tiers** trade storage cost against access cost:
  - **Hot**: frequent access;
  - **Cool**: 30+ days;
  - **Cold**: 90+ days;
  - **Archive**: 180+ days, **offline, and rehydration takes hours**.

  **Lifecycle policies** move blobs between tiers by age. **Soft delete**, versioning and **immutable (WORM) storage** protect against accidental and ransomware deletion. ADLS Gen2 adds a hierarchical namespace for data lakes.
- **SAS and the valet key.** A **SAS** is a time-limited, permission-scoped signed URL. Prefer **user delegation SAS** (signed with Entra credentials, so it's revocable and audited) over account-key SAS, and **disable shared-key access** entirely in favour of RBAC (`Storage Blob Data Contributor`). The **valet key pattern** has the API hand out a short-lived SAS URL so clients upload and download **directly to Blob**, keeping large files off your API (the HTTP equivalent of claim-check).
- **Other storage services.**
  - **Storage Queues**: 64 KB messages, at-least-once, no topics, sessions or DLQ. Fine for simple work queues; use Service Bus for business messaging.
  - **Table Storage**: PartitionKey + RowKey lookups.
  - **Azure Files**: SMB/NFS shares for legacy apps.
  - **Azurite**: the local emulator for Blob, Queue and Table.
- **Azure Managed Redis** replaces Azure Cache for Redis, whose classic tiers are being retired. Use it as the `HybridCache`/`IDistributedCache` L2, for sessions, rate limiting, a SignalR backplane or output cache. Connect with **Entra auth** (`Microsoft.Azure.StackExchangeRedis`) over a private endpoint, and use zone redundancy, an eviction policy and TTLs.
- **Service Bus vs Event Grid vs Event Hubs** (the classic interview question). They solve different problems:
  - **Service Bus**: **reliable business messaging**. **Peek-lock** (receive → complete, abandon or dead-letter), DLQ, sessions for FIFO, scheduled and deferred messages, duplicate detection, transactions; 256 KB messages (Standard) or 100 MB (Premium). Use it for orders, payments, workflows and sagas.
  - **Event Grid**: **push-based routing of discrete "something happened" events** to Functions, webhooks or queues, with retries up to 24 h and dead-lettering to Blob. No ordering. Use it for "a blob was created → resize the image".
  - **Event Hubs**: a **partitioned log for firehose ingestion** (millions of events/s). Consumers **pull** and track offsets; retention is 1–90 days and you can **replay**; there's a Kafka endpoint and Capture to Blob. Use it for telemetry, clickstreams, IoT and event-sourcing pipelines.

  They're often combined: Event Grid routes `BlobCreated` into a Service Bus queue for a worker. Service Bus tiers: Basic (queues only), Standard (topics, shared capacity), **Premium** (dedicated capacity, private endpoints, large messages, geo-replication; the production choice). There's a local **emulator**.
- **Using Azure SDK clients well.** All `Azure.*` clients follow the same rules:
  - **They're thread-safe; register them as singletons** via `AddAzureClients` (Microsoft.Extensions.Azure). They hold connections, which is the `HttpClient` lesson again.
  - Authenticate with `Azure.Identity` credentials.
  - They have **built-in retries** (`ClientOptions.Retry`), so **don't stack Polly retries on top** or you build a retry storm.
  - They emit `ILogger` and OpenTelemetry through `Azure.*` ActivitySources.
  - They're async throughout, with `CancellationToken`, and page with `AsyncPageable<T>` (`await foreach`).

  Aspire integrations (`AddAzureServiceBusClient("bus")`) wire all of this up with health checks.

### 8.5 · Azure identity and secrets

[Full chapter →](ch:azure-identity-secrets)

- **The order of preference.** Secrets leak: they get committed, logged, pasted in chat and rarely rotated.
  1. **No secret at all**: the app authenticates **as an identity** that Entra issues (a managed identity), and access is granted by RBAC.
  2. If a secret is unavoidable (a third-party API key), put it in **Key Vault**, read it via managed identity and rotate it.
  3. **Never** in source control, images or config files.
- **Entra ID vocabulary.**
  - **Tenant**: the identity boundary.
  - **App registration**: the app's **definition** (client ID, redirect URIs, exposed scopes, app roles, credentials).
  - **Service principal** (an "enterprise application"): the app's **instance in a tenant**, the security principal that actually receives permissions. One multi-tenant registration has a service principal in every tenant that uses it.
  - **Managed identity**: a service principal Azure manages *for a resource*.
  - **Scopes** (`orders.read`, delegated user permissions) vs **app roles** (`Orders.Admin`, which can be assigned to users or to apps).
  - **Conditional Access/MFA**: sign-in policies.
  - **Entra External ID**: customer identity (CIAM), succeeding Azure AD B2C.
- **Two permission systems people confuse.** **Azure RBAC** controls access to **Azure resources** ("app-shop-api can read blobs in stshopprod"). **Entra roles and app permissions** control **Entra itself, Microsoft Graph and your own APIs** ("Global Administrator", "can call Graph `User.Read.All`", "client may call `api://shop` `orders.write`").
- **Managed identities.** Your code asks a **local platform endpoint** for a token, and Azure holds and rotates the underlying credential. There is **no secret anywhere** for an attacker to find. That's not just harder to steal; nothing exists to steal.
  - **System-assigned**: tied to one resource and deleted with it.
  - **User-assigned**: a standalone resource shared by many apps. Use it to pre-provision access before the app exists, for blue/green, and for AKS workload identity.

  Grant **data-plane roles at narrow scope**: `Storage Blob Data Contributor` on just the `invoices` container, `Azure Service Bus Data Sender` on the namespace, `Key Vault Secrets User` on the vault. Supported by SQL, Postgres, Storage, Service Bus, Event Hubs, Cosmos, Key Vault, App Configuration, Redis, Azure OpenAI, ACR and more.
- **`DefaultAzureCredential`** tries a chain and uses the first credential that works: **Environment** variables → **WorkloadIdentity** (Kubernetes) → **ManagedIdentity** (Azure hosts) → Visual Studio and VS Code → **Azure CLI** (`az login`) → PowerShell, azd → interactive (off by default). The payoff is that the **same code** runs as *you* on your laptop and as the *managed identity* in Azure, with no `#if DEBUG`. **Production caveats**: the chain can be **slow to fail** while it tries every option, and it can pick up an **unexpected credential**, such as a stray env var on a host. Use a deterministic credential instead: `new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(id))`, a `ChainedTokenCredential` of exactly what you expect, or exclusions in options. Give developers the same RBAC roles on dev resources so local runs work.
- **RBAC in practice.** A role assignment is **principal + role definition + scope**, and it inherits downward from management group to subscription, resource group, resource and sub-resource. **Control plane vs data plane** is the key distinction: *Contributor* on a storage account lets you reconfigure the account but **doesn't let you read its blobs**, which needs a data role. Giving an app Contributor "to be safe" is a textbook least-privilege violation. Practices: data roles at the narrowest scope, groups for humans, **one identity per app per environment**, **PIM** for just-in-time admin elevation, and regular access reviews.
- **Key Vault** holds three kinds of object:
  - **secrets**: versioned, with expiry, and rotation events via Event Grid;
  - **keys**: RSA/EC keys that **never leave the vault or HSM**; the vault signs and decrypts for you. Used for customer-managed encryption, JWT signing and **protecting the Data Protection key ring**. Premium is HSM-backed, and Managed HSM is single-tenant;
  - **certificates**: auto-renewed, used by App Service, App Gateway and Front Door.

  Use RBAC access (`Key Vault Secrets User`), **soft delete plus purge protection**, a private endpoint and access logging. Four ways to consume it:
  1. **The config provider** `AddAzureKeyVault` (`Payments--ApiKey` becomes `Payments:ApiKey`, with an optional `ReloadInterval`), bound to validated options.
  2. **`SecretClient`** for on-demand reads.
  3. **Data Protection**: `PersistKeysToAzureBlobStorage(...).ProtectKeysWithAzureKeyVault(...)`, the shared key ring that multi-instance cookie auth needs.
  4. **Platform references** (`@Microsoft.KeyVault(SecretUri=...)` in App Service, Functions or Container Apps settings), with no code at all.

  **Key Vault is throttled** (thousands of operations per 10 s per vault), so **load at startup and cache**; never call `GetSecretAsync` per request.
- **Workload identity federation** gives "no secret" to things that aren't Azure resources. An external IdP's token is **exchanged** for an Entra token. Example: a GitHub Actions job gets an OIDC token whose subject is `repo:org/shop:environment:prod`, and Entra has a **federated credential trusting exactly that subject**, so `azure/login` with only a client ID, tenant ID and `id-token: write` gets an access token, and **no client secret is stored in GitHub**. **AKS Workload Identity** works the same way: a Kubernetes service account is federated with a user-assigned identity, and pods get tokens via `WorkloadIdentityCredential`. It also covers Azure DevOps service connections, other clouds and Arc.
- **Protecting your own API with Entra.**
  1. Register the API (`api://shop-api`), **expose scopes** (`orders.read`) and **define app roles** (`Orders.Reader`).
  2. The SPA gets a **delegated** permission to `orders.read`, which acts on behalf of the user and arrives in the `scp` claim.
  3. The billing worker's managed identity is assigned the **application** role, with no user involved, which arrives in the `roles` claim.
  4. The API validates issuer and audience with `AddMicrosoftIdentityWebApi`, and a policy accepts **either** `scp` contains `orders.read` **or** the role `Orders.Reader`.

  To call another API **as the service**, use client credentials via managed identity: `GetTokenAsync(new(["api://inventory-api/.default"]))`. `.default` means "all application permissions granted to me".

### 8.6 · CI/CD and infrastructure as code

[Full chapter →](ch:cicd-iac)

- **CI, continuous delivery, continuous deployment.**
  - **Continuous integration**: merge to main at least daily, and every push builds and tests; a broken build is fixed immediately.
  - **Continuous delivery**: every passing change *is releasable*, but going to production is a **business decision** (an approval).
  - **Continuous deployment**: every passing change ships automatically, which demands strong tests, monitoring and progressive delivery.

  Small, frequent, automated releases are **less risky** than big, rare ones: each change is small enough to understand and roll back, and the process is identical every time. **DORA metrics** measure this: deployment frequency, lead time for changes, change failure rate, time to restore (*Accelerate*).
- **Branching.** **Trunk-based** development (branches that live hours, with **feature flags** hiding unfinished work) is what the DORA research favours. **GitHub Flow** (main is always deployable; PR → checks → merge → deploy) suits most service teams. **GitFlow** (develop, release and hotfix branches) is heavyweight and suits versioned products. Release branches suit libraries and on-premises software. Protect `main` with required reviews and checks (build, tests, analyzers, security scans), keep PRs small, and automate dependency bumps.
- **Pipeline anatomy.** **CI**: restore → build with **warnings as errors** → unit tests → integration tests (Testcontainers) → analyzers and format → coverage → SCA/SAST → report status on the PR. **CD**: **build the image once** and push to ACR **tagged with the git SHA** → deploy to dev → smoke → staging (slot or revision) → **migrations** → smoke/E2E → **approval** → prod (swap or canary) → monitor. **Build once, deploy many**: the same artefact (image digest) is promoted, and only configuration differs, so what you tested is exactly what runs.
- **GitHub Actions concepts.**
  - Workflows are YAML in `.github/workflows`, started by `on:` triggers.
  - **Jobs** run in parallel unless they declare `needs:`, and each job is a list of steps.
  - Steps use marketplace **actions**, and run on GitHub-hosted or self-hosted **runners**.
  - **Environments** carry protection rules, required approvers and scoped secrets.
  - Also: **matrix** builds, caching, and **reusable workflows** and composite actions to share pipelines across repos.

  The example pipeline makes `deploy-staging` run the **EF migration bundle and curl the readiness endpoint** before `deploy-prod` can start, so the pipeline enforces "migrate, verify, promote" instead of trusting someone following a runbook under pressure.
- **Azure DevOps Pipelines**: **stages → jobs → steps**, with **tasks** instead of actions, **service connections** (use workload identity federation), environments with approvals and checks, **variable groups** (which can be Key Vault-linked) and templates.
- **Deployment strategies**, in order of shrinking blast radius:
  - **Recreate**: downtime.
  - **Rolling**: replace instances gradually (Kubernetes Deployments).
  - **Blue/green**: run the new version alongside and switch **all** traffic at once, with instant switch-back (an **App Service slot swap**, a 100% Container Apps revision switch).
  - **Canary**: a small percentage first, increased while metrics stay healthy (**Container Apps traffic splitting**, Front Door weights, Argo Rollouts/Flagger).
  - **Feature flags**: deploy dark, enable per user or percentage, and roll back by turning the flag off (App Configuration + `Microsoft.FeatureManagement`).
  - **Rings**: internal users → early adopters → everyone.

  **Progressive delivery** adds automated health analysis against SLOs, so promotion or rollback happens without a human.
- **Database changes in a continuous pipeline.** During a rolling or blue/green deploy, **old and new code run against the same schema at once**, so every migration must work with both. **Expand → migrate → contract**:
  1. Add the new column or table nullable or with a default, so old code is unaffected.
  2. Deploy code that **writes both** shapes and reads the new one.
  3. Backfill.
  4. In a **later** release, drop the old shape.

  **Never rename or drop a column in the same release that stops using it.** Run migrations as a pipeline step **before** the app deploys, with **idempotent scripts or EF migration bundles** and a **separate migration identity with DDL rights**; the app's identity gets DML only. DBA-owned schemas use DACPAC, DbUp, Flyway or Liquibase. Verify point-in-time restore and test against a production-like copy before risky changes.
- **Versioning and supply chain.** Use **SemVer** for libraries and public APIs, and **git-SHA image tags** for services (immutable and traceable). MinVer or Nerdbank.GitVersioning derive the version from git; stamp `AssemblyInformationalVersion` with the SHA and expose it on `/version` and as `service.version` in telemetry. **Never deploy anything the pipeline didn't build.** Supply-chain hygiene: SBOMs, signed images and provenance (SLSA), **third-party actions pinned by commit SHA** (a tag can be moved to malicious code), least-privilege workflow `permissions:`, and secret scanning with push protection.
- **Infrastructure as Code.** IaC gives you reproducible environments (dev = staging = prod with different parameters), infrastructure changes reviewed in PRs, **drift detection** (`what-if`/`plan` shows manual portal changes), disaster recovery by re-applying, and code that *is* the documentation. Prefer **declarative and idempotent** tools: describe the end state and let the tool compute the diff, so applying twice changes nothing.
- **Bicep vs Terraform vs Pulumi.**
  - **Bicep**: Azure-only, compiles to ARM, **no state file** because Azure itself is the state, day-zero support for new features. `az deployment group what-if` previews changes; use modules, **Azure Verified Modules**, `.bicepparam` files per environment, and deployment stacks.
  - **Terraform**: multi-cloud plus SaaS providers, HCL, and a **state file** you must store remotely with locking (an Azure Storage backend). `plan` then `apply`; there's some provider lag, which AzAPI bridges.
  - **Pulumi**: IaC in **C#** or another general-purpose language.
- **azd and GitOps.** **azd** ties templates, IaC and deploy together: `azd up` provisions and deploys, and `azd pipeline config` generates CI with federated credentials. For Aspire, it **generates the infrastructure from the AppHost model**. **GitOps** (Argo CD, Flux) makes a Git repo the source of truth for cluster state. CI only bumps the image tag in the config repo; an in-cluster agent **pulls** and reconciles, which gives drift correction, an audit trail and rollback by `git revert`.

### 8.7 · Kubernetes

[Full chapter →](ch:kubernetes)

- **Desired state plus reconciliation.** You declare "3 replicas of shop-api:1.4.2, 0.5 CPU each, reachable at orders.shop.com", and **controllers** loop forever (observe → compare with desired → act) to make it true. That loop handles:
  - **scheduling** onto nodes with capacity;
  - **self-healing**: restart crashed containers, replace pods on dead nodes, kill pods failing liveness;
  - **scaling**;
  - **service discovery and load balancing**;
  - **rolling updates and rollbacks**;
  - config and secret injection, and volume attachment.

  The win is a portable, standard platform with a huge ecosystem. The cost is **complexity**: networking, security, upgrades and YAML need platform engineers. Container Apps gives most of the benefit with none of the cluster management.
- **Architecture.** The **control plane** (managed in AKS) has:
  - **kube-apiserver**: everything talks to it;
  - **etcd**: the state store;
  - the **scheduler**: assigns pods to nodes;
  - the **controller-manager**: the reconcile loops;
  - the cloud-controller-manager.

  Each **node** runs a **kubelet** (starts pods and reports status), kube-proxy or a CNI dataplane, and a container runtime. Everything is an **API object** in YAML, `kubectl apply`'d, stored in etcd and acted on by controllers.
- **Core objects.**
  - **Pod**: the smallest unit. Containers in it share localhost and volumes; it has its own IP and is **ephemeral**.
  - **ReplicaSet**: keeps N pods running.
  - **Deployment**: pods + replicas + **rolling update** strategy, with one ReplicaSet per version (that's how `rollout undo` works). This is how you run a stateless API or worker.
  - **Service**: a stable virtual IP and DNS name (`shop-api.shop.svc.cluster.local`) that load-balances across pods **selected by labels**. Types: ClusterIP, NodePort, LoadBalancer.
  - **Ingress / Gateway API**: external HTTP routing (hosts, paths, TLS) via a controller.
  - **ConfigMap**: env vars or a mounted `appsettings.Production.json`.
  - **Secret**: **base64-encoded, not encrypted** by default.
  - **Namespace**: isolation, quotas and RBAC.
  - **StatefulSet**: stable identity and storage, for databases (usually better as PaaS).
  - **DaemonSet**: one pod per node, for agents.
  - **Job / CronJob**: run to completion, or on a schedule (migrations, batch).
  - **HPA**, **PVC**, and **ServiceAccount** (pod identity, and the hook for workload identity).
- **Probes, mapped to the two health endpoints.**
  - **startup**: "finished starting?" Liveness waits until it passes, so slow starters aren't killed mid-boot.
  - **liveness** (`/health/live`): "deadlocked?" On failure the container is **restarted**. **Never check dependencies here**, or a database blip restarts every pod.
  - **readiness** (`/health/ready`): "can it serve now?" On failure the pod is **removed from Service endpoints**. Don't make it so strict that every pod goes unready together.
- **Termination sequence, and the race in it.** When a pod is deleted (rolling update, scale-in, node drain):
  1. It's marked Terminating, **removed from Service endpoints (asynchronously)**, and any `preStop` hook runs.
  2. **SIGTERM** reaches PID 1, and the .NET host stops accepting connections, drains in-flight requests and stops hosted services.
  3. After `terminationGracePeriodSeconds` (default 30 s), **SIGKILL**.

  Because endpoint removal propagates asynchronously to every node and load balancer, a pod can **still receive new requests after SIGTERM**. Mitigate with `preStop: sleep 5`, so traffic stops arriving before the app stops accepting it. Keep `HostOptions.ShutdownTimeout` below the grace period so draining finishes before SIGKILL.
- **Requests, limits, QoS.** **Requests** reserve capacity for scheduling; **limits** cap usage. Over the **memory** limit the container is **OOMKilled**. Over the **CPU** limit it's **throttled** for the rest of each CFS period, so you get latency spikes rather than a crash. That's why many teams set CPU *requests* but **no CPU limit** on latency-sensitive .NET services. QoS classes: **Guaranteed** (requests = limits), Burstable, **BestEffort** (no requests, evicted first). .NET reads the cgroup limits (GC heap about 75% of the memory limit, CPU count from the quota), and **DATAS** keeps Server GC memory proportional to load.
- **Autoscalers.**
  - **HPA**: replicas on CPU, memory or custom metrics.
  - **KEDA**: replicas **including down to zero**, driven by events (Service Bus queue length, Kafka lag, Prometheus queries, cron), via a `ScaledObject`.
  - **VPA**: right-sizes requests; recommendation mode is the safe one.
  - **Cluster autoscaler** and node auto-provisioning: add **nodes** when pods are stuck Pending.
- **Config, secrets, identity.** ConfigMaps become **env vars** (`Payments__BaseUrl`) or **mounted files** (with `reloadOnChange`, or `AddKeyPerFile` for one file per key). Native Secrets are only base64, so prefer the **Key Vault Secrets Store CSI driver**, External Secrets Operator, or best of all **Workload Identity**: annotate a ServiceAccount with a user-assigned identity's client ID, pods get federated tokens, and `DefaultAzureCredential` reaches SQL, Service Bus and Key Vault with **no secrets in etcd**.
- **Packaging and delivery.** **Helm** charts are templated manifests with a `values-<env>.yaml` per environment (`helm upgrade --install`); Helm also installs third-party software like ingress-nginx, cert-manager and KEDA. **Kustomize** uses template-free base-plus-patch overlays (`kubectl apply -k`). **GitOps** (Argo CD, Flux) gives pull-based reconciliation from Git with drift correction and rollback by revert. **Argo Rollouts / Flagger** run canaries with automated metric analysis.
- **Operating it.** Everyday commands: `kubectl get pods -o wide`, **`describe pod`** (events show scheduling failures, probe failures, OOMKilled and image pull errors), `logs -f deploy/...`, `rollout status`, `rollout undo`. Chiseled images have no shell, so use **`kubectl debug` with an ephemeral SDK container** to attach dotnet-trace or dotnet-counters. Failure states to recognise:
  - **CrashLoopBackOff**: the app exits on start; check logs, config and missing env vars.
  - **ImagePullBackOff**: wrong tag, or no `AcrPull`.
  - **OOMKilled**: raise the limit or fix a leak.
  - **Pending**: no capacity, or unsatisfiable affinity or taints.
  - **Not ready**: a dependency is down, or the probe path is wrong.
- **AKS specifics.** The control plane is free; the Standard tier adds an SLA, and **AKS Automatic** is a more managed mode.
  - **Node pools**: system vs user, spot, GPU, Windows, with auto-upgrade channels and maintenance windows.
  - **Networking**: Azure CNI Overlay, network policies (Calico/Cilium), private clusters, App Gateway for Containers, and the managed NGINX routing add-on.
  - **Identity and secrets**: Entra-integrated kubectl RBAC, Workload Identity, ACR attach, the Key Vault CSI add-on.
  - **Scaling**: KEDA add-on, cluster autoscaler.
  - **Observability**: Container Insights, managed Prometheus/Grafana.
  - **Security**: Defender for Containers, Azure Policy for Kubernetes.
  - **Mesh**: an Istio-based mesh add-on.

## Part IX · Performance and Internals

### 9.1 · Memory and garbage collection

[Full chapter →](ch:memory-gc)

- **Why a GC.** In C and C++ you free memory by hand, which gives you **leaks**, **use-after-free** (a security hole) and **double free** (memory corruption). The .NET GC frees an object once it can **prove nothing can reach it**, so the last two bug classes essentially disappear. The price is CPU time and **pauses**. The thread running through all .NET performance work: **allocation rate drives GC frequency, and GC frequency drives latency**. Tuning usually means allocating less, not making the GC faster.
- **Stack vs managed heap.**
  - The **stack** belongs to one thread (about 1 MB on Windows, 8 MB for Linux's main thread) and holds method frames: locals, parameters, return addresses. It's freed the instant the method returns. Overflowing it gives `StackOverflowException`, which **you can't catch**; the process dies.
  - The **heap** is shared by the whole process and holds reference-type objects, boxed values, arrays, closures and **suspended async state machines**.

  Surprise: heap allocation is *also* cheap. Each thread has an **allocation context**, a reserved chunk where a new object is mostly a pointer bump. The cost isn't the allocation; it's **how often filling that space forces a collection**.
- **Generations** follow the *generational hypothesis*: **most objects die young**. A request's temporary strings, DTOs and enumerators are garbage within milliseconds, while caches and singletons live forever.
  - New objects start in **Gen0**, which is small and so fast to scan (often under 1 ms), and mostly garbage by the time it's collected, so a Gen0 GC reclaims a lot for little work.
  - Survivors are **promoted** to **Gen1** (a buffer), then to **Gen2** (long-lived).
  - A Gen1 GC collects 0+1. A **Gen2 (full) GC** collects everything **including the LOH**, and is the expensive one the design tries to keep rare.

  How does a Gen0 GC know whether an old Gen2 object points at a young one without scanning all of Gen2? A **write barrier**: every time you store a reference into an object, a little code marks the matching entry in a **card table**, and a Gen0 GC checks only the marked cards.
- **The "mid-life crisis".** Gen0 garbage is cheap. The expensive pattern is objects that live **just long enough to be promoted and then die in Gen2**, forcing full GCs. Examples: per-request objects kept alive across a slow `await` that spans a GC, caches with slightly too-long expiry, and anything **≥ 85,000 bytes**, which goes straight to the LOH and is only reclaimed by a full GC.
- **What a collection does.**
  1. **Suspend** threads at safe points.
  2. **Mark**: from the **roots**, follow every reference and mark what's reachable.
  3. **Sweep and compact**: reclaim unmarked objects and slide survivors together, fixing up references, so the heap doesn't fragment. The LOH is swept into free lists, not compacted.
  4. **Resume**.

  The key insight: an object is collected only if it's **unreachable**, not if it's *unused*. The **roots** are static fields, locals and parameters on thread stacks and in registers, GC handles (strong and pinned), the **finalization (f-reachable) queue**, and interop/COM references. The JIT tracks liveness precisely, so a local can become collectable **before its method returns**, once it's no longer used. That's why `GC.KeepAlive` exists.
- **GC modes.**
  - **Workstation**: one heap; collects on the triggering thread; favours low memory and responsiveness. The default for desktop and console apps.
  - **Server**: **one heap and one GC thread per logical core**, collecting in parallel; more throughput, more memory. The **ASP.NET Core default**, because a server wants requests per second across all cores.
  - **Background GC**: Gen2 runs **concurrently** with your threads, so you see short pauses instead of a full stop; Gen0 and Gen1 still pause. On by default.
  - **DATAS** (default with Server GC since **.NET 9**): **adapts the number of heaps to the actual load** instead of always one per core.

  Knobs: `<ServerGarbageCollection>`, and env vars `DOTNET_gcServer`, `DOTNET_GCHeapHardLimit(Percent)`, `DOTNET_GCHeapCount`, `DOTNET_GCConserveMemory`.
- **The container trap DATAS fixed.** The GC is cgroup-aware and caps its heap at **75% of the container's memory limit**. But pre-DATAS Server GC counted **cores, not memory**: a 32-core node with a 512 MB container made **32 heaps**, blew through the limit and got **OOMKilled** with no leak at all. If you still see OOMKilled after .NET 9, check in this order: is the working set really over the limit, is *native* memory the GC can't see growing, is it a real leak. Only then reach for `GCHeapHardLimitPercent` or `GCConserveMemory`. For latency-critical niches there's `GCSettings.LatencyMode = SustainedLowLatency` (avoids blocking full GCs) and `GC.TryStartNoGCRegion(size)` (no GC at all within a pre-reserved allocation budget).
- **LOH and POH.** Objects **≥ 85,000 bytes** (big arrays and strings) go to the **Large Object Heap**, because copying huge objects during compaction would be costly. Consequences:
  - allocation is pricier, since the memory must be zeroed;
  - it's **only collected with Gen2**;
  - it's **not compacted by default**, so it **fragments**: plenty of free space in total, but in pieces too small for the next big request.

  So **don't allocate large buffers per request**: use `ArrayPool<T>.Shared`, stream instead of loading whole files, `RecyclableMemoryStream`, `System.IO.Pipelines`. A one-off LOH compaction (`GCLargeObjectHeapCompactionMode.CompactOnce` + `GC.Collect()`) treats the symptom. **Pinning** (`fixed`, `GCHandle.Alloc(..., Pinned)`) stops the GC moving an object, which interop and I/O buffers need, but a long-lived pin is a boulder compaction has to work around. The **Pinned Object Heap** (`GC.AllocateArray<byte>(n, pinned: true)`) gives buffers that are pinned from birth in their own region, so they never fragment the normal heap.
- **Finalizers are slow.** When an object with a `~T()` finalizer becomes unreachable:
  1. The GC **can't free it**. It moves it to the **f-reachable queue**, which is itself a root, so the object is **re-rooted and promoted** a generation.
  2. At some unpredictable time, the single **finalizer thread** runs `Finalize`.
  3. Only a **later** GC frees the memory.

  The result: an extra GC survived, early promotion, and no control over timing. That's why cleanup is `IDisposable` + `using`, why `Dispose` calls **`GC.SuppressFinalize(this)`** (cleanup already happened, so skip the finalizer and the generation hop), and why native handles should be wrapped in **`SafeHandle`** rather than a hand-written finalizer. And remember: **the GC doesn't release unmanaged resources promptly**. An undisposed `DbConnection` is a pool leak immediately, however much RAM is free.
- **Weak references.** `WeakReference<T>` refers to an object without keeping it alive (`TryGetTarget` returns false once it's collected). `ConditionalWeakTable` attaches data to an object without extending its life. For caching, prefer **`MemoryCache` with size limits and expirations**: predictable eviction beats eviction on the GC's timing.
- **Managed leaks are "reachable but useless".** Every leak is a root holding something it shouldn't. The usual suspects:
  - **static collections that only grow**;
  - **event handlers never unsubscribed** (a singleton's event keeps every transient subscriber alive);
  - **captive dependencies** (a singleton holding a scoped `DbContext` whose change tracker grows forever);
  - **unbounded channels** with a slow consumer;
  - **undisposed timers**;
  - closures capturing `this` or big objects;
  - **disposable transients resolved from the root provider** (tracked until shutdown);
  - long-lived DbContexts;
  - `HttpClient` created per call;
  - native buffers.

  **The tell**: Gen2 size and working set **keep rising under steady load and never come back down**, even after full GCs. Healthy memory goes up and down with load; a leak's *floor* rises.
- **Finding a leak.**
  1. `dotnet-counters monitor --counters System.Runtime` shows whether you have a problem and how fast it grows: heap per generation, % time in GC, allocation rate, gen counts, LOH size.
  2. Take two `dotnet-gcdump` snapshots minutes apart under steady load and **diff** them to see which **type's count keeps climbing**.
  3. Take a `dotnet-dump`, then `dumpheap -stat`, `dumpheap -mt <type>`, and **`gcroot <address>`**, which prints the **chain of references keeping that instance alive**, back to its root. That tells you which leak pattern you have.

  Also: Visual Studio's memory profiler, dotMemory, PerfView, and `kubectl debug` in a cluster. Numbers to watch: **% time in GC** (sustained over ~10% is a real problem), allocation MB/s, Gen2 count, **heap size right after a Gen2 GC** (the clearest leak signal; it should be flat), GC pause times (which directly hit p99), LOH size.
- **Allocation-friendly code**, used only on hot paths that measurement found:
  - `StringBuilder`, `string.Create` and interpolation handlers instead of `+=` in loops;
  - `Span<T>`/`ReadOnlySpan<char>` slicing instead of `Substring` and `Split`;
  - `ArrayPool` or a small `stackalloc` instead of `new byte[64K]`;
  - `readonly struct` and `record struct` for tiny values;
  - generics instead of boxing;
  - pre-sized collections;
  - **static lambdas** to avoid capture allocations;
  - `ValueTask` for usually-synchronous methods;
  - cached `JsonSerializerOptions`, JSON source generation and `[LoggerMessage]`;
  - `AsNoTracking` with projections;
  - streaming;
  - `FrozenDictionary` and `ObjectPool<T>`.

  Most business code is I/O-bound, so **measure first**. And **don't call `GC.Collect()`** in production: it promotes objects before they've earned it, wastes CPU and pauses at a moment you didn't choose. The only legitimate uses are tests, benchmarks and after a one-off huge batch cleanup.

### 9.2 · Threading and concurrency

[Full chapter →](ch:threading-concurrency)

- **Three different words.**
  - **Concurrency**: several things *in progress* at once, possibly interleaved.
  - **Parallelism**: several things *executing at the same instant* on different cores, to speed up CPU work (`Parallel`, PLINQ).
  - **Asynchrony**: not blocking a thread while waiting on I/O (`async`/`await`).

  A web server is massively concurrent, mostly asynchronous, and only occasionally parallel. Multithreading is the underlying mechanism.
- **Threads are expensive, hence the pool.** Each OS thread reserves about 1 MB of stack and takes milliseconds to create, and too many threads means the OS spends its time context-switching. The **thread pool** reuses workers, and in ASP.NET Core it runs everything: every request, every `await` continuation (there's no `SynchronizationContext`), `Task.Run`, `Parallel` and timers. **`TaskCreationOptions.LongRunning`** hints that a job needs a dedicated thread, so a forever-loop doesn't hog a pool thread.
- **How starvation happens.** The pool starts at about **one thread per core** and grows **slowly**: a hill-climbing algorithm, plus starvation detection that injects roughly **one thread every 0.5–1 s**. Growth is slow on purpose, because eager growth wastes the resources the pool exists to save. Meanwhile `.Result`, `.Wait()`, `Thread.Sleep` and blocking I/O **hold a pool thread for the whole wait**. Under a burst, blocked threads pile up faster than the pool can add new ones, and requests queue behind them. That's **thread-pool starvation**.
- **Race conditions.** `_count++` is **three steps**: read, add, write.
  1. Thread A reads 5.
  2. Thread B reads 5, because A hasn't written yet.
  3. A writes 6.
  4. B writes 6.

  Two increments, final value 6: **an update vanished with no exception**. That's why races hide in tests and show up under production load. The same shape appears in **check-then-act** (`if (!dict.ContainsKey(k)) dict.Add(k, v)`: both threads pass the check), hand-rolled lazy init, and iterating while another thread mutates. A plain `Dictionary` can be **silently corrupted** by concurrent writes, not just throw.
- **What's shared in a web app.** Locals, request-scoped services and `HttpContext` belong to one request, so they're safe. **Singletons, `static` fields, `IMemoryCache` entries, hosted services and `IOptionsMonitor` callbacks** are shared by every concurrent request. The rule: **every singleton must be thread-safe**.
- **`Interlocked`**: `Increment`, `Add`, `Exchange` and **`CompareExchange`** (compare-and-swap: "set to 1 only if it's still 0", the basis of lock-free code). These don't make the three steps faster; they make them **one indivisible CPU instruction**, so there's no "in between" for another thread to slip into. It's the fastest tool because there's no lock or waiting, but it covers **one variable**. Keeping two related values consistent needs a lock.
- **`lock` rules.** `lock (x)` compiles to `Monitor.Enter`/`Exit` in a `try/finally`, so the lock is released even on an exception. **C# 13 / .NET 9** adds a dedicated **`System.Threading.Lock`** type (`private readonly Lock _gate = new();`) that's faster; before that, use a private object. The rules:
  - lock on a **private readonly** object, never `this`, `typeof(X)` or a string, because outside code can lock those too;
  - keep the locked section **short**;
  - **never call unknown code** (events, callbacks) while holding a lock;
  - **never `await` inside a lock**.

  The last rule is enforced by the compiler, for this reason: a `Monitor` is **thread-affine**, meaning the thread that acquired it must release it, but code after an `await` can resume on a **different pool thread**. A lock held across an `await` could never be correctly released.
- **`SemaphoreSlim(1, 1)`** is the async-friendly lock: `await gate.WaitAsync(ct); try { ... } finally { gate.Release(); }`. The token-refresh example uses **double-checked locking**: check the fast path, acquire, **check again** (another caller may have refreshed while you waited), then do the work. `SemaphoreSlim(n)` with n > 1 isn't mutual exclusion; it's a **concurrency limiter** letting n callers in.
- **The rest of the toolbox.**
  - `ReaderWriterLockSlim`: many readers, one writer, sync only. An **immutable snapshot swapped with `Interlocked.Exchange`** is often simpler and faster.
  - Named **`Mutex`**: across processes.
  - `ManualResetEventSlim`, `CountdownEvent`, `Barrier`: signalling, mostly replaced by tasks and channels.
  - `Lazy<T>`: thread-safe lazy initialisation.
  - `AsyncLocal<T>` (per async flow) and `ThreadLocal<T>` (per thread).
  - **Distributed locks** (Redis, SQL app locks, Blob leases): across **machines**, because a C# lock only protects one process.
- **Deadlocks.** Thread 1 holds A and waits for B; thread 2 holds B and waits for A. Both are frozen forever, with no crash. **Coffman's four conditions** must all hold: mutual exclusion, hold-and-wait, no preemption, and a **circular wait**. **Break any one and deadlock is impossible.** In practice:
  - **always acquire locks in the same global order** (this breaks circular wait and prevents most real deadlocks);
  - **don't hold a lock while calling out**;
  - **use timeouts** (`Monitor.TryEnter`, `WaitAsync(timeout)`) so a deadlock becomes recoverable;
  - prefer lock-free designs (immutability, `Interlocked`, concurrent collections, channels);
  - **never block on async** where a `SynchronizationContext` exists. It's the same circular wait: `.Result` holds the UI thread, and the continuation needs that same thread.
- **Memory reordering.** Compilers, the JIT and CPUs may **reorder reads and writes** and **cache values in registers**, as long as **the running thread can't tell**. Nothing is promised about what *another* thread sees. Classic bug: `while (!_stop) { }`. The JIT sees nothing in the loop changes `_stop`, hoists the read into a register, and the loop **never sees another thread's `Stop()`**. Fixes: `volatile` or `Volatile.Read`/`Write` (force a real memory read or write), or locks and `Interlocked`, which are **full memory barriers** (another reason they fix more than the obvious bug). In practice, use a **`CancellationToken`** for stop signals, and leave hand-written lock-free code to experts.
- **Concurrent collections.**
  - `ConcurrentDictionary`: fine-grained locking with atomic `GetOrAdd`, `AddOrUpdate`, `TryUpdate`. **The value factory can run more than once** under a race (only one result is kept), so for expensive or side-effecting factories store **`Lazy<T>`** values.
  - `ConcurrentQueue` and `ConcurrentStack`: lock-free.
  - `ConcurrentBag`: thread-local optimised.
  - `BlockingCollection`: synchronous producer/consumer.
  - **`Channel<T>`**: async producer/consumer.
  - Immutable collections with `ImmutableInterlocked`.
  - `FrozenDictionary`: built once, read concurrently.
- **The copy-on-write snapshot.** Readers do `_flags.TryGetValue(...)` with **no lock**, because reading a reference is atomic. The writer **builds a whole new `ImmutableDictionary`** and swaps the *reference* with `Interlocked.Exchange`. A reader holding the old reference keeps a consistent, slightly stale snapshot. Nobody ever sees a half-updated dictionary because nothing is ever updated in place, only replaced. It's ideal for read-heavy, rarely-written data like feature flags and config.
- **Channels and backpressure.** `Channel.CreateBounded<T>(new(1_000) { FullMode = Wait, SingleWriter = true })`: when the channel is full, the **producer's `WriteAsync` awaits** until consumers make room. That's backpressure: the producer is automatically throttled to the consumers' speed. An **unbounded** channel with a slow consumer is a memory leak with extra steps. The pattern of one bounded queue, N workers using `ReadAllAsync`, `Complete()` and cancellation covers most in-process pipelines. **TPL Dataflow** handles branching multi-stage graphs.
- **Data parallelism.** `Parallel.For` with `MaxDegreeOfParallelism` for CPU work, where each iteration writes its **own index** so there's no shared state. **`Parallel.ForEachAsync`** with a degree limit for **bounded I/O fan-out**. PLINQ (`AsParallel()`). Caveats:
  - partitioning and merging have overhead, so trivial loops can get *slower*;
  - shared mutable state brings races back, so accumulate per thread with `localInit`/`localFinally`;
  - **avoid heavy parallel CPU work inside request handlers**, because it steals pool threads from other requests. Offload it to a background worker.
- **PR checklist:**
  - singletons hold only thread-safe or immutable state;
  - no unsynchronised, unbounded static caches;
  - **`DbContext` never shared across concurrent operations** (one per scope; `IDbContextFactory` for parallel work);
  - `HttpContext` never used outside its request;
  - no `.Result`, `.Wait()` or `Thread.Sleep` on request paths;
  - `lock` sections short, with no awaits or external calls;
  - background work bounded;
  - cross-instance coordination through distributed locks or the database, never a C# `lock`.

### 9.3 · Performance engineering

[Full chapter →](ch:performance-engineering)

- **Measure, don't guess.**
  1. Set a concrete goal: "p95 of GET /products < 150 ms **at 500 RPS**", not "faster".
  2. Measure a baseline in a production-like environment with production-like data.
  3. Find **the one thing dominating the time**, with traces, then a profiler.
  4. Change one thing, the cheapest fix for that bottleneck.
  5. Measure again, watching for regressions elsewhere.
  6. Stop when the goal is met, because more optimisation costs complexity.

  Knuth's full quote: premature optimisation is the root of all evil, "yet we should not pass up our opportunities in that critical 3%". Measurement is how you find the 3%.
- **Percentiles and Little's Law.** Out of 100 requests, if 98 take 50 ms and 2 take 5,000 ms, the **average is about 148 ms** and the **p99 is 5,000 ms**. The average describes nobody; p99 describes the unluckiest users. A page that fires 10 API calls hits that tail on nearly every load. **Little's Law**: **concurrency = throughput × latency**, so 500 RPS × 0.2 s = **100 requests in flight**. That's the number to size connection pools and thread budgets against.
- **Where time goes**, roughly in order of how often each is the culprit:
  1. **Database**: missing indexes, N+1, over-fetching, lock contention, chatty round trips.
  2. **Remote calls**: sequential calls that could be concurrent, no caching, no timeouts.
  3. **Thread-pool starvation**.
  4. **Serialization**: huge payloads, reflection serializers, whole entity graphs.
  5. **Allocations and GC**.
  6. **Lock contention**: a global lock in a singleton serialises every request.
  7. **Logging**: synchronous sinks, too much logging, interpolated messages.
  8. **Pure CPU work**: rarely the cause.

  **Look at a trace first** to see which category dominates before opening a profiler.
- **BenchmarkDotNet, not `Stopwatch`.** A Stopwatch loop is skewed four ways:
  - **JIT tiering**: early iterations run unoptimised Tier 0 code;
  - GC pauses land at random;
  - **dead-code elimination**: if the result is unused, the JIT may skip the work and you time nothing;
  - CPU frequency scaling.

  BenchmarkDotNet runs a separate Release process with warm-up, pilot runs, many iterations and statistics. Use `[MemoryDiagnoser]` and compare runtimes with `[SimpleJob(RuntimeMoniker.Net80)]` against a baseline job. In the example, `Split` takes 112 ns and **allocates 216 B** (the intermediate array), while `Span` takes 38 ns and allocates **zero**. On a path called a million times a minute, that's 216 MB of garbage. **Always look at the Allocated column.** Rules: Release mode, no debugger, **return the result** so the work can't be eliminated, realistic inputs. Remember a 70 ns win is invisible next to a 150 ms database call, so micro-benchmarks **verify a hypothesis about a hot path that profiling already found**; they're not where you start.
- **Diagnostics toolbox.**
  - **dotnet-counters**: live CPU, GC heap and gen counts, % time in GC, allocation rate, **thread-pool queue length and thread count**, exceptions/s, requests/s. The first look.
  - **dotnet-trace**: an EventPipe trace with CPU samples, allocations, **contention** and exceptions; convert it to **Speedscope** for flame graphs.
  - **dotnet-dump** with SOS: `clrstack -all` for hangs and deadlocks, `dumpheap`, `gcroot`, `syncblk` for lock owners.
  - **dotnet-gcdump**: heap diffs.
  - **dotnet-monitor**: a sidecar exposing all of these over HTTP, with **triggers** ("collect a trace when CPU > 80% for a minute"), for containers.
  - VS Profiler, dotTrace/dotMemory, PerfView, continuous profilers (App Insights Profiler, Pyroscope).
  - SQL tools: execution plans, Query Store, `SET STATISTICS IO`.
- **Reading the symptoms.**
  - **High latency, low CPU, thread count climbing** → **thread-pool starvation** or waiting on I/O or locks. Confirm with the ThreadPool Queue Length counter and threads blocked in `Wait`/`GetResult` in `clrstack -all`. This is the one people misread: "the server isn't even busy" is *evidence for* starvation, because requests are queued waiting for a thread, not computing.
  - **High CPU that grows with load** → a hot path, GC, serialization or **regex backtracking**. Use a CPU trace and flame graph.
  - **High % time in GC with saw-tooth memory** → allocation rate or LOH churn.
  - **Memory that grows forever** → a leak (gcdump diff, then `gcroot`).
  - **Slow only under concurrency** → lock contention, **connection-pool exhaustion** or DB locking.
  - **One endpoint slow** → its trace spans.
- **Load testing** asks a different question from benchmarks: the **system** under realistic concurrency, where a fast method can still collapse on a shared connection pool. A **k6** script ramps virtual users and asserts thresholds (`p(95)<150`, `http_req_failed rate<0.01`). Test types:
  - **load**: expected peak against SLOs;
  - **stress**: past peak, to see *how* it breaks. Correct is shedding with 429/503 while still serving what it can; falling over is a future incident;
  - **spike**: does autoscaling react in time?
  - **soak**: hours at steady load, which surfaces leaks;
  - **capacity**: instances per N RPS, for cost planning.

  Tools: k6, NBomber (C#), **Azure Load Testing** (CI-integrated), JMeter, Locust. Use production-like data, watch server metrics during the run, and make sure **the load generator isn't the bottleneck**.
- **High-impact fixes, by layer, in order.**
  - **Data** (the biggest wins, because a missing index is a 1000× gap): indexes, no N+1, projections, `AsNoTracking`, batching (`IN`, `ExecuteUpdate`, bulk copy), caching (HybridCache, output cache, CDN), read replicas, DbContext pooling.
  - **Concurrency and I/O**: async all the way, `Task.WhenAll` for independent calls with timeouts, connection reuse (factory, singleton clients, HTTP/2 and HTTP/3), slow work moved off the request path (queue + 202), no global locks.
  - **Payloads**: projections, paging, Brotli/gzip, `WhenWritingNull`, **JSON source generation**, cached options, streaming, gRPC internally.
  - **CPU and allocations**: `ArrayPool`, spans, no boxing or captures, `StringBuilder`, `FrozenDictionary`, **`[GeneratedRegex]`**, `[LoggerMessage]`, **sealed classes** (the JIT can devirtualise calls on them), Dynamic PGO (on by default), SIMD-accelerated span APIs.
  - **Platform**: **upgrade .NET** (every release brings large free gains), Server GC with DATAS, correct container requests, scale out on the right signal, CDN.
- **Startup performance** matters for cold starts, scale-out speed and rolling deploys.
  - **ReadyToRun** precompiles code, so less JIT at startup.
  - **Native AOT** removes the JIT entirely: roughly **10× faster startup** and lower memory, because there's no Tier 0 → Tier 1 warm-up. The cost is AOT-compatible code, meaning no unbounded reflection.
  - `CreateSlimBuilder`, trimming, EF **compiled models**, and source generators (JSON, config binding, RDG) remove reflection from startup.
  - Defer warm-up work to a background service, and warm up before taking traffic (startup and readiness probes, slot `applicationInitialization`).
- **Preventing regressions.** Performance decays by **many small, individually invisible regressions** that add up to "twice as slow" with no single guilty commit. Guard against it with:
  - p95 budgets per critical endpoint, on dashboards with alerts;
  - **BenchmarkDotNet in CI**, compared against main;
  - **load tests in the pipeline** with pass/fail criteria;
  - **canaries** with automated latency comparison;
  - review checklists: async all the way, no N+1, projections, timeouts, pagination limits, no per-request large allocations.

## Part X · Security

### 10.1 · Web application security

[Full chapter →](ch:web-security)

- **Principles.** Security is principles you've already met, now organised around attacks.
  - **Defence in depth**: independent layers (WAF + authentication + authorization + parameterised SQL + a least-privileged DB user + encryption), so one failure isn't fatal.
  - **Least privilege**: `db_datareader`/`db_datawriter`, never `db_owner`; data roles scoped to one container.
  - **Secure by default**: a fallback policy requiring authentication, HTTPS only, deny-by-default CORS.
  - **Fail securely**: generic ProblemDetails, no stack traces, authorization errors deny.
  - **Never trust input**, *including data from your own other services*.
  - **Minimise attack surface**: remove unused endpoints, no Swagger UI in prod, chiseled images.
  - **Assume breach**: detection, segmentation, short token lifetimes, backups.

  **Threat-model at design time** with **STRIDE**: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.
- **OWASP Top 10 (web) and API Security Top 10 (2023), mapped to .NET defences.**
  - **Broken access control**: authorize every endpoint, resource-based checks, queries scoped to the caller.
  - **Cryptographic failures**: TLS and HSTS, encryption at rest, a proper password hasher, the Data Protection API.
  - **Injection**: parameterise.
  - **Insecure design**: threat modelling, abuse cases.
  - **Misconfiguration**: no debug pages in prod, Azure Policy, public access off.
  - **Vulnerable components**: NuGet audit, Dependabot, image scanning.
  - **Authentication failures**: an external IdP, MFA, lockout.
  - **Integrity failures**: no `BinaryFormatter` (**removed in .NET 9**), signed packages and images, pinned CI actions.
  - **Logging failures**: log auth failures and denials, and alert on them.
  - **SSRF**: allow-list outbound destinations.
  - API3, **mass assignment**: DTOs. API4, **unrestricted resource consumption**: rate, size and pagination limits.
- **Broken access control / IDOR (BOLA) is #1.** `MapGet("/orders/{id}", (id, db) => db.Orders.FindAsync(id)).RequireAuthorization()` *does* have authorization, but only "is logged in". Any user can read **any** order by changing the ID. Fix it by **scoping the query to the caller** (`Where(o => o.Id == id && o.CustomerId == user.GetCustomerId())`) and returning **404, not 403**, so you don't reveal which IDs exist. Also:
  - function-level checks, so `/admin/*` needs an admin policy, not just authentication;
  - **multi-tenant isolation** with global query filters by TenantId *plus* database row-level security;
  - **GUIDs aren't access control** (they leak in URLs and logs), and neither is hiding UI;
  - test authorization explicitly in integration tests.
- **Injection.** `"... WHERE Email = '" + email + "'"` with input `x' OR '1'='1` turns data into code. All these send values **as parameters**, never as command text:
  - LINQ;
  - `FromSql($"... {email}")`: the `FormattableString` becomes a parameter, whereas `FromSqlRaw` with concatenation does not;
  - Dapper's `@email`.

  **Identifiers can't be parameters** (a sort column, a table name), so **allow-list** them with a `switch`. Other forms:
  - **OS command**: avoid `Process.Start` with input, or use `ArgumentList` and no shell;
  - **NoSQL**: build queries with SDK APIs, not strings;
  - **log forging**: structured logging encodes values, so never put raw multi-line input in the message template;
  - **CRLF header injection**: ASP.NET Core validates headers.
- **XSS vs CSRF need different, even opposite, defences.**
  - **XSS** runs attacker script in a victim's browser. **Razor HTML-encodes by default**, and `Html.Raw`/`MarkupString` bypass that, so sanitise first (HtmlSanitizer). JSON APIs with `application/json` are safe; the risk moves to the SPA's `innerHTML`/`dangerouslySetInnerHTML`. Add **Content-Security-Policy** as a second layer. Keep tokens out of `localStorage`, because an **HttpOnly cookie can't be read by script**.
  - **CSRF** makes the victim's browser send an authenticated request from a malicious site, because **cookies are attached automatically**. It affects **cookie-authenticated** apps (MVC, Razor Pages, BFFs), **not bearer-token APIs**, since an attacker's page can't set your Authorization header. Defences: **antiforgery tokens** (automatic with Razor form tag helpers; minimal-API form endpoints validate by default since .NET 8), **SameSite=Lax/Strict** cookies, and `Origin`/`Referer` checks.

  So cookies trade XSS-theft risk for CSRF risk, and bearer tokens trade the other way. **Clickjacking** (your page framed invisibly): `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`.
- **Passwords and authentication.** Prefer an **external IdP** with MFA and Conditional Access. If you do store passwords, use a **slow, salted, adaptive** hash: **PBKDF2** (`PasswordHasher<T>`: HMAC-SHA512, 100,000 iterations since .NET 7), **Argon2id**, bcrypt or scrypt. **Never** use MD5, SHA-1 or SHA-256. Slowness is the point: a stolen database hashed with SHA-256 can be guessed at **billions per second** on a GPU, and 100k iterations makes every guess 100,000 times more expensive. The salt defeats precomputed tables and makes identical passwords hash differently. `VerifyHashedPassword` returns `SuccessRehashNeeded` so you can upgrade old hashes at login. Also:
  - **lockout** and rate limits against credential stuffing;
  - **generic errors** ("invalid email or password"), so login, registration and reset can't enumerate users;
  - check new passwords against breached-password lists (HIBP k-anonymity), and prefer length over complexity rules (NIST 800-63B);
  - short access tokens, rotating refresh tokens, revocation on password change (the security stamp), and `HttpOnly; Secure; SameSite` cookies.
- **Pick the right crypto primitive. Never invent crypto.**
  - Data the app reads back (tokens, cookies) → the **Data Protection API** (authenticated encryption with a rotating key ring). `CreateProtector("Shop.Invites.v1").ToTimeLimitedDataProtector()` gives expiring invite tokens, and the purpose string isolates them from other protectors.
  - At rest → TDE, Storage SSE, Always Encrypted, or `AesGcm` with Key Vault keys. Never ECB mode or hard-coded keys.
  - Integrity → HMAC-SHA256 or RSA-PSS/ECDSA, not a bare hash.
  - Random secrets → `RandomNumberGenerator.GetBytes(32)`, **never `System.Random` or `Guid.NewGuid()`**, which aren't designed to be unpredictable.
  - Comparing secrets → **`CryptographicOperations.FixedTimeEquals`**. `==` returns at the first differing byte, so response timing leaks how many leading bytes matched (a timing attack).
- **Transport and headers.** `UseHsts()` (browsers refuse plain HTTP for the max-age) and `UseHttpsRedirection()`. Set `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy` and a CSP. Use TLS 1.2+, managed auto-renewed certificates, TLS or mTLS between services, and `Encrypt=True` to SQL.
- **SSRF.** Any feature where *your server* fetches a *user-supplied* URL (webhooks, "import from URL", image proxies, PDF renderers) can be pointed at internal targets. The prize is the **cloud metadata endpoint `169.254.169.254`**, which hands out **managed-identity tokens** to anything on the box. Defences:
  - allow-list schemes and domains;
  - **resolve DNS and block private, link-local and loopback ranges**, and **re-check after redirects** (or disable auto-redirect), because a harmless-looking host can redirect or rebind to an internal IP;
  - run fetchers in an isolated subnet with egress rules;
  - set timeouts and size limits;
  - never echo the raw response or error back to the user.
- **Mass assignment and data exposure.** Binding an entity (`MapPut(..., User input)`) lets a client post `{"isAdmin": true, "balance": 1000000}`. Bind a **request DTO** with only the allowed fields and map it explicitly; return a **response DTO** without `PasswordHash` or internal flags. A front end hiding a field protects nothing: **the raw API response is what an attacker reads**.
- **Resource consumption.** Use **rate limits** per user, IP or key (stricter on login and expensive endpoints) plus edge limits (WAF, Front Door, APIM). Also:
  - Kestrel `MaxRequestBodySize`, `[RequestSizeLimit]`, form and header limits;
  - **max page size**, GraphQL depth and cost limits;
  - timeouts everywhere;
  - **ReDoS**: a backtracking regex over attacker input can take exponential time, so use `RegexOptions.NonBacktracking` or match timeouts (`[GeneratedRegex]` with a timeout);
  - JSON `MaxDepth`, and no deserializing huge payloads into memory.
- **File uploads**, step by step:
  1. Size limits.
  2. An **extension allow-list**.
  3. **Check magic bytes**: the file content must actually start with PNG or PDF's signature, because renaming `evil.exe` to `.png` defeats an extension check.
  4. **Never use the client's file name as a path** (path traversal); generate a GUID name.
  5. Store **outside the web root** (Blob Storage), and never execute uploads.
  6. Serve them with `Content-Disposition: attachment`, from a separate domain if users see them.
  7. Scan for malware.
- **Supply chain.**
  - **NuGet audit** on restore (fail CI on high severity) and `dotnet list package --vulnerable --include-transitive`.
  - **Package source mapping** against **dependency confusion**, where a public package with your internal name wins resolution. Lock files and Central Package Management.
  - Image scanning, signing and SBOMs.
  - OIDC instead of stored CI secrets, SHA-pinned actions, secret scanning.
  - Unsafe deserializers: no `BinaryFormatter`, and **no Newtonsoft `TypeNameHandling.All`**, which lets the payload pick which type to instantiate (gadget chains → remote code execution). XML with DTDs disabled (XXE; .NET's defaults are safe).
- **Security logging.** Log authentication failures, access denials, privilege changes and rate-limit hits with user and correlation IDs, and alert on spikes. **Never log** passwords, tokens, keys, card numbers or sensitive personal data; use `Microsoft.Extensions.Compliance.Redaction`. Protect the log store with RBAC and retention. **Defender for Cloud** handles posture management and threat detection.

### 10.2 · OAuth 2.0, OpenID Connect and identity

[Full chapter →](ch:oauth-oidc-identity)

- **What OAuth solves.** Before OAuth, a printing app wanting your photos asked for your **photo-site password**: full access, forever, revocable only by changing the password. **OAuth 2.0** is **delegated authorization**: the app gets a **limited (scoped), revocable token** to act on your behalf **without seeing your password**. **OIDC** adds **authentication** on top: an **ID token** saying *who* signed in. **OAuth alone is not a login protocol.** An access token says "the bearer may call this API", and using it as proof of identity enables **token substitution**: a token issued to a *different* app for the same user would "log you in". You always use OIDC and OAuth together.
- **Roles and client types.** There's the **resource owner** (the user), the **client** (an SPA, a web app, a worker), the **authorization server** or IdP (Entra ID, Auth0, Okta, Keycloak, Duende), and the **resource server** (your API). **Confidential clients** (server-side apps, workers) can keep a secret, certificate or federated credential. **Public clients** (SPAs, mobile, desktop) can't, because anyone can extract a secret from JavaScript or a binary, so they rely on **PKCE**.
- **Three tokens, three jobs.**
  - **Access token**: for the **API**. Often a JWT with `aud`, `scp`/`roles`, `sub` and `exp`; short-lived (5–60 min); sent as `Bearer`.
  - **ID token**: for the **client**. Always a JWT (`sub`, `name`, `email`, **`nonce`**, `auth_time`, `amr`). **Never send it to an API.**
  - **Refresh token**: for the **authorization server**. Opaque, long-lived and rotated; exchanged for new access tokens without user interaction, so it **must be stored securely**.

  The **authorization code** is a one-time intermediate in the code flow, valid for a few minutes.
- **Authorization code flow with PKCE**, the flow for anything with a user (mandatory in OAuth 2.1).
  1. The client makes a random **`code_verifier`** and sends only its **hash** (`code_challenge`, S256) in the browser redirect to `/authorize`, along with `state`, `nonce` and scopes (`openid profile api://shop/orders.read offline_access`).
  2. The user signs in (MFA) and consents.
  3. The IdP redirects back with `?code=...&state=...`.
  4. The client posts the code **plus the raw verifier** on a **back channel** to `/token`.
  5. The IdP checks that SHA256(verifier) matches the challenge and returns the tokens.

  Why each piece exists:
  - **PKCE**: an attacker who steals the code from the redirect (a malicious app on the device, a logged referrer) **can't redeem it without the verifier**, which never crossed the front channel.
  - **Back-channel exchange**: tokens never appear in URLs or history. The old **implicit flow** did exactly that and is deprecated.
  - **`state`**: ties the response to the request, preventing CSRF on the callback.
  - **`nonce`**: stops ID-token replay.
  - **Exact redirect URI matching**: stops codes being delivered to an attacker's URL.

  In ASP.NET Core you register a **cookie scheme as default plus an OIDC challenge scheme**: after the dance, the app issues its own session cookie and only re-runs OIDC when the session expires.
- **Client credentials**: service-to-service, **no user**. `grant_type=client_credentials&scope=api://inventory-api/.default`. The token carries the **app's identity and application permissions** in `roles`, with no `scp` and no user. In Azure, use a **managed identity** (no secret), or a certificate or federated credential, rather than a client secret. Cache tokens in a `DelegatingHandler` until shortly before expiry.
- **Refresh tokens.** Access tokens are short because **a JWT can't be revoked before `exp`**, and refresh tokens restore the UX. Best practices:
  - **Rotation**: every use returns a *new* refresh token and invalidates the old one. **Reuse of an old token signals theft**, so the server revokes the whole token family.
  - **Sender-constraining** (DPoP or mTLS), so a stolen token is useless without the client's key.
  - Revocation on logout and password change.
  - Server-side or OS-keychain storage, **never `localStorage`**.
  - An absolute lifetime.
- **Other flows.**
  - **Device code**: TVs and CLIs (`az login --use-device-code`).
  - **On-Behalf-Of** (token exchange, RFC 8693): API A swaps the user's incoming token for one to API B, **preserving the user's identity and permissions** downstream.
  - **CIBA**: decoupled approval, like a bank app push.
  - **JWT-bearer assertions**: workload identity federation.
  - **Deprecated**: implicit (tokens in the URL fragment) and **ROPC** (the app collects the password, which breaks MFA and SSO).
- **OIDC specifics.** It defines the `openid` scope (plus `profile` and `email`), standard claims, and **ID-token validation** (`iss`, **`aud` = the client ID**, `exp`, `nonce`, signature). **Discovery** at `{authority}/.well-known/openid-configuration` lists the endpoints and **`jwks_uri`**, the public signing keys. That's how ASP.NET Core configures itself from just `Authority`. OIDC also covers UserInfo and logout (RP-initiated, front-channel, back-channel). In Entra tokens, use **`oid`** (stable across apps in the tenant) or `sub` (pairwise per app) as the user key, never the email, which can change.
- **Scopes vs roles vs audience.** A **scope** (`scp`) is what the **client** may do **on the user's behalf** (`orders.read`, consented). An **app role** (`roles`) is assigned to a user or group (`Orders.Admin`) **or to an application** (`Inventory.Read`). The **audience** (`aud`) says which API the token is for. **Effective delegated permission = the intersection** of what the app was granted and what the user may do. A policy typically accepts `scp` contains `orders.read` **or** `IsInRole("Orders.Reader")`, covering both delegated and daemon callers. **Scopes don't prevent IDOR**: `orders.read` proves the client may read *some* orders, not that this user may read *order 1042*, so resource-level checks are still required.
- **Validating an access token.**
  1. **Signature**, with a key from `jwks_uri` found by `kid` (cached, so rotation just works). Reject `alg: none` and unexpected algorithms.
  2. **Issuer**.
  3. **Audience = this API**. Skip this and a token minted for *another* API in the same tenant is accepted: the **confused deputy**.
  4. **`exp`/`nbf`**, with small clock skew.
  5. Scopes or roles, then resource authorization.

  JwtBearer does steps 1–4 from `Authority` + `Audience`. **JWT vs reference tokens**: a JWT validates **locally** (fast, no network call) but **can't be revoked**, and anyone holding it can read its claims. An **opaque token** needs an **introspection** call (RFC 7662, cached) but can be **revoked instantly** and reveals nothing. Use opaque tokens for revocation-critical APIs or tokens leaving your boundary.
- **SPAs: use a BFF.** A SPA is a public client in a hostile environment where **any XSS can read tokens** from JS memory or `localStorage`. Tokens in the browser (MSAL.js with code + PKCE) work, but XSS means token theft, so use short lifetimes and rotation. The **Backend-for-Frontend** is the IETF-recommended alternative: a thin ASP.NET Core app (often with **YARP**) does OIDC **as a confidential client**, **keeps tokens server-side**, gives the browser only an **HttpOnly, Secure, SameSite cookie**, and proxies API calls with the bearer token attached. Because it's cookie-based, it needs CSRF protection (SameSite plus antiforgery or a custom header). Libraries: Duende.BFF, or `AddOpenIdConnect` + YARP + Duende.AccessTokenManagement.
- **Identity providers.**
  - **Entra ID**: workforce and B2B (Microsoft.Identity.Web, MSAL).
  - **Entra External ID**: customers (CIAM).
  - **Auth0/Okta**: multi-cloud.
  - **Keycloak**: open source, self-hosted.
  - **Duende IdentityServer** (commercial licence for most companies) and **OpenIddict** (open source): frameworks to **build** your own OIDC server.
  - **ASP.NET Core Identity**: a user store, **not** an OIDC server on its own.

  **Don't build an authorization server unless you must.** It's specification-heavy and constantly attacked.
- **Common mistakes**, each with its fix:
  - not validating `aud` → always set the audience;
  - APIs accepting ID tokens → access tokens only;
  - long-lived access tokens → 5–60 min plus refresh;
  - tokens in `localStorage` → a BFF, or in-memory with short lifetimes;
  - implicit flow or ROPC → code + PKCE, client credentials for services;
  - wildcard redirect URIs → exact, registered HTTPS URIs;
  - client secrets in SPA or mobile apps → a public client with PKCE;
  - checking only scopes → add resource-based authorization;
  - **hand-rolled HS256 JWTs with a shared key**, where *any service holding the key can mint tokens* → asymmetric keys at a real IdP;
  - sensitive data in claims (readable by anyone holding the token) → minimal claims, details looked up server-side.

## Part XI · Interview Preparation

### 11.1 · System design

[Full chapter →](ch:system-design)

- **What's being tested** is process, not a single right answer:
  1. **clarify** ambiguous requirements;
  2. structure the design from high level to detail;
  3. **choose components with reasons and trade-offs** ("I'd use X because Y; the cost is Z");
  4. find and fix bottlenecks;
  5. **say what breaks and what happens then**;
  6. communicate, by thinking out loud and taking hints.

  For .NET roles, use concrete .NET and Azure picks (EF Core vs Dapper, Service Bus vs Event Hubs, Container Apps vs AKS) and code-level patterns (outbox, idempotency, caching strategy).
- **A 45-minute framework.**
  1. **Requirements** (5–8 min): functional (core use cases only), non-functional (scale, latency, availability, consistency, durability, security, cost), and an explicit **out of scope**.
  2. **Estimates** (3–5 min): users, peak RPS, **read:write ratio**, item size, 5-year storage.
  3. **API** (3–5 min).
  4. **Data model** (5 min): entities, keys and **access patterns**, which decide the store and the partitioning.
  5. **High-level boxes** (10 min).
  6. **Deep dives** on the 2–3 hardest parts (10–15 min).
  7. **Wrap up**: bottlenecks, monitoring, next steps.

  The estimates come *before* the architecture because **the numbers decide it**: 100:1 reads to writes means caching and read replicas, while 1:1 means write-optimised storage.
- **Numbers to know.**
  - A day is ~86,400 s, about **10⁵**, so **1M requests/day ≈ 12 RPS average**. Peak is 2–10× that.
  - Latencies: memory ~100 ns, SSD ~100 µs, **same-datacentre round trip ~0.5 ms**, **cross-region ~50–150 ms**, Redis GET under 1 ms, an indexed SQL point query 1–5 ms.
  - One ASP.NET Core instance serves tens of thousands of RPS for trivial JSON, but **hundreds to a few thousand for realistic CRUD**. A SQL instance handles thousands to tens of thousands of simple queries a second.
  - Worked example: 10M DAU × (20 reads + 1 write) ≈ 2,300 read RPS average (~10k peak) vs 115 write RPS. That's read-heavy, so cache before you shard.
- **Building blocks and the Azure pick for each.**
  - Edge (DNS, CDN, WAF): **Front Door**.
  - Gateway: **APIM or YARP**.
  - Stateless services: ASP.NET Core on Container Apps, App Service or AKS.
  - Cache: **HybridCache + Managed Redis**, output caching.
  - Relational: Azure SQL (Hyperscale) or PostgreSQL.
  - Key-scale and global: **Cosmos DB**.
  - Files: Blob + SAS + CDN.
  - Queue: **Service Bus** (MassTransit, Wolverine).
  - Stream: **Event Hubs**.
  - Search: AI Search or Elasticsearch.
  - Workers: worker services, Functions, Container Apps jobs.
  - Real-time push: **SignalR Service**.
  - Identity: Entra. Telemetry: OpenTelemetry + Azure Monitor.
- **Design 1: URL shortener.** It's 100:1 read-heavy, redirects must take under 50 ms, and codes must never collide. 100M links a month is about 40 writes/s; 10B redirects a month is about 4k RPS (20k peak); storage is about 3 TB over 5 years.
  - **Code generation**: hashing (MD5 → base62) needs collision handling. Better is a **counter + base62** with IDs handed out to each instance **in blocks** from a sequence (unique by construction, no coordination per request), or a random 7-character code (62⁷ ≈ 3.5 trillion) with a uniqueness check.
  - **Store**: Cosmos with partition key = code, so each redirect is a ~1 RU **point read**.
  - **Read path**: HybridCache L1 in memory → L2 Redis, plus **Front Door caching hot redirects**.
  - **Analytics**: **publish click events asynchronously to Event Hubs**; never write to the database per redirect.
  - Plus TTL for expiry, creation rate limits and malware URL scanning.
  - **301 vs 302**: a 301 is cached by browsers and is cheapest, but you **lose click counts**; a 302 makes every click hit you. The redirect endpoint uses `.ShortCircuit()` to skip unneeded middleware on the hottest path.
- **Design 2: checkout.** Correctness comes first (no overselling, no double charge), with p95 under 1 s, survival of payment-provider outages and 10× sale peaks. Start as a **modular monolith** and extract Payments and Inventory only with a concrete reason. The flow:
  1. `POST /checkout` with an **Idempotency-Key** creates `Order(Pending)` and an `OrderSubmitted` **outbox** row in **one transaction**, and returns **202** plus a status URL.
  2. The relay publishes to Service Bus, and an **orchestrated saga** sends `ReserveStock`. That's an **atomic conditional update**: `UPDATE Stock SET Reserved += @q WHERE Sku = @s AND Available >= @q`, and zero rows affected means out of stock. No read-then-write race.
  3. `ChargePayment` calls the PSP with **idempotency key = orderId** and handles its webhooks.
  4. Success → confirm → notify and ship. Failure or timeout → **ReleaseStock** (compensation) → Cancelled.

  Deep dives:
  - **no overselling**: conditional updates or optimistic concurrency, expiring reservations, and a single writer or queue per hot SKU for flash sales;
  - **no double charge**: four layers (endpoint key, PSP key, consumer inbox, unique `Payments(OrderId)`);
  - **resilience**: timeout, idempotent retry and a breaker on the PSP, and if it's down, accept the order and charge later;
  - **peaks**: autoscale on RPS and **KEDA on queue length**, cache the catalog, a waiting room for extreme sales;
  - **data**: SQL for orders, payments and stock; Redis or Cosmos for carts (high write rate, TTL); AI Search for the catalog;
  - **observability**: cross-service traces, orders/min, payment failure rate, alerts on saga timeouts and DLQ depth.
- **Design 3: notifications** (50M a day with campaign bursts). Producers publish `notification-requested` to a topic. The service:
  1. checks idempotency with an **inbox keyed by NotificationId**;
  2. applies **cached preferences** (opt-outs, quiet hours);
  3. renders localised templates;
  4. fans out to **separate email, SMS and push queues**.

  Separate queues are **bulkheads**: a rate-limited SMS provider can't back up email, and each channel scales and **rate-limits per provider** (token bucket) independently, with a DLQ per channel. **Campaigns go through a low-priority queue** so password resets are never stuck behind a marketing blast. Add versioned, cached templates, GDPR (unsubscribe, retention), and metrics per provider plus end-to-end latency.
- **Trade-offs to name explicitly.**
  - Consistency vs availability: strong for money and stock, eventual for feeds, counts and search.
  - SQL vs NoSQL, decided by access patterns.
  - Sync for reads that need an immediate answer vs async (202) for side effects.
  - Monolith vs microservices: split only for team, deployment or scaling reasons.
  - Cache freshness vs load: TTLs, event-driven invalidation, stampede protection.
  - Latency vs cost.
  - **Build vs buy**: buy identity, payments, email and search; build the core domain.
  - Push vs pull: fan-out on write vs on read for feeds.
  - Normalised vs denormalised: CQRS read models.
- **Low-level design** (parking lot, rate limiter, LRU cache):
  1. Clarify the edge cases.
  2. Find the nouns, verbs and **invariants**.
  3. Apply SOLID and the right pattern (Strategy for pricing, State for lifecycles, Observer for notifications, Factory for creation).
  4. Discuss what's shared and how it's protected, how it's tested, and how it extends.
  5. Write real C# for the core.

  The classic **LRU cache** pairs a `Dictionary<K, LinkedListNode<(K, V)>>` with a `LinkedList`, for O(1) get and put. On a hit, move the node to the front. On insert past capacity, evict `_order.Last` and remove its key from the map. Guard the whole thing with a `Lock`, because both structures must change together, so `Interlocked` isn't enough.

### 11.2 · Study plan and resources

[Full chapter →](ch:study-plan-resources)

- **How to make it stick.** Rereading tests *recognition*, but interviews test *recall*.
  - **Active recall**: close the page and explain it; answer drill questions **before** revealing them.
  - **Spaced repetition**: revisit at 1 day, 3 days, 1 week and 2 weeks, and repeat misses more often.
  - **Feynman**: explain it to a junior. Wherever you hesitate or hide behind jargon is the gap.
  - **Interleaving**: mixed-topic drills, because interviews jump around.
  - **Build it**: writing an outbox once beats reading about it five times.
  - **Map placement**: put every new term in one of the 8 layers.
- **Eight-week order** (the order matters more than the pace):
  1. Platform, type system, OOP, generics.
  2. Delegates, collections, LINQ, exceptions, async, modern C#.
  3. Hosting, DI, configuration, middleware, routing, APIs.
  4. Errors, auth, HttpClient, caching, background work, API design.
  5. Data.
  6. Architecture and testing.
  7. Messaging, resilience, observability, microservices, cloud, Docker.
  8. Azure, CI/CD, Kubernetes, performance, security, system design, plus **two mock design sessions**.

  Then go back through every **Advanced** section and drill for 15 minutes daily.
- **One practice project, every layer**: a "Shop" backend.
  - Paged and filtered CRUD with EF projections.
  - A Redis cart with idempotent checkout and the Result pattern.
  - An order aggregate with a state lifecycle and ETag concurrency.
  - JWT with policies and **own-orders-only** resource authorization.
  - `OrderPlaced` → outbox → broker → idempotent consumers.
  - A resilient typed HttpClient to a fake PSP (WireMock in tests).
  - A nightly `PeriodicTimer` cleanup.
  - OpenTelemetry across API → broker → worker in the Aspire dashboard.
  - Domain unit tests, plus WebApplicationFactory + Testcontainers + Respawn.
  - A chiseled multi-stage Dockerfile, GitHub Actions, and Container Apps via Bicep/azd with managed identity.
  - BenchmarkDotNet on one hot method and a k6 test, then fix one *measured* bottleneck.

  You come away with real stories ("when I built the outbox, I hit..."), which beat recited definitions. Compare against **dotnet/eShop** afterwards.
- **Self-assessment at the advanced level** (what a staff interview probes):
  - JIT tiering and PGO, Native AOT trade-offs, source generators vs reflection;
  - async state-machine internals, `SynchronizationContext` deadlocks, diagnosing starvation;
  - GC generations, LOH, DATAS, `gcroot`;
  - threading primitives and the memory model;
  - `Span`/`Memory` and pooling;
  - the full request lifecycle and endpoint routing internals;
  - aggregates, and domain vs integration events;
  - sagas, ordering, the exactly-once myth, event sourcing;
  - service boundaries, strangler fig, the distributed monolith;
  - Cosmos partitioning, CAP/PACELC, Service Bus vs Event Grid vs Event Hubs;
  - OAuth flows, token validation, BFF;
  - IDOR, SSRF, mass assignment;
  - performance method, percentiles, load tests;
  - probes, resources and zero-downtime deploys with schema changes;
  - a full checkout or URL-shortener design.
- **Answer structure**: **definition → why it exists → how it works, with an example → trade-offs and pitfalls → your experience**. For "scoped vs singleton", that's:
  - *Definition*: one per request vs one per app.
  - *Why*: lifetime matches how long state lives and whether it can be shared across threads.
  - *Example*: `DbContext` is scoped because it isn't thread-safe and tracks per-request changes.
  - *Pitfall*: a singleton capturing a scoped service is a **captive dependency**. Scope validation catches it in Development, and `IServiceScopeFactory` fixes it.
  - *Experience*: a real story.

  More tips: say "it depends", **then say on what**, and pick an answer. Use precise vocabulary. Admit gaps and reason from first principles ("Event Hubs is a partitioned log like Kafka, so I'd expect..."). Draw anything with more than two parts. Prepare 5–6 **STAR** stories. Ask clarifying questions first.
- **Core reading.**
  - *C# in Depth* (Skeet) and *CLR via C#* (Richter).
  - *Pro .NET Memory Management* (Kokosa) and *Concurrency in C# Cookbook* (Cleary).
  - ***ASP.NET Core in Action*** (Lock), the best single book for Part III.
  - *Designing Data-Intensive Applications* (Kleppmann).
  - Evans, Vernon and Khononov for DDD.
  - Newman, *Enterprise Integration Patterns* and *Release It!* for distributed systems.
  - Khorikov for testing.
  - *Accelerate* and Google's *SRE* book for delivery and operations.
  - Alex Xu's *System Design Interview*.

  Free: Microsoft Learn, Stephen Toub's yearly performance posts, Andrew Lock's blog, SharpLab (see the IL, JIT asm and lowered C#), the OWASP Cheat Sheets and the Azure Architecture Center.
