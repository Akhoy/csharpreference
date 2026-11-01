---
id: serialization
title: "JSON and System.Text.Json: Turning Objects into Text and Back"
summary: "Every request and response Kettle sends is JSON. Covers what serialization is, System.Text.Json's defaults and the Web defaults ASP.NET Core uses, naming and ignoring properties, enums as strings, records and constructors, required and missing members, polymorphism with type discriminators, custom converters, the DOM types (JsonNode, JsonDocument), streaming large payloads, source generation for speed and Native AOT, caching options, safety limits, and how it differs from Newtonsoft.Json."
layer: framework
where: ASP.NET Core › Serialization
fits: "Every API in [Building APIs](ch:building-apis) serializes through System.Text.Json, every message in [Messaging](ch:messaging-events) is a serialized contract, and the source generator is one of the tools from [Advanced C#](ch:advanced-csharp#act-6-11-00-the-cold-start-do-the-work-at-build-time)."
levels: b,i,a
prereqs: building-apis
next: errors-logging
---

## The 30-second version

- **Serialization** turns an object into text or bytes (JSON here), and **deserialization** turns it back. Both sides must agree on the shape: it's a contract.
- `JsonSerializer.Serialize(obj)` and `Deserialize<T>(json)` use **public properties**. By default names stay as written (`Total`) and matching is case-sensitive. ASP.NET Core uses the **Web defaults**: camelCase names and case-insensitive reading.
- Shape the JSON with attributes (`[JsonPropertyName]`, `[JsonIgnore]`, `[JsonRequired]`) or options (naming policy, ignore nulls, enums as strings).
- Base types need **`[JsonPolymorphic]` and `[JsonDerivedType]`** to round-trip subclasses safely.
- **Create `JsonSerializerOptions` once** and reuse it. Use the **source generator** for speed and Native AOT.

## Words you'll meet

| Word | In plain words |
|---|---|
| **serialize / deserialize** | Object → JSON text, and JSON text → object. |
| **naming policy** | A rule for turning C# names into JSON names, such as camelCase. |
| **converter** | Code that controls exactly how one type is written and read. |
| **type discriminator** | An extra JSON property, like `"kind": "card"`, that says which subclass an object is. |
| **DOM** | Document object model: the JSON held as a tree you can walk and edit, without a C# class. |
| **source generation** | Writing the serialization code at build time instead of discovering types with reflection at run time. |

:::note What you need first
- **[Building APIs: Minimal APIs, Controllers, Binding, Validation and Filters](ch:building-apis)**: endpoints bind request data to parameters and turn return values into HTTP responses, usually JSON.
:::

## Previously at Kettle {b}

Kettle's endpoints bind JSON bodies and return JSON results, and so far the defaults have been fine. Then the edges arrive. The mobile app expects camelCase, a partner sends order statuses as strings, the payments endpoint must accept three kinds of payment in one field, a nightly export is 400 MB of JSON, and the serverless price check spends its cold start reflecting over DTOs.

**The problem:** JSON is the contract with every client, and the defaults only cover the easy cases.

**This episode:** how System.Text.Json works, how to shape its output, and how to make it fast and safe.

## Start from zero: what serialization does {b}

:::plain
Objects live in memory and only make sense inside one running program. To send one over the network or save it to a file, you write it out as text in an agreed format, and the other side reads that text back into its own objects.
:::

An `Order` object in Kettle's memory is a set of fields at addresses that mean nothing to the mobile app on a phone. To send it, Kettle writes its **data**, not its memory, in a format both sides understand:

```json
{"id":42,"product":"Sencha","total":13.00,"status":"Paid"}
```

The phone reads that text and builds its own object. Methods, private fields and object identity don't travel; only the data you chose does. That chosen shape is a **contract**: rename `total` on one side, and the other side silently gets nothing.

.NET's built-in serializer is **System.Text.Json** (STJ). It reads and writes UTF-8 directly, allocates little, and is what ASP.NET Core uses unless you configure something else.

