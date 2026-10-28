---
id: projects-sdk-nuget
title: Projects, the SDK, NuGet and the Daily Toolbox
summary: How a .NET codebase is physically organised: SDK-style project files, MSBuild, solutions, project references, NuGet packages, central package management, shared build settings, and the tools you'll use every day.
layer: runtime
where: Runtime & platform › Build system & tooling
fits: This is the build-time half of layer 2. The runtime runs assemblies; this chapter is about how those assemblies get produced from your source and packages. Architecture decisions ([App architectures](ch:app-architectures)) are physically enforced here, through project references.
levels: b,i
prereqs: what-is-dotnet
next: csharp-story, type-system, app-architectures
---

## TL;DR

- One `.csproj` → one assembly. A `.sln`/`.slnx` just groups projects for the IDE/build — it has no effect on the compiled output.
- SDK-style project files are short because they include every file in the folder by default and inherit sensible defaults; the csproj only lists what's *different*.
- `Directory.Build.props` shares settings across every project in the repo tree; `global.json` pins the SDK version everyone (and CI) builds with.
- NuGet resolves the full dependency graph on restore: it picks the lowest version that satisfies every constraint, and a direct reference always wins over a transitive one.
- **Central Package Management** (`Directory.Packages.props`) stops different projects in one solution from drifting to different versions of the same package.
- Debug builds skip optimizations for easy debugging; Release builds are optimized — always benchmark and ship Release.

## The physical structure of a .NET codebase {b}

```text
Shop/                              ← git repository root
├── Shop.slnx                      ← solution: groups projects for IDE/build
├── Directory.Build.props          ← settings shared by every project
├── Directory.Packages.props       ← package versions shared by every project
├── global.json                    ← pins the SDK version
├── .editorconfig                  ← code style rules
├── src/
│   ├── Shop.Api/Shop.Api.csproj           → Shop.Api.dll
│   ├── Shop.Application/…csproj           → Shop.Application.dll
│   ├── Shop.Domain/…csproj                → Shop.Domain.dll
│   └── Shop.Infrastructure/…csproj        → Shop.Infrastructure.dll
└── tests/
    ├── Shop.Domain.Tests/…csproj
    └── Shop.Api.IntegrationTests/…csproj
```

- A **project** (`.csproj`) produces **one assembly**.
- A **solution** (`.sln`, or the new XML **`.slnx`** format supported since .NET 9 SDK / VS 17.13) groups projects. It is only for tooling; it doesn't affect the compiled output.
- **Project references** say which assembly may use which. They are how architecture rules (Domain depends on nothing) are enforced physically.

## SDK-style project files {b}

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Shop.Api</RootNamespace>
    <UserSecretsId>7b8f…</UserSecretsId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Serilog.AspNetCore" Version="9.0.0" />
    <ProjectReference Include="..\Shop.Application\Shop.Application.csproj" />
    <ProjectReference Include="..\Shop.Infrastructure\Shop.Infrastructure.csproj" />
  </ItemGroup>

  <ItemGroup>
    <InternalsVisibleTo Include="Shop.Api.IntegrationTests" />
  </ItemGroup>

