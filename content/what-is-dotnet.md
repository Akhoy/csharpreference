---
id: what-is-dotnet
title: What .NET Actually Is
summary: The platform under everything: runtime, libraries and SDK; the history behind the confusing names; versions and support; and what "cross-platform" really means.
layer: runtime
where: Runtime & platform › The platform itself
fits: .NET is layer 2. C# (layer 1) compiles *for* it, and every framework in layer 3 (ASP.NET Core, EF Core) is a set of libraries that *runs on* it. When people say "the runtime", "the BCL" or "the SDK", they mean parts of this layer.
levels: b,i
prereqs: big-picture
next: how-code-runs, projects-sdk-nuget
---

## TL;DR

- .NET is a **platform** (runtime + BCL + SDK), not a language — C#, F# and VB all compile to it.
- The confusing names are historical: **.NET Framework** (old, Windows-only) → **.NET Core** (rewrite, cross-platform) → renamed to just **.NET** from version 5 onward.
- Pick **LTS** versions (even numbers: 6, 8, 10) for production — 3 years of support vs 2 for STS (odd numbers).
- Deployment mode is a trade-off: framework-dependent (small, needs a runtime installed) vs self-contained vs Native AOT (fastest startup, some reflection limits).
- The BCL already ships most things you'd reach for a NuGet package for: JSON, HTTP, collections, crypto, regex, metrics.

## .NET is a platform, not a language {b}

.NET is a **software platform**: everything needed to build and run applications. C# is the most popular language for it, but F# and Visual Basic compile to the same format and run on the same platform.

The platform has four parts:

| Part | What it is | Where you meet it |
|---|---|---|
| **Runtime (CLR)** | The engine that loads compiled code, JIT-compiles it to machine code, manages memory (GC), threads, exceptions and type safety | Always running underneath your app |
| **Base Class Library (BCL)** | Thousands of ready-made types: `string`, `List<T>`, `Dictionary<K,V>`, `Task`, `HttpClient`, `File`, `JsonSerializer`, `DateTime`… | Every `using System...` |
| **SDK** | Build-time tools: the C# compiler (Roslyn), MSBuild, the `dotnet` CLI, project templates | Your dev machine and CI servers |
| **App frameworks (shared frameworks)** | Big library sets shipped with the runtime: **Microsoft.NETCore.App** (base), **Microsoft.AspNetCore.App** (web), **Microsoft.WindowsDesktop.App** (WPF/WinForms) | What your project's SDK attribute pulls in |

:::analogy Runtime vs SDK
The **runtime** is like a DVD player: it plays discs. The **SDK** is the studio that makes discs. A production server only needs the player (the runtime). A developer machine and a CI server need the studio (the SDK), which *includes* a runtime so you can run what you build.
:::

### Runtime-only installs

You'll see three runtime downloads:

- **.NET Runtime**: console apps and libraries.
- **ASP.NET Core Runtime**: the above plus the web framework. Use this for web servers.
- **.NET Desktop Runtime**: Windows only, for WPF/WinForms.

Docker images mirror this: `mcr.microsoft.com/dotnet/sdk` (build), `.../aspnet` (run web apps), `.../runtime` (run console apps), `.../runtime-deps` (only native dependencies, for self-contained apps).

## The history that explains the names {b}

Most confusion about .NET comes from its renaming. Here is the timeline:

| Year | Event | Why it matters today |
|---|---|---|
| 2002 | **.NET Framework 1.0**: Windows only, installed into the OS | Legacy enterprise apps still run on 4.8 |
| 2002–2019 | Framework 2.0 → 4.8: generics, LINQ, async, WPF, WCF, ASP.NET MVC | Old tutorials, `web.config`, `System.Web` |
| 2004 | **Mono**: an open-source, cross-platform reimplementation | Became Xamarin (mobile) and Unity's scripting runtime |
| 2016 | **.NET Core 1.0**: a ground-up rewrite. Cross-platform, open source, modular, fast | The start of modern .NET |
| 2016 | **ASP.NET Core**: a rewrite of ASP.NET for .NET Core | Today's web framework |
| 2019 | .NET Core 3.1 (LTS) | Was the "standard" version for years |
| 2020 | **.NET 5**: "Core" dropped from the name; skipped version 4 to avoid confusion with Framework 4.x | One .NET going forward |
| 2021 | .NET 6 (LTS): minimal APIs, hot reload | Still found in many companies |
| 2023 | .NET 8 (LTS): Native AOT for APIs, keyed DI, `TimeProvider` | The most common production version in 2025–26 |
| 2024 | .NET 9 (STS): `HybridCache`, built-in OpenAPI, LINQ `CountBy`/`Index` | |
| 2025 | **.NET 10 (LTS)**, C# 14 | Current LTS |

