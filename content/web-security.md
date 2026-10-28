---
id: web-security
title: Web Application Security for .NET Backends
summary: Defending APIs against real attacks. Security principles, the OWASP Top 10 and API Security Top 10 mapped to .NET defences, broken access control and IDOR, injection, XSS and CSRF, authentication failures, password hashing, cryptography and the Data Protection API, HTTPS, HSTS and security headers, SSRF, mass assignment, rate limiting, secure file uploads, dependency and supply-chain security, and logging without leaking.
layer: cross
where: Cross-cutting › Security › Application security
fits: Security is a layer-8 concern that every layer must honour: input handling in endpoints ([Building APIs](ch:building-apis)), authentication and authorization in the pipeline ([Auth](ch:auth)), parameterised data access ([ADO.NET & Dapper](ch:ado-dapper)), secrets and identity in the cloud ([Identity & secrets](ch:azure-identity-secrets)), CORS and rate limiting ([Caching, rate limiting & CORS](ch:caching-ratelimit-cors)), and the token flows in [OAuth & OIDC](ch:oauth-oidc-identity).
levels: b,i,a
prereqs: auth, building-apis
next: oauth-oidc-identity, system-design
---

## TL;DR

- Security is the same principles this book has already used (least privilege, secure-by-default, never trust input) now organised around specific attacks, not a separate discipline bolted on at the end.
- **Broken access control** (IDOR/BOLA) is the #1 real-world risk: checking "is this user logged in" is not the same as checking "may this user see *this specific* record."
- Always use **parameterized** queries, never string-concatenated SQL — the value should never become part of the command text at all.
- Store passwords with a **slow, salted, adaptive** hash (PBKDF2, Argon2id, bcrypt), never a fast hash like SHA-256 or plain text.
- **XSS** steals/runs script in someone else's browser; **CSRF** abuses cookies being sent automatically — they need different, sometimes opposite, defences (HttpOnly cookies help XSS, SameSite/antiforgery tokens help CSRF).
- Treat every external input — request bodies, file uploads, outbound URLs you fetch on a user's behalf (SSRF) — as hostile until validated, and keep dependencies patched; most real breaches exploit a known, unfixed issue, not a novel attack.

## Security principles {b}

| Principle | Meaning | Example |
|---|---|---|
| **Defence in depth** | Multiple independent layers; one failure isn't fatal | WAF + authn + authz + parameterised SQL + least-privilege DB user + encryption at rest |
| **Least privilege** | Every identity gets only the access it needs | The app's managed identity has `db_datareader/db_datawriter`, not `db_owner`; data-plane roles scoped to one container |
| **Secure by default** | The safe option is the default | Fallback policy requiring authentication; HTTPS only; deny-by-default CORS |
| **Fail securely** | Errors don't open doors or leak details | Generic ProblemDetails, no stack traces; authorization errors deny |
| **Never trust input** | Validate, encode and parameterise everything from outside | Request bodies, headers, query strings, files, messages, *and* data from other services |
| **Minimise attack surface** | Fewer endpoints, ports, packages and privileges | Remove unused endpoints, disable Swagger UI in prod, chiseled images |
| **Keep secrets out of code** | Use identities and vaults | Managed identity, Key Vault, User Secrets for dev |
| **Assume breach** | Detect, limit blast radius, recover | Logging and alerts, segmentation, short token lifetimes, backups |

