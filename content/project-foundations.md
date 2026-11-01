---
id: project-foundations
title: "Starting a Project Right: The First Two Weeks"
summary: "What to set up before the first feature, so a codebase stays healthy as it and the team grow. Covers the repository layout, Directory.Build.props, central package management and lock files, analyzers, .editorconfig and warnings as errors (with the gotchas that make style rules silently not run), nullable from day one, a walking skeleton that deploys on day one, CI as the definition of done, branching and commit conventions, local development in one command, README and decision records, and choosing the architecture you can afford. Every file shown was built and tested."
layer: arch
where: Building real projects › Foundations
fits: "Puts [Projects & packages](ch:projects-sdk-nuget), [Testing](ch:testing-story), [CI/CD](ch:cicd-iac) and [Architecture](ch:app-architectures) to work on day one of a real project. The next chapters deliver features on this foundation and run it in production."
levels: b,i,a
prereqs: projects-story
next: delivering-work
---

## The 30-second version

- **The first two weeks decide the next two years.** Conventions set now are cheap; retrofitting them into 200,000 lines is a project of its own.
- **Put shared settings in one place**: `Directory.Build.props` for build settings, `Directory.Packages.props` for package versions, `.editorconfig` for style, `global.json` for the SDK.
- **Make the build the referee**: warnings as errors, analyzers on, style enforced in the build, nullable enabled. Arguments in code review become compiler errors.
- **Ship a walking skeleton first**: the thinnest possible slice that goes through CI, deploys, and answers a health check in a real environment, before any real feature.
- **One command each** to build, test, run locally and deploy. If setup takes a day, it's a bug.
- **Write decisions down** in short decision records, so the next person knows *why*.

## Previously at Kettle {b}

Kettle is doing well enough that cafés and offices want to buy tea in bulk. The founders approve **Kettle Wholesale**: a separate product for trade customers with quotes, credit accounts and scheduled deliveries. A new team of five will build it, with a staff engineer, you, setting it up.

**The problem:** the original Kettle codebase grew without a plan. Builds have hundreds of warnings nobody reads, every project pins its own package versions, and setting up a new laptop takes two days. Nobody wants to repeat that.

**This episode:** everything to put in place before the first feature, and why each piece pays off.

## Start from zero: what "setting up a project" means {b}

:::plain
Before writing features, you decide where code lives, which rules every file follows, how it's built and tested, and how it gets to production. Doing this first is cheap; doing it later is a migration.
:::

| Decide now | Because later it costs |
|---|---|
| Folder and project layout | moving files breaks history, namespaces and every open branch |
| Shared build settings | editing 30 project files, and inconsistencies nobody notices |
| Warnings as errors, nullable | fixing thousands of existing warnings before you can switch them on |
| Code style enforced by the build | endless review comments, then a giant reformatting commit |
| CI and a deploy pipeline | each manual release is a risk, and tests nobody runs rot |
| How decisions are recorded | the reasons are lost when people leave |

None of these is hard. All of them get harder every week you wait, because more code depends on the old way.

## The repository layout {b}

```text
kettle-wholesale/
├─ .github/workflows/ci.yml        ← CI: the definition of "it works"
├─ docs/
│  ├─ adr/                         ← decision records (0001-use-postgres.md, ...)
│  └─ runbooks/                    ← what to do when an alert fires
├─ src/
│  ├─ Wholesale.Api/               ← the deployable web app: endpoints, composition root
│  └─ Wholesale.Core/              ← domain and application logic: no web, no database
├─ tests/
│  ├─ Wholesale.Core.Tests/        ← fast unit tests
│  └─ Wholesale.Api.Tests/         ← integration tests through HTTP
├─ .editorconfig                   ← style rules, enforced by the build
├─ Directory.Build.props           ← build settings for every project
├─ Directory.Packages.props        ← every package version, once
├─ global.json                     ← which SDK builds this repository
├─ Kettle.Wholesale.sln
└─ README.md                       ← how to build, test and run, in five minutes
```