## The defaults, and the Web defaults {b}

:::plain
System.Text.Json is strict by default: exact property names and no comments. ASP.NET Core uses the "web" defaults instead: camelCase names, case-insensitive reading, and numbers allowed as strings.
:::

:::walk Same object, two sets of defaults
```csharp
using System.Text.Json;

var order = new Order(42, "Sencha", 13.00m, OrderStatus.Paid);
Console.WriteLine(JsonSerializer.Serialize(order));

var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
Console.WriteLine(JsonSerializer.Serialize(order, web));

var back = JsonSerializer.Deserialize<Order>("""{"id":7,"product":"Assam","total":4.5,"status":1}""", web);
Console.WriteLine(back);

record Order(int Id, string Product, decimal Total, OrderStatus Status);
enum OrderStatus { Pending, Paid }
```
@3 | order = Order { Id = 42, Product = Sencha, Total = 13.00, Status = Paid }
A record with four public properties.
@4 | | > {"Id":42,"Product":"Sencha","Total":13.00,"Status":1}
The plain defaults: property names exactly as in C#, the `decimal` keeps its two decimal places, and the enum is written as its **number**.
@6-7 | web = options with camelCase names and case-insensitive reading | > {"id":42,"product":"Sencha","total":13.00,"status":1}
`JsonSerializerDefaults.Web` is what ASP.NET Core uses: camelCase property names, case-insensitive matching when reading, and numbers allowed in quotes when reading.
@9 | back = Order { Id = 7, Product = Assam, Total = 4.5, Status = Paid }
Reading back. A record has no setters, so STJ calls its **constructor**, matching JSON properties to constructor parameters by name.
@10 | | > Order { Id = 7, Product = Assam, Total = 4.5, Status = Paid }
:::

What STJ serializes, by default:

- **Public properties** with a public getter (for writing) and, for reading, a public setter, an `init` accessor, or a matching constructor parameter.
- **Not fields.** Set `IncludeFields = true`, or mark a field `[JsonInclude]`.
- **Not non-public members**, unless marked `[JsonInclude]`.

In ASP.NET Core, configure the options the framework uses once, in `Program.cs`:

```csharp norun
builder.Services.ConfigureHttpJsonOptions(o =>               // minimal APIs
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});
builder.Services.AddControllers().AddJsonOptions(o => { /* the same, for controllers */ });
```

## Shaping the JSON {b}

:::plain
Attributes on a property change how that one property looks. Options change the rules for everything.
:::

| You want | Per property | For everything |
|---|---|---|
| a different name | `[JsonPropertyName("sku_code")]` | `PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower` (.NET 8 adds snake and kebab case) |
| to leave it out | `[JsonIgnore]` | |
| to leave it out when null | `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` | `DefaultIgnoreCondition = WhenWritingNull` |
| enum as text | `[JsonConverter(typeof(JsonStringEnumConverter))]` on the enum | `Converters.Add(new JsonStringEnumConverter())` |
| to reject JSON that lacks it | `[JsonRequired]`, or the C# `required` keyword (.NET 7+) | |
| to reject unknown properties | | `UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow` (.NET 8) |
| to keep unknown properties | a `[JsonExtensionData] Dictionary<string, JsonElement>` property | |
| a specific property order | `[JsonPropertyOrder(1)]` | |

:::walk Enums as text, nulls left out
```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    Converters = { new JsonStringEnumConverter() },
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};
Console.WriteLine(JsonSerializer.Serialize(new Parcel("TRK-9", null, Courier.Royal), options));

record Parcel(string Tracking, string? Note, Courier Courier);
enum Courier { Royal, Dpd }
```
@4-8 | options = Web defaults + enums as strings + skip nulls
One options object, reused for every call.
@9 | | > {"tracking":"TRK-9","courier":"Royal"}
`Note` is null, so it's left out. The courier is written as its name, which partners can read and which doesn't break if someone reorders the enum.
:::

