---
id: docker
title: Containers and Docker for .NET
summary: Packaging .NET apps as containers. Containers vs VMs, images, layers and registries, writing a production-grade multi-stage Dockerfile, .NET's container images (SDK, ASP.NET, runtime-deps, chiseled, Alpine), building without a Dockerfile (dotnet publish), configuration and secrets, non-root users and port 8080, docker compose for local development, image size and security scanning.
layer: infra
where: Hosting & infrastructure › Packaging (containers)
fits: The container is the **unit of deployment** for layer 7. Every compute option ([Azure compute](ch:azure-compute), [Kubernetes](ch:kubernetes)) runs it, CI/CD ([CI/CD & IaC](ch:cicd-iac)) builds it, and Testcontainers ([Integration testing](ch:integration-testing)) uses it for tests. Inside the container, your app is the same ASP.NET Core host as always ([Hosting](ch:aspnet-hosting)).
levels: b,i,a
prereqs: projects-sdk-nuget, aspnet-hosting
next: azure-compute, kubernetes, cicd-iac
---

## TL;DR

- A container shares the host's kernel instead of running its own, so it starts in milliseconds and costs much less than a VM — at the price of weaker isolation.
- An **image** is a stack of cached, read-only layers; a **container** is a running instance with one writable layer on top. Many containers can share one image.
- A good .NET Dockerfile is **multi-stage**: compile with the big SDK image, then copy only the published output into a small runtime image (ideally **chiseled**, which has no shell and runs non-root by default).
- Copy `.csproj` files and restore *before* copying source, so code-only changes don't invalidate the (slow) restore layer's cache.
- Since .NET 8, ASP.NET Core images listen on port 8080, not 80, and run as a non-root user — both for security.
- Configuration comes from environment variables set by the platform, never baked into the image; secrets come from a secret store or managed identity, never `COPY`'d in.
- .NET is container-aware: the GC and thread pool read cgroup CPU/memory limits and size themselves to the container, not the host machine.

:::tip Plain-English starting point
A **container** is your app plus everything it needs to run — the .NET runtime, OS files, config — sealed into one package that behaves the same everywhere. A **Docker image** is that package, built once. **Running** the image is what creates a container.
:::

![Animated build of a .NET container image from layers, then run as a container](visuals/container-image.svg)

:::analogy Building an image is like stacking transparent sheets
Picture a few transparent sheets, each with one paragraph of a letter printed on it. Stack three sheets and you can read a whole letter through them. That stack is your **image**: one sheet per layer (base OS, .NET runtime, your app files), stacked in order.

Photocopy that stack and you get a letter you can hand out — that's a **container**: a running copy with one extra, blank sheet on top for anything it scribbles while it runs. Photocopy the same stack again and you get another, independent letter. Many containers, one image.
:::

## What a container is {b}

A **container** is an isolated process (or group of processes) with **its own filesystem, network and process space** — packaged with everything it needs: your app, the .NET runtime, OS libraries. One detail explains both its biggest strength and its biggest limit: a container shares the **host's kernel** instead of running its own. That's why it starts in milliseconds and barely costs anything to run — but it's also why its isolation is weaker than a full virtual machine's.

| | Virtual machine | Container |
|---|---|---|
| Virtualises | Hardware: each VM has a full guest OS and kernel | The OS: processes isolated with namespaces and cgroups; shared kernel |
| Size | GBs | MBs (a .NET API image is ~100–250 MB, or less with chiseled/AOT) |
| Startup | Minutes | Seconds or less |
| Density | Tens per host | Hundreds per host |
| Isolation | Strong | Good (weaker than a VM; sandboxed runtimes exist) |

:::why Why containers took over
"It works on my machine" goes away: the **same immutable image** runs on your laptop, in CI, in staging and in production. Dependencies are explicit, deployments are fast and reproducible, rollbacks mean redeploying the previous image tag, and every modern platform (Kubernetes, Container Apps, App Service, Functions, ECS, Cloud Run) accepts containers. The image is the contract between dev and ops.
:::