Principles behind it:

- **`src/` and `tests/` mirror each other.** Each production project has a test project with the same name plus `.Tests`, so anyone can find the tests.
- **Start with few projects.** Two or three is enough at the start. Each project boundary is a decision that's annoying to undo, and a project per layer ("Domain", "Application", "Infrastructure", "Contracts", "Shared"...) on day one adds ceremony before you know where the real boundaries are. Split when a boundary proves itself ([Architectures](ch:app-architectures)).
- **The deployable app is the composition root**: it wires everything together. Business logic lives in a project that doesn't reference ASP.NET Core or EF Core, so it can be tested and reused without them.
- **Docs live in the repository**, next to the code they describe, and change in the same pull requests.

## One place for build settings: Directory.Build.props {b}

:::plain
MSBuild automatically reads a file called `Directory.Build.props` in any parent folder of a project. Put shared settings there once, and every project gets them.
:::

```xml
<Project>
  <!-- Applies to every project under this folder. Projects only say what is unique to them. -->
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>

    <!-- Quality gates: a warning fails the build, so warnings never pile up -->
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <!-- Needed for IDE0005 (unused usings) to run in the build; CS1591 would demand XML docs on everything -->
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);CS1591</NoWarn>

    <!-- Reproducible builds: the same commit produces the same binaries -->
    <Deterministic>true</Deterministic>
    <ContinuousIntegrationBuild Condition="'$(CI)' == 'true'">true</ContinuousIntegrationBuild>

    <!-- Lock files: restore fails if a dependency changes without a commit -->
    <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
    <RestoreLockedMode Condition="'$(CI)' == 'true'">true</RestoreLockedMode>
  </PropertyGroup>
</Project>
```

With that in place, a project file shrinks to only what's different about it:

```xml
<!-- src/Wholesale.Api/Wholesale.Api.csproj : the whole file -->
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="..\Wholesale.Core\Wholesale.Core.csproj" />
    <InternalsVisibleTo Include="Wholesale.Api.Tests" />
  </ItemGroup>
</Project>
```

What each group buys you:

- **`TreatWarningsAsErrors`**: the single most effective setting in a new codebase. A warning that's allowed to stay is a warning nobody reads, and once there are 300 of them the important one is invisible. On a new project the count starts at zero and stays there.
- **`AnalysisLevel` `latest-recommended`**: turns on the .NET analyzers' recommended rules (correctness, performance, security, API misuse). Upgrading the SDK can add new rules; fix them as part of the upgrade.
- **`EnforceCodeStyleInBuild`**: runs the IDE's code-style rules during `dotnet build`, so CI enforces them, not just the editor. See the gotchas below.
- **Lock files** (`packages.lock.json`): record the exact version of every package, including transitive ones. In CI, **locked mode** fails the restore if anything would change, so a build is reproducible and nobody's dependency silently shifts.
- **`ContinuousIntegrationBuild`**: normalises file paths in the build output so builds on different machines produce identical binaries, which matters for debugging symbols and supply-chain verification.

## One place for package versions: central package management {b}

:::plain
Instead of every project choosing its own version of each package, list every version once in `Directory.Packages.props`. Projects then name the package without a version.
:::

```xml
<!-- Directory.Packages.props -->
<Project>
  <!-- Central Package Management: every version in one place, so projects can't drift apart -->
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="8.0.11" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageVersion Include="xunit" Version="2.9.2" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>
</Project>
```

```xml
<!-- tests/Wholesale.Api.Tests/Wholesale.Api.Tests.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" PrivateAssets="all" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\Wholesale.Api\Wholesale.Api.csproj" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
</Project>
```

