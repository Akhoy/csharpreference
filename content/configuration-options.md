---
id: configuration-options
title: Configuration, Options and Secrets
summary: How settings reach your code. The layered configuration system and its providers, precedence, environment variables and naming, the Options pattern (IOptions, IOptionsSnapshot, IOptionsMonitor), validation at startup, named options, secrets in development and production, and feature flags.
layer: framework
where: ASP.NET Core › Hosting › Configuration & options
fits: Configuration is plumbing from `Microsoft.Extensions.Configuration` and `Microsoft.Extensions.Options`, owned by the host ([Hosting](ch:aspnet-hosting)) and delivered through DI ([Dependency injection](ch:dependency-injection)). In layer 7, the cloud supplies the values: App Service settings, Kubernetes ConfigMaps, Key Vault ([Identity & secrets](ch:azure-identity-secrets)).
levels: b,i,a
prereqs: aspnet-hosting, dependency-injection
next: middleware, azure-identity-secrets
---

## TL;DR

- The same compiled app needs different settings in each environment; **layered configuration** merges a JSON file, environment variables, command-line args and secrets into one `IConfiguration`, with later layers overriding earlier ones key-by-key.
- Reading `config["Payments:BaseUrl"]` directly is fine in `Program.cs`, but a typo in that string silently returns null instead of failing to compile — that's what the **Options pattern** fixes, by binding a section onto a typed class once.
- Three ways to consume options differ only in *when they pick up a change*: `IOptions<T>` (never, computed once), `IOptionsSnapshot<T>` (per request), `IOptionsMonitor<T>` (always current, safe in singletons).
- `.ValidateOnStart()` turns a missing or bad setting into a deployment that fails its health check immediately, instead of a payment that fails for a real customer later.
- Secrets never belong in a committed file: **User Secrets** in development, **Key Vault**/platform secret stores (or better, no secret at all via managed identity) in production.
- **Feature flags** separate *deploying* code from *releasing* it — ship a feature switched off, then turn it on gradually without a redeploy.

## The same build, four different places, four different answers {b}

Here's a constraint that sounds simple but shapes this entire chapter: the **exact same compiled binary** has to run on your laptop, in a CI pipeline, in staging, and in production — and in each of those four places, it needs a different database connection string, a different payment-gateway URL, and a set of secrets that absolutely cannot be the same ones twice.

Walk through what happens if you try to solve this the naive way, by baking the values into the code:

```csharp
// DON'T: this is the naive approach, and it breaks immediately
string connectionString = "Server=localhost;Database=Shop;...";
```