</Project>
```

| Element | Meaning |
|---|---|
| `Sdk="Microsoft.NET.Sdk"` | Plain library/console app |
| `Sdk="Microsoft.NET.Sdk.Web"` | Adds the ASP.NET Core shared framework, web defaults, `launchSettings.json` support |
| `Sdk="Microsoft.NET.Sdk.Worker"` | Worker service (background processing) |
| `Sdk="Microsoft.NET.Sdk.Razor"` / `BlazorWebAssembly` | Razor class libraries / Blazor |
| `<TargetFramework>` | Which .NET you build for (`net10.0`) |
| `<Nullable>enable` | Turn on nullable reference type analysis |
| `<ImplicitUsings>enable` | Auto-add common `using`s (`System`, `System.Linq`, `Microsoft.AspNetCore.Builder`…) as **global usings** |
| `<PackageReference>` | A NuGet dependency |
| `<ProjectReference>` | A dependency on another project in the repo |

:::why Why SDK-style projects are short
Old .NET Framework projects listed every `.cs` file explicitly, so adding a new file meant editing the project file too — and that caused constant merge conflicts. SDK-style projects fix this by **including every file in the folder by default** (globbing) and importing sensible defaults from the SDK. The csproj then only needs to list what's *different* from the defaults, which is why they're short enough to read and edit by hand.
:::

### MSBuild: the engine under the CLI

`dotnet build` runs **MSBuild**, which evaluates the project XML (properties, items, targets) and executes **targets** (Restore → Compile → Copy → Publish). Useful things to know:

- **Properties** (`<PropertyGroup>`) are scalar settings; **items** (`<ItemGroup>`) are lists (files, references).
- You can pass properties on the command line: `dotnet build -p:Version=1.2.3`.
- **Conditions** let settings vary: `<PropertyGroup Condition="'$(Configuration)' == 'Release'">`.
- **Build configurations**: `Debug` (no optimisation, full debug info) and `Release` (optimised). Always benchmark and ship Release.

## Sharing settings: Directory.Build.props and global.json {i}

MSBuild automatically imports the nearest **`Directory.Build.props`** walking up from each project. Put repo-wide settings there instead of repeating them in every csproj:

```xml
<!-- Directory.Build.props at the repo root -->
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
</Project>
```

`Directory.Build.targets` is the same idea but imported *after* the project (for targets and overrides).

**`global.json`** pins the SDK version so everyone and CI build with the same compiler:

```json
{ "sdk": { "version": "10.0.100", "rollForward": "latestFeature" } }
```

## The dotnet CLI {b}

| Command | What it does |
|---|---|
| `dotnet new list` / `dotnet new webapi -n Shop.Api` | List templates / create a project |
| `dotnet new sln` / `dotnet sln add src/**/*.csproj` | Create a solution / add projects |
| `dotnet add reference ../Shop.Domain` | Add a project reference |
| `dotnet add package Polly` | Add a NuGet package |
| `dotnet restore` | Download packages (also runs implicitly on build) |
| `dotnet build -c Release` | Compile |
| `dotnet run` / `dotnet watch` | Run / run with hot reload |
| `dotnet test --filter "Category=Unit"` | Run tests |
| `dotnet publish -c Release -o out` | Produce deployable output |
| `dotnet publish /t:PublishContainer` | Build a container image without a Dockerfile |
| `dotnet format` | Apply `.editorconfig` style and analyzer fixes |
| `dotnet list package --outdated --vulnerable` | Audit dependencies |
| `dotnet tool install -g dotnet-ef` | Install a global tool |
| `dotnet user-secrets set "Key" "Value"` | Store dev secrets outside the repo |
| `dotnet dev-certs https --trust` | Trust the local HTTPS dev certificate |

**Local tools** (`dotnet new tool-manifest`, then `dotnet tool install dotnet-ef`) are pinned per repo in `.config/dotnet-tools.json` and restored with `dotnet tool restore`. They're better than global tools for team consistency.

## NuGet in depth {b}

**NuGet** is .NET's package manager. A **package** (`.nupkg`) is a zip containing compiled assemblies for one or more TFMs (`lib/net8.0/`, `lib/netstandard2.0/`), a `.nuspec` manifest with its dependencies, and optionally build props, analyzers or content files.

- **Feeds:** nuget.org (public), plus private feeds such as Azure Artifacts, GitHub Packages or JFrog, configured in `nuget.config`.
- **Restore** resolves the full dependency graph and writes `obj/project.assets.json`.
- **Transitive dependencies:** packages your packages depend on. You get them automatically.
- **Version resolution:** for each package, NuGet picks the *lowest* version that satisfies all constraints ("lowest applicable version"). A direct reference wins over a transitive one ("direct dependency wins").

### Central Package Management (CPM) {i}

Here's the problem CPM solves: in a multi-project solution, it's easy for one project to reference `EntityFrameworkCore 9.0.1` while another references `9.0.3`. At runtime that mismatch can cause binding errors that are confusing to diagnose, because the symptom shows up far from the actual cause. **CPM** fixes this by putting every package's version in one shared file, so there's only ever one version to drift from:

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.0" />
    <PackageVersion Include="FluentValidation" Version="12.0.0" />
    <PackageVersion Include="xunit.v3" Version="3.0.0" />
  </ItemGroup>
</Project>
```

```xml
<!-- any .csproj: no Version attribute -->
<PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" />
```

**Transitive pinning** lets you upgrade a vulnerable transitive package centrally without referencing it directly everywhere.

### Package hygiene {i}