## Images, layers, containers and registries {b}

| Term | Meaning |
|---|---|
| **Image** | A read-only template: a stack of **layers** (filesystem diffs) plus metadata (entrypoint, env, exposed ports, user) |
| **Layer** | Each Dockerfile instruction (`FROM`, `COPY`, `RUN`) creates a layer, **cached** and shared between images |
| **Container** | A running (or stopped) instance of an image, with a thin writable layer on top |
| **Registry** | Stores and distributes images: Docker Hub, **Azure Container Registry (ACR)**, GitHub Container Registry, **MCR** (Microsoft Container Registry, where official .NET images live) |
| **Tag** | A human label: `shop-api:1.4.2`, `:latest` (mutable) |
| **Digest** | Immutable content hash: `shop-api@sha256:3f1c…` |
| **Dockerfile** | Instructions to build an image |

```bash
docker build -t shop-api:1.4.2 .
docker run -d -p 8080:8080 --name api -e ASPNETCORE_ENVIRONMENT=Staging shop-api:1.4.2
docker ps · docker logs -f api · docker exec -it api sh · docker stop api   # stop sends SIGTERM → graceful shutdown
docker tag shop-api:1.4.2 shopacr.azurecr.io/shop-api:1.4.2
az acr login -n shopacr && docker push shopacr.azurecr.io/shop-api:1.4.2
```

## .NET container images {i}

Official images are published on **mcr.microsoft.com/dotnet/**:

| Image | Contains | Use |
|---|---|---|
| `sdk:10.0` | Full SDK (compiler, CLI, NuGet) ~ 800 MB | **Build stage only** |
| `aspnet:10.0` | ASP.NET Core + .NET runtime | **Run web apps/APIs** |
| `runtime:10.0` | .NET runtime only | Run console/worker apps |
| `runtime-deps:10.0` | Only native OS dependencies (no .NET) | **Self-contained** or **Native AOT** apps |
| Variants: `-alpine` | Alpine Linux (musl): small | Smaller images; check native dependency compatibility |
| `-noble`, `-azurelinux3.0` | Ubuntu 24.04 / Azure Linux base | Default and alternative distros |
| **`-noble-chiseled`** (and `-extra`) | **Distroless** Ubuntu: no shell, no package manager, non-root by default | **Smallest attack surface**, ideal for production |
| `-composite` | ASP.NET with composite R2R images | Faster startup |

Since .NET 8, ASP.NET Core images **listen on port 8080** by default (`ASPNETCORE_HTTP_PORTS=8080`), not 80, and include a non-root **`app`** user (UID 1654).

## A production-grade Dockerfile {i}

```dockerfile
# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# 1. Copy only project files and restore first → this layer is cached until dependencies change
COPY Directory.Build.props Directory.Packages.props global.json ./
COPY src/Shop.Api/Shop.Api.csproj                       src/Shop.Api/
COPY src/Shop.Application/Shop.Application.csproj       src/Shop.Application/
COPY src/Shop.Domain/Shop.Domain.csproj                 src/Shop.Domain/
COPY src/Shop.Infrastructure/Shop.Infrastructure.csproj src/Shop.Infrastructure/
RUN dotnet restore src/Shop.Api/Shop.Api.csproj

# 2. Copy the rest and publish
COPY src/ src/
RUN dotnet publish src/Shop.Api/Shop.Api.csproj -c Release -o /app/publish --no-restore /p:UseAppHost=false

# ---------- runtime stage ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled AS final
WORKDIR /app
COPY --from=build /app/publish .
USER app                                   # non-root (chiseled images default to it already)
EXPOSE 8080
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_gcServer=1
ENTRYPOINT ["dotnet", "Shop.Api.dll"]
```

Key techniques:

1. **Multi-stage build:** compile in the big SDK image, copy only the published output into the small runtime image. The final image contains no SDK, no source code and no build tools.
2. **Layer caching:** copy the `.csproj` files and **restore before** copying source, so code changes don't invalidate the (slow) restore layer. Docker caches each layer, and only reruns a layer (plus everything after it) when that layer's own inputs change. Since the `.csproj` files rarely change, restore stays cached even when you've only edited a `.cs` file — step 1's whole point is to put the slow, rarely-changing work before the fast, frequently-changing work.
3. **`.dockerignore`:** exclude `bin/`, `obj/`, `.git`, `.vs`, `node_modules`, `*.user`, secrets. It speeds up builds and avoids leaking files.
4. **Non-root user** and a **minimal base image** (chiseled).
5. **Exec-form `ENTRYPOINT`** (the JSON array syntax, not a plain shell string) runs `dotnet` directly as PID 1, instead of wrapping it in a shell. That matters because `docker stop` sends `SIGTERM` to PID 1, and only the process that actually receives that signal can start a graceful shutdown. If a shell were PID 1 instead, the shell would get the signal and `dotnet` wouldn't — see [ASP.NET Core architecture](ch:aspnet-hosting#application-lifetime-and-graceful-shutdown-what-actually-hap) for what graceful shutdown then does.
6. Pin base image versions (`10.0` gets patches; pin digests for full reproducibility) and **rebuild regularly** to pick up security patches.

```text
# .dockerignore
**/bin
**/obj
**/.vs
**/.git
**/node_modules
**/*.user
**/appsettings.Development.json
**/secrets*.json
```

## Building images without a Dockerfile {i}

The .NET SDK can build OCI images directly, with no Docker daemon needed for the build:

```bash
dotnet publish src/Shop.Api -c Release /t:PublishContainer \
  -p ContainerRepository=shop-api \
  -p ContainerImageTags='"1.4.2;latest"' \
  -p ContainerFamily=noble-chiseled \
  -p ContainerRegistry=shopacr.azurecr.io            # push directly to a registry