That compiles fine on your laptop. The moment you deploy it to staging, it's still pointing at `localhost` — which, inside a staging container, doesn't mean your laptop at all, it means the staging container itself, and there's no database there. You'd have to **rebuild** the app with a different hardcoded string for every environment, which means you're no longer testing the same binary you'll ship — exactly the problem [ASP.NET Core architecture](ch:aspnet-hosting#environments-the-one-variable-thats-meant-to-change-configur) flagged about letting environment branch code paths instead of just values. And if any of those hardcoded strings is a real secret, it's now sitting in your git history forever, readable by anyone with repo access, discoverable even after you "remove" it in a later commit.

ASP.NET Core's answer is **layered configuration**: several independent sources — a JSON file, environment variables, command-line arguments, a secrets store — each contribute key/value pairs, and later sources **override** earlier ones for the same key. Your code never reads any of those sources directly. It reads one merged, flattened view called `IConfiguration`, and has no idea — and doesn't need to know — which layer any particular value actually came from.

## The five layers, lowest priority to highest {b}

`WebApplication.CreateBuilder` wires up these sources automatically, in this exact order:

```text
1. appsettings.json                     ← defaults, committed to git, no secrets
2. appsettings.{Environment}.json       ← per-environment overrides (Development, Staging, Production)
3. User Secrets                          ← Development only; stored outside the repo
4. Environment variables                 ← how containers, App Service and Kubernetes inject settings
5. Command-line arguments                ← highest priority: --Logging:LogLevel:Default=Debug
   (+ anything you add later, e.g. Azure Key Vault, Azure App Configuration)
```

Let's trace one key through all five layers with real values, because "later overrides earlier" is easy to state and easy to get backwards in your head without a concrete run-through.

```json
// appsettings.json — the base, checked into git
{
  "ConnectionStrings": { "Shop": "Server=localhost;Database=Shop;Trusted_Connection=True" },
  "Payments": { "BaseUrl": "https://sandbox.pay.example", "TimeoutSeconds": 10, "Retries": 3 },
  "Logging": { "LogLevel": { "Default": "Information", "Microsoft.AspNetCore": "Warning" } },
  "AllowedHosts": "*"
}
```

```json
// appsettings.Production.json — only what differs from the base
{ "Payments": { "BaseUrl": "https://api.pay.example" } }
```

Now ask: in production, what is `Payments:BaseUrl`? Layer 1 sets it to the sandbox URL. Layer 2 (`appsettings.Production.json`, loaded because `ASPNETCORE_ENVIRONMENT=Production`) overrides it to the real API URL — and since nothing in layers 3–5 mentions `Payments:BaseUrl` at all, that production value is what survives to the end. What about `Payments:TimeoutSeconds`? No layer after layer 1 touches it, so it stays `10` straight from the base file — you never had to repeat it in the production file. And the real connection string, with real credentials? It was never written in *either* JSON file — it arrives from layer 4, an environment variable injected by whatever's actually running the container, which is exactly why you'll never find a production password by grepping the repo.

That's the whole mental model: **each layer only needs to mention the keys it wants to change**, and the merge happens key-by-key, independently, not file-by-file.

## Reading the merged view: keys, sections, and converting types {b}

Configuration ends up as one flat dictionary of string keys, with `:` marking a level of nesting — `Payments:BaseUrl`, `Logging:LogLevel:Default` — and arrays addressed by index: `AllowedOrigins:0`, `AllowedOrigins:1`.

```csharp
IConfiguration config = builder.Configuration;

string? url = config["Payments:BaseUrl"];                              // raw string
int timeout = config.GetValue<int>("Payments:TimeoutSeconds", 30);      // converted, with default
string? cs = config.GetConnectionString("Shop");                        // = config["ConnectionStrings:Shop"]
IConfigurationSection section = config.GetSection("Payments");
var opts = section.Get<PaymentOptions>();                               // bind section to a class
bool exists = section.Exists();
```

Reading `IConfiguration` directly like this is completely fine in `Program.cs` — you're wiring things up once, at startup. But scattering `config["Payments:TimeoutSeconds"]` calls across your actual business logic is a trap worth avoiding, for a reason that becomes obvious once you hit it: a typo in that string key doesn't fail to compile, it just silently returns `null` or the default value at runtime, and you find out in production. The **Options pattern**, a few sections below, exists specifically to close that hole.

## Environment variables need their own naming convention {b}

Here's a wrinkle worth knowing before it costs you a debugging session: the `:` that separates configuration levels isn't a character every platform allows in an environment variable name. So the environment-variable provider uses a **double underscore** `__` instead, translated automatically back to `:` when it's read:

| Configuration key | Environment variable |
|---|---|
| `Payments:BaseUrl` | `Payments__BaseUrl` |
| `ConnectionStrings:Shop` | `ConnectionStrings__Shop` |
| `Logging:LogLevel:Default` | `Logging__LogLevel__Default` |
| `AllowedOrigins:0` | `AllowedOrigins__0` |

```bash
docker run -e ConnectionStrings__Shop="Server=sql;..." -e ASPNETCORE_ENVIRONMENT=Staging shop-api
```

Get the underscores wrong — a single `_` instead of `__`, say — and nothing errors. The variable just doesn't match any key the provider recognises, so your app silently falls back to whatever the JSON file said, and you spend an hour wondering why a value you clearly set isn't taking effect. Two variable prefixes are reserved specifically for the **host itself** rather than your application settings: `ASPNETCORE_` and `DOTNET_` (as you saw with `ASPNETCORE_ENVIRONMENT` in the previous chapter). And one small mercy: configuration keys, including environment variable names, are matched **case-insensitively**, so `payments__baseurl` works exactly as well as `Payments__BaseUrl`.

## The Options pattern: turning strings-with-typos into a typed class {b}

So you've got a merged `IConfiguration`. The next question is how your actual services should consume it — and the answer the framework steers you toward is: **don't**, not directly. Instead, bind a configuration section onto a strongly typed class once, register that class in DI, and let services ask for the type instead of a string key.

```csharp
public sealed class PaymentOptions
{
    public const string SectionName = "Payments";

    [Required, Url] public string BaseUrl { get; init; } = "";
    [Range(1, 120)] public int TimeoutSeconds { get; init; } = 10;
    [Range(0, 10)]  public int Retries { get; init; } = 3;
    [Required]      public string ApiKey { get; init; } = "";     // supplied from secrets, not appsettings.json
}

builder.Services.AddOptions<PaymentOptions>()
    .BindConfiguration(PaymentOptions.SectionName)   // bind the "Payments" section
    .ValidateDataAnnotations()                        // run [Required], [Range]…
    .Validate(o => o.BaseUrl.StartsWith("https://"), "Payments:BaseUrl must use HTTPS")
    .ValidateOnStart();                               // fail at STARTUP, not on the first payment

public sealed class PaymentClient(HttpClient http, IOptions<PaymentOptions> options)
{
    private readonly PaymentOptions _o = options.Value;
    // use _o.BaseUrl, _o.Retries…
}
```

Notice what `.ValidateOnStart()` buys you specifically, because it's the single most valuable line in that block. Without it, if `Payments:ApiKey` is missing from production — maybe the Key Vault reference was typo'd in the IaC template — nothing breaks at deploy time. The app starts fine. It fails later, the first time a real customer tries to pay, at some unpredictable hour, as a confusing exception deep in `PaymentClient`. With `.ValidateOnStart()`, that same missing key makes the **deployment itself** fail its health check and get automatically rolled back — the same kind of fast-fail-at-boundary engineering that made graceful shutdown worth the effort in the previous chapter.

:::why Why reach for options instead of calling IConfiguration everywhere
- **Type safety:** `int TimeoutSeconds` instead of parsing `config["Payments:TimeoutSeconds"]` strings scattered across the codebase, each one a silent-failure typo waiting to happen.
- **Validation at startup:** a missing API key crashes the deployment immediately, where health checks and rollouts catch it, instead of failing customer payments at 3 a.m.
- **Testability:** `Options.Create(new PaymentOptions { ... })` in tests, with no configuration system needed at all.
- **Separation (Interface Segregation — a principle covered fully in [Design principles](ch:design-principles), meaning "depend only on what you actually use"):** each class gets only the settings it actually needs, not a reference to the entire configuration tree with permission to read anything.
:::

## Three flavours of "give me the options", and why there are three {i}

This is the part that trips people up, so let's be precise about *why* three interfaces exist instead of one. The question each one answers is: **when configuration changes while the app is already running, who sees the new value, and when?**

| Interface | Lifetime | Picks up changes? | Use when |
|---|---|---|---|
| `IOptions<T>` | Singleton | **No**, computed once on first access | Settings that don't change at runtime (most of them) |
| `IOptionsSnapshot<T>` | **Scoped** | Yes, recomputed **per request** | Reloadable settings used in scoped/transient services; named options per request |
| `IOptionsMonitor<T>` | Singleton | Yes, `CurrentValue` always latest, plus `OnChange` callback | Reloadable settings in **singletons** and background services |

`IOptions<T>` is the simplest and the right default: it reads the configuration once, caches it, and hands back the same value for the rest of the process's life. That's fine for almost everything — a payment gateway's base URL doesn't need to change without a redeploy.

But suppose you want a feature flag that an operator can flip without restarting the app — say, during an incident, to kill a misbehaving feature in seconds rather than waiting for a full redeploy. `IOptions<T>` can't do that; it already baked in its answer the first time anyone asked. `IOptionsMonitor<T>` is built for exactly this: it's still a singleton, so it's safe to inject into another singleton or a long-lived background service, but its `CurrentValue` property re-reads the live configuration every single time you access it, and it offers an `OnChange` callback you can subscribe to the moment a change lands.

```csharp
public sealed class FeatureGate(IOptionsMonitor<FeatureOptions> monitor, ILogger<FeatureGate> log)
{
    private readonly IDisposable? _sub = monitor.OnChange(o => log.LogInformation("Features changed: {@F}", o));
    public bool IsEnabled(string f) => monitor.CurrentValue.Enabled.Contains(f);
}
```

`IOptionsSnapshot<T>` sits in between: it's scoped, meaning it's recomputed once per request rather than once per process, so within a single request everyone sees a consistent value, but the *next* request picks up whatever changed in the meantime.

One detail worth being precise about, because it isn't automatic: `appsettings.json` reloads on file change by default (`reloadOnChange: true`), environment variables genuinely can't change for a process that's already running — the OS handed them to the process once at launch — and the Azure App Configuration and Key Vault providers refresh only on whatever polling interval you explicitly configure for them.

:::gotcha The captive-dependency trap, reappearing here in a new costume
`IOptionsSnapshot<T>` is **scoped**. If you inject it into a singleton, you've built the exact same captive dependency [Dependency injection](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug) warned about — a short-lived thing trapped inside a long-lived one — and with scope validation enabled it throws at startup rather than silently freezing the options at whatever they were on the very first request. The fix is simple once you see it: use `IOptionsMonitor<T>` in singletons, full stop.
:::

## Named options and post-configuration: when one options type isn't enough {a}

Sometimes the same *shape* of settings needs several independent *instances* — think storage settings for invoices and storage settings for images, structurally identical but pointing at different containers:

```csharp
builder.Services.Configure<StorageOptions>("invoices", builder.Configuration.GetSection("Storage:Invoices"));
builder.Services.Configure<StorageOptions>("images",   builder.Configuration.GetSection("Storage:Images"));

public class InvoiceStore(IOptionsMonitor<StorageOptions> opts)
{
    private readonly StorageOptions _o = opts.Get("invoices");
}

// Code-based configuration and post-processing
builder.Services.Configure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o => o.MapInboundClaims = false);
builder.Services.PostConfigure<PaymentOptions>(o => { /* runs after all Configure calls */ });

// Configure using other services: IConfigureOptions<T>
public sealed class ConfigureCors(IOptions<FrontendOptions> fe) : IConfigureNamedOptions<CorsOptions>
{
    public void Configure(string? name, CorsOptions o) => o.AddPolicy("web", p => p.WithOrigins(fe.Value.Origins));
    public void Configure(CorsOptions o) => Configure(null, o);
}
builder.Services.ConfigureOptions<ConfigureCors>();
```

For high-performance, AOT-friendly validation — relevant once you're on Native AOT, from [How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely) — use the source-generated validator instead of the reflection-based `.ValidateDataAnnotations()`: `[OptionsValidator] public partial class PaymentOptionsValidator : IValidateOptions<PaymentOptions> { }`.

## Secrets: the layer system's hardest case {b}

Everything above assumes the values themselves are safe to see. Passwords, API keys, connection strings with embedded credentials, and signing keys are a different category entirely — they must **never** be committed to source control, and that includes `appsettings.Development.json`, which people forget is still a file in the repo.

### In development: User Secrets

```bash
dotnet user-secrets init                                   # adds <UserSecretsId> to the csproj
dotnet user-secrets set "Payments:ApiKey" "sk_test_123"
dotnet user-secrets list
```

These land as plain JSON in your own user profile (`~/.microsoft/usersecrets/<id>/secrets.json`) — physically outside the repo folder entirely — and the provider only loads that file when the environment is `Development`. Be clear-eyed about what this does and doesn't protect against: the file is **not encrypted**. It's not protecting the secret from anyone who gets access to your machine; it's protecting it from ever being `git add`-ed by accident.

### In production: no file on disk at all

| Approach | How | Notes |
|---|---|---|
| **Azure Key Vault** | `builder.Configuration.AddAzureKeyVault(vaultUri, new DefaultAzureCredential())` | Secrets appear as config keys (`Payments--ApiKey` → `Payments:ApiKey`); access via managed identity |
| **App Service / Container Apps settings** | Set in the portal/IaC; become env vars | Can reference Key Vault: `@Microsoft.KeyVault(SecretUri=…)` |
| **Kubernetes Secrets** | Mounted as env vars or files (`AddKeyPerFile`) | Pair with External Secrets / CSI driver for Key Vault |
| **No secret at all** | **Managed identity** for Azure SQL, Storage, Service Bus | Best option: nothing to leak or rotate |

That last row is worth sitting with for a moment, because it's a genuinely different strategy, not just another storage location: if the app authenticates to Azure SQL via **managed identity** instead of a username and password, there is no secret anywhere in this picture to leak, rotate, or accidentally log. See [Identity & secrets](ch:azure-identity-secrets) for exactly how that works.

## Feature flags: configuration that controls *behaviour*, not just values {i}

**Azure App Configuration** extends this same layered model into a centrally managed, shared store — useful once several services need the same settings, with per-environment labels, live change notifications, and specifically, **feature flags**:

```csharp
builder.Configuration.AddAzureAppConfiguration(o => o
    .Connect(new Uri(builder.Configuration["AppConfig:Endpoint"]!), new DefaultAzureCredential())
    .Select(KeyFilter.Any, labelFilter: builder.Environment.EnvironmentName)
    .ConfigureRefresh(r => r.Register("Sentinel", refreshAll: true).SetRefreshInterval(TimeSpan.FromMinutes(1)))
    .UseFeatureFlags());

builder.Services.AddFeatureManagement();      // Microsoft.FeatureManagement

app.MapGet("/checkout", async (IFeatureManager features) =>
    await features.IsEnabledAsync("NewCheckout") ? Results.Ok("v2") : Results.Ok("v1"));
```

The reason this matters more than it first looks is that it separates two things that normally travel together: **deploying** code and **releasing** a feature. Without flags, shipping a risky new checkout flow means the moment the deploy finishes, every single user hits the new code — if it's broken, the only way back is another deploy. With a flag, you ship the new code *dark* (deployed but switched off), turn it on for 5% of traffic, watch error rates, and if something's wrong, flip the switch back off in seconds — no redeploy, no rollback, just a config change.

## How the provider mechanism actually works underneath {a}

Pulling back the curtain on the merge itself: each provider implements `IConfigurationProvider`, loading its source into a flat `Dictionary<string,string?>`. `IConfigurationRoot` queries all the registered providers **in reverse order** — last-added first — and returns the first value it finds for a given key. That single rule, "ask the latest provider first," is the entire precedence mechanism; there's no separate priority system layered on top.

`builder.Configuration` is specifically a `ConfigurationManager`, which means you can add more sources during phase 1 and have later reads immediately see them — unlike a plain `IConfigurationRoot`, which is built once and fixed. Besides the five defaults, other built-in providers worth knowing exist: INI, XML, in-memory (`AddInMemoryCollection`, genuinely useful in tests), key-per-file (how Docker and Kubernetes secrets commonly get mounted), and `AddJsonStream`. Binding (`Bind`, `Get<T>`) uses reflection by default; setting `<EnableConfigurationBindingGenerator>true</EnableConfigurationBindingGenerator>` switches that to a source generator instead, for AOT-friendly binding with no reflection at all.

```csharp
// Tests: override configuration without files
builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Payments:BaseUrl"] = "https://fake",
    ["Payments:ApiKey"] = "test"
});
```

:::qa How does configuration precedence work in ASP.NET Core?
Providers are added in order and later ones override earlier ones for the same key. By default that's appsettings.json, then appsettings.{Environment}.json, then User Secrets (Development), then environment variables, then command-line arguments. Providers added afterwards (Key Vault, App Configuration) override those too.
:::

:::qa What is the Options pattern and why use it?
Binding configuration sections to strongly typed classes registered in DI and consumed as IOptions&lt;T&gt; (or Snapshot/Monitor). It gives type safety, validation (including fail-fast at startup with ValidateOnStart), testability and focused settings per class instead of passing IConfiguration around.
:::

:::qa IOptions vs IOptionsSnapshot vs IOptionsMonitor?
IOptions is a singleton computed once, with no reload. IOptionsSnapshot is scoped and recomputed per request, so it reflects changes but can't be used in singletons. IOptionsMonitor is a singleton whose CurrentValue always reflects the latest config, with an OnChange callback; use it in singletons and background services.
:::

:::qa How do you set a nested configuration value via an environment variable?
Replace each `:` with a double underscore, e.g. `Payments__BaseUrl` for `Payments:BaseUrl`, or `ConnectionStrings__Shop`.
:::

:::qa How do you manage secrets in development vs production?
Development: User Secrets (stored outside the repo, loaded only in Development). Production: Azure Key Vault (or the platform's secret store) loaded via managed identity, or better, avoid secrets entirely by using managed identity to authenticate to Azure services. Never commit secrets to source control.
:::

:::qa How do you make the app fail fast on invalid configuration?
Use `AddOptions<T>().BindConfiguration(...).ValidateDataAnnotations().Validate(...).ValidateOnStart()`, so validation runs during host startup and the app refuses to start (and the deployment fails its health checks) instead of failing on first use.
:::

:::qa What are feature flags and why use them?
Runtime switches (e.g. via Microsoft.FeatureManagement and Azure App Configuration) that enable or disable features without redeploying. They decouple deployment from release, allow gradual rollouts, A/B tests and instant rollback.
:::

## Further reading

- [Configuration in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/)
- [Options pattern](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options)
- [Safe storage of app secrets in development](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets)
- [Azure Key Vault configuration provider](https://learn.microsoft.com/en-us/aspnet/core/security/key-vault-configuration)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, top-level statements, BCL only). This models the real `Microsoft.Extensions.Configuration`/`Options` mechanics with plain dictionaries, since that's the simplest faithful way to check the merge and caching rules without spinning up a host.

```csharp
// Claim: later configuration layers override earlier ones key-by-key, not file-by-file —
// a layer that doesn't mention a key leaves whatever an earlier layer set untouched.
var layer1_appsettingsJson = new Dictionary<string, string?>
{
    ["Payments:BaseUrl"] = "https://sandbox.pay.example",
    ["Payments:TimeoutSeconds"] = "10",
};
var layer2_productionJson = new Dictionary<string, string?>
{
    ["Payments:BaseUrl"] = "https://api.pay.example", // overrides layer 1
};
var layer4_envVars = new Dictionary<string, string?>
{
    ["ConnectionStrings:Shop"] = "Server=prod-sql;...", // never appeared in either JSON file
};

string? Merged(string key, params Dictionary<string, string?>[] layersLowToHigh)
{
    string? value = null;
    foreach (var layer in layersLowToHigh)
        if (layer.TryGetValue(key, out var v)) value = v; // a later layer always wins if it mentions the key
    return value;
}

var baseUrl = Merged("Payments:BaseUrl", layer1_appsettingsJson, layer2_productionJson, layer4_envVars);
var timeout = Merged("Payments:TimeoutSeconds", layer1_appsettingsJson, layer2_productionJson, layer4_envVars);
var connStr = Merged("ConnectionStrings:Shop", layer1_appsettingsJson, layer2_productionJson, layer4_envVars);

if (baseUrl != "https://api.pay.example") throw new Exception($"FAIL: expected the production override to win, got {baseUrl}");
if (timeout != "10") throw new Exception($"FAIL: expected the un-overridden base value 10 to survive, got {timeout}");
if (connStr != "Server=prod-sql;...") throw new Exception("FAIL: expected the connection string to come from the environment-variable layer");
Console.WriteLine("OK: later layers override earlier ones key-by-key — untouched keys pass through unchanged");

// Claim: the environment-variable provider maps "__" to ":" when reading a key back.
string EnvVarNameFor(string configKey) => configKey.Replace(":", "__");
string ConfigKeyFor(string envVarName) => envVarName.Replace("__", ":");
if (EnvVarNameFor("Payments:BaseUrl") != "Payments__BaseUrl") throw new Exception("FAIL: wrong env var name mapping");
if (ConfigKeyFor("Logging__LogLevel__Default") != "Logging:LogLevel:Default") throw new Exception("FAIL: wrong config key mapping");
Console.WriteLine("OK: ':' in a configuration key round-trips to '__' in an environment variable name, and back");

// Claim: IOptions<T>-style caching computes the value once and never reflects a later change,
// while IOptionsMonitor<T>-style access always re-reads the live source.
var liveSettings = new Dictionary<string, string> { ["Feature"] = "off" };

string cachedOnce = liveSettings["Feature"]; // IOptions<T>: computed once, like at first injection
string CurrentValue() => liveSettings["Feature"]; // IOptionsMonitor<T>.CurrentValue: re-reads every time

liveSettings["Feature"] = "on"; // an operator flips a feature flag at runtime

if (cachedOnce != "off") throw new Exception("FAIL: the IOptions<T>-style cached value should stay at its original snapshot");
if (CurrentValue() != "on") throw new Exception("FAIL: the IOptionsMonitor<T>-style accessor should see the live change");
Console.WriteLine("OK: a cached-once value (IOptions<T>) misses a later change; a live accessor (IOptionsMonitor<T>.CurrentValue) sees it");

// Not runtime-verifiable here — these need the real ASP.NET Core host and real Azure services:
//  - the actual Microsoft.Extensions.Configuration provider pipeline and ValidateOnStart() failing a deployment
//  - Azure Key Vault / App Configuration refresh intervals
// See Further reading: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/
```