Writing enums as **strings** is the safer default for contracts: a number means nothing to a reader, and inserting a new enum member in the middle silently changes every later number.

## Polymorphism: one field, several kinds {i}

:::plain
If a property's type is a base class, the serializer needs to write down which subclass each object really is, and read that back. You tell it the allowed subclasses and the label for each.
:::

Kettle's checkout accepts a card, a gift card or PayPal in one `payment` field. By default, STJ serializes using the **declared** type, so a `Payment` property writes only `Payment`'s properties and can't deserialize into a subclass at all. You opt in, listing the allowed subclasses:

:::walk Round-tripping subclasses
```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
Payment[] payments = [new Card("4242"), new GiftCard("GC-1", 20m)];

string json = JsonSerializer.Serialize(payments, web);
Console.WriteLine(json);

var back = JsonSerializer.Deserialize<Payment[]>(json, web)!;
Console.WriteLine(back[1].GetType().Name);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(Card), "card")]
[JsonDerivedType(typeof(GiftCard), "gift")]
abstract record Payment;
record Card(string Last4) : Payment;
record GiftCard(string Code, decimal Balance) : Payment;
```
@5 | payments = [Card { Last4 = 4242 }, GiftCard { Code = GC-1, Balance = 20 }]
An array declared as the base type, holding two different subclasses.
@7-8 | | > [{"kind":"card","last4":"4242"},{"kind":"gift","code":"GC-1","balance":20}]
Each object gets a **type discriminator**, `kind`, written first, followed by its own properties.
@10 | back = [Card, GiftCard]
Reading back, STJ reads `kind` and creates the matching subclass.
@11 | | > GiftCard
:::

