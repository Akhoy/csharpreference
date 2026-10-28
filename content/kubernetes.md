---
id: kubernetes
title: Kubernetes for .NET Developers
summary: The container orchestrator, from a developer's point of view. Architecture (control plane, nodes), the core objects (Pod, Deployment, Service, Ingress/Gateway, ConfigMap, Secret, namespaces), probes, resources and autoscaling (HPA, KEDA), rolling updates, Helm and GitOps, running ASP.NET Core well on Kubernetes, and AKS specifics.
layer: infra
where: Hosting & infrastructure › Container orchestration
fits: Kubernetes runs your containers ([Docker](ch:docker)) at scale. It's the engine under Azure Container Apps and the platform behind AKS ([Azure compute](ch:azure-compute)). It relies on your app being cloud-native ([Cloud & Azure overview](ch:cloud-azure-overview#cloud-native-app-design-the-twelve-factors)): health endpoints ([Resilience](ch:resilience#health-checks)), graceful shutdown ([Hosting](ch:aspnet-hosting#application-lifetime-and-graceful-shutdown-what-actually-hap)), config from the environment and telemetry export ([Observability](ch:observability-aspire)).
levels: i,a
prereqs: docker, azure-compute
next: observability-aspire, performance-engineering
---

## TL;DR

- Kubernetes runs containers across a cluster toward a **declared desired state**, continuously reconciling reality to match it: scheduling, restarting crashed containers, scaling, load balancing, rolling updates.
- A **Pod** is the smallest unit; a **Deployment** manages pods and rolling updates; a **Service** gives them a stable name; an **Ingress** routes external HTTP traffic in.
- **Liveness** probes restart a stuck container; **readiness** probes pull a pod out of traffic without restarting it — never make liveness depend on an external dependency, or one DB blip restarts everything.
- On pod termination: removed from the Service, then `SIGTERM` (the .NET host starts graceful shutdown), then `SIGKILL` after `terminationGracePeriodSeconds` if it hasn't exited.
- **Requests** reserve scheduling capacity; **limits** cap usage — exceed the memory limit and you get `OOMKilled`, exceed the CPU limit and you get throttled (latency spikes, not a crash).
- Prefer **AKS Workload Identity** over storing secrets in the cluster: pods get federated Azure AD tokens, so `DefaultAzureCredential` reaches SQL, Key Vault and Service Bus with nothing secret sitting in etcd.

## What Kubernetes does {i}

**Kubernetes (K8s)** is an open-source system for **running containerised applications across a cluster of machines**. You **declare the desired state** ("3 replicas of shop-api:1.4.2, each with 0.5 CPU, reachable at orders.shop.com") and Kubernetes **continuously reconciles** reality to match — the whole system is built around that single loop, running forever in the background:

- **Scheduling**: places containers on nodes with enough resources.
- **Self-healing**: restarts crashed containers, replaces pods on failed nodes, kills pods failing liveness probes.
- **Scaling**: replicas up and down, manually or automatically.
- **Service discovery and load balancing**: stable names and virtual IPs for changing sets of pods.
- **Rolling updates and rollbacks**: replace versions gradually, with no downtime.
- **Configuration and secrets** injection.
- **Storage orchestration**: attach persistent volumes.

:::why Why Kubernetes, and why not
It gives a **standard, portable platform** for running many services with consistent deployment, scaling and operations, across clouds and on-premises, with a vast ecosystem (Helm, operators, service meshes, GitOps). The cost is **complexity**: networking, security, upgrades, observability and the YAML surface area need platform-engineering skills. Many teams get most of the benefits with less effort from **Azure Container Apps** (Kubernetes underneath, managed for you).
:::

## Architecture {i}