:::gotcha "ASP.NET" vs "ASP.NET Core"
**ASP.NET** (Web Forms, MVC 5, Web API 2, `System.Web`, `Global.asax`, `web.config`) runs only on .NET Framework. **ASP.NET Core** is the modern rewrite. They share concepts (controllers, Razor) but the internals, configuration and hosting are completely different. If a tutorial has `Global.asax` or `HttpContext.Current`, it is about the old one.
:::

### Why the rewrite happened

.NET Framework had a few structural problems. None of them could be fixed without breaking apps that already depended on the old behaviour, so Microsoft started over instead:

1. **Windows only.** Meanwhile the industry moved to Linux and containers.
2. **Machine-wide installs.** Upgrading Framework on a server upgraded it for *every* app on that server, so companies ended up freezing versions for years rather than risk breaking something else. .NET Core fixes this: versions can run **side by side**, and an app can even be **self-contained**, carrying its own runtime with it.
3. **Monolithic `System.Web`.** ASP.NET was tied to IIS and loaded a huge pipeline even for a tiny API. ASP.NET Core is modular instead: you add only the middleware you actually use.
4. **Performance.** .NET Core was designed for throughput from day one. ASP.NET Core regularly places among the fastest mainstream web frameworks in TechEmpower benchmarks.

## Versions, support and release cadence {i}

A new major version ships **every November**.

| Type | Versions | Support length |
|---|---|---|
| **LTS** (Long Term Support) | Even numbers: 6, 8, 10 | 3 years |
| **STS** (Standard Term Support) | Odd numbers: 7, 9, 11 | 2 years (extended from 18 months starting with .NET 9) |

Patch releases come monthly ("Patch Tuesday") with security fixes. You get them by updating the runtime or rebuilding on the latest base image.

:::tip What to say in an interview
"We target the current LTS in production because it gives three years of patches. We upgrade once per LTS cycle, and upgrading is usually just changing the target framework, updating packages and fixing a few breaking changes listed in the official docs."
:::

### Target framework monikers (TFMs)

Your project declares which .NET it targets:

| TFM | Meaning |
|---|---|
| `net10.0`, `net8.0` | Modern .NET, any OS |
| `net8.0-windows` | Modern .NET with Windows-only APIs (WPF, WinForms) |
| `net8.0-android`, `net8.0-ios` | Mobile via .NET MAUI |
| `netstandard2.0` | A library usable from Framework 4.6.1+ **and** all modern .NET |
| `net48` | .NET Framework 4.8 |

You can multi-target a library with `<TargetFrameworks>net8.0;netstandard2.0</TargetFrameworks>` (note the plural).

## .NET Standard: a contract, not a runtime {i}

During the transition years there were three runtimes (Framework, Core, Mono/Xamarin) with different API sets. **.NET Standard** was a **specification**: a list of APIs that every compliant runtime promises to implement. A library targeting `netstandard2.0` runs on all of them.

- **.NET Standard 2.0** is the useful one: supported by Framework 4.6.1+, .NET Core 2.0+, all modern .NET, Mono, Unity.
- **.NET Standard 2.1** dropped .NET Framework support, which made it much less useful.
- **No new versions** will be made. Modern .NET (`net8.0` etc.) is the "standard" now.

**When to target it today:** only for libraries that must also be consumed by .NET Framework apps. Otherwise target `net8.0`/`net10.0` to get modern APIs (`Span<T>` overloads, newer collections, etc.).

## Cross-platform, open source, and who builds it {b}

- **Runs on** Windows, Linux, macOS; x64, x86, Arm64 (including Apple Silicon, AWS Graviton, Azure Cobalt). Linux containers are the dominant production deployment.
- **Open source** under the MIT licence, developed on GitHub (`dotnet/runtime`, `dotnet/aspnetcore`, `dotnet/efcore`, `dotnet/roslyn`), stewarded by the **.NET Foundation**.
- **Built by** Microsoft with large community contribution. Design discussions (API proposals) happen in the open on GitHub issues.

### What runs on .NET