This is deliberately an **allow-list**. Older serializers could write the full .NET type name into the JSON (Newtonsoft's `TypeNameHandling`) and create whatever type the JSON named, which let attackers instantiate dangerous types: a known remote-code-execution hole ([Web security](ch:web-security#supply-chain-and-dependencies)). STJ only creates the types you listed.

## Custom converters {i}

:::plain
When a type needs a special JSON shape, a converter tells the serializer exactly how to write it and read it back.
:::

When attributes and options aren't enough, a **converter** takes full control of one type. Kettle's `Money` value should appear as `"GBP 13.00"`:

```csharp norun
public sealed class MoneyConverter : JsonConverter<Money>
{
    public override Money Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        var text = reader.GetString() ?? throw new JsonException("Money can't be null");
        var parts = text.Split(' ');
        return new Money(decimal.Parse(parts[1], CultureInfo.InvariantCulture), parts[0]);
    }

    public override void Write(Utf8JsonWriter writer, Money value, JsonSerializerOptions options)
        => writer.WriteStringValue($"{value.Currency} {value.Amount.ToString("0.00", CultureInfo.InvariantCulture)}");
}
// register: options.Converters.Add(new MoneyConverter()), or [JsonConverter(typeof(MoneyConverter))] on Money
```

- The reader is a `ref` parameter of a **ref struct** (`Utf8JsonReader`), which reads forward through UTF-8 bytes without allocating. Read exactly the tokens for your value and leave the reader positioned at the value's last token.
- Throw `JsonException` for bad input, so ASP.NET Core turns it into a 400 rather than a 500.
- Always parse and format with `CultureInfo.InvariantCulture` ([Everyday types](ch:everyday-types#rounding-and-conversions)).

## Working without a class: JsonNode and JsonDocument {i}

:::plain
Sometimes you don't have, or want, a class for the JSON. `JsonNode` lets you read and edit it like a tree; `JsonDocument` reads it very quickly but read-only.
:::

Sometimes you don't have, or want, a C# type: a webhook with a changing shape, or a document you only need one value from.

:::walk Reading and changing JSON as a tree
```csharp
using System.Text.Json.Nodes;

var node = JsonNode.Parse("""{"sku":"TEA-01","stock":{"london":12,"leeds":0}}""")!;
int london = node["stock"]!["london"]!.GetValue<int>();
node["stock"]!["leeds"] = 5;
node["updated"] = true;

Console.WriteLine(london);
Console.WriteLine(node.ToJsonString());
```
@3 | node = JsonObject { sku, stock { london, leeds } }
`JsonNode.Parse` builds a **mutable** tree of objects, arrays and values.
@4 | london = 12
Index into it by property name, and read a typed value.
@5-6 | node = { sku: TEA-01, stock: { london: 12, leeds: 5 }, updated: true }
Change a value and add a property, like editing a dictionary.
@8 | | > 12
@9 | | > {"sku":"TEA-01","stock":{"london":12,"leeds":5},"updated":true}
:::

| Type | Use it for |
|---|---|
| `JsonNode` / `JsonObject` / `JsonArray` | reading **and editing** JSON as a tree |
| `JsonDocument` / `JsonElement` | fast **read-only** access; it rents pooled memory, so **dispose** the document |
| `Utf8JsonReader` / `Utf8JsonWriter` | the lowest level: forward-only, allocation-free reading and writing, used by converters and streaming code |

## Big payloads: stream instead of buffer {a}

:::plain
For large JSON, read and write it as a stream so it never all sits in memory at once.
:::

`JsonSerializer.Serialize(obj)` builds the whole string in memory. For a 400 MB export, that's 400 MB of string, plus the objects it came from, much of it on the Large Object Heap ([Memory & GC](ch:memory-gc)). Stream it instead:

```csharp norun
// Writing: straight to the response or file stream, flushing as it goes
await JsonSerializer.SerializeAsync(stream, orders, options, ct);

// Reading a huge top-level array one item at a time
await foreach (var order in JsonSerializer.DeserializeAsyncEnumerable<Order>(stream, options, ct))
    await ProcessAsync(order!, ct);
```

In ASP.NET Core, returning an `IAsyncEnumerable<T>` from an endpoint streams the JSON array as items are produced, so a large export starts arriving immediately and never sits in memory whole ([EF Core querying](ch:efcore-querying)).

## Speed: cached options and source generation {a}

:::plain
Create your serializer options once and reuse them. Source generation writes the serialization code at build time, which is faster at startup and works with Native AOT.
:::

**Cache your options.** A `JsonSerializerOptions` instance builds and caches metadata about every type it serializes. Creating a new one per call throws that cache away, and makes every call rediscover the type with reflection. Create options **once** (a `static readonly` field, or the ones ASP.NET Core configures), and the analyzer warning CA1869 catches the mistake.

**Source generation** moves the discovery to build time ([Advanced C#](ch:advanced-csharp#act-6-11-00-the-cold-start-do-the-work-at-build-time)):

```csharp norun
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, UseStringEnumConverter = true)]
[JsonSerializable(typeof(Order))]
[JsonSerializable(typeof(List<Order>))]
internal partial class KettleJson : JsonSerializerContext { }

string json = JsonSerializer.Serialize(order, KettleJson.Default.Order);       // no reflection at all
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, KettleJson.Default));
```

The generator writes the code that reads and writes each listed type, so start-up has nothing to discover, and the trimmer can see everything. It's **required for Native AOT**, where reflection-based serialization isn't available. List every type you serialize, including collection types such as `List<Order>`.

## Safety limits {a}

:::plain
JSON from outside can be hostile. Limits on nesting depth and size stop a malicious payload from using up your memory or CPU.
:::

- **Depth.** By default STJ refuses JSON nested more than 64 levels deep (`MaxDepth`), which stops deliberately deep payloads exhausting the stack.
- **Size.** STJ doesn't limit document size; your server does. Keep Kestrel's request body limit, and stream rather than buffer large inputs ([Web security](ch:web-security#resource-consumption-and-dos-protection)).
- **Cycles.** An object graph that refers back to itself (an order whose customer lists their orders) throws by default. `ReferenceHandler.IgnoreCycles` writes `null` at the loop; `ReferenceHandler.Preserve` writes `$id`/`$ref` markers. Better: serialize **DTOs**, which have no cycles, rather than EF entities.
- **No type names from input.** Polymorphism works only through the allow-list above.

## System.Text.Json vs Newtonsoft.Json {i}

:::plain
Newtonsoft.Json is the older, very flexible library many existing apps use. System.Text.Json is built in, faster and the default. New code should use System.Text.Json unless it needs a feature only Newtonsoft has.
:::

Many older codebases use **Newtonsoft.Json** (Json.NET). It's mature and very flexible, but slower and reflection-heavy. The differences that bite during migration:

| Behaviour | Newtonsoft.Json | System.Text.Json |
|---|---|---|
| Property name matching when reading | case-insensitive | case-**sensitive** by default (the Web defaults make it insensitive) |
| Comments and trailing commas | allowed | rejected unless `ReadCommentHandling` and `AllowTrailingCommas` are set |
| Numbers in quotes (`"42"`) | accepted | rejected unless `NumberHandling` allows it (the Web defaults do) |
| Non-public setters, fields | many supported | only with `[JsonInclude]` or `IncludeFields` |
| Polymorphism | `TypeNameHandling` (unsafe with untrusted input) | discriminator allow-list |
| `dynamic` / `JObject` | `JObject`, `JToken` | `JsonNode`, `JsonDocument` |
| Speed and allocations | slower, more garbage | faster, UTF-8 native, source-generation capable |

New code should use System.Text.Json. Keep Newtonsoft only where a dependency or an unusual feature truly needs it.

## Interview questions {i}

:::qa What are the System.Text.Json defaults, and how do ASP.NET Core's differ?
By default it serializes public properties (not fields), keeps C# property names, matches names case-sensitively when reading, and writes enums as numbers. ASP.NET Core uses `JsonSerializerDefaults.Web`: camelCase names, case-insensitive reading, and numbers accepted in quotes. Configure the framework's options once with `ConfigureHttpJsonOptions` or `AddJsonOptions`.
:::

:::qa How do you serialize a polymorphic type hierarchy safely?
Mark the base type with `[JsonPolymorphic]` and list each allowed subclass with `[JsonDerivedType(typeof(X), "label")]`. The serializer writes a type discriminator and only creates the listed types when reading. That allow-list is the safe alternative to embedding .NET type names in JSON, which lets attackers choose types to instantiate.
:::

:::qa Why reuse JsonSerializerOptions, and what does source generation add?
Each options instance caches per-type serialization metadata built through reflection, so creating options per call repeats that expensive work. Cache and reuse them. Source generation goes further: a `JsonSerializerContext` with `[JsonSerializable]` types generates serialization code at build time, removing run-time reflection, speeding up start-up, and making serialization trim- and Native AOT-compatible.
:::

:::qa JsonNode vs JsonDocument vs Utf8JsonReader?
`JsonNode` is a mutable tree for reading and editing JSON without a C# type. `JsonDocument` is a read-only, pooled-memory view for fast access, and must be disposed. `Utf8JsonReader` and `Utf8JsonWriter` are forward-only, allocation-free primitives for converters and streaming.
:::

:::qa How do you handle a very large JSON payload?
Stream it instead of buffering: `SerializeAsync` to the output stream, `DeserializeAsyncEnumerable` to process a large array item by item, or `IAsyncEnumerable<T>` results from an endpoint. Keep request size limits on input, and serialize DTOs to avoid huge or cyclic object graphs.
:::

## Next {b}

Kettle's JSON contracts are now explicit, safe and fast. Back to the story: an endpoint throws at 2 a.m., and the customer sees a stack trace. [Episode 7 · When it breaks at 2 a.m. →](ch:errors-logging)

## Further reading

- [System.Text.Json overview](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/overview)
- [Polymorphic serialization](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism)
- [Source generation](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation)
- [Migrate from Newtonsoft.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft)