```text
┌───────────────────────── Control plane (managed for you in AKS) ─────────────────────────┐
│  kube-apiserver (the API: kubectl, CI, controllers talk to it)                             │
│  etcd (cluster state store) · scheduler (assigns pods to nodes) · controller-manager       │
│  (reconcile loops: Deployments, ReplicaSets, Nodes, Jobs…) · cloud-controller-manager       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
          │ watches/updates desired state
┌─────────▼──────── Node (VM) ─────────┐   ┌──────── Node ────────┐   ┌──────── Node ────────┐
│ kubelet (runs pods, reports status)   │   │ kubelet               │   │ kubelet               │
│ container runtime (containerd)        │   │ …                     │   │ …                     │
│ kube-proxy / CNI (networking)         │   │                       │   │                       │
│ ┌─Pod──────────┐ ┌─Pod──────────┐     │   │ ┌─Pod──────────┐      │   │ ┌─Pod──────────┐      │
│ │ shop-api     │ │ shop-worker  │     │   │ │ shop-api     │      │   │ │ shop-api     │      │
│ └──────────────┘ └──────────────┘     │   │ └──────────────┘      │   │ └──────────────┘      │
└───────────────────────────────────────┘   └───────────────────────┘   └───────────────────────┘
```

Everything is an **API object** described in YAML (or JSON), submitted with `kubectl apply -f`, stored in etcd, and acted on by **controllers** running **reconciliation loops** (observe → compare with desired → act) — the "desired state" idea from the opening section, now a concrete object sitting in a concrete place.

## The core objects {i}

| Object | What it is | .NET-app relevance |
|---|---|---|
| **Pod** | The smallest unit: one or more containers sharing network (localhost) and volumes; ephemeral, with its own IP | Usually one app container (+ optional sidecars) |
| **ReplicaSet** | Keeps N identical pods running | Managed by Deployments; rarely used directly |
| **Deployment** | Declares pods + replicas + **rolling update** strategy; manages ReplicaSets per version | **How you run a stateless API or worker** |
| **Service** | Stable virtual IP + DNS name load-balancing to pods selected by **labels** (`ClusterIP`, `NodePort`, `LoadBalancer`) | `http://shop-api.shop.svc.cluster.local` for service-to-service calls |
| **Ingress** / **Gateway API** | HTTP(S) routing from outside to Services (hosts, paths, TLS) via an ingress controller (NGINX, Traefik, App Gateway for Containers) | Public entry for APIs |
| **ConfigMap** | Non-secret configuration as key/values or files | Environment variables / mounted `appsettings.Production.json` |
| **Secret** | Sensitive values (base64-encoded, **not encrypted** by default; enable etcd encryption, or use the Key Vault CSI driver) | Connection strings (better: workload identity) |
| **Namespace** | A virtual cluster partition for isolation, quotas and RBAC | One per team/app/environment |
| **StatefulSet** | Pods with stable identity and storage | Databases, brokers (often better as managed PaaS) |
| **DaemonSet** | One pod per node | Log/metrics agents |
| **Job / CronJob** | Run-to-completion / scheduled | Migrations, nightly batch jobs |
| **HorizontalPodAutoscaler** | Scales replicas on metrics | Autoscaling APIs |
| **PersistentVolume(Claim)** | Durable storage | Rare for stateless .NET services |
| **ServiceAccount** | Pod identity for the K8s API and **workload identity** to Azure | Passwordless Azure access |

## A complete manifest for an ASP.NET Core API {i}

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop
  labels: { app: shop-api }