| App type | Technology | Layer-3 framework |
|---|---|---|
| Web APIs, websites | ASP.NET Core (minimal APIs, MVC, Razor Pages, Blazor) | Microsoft.AspNetCore.App |
| Background processing | Worker Service (Generic Host) | Microsoft.Extensions.Hosting |
| Serverless | Azure Functions (isolated worker), AWS Lambda | |
| Desktop | WPF, WinForms (Windows), .NET MAUI, Avalonia | |
| Mobile | .NET MAUI (iOS, Android) | |
| Games | Unity (Mono/IL2CPP based), Godot, MonoGame | |
| Cloud-native distributed apps | .NET Aspire for orchestration | |
| ML | ML.NET, ONNX Runtime | |

This book focuses on **backend**: web APIs, workers, data and cloud.

## Framework-dependent vs self-contained deployment {i}

When you `dotnet publish`, you choose how the app ships:

| Mode | What's in the output | Pros | Cons |
|---|---|---|---|
| **Framework-dependent** (default) | Your DLLs only | Small; shared runtime is patched centrally | Target machine needs the right runtime installed |
| **Self-contained** (`--self-contained -r linux-x64`) | Your DLLs + the entire runtime | No runtime needed on the machine; pin exact version | Larger (≈70 MB+); you must rebuild to get runtime patches |
| **Single file** (`-p:PublishSingleFile=true`) | One executable (self-contained or not) | Easy distribution | Startup extraction quirks for some native libs |
| **Native AOT** (`-p:PublishAot=true`) | One native binary, no JIT | Instant startup, low memory | Reflection limits; not all libraries are compatible |
| **ReadyToRun** (`-p:PublishReadyToRun=true`) | IL + precompiled native code | Faster startup, still JIT-capable | Larger files |

The **RID** (runtime identifier) such as `linux-x64`, `linux-musl-arm64` (Alpine), `win-x64`, `osx-arm64` says which platform a self-contained/native build targets.

## The BCL: a tour of what you get for free {b}

Knowing what is already in the box saves you writing (or installing) it. Highlights by namespace:

| Namespace | Key types | Used for |
|---|---|---|
| `System` | `String`, `DateTime`, `DateTimeOffset`, `TimeSpan`, `Guid`, `Math`, `Span<T>`, `Exception`, `TimeProvider` | Basics |
| `System.Collections.Generic` | `List<T>`, `Dictionary<K,V>`, `HashSet<T>`, `Queue<T>`, `PriorityQueue<T,P>` | Data structures |
| `System.Collections.Concurrent` | `ConcurrentDictionary`, `ConcurrentQueue`, `BlockingCollection` | Thread-safe collections |
| `System.Collections.Immutable` / `Frozen` | `ImmutableList`, `FrozenDictionary` | Snapshots, read-mostly lookups |
| `System.Linq` | `Enumerable`, `Queryable` | Querying |
| `System.Threading` / `.Tasks` | `Task`, `CancellationToken`, `SemaphoreSlim`, `Channel<T>`, `Parallel` | Async and concurrency |
| `System.Text.Json` | `JsonSerializer`, `JsonDocument`, `Utf8JsonWriter` | JSON (the default serializer) |
| `System.Net.Http` | `HttpClient` | Calling HTTP APIs |
| `System.IO` | `File`, `Stream`, `Path`, `FileSystemWatcher` | Files and streams |
| `System.IO.Pipelines` | `Pipe`, `PipeReader` | High-performance I/O (used by Kestrel) |
| `System.Diagnostics` | `Activity`, `Stopwatch`, `Process`, `Metrics.Meter` | Tracing, timing, metrics |
| `System.Security.Cryptography` | `SHA256`, `Aes`, `RandomNumberGenerator`, `X509Certificate2` | Crypto |
| `System.Text.RegularExpressions` | `Regex` (with source generator) | Pattern matching on text |

:::gotcha DateTime vs DateTimeOffset
`DateTime` doesn't reliably carry a time zone offset (its `Kind` is often `Unspecified`). For timestamps stored in databases and sent over APIs, prefer **`DateTimeOffset`** or always use UTC (`DateTime.UtcNow`). For testable time, inject **`TimeProvider`** (.NET 8) instead of calling `DateTime.Now` directly.
:::

:::qa What is the difference between the .NET SDK and the .NET runtime?
The runtime contains the CLR and the libraries needed to *run* a compiled app. The SDK contains the compiler, MSBuild, CLI and templates needed to *build* apps, and it includes a runtime. Production servers and runtime Docker images need only the runtime (for web apps, the ASP.NET Core runtime); dev machines and CI need the SDK.
:::

