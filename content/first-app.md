---
id: first-app
title: "Your First .NET App, End to End"
summary: "The whole developer loop before any theory. Covers installing and checking the SDK, creating a console app and a web API, what every generated file is for, Program.cs and top-level statements, namespaces and using directives, the C# vocabulary you'll meet before Part II teaches it, running with dotnet run and Hot Reload, debugging with breakpoints, splitting code into a solution with a class library, adding a NuGet package, writing and running a test, Debug vs Release, publishing and running the published app, and the first errors everyone hits."
layer: runtime
where: The .NET platform › Your first app
fits: "Hands-on companion to [What .NET is](ch:what-is-dotnet). Every later chapter assumes this loop: create, run, debug, test, publish. [How code runs](ch:how-code-runs) explains what happens under the hood of these commands, and [Projects & packages](ch:projects-sdk-nuget) goes deep on the project files you create here."
levels: b,i
prereqs: what-is-dotnet
next: how-code-runs
---

## The 30-second version

- Install the **.NET SDK**; check it with `dotnet --info`.
- `dotnet new console` or `dotnet new web` creates a project; `dotnet run` builds and runs it; `dotnet watch` reruns it (or patches it live) as you edit.
- A project is a folder with a **`.csproj`** file and `.cs` files. A **solution** (`.sln` or `.slnx`) groups projects.
- **Debug** by setting a breakpoint and pressing F5: the app pauses there and you can inspect every variable.
- **Test** with a separate test project and `dotnet test`.
- **Publish** with `dotnet publish -c Release`, and run the output the way a server will.

## Words you'll meet {b}

| Word | Meaning |
|---|---|
| **SDK** | the tools for *building* .NET apps: the compiler, the `dotnet` command, templates. Includes a runtime. |
| **runtime** | what's needed to *run* a built app. Servers often have only this. |
| **project** | one buildable unit: a `.csproj` file plus its source files. Builds into one assembly (`.dll`). |
| **solution** | a file listing several projects so you can build and open them together |
| **template** | a starting project, used by `dotnet new` (`console`, `web`, `webapi`, `classlib`, `xunit`, ...) |
| **target framework (TFM)** | the .NET version a project builds for, such as `net8.0` or `net9.0` |
| **NuGet package** | a library someone else published, added to your project with `dotnet add package` |
| **breakpoint** | a marker on a line where the debugger pauses the running app |
| **Hot Reload** | applying code changes to a running app without restarting it |
| **publish** | producing the folder you deploy: compiled, optimised, with dependencies |

## Previously at Kettle {b}

The two founders have chosen .NET for everything Kettle needs: a web API, a background worker and a command-line tool. One of them has written Java for years; the other mostly JavaScript. Neither has created a .NET project yet.

**The problem:** before any theory, they need the everyday loop: create a project, run it, find a bug, test a fix, ship it.

**This episode:** that loop, end to end, with every file and command explained.

## Install and check the SDK {b}

:::plain
You install one thing, the .NET SDK, and you get everything: the compiler, the `dotnet` command and a runtime to run what you build.
:::