spec:
  replicas: 3
  revisionHistoryLimit: 5
  selector:
    matchLabels: { app: shop-api }
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }         # zero-downtime: add one new before removing an old
  template:
    metadata:
      labels:
        app: shop-api
        azure.workload.identity/use: "true"                     # AKS workload identity
    spec:
      serviceAccountName: shop-api
      terminationGracePeriodSeconds: 45                         # > app's ShutdownTimeout
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: api
          image: shopacr.azurecr.io/shop-api:3f1c2a9b7d10       # immutable tag (git SHA)
          ports: [{ containerPort: 8080, name: http }]
          env:
            - { name: ASPNETCORE_ENVIRONMENT, value: Production }
            - { name: OTEL_EXPORTER_OTLP_ENDPOINT, value: "http://otel-collector.observability:4317" }
            - name: ConnectionStrings__Shop
              valueFrom: { secretKeyRef: { name: shop-api-secrets, key: sql } }
          envFrom:
            - configMapRef: { name: shop-api-config }
          resources:
            requests: { cpu: 250m, memory: 256Mi }              # used for scheduling (guaranteed)
            limits:   { memory: 512Mi }                         # exceed → OOMKilled. CPU limits often omitted to avoid throttling
          startupProbe:                                         # give slow starts (JIT, warm-up) time before other probes
            httpGet: { path: /health/live, port: http }
            failureThreshold: 30
            periodSeconds: 2
          livenessProbe:                                        # failing → container restarted
            httpGet: { path: /health/live, port: http }
            periodSeconds: 10
          readinessProbe:                                       # failing → removed from Service endpoints (no traffic)
            httpGet: { path: /health/ready, port: http }
            periodSeconds: 5
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
      volumes: [{ name: tmp, emptyDir: {} }]
      topologySpreadConstraints:                                # spread replicas across zones
        - { maxSkew: 1, topologyKey: topology.kubernetes.io/zone, whenUnsatisfiable: ScheduleAnyway, labelSelector: { matchLabels: { app: shop-api } } }
