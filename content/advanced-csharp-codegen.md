---
id: advanced-csharp-codegen
title: "Do the Work at Build Time: Source Generators and Native AOT"
summary: "11:00: the price-check API moves to serverless, and every cold start takes 2.4 seconds because the JSON serializer and the audit dispatcher reflect over every type at startup. Everything reflection discovers was already known at compile time, so a source generator discovers it once, during the build. Sixth of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Source generators
fits: The direct answer to the cost measured in [reflection](ch:advanced-csharp-reflection#the-bill). Also the mechanism behind trimming and [Native AOT](ch:how-code-runs#what-if-you-skipped-the-jit-completely), and the reason `partial` exists ([Classes and objects](ch:oop#static-sealed-and-partial)).
levels: a
prereqs: advanced-csharp-reflection
next: advanced-csharp-exprtrees
---

:::plain
Everything reflection discovers at startup was already known when you compiled. A source generator does that discovery once, during the build, and writes ordinary C# code, so the app has nothing left to figure out when it starts.
:::

## Start from zero: what the compiler does with your code

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

## Generators in depth {a}

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
