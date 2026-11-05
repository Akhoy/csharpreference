---
id: advanced-csharp-reflection
title: "The Audit Nobody Can Forget: Attributes and Reflection"
summary: "09:00: finance wants every refund and cancellation logged, and developers keep forgetting to call the logger by hand. Labelling the methods with an attribute and reading the labels at runtime, once, in one place, means nobody has to remember. Fifth of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Reflection and metadata
fits: Reads the metadata every compiled assembly carries ([How code runs](ch:how-code-runs#what-build-time-actually-hands-you)). This is the mechanism behind DI containers, serializers, ASP.NET Core's `[Authorize]` and test runners' `[Fact]`, and the cost this chapter measures is exactly what [source generators](ch:advanced-csharp-codegen) exist to avoid.
levels: i
prereqs: advanced-csharp-interop
next: advanced-csharp-codegen
---

:::plain
Put a label on the methods that need auditing, and have one piece of code read those labels at runtime and do the logging. Nobody has to remember anything, but reading labels at runtime has a cost.
:::

## Start from zero: every .dll carries a catalogue of itself

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

## The bill

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

## Reflection in depth {a}

**`BindingFlags`: why `GetMethod` returns null.** By default, `GetMethods()` and friends return only **public** members. Private members, or statics only, need explicit flags: `type.GetMethod("Recalculate", BindingFlags.NonPublic | BindingFlags.Instance)`. Once you pass any flags, you must include `Instance` or `Static` too, or nothing matches.

**Generic types at run time.** `typeof(List<>)` is the *open* generic type, with the blank still empty. `typeof(List<>).MakeGenericType(typeof(Order))` fills the blank and gives `List<Order>`. DI containers use this to turn a registration of `IRepository<>` into `IRepository<Order>` when asked.

**Attribute rules.**
- `[AttributeUsage]` says where an attribute may go (methods, classes…), whether it may appear twice (`AllowMultiple`), and whether subclasses inherit it (`Inherited`).
- Attribute arguments must be **compile-time constants**: numbers, strings, enums, `typeof(…)` and arrays of those. The values are written into the metadata tables, so they must be known at build time. You can't pass `DateTime.Now` or a `new` object.
- C# 11 added **generic attributes**: `[Validator<OrderValidator>]` instead of `[Validator(typeof(OrderValidator))]`, with the type checked by the compiler.

**Creating objects by type.** `Activator.CreateInstance(type)` works but is slow on every call. Frameworks create objects millions of times, so they build a factory **once**, usually a compiled expression tree ([Act 7](ch:advanced-csharp-exprtrees)), and cache it per type. That's what `ActivatorUtilities` in the DI library does.

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

## Verify this chapter

```csharp
using System.Reflection;

Check(typeof(Svc).GetMethod("Cancel")!.GetCustomAttribute<AuditAttribute>()?.Action == "cancel", "attributes are read through reflection");
var d = typeof(Svc).GetMethod("Double")!.CreateDelegate<Func<int, int>>(new Svc());
Check(d(21) == 42, "a MethodInfo can become a fast delegate");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

sealed class AuditAttribute(string action) : Attribute { public string Action { get; } = action; }
class Svc { [Audit("cancel")] public void Cancel() { } public int Double(int x) => x * 2; }
```