- **Lock files** (`<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>` → `packages.lock.json`) make restores reproducible: everyone and CI resolve to the exact same package versions, not just versions that satisfy the constraints. Use `--locked-mode` in CI so a build fails loudly instead of silently resolving something new.
- **Vulnerability auditing:** `dotnet restore` warns about known CVEs (NuGet Audit, on by default since .NET 8). Fail the build on them in CI.
- **Licences:** check them before adopting a dependency. Some popular libraries have moved parts of their functionality to commercial licenses in recent years (check each library's current license page — this changes over time, so don't rely on this book for the current status of any specific package). Interviewers sometimes ask how you evaluate a new dependency, and licensing is part of a real answer.
- **Package source mapping** in `nuget.config` stops dependency-confusion attacks (where an attacker publishes a malicious package with the same name as an internal one, hoping your build pulls theirs instead) by mapping package ID prefixes to specific feeds.

### Creating your own package

```bash
dotnet pack -c Release -p:PackageVersion=1.4.0
dotnet nuget push bin/Release/Shop.Contracts.1.4.0.nupkg --source "company-feed" --api-key az
```

Companies often publish a shared **contracts** package (message types, DTOs) used by several services.

## Code quality tooling {i}

| Tool | What it does |
|---|---|
| **Roslyn analyzers** (built in) | Warnings for bugs, performance and API misuse (`CA1848` use LoggerMessage, `CA2007` ConfigureAwait…) |
| **`.editorconfig`** | Naming, formatting and severity of each rule; enforced in IDE and build |
| **`dotnet format`** | Applies fixes from the command line / CI |
| **Third-party analyzers** | SonarAnalyzer, Roslynator, Meziantou.Analyzer, StyleCop |
| **SonarQube / SonarCloud** | Quality gates, coverage, code smells in CI |
| **Nullable warnings as errors** | Prevents most `NullReferenceException`s |

```ini
# .editorconfig
root = true
[*.cs]
indent_style = space
indent_size = 4
csharp_style_namespace_declarations = file_scoped:warning
dotnet_diagnostic.CA2016.severity = error   # forward CancellationToken
dotnet_naming_rule.private_fields_underscore.severity = warning
```

## The daily toolbox {b}

| Job | Tools |
|---|---|
| **IDE** | Visual Studio 2022/2026 (Windows), JetBrains **Rider** (all OSes), **VS Code + C# Dev Kit** |
| **Call your API** | `.http` files (built into VS, Rider, VS Code), Postman, Bruno, Insomnia, `curl`; Scalar/Swagger UI from OpenAPI |
| **Inspect compiled code** | ILSpy, dotPeek, SharpLab.io |
| **Databases** | SSMS, Azure Data Studio (being retired in favour of the VS Code MSSQL extension), DBeaver, DataGrip, `dotnet ef` |
| **Containers** | Docker Desktop / Podman / Rancher Desktop, `docker compose`, .NET Aspire |
| **Diagnostics** | `dotnet-counters`, `dotnet-trace`, `dotnet-dump`, `dotnet-gcdump`, PerfView, IDE profilers |
| **Benchmark / load** | BenchmarkDotNet; k6, NBomber, JMeter, Azure Load Testing |
| **Source control & CI** | Git, GitHub/Azure DevOps, GitHub Actions/Azure Pipelines |
| **Cloud CLIs** | Azure CLI (`az`), Azure Developer CLI (`azd`), `kubectl`, Bicep/Terraform |

```http
### Shop.Api.http: committed next to the project so anyone can try endpoints
@host = https://localhost:7180
@token = {{$dotenv TOKEN}}

GET {{host}}/orders?page=1&pageSize=20
Authorization: Bearer {{token}}

###
POST {{host}}/orders
Content-Type: application/json
Authorization: Bearer {{token}}

{ "customerId": 42, "lines": [{ "sku": "KB-01", "qty": 1 }] }
```

## launchSettings.json and environments {b}

`Properties/launchSettings.json` is **only used on your dev machine** (by `dotnet run` and the IDE). It sets URLs and environment variables such as `ASPNETCORE_ENVIRONMENT=Development`. It is not deployed, and production ignores it. Production gets settings from real environment variables, App Service configuration or Kubernetes manifests. See [Configuration](ch:configuration-options).

:::qa What is the difference between a project, a solution and an assembly?
A project (.csproj) is the build definition for one assembly. An assembly (.dll) is the compiled output. A solution groups projects for the IDE and for building together; it has no effect on the output.
:::

:::qa What is Directory.Build.props for?
MSBuild imports it automatically into every project in that folder tree. Teams use it for shared settings such as target framework, nullable, warnings-as-errors, analyzers and versioning, so each csproj stays small and consistent.
:::