```

```xml
<PropertyGroup>
  <ContainerRepository>shop-api</ContainerRepository>
  <ContainerFamily>noble-chiseled</ContainerFamily>
  <ContainerPort Include="8080" Type="tcp" />
</PropertyGroup>
```

Great for standard apps and CI; use a Dockerfile when you need custom OS packages or more complex builds.

## Configuration, secrets and storage in containers {i}

- **Configuration via environment variables** (`ConnectionStrings__Shop`, `ASPNETCORE_ENVIRONMENT`), set by the platform at runtime, **never baked into the image** — exactly the layered-configuration discipline [Configuration](ch:configuration-options#the-five-layers-lowest-priority-to-highest) covered, applied at the container level. The same image is promoted through all environments.
- **Secrets**: never `COPY` them into images or pass them as build args (they persist in layers). Use the platform's secret store (Key Vault references, Kubernetes Secrets, Container Apps secrets) or **managed identity** so there's nothing secret to inject.
- **Filesystem is ephemeral**: anything written inside a container is lost when it's replaced. Use Blob Storage or a database; mount **volumes** only for genuinely needed persistent paths.
- **Data Protection keys** must be persisted outside the container when running multiple instances (Blob + Key Vault), or cookies and antiforgery tokens break — exactly the shared-key-ring requirement [Auth](ch:auth#cookie-authentication) raised for cookie auth across instances.
- **Logs to stdout/stderr** (console or JSON console logging, or OTLP); the platform collects them.
- **Health endpoints** for the orchestrator's probes ([Resilience](ch:resilience#health-checks)).

## docker compose for local development {b}

Run the API with its dependencies locally:

```yaml
# compose.yaml
services:
  api:
    build: .
    ports: ["8080:8080"]
    environment:
      ASPNETCORE_ENVIRONMENT: Development
      ConnectionStrings__Shop: "Server=sql;Database=Shop;User Id=sa;Password=Your_strong_pw1;TrustServerCertificate=True"
      ConnectionStrings__Redis: "redis:6379"
    depends_on:
      sql: { condition: service_healthy }
      redis: { condition: service_started }

  sql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment: { ACCEPT_EULA: "Y", MSSQL_SA_PASSWORD: "Your_strong_pw1" }
    ports: ["1433:1433"]
    volumes: [sqldata:/var/opt/mssql]
    healthcheck:
      test: ["CMD-SHELL", "/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P Your_strong_pw1 -Q 'SELECT 1' || exit 1"]
      interval: 10s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  sqldata:
