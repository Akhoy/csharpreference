---
id: azure-identity-secrets
title: Identity and Secrets in Azure: Entra ID, Managed Identity and Key Vault
summary: Passwordless, least-privilege cloud apps. Microsoft Entra ID concepts (tenants, users, app registrations, service principals), how apps authenticate to Azure services, managed identities (system- and user-assigned), DefaultAzureCredential and the credential chain, Azure RBAC, Key Vault for secrets, keys and certificates, workload identity federation for CI/CD and Kubernetes, and protecting APIs with Entra ID.
layer: infra
where: Hosting & infrastructure › Identity & secrets
fits: Identity is the security foundation of layer 7, and it reaches every other layer. It replaces connection-string passwords for data ([Azure data](ch:azure-data-messaging)), feeds configuration ([Configuration](ch:configuration-options#secrets-the-layer-systems-hardest-case)), issues tokens your APIs validate ([Auth](ch:auth), [OAuth & OIDC](ch:oauth-oidc-identity)), and lets pipelines deploy without stored credentials ([CI/CD & IaC](ch:cicd-iac)).
levels: b,i,a
prereqs: cloud-azure-overview, configuration-options
next: cicd-iac, oauth-oidc-identity, web-security
---

## TL;DR

- Best option: **no secret at all** — the app authenticates as an **identity** (managed identity) that Azure itself issues and rotates, and access is granted through **RBAC**. Second-best: an unavoidable secret goes in **Key Vault**, never in source control or config files.
- A **managed identity** is a special service principal Azure creates and manages for a resource (App Service, Container Apps, a VM…). Your code just asks a local endpoint for a token; there's nothing to leak because there's no credential to begin with.
- `DefaultAzureCredential` tries several credential sources in order (env vars → workload identity → managed identity → developer tools) and uses the first that works — so the *same code* authenticates as you locally and as the managed identity in Azure.
- **Azure RBAC** (who can touch which Azure resource/data) and **Entra roles/app permissions** (who can administer Entra ID itself, or call an API) are two different permission systems — don't confuse them.
- **Workload identity federation** extends "no stored secret" to places that aren't an Azure resource at all: GitHub Actions, Kubernetes pods — an external token gets exchanged for an Entra token.

## The problem: secrets everywhere {b}

Traditional apps authenticate to their dependencies with **secrets**: SQL passwords in connection strings, storage account keys, API keys, client secrets. Secrets get **committed to Git**, pasted in chat, **logged**, copied to laptops, and are rarely **rotated**. A leaked secret is a breach — and recall from [Configuration](ch:configuration-options#secrets-the-layer-systems-hardest-case) that "no secret at all" was already flagged as the best entry in that chapter's table. This chapter is entirely about how Azure actually delivers on that promise.

The modern Azure answer, in order of preference:

1. **No secret at all**: apps authenticate with an **identity** issued by **Microsoft Entra ID** (managed identity), and access is granted with **RBAC**.
2. If a secret is unavoidable (a third-party API key), store it in **Key Vault**, accessed by managed identity, and rotate it.
3. Never in source control, images, or plain configuration files.

## Microsoft Entra ID concepts {b}

**Microsoft Entra ID** (formerly **Azure Active Directory / Azure AD**) is Microsoft's cloud identity provider: it authenticates users and applications and issues tokens (OAuth 2.0 / OpenID Connect) — exactly the kind of identity provider [Auth](ch:auth#jwt-bearer-authentication-traced-claim-by-claim) warned against building yourself.

| Concept | Meaning |
|---|---|
| **Tenant** | A dedicated instance of Entra ID for an organisation (`contoso.onmicrosoft.com`); the identity boundary |
| **User / Group** | People, and collections of them for assigning access |
| **App registration** | The **definition** of an application in a tenant: client ID, redirect URIs, exposed API scopes, app roles, credentials (secret/certificate/federated) |
| **Service principal** (enterprise application) | The **instance** of an app in a tenant: the security principal that gets permissions and role assignments |
| **Managed identity** | A special service principal **managed by Azure** for an Azure resource: no credentials for you to handle |
| **Scopes / app roles** | Permissions an API exposes (`orders.read`) / roles assigned to users or apps (`Orders.Admin`) |
| **Conditional Access, MFA** | Policies on sign-in (require MFA, compliant device, location) |
| **Entra External ID** | Customer-facing identity (CIAM) for your app's end users (successor of Azure AD B2C) |

Two kinds of permissions are often confused, and keeping them distinct is worth doing deliberately:

| | **Azure RBAC** | **Entra roles / app permissions** |
|---|---|---|
| Controls access to | **Azure resources** (Storage, SQL, Key Vault, subscriptions) | **Entra ID itself** and Microsoft Graph / your APIs |
| Example | "app-shop-api can read blobs in stshopprod" | "user is Global Administrator", "app can call Graph User.Read.All", "client may call api://shop orders.write" |

## Managed identities: the mechanism that makes "no secret" actually work {b}

A **managed identity** is an identity in Entra ID that Azure creates and manages **for a resource** (App Service, Functions, Container Apps, AKS workloads, VMs…). Your code asks the platform's local endpoint for a token; Azure handles the credentials and rotates them automatically. **There's no secret to store, leak or rotate** — not "a secret that's harder to steal," genuinely none exists for an attacker to find.

| | **System-assigned** | **User-assigned** |
|---|---|---|
| Lifecycle | Tied to one resource; deleted with it | Standalone resource; you manage its lifecycle |
| Sharing | One resource only | Can be assigned to **many** resources |
| Use when | A simple one app → its resources setup | Several apps or instances need the same permissions; pre-provisioning access before the app exists; blue/green; AKS workload identity |

```bash
# Enable a system-assigned identity and grant it data-plane access (least privilege, scoped narrowly)
az webapp identity assign -g rg-shop -n app-shop-api-prod
az role assignment create --assignee <principalId> --role "Storage Blob Data Contributor" \
  --scope /subscriptions/<sub>/resourceGroups/rg-shop/providers/Microsoft.Storage/storageAccounts/stshopprod/blobServices/default/containers/invoices
az role assignment create --assignee <principalId> --role "Azure Service Bus Data Sender" --scope <service-bus-namespace-id>
az role assignment create --assignee <principalId> --role "Key Vault Secrets User" --scope <key-vault-id>
```

Services supporting Entra (managed identity) auth include Azure SQL, PostgreSQL, Storage (Blob/Queue/Table), Service Bus, Event Hubs, Event Grid, Cosmos DB (data-plane RBAC), Key Vault, App Configuration, Managed Redis, Azure OpenAI, ACR and more.

## DefaultAzureCredential and Azure.Identity: one line of code, two environments {i}

The `Azure.Identity` library provides **`TokenCredential`** implementations that every Azure SDK client accepts. **`DefaultAzureCredential`** tries a chain in order and uses the first that works:

```text
1. EnvironmentCredential        (AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET or certificate env vars)
2. WorkloadIdentityCredential   (Kubernetes workload identity, federated token file)
3. ManagedIdentityCredential    (App Service, Functions, Container Apps, VMs, AKS)
4. SharedTokenCacheCredential / VisualStudioCredential / VisualStudioCodeCredential
5. AzureCliCredential           (az login)
6. AzurePowerShellCredential, AzureDeveloperCliCredential (azd auth login)
7. InteractiveBrowserCredential (disabled by default)
```

Notice what this chain actually buys you: the **same code** authenticates as **you** on your laptop (via Visual Studio or `az login`, step 4 or 5) and as the **managed identity** in Azure (step 3) — no `#if DEBUG`, no environment-specific branching in application code, just the credential chain quietly resolving to whichever mechanism is actually available in a given environment.

```csharp
var credential = new DefaultAzureCredential();
var blobs = new BlobServiceClient(new Uri("https://stshopprod.blob.core.windows.net"), credential);
var bus = new ServiceBusClient("sb-shop-prod.servicebus.windows.net", credential);
var secrets = new SecretClient(new Uri("https://kv-shop-prod.vault.azure.net/"), credential);
```

:::gotcha DefaultAzureCredential in production
The chain is convenient but can be **slow to fail** (trying each option) and can pick up an unexpected credential (an environment variable left on a host). For production, consider a deterministic credential: `new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(clientId))`, or `ChainedTokenCredential` with exactly what you expect, or exclude options via `DefaultAzureCredentialOptions`. With user-assigned identities, specify the **client ID**. Also give developers the same RBAC roles on dev resources so local runs work.
:::

## Azure RBAC in practice {i}

A **role assignment** = **security principal** (user, group, service principal, managed identity) + **role definition** (a set of allowed actions) + **scope** (management group, subscription, resource group, resource, or even a sub-resource like a blob container) — notice this is the exact same scope hierarchy from [Cloud fundamentals](ch:cloud-azure-overview#azures-resource-hierarchy), with roles inheriting downward through it.

| Plane | Roles control | Examples |
|---|---|---|
| **Control plane** (management) | Creating/configuring resources via ARM | Owner, Contributor, Reader, *Website Contributor* |
| **Data plane** | Accessing the data inside | *Storage Blob Data Reader/Contributor*, *Azure Service Bus Data Sender/Receiver*, *Key Vault Secrets User*, *Cosmos DB Built-in Data Contributor*, *App Configuration Data Reader* |

The control-plane-vs-data-plane distinction matters more than it looks: *Contributor* on a storage account lets you reconfigure the account itself but says nothing about reading the blobs inside it — that's a separate data-plane role entirely, and granting an app's managed identity `Contributor` when it only ever needs to read blobs is a textbook least-privilege violation. Principles: **least privilege** (data roles, not Contributor; the narrowest scope); **groups** for humans, managed identities for apps; **separate identities per app and environment**; **PIM** (Privileged Identity Management) for just-in-time elevation of admin roles; review assignments regularly.

## Azure Key Vault {i}

**Key Vault** securely stores and controls access to:

| Object | Examples | Notes |
|---|---|---|
| **Secrets** | Third-party API keys, connection strings for non-Entra systems, passwords | Versioned; expiry dates; rotation via Event Grid notifications |
| **Keys** | RSA/EC keys for encryption and signing (customer-managed keys, JWT signing, Data Protection key-ring protection) | Operations happen **inside** the vault/HSM; keys never leave (Premium: HSM-backed; **Managed HSM** for FIPS 140-3 Level 3 — see the Key Vault basic concepts link in Further reading for current certification details) |
| **Certificates** | TLS certificates with automatic renewal from integrated CAs | Used by App Service, App Gateway, Front Door |

Access with **Azure RBAC** (recommended; e.g. *Key Vault Secrets User* for apps that read secrets) or legacy access policies. Enable **soft delete** and **purge protection**, use **private endpoints**, and log access to Log Analytics.

### Using Key Vault from .NET

```csharp
// 1. As a configuration provider: secrets become IConfiguration keys ("Payments--ApiKey" → "Payments:ApiKey")
builder.Configuration.AddAzureKeyVault(
    new Uri($"https://{builder.Configuration["KeyVaultName"]}.vault.azure.net/"),
    new DefaultAzureCredential(),
    new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromMinutes(30) });
builder.Services.AddOptions<PaymentOptions>().BindConfiguration("Payments").ValidateOnStart();

// 2. As a client, for on-demand access
var secret = await secretClient.GetSecretAsync("StripeApiKey", cancellationToken: ct);

// 3. Protect the ASP.NET Core Data Protection key ring (shared across instances)
builder.Services.AddDataProtection()
    .PersistKeysToAzureBlobStorage(new Uri("https://stshopprod.blob.core.windows.net/dataprotection/keys.xml"), new DefaultAzureCredential())
    .ProtectKeysWithAzureKeyVault(new Uri("https://kv-shop-prod.vault.azure.net/keys/dataprotection"), new DefaultAzureCredential());
```

```text
# 4. Platform references: no code at all. App Service / Functions / Container Apps resolve the secret at startup.
Payments__ApiKey = @Microsoft.KeyVault(SecretUri=https://kv-shop-prod.vault.azure.net/secrets/StripeApiKey/)
```

Notice option 3 solves a problem raised all the way back in [Auth](ch:auth#cookie-authentication): Data Protection keys have to be shared across instances or cookies break on scale-out, and Key Vault plus Blob Storage is exactly how that shared key ring gets protected and distributed in production.

:::tip Key Vault is not a high-throughput database
Key Vault has **throttling limits** (thousands of operations per 10 seconds per vault). Load secrets **at startup** (config provider) and cache them; don't call `GetSecretAsync` on every request.
:::

## Workload identity federation: CI/CD and Kubernetes {a}

Outside Azure-hosted resources (GitHub Actions, Kubernetes pods, other clouds), managed identities don't exist directly — there's no Azure resource for Azure to attach an identity to. **Workload identity federation** closes that gap by letting an external identity provider's token be **exchanged** for an Entra token, again with **no stored secret**:

```text
GitHub Actions job ──(OIDC token: repo:org/shop:environment:prod)──▶ Entra ID (federated credential trusts that subject)
                                                                   ──▶ access token for the app's service principal/managed identity
                                                                   ──▶ az / azd / Bicep deploy
```

```yaml
permissions: { id-token: write, contents: read }
steps:
  - uses: azure/login@v2
    with:
      client-id: ${{ vars.AZURE_CLIENT_ID }}       # no client secret stored in GitHub!
      tenant-id: ${{ vars.AZURE_TENANT_ID }}
      subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

- **AKS Workload Identity**: a Kubernetes service account is federated with a user-assigned managed identity, so pods get Entra tokens via `WorkloadIdentityCredential` (part of `DefaultAzureCredential`).
- The same pattern works for Azure DevOps service connections, other clouds and on-premises with Azure Arc.

## Protecting your own APIs with Entra ID {a}

```text
1. App registration "Shop API": Application ID URI api://shop-api; expose scopes (orders.read, orders.write); define app roles (Orders.Admin).
2. App registration "Shop SPA" (public client) → API permission: api://shop-api/orders.read (delegated, user context).
3. Service "Billing worker" (managed identity) → app role assignment Orders.Reader on Shop API (application permission, no user).
4. Shop API validates tokens: issuer = tenant, audience = api://shop-api, then authorizes on scp (delegated) or roles (application).
```

Step 4 here is exactly the five-step JWT validation walked through in [Auth](ch:auth#jwt-bearer-authentication-traced-claim-by-claim) — Entra ID is simply the issuer whose discovery document and signing keys get fetched.

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));      // Microsoft.Identity.Web
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("ReadOrders", p => p.RequireAssertion(ctx =>
        ctx.User.HasClaim("scp", "orders.read") || ctx.User.IsInRole("Orders.Reader")));   // user OR app permission

// Calling another API as the service itself (client credentials via managed identity)
var token = await new ManagedIdentityCredential().GetTokenAsync(new TokenRequestContext(["api://inventory-api/.default"]), ct);
```

Details of the flows are in [OAuth 2.0 & OIDC](ch:oauth-oidc-identity).

:::qa What is a managed identity and why use it?
An Entra ID identity that Azure creates and manages for a resource (App Service, Functions, Container Apps, VMs, AKS workloads). The app obtains tokens from a local endpoint with no credentials to store or rotate, and is granted least-privilege access via RBAC. It eliminates secrets in configuration.
:::

:::qa System-assigned vs user-assigned managed identity?
System-assigned is created for and tied to one resource's lifecycle. User-assigned is a standalone resource that can be attached to many resources and survives them. Use it when several apps or instances share permissions, to pre-provision access, or for AKS workload identity.
:::

:::qa How does DefaultAzureCredential work?
It tries a sequence of credential types (environment variables, workload identity, managed identity, then developer tools like Visual Studio, Azure CLI and azd) and uses the first that succeeds. The same code authenticates as the developer locally and as the managed identity in Azure. In production you may prefer a specific credential for determinism and speed.
:::

:::qa What is the difference between an app registration and a service principal?
An app registration is the global definition of an application (client ID, redirect URIs, exposed scopes and roles, credentials). A service principal (enterprise application) is its instance in a specific tenant, the security principal that receives role assignments and consents. Managed identities are a special kind of service principal.
:::

:::qa How do you store and use secrets in an Azure-hosted .NET app?
Prefer no secrets: managed identity with RBAC for Azure services. For unavoidable secrets, store them in Key Vault, grant the app's managed identity the Key Vault Secrets User role, and load them via the Key Vault configuration provider or platform Key Vault references, caching them rather than calling the vault per request. Use User Secrets in development.
:::

:::qa How can GitHub Actions deploy to Azure without storing a client secret?
Workload identity federation (OIDC): configure a federated credential on an Entra app or user-assigned managed identity that trusts the GitHub repository/environment subject. The workflow requests an OIDC token (id-token: write permission) and azure/login exchanges it for an Azure access token.
:::

:::qa Azure RBAC vs Entra roles?
Azure RBAC controls access to Azure resources and their data (subscriptions, storage, Key Vault), using role assignments at a scope. Entra roles control administration of the Entra directory itself, and API permissions/app roles control access to Microsoft Graph and your own APIs.
:::

## Further reading

- [What are managed identities for Azure resources?](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview)
- [Authenticate .NET apps to Azure services](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/)
- [Azure Key Vault basic concepts](https://learn.microsoft.com/en-us/azure/key-vault/general/basic-concepts)
- [Workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [Microsoft identity platform documentation](https://learn.microsoft.com/en-us/entra/identity-platform/)

## Verify this chapter

Real Entra ID, Key Vault and workload identity federation behaviour needs an actual Azure tenant, so most of this chapter can't be verified by a console program. The checks below instead model the three *mechanisms* this chapter describes — the credential chain's fallback order, caching to avoid throttling, and RBAC scope inheritance — with plain stand-ins. Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`.

```csharp
// Verifies claims from this chapter that are mechanism-level, without needing a
// real Azure tenant: DefaultAzureCredential's "try each source in order, use the first that works"
// chain, "load secrets once at startup and cache them" vs. hitting Key Vault's per-request throttling
// limit, and RBAC role assignments inheriting DOWN a scope hierarchy but not up.
// Real Entra ID / Key Vault / workload identity federation behaviour needs an actual Azure tenant and
// isn't runtime-verifiable here — see Further reading (learn.microsoft.com/entra, /azure/key-vault) for those.
using System;
using System.Collections.Generic;

int fails = 0;
void Ok(string s) => Console.WriteLine($"OK: {s}");
void Check(bool cond, string s)
{
    if (cond) Ok(s);
    else { Console.WriteLine($"FAIL: {s}"); fails++; }
}

// --- DefaultAzureCredential-style chain: try sources in order, use the first that succeeds ---
var tried = new List<string>();
var chain = new CredentialChain(
    ("EnvironmentCredential", () => { tried.Add("EnvironmentCredential"); throw new InvalidOperationException("no env vars set"); }),
    ("WorkloadIdentityCredential", () => { tried.Add("WorkloadIdentityCredential"); throw new InvalidOperationException("not running in Kubernetes"); }),
    ("ManagedIdentityCredential", () => { tried.Add("ManagedIdentityCredential"); return "token-from-managed-identity"; }),
    ("AzureCliCredential", () => { tried.Add("AzureCliCredential"); return "token-from-az-login"; }));

var token = chain.GetToken();
Check(token == "token-from-managed-identity", "DefaultAzureCredential-style chain: the first source that actually succeeds provides the token");
Check(tried.Count == 3 && tried[^1] == "ManagedIdentityCredential", "DefaultAzureCredential-style chain: sources that fail are tried in order, and the chain stops at the first success");

// --- Load secrets once at startup and cache them, rather than calling the vault on every request ---
var vault = new ThrottledVault(callBudget: 1);
var cachingClient = new CachingSecretClient(vault);
for (int i = 0; i < 100; i++) cachingClient.GetSecret("StripeApiKey");   // 100 "requests" reusing the cached value
Check(vault.CallsMade == 1, "Caching the secret at startup means 100 reads cost Key Vault exactly 1 call, not 100");

var uncachedClient = new UncachedSecretClient(new ThrottledVault(callBudget: 1));
Check(Throws(() => { for (int i = 0; i < 2; i++) uncachedClient.GetSecret("StripeApiKey"); }),
    "Without caching, calling GetSecretAsync per request can exhaust a tight call budget (simulating Key Vault throttling)");

// --- RBAC: a role assigned at a broader scope is visible at a nested scope, not the other way round ---
var tree = new ScopeTree();
tree.AssignRole(scope: "/sub/rg-shop", role: "Storage Blob Data Reader");
Check(tree.HasRole(scope: "/sub/rg-shop/storageAccounts/stshopprod", role: "Storage Blob Data Reader"),
    "RBAC: a role assigned at the resource group scope is inherited by resources nested inside it");
Check(!tree.HasRole(scope: "/sub", role: "Storage Blob Data Reader"),
    "RBAC: a role assigned at a narrower scope does NOT apply to the broader scope above it");

Console.WriteLine(fails == 0 ? "\nAll checks passed." : $"\n{fails} check(s) failed.");
if (fails > 0) Environment.Exit(1);

static bool Throws(Action a) { try { a(); return false; } catch { return true; } }

sealed class CredentialChain(params (string Name, Func<string> TryGetToken)[] sources)
{
    public string GetToken()
    {
        foreach (var (_, tryGetToken) in sources)
        {
            try { return tryGetToken(); } catch { /* fall through to the next source, exactly like DefaultAzureCredential */ }
        }
        throw new InvalidOperationException("No credential source succeeded");
    }
}

sealed class ThrottledVault(int callBudget)
{
    public int CallsMade { get; private set; }
    public string GetSecret(string name)
    {
        CallsMade++;
        if (CallsMade > callBudget) throw new InvalidOperationException("429: Key Vault throttled this vault");
        return "s3cr3t";
    }
}

sealed class CachingSecretClient(ThrottledVault vault)
{
    private readonly Dictionary<string, string> _cache = new();
    public string GetSecret(string name) => _cache.TryGetValue(name, out var v) ? v : _cache[name] = vault.GetSecret(name);
}

sealed class UncachedSecretClient(ThrottledVault vault)
{
    public string GetSecret(string name) => vault.GetSecret(name);   // calls the vault every single time
}

sealed class ScopeTree
{
    private readonly Dictionary<string, HashSet<string>> _roles = new();
    public void AssignRole(string scope, string role) => (_roles.TryGetValue(scope, out var set) ? set : _roles[scope] = new()).Add(role);
    public bool HasRole(string scope, string role)
    {
        // A role applies at `scope` if it was assigned at `scope` or at any ancestor scope (a shorter path prefix).
        foreach (var (assignedScope, roles) in _roles)
            if (scope.StartsWith(assignedScope, StringComparison.Ordinal) && roles.Contains(role)) return true;
        return false;
    }
}
```