Download the SDK from [dot.net](https://dot.net), or use a package manager (`winget install Microsoft.DotNet.SDK.8`, `brew install --cask dotnet-sdk`, or on Ubuntu `sudo apt install dotnet-sdk-8.0`). Then check it:

```bash
dotnet --info            # SDK and runtime versions, OS, install location
dotnet --list-sdks       # every SDK installed side by side
dotnet --list-runtimes   # every runtime installed side by side
```

Several versions install **side by side** without conflict. By default the `dotnet` command uses the newest SDK installed; a `global.json` file in your repository can pin a specific one, so everyone on the team builds with the same SDK ([Projects & packages](ch:projects-sdk-nuget)).

**An editor:** Visual Studio (Windows, the full IDE), **VS Code with the C# Dev Kit** extension (any OS, free), or JetBrains **Rider** (any OS). Everything in this chapter works from the command line, so the editor is your choice.

## Create and run a console app {b}

:::plain
`dotnet new console` creates a tiny program that prints "Hello, World!". `dotnet run` compiles it and runs it.
:::

```bash
mkdir kettle && cd kettle
dotnet new console -n Kettle.Cli -o src/Kettle.Cli
cd src/Kettle.Cli
dotnet run
# Hello, World!
```

You now have two files that matter:

```xml
<!-- Kettle.Cli.csproj : what to build, and how -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>                 <!-- an executable, not a library -->
    <TargetFramework>net8.0</TargetFramework>    <!-- which .NET to build for -->
    <ImplicitUsings>enable</ImplicitUsings>      <!-- common namespaces imported for you -->
    <Nullable>enable</Nullable>                  <!-- the compiler warns about possible nulls -->
  </PropertyGroup>
</Project>
```

```csharp norun
// Program.cs
Console.WriteLine("Hello, World!");
```

What happened when you ran `dotnet run`:

1. **Restore**: download any NuGet packages the project needs (none yet) into a shared cache.
2. **Build**: the C# compiler turns `Program.cs` into **IL** inside `bin/Debug/net8.0/Kettle.Cli.dll`. The `obj/` folder holds intermediate files.
3. **Run**: the runtime loads that `.dll`, the JIT turns IL into machine code, and your line runs. [How code runs](ch:how-code-runs) follows this in detail.

`bin/` and `obj/` are build output. Never commit them: `dotnet new gitignore` creates a `.gitignore` that excludes them.

## Program.cs: where the program starts {b}

:::plain
The code at the top of `Program.cs` is where your program starts. The compiler wraps it in a hidden `Main` method for you.
:::

The one-line `Program.cs` uses **top-level statements**. Older code (and many tutorials) write the same program the long way:

```csharp norun
namespace Kettle.Cli;

internal class Program
{
    static void Main(string[] args)      // the entry point: the runtime calls this first
    {
        Console.WriteLine("Hello, World!");
    }
}
```

Both compile to the same thing. With top-level statements:

- **Only one file** in a project can have them; that file is the entry point.
- **`args`** is still available: `dotnet run -- --verbose` passes `--verbose` in `args`.
- **`await`** works directly at the top level, so the hidden `Main` becomes `async Task Main`.
- **Types** (classes, records, interfaces) go *after* the top-level code, or in other files.
- **The exit code** comes from `return 1;` at the top level, or `Environment.ExitCode`.

ASP.NET Core apps use exactly the same thing: a web app's `Program.cs` is top-level statements that build and run a web server ([Hosting](ch:aspnet-hosting)).

## Namespaces and using directives {b}

:::plain
A namespace is a family name for types, so two classes called `Order` in different libraries don't clash. `using` lets you write the short name instead of the full one.
:::

```csharp norun
namespace Kettle.Ordering;                // file-scoped: everything in this file is in Kettle.Ordering

using System.Text.Json;                   // now JsonSerializer means System.Text.Json.JsonSerializer

public class Order { }                    // full name: Kettle.Ordering.Order
```

- **Namespaces usually follow folders**: `src/Kettle.Core/Ordering/Order.cs` → `namespace Kettle.Core.Ordering;`. It's a convention, not a rule, but tools and teammates expect it.
- **Implicit usings**: `<ImplicitUsings>enable</ImplicitUsings>` imports the common namespaces (`System`, `System.Collections.Generic`, `System.Linq`, `System.Threading.Tasks`, and for web projects `Microsoft.AspNetCore.*` ones). That's why `Console` and `List<T>` work without any `using` lines.
- **`global using`** in one file applies to the whole project: a `GlobalUsings.cs` with `global using Kettle.Core.Ordering;` saves repeating it.
- **Alias**: `using Json = System.Text.Json.JsonSerializer;` when two namespaces both have a type with the same name.
- **Access modifiers** decide what other projects can use: `public` (anyone), `internal` (only this project, the default for top-level types), `private` (only this type, the default for members) ([OOP](ch:oop)).

## The C# you'll see before Part II teaches it {b}

:::plain
Part II teaches C# properly. Until then, here is one small program that uses the ten things you'll keep seeing, so none of them is a mystery when it appears.
:::

:::walk Ten C# ideas in one small program
```csharp
var catalogue = new List<Tea>
{
    new("Assam", 4.50m, InStock: true),
    new("Sencha", 6.00m, InStock: false),
    new("Earl Grey", 5.25m, InStock: true),
};

var available = catalogue.Where(t => t.InStock).Select(t => t.Name);
Console.WriteLine(string.Join(", ", available));

IPriceRule rule = new HappyHour(percentOff: 20);
decimal price = await PriceAsync(catalogue[0], rule);
Console.WriteLine($"{catalogue[0].Name}: {price:0.00}");

try
{
    var oolong = catalogue.First(t => t.Name == "Oolong");
}
catch (InvalidOperationException)
{
    Console.WriteLine("No Oolong in the catalogue");
}

static async Task<decimal> PriceAsync(Tea tea, IPriceRule rule)
{
    await Task.CompletedTask;          // stands in for a database call
    return rule.Apply(tea.Price);
}

record Tea(string Name, decimal Price, bool InStock);

interface IPriceRule { decimal Apply(decimal price); }

class HappyHour(int percentOff) : IPriceRule
{
    public decimal Apply(decimal price) => price * (100 - percentOff) / 100;
}
```
@30 | -
A **record**: a type that just holds data, declared in one line. `Tea` gets a constructor, read-only properties, equality and a readable `ToString()` for free ([Records](ch:modern-csharp)).
@32 | -
An **interface**: a contract listing what something can do, with no code. Anything that implements `IPriceRule` must have an `Apply` method ([OOP](ch:oop)).
@34-37 | -
A **class** that implements the interface. `(int percentOff)` is a primary constructor: the value passed in is available to the whole class. `=>` defines a one-line method body.
@1-6 | catalogue = → List<Tea> [Assam, Sencha, Earl Grey]
A **generic** collection: `List<Tea>` is a list that can only hold `Tea` values, checked by the compiler ([Generics](ch:generics)). `var` lets the compiler work out the type; it's still strongly typed.
@8 | available = → a query, not run yet
**LINQ** with **lambdas**: `t => t.InStock` is a small inline function. `Where` filters, `Select` picks a value. Nothing runs yet: LINQ queries run when something reads them ([LINQ](ch:linq), [Delegates](ch:delegates-events)).
@9 | | > Assam, Earl Grey
`string.Join` reads the query, which runs now, and prints the names in stock.
@11 | rule = → HappyHour (20% off)
A variable of the **interface** type holding a class instance. Code that uses `rule` only knows it can call `Apply`; that's what lets you swap pricing rules without changing callers.
@12 | price = 3.60
**async/await**: `PriceAsync` returns a `Task<decimal>`, a value that will arrive later; `await` waits for it without blocking a thread ([Async](ch:async-await)).
@13 | | > Assam: 3.60
An **interpolated string**: values in `{ }` are inserted, and `:0.00` formats the number to two decimal places.
@17 | -
`First` finds the first match, or **throws an exception** if there is none. Nothing called Oolong exists, so it throws `InvalidOperationException`.
@19-21 | | > No Oolong in the catalogue
**try/catch**: the exception jumps straight to the matching `catch` block, skipping the rest of the `try` ([Exceptions](ch:exceptions-disposal)).
:::

The one idea not in the program is **attributes**: labels in square brackets, like `[HttpGet("/teas")]` or `[Fact]`, that attach information to code. They do nothing by themselves; a framework reads them and acts ([Attributes](ch:oop#attributes-labels-that-frameworks-read)).

## Run it while you edit: dotnet watch and Hot Reload {b}

:::plain
`dotnet watch` keeps your app running and applies each saved change, often without restarting it, so you see results in a second.
:::

```bash
dotnet watch            # instead of dotnet run
```

- On save, it tries **Hot Reload**: patching the method bodies in the running process. State is kept: a web app keeps its in-memory data and you don't lose your place.
- Some edits can't be patched into a running process, called **rude edits**: changing a method signature, adding a field to a generic type, changing the startup code that already ran. `dotnet watch` then asks to restart (press `a` to always restart automatically).
- Code in `Program.cs` that already ran won't run again after a hot reload. Change a route registration and you need a restart; change the body of a handler and you don't.
- Visual Studio and Rider have the same feature on a toolbar button, which also works while debugging.

## Debugging: stop the program and look inside {b}

:::plain
A debugger lets you pause your program on any line and see the value of every variable at that moment. It's the fastest way to understand what code is really doing.
:::

1. **Set a breakpoint**: click in the margin next to a line (or press **F9**). A red dot appears.
2. **Start with debugging**: **F5**. The app runs until it reaches the breakpoint, then pauses *before* running that line.
3. **Look around**:
   - **Locals / Variables** shows every variable in the current method.
   - **Watch** shows any expression you type (`order.Lines.Count`, `price * 2`).
   - **Call stack** shows how you got here: which method called which. Click a frame to see its variables.
   - Hover over a variable in the code to see its value.
4. **Move through the code**:
   - **F10 step over**: run this line, pause on the next.
   - **F11 step into**: go inside the method called on this line.
   - **Shift+F11 step out**: finish this method, pause in the caller.
   - **F5 continue**: run until the next breakpoint.

Shortcuts are Visual Studio and VS Code defaults; Rider's differ but the actions are the same.

Techniques worth learning early:

- **Conditional breakpoints**: right-click the breakpoint, add a condition such as `order.Id == 42`, so it only pauses for the case you care about, not the thousand before it.
- **Logpoints / tracepoints**: a breakpoint that prints a message (`Total is {total}`) and doesn't stop. Debug output without editing code.
- **Break on exceptions**: make the debugger stop where an exception is *thrown*, not where it's finally caught (Exception Settings in Visual Studio, the Breakpoints panel in VS Code).
- **Debugging a web app** is the same: put a breakpoint in an endpoint, start with F5, send a request with the browser or `curl`, and the debugger stops inside it.
- **Attach to process**: debug something already running, such as an app started with `dotnet run` in a terminal or a service on a test machine.
- **Debugging tests**: every editor has "Debug test" next to each test, which is the fastest route into a failing case.

:::tip Debug builds vs Release builds
Debugging works best with a **Debug** build (the default for `dotnet run` and F5): the compiler doesn't optimise, so every variable and line is where you expect. In a **Release** build, variables can be optimised away and lines merged, so the debugger sometimes shows "value optimised away". Production runs Release.
:::

## A second project: a solution, a library and a reference {i}

:::plain
Real apps are several projects: the main app plus libraries it uses. A solution file ties them together, and a project reference lets one use another's code.
:::

```bash
cd ~/kettle
dotnet new sln -n Kettle                                       # creates Kettle.sln
dotnet new classlib -n Kettle.Core -o src/Kettle.Core          # a library: no Main, builds to a .dll
dotnet sln add src/Kettle.Cli src/Kettle.Core
dotnet add src/Kettle.Cli reference src/Kettle.Core            # Cli can now use Core's public types
dotnet build                                                   # builds both, in dependency order
```

- A **class library** (`classlib`) is a project without an entry point; other projects use its `public` types.
- **Project references** go one way and can't form cycles: `Cli → Core` is fine, `Core → Cli` as well would fail.
- **Why split at all?** The domain logic in `Core` can be shared by the CLI, the web API and the worker, and tested on its own. Kettle's layout grows from here ([Projects & packages](ch:projects-sdk-nuget#the-physical-structure-of-a-net-codebase)).
- Newer SDKs can create the simpler XML solution format, `.slnx`; both formats work with `dotnet build` and the editors.

## Using a NuGet package {b}

:::plain
NuGet is where .NET libraries are published. One command adds a library to your project; the next build downloads it.
:::

```bash
dotnet add src/Kettle.Cli package Spectre.Console      # a library for nice console output
```

This adds `<PackageReference Include="Spectre.Console" Version="..." />` to the `.csproj`. On the next build, NuGet downloads the package into a shared cache (`~/.nuget/packages`), not into your project. `dotnet list package --vulnerable` and `--outdated` check what you depend on. Choosing and managing packages is covered in [NuGet in depth](ch:projects-sdk-nuget#nuget-in-depth).

## Your first test {b}

:::plain
A test is a small method that runs your code and checks the result. A test project holds them, and `dotnet test` runs them all.
:::

```bash
dotnet new xunit -n Kettle.Core.Tests -o tests/Kettle.Core.Tests
dotnet sln add tests/Kettle.Core.Tests
dotnet add tests/Kettle.Core.Tests reference src/Kettle.Core
```

```csharp norun
// tests/Kettle.Core.Tests/HappyHourTests.cs
public class HappyHourTests
{
    [Fact]                                           // an attribute: "this method is a test"
    public void Twenty_percent_off_a_five_pound_tea_is_four_pounds()
    {
        var rule = new HappyHour(percentOff: 20);

        var price = rule.Apply(5.00m);

        Assert.Equal(4.00m, price);
    }
}
```

```bash
dotnet test
# Passed!  - Failed: 0, Passed: 1, Skipped: 0, Total: 1
```

- **Arrange, act, assert**: set up, do the one thing, check the result. The blank lines in the test mark the three steps.
- **Name tests after the behaviour**, so a failure reads like a sentence.
- Test projects reference the code they test, never the other way round.
- [Unit testing](ch:unit-testing) goes much further: test doubles, data-driven tests, what to test and what not to.

## A web API in five lines {b}

:::plain
A web API is the same kind of project with a web server inside. `dotnet new web` creates one, and each `MapGet` line answers one URL.
:::

```bash
dotnet new web -n Kettle.Api -o src/Kettle.Api
dotnet sln add src/Kettle.Api
```

```csharp norun
// src/Kettle.Api/Program.cs
var builder = WebApplication.CreateBuilder(args);   // configuration, logging, services
var app = builder.Build();                          // the web server and request pipeline

app.MapGet("/teas", () => new[] { "Assam", "Sencha", "Earl Grey" });

app.Run();                                          // listen for requests until stopped
```

```bash
dotnet run --project src/Kettle.Api
# Now listening on: http://localhost:5123
curl http://localhost:5123/teas
# ["Assam","Sencha","Earl Grey"]
```

- The port comes from `Properties/launchSettings.json`, which only `dotnet run` and the editors read. It's for local development; servers configure ports differently ([launchSettings](ch:projects-sdk-nuget#launchsettings-json-and-environments)).
- The return value is turned into JSON automatically.
- `dotnet new webapi` creates a fuller starting point with OpenAPI. Part III explains every line of these programs: [Hosting](ch:aspnet-hosting), [Routing](ch:routing), [Building APIs](ch:building-apis).
- **HTTPS locally**: the first time, run `dotnet dev-certs https --trust` so your browser trusts the development certificate.

## Publish and run it like a server would {i}

:::plain
`dotnet run` is for development. To deploy, `dotnet publish` produces an optimised folder, and you run the app from that folder with no SDK and no source code.
:::

```bash
dotnet publish src/Kettle.Api -c Release -o out/api
ls out/api                       # Kettle.Api.dll, Kettle.Core.dll, dependencies, appsettings.json, ...
cd out/api && dotnet Kettle.Api.dll        # or ./Kettle.Api, the native launcher
```

- **`-c Release`** turns on compiler optimisations. Debug builds are noticeably slower and should never reach production.
- The published folder needs only a **runtime** on the machine, not the SDK, unless you publish **self-contained** (`--self-contained -r linux-x64`), which includes the runtime too ([What .NET is](ch:what-is-dotnet), [Deploying to Linux](ch:linux-deploy)).
- Run from the published folder: it uses `appsettings.json` and environment variables, not `launchSettings.json`. Set the environment with `ASPNETCORE_ENVIRONMENT`, and the port with `ASPNETCORE_URLS` or `ASPNETCORE_HTTP_PORTS`.
- `dotnet publish` can also produce a **container image** directly (`-t:PublishContainer`), with no Dockerfile ([Docker](ch:docker)).

## The first errors everyone hits {b}

| Error | What it means | Fix |
|---|---|---|
| `The current .NET SDK does not support targeting .NET 9.0` | the project targets a newer .NET than the SDK installed | install that SDK, or change `<TargetFramework>` |
| `A compatible .NET SDK was not found` | `global.json` asks for an SDK you don't have | install it, or update `global.json` |
| `Couldn't find a project to run` | you're in a folder with no `.csproj`, or with several | `cd` into the project, or use `--project path` |
| `Address already in use` | another process (often your previous run) holds the port | stop it, or change the port |
| `The type or namespace name 'X' could not be found` | a missing `using`, project reference or package | add the `using`, `dotnet add reference`, or `dotnet add package` |
| Browser warns about the certificate on `https://localhost` | the dev certificate isn't trusted | `dotnet dev-certs https --trust` |
| Warning `CS8618: Non-nullable property must contain a non-null value` | nullable reference types are on and something could be null | initialise it, make it `required`, or mark it `?` ([Nullable](ch:modern-csharp#nullable-reference-types-the-compiler-tracks-maybe-null)) |
| Changes don't show up | you're running an old build or a published copy | stop and `dotnet run` again, or use `dotnet watch` |

## The loop, in one picture {b}

```text
 dotnet new ─▶ edit ─▶ dotnet watch ─▶ breakpoint + F5 ─▶ dotnet test ─▶ dotnet publish -c Release ─▶ run the output
     ▲                                                                                                    │
     └──────────────────────────────── next feature ◀────────────────────────────────────────────────────┘
```

Every chapter from here assumes this loop. When a chapter shows code, you can paste it into a console or web project and run, step through and test it this way.

## Interview questions {i}

:::qa What's the difference between the .NET SDK and the runtime?
The SDK contains the tools to build apps: the compiler, the `dotnet` CLI, MSBuild and templates, plus a runtime. The runtime only runs already-built apps. Development machines and CI need the SDK; servers running framework-dependent apps need only the matching runtime, and self-contained apps need neither.
:::

:::qa What do `dotnet build`, `dotnet run` and `dotnet publish` each do?
`build` restores packages and compiles projects to IL assemblies in `bin/`. `run` builds and then starts the app using development settings such as `launchSettings.json`. `publish` builds with the chosen configuration (usually Release) and copies everything needed to run into one folder for deployment, optionally self-contained, single-file, ReadyToRun or as a container image.
:::

:::qa What are top-level statements?
A C# feature that lets one file contain the program's code directly, without declaring a class and a `Main` method. The compiler generates the entry point around it, supporting `args`, `await` and return codes. Only one file per project can use it.
:::

:::qa How do you debug a problem that only happens for one record out of thousands?
Use a conditional breakpoint with an expression matching that record, or a logpoint to print values without stopping. Enable breaking on thrown exceptions to stop where an error originates. If it happens only in a deployed environment, reproduce it locally with the same data, or attach to the process, or capture a dump and examine it.
:::

## Next episode {b}

Kettle has a working loop: projects that build, run, debug, test and publish. But what actually happens between `dotnet run` and the text on screen? The CPU can't read C#. Something has to translate it. [Episode 3 · From C# to machine code →](ch:how-code-runs)

## Further reading

- [Tutorial: create a .NET console application](https://learn.microsoft.com/en-us/dotnet/core/tutorials/with-visual-studio-code)
- [Top-level statements](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/top-level-statements)
- [.NET Hot Reload](https://learn.microsoft.com/en-us/visualstudio/debugger/hot-reload)
- [Debugging in VS Code with C# Dev Kit](https://code.visualstudio.com/docs/csharp/debugging)
- [dotnet CLI overview](https://learn.microsoft.com/en-us/dotnet/core/tools/)