- **No version drift**: two projects can't end up on different versions of the same library, the cause of many "works in one service, breaks in the other" bugs.
- **Upgrades are one-line diffs**, which makes Dependabot or Renovate pull requests easy to review.
- **A version in a project file is now a build error** (`NU1008`), so the rule enforces itself. Note: `dotnet new` templates put versions in the project file, so new projects fail to restore until you remove them. That's the rule working.
- A rare exception (one project genuinely needs a different version) uses `VersionOverride` on that reference, which makes the exception visible in review.

## Style the build enforces: .editorconfig {i}

:::plain
`.editorconfig` holds the team's formatting and naming rules. Editors follow it as you type, and with the right settings, the build fails when code breaks them.
:::

```ini
root = true

[*]
indent_style = space
insert_final_newline = true
charset = utf-8

[*.{cs,csx}]
indent_size = 4
# Style preferences, and how strictly the build enforces each (IDE rules need an explicit severity)
csharp_style_namespace_declarations = file_scoped
dotnet_diagnostic.IDE0161.severity = warning     # file-scoped namespaces
csharp_prefer_braces = when_multiline
dotnet_diagnostic.IDE0011.severity = warning     # braces on multi-line if/else
dotnet_style_readonly_field = true
dotnet_diagnostic.IDE0044.severity = warning     # fields never reassigned are readonly
dotnet_diagnostic.IDE0005.severity = warning     # unnecessary using directives
# Constants are PascalCase
dotnet_naming_rule.constants.symbols = constants
dotnet_naming_rule.constants.style = pascal
dotnet_naming_rule.constants.severity = warning
dotnet_naming_symbols.constants.applicable_kinds = field
dotnet_naming_symbols.constants.required_modifiers = const
dotnet_naming_style.pascal.capitalization = pascal_case
# Private fields are _camelCase
dotnet_naming_rule.private_fields.symbols = private_fields
dotnet_naming_rule.private_fields.style = underscore_camel
dotnet_naming_rule.private_fields.severity = warning
dotnet_diagnostic.IDE1006.severity = warning     # naming rules
dotnet_naming_symbols.private_fields.applicable_kinds = field
dotnet_naming_symbols.private_fields.applicable_accessibilities = private
dotnet_naming_style.underscore_camel.capitalization = camel_case
dotnet_naming_style.underscore_camel.required_prefix = _

[*.{csproj,props,targets,json,yml,yaml}]
indent_size = 2

# Tests read better as sentences with underscores
[tests/**.cs]
dotnet_diagnostic.CA1707.severity = none
```

:::gotcha Four ways style rules silently don't run in the build
These came up for real while building this chapter's skeleton:
1. **The `:warning` suffix is editor-only.** `csharp_style_namespace_declarations = file_scoped:warning` shows a squiggle in the IDE, but the build ignores it. Each rule needs its own `dotnet_diagnostic.IDExxxx.severity = warning` line for `dotnet build` and CI to enforce it.
2. **`EnforceCodeStyleInBuild` must be on**, or no IDE rule runs during the build at all, whatever the severity.
3. **IDE0005 (unused usings) needs `GenerateDocumentationFile`**, or the build fails with `EnableGenerateDocumentationFile`. Turning that on makes CS1591 demand XML comments on every public member, so suppress CS1591 unless you're shipping a library.
4. **Naming rules match more than you expect.** A rule for private fields also matches private **constants**, so `private const int BulkThresholdKg` fails with "missing prefix `_`". Add a more specific rule for constants.

Test the gates on purpose: add a file that breaks each rule and confirm the build fails. A gate you haven't seen fail is a gate you don't know works.
:::

`dotnet format` applies these rules to the whole codebase, and `dotnet format --verify-no-changes` in CI fails if anything isn't formatted. Run it once at setup so the codebase starts clean.

## Nullable from day one {b}