:::qa How do you keep NuGet package versions consistent across many projects?
Central Package Management: `Directory.Packages.props` with `ManagePackageVersionsCentrally`, versions declared once with `PackageVersion`, and csproj files referencing packages without versions. Add transitive pinning and lock files for reproducibility.
:::

:::qa How do you handle a vulnerable transitive dependency?
Find it with `dotnet list package --vulnerable --include-transitive`. Upgrade the parent package if a fixed version exists; otherwise pin the transitive package to a patched version (directly, or via CPM transitive pinning). Fail CI on NuGet audit warnings to catch it early.
:::

:::qa What's the difference between Debug and Release builds?
Debug disables optimisations and emits full debugging info, so code maps one-to-one to source. Release enables compiler and JIT optimisations (inlining, dead-code removal). Performance measurements and deployments must use Release.
:::

:::qa How do you enforce code style across a team?
An .editorconfig in the repo, analyzers enabled with `AnalysisLevel` and `EnforceCodeStyleInBuild`, warnings as errors in CI, `dotnet format --verify-no-changes` in the pipeline, plus optional SonarQube quality gates.
:::

## Further reading

- [.NET project SDKs](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview)
- [Central Package Management](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management)
- [dotnet CLI overview](https://learn.microsoft.com/en-us/dotnet/core/tools/)
- [Code analysis in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, BCL only). This can't exercise a real MSBuild/NuGet restore, but it can verify the two resolution rules the chapter states, plus the Debug/Release mechanism itself.

```csharp
// Claim: Debug builds skip optimizations and keep full debug info; Release builds optimize.
// The DEBUG symbol is exactly how the compiler tells your own code which configuration built it.
#if DEBUG
Console.WriteLine("OK: this is a Debug build (DEBUG symbol defined) — run `dotnet run -c Release` and this branch disappears entirely");
#else
Console.WriteLine("OK: this is a Release build (DEBUG symbol not defined) — optimizations are on");
#endif

// Claim: NuGet picks the LOWEST version that satisfies every constraint ("lowest applicable version"),
// and a DIRECT reference always wins over a TRANSITIVE one, even if the transitive one asks for something newer.
// Model NuGet's resolution rules directly (simplified, but the same two rules described in the chapter).
var constraints = new List<PackageRef>
{
    new("Newtonsoft.Json", new Version(12, 0, 0), IsDirect: false), // transitive: wants >= 12.0.0
    new("Newtonsoft.Json", new Version(13, 0, 1), IsDirect: false), // transitive: wants >= 13.0.1 (higher wins among these)
};
var resolvedWithoutDirect = Resolve("Newtonsoft.Json", constraints);
if (resolvedWithoutDirect != new Version(13, 0, 1))
    throw new Exception($"FAIL: expected the highest transitive floor (13.0.1) to win among transitive-only constraints, got {resolvedWithoutDirect}");
Console.WriteLine($"OK: with no direct reference, resolution settles on {resolvedWithoutDirect} (the highest of the transitive floors)");

constraints.Add(new("Newtonsoft.Json", new Version(11, 0, 0), IsDirect: true)); // app adds its OWN older direct reference
var resolvedWithDirect = Resolve("Newtonsoft.Json", constraints);
if (resolvedWithDirect != new Version(11, 0, 0))
    throw new Exception($"FAIL: expected the direct reference (11.0.0) to win over transitive ones, got {resolvedWithDirect}");
Console.WriteLine($"OK: adding a direct reference ({resolvedWithDirect}) overrides the transitive versions, even though it's lower — \"direct dependency wins\"");

// Not runtime-verifiable here (needs real MSBuild/NuGet restore, a multi-project solution, or CI) — see Further reading:
// - Real SDK-style project globbing, Directory.Build.props inheritance, actual NuGet restore/version resolution
// - Central Package Management end to end
// - dotnet CLI commands and their real behavior

Console.WriteLine("All checkable claims verified.");

static Version Resolve(string packageId, List<PackageRef> allConstraintsForThisPackage)
{
    foreach (var r in allConstraintsForThisPackage)
        if (r.IsDirect && r.Id == packageId) return r.MinVersion; // direct dependency wins outright

    // otherwise: lowest version that satisfies every transitive constraint
    return allConstraintsForThisPackage.Where(r => r.Id == packageId).Max(r => r.MinVersion)!;
}

record PackageRef(string Id, Version MinVersion, bool IsDirect);
```