```

```bash
docker compose up -d --build     # start everything
docker compose logs -f api
docker compose down -v           # stop and remove volumes
```

**.NET Aspire** ([Observability & Aspire](ch:observability-aspire#net-aspire)) is the modern .NET alternative: the same orchestration in C#, with automatic wiring and a dashboard, and it's worth noticing the `depends_on` / `WaitFor` idea here is the same dependency-ordering problem Aspire's AppHost solves with actual C# instead of YAML.

## Image size, startup and security {a}

| Technique | Effect |
|---|---|
| Chiseled / distroless base | Fewer packages → fewer CVEs; no shell for attackers |
| Alpine base | Small; musl libc (check native libraries like ICU) |
| `InvariantGlobalization=true` | Drops ICU libraries when you don't need culture data |
| Trimming + self-contained on `runtime-deps` | Smaller output |
| **Native AOT** on `runtime-deps` (or chiseled) | Tens of MB, millisecond startup ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)) |
| ReadyToRun / composite images | Faster startup |

**Security practices:** scan images in CI (Trivy, Grype, Docker Scout, **Microsoft Defender for Containers** on ACR); run as non-root with a **read-only root filesystem**; drop Linux capabilities; don't run as privileged; **sign** images (Notation/cosign) and allow only signed images in production; produce an **SBOM**; rebuild regularly for base-image patches (Dependabot/Renovate can bump base images).

## Container memory and CPU limits with .NET {a}

.NET is **container-aware**: the GC and thread pool read the container's own cgroup CPU and memory limits, not the physical host's. In other words, the runtime adapts its behavior to the box it thinks it's running in — which is the container, not the machine underneath it. That's why [Memory & GC](ch:memory-gc#generations-why-the-gc-doesnt-scan-everything-every-time) and [Threading & concurrency](ch:threading-concurrency) matter directly here too.

- With a memory limit, the GC heap hard limit defaults to **75%** of the container limit (tunable via `DOTNET_GCHeapHardLimitPercent`) — see [Runtime configuration knobs: GC](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector#heap-limit) in Further reading for the exact default and how to change it.
- **Server GC** is the default for ASP.NET Core; .NET 9+ enables **DATAS** (Dynamic Adaptation To Application Sizes), so server GC uses far less memory in small containers.
- Set **realistic requests and limits** in Kubernetes. Too-low memory limits cause **OOMKilled** restarts.
- `DOTNET_PROCESSOR_COUNT` can override the detected CPU count.

:::qa What is the difference between a container and a virtual machine?
A VM virtualises hardware and runs a full guest OS with its own kernel: strong isolation, but heavy and slow to start. A container isolates processes on a shared host kernel (namespaces and cgroups) and packages just the app and its dependencies: lightweight, fast to start and dense.
:::

:::qa Why use a multi-stage Dockerfile for .NET?
To build with the large SDK image and copy only the published output into a small runtime image. The final image is smaller, has less attack surface (no SDK, sources or build tools) and pulls and starts faster.
:::

:::qa How do you optimise Docker layer caching for .NET builds?
Copy the csproj files (and Directory.*.props, global.json) first and run dotnet restore before copying the rest of the source. Restore is then cached and only reruns when dependencies change. Use a .dockerignore to keep bin/obj and other noise out of the build context.
:::

:::qa Which base image would you use for an ASP.NET Core app in production?
mcr.microsoft.com/dotnet/aspnet with a pinned major version, ideally the chiseled (distroless, non-root) variant for a minimal attack surface, or runtime-deps for self-contained/Native AOT apps. Use the sdk image only in the build stage.
:::

:::qa How should configuration and secrets be provided to a container?
Through environment variables or mounted configuration supplied by the platform at runtime, so one immutable image is promoted across environments. Secrets come from a secret store (Key Vault references, Kubernetes Secrets) or are avoided with managed identity. Never bake them into the image or build args.
:::

:::qa Why does .NET 8+ listen on port 8080 in containers?
The official images default ASPNETCORE_HTTP_PORTS to 8080 and run as a non-root user, and non-root processes can't bind to privileged ports below 1024 on Linux. Map or route external port 80/443 to 8080 at the platform.
:::

:::qa What happens when you run docker stop on a .NET container?
Docker sends SIGTERM to PID 1. With an exec-form ENTRYPOINT, that's dotnet, so the .NET host begins graceful shutdown (stops accepting connections, drains requests, stops hosted services). After the timeout (10 s default), Docker sends SIGKILL.
:::

## Further reading

- [Containerize a .NET app](https://learn.microsoft.com/en-us/dotnet/core/docker/build-container)
- [.NET container images](https://learn.microsoft.com/en-us/dotnet/core/docker/container-images)
- [Containerize a .NET app with dotnet publish](https://learn.microsoft.com/en-us/dotnet/core/containers/sdk-publish)
- [Dockerfile best practices](https://docs.docker.com/build/building/best-practices/)
- Microsoft's eBook *.NET Microservices: Architecture for Containerized .NET Applications*.
- [Runtime configuration knobs: GC](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector#heap-limit) — source for the 75% default GC heap limit figure above.

## Verify this chapter

Most of this chapter needs an actual Docker daemon or container runtime to exercise for real (building images, cgroup limits). What you *can* verify directly, with no Docker involved, is the exact SIGTERM mechanism that `docker stop` relies on. Run with `dotnet run` (plain console app, .NET 8/9, BCL only; Linux/macOS — it uses the `kill` command to send itself a real signal).

```csharp
using System.Diagnostics;
using System.Runtime.InteropServices;