---
apiVersion: v1
kind: Service
metadata: { name: shop-api, namespace: shop }
spec:
  selector: { app: shop-api }
  ports: [{ port: 80, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop-api
  namespace: shop
  annotations: { cert-manager.io/cluster-issuer: letsencrypt }
spec:
  ingressClassName: nginx
  tls: [{ hosts: [api.shop.com], secretName: api-shop-tls }]
  rules:
    - host: api.shop.com
      http:
        paths: [{ path: /, pathType: Prefix, backend: { service: { name: shop-api, port: { number: 80 } } } }]
---
apiVersion: policy/v1
kind: PodDisruptionBudget                                    # keep ≥2 pods during node drains/upgrades
metadata: { name: shop-api, namespace: shop }
spec:
  minAvailable: 2
  selector: { matchLabels: { app: shop-api } }
```

Notice `/health/live` and `/health/ready` go to *different* probes: `startupProbe`/`livenessProbe` use the liveness path, `readinessProbe` uses the readiness one. That split matters because of what [Resilience](ch:resilience#health-checks) built those two endpoints for: a dependency hiccup should trip readiness (removed from traffic, left to retry), not liveness (restarted — which would turn a blip into an outage).

## Probes and graceful shutdown {a}

| Probe | Question | On failure | Don't… |
|---|---|---|---|
| **startup** | Has the app finished starting? | Keep waiting (up to the threshold), then restart | Leave it out for slow-starting apps |
| **liveness** | Is the process healthy (not deadlocked)? | **Restart** the container | Check databases or other dependencies (a DB blip would restart everything) |
| **readiness** | Can it serve traffic right now? | **Remove from Service endpoints** | Make it so strict that all pods go unready together |

**Termination sequence** when a pod is deleted (rolling update, scale-in, node drain) — this is the exact SIGTERM-driven sequence [ASP.NET Core architecture](ch:aspnet-hosting#application-lifetime-and-graceful-shutdown-what-actually-hap) walked through, now seen from the orchestrator's side of the handshake:

1. The pod is marked Terminating; it's **removed from Service endpoints** (asynchronously!) and any `preStop` hook runs.
2. **SIGTERM** is sent to the container → the .NET host begins graceful shutdown (stops accepting connections, drains in-flight requests, stops hosted services).
3. After `terminationGracePeriodSeconds` (30 s default), **SIGKILL**.

Because endpoint removal is asynchronous, a pod can still receive new requests for a moment after SIGTERM — a real race between "tell the load balancer to stop sending traffic here" and "actually stop accepting it," with no guarantee which one wins first. A common mitigation is a short `preStop: sleep 5`. Keep `HostOptions.ShutdownTimeout` below the grace period.

## Resources, QoS and autoscaling {a}

- **Requests** reserve capacity for scheduling; **limits** cap usage. Memory over the limit means **OOMKilled**; CPU over the limit means **throttling** (latency spikes), which is why many teams set CPU requests but no CPU limit for latency-sensitive .NET services.
- **QoS classes**: Guaranteed (requests = limits), Burstable, BestEffort (none: evicted first).
- .NET respects container limits (GC heap limit ~75% of memory limit by default; CPU count from the cgroup quota — see Further reading for the exact mechanism). **DATAS** (default in .NET 9+ Server GC) keeps memory proportional to load. See [Docker](ch:docker#container-memory-and-cpu-limits-with-net).

| Autoscaler | Scales | On |
|---|---|---|
| **HPA** (Horizontal Pod Autoscaler) | Pod replicas | CPU/memory utilisation, or custom/external metrics |
| **KEDA** | Pod replicas, **including to zero** | Event sources: Service Bus queue length, Kafka lag, RabbitMQ, Prometheus queries, cron… |
| **VPA** | Pod requests/limits | Observed usage (recommendation mode is safest) |
| **Cluster autoscaler** / Node auto-provisioning | **Nodes** | Pending pods that can't be scheduled |

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: shop-worker, namespace: shop }
spec:
  scaleTargetRef: { name: shop-worker }
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
    - type: azure-servicebus
      metadata: { queueName: orders, namespace: sb-shop-prod, messageCount: "100" }
      authenticationRef: { name: servicebus-workload-identity }
```

## Configuration, secrets and identity {a}

- **ConfigMaps** map naturally to .NET configuration: as **environment variables** (`Payments__BaseUrl`) or **mounted files** (`appsettings.Production.json`, picked up with `reloadOnChange`, or `AddKeyPerFile` for one-file-per-key).
- **Secrets**: native Secrets are only base64-encoded. Prefer the **Secrets Store CSI driver with Azure Key Vault**, External Secrets Operator, or — best of all — **AKS Workload Identity**: annotate a ServiceAccount with a user-assigned managed identity's client ID, and pods get federated tokens. `DefaultAzureCredential` → `WorkloadIdentityCredential` then reaches SQL, Service Bus and Key Vault with **no secrets in the cluster** — the same workload identity federation mechanism from [Identity & secrets](ch:azure-identity-secrets#workload-identity-federation-ci-cd-and-kubernetes), here granting pods identity the same way it grants GitHub Actions workflows identity.

## Packaging and delivery: Helm, Kustomize, GitOps {a}

- **Helm**: the package manager for Kubernetes. **Charts** are templated manifests with `values.yaml` per environment; `helm upgrade --install shop-api ./chart -f values-prod.yaml`. Also used to install third-party software (ingress-nginx, cert-manager, KEDA, Prometheus).
- **Kustomize**: template-free overlays (base + patches per environment), built into `kubectl apply -k`.
- **GitOps** with **Argo CD** or **Flux**: the desired cluster state lives in Git; an in-cluster agent pulls and reconciles, giving drift correction, audit history and easy rollback (revert the commit). CI only builds the image and bumps the tag in the config repo — a direct application of the "build once, deploy many" principle from [CI/CD & IaC](ch:cicd-iac#anatomy-of-a-net-pipeline), with Git itself as the record of which image is meant to be running where.
- **Progressive delivery**: Argo Rollouts / Flagger for canaries with automated metric analysis.

## Day-to-day kubectl {i}

```bash
kubectl config use-context aks-shop-prod
kubectl get pods -n shop -o wide                       # status, node, IP
kubectl describe pod shop-api-7d9f… -n shop            # events: scheduling, probe failures, OOMKilled, image pull errors
kubectl logs -f deploy/shop-api -n shop --since=10m    # stream logs (all pods of the deployment with --all-pods)
kubectl exec -it shop-api-7d9f… -n shop -- sh          # (not possible with chiseled images: use ephemeral debug containers)
kubectl debug -it shop-api-7d9f… --image=mcr.microsoft.com/dotnet/sdk:10.0 --target=api   # attach dotnet-trace/counters
kubectl rollout status deploy/shop-api -n shop
kubectl rollout undo deploy/shop-api -n shop           # roll back to the previous ReplicaSet
kubectl scale deploy/shop-api --replicas=5 -n shop
kubectl top pods -n shop                               # CPU/memory (metrics-server)
kubectl port-forward svc/shop-api 8080:80 -n shop      # reach a ClusterIP service locally
```

Common failure states: **`CrashLoopBackOff`** (the app exits on start: check the logs, config and missing env vars), **`ImagePullBackOff`** (wrong tag, or no registry access: grant `AcrPull`), **`OOMKilled`** (raise the memory limit or fix a leak), **`Pending`** (not enough capacity, or unsatisfiable affinity/taints), and readiness failing (dependency unreachable, probe path wrong).

## AKS specifics {a}

| Area | AKS feature |
|---|---|
| Control plane | Managed and free (Standard tier adds an uptime SLA); **AKS Automatic** for an opinionated, fully managed experience |
| Nodes | **Node pools** (VM scale sets): system vs user pools, spot pools, GPU pools, Linux/Windows; auto-upgrade channels and planned maintenance windows |
| Networking | Azure CNI (Overlay recommended), network policies (Azure/Calico/Cilium), private clusters, **Application Gateway for Containers** / application routing add-on (managed NGINX) |
| Identity | Entra ID integration for kubectl and Kubernetes RBAC; **Workload Identity** for pods |
| Registry | ACR attach (`az aks update --attach-acr`) |
| Secrets | Key Vault Secrets Store CSI driver add-on |
| Scaling | Cluster autoscaler, **KEDA add-on**, node auto-provisioning |
| Observability | Container Insights, **Managed Prometheus + Managed Grafana**, OpenTelemetry |
| Security | Microsoft Defender for Containers, Azure Policy for Kubernetes, image cleaner, deployment safeguards |
| Service mesh | Istio-based service mesh add-on |

:::qa What is Kubernetes and what problems does it solve?
A container orchestration platform that runs containers across a cluster from declarative desired state, providing scheduling, self-healing, horizontal scaling, service discovery and load balancing, rolling updates and rollbacks, and configuration/secret injection, through a standard API with a large ecosystem.
:::

:::qa Pod vs Deployment vs Service?
A Pod is the smallest deployable unit: one or more co-located containers sharing network and storage, and ephemeral. A Deployment declares the desired pods and replica count and manages rolling updates through ReplicaSets. A Service provides a stable virtual IP and DNS name that load-balances across the pods selected by labels.
:::

:::qa What are liveness, readiness and startup probes?
Startup probes delay other checks until the app has started. Liveness probes detect a hung process, and failure restarts the container. Readiness probes indicate whether the pod should receive traffic, and failure removes it from Service endpoints without restarting. Liveness must not depend on external dependencies.
:::

:::qa How does a rolling update work and how do you roll back?
The Deployment creates a new ReplicaSet and gradually scales it up while scaling the old one down, respecting maxSurge/maxUnavailable and readiness probes, so capacity is preserved. Roll back with `kubectl rollout undo` (back to the previous ReplicaSet), or by reverting the manifest in GitOps.
:::

:::qa Requests vs limits?
Requests are the resources reserved for scheduling a pod (guaranteed). Limits are maximums: exceeding the memory limit gets the container OOMKilled, and exceeding the CPU limit throttles it. Setting realistic requests and memory limits matters for stability; CPU limits can cause latency through throttling.
:::

:::qa How do you scale on queue length in Kubernetes?
With KEDA: a ScaledObject targeting the deployment, with a trigger such as azure-servicebus (queue name, target message count per replica) and authentication, scaling replicas between min (possibly 0) and max based on backlog.
:::

:::qa How should a .NET app in AKS access Azure SQL or Key Vault?
With AKS Workload Identity: a Kubernetes ServiceAccount federated with a user-assigned managed identity; pods get tokens via WorkloadIdentityCredential (included in DefaultAzureCredential), and the identity has least-privilege roles on SQL, Key Vault and Service Bus. No secrets in the cluster.
:::

:::qa What does CrashLoopBackOff mean?
The container keeps exiting shortly after starting and Kubernetes restarts it with increasing backoff. Usually it's a startup exception (bad config, missing env var or secret, failing ValidateOnStart, unreachable dependency at startup) or a failing liveness probe. Check `kubectl logs --previous` and `describe pod` events.
:::

## Further reading

- [Kubernetes documentation: concepts](https://kubernetes.io/docs/concepts/)
- [AKS documentation](https://learn.microsoft.com/en-us/azure/aks/) · [AKS baseline architecture](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/containers/aks/baseline-aks)
- [Use Microsoft Entra Workload ID with AKS](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview)
- [KEDA](https://keda.sh/) · [Helm](https://helm.sh/docs/) · [Argo CD](https://argo-cd.readthedocs.io/)
- Book: *Kubernetes Up & Running* (Burns, Beda, Hightower, Evenson).
- [Runtime configuration options for garbage collection](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) (the `~75%` heap-limit default and `DOTNET_GCHeapHardLimit`)

## Verify this chapter

Almost everything in this chapter is Kubernetes's own orchestration behavior — scheduling, probes, rolling updates — which genuinely needs a real cluster to observe; a C# program on its own can't fake that honestly. The one claim that *is* pure .NET runtime behavior, and the same cgroup-awareness mechanism that makes .NET respect a container's memory limit under Kubernetes or Docker, is verified below by actually setting a hard GC memory ceiling and reading it back. Save as a console app (`dotnet new console`), then `dotnet run`.

```csharp
using System.Diagnostics;

if (Environment.GetEnvironmentVariable("VERIFY_CHILD") == "1")
{
    var info = GC.GetGCMemoryInfo();
    Console.WriteLine(info.TotalAvailableMemoryBytes);
    return;
}

// Claim: .NET's GC respects a configured hard memory ceiling — the exact mechanism that makes it respect a
// Kubernetes/Docker cgroup memory limit (this chapter's "GC heap limit ~75% of memory limit" claim).
// DOTNET_GCHeapHardLimit sets an explicit byte ceiling; we verify it by reading it back from a child process,
// since GC configuration is fixed at process startup.
const long limitBytes = 256L * 1024 * 1024; // 256 MiB

var psi = new ProcessStartInfo
{
    FileName = Environment.ProcessPath!,
    RedirectStandardOutput = true,
    UseShellExecute = false,
};
foreach (var arg in Environment.GetCommandLineArgs().Skip(1)) psi.ArgumentList.Add(arg);
psi.Environment["VERIFY_CHILD"] = "1";
psi.Environment["DOTNET_GCHeapHardLimit"] = limitBytes.ToString("X"); // DOTNET_GCHeapHardLimit takes a hex byte count

using var proc = Process.Start(psi)!;
var output = (await proc.StandardOutput.ReadToEndAsync()).Trim();
await proc.WaitForExitAsync();

var reportedLimit = long.Parse(output);
if (reportedLimit > limitBytes || reportedLimit < limitBytes / 2)
    throw new Exception($"FAIL: expected the GC to report an available-memory ceiling near {limitBytes} bytes, got {reportedLimit}");

Console.WriteLine($"OK: DOTNET_GCHeapHardLimit made the GC report a hard ceiling (~{reportedLimit / 1024 / 1024} MiB) — " +
    "the same cgroup-awareness mechanism that makes .NET respect a container's memory limit under Kubernetes or Docker");

Console.WriteLine("All checks passed.");

// Not runtime-verifiable here (needs a real cluster, which this verification environment cannot assume):
// - scheduling, self-healing, rolling updates, readiness/liveness probe behavior — see Further reading: "Kubernetes documentation: concepts"
// - HPA/KEDA autoscaling, AKS workload identity, GitOps reconciliation — see Further reading: "KEDA" / "Use Microsoft Entra Workload ID with AKS"
// - the exact ~75% GC heap default and CPU-count-from-cgroup-quota figures in a real container — see Further reading:
//   "Runtime configuration options for garbage collection" (the general mechanism verified above is the same one)
```