:::qa Why was .NET Core created instead of continuing .NET Framework?
Framework was Windows-only, installed machine-wide (so upgrades affected every app), tied to IIS via a monolithic System.Web, and hard to make fast without breaking compatibility. .NET Core was a cross-platform, open-source, modular rewrite with side-by-side installs and much better performance.
:::

:::qa What is .NET Standard and should you still target it?
A specification of APIs that multiple .NET implementations promise to support, so one library could run everywhere during the transition. Target `netstandard2.0` only if the library must also be used by .NET Framework apps; otherwise target a modern TFM such as `net8.0` or `net10.0`.
:::

:::qa What do LTS and STS mean? Which would you choose for production?
LTS (even versions) gets 3 years of support; STS (odd versions) gets 2 years. Most companies pick LTS for production to reduce upgrade frequency, while trying STS releases in non-critical services to get features earlier.
:::

:::qa Framework-dependent vs self-contained deployment?
Framework-dependent publishes only your app and relies on an installed shared runtime: small, centrally patched. Self-contained bundles the runtime: no install needed and version-pinned, but larger, and you must redeploy to pick up runtime security patches.
:::

:::qa Name some things in the BCL you'd use instead of a third-party package.
System.Text.Json for JSON, HttpClient + IHttpClientFactory for HTTP, Channel&lt;T&gt; for producer/consumer queues, PriorityQueue, TimeProvider for testable time, System.Diagnostics.Metrics and Activity for telemetry, built-in rate limiting, and the source-generated Regex.
:::

## Further reading

- [What is .NET? (Microsoft Learn)](https://learn.microsoft.com/en-us/dotnet/core/introduction)
- [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)
- [Target frameworks](https://learn.microsoft.com/en-us/dotnet/standard/frameworks)
- [Application publishing overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/)

## Verify this chapter

Version/support-cycle dates and "which OS runs .NET" aren't things one running process can prove about itself — trust [Further reading](#further-reading) for those. What the program below checks are the BCL behaviours this chapter calls out: the `DateTime` vs `DateTimeOffset` gotcha, `TimeProvider` being injectable/testable, and `System.Text.Json` being usable with zero extra packages. Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
using System.Text.Json;

// Claim: DateTime doesn't reliably carry a time zone offset — Kind is often Unspecified.
var parsed = DateTime.Parse("2026-01-01T10:00:00");
if (parsed.Kind != DateTimeKind.Unspecified)
    throw new Exception("FAIL: expected DateTime.Parse without a zone to be Kind.Unspecified");
Console.WriteLine("OK: a plain DateTime.Parse carries no reliable zone info (Kind.Unspecified)");

// DateTimeOffset, by contrast, always carries an explicit offset.
var withOffset = DateTimeOffset.Parse("2026-01-01T10:00:00+02:00");
if (withOffset.Offset != TimeSpan.FromHours(2))
    throw new Exception("FAIL: expected DateTimeOffset to preserve the +02:00 offset");
Console.WriteLine("OK: DateTimeOffset preserves the offset that DateTime would have lost");

// Claim: inject TimeProvider instead of calling DateTime.Now directly, so time is testable.
var fixedTime = new DateTimeOffset(2030, 6, 1, 0, 0, 0, TimeSpan.Zero);
TimeProvider fakeClock = new FixedTimeProvider(fixedTime);
if (fakeClock.GetUtcNow() != fixedTime)
    throw new Exception("FAIL: a fake TimeProvider should let you control 'now' in a test");
Console.WriteLine("OK: TimeProvider can be substituted with a fixed clock for deterministic tests");

// Claim: System.Text.Json is the default serializer, usable with no extra NuGet package.
var json = JsonSerializer.Serialize(new { Name = "Ana", Total = 42.5m });
var roundTripped = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
if (roundTripped is null || roundTripped.Count != 2)
    throw new Exception("FAIL: JSON round-trip through System.Text.Json failed");
Console.WriteLine($"OK: System.Text.Json serialized and parsed JSON with zero extra packages: {json}");

// Not runtime-verifiable here — see Further reading:
// - which OSes/architectures .NET runs on (needs multiple machines, not one process)
// - LTS/STS support windows and release cadence (a policy, not a runtime fact)
// - framework-dependent vs self-contained vs Native AOT publish sizes/startup time (needs `dotnet publish`)

class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}
```