// Claim: "docker stop sends SIGTERM to PID 1, and only the process that actually receives it can start
// a graceful shutdown" — demonstrate the exact mechanism .NET uses to observe SIGTERM (PosixSignalRegistration),
// which is what an exec-form ENTRYPOINT (dotnet as PID 1) relies on.
if (!OperatingSystem.IsWindows())
{
    var received = new TaskCompletionSource();
    using var registration = PosixSignalRegistration.Create(PosixSignal.SIGTERM, ctx =>
    {
        ctx.Cancel = true; // tell the runtime we handled it ourselves (so the process doesn't just die)
        received.TrySetResult();
    });

    var pid = Environment.ProcessId;
    using var killProcess = Process.Start(new ProcessStartInfo("kill", $"-TERM {pid}") { UseShellExecute = false });
    killProcess!.WaitForExit();

    var completed = await Task.WhenAny(received.Task, Task.Delay(TimeSpan.FromSeconds(3)));
    if (completed != received.Task)
        throw new Exception("FAIL: expected this process to observe its own SIGTERM within 3 seconds");
    Console.WriteLine("OK: this process received SIGTERM and ran its own handler — this is the exact signal `docker stop` sends to PID 1, which is why exec-form ENTRYPOINT (dotnet as PID 1, not a shell) matters");
}
else
{
    Console.WriteLine("SKIPPED: SIGTERM demo requires a POSIX OS (Linux/macOS) — containers run Linux, so this matches the real scenario");
}

// Claim: .NET reads cgroup limits and sizes the GC/thread pool to the CONTAINER, not the host.
// We can't fake cgroups here without a real container, but ProcessorCount is the exact value .NET bases that sizing on.
Console.WriteLine($"OK: Environment.ProcessorCount reports {Environment.ProcessorCount} (this process's view — inside a real container, this reflects the cgroup CPU limit, not the host's full core count)");

// Not runtime-verifiable here (needs an actual container runtime / cgroup limits / Docker daemon) — see Further reading:
// - Image layering, caching, multi-stage builds, registries
// - .NET base images (chiseled, Alpine, runtime-deps)
// - GC heap hard limit default (75%) and DOTNET_GCHeapHardLimitPercent

Console.WriteLine("All checkable claims verified.");
```