`<Nullable>enable</Nullable>` makes the compiler track which references might be null and warn when you use one without checking ([Nullable reference types](ch:modern-csharp#nullable-reference-types-the-compiler-tracks-maybe-null)). With warnings as errors, those warnings fail the build.

- **On a new project it's nearly free**: you write the `?` as you go.
- **On an existing project it's a migration**: thousands of warnings, enabled file by file with `#nullable enable`. Every week you delay makes it bigger.
- **Don't silence it with `!`** (the null-forgiving operator) to make errors go away. Each `!` is a claim "this is never null" that the compiler can no longer check. Search for them in code review.

## The walking skeleton {b}

:::plain
A walking skeleton is the thinnest possible version of the whole system that runs end to end in production: one endpoint, one test of each kind, built by CI, deployed, and answering a health check. Features come after.
:::

Kettle Wholesale's skeleton, on day three:

```csharp norun
// src/Wholesale.Api/Program.cs
using Wholesale.Core.Quotes;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();
app.MapHealthChecks("/health/live");
app.MapHealthChecks("/health/ready");

app.MapGet("/api/quotes/{sku}", (string sku, int kg) =>
    kg <= 0
        ? Results.ValidationProblem(new Dictionary<string, string[]> { ["kg"] = ["Must be at least 1."] })
        : Results.Ok(QuoteCalculator.For(sku, kg, listPricePerKg: 20.00m)));

app.Run();

// Lets the integration tests start the app in memory with WebApplicationFactory<Program>.
public partial class Program;
```

```csharp norun
// tests/Wholesale.Api.Tests/QuoteEndpointTests.cs
public class QuoteEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Quote_for_bulk_order_applies_discount()
    {
        var quote = await _client.GetFromJsonAsync<Quote>(new Uri("/api/quotes/ASSAM-1?kg=100", UriKind.Relative));

        Assert.NotNull(quote);
        Assert.Equal(1800.00m, quote.Total);
    }

    [Fact]
    public async Task Invalid_quantity_returns_problem_details()
    {
        var response = await _client.GetAsync(new Uri("/api/quotes/ASSAM-1?kg=0", UriKind.Relative));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
```

Why a skeleton before features:

- **It flushes out the hard, boring problems first**: networking, certificates, secrets, the database connection from the cloud, the pipeline's permissions. These are what delay launches, and they're the same whether the app has one endpoint or fifty.
- **Every later feature is a small change to a working system**, not a big-bang integration at the end.
- **The deploy path gets exercised dozens of times** before launch day, so launch day is just another deploy.
- It forces the early architectural decisions (hosting, database, auth) while they're still cheap to change.

The skeleton is done when: a commit to `main` builds, tests and deploys to a real environment automatically; the health checks answer; logs and a trace from a request show up in the observability tool; and a rollback has been tried once.

## CI is the definition of "it works" {i}

:::plain
The CI pipeline runs on every pull request and decides whether a change can be merged. If it's green, the change builds, is formatted, passes its tests and has no known-vulnerable dependencies.
:::

```yaml
# .github/workflows/ci.yml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      CI: true
      DOTNET_NOLOGO: true
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json
          cache: true
          cache-dependency-path: "**/packages.lock.json"

      - name: Restore (locked)
        run: dotnet restore

      - name: Check formatting
        run: dotnet format --verify-no-changes --no-restore

      - name: Build (warnings are errors)
        run: dotnet build --no-restore -c Release

      - name: Test
        run: dotnet test --no-build -c Release --logger trx --results-directory TestResults

      - name: Fail on vulnerable packages
        run: |
          dotnet list package --vulnerable --include-transitive | tee vulnerable.txt
          ! grep -q "has the following vulnerable packages" vulnerable.txt

      - name: Publish
        run: dotnet publish src/Wholesale.Api --no-build -c Release -o out/api

      - uses: actions/upload-artifact@v4
        with:
          name: api-${{ github.sha }}
          path: out/api
```

Design choices worth defending in a review:

- **`CI: true`** switches on locked restore and deterministic builds from `Directory.Build.props`, so CI is stricter than a laptop.
- **`permissions: contents: read`**: the workflow token can't push or change settings unless a job explicitly needs to. Least privilege applies to pipelines too ([Security](ch:web-security)).
- **`concurrency` with `cancel-in-progress`**: a new push cancels the outdated run, saving time and money.
- **`timeout-minutes`**: a hung test fails in 15 minutes instead of burning six hours of runner time.
- **Build once, publish the artifact**: the deploy job (not shown) deploys exactly this artifact to staging and production ([CI/CD](ch:cicd-iac)).
- **`dotnet list package --vulnerable` doesn't fail by itself**: it exits 0 even when it finds something, so the step checks its output.
- **Keep CI fast.** Under 10 minutes for a pull request keeps people from batching changes or skipping it. Parallelise test projects, cache packages, and move slow end-to-end suites to a separate job that runs after merge.

**Branch protection** makes it binding: `main` accepts changes only through pull requests with a green CI run and at least one approval, and nobody (admins included) can push directly.

## Branching, commits and pull requests {i}

- **Trunk-based development**: everyone merges small changes into `main` at least daily, behind feature flags where a feature isn't ready ([Delivering work](ch:delivering-work#trunk-based-development-and-feature-flags)). Long-lived feature branches are where merge conflicts and integration surprises come from.
- **Small pull requests.** Under about 400 changed lines gets a real review; 2,000 lines gets "LGTM". Split by layer or by step: refactor first (no behaviour change), then the feature.
- **Commit messages explain why.** The diff shows *what* changed. A convention such as Conventional Commits (`feat:`, `fix:`, `refactor:`) makes history scannable and lets tools generate changelogs and version numbers.
- **A pull request template** with three prompts: what and why, how it was tested, and what the risk and rollback are. It makes authors think about the last two.
- **CODEOWNERS** routes reviews for sensitive areas (auth, payments, migrations) to the people who know them.

## Local development in one command {i}

A new team member should go from clone to a running app with a passing test suite in under 30 minutes, following only the README.

- **Dependencies in containers**: `docker compose up -d` (or .NET Aspire's AppHost) starts Postgres, Redis and a message broker with the right versions and seed data ([Observability & Aspire](ch:observability-aspire), [Docker](ch:docker)).
- **Secrets for local work** in user secrets, never in `appsettings.Development.json`; and a script or README section that sets them.
- **Integration tests use real dependencies in containers** (Testcontainers), not an in-memory database that behaves differently ([Integration testing](ch:integration-testing)).
- **Dev containers** (a `.devcontainer` folder) are worth it for complex toolchains: the whole environment is described in the repository and opens in VS Code or Codespaces identically for everyone.
- **One script per job**, kept in the repository and used by CI too: `build`, `test`, `run`, `db-reset`. When the README and CI use the same commands, the README can't go stale silently.

## Decision records {i}

:::plain
A decision record is a short document saying what was decided, why, and what else was considered. Months later it answers "why on earth did we do it this way?"
:::

```text
docs/adr/0003-postgres-for-wholesale.md

# 3. Use PostgreSQL for Kettle Wholesale

Status: Accepted (2026-03-04)

## Context
Wholesale needs transactions across orders, credit limits and invoices, ad-hoc reporting
for the finance team, and must run on Azure and on a single VM for the pilot.

## Decision
PostgreSQL 16, via EF Core with Npgsql. Azure Database for PostgreSQL Flexible Server in production.

## Alternatives considered
- Azure SQL: equally capable; rejected because the team's operational experience is with Postgres
  and the pilot runs outside Azure.
- Cosmos DB: no multi-document transactions across our aggregates without redesign; reporting is harder.

## Consequences
- We rely on Postgres-specific features (jsonb, partial indexes); switching later is costly.
- The ops runbook covers Postgres backups and point-in-time restore.
```

- **Short**: one page. If it takes a day to write, nobody will write the next one.
- **Immutable once accepted**: a later change of mind is a new record that *supersedes* the old one, so the history of reasoning is kept.
- **For decisions that are expensive to reverse**: the database, the architecture style, the auth provider, the hosting platform, a major library. Not for every class name.
- In the repository, reviewed as pull requests, so the discussion is attached.

## Choosing the architecture you can afford {a}

A staff engineer's job on day one is to choose the **simplest architecture that meets the known requirements, with room to evolve**, and to say explicitly what would trigger the next step.

- **Start as a modular monolith**: one deployable, with clear module boundaries inside (separate folders or projects per business area, each owning its data, talking through defined interfaces). It deploys simply, refactors easily, and can be split later along boundaries that have proved real ([Microservices](ch:microservices), [Service boundaries](ch:ms-boundaries)).
- **Write down the triggers** for changing it: "split the pricing module out if it needs to scale independently or a second team owns it." Then the decision isn't re-argued every month.
- **Choose boring technology** where you can. Each novel tool spends from a small budget of team attention. Spend it where it gives you an advantage, not on the database or the logging library.
- **Make the reversible decisions quickly and the irreversible ones carefully.** Library choices inside a module are cheap to change; the data model, public API contracts and the identity provider are not.
- **Design for the team you have**, not the team at a company ten times bigger. Five people can't run twelve microservices well.

## The foundations checklist {b}

- [ ] Repository layout with `src/`, `tests/`, `docs/`; README with build, test, run in five minutes
- [ ] `global.json`, `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig`
- [ ] Warnings as errors, analyzers on, style enforced in the build, nullable on; each gate seen failing once
- [ ] Lock files, locked restore in CI, vulnerable-package check
- [ ] CI on every pull request; branch protection on `main`; CODEOWNERS; PR template
- [ ] Walking skeleton deployed to a real environment by the pipeline, with health checks, logs and traces
- [ ] Local dependencies in one command; tests run against real dependencies
- [ ] First decision records written: architecture, database, hosting, auth

## Interview questions {i}

:::qa You're starting a new .NET service with a team of five. What do you set up before the first feature?
A repository layout with src and tests; shared build settings in Directory.Build.props with nullable, analyzers, enforced code style and warnings as errors; central package management with lock files; CI on every pull request with branch protection; a walking skeleton that deploys through the pipeline to a real environment with health checks and observability; one-command local setup; and decision records for the expensive choices. Each is cheap at the start and expensive to retrofit.
:::

:::qa Why treat warnings as errors?
Because tolerated warnings accumulate until nobody reads them and real problems hide among hundreds of irrelevant ones. On a new codebase the count starts at zero and the build keeps it there. On an existing one, enable it gradually: per project, or for specific warning codes, fixing as you go.
:::

:::qa What is a walking skeleton, and why build one first?
The thinnest end-to-end slice of the system, built, tested and deployed through the real pipeline to a real environment. It forces integration, infrastructure and deployment problems to surface at the start, when they're cheapest to fix, and turns every later feature into a small change to a working system.
:::

:::qa What is central package management?
A Directory.Packages.props file that declares every NuGet package version once, with projects referencing packages without versions. It prevents version drift between projects, makes upgrades single-line changes, and is enforced by the build. Combined with lock files and locked restore in CI, builds are reproducible.
:::

## Next episode {b}

Wholesale has a skeleton in production and a clean, strict codebase. Now come forty features, five people, and a launch date. How do you break the work down, merge it every day without breaking anything, and keep it from turning into the old codebase? [Episode 2 · Delivering large projects →](ch:delivering-work)

## Further reading

- [Customize your build: Directory.Build.props](https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-by-directory)
- [Central Package Management](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management)
- [Code-style rule options and enforcing them on build](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview)
- [Architecture decision records](https://adr.github.io/)
- Alistair Cockburn on the walking skeleton; *Growing Object-Oriented Software, Guided by Tests* (Freeman and Pryce)