Notice how many of these principles have already shown up by name earlier in this book — least privilege drove every RBAC example in [Identity & secrets](ch:azure-identity-secrets#azure-rbac-in-practice), secure-by-default was the entire justification for [Auth](ch:auth#authorization-the-simple-forms-before-anything-needs-a-polic)'s fallback-policy advice. Security here isn't a separate discipline bolted on at the end; it's the same instincts this book has been building all along, now organised explicitly around attacks.

**Threat modelling** (e.g. **STRIDE**: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) at design time finds problems before they're built.

## OWASP Top 10 mapped to .NET {i}

The **OWASP Top 10** (web apps; 2021 edition, with a 2025 update) and **OWASP API Security Top 10** (2023) list the most critical risks.

| Risk | What it is | .NET defences |
|---|---|---|
| **Broken access control** (#1 web; API1 BOLA, API5 BFLA) | Users access data or functions they shouldn't: IDOR, missing checks on admin endpoints, CORS misconfig | Authorization on **every** endpoint (fallback policy), **resource-based authorization**, scope queries by tenant/user, deny by default |
| **Cryptographic failures** | Weak or missing encryption, plain-text secrets, weak hashing | TLS everywhere, HSTS, TDE / encryption at rest, `PasswordHasher`/PBKDF2/Argon2, Data Protection API, Key Vault |
| **Injection** | SQL, NoSQL, OS command, LDAP, log injection | **Parameterised** queries (EF Core LINQ, Dapper parameters, `FromSql` interpolation); never build commands from input |
| **Insecure design** | Missing security controls by design | Threat modelling, abuse cases, rate limits, secure defaults |
| **Security misconfiguration** | Debug pages in prod, default credentials, verbose errors, open storage | Environment-specific config, `UseExceptionHandler`, Azure Policy, IaC reviews, disabled public access |
| **Vulnerable and outdated components** | Known-CVE packages and base images | NuGet audit, `dotnet list package --vulnerable`, Dependabot, image scanning, regular .NET patching |
| **Identification and authentication failures** | Weak passwords, credential stuffing, broken session handling | External IdP (Entra ID), MFA, lockout, short-lived tokens, secure cookies |
| **Software and data integrity failures** | Untrusted deserialization, unsigned updates, compromised CI | No `BinaryFormatter` (removed in .NET 9), signed packages and images, pinned actions, protected pipelines |
| **Security logging and monitoring failures** | Attacks go unnoticed | Log auth failures and access denials, alert on anomalies, Defender for Cloud |
| **SSRF** (Server-Side Request Forgery) | The server fetches attacker-controlled URLs (cloud metadata, internal services) | Allow-list destinations, block private/metadata IP ranges, no raw user URLs to HttpClient |
| API3: **Broken object property level authorization** / mass assignment | Clients read or write properties they shouldn't | Request/response **DTOs**, never bind entities, explicit mapping |
| API4: **Unrestricted resource consumption** | No limits on size, rate or cost | Rate limiting, request size limits, pagination caps, timeouts, upload limits |

The rest of this chapter walks through the table's top few rows in detail — they're ranked by real-world frequency for a reason, and that ranking is also the order worth spending review time in.

## Broken access control and IDOR {b}

The **#1 risk** in practice. An **IDOR** (Insecure Direct Object Reference, called **BOLA** in the API Top 10) is when an endpoint trusts an ID from the client without checking that the *caller* is actually allowed to see *that specific* resource:

```csharp
// ✘ Any authenticated user can read ANY order by changing the id
app.MapGet("/orders/{id:int}", async (int id, ShopDb db) => await db.Orders.FindAsync(id)).RequireAuthorization();

// ✔ Scope the query to the caller (and return 404, not 403, so you don't reveal what exists)
app.MapGet("/orders/{id:int}", async (int id, ClaimsPrincipal user, ShopDb db, CancellationToken ct) =>
{
    var customerId = user.GetCustomerId();
    var order = await db.Orders.AsNoTracking()
        .Where(o => o.Id == id && o.CustomerId == customerId)
        .Select(o => o.ToDto()).FirstOrDefaultAsync(ct);
    return order is null ? Results.NotFound() : Results.Ok(order);
}).RequireAuthorization();
```

Notice the first version isn't missing authorization entirely — `RequireAuthorization()` is right there. What it's missing is authorization *scoped to this specific resource*, which is exactly the resource-based authorization distinction [Auth](ch:auth#resource-based-authorization-when-the-rule-depends-on-which-) drew out: "is logged in" and "may see order 1042" are different questions, and the broken version only ever asked the first.

Also: **function-level** checks (`/admin/*` must require an admin policy, not just "authenticated"); **multi-tenant isolation** (global query filters by TenantId plus database row-level security as defence in depth; see [EF Core advanced](ch:efcore-advanced#global-query-filters-soft-delete-and-multi-tenancy)); don't rely on hidden UI or unguessable IDs (GUIDs aren't access control); and test authorization explicitly in integration tests ([Integration testing](ch:integration-testing#fake-authentication)).

## Injection {b}

```csharp
// ✘ SQL injection: input = "x' OR '1'='1"  or  "'; DROP TABLE Orders; --"
var sql = "SELECT * FROM Users WHERE Email = '" + email + "'";
db.Users.FromSqlRaw(sql);

// ✔ Parameterised (all of these send values as parameters)
db.Users.Where(u => u.Email == email);                                   // LINQ
db.Users.FromSql($"SELECT * FROM Users WHERE Email = {email}");           // FormattableString → parameter
conn.QueryAsync<User>("SELECT * FROM Users WHERE Email = @email", new { email });   // Dapper
cmd.Parameters.Add("@email", SqlDbType.NVarChar, 256).Value = email;       // ADO.NET
```

Every one of the four safe lines above was already covered in detail when it was first introduced — [ADO.NET & Dapper](ch:ado-dapper#the-layer-every-other-data-access-tool-is-secretly-built-on) made the same point about parameterisation, and this chapter is really collecting that advice under its actual name: injection defence.

Dynamic identifiers (sort column, table name) **can't be parameters**: **allow-list** them (`sort switch { "price" => …, _ => … }`), exactly the whitelisting approach [API design](ch:api-design#pagination-filtering-and-sorting-never-return-an-unbounded-l) used for sortable fields. Other injection forms: **OS command injection** (`Process.Start` with user input: avoid it, or pass arguments with `ArgumentList`, never through a shell), **LDAP/XPath**, **NoSQL** (build queries with SDK APIs, not string concatenation), **log injection/forging** (structured logging encodes values; never log raw multi-line user input as the message), and **header injection** (CRLF in redirects; ASP.NET Core validates headers).

## XSS, CSRF and clickjacking {i}

**Cross-Site Scripting (XSS):** attacker-supplied script runs in another user's browser.

- **Razor encodes output by default** (`@Model.Name`); `Html.Raw` and `MarkupString` bypass it, so avoid them with user data or sanitise with HtmlSanitizer.
- APIs returning JSON are safe if served with `Content-Type: application/json`. The risk moves to the **SPA**, which must not inject untrusted HTML (`innerHTML`, `dangerouslySetInnerHTML`).
- **Content-Security-Policy** header restricts script sources: a strong second layer.
- Keep tokens out of `localStorage` where XSS can steal them (prefer HttpOnly cookies with the BFF pattern) — precisely the XSS-vs-CSRF tradeoff table [Auth](ch:auth#cookies-vs-bearer-tokens-the-tradeoff-behind-how-do-i-stay-l) laid out: a cookie's `HttpOnly` flag is specifically the mitigation for this exact theft.

**Cross-Site Request Forgery (CSRF):** a malicious site makes the victim's browser send an authenticated request, because **cookies are attached automatically**.

- Affects **cookie-authenticated** apps (MVC/Razor Pages, BFFs), **not** APIs using bearer tokens in the Authorization header — the mirror image of the XSS point above, which is exactly why that same table framed cookies and bearer tokens as trading one risk for the other rather than one simply being safer.
- Defences: **antiforgery tokens** (automatic with Razor form tag helpers and `[ValidateAntiForgeryToken]`/`UseAntiforgery`; minimal API form endpoints validate by default in .NET 8+), **SameSite** cookies (`Lax` or `Strict`), and checking `Origin`/`Referer` for state-changing requests.

**Clickjacking:** framing your site invisibly. Use `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`.

## Authentication failures and password storage {i}

- Prefer an **external identity provider** (Entra ID, Entra External ID, Auth0, Okta) with **MFA** and **Conditional Access**, over building login yourself ([OAuth & OIDC](ch:oauth-oidc-identity)) — the exact "don't roll your own token service" warning [Auth](ch:auth#jwt-bearer-authentication-traced-claim-by-claim) gave, extended to the whole login experience rather than just token issuance.
- If you store passwords: **never** plain text, reversible encryption, or fast hashes (MD5, SHA-1, SHA-256). Use a **slow, salted, adaptive** algorithm: **PBKDF2** (ASP.NET Core Identity's `PasswordHasher<T>`: HMAC-SHA512 with 100,000 iterations since .NET 7), **Argon2id**, **bcrypt** or **scrypt**.
- **Account lockout** and rate limiting on login (credential stuffing); generic error messages ("invalid email or password"), with no user enumeration on login, registration or password reset.
- Check new passwords against breached-password lists (the Have I Been Pwned k-anonymity API); favour length over complexity rules (NIST SP 800-63B).
- **Session/token hygiene:** short-lived access tokens, rotating refresh tokens, revocation on password change (security stamp), secure cookie flags (`HttpOnly`, `Secure`, `SameSite`).

```csharp
var hasher = new PasswordHasher<AppUser>();
string hash = hasher.HashPassword(user, password);                       // includes algorithm version, salt, iterations
var result = hasher.VerifyHashedPassword(user, hash, attempt);           // Success / SuccessRehashNeeded / Failed
```

Notice why "slow" is listed as a requirement, not a drawback: a fast hash like SHA-256 lets an attacker who steals a password database try billions of guesses per second on commodity hardware. PBKDF2's deliberate 100,000 iterations make each individual guess expensive enough that brute-forcing even a weak password back from its hash becomes impractical at scale — the slowness is the entire point.

## Cryptography and the Data Protection API {a}

Rules: **don't invent crypto**; use vetted libraries and current algorithms; manage **keys** properly (Key Vault); and pick the right primitive:

| Need | Use | Avoid |
|---|---|---|
| Protect data your app will read back (tokens, cookies, temp data) | **ASP.NET Core Data Protection API** (`IDataProtector`): authenticated encryption, key ring with rotation | Rolling your own AES code |
| Encrypt data at rest | Platform encryption (TDE, Storage SSE), Always Encrypted, `AesGcm` with keys in Key Vault | ECB mode, hard-coded keys |
| Integrity / signatures | HMAC-SHA256, RSA-PSS/ECDSA (Key Vault keys) | Plain hashes as "signatures" |
| Passwords | PBKDF2 / Argon2 / bcrypt | SHA-256 |
| Random tokens, API keys | `RandomNumberGenerator.GetBytes(32)` | `System.Random`, `Guid.NewGuid()` for secrets |
| Comparing secrets | `CryptographicOperations.FixedTimeEquals` | `==` (timing attacks) |

```csharp
public sealed class InviteTokens(IDataProtectionProvider provider)
{
    private readonly ITimeLimitedDataProtector _p = provider.CreateProtector("Shop.Invites.v1").ToTimeLimitedDataProtector();
    public string Create(Guid inviteId) => _p.Protect(inviteId.ToString(), TimeSpan.FromDays(7));
    public Guid? Read(string token) { try { return Guid.Parse(_p.Unprotect(token)); } catch (CryptographicException) { return null; } }
}
// Multi-instance: persist keys to Blob and protect them with Key Vault (see Identity & secrets)
```

## Transport security and security headers {i}

```csharp
if (!app.Environment.IsDevelopment()) app.UseHsts();        // Strict-Transport-Security: browsers refuse plain HTTP
app.UseHttpsRedirection();

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'";   // tailor for HTML apps; APIs can be strict
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    await next(ctx);
});
builder.WebHost.ConfigureKestrel(k => k.AddServerHeader = false);    // don't advertise "Server: Kestrel"
```

TLS 1.2+ only (the platform usually enforces it), managed certificates with automatic renewal, TLS for service-to-service traffic too (or mTLS through a mesh), and `Encrypt=True` for SQL.

## SSRF and outbound calls {a}

**Server-Side Request Forgery (SSRF)**: any feature where your *server* fetches a URL the *user* supplied (webhooks, "import from URL", image proxies, PDF renderers) can be tricked into fetching a URL it was never meant to reach. The attacker just needs to supply an internal address instead of a normal one — for example the **cloud metadata endpoint** (`169.254.169.254`), a special local address cloud VMs expose so code can ask "who am I" and get back managed-identity tokens. If an attacker can make your server request that address on their behalf, they get those tokens too — which is exactly the thing [Identity & secrets](ch:azure-identity-secrets#managed-identities-the-mechanism-that-makes-no-secret-actual) relied on to avoid storing secrets in the first place.

Defences: allow-list domains and schemes; resolve DNS and **block private, link-local and loopback ranges** (and re-check after redirects, or disable automatic redirects); run fetchers in an isolated network segment with egress restrictions; enforce timeouts and size limits; and never return raw fetched content or errors to the user.

## Mass assignment, over-posting and data exposure {i}

```csharp
// ✘ Binding the entity: a client can send {"isAdmin": true, "balance": 1000000}
app.MapPut("/users/{id}", async (int id, User input, ShopDb db) => { db.Update(input); await db.SaveChangesAsync(); });

// ✔ Request DTO with only the allowed fields, mapped explicitly; response DTO with only the safe fields
public sealed record UpdateProfileRequest(string DisplayName, string? Bio);
public sealed record ProfileResponse(Guid Id, string DisplayName, string? Bio);     // no PasswordHash, no Email of others, no internal flags
```

This is exactly the over-posting trap from [Building APIs](ch:building-apis#parameter-binding-how-request-data-becomes-a-c-argument), repeated here because it's common enough to earn a dedicated OWASP API category of its own. Also avoid **excessive data exposure**: returning full entities and relying on the front end to hide fields. The API response *is* what an attacker sees — a front end hiding a field in its UI does nothing to stop someone reading the raw network response.

## Resource consumption and DoS protection {i}

- **Rate limiting** per user/IP/API key, with stricter limits on expensive and auth endpoints ([Caching, rate limiting & CORS](ch:caching-ratelimit-cors#rate-limiting-protecting-the-api-from-its-own-popularity)), plus WAF/Front Door/APIM limits at the edge.
- **Request limits:** Kestrel `MaxRequestBodySize`, form/multipart limits, header size and timeouts, `[RequestSizeLimit]`.
- **Pagination caps** (max page size), query complexity limits (GraphQL depth and cost), timeouts on every outbound call and query.
- **Regex DoS (ReDoS):** use `RegexOptions.NonBacktracking` or timeouts for patterns over user input; `[GeneratedRegex]` with a match timeout.
- **JSON limits:** `MaxDepth`; avoid deserializing huge payloads into memory.

## Secure file uploads {a}

```csharp
app.MapPost("/documents", async (IFormFile file, IBlobStore store, CancellationToken ct) =>
{
    if (file.Length is 0 or > 10 * 1024 * 1024) return Results.BadRequest("File must be 1 byte–10 MB");
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (ext is not (".pdf" or ".png" or ".jpg")) return Results.BadRequest("Unsupported type");
    await using var s = file.OpenReadStream();
    if (!await FileSignatures.MatchesAsync(s, ext, ct)) return Results.BadRequest("Content doesn't match extension");   // magic bytes
    var safeName = $"{Guid.NewGuid():N}{ext}";                                  // never use the client's file name as a path
    await store.UploadAsync($"quarantine/{safeName}", s, ct);                    // scan (Defender for Storage malware scanning) before use
    return Results.Accepted();
}).RequireAuthorization().DisableAntiforgery();
```

Notice the comment on `FileSignatures.MatchesAsync`: checking the file **extension** alone is trivially bypassed by renaming a malicious file, which is exactly why this checks the actual byte signature ("magic bytes") inside the file content too — a `.png` extension on a file that doesn't start with PNG's real magic bytes is a clear sign something's wrong, regardless of what the client claimed. Store uploads **outside the web root** (Blob Storage), never execute them, serve them with `Content-Disposition: attachment` from a separate domain if they're user-visible, and scan them for malware.

## Supply chain and dependencies {i}

- **NuGet audit** on restore (warnings on known CVEs, fail CI on high severity), `dotnet list package --vulnerable --include-transitive`, Dependabot/Renovate PRs.
- **Package source mapping** and private feeds (prevents dependency confusion), lock files, **Central Package Management** for consistent versions ([Projects & NuGet](ch:projects-sdk-nuget#package-hygiene)).
- **Container images:** minimal or chiseled base images, regular rebuilds, scanning (Trivy, Defender for Containers), signing, SBOMs — the exact security practices [Docker](ch:docker#image-size-startup-and-security) detailed.
- **CI/CD:** least-privilege workflow tokens, OIDC instead of stored secrets, pin third-party actions by SHA, protected branches and environments, secret scanning with push protection.
- **Unsafe APIs:** `BinaryFormatter` is removed (.NET 9); avoid `TypeNameHandling.All` in Newtonsoft.Json (deserialization gadget attacks); validate XML with DTD processing disabled (XXE; .NET's defaults are safe).

## Logging and monitoring securely {i}

Log **security events** (authentication failures, access denials, privilege changes, rate-limit hits, validation anomalies) with user and correlation IDs, and alert on spikes. **Never log** passwords, tokens, API keys, full card numbers or sensitive personal data; use redaction (`Microsoft.Extensions.Compliance.Redaction`) — exactly the "what not to log" table from [Errors & logging](ch:errors-logging#what-to-log-and-what-never-to-log), now framed as a security control rather than just a logging hygiene tip. Protect log stores with RBAC and retention policies. Use **Microsoft Defender for Cloud** for posture management and threat detection across App Service, SQL, Storage, Key Vault and containers.

:::qa What is the most common web/API vulnerability and how do you prevent it in ASP.NET Core?
Broken access control (IDOR/BOLA): endpoints that trust client-supplied IDs or lack function-level checks. Prevent it by requiring authorization by default (fallback policy), applying policies to every endpoint, using resource-based authorization or scoping every query by the current user or tenant, returning 404 for inaccessible resources, and testing authorization in integration tests.
:::

:::qa How do you prevent SQL injection in .NET?
Never concatenate input into SQL. Use EF Core LINQ, FromSql/ExecuteSql with interpolated FormattableString (converted to parameters), Dapper parameter objects, or ADO.NET parameters. Allow-list dynamic identifiers like sort columns, and run with a least-privilege database identity.
:::

:::qa What is CSRF and when does it apply?
Cross-Site Request Forgery tricks a logged-in user's browser into sending a state-changing request to your site with their cookies attached automatically. It applies to cookie-authenticated apps; bearer-token APIs aren't vulnerable because browsers don't attach Authorization headers automatically. Defend with antiforgery tokens, SameSite cookies and Origin checks.
:::

:::qa How should passwords be stored?
Hashed with a slow, salted, adaptive algorithm (PBKDF2 as in ASP.NET Core Identity's PasswordHasher, Argon2id, bcrypt or scrypt), with a per-user salt and a high work factor, re-hashing when parameters improve. Never plain text, encrypted, or fast hashes like SHA-256. Better yet, delegate authentication to an identity provider.
:::

:::qa What is the ASP.NET Core Data Protection API?
A built-in cryptographic API for protecting data your app needs to read back (auth cookies, antiforgery tokens, temp data, custom tokens) with authenticated encryption, purpose strings for isolation, and automatic key rotation. In multi-instance deployments, the key ring must be persisted to shared storage and protected (e.g. Blob Storage plus Key Vault).
:::

:::qa What is SSRF and how do you prevent it?
Server-Side Request Forgery: an attacker makes your server send requests to URLs of their choosing, reaching internal services or cloud metadata endpoints. Prevent it with allow-lists of destinations, blocking private/link-local/metadata IP ranges after DNS resolution (and on redirects), network egress restrictions, timeouts and size limits.
:::

:::qa What is mass assignment / over-posting?
When model binding sets properties the client shouldn't control (IsAdmin, Price) because the request is bound directly to an entity. Prevent it with dedicated request DTOs and explicit mapping, and use response DTOs to avoid excessive data exposure.
:::

:::qa Which security headers would you add to an ASP.NET Core app?
Strict-Transport-Security (UseHsts), X-Content-Type-Options: nosniff, X-Frame-Options: DENY or CSP frame-ancestors, Content-Security-Policy, Referrer-Policy and Permissions-Policy, plus removing the Server header and enforcing HTTPS redirection.
:::

:::qa How do you keep dependencies secure?
NuGet vulnerability auditing in restore and CI, automated update PRs (Dependabot/Renovate), Central Package Management with lock files and package source mapping, regular .NET runtime/SDK patching, minimal container base images that are scanned and rebuilt often, and avoiding dangerous serializers like BinaryFormatter or TypeNameHandling.All.
:::

## Further reading

- [ASP.NET Core security overview](https://learn.microsoft.com/en-us/aspnet/core/security/)
- [OWASP Top 10](https://owasp.org/Top10/) · [OWASP API Security Top 10](https://owasp.org/API-Security/) · [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) (start with the .NET Security cheat sheet)
- [Prevent CSRF attacks in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery)
- [Data Protection in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction)
- [Microsoft Defender for Cloud](https://learn.microsoft.com/en-us/azure/defender-for-cloud/)

## Verify this chapter

Run with `dotnet run` (a plain console app, .NET 8/9, only base-class-library crypto and regex APIs — no extra packages). It checks injection, password hashing, constant-time comparison, secure random tokens, file-signature validation and ReDoS mitigation directly. Things that need a live HTTP pipeline or browser to observe (CSRF cookie behavior, CSP/HSTS enforcement, SSRF against a real metadata endpoint) are left to the Further reading links instead of faked here.

```csharp
// Verify this chapter: run with `dotnet run`. No external packages needed
// (uses only System.Security.Cryptography and System.Text.RegularExpressions
// from the base class library -- the same primitives the chapter names).
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

void Check(string name, bool ok)
{
    if (!ok) throw new Exception($"FAIL: {name}");
    Console.WriteLine($"OK: {name}");
}

// 1. Injection: string concatenation lets attacker-controlled input change the
// shape of the query; a parameterized call never merges the value into the
// command text at all, so it has nothing to "escape out of".
string email = "x' OR '1'='1";
string concatenatedSql = "SELECT * FROM Users WHERE Email = '" + email + "'";
Check("concatenation lets the payload's quote characters reach the SQL text (the injection)",
    concatenatedSql.Contains("OR '1'='1"));

var parameterizedCommandText = "SELECT * FROM Users WHERE Email = @email";
var parameters = new System.Collections.Generic.Dictionary<string, object> { ["@email"] = email };
Check("a parameterized command's TEXT never contains the value at all -- the payload has nowhere to break out to",
    !parameterizedCommandText.Contains("OR") && parameters["@email"].Equals(email));

// 2. Password storage: PBKDF2 (Rfc2898DeriveBytes) with different salts
// produces different hashes for the SAME password, and verification means
// re-deriving with the STORED salt and comparing, not re-hashing blindly.
byte[] Pbkdf2(string password, byte[] salt, int iterations = 100_000) =>
    Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA512, 32);

var salt1 = RandomNumberGenerator.GetBytes(16);
var salt2 = RandomNumberGenerator.GetBytes(16);
var hashA = Pbkdf2("Tr0ub4dor&3", salt1);
var hashB = Pbkdf2("Tr0ub4dor&3", salt2);
Check("the same password hashed with two different salts produces two different hashes",
    !hashA.AsSpan().SequenceEqual(hashB));
var verifyAttempt = Pbkdf2("Tr0ub4dor&3", salt1);
Check("re-deriving with the ORIGINAL salt reproduces the original hash (this is how verification works)",
    hashA.AsSpan().SequenceEqual(verifyAttempt));
var wrongPassword = Pbkdf2("wrong-password", salt1);
Check("a wrong password with the same salt produces a different hash (login correctly rejected)",
    !hashA.AsSpan().SequenceEqual(wrongPassword));

// 3. Comparing secrets: CryptographicOperations.FixedTimeEquals exists
// specifically to avoid the timing side-channel a plain == comparison has.
Check("FixedTimeEquals returns true for identical byte sequences",
    CryptographicOperations.FixedTimeEquals(hashA, verifyAttempt));
Check("FixedTimeEquals returns false for different byte sequences",
    !CryptographicOperations.FixedTimeEquals(hashA, hashB));

// 4. Random tokens: RandomNumberGenerator.GetBytes is the recommended source
// for secrets (unlike System.Random, which is predictable, not CSPRNG).
var token1 = RandomNumberGenerator.GetBytes(32);
var token2 = RandomNumberGenerator.GetBytes(32);
Check("two calls to RandomNumberGenerator.GetBytes(32) produce different tokens",
    !token1.AsSpan().SequenceEqual(token2));

// 5. Secure file uploads: checking the file extension alone is not enough --
// the content's actual "magic bytes" must match. PNG files start with a
// fixed 8-byte signature; a renamed .txt file won't have it.
bool LooksLikePng(byte[] content) =>
    content.Length >= 8 &&
    content[0] == 0x89 && content[1] == 0x50 && content[2] == 0x4E && content[3] == 0x47 &&
    content[4] == 0x0D && content[5] == 0x0A && content[6] == 0x1A && content[7] == 0x0A;

byte[] realPngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
byte[] renamedTextFile = Encoding.ASCII.GetBytes("just plain text pretending to be a .png");
Check("real PNG bytes pass the magic-byte signature check", LooksLikePng(realPngBytes));
Check("a .txt file renamed to .png fails the signature check even though the extension looks fine",
    !LooksLikePng(renamedTextFile));

// 6. ReDoS: a classic catastrophic-backtracking pattern against a crafted
// input can take exponential time with a default Regex. Setting a Timeout
// makes it fail fast (RegexMatchTimeoutException) instead of hanging the
// thread -- exactly the defence the chapter recommends.
var evilPattern = new Regex(@"^(a+)+$", RegexOptions.None, TimeSpan.FromMilliseconds(200));
string pathologicalInput = new string('a', 40) + "!"; // one trailing char that forces full backtracking
bool timedOut = false;
try { evilPattern.IsMatch(pathologicalInput); }
catch (RegexMatchTimeoutException) { timedOut = true; }
Check("a catastrophic-backtracking regex with a Timeout throws RegexMatchTimeoutException instead of hanging",
    timedOut);

var safePattern = new Regex(@"^a+$", RegexOptions.NonBacktracking);
Check("the same kind of input matches instantly with RegexOptions.NonBacktracking (no exponential blowup)",
    safePattern.IsMatch(new string('a', 40)));

// Not runtime-verifiable here (need a live HTTP pipeline, browser or network
// to observe for real): CSRF cookie behavior, CSP/HSTS header enforcement by
// a browser, SSRF against cloud metadata endpoints, and ASP.NET Core's
// resource-based authorization middleware -- see Further reading: ASP.NET
// Core security overview and the OWASP Cheat Sheet Series.

Console.WriteLine("All checks passed.");
```
