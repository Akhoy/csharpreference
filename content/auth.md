---
id: auth
title: Authentication and Authorization
summary: Who you are vs what you may do. Claims and ClaimsPrincipal, authentication schemes and handlers, cookies vs JWT bearer tokens, how JWTs are validated, ASP.NET Core Identity, authorization with roles, claims, policies, requirements and handlers, resource-based authorization, API keys, and multiple schemes.
layer: framework
where: ASP.NET Core › Request pipeline › Authentication & authorization
fits: Auth is two middleware in the pipeline ([Middleware](ch:middleware)) that read endpoint metadata selected by routing ([Routing](ch:routing)). The *tokens* usually come from an external identity provider through OAuth 2.0/OIDC ([OAuth & OIDC](ch:oauth-oidc-identity)), and protecting against attacks is in [Web security](ch:web-security). In the cloud, Microsoft Entra ID is the usual provider ([Identity & secrets](ch:azure-identity-secrets)).
levels: b,i,a
prereqs: middleware, routing
next: oauth-oidc-identity, web-security
---

## TL;DR

- **Authentication** = who you are (produces a `ClaimsPrincipal`); **authorization** = what you're allowed to do. Mixing these up is the root of most auth bugs.
- A user is a bag of **claims** (key/value facts), not a username string. A **role** is just a claim named `role` — nothing more special than any other claim.
- **Cookies** suit browser apps (auto-sent, easy to revoke, needs CSRF defense); **JWTs** suit APIs/SPAs/mobile (stateless, hard to revoke, so keep them short-lived). For SPAs today, the **BFF pattern** gets the best of both.
- A JWT is validated with the issuer's **public key** (no database call per request) by checking the signature, issuer, audience, and expiry.
- **Policies** name a reusable authorization rule once, instead of scattering role checks everywhere. **Resource-based authorization** handles rules that depend on which specific row ("your own orders only").
- ASP.NET Core Identity is a user-storage library, not an OAuth server — for real single sign-on, use an identity provider like Entra ID.

## Two questions that get conflated constantly, and shouldn't be {b}

"The user isn't authorized" is one of those phrases that papers over two genuinely different failures. Before anything else in this chapter, pin these apart, because every bug and every design decision that follows traces back to keeping them separate:

| | Authentication (AuthN) | Authorization (AuthZ) |
|---|---|---|
| Question | **Who are you?** | **Are you allowed to do this?** |
| Input | Cookie, bearer token, API key, client certificate | The authenticated user + the resource + the action |
| Output | A `ClaimsPrincipal` in `HttpContext.User` | Allow, or deny |
| Failure | **401 Unauthorized** (really "unauthenticated"), via a **challenge** | **403 Forbidden**, via **forbid** |
| Middleware | `UseAuthentication()` | `UseAuthorization()` |

```text
request ─▶ UseRouting ─▶ UseAuthentication ─▶ UseAuthorization ─▶ endpoint
                          reads cookie/JWT       reads endpoint's [Authorize]/policy
                          sets HttpContext.User  evaluates against User → 401/403 or continue
```

:::analogy The airport
Showing your **passport** at check-in is authentication: it proves who you are. Your **boarding pass** for gate 12 is authorization: it decides what you may do. A valid passport doesn't let you board any plane you like — and the two checkpoints are run by entirely different people, for entirely different reasons.
:::

## Claims, identities and principals: the vocabulary everything else builds on {b}

ASP.NET Core doesn't represent a logged-in user as a username string or a database row reference — it represents them as a bundle of **claims**: individual key/value statements about the user, each one issued by someone the app trusts.

```text
ClaimsPrincipal (HttpContext.User)                 ← the user
 └── ClaimsIdentity  (AuthenticationType = "Bearer") ← one identity per scheme (usually one)
      ├── Claim  sub        = "7f3c…"                  (subject: unique user id)
      ├── Claim  email      = "ana@shop.com"
      ├── Claim  name       = "Ana"
      ├── Claim  role       = "admin"
      ├── Claim  scope      = "orders.read orders.write"
      └── Claim  tenant_id  = "acme"
```

```csharp
app.MapGet("/me", (ClaimsPrincipal user) => new
{
    Id = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub"),
    Email = user.FindFirstValue(ClaimTypes.Email),
    IsAdmin = user.IsInRole("admin"),
    Authenticated = user.Identity?.IsAuthenticated
}).RequireAuthorization();
```

Here's why this indirection is worth the extra concept: a **role** is just a claim whose type happens to be `role` — there's nothing structurally special about it. Because identity is a flat bag of claims rather than a fixed schema, ASP.NET Core doesn't actually care whether those claims came from a cookie you issued, a JWT from Entra ID, or an API key you validated yourself. Whatever produced them, by the time your code runs, they all look like the same `ClaimsPrincipal` — which is precisely what lets the rest of this chapter work identically regardless of which identity provider sits behind it.

## Authentication schemes and handlers: naming the thing that does the checking {i}

A **scheme** is a named authentication handler plus its configuration. You register one or more, and declare which one is the default:

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)   // default scheme "Bearer"
    .AddJwtBearer(...)                                                        // APIs
    .AddCookie(...)                                                           // browser apps
    .AddOpenIdConnect(...)                                                    // sign-in via an external IdP
    .AddScheme<ApiKeyOptions, ApiKeyHandler>("ApiKey", null);                 // custom
```

Every handler, regardless of scheme, implements up to five distinct actions — and seeing them side by side explains why "login" means something so different for a cookie app versus an API:

| Action | Meaning | Example |
|---|---|---|
| **Authenticate** | Build a principal from the request | Validate the JWT in the `Authorization` header |
| **Challenge** | Respond when an unauthenticated user hits a protected resource | JWT: `401` + `WWW-Authenticate: Bearer`; Cookie: redirect to login; OIDC: redirect to the IdP |
| **Forbid** | Respond when an authenticated user isn't allowed | `403`; Cookie: redirect to access-denied |
| **SignIn** | Persist the identity | Cookie: issue the auth cookie |
| **SignOut** | Remove it | Cookie: delete it |

## Cookies vs bearer tokens: the tradeoff behind "how do I stay logged in?" {b}

| | Cookie authentication | JWT bearer tokens |
|---|---|---|
| Typical client | Server-rendered web apps, BFF for SPAs | APIs called by SPAs, mobile apps, other services |
| How it's sent | Browser sends the cookie **automatically** | Client adds `Authorization: Bearer <token>` **explicitly** |
| State | Encrypted auth ticket in the cookie (or session store) | Self-contained signed token |
| Issued by | Your app (after login) | An identity provider / token service |
| CSRF risk | **Yes** (auto-sent): needs SameSite plus antiforgery | No (not auto-sent by browsers) |
| XSS risk | `HttpOnly` cookie can't be read by JS | Token in JS memory or localStorage **can** be stolen by XSS |
| Revocation | Easy: invalidate server-side or change the security stamp | Hard: valid until expiry; keep lifetimes short |

Notice the two risk rows trade places: cookies are vulnerable to CSRF precisely *because* the browser sends them automatically — which is the same property that makes them convenient — while JWTs dodge CSRF but expose themselves to a different attacker if your app has an XSS hole anywhere, since JavaScript has to be able to read the token to attach it. Current guidance for **browser SPAs** sidesteps the dilemma rather than picking a side: the **BFF (Backend-for-Frontend)** pattern has a small server-side app handle the OIDC flow and keep tokens entirely server-side, so the browser only ever holds a secure `HttpOnly` `SameSite` cookie — getting the cookie's XSS resistance without reintroducing the JWT's revocation problem. See [OAuth & OIDC](ch:oauth-oidc-identity).

## JWT bearer authentication, traced claim by claim {i}

A **JWT** (JSON Web Token) is just three base64url-encoded parts joined with dots: `header.payload.signature`.

```text
eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9 . eyJzdWIiOiI3ZjNjIiwiYXVkIjoiYXBpOi8vc2hvcCIsImV4cCI6MTc2… . MEUCIQD…
 header: {"alg":"RS256","kid":"123"}      payload (claims):                                            signature
                                          { "iss": "https://login.microsoftonline.com/<tenant>/v2.0",
                                            "sub": "7f3c…", "aud": "api://shop-api",
                                            "exp": 1767225600, "nbf": 1767222000, "iat": 1767222000,
                                            "scp": "orders.read", "roles": ["admin"] }
```

| Claim | Meaning |
|---|---|
| `iss` | Issuer: who created the token |
| `sub` | Subject: the user (or client) ID |
| `aud` | Audience: which API the token is **for** |
| `exp` / `nbf` / `iat` | Expires / not before / issued at (Unix seconds) |
| `scp` / `scope` | Delegated permissions (OAuth scopes) |
| `roles` | App roles |
| `azp` / `client_id` | Which client app requested it |

Here's the question worth sitting with: how does an API validate this token's authenticity without calling back to whoever issued it, for every single request? The answer is asymmetric cryptography, and it's worth walking through the five steps in order, because each one depends on the last:

1. Parse the header and read the key ID (`kid`) — which specific key was used to sign this token.
2. Fetch the issuer's **public signing keys** from its OIDC discovery document (`{authority}/.well-known/openid-configuration` → `jwks_uri`) — cached after the first lookup and refreshed periodically, not fetched on every request.
3. **Verify the signature** using that public key (RS256/ES256). Because only the issuer holds the matching *private* key, a valid signature proves both that the token came from them and that nobody tampered with the payload in transit.
4. Check **`iss`** matches the expected issuer, **`aud`** matches this specific API (not some other API the same provider also issues tokens for), and **`exp`/`nbf`** against the current clock, with a small allowance for clock drift (5 minutes by default).
5. Build the `ClaimsPrincipal` straight from the payload's claims.

![Five-step JWT validation: parse the header, fetch signing keys, verify the signature, check the issuer/audience/expiry claims, then build the ClaimsPrincipal](visuals/jwt-validation.svg)

Follow what this buys you: steps 1 and 3 together mean the API never needs its own database of valid tokens — the cryptographic signature *is* the proof, which is exactly why this scales to millions of requests without a database round trip on each one.

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = "https://login.microsoftonline.com/<tenant-id>/v2.0";   // discovery + signing keys
        o.Audience = "api://shop-api";
        o.MapInboundClaims = false;            // keep "sub", "roles" as-is instead of long ClaimTypes URIs
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            RoleClaimType = "roles", NameClaimType = "name"
        };
    });
// For Entra ID specifically, Microsoft.Identity.Web wraps this: .AddMicrosoftIdentityWebApi(builder.Configuration)
```

:::gotcha JWTs are signed, not encrypted
Anyone can base64-decode the payload — try pasting any JWT into jwt.io and watch the claims appear in plain text. **Never put secrets or sensitive personal data in a JWT.** The signature only guarantees the payload hasn't been altered and genuinely came from the stated issuer; it does nothing to hide the payload's contents from anyone who intercepts it.
:::

:::gotcha Don't roll your own token service with a shared secret
Issuing `HS256` tokens signed with a symmetric key sitting in `appsettings.json` works fine in a tutorial, and that's exactly the problem — every API that needs to *validate* tokens then holds a key that can also *mint* them, which means any one compromised service can forge tokens for every other service in the system. Use an identity provider (Entra ID, Auth0, Okta, Keycloak, Duende IdentityServer) built on asymmetric keys instead, where validating and minting require different keys entirely. The built-in ASP.NET Core Identity API endpoints issue opaque bearer tokens, which is a reasonable fit for simple first-party scenarios only.
:::

### Token lifetimes and refresh

Access tokens are deliberately short-lived (5–60 minutes), and the reason traces straight back to the validation steps above: nothing in that process checks a revocation list, so a stolen token stays valid until it naturally expires. Clients compensate with a **refresh token** — long-lived, stored securely, rotated on use — which lets them request a fresh access token without forcing the user to log in again. The real revocation strategies available are: keep access-token lifetimes short in the first place, revoke the refresh token at the identity provider when something's wrong, and for genuinely high-risk APIs, pay the cost of token introspection or a deny list on every request.

## Cookie authentication {i}

```csharp
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.LoginPath = "/login";
        o.AccessDeniedPath = "/denied";
        o.ExpireTimeSpan = TimeSpan.FromHours(8);
        o.SlidingExpiration = true;
        o.Cookie.HttpOnly = true;                              // JS can't read it
        o.Cookie.SecurePolicy = CookieSecurePolicy.Always;     // HTTPS only
        o.Cookie.SameSite = SameSiteMode.Lax;                  // CSRF mitigation
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; }; // for API calls
    });

app.MapPost("/login", async (LoginRequest req, IUserService users, HttpContext ctx) =>
{
    var user = await users.ValidateAsync(req.Email, req.Password);
    if (user is null) return Results.Unauthorized();
    var identity = new ClaimsIdentity([new(ClaimTypes.NameIdentifier, user.Id), new(ClaimTypes.Role, user.Role)],
                                      CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(new ClaimsPrincipal(identity));      // issues the encrypted cookie
    return Results.NoContent();
});
```

The cookie's contents are encrypted and signed with the **Data Protection** API. That causes a surprise the first time an app scales out to more than one instance: by default, each instance generates its own encryption keys. A cookie issued by instance A then becomes unreadable gibberish to instance B — so a user gets silently logged out the moment the load balancer happens to route them somewhere new. The fix is to share those keys across every instance (persist them to Blob Storage, Redis, or a database, itself protected with Key Vault).

## ASP.NET Core Identity: a membership system, not an OAuth server {i}

**ASP.NET Core Identity** handles the mechanics of *having* users at all: password hashing (PBKDF2), account lockout, two-factor authentication, email confirmation, external logins, roles — all persisted through EF Core. The distinction worth being precise about: it is **not** an OAuth/OIDC authorization server by itself; it manages your own user table, not tokens issued to third-party clients.

```csharp
builder.Services.AddDbContext<AppIdentityDb>(o => o.UseSqlServer(cs));
builder.Services.AddIdentityApiEndpoints<AppUser>().AddEntityFrameworkStores<AppIdentityDb>();
builder.Services.AddAuthorization();

app.MapIdentityApi<AppUser>();   // .NET 8: /register, /login, /refresh, /confirmEmail, /manage/2fa …
```

| Need | Use |
|---|---|
| Users log in to *your* app with a password, simple first-party | ASP.NET Core Identity |
| Single sign-on across many apps, third-party clients, OAuth flows | An identity provider: Entra ID / Entra External ID, Auth0, Okta, Keycloak, or Duende IdentityServer / OpenIddict on top of Identity |
| Enterprise employees | Microsoft Entra ID |

## Authorization: the simple forms, before anything needs a policy {b}

```csharp
app.MapGet("/orders", List).RequireAuthorization();              // any authenticated user
app.MapGet("/status", Status).AllowAnonymous();                  // explicitly public
app.MapDelete("/orders/{id}", Delete).RequireAuthorization(p => p.RequireRole("admin"));

[Authorize]                                    // controller-level: all actions require auth
public class OrdersController : ControllerBase
{
    [AllowAnonymous] public IActionResult Public() => Ok();
    [Authorize(Roles = "admin,support")] public IActionResult Refund() => Ok();   // admin OR support
}

// Secure by default: require auth everywhere unless [AllowAnonymous]
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
```

That last block is worth internalising as a default posture: it's much safer to make every endpoint require authentication **unless explicitly opted out** with `[AllowAnonymous]`, than to make every endpoint public unless someone remembered to add `[Authorize]`. The first mistake is a locked-down endpoint that's annoying to fix; the second is a silent data leak.

## Policy-based authorization: centralising rules instead of scattering role strings {i}

A **policy** is a named bundle of **requirements**, and a policy only passes if every one of its requirements does. The payoff for the extra indirection is real: once a rule is named `"CanRefund"`, you write it once, and every endpoint that needs it refers to the name — nobody has to remember or copy the actual logic.

```csharp
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("CanReadOrders",  p => p.RequireClaim("scp", "orders.read", "orders.write"))   // any of these values
    .AddPolicy("CanRefund",      p => p.RequireRole("support").RequireClaim("refund_limit"))
    .AddPolicy("EmployeesOnly",  p => p.RequireAssertion(ctx => ctx.User.HasClaim(c => c.Type == "email" && c.Value.EndsWith("@shop.com"))))
    .AddPolicy("Over18",         p => p.AddRequirements(new MinimumAgeRequirement(18)));

orders.MapPost("/{id}/refund", Refund).RequireAuthorization("CanRefund");
```

### Custom requirements and handlers

When the built-in requirement helpers (`RequireRole`, `RequireClaim`, `RequireAssertion`) can't express a rule, write your own:

```csharp
public sealed record MinimumAgeRequirement(int Age) : IAuthorizationRequirement;

public sealed class MinimumAgeHandler(TimeProvider clock) : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, MinimumAgeRequirement req)
    {
        if (DateTime.TryParse(ctx.User.FindFirstValue("birthdate"), out var dob)
            && dob.AddYears(req.Age) <= clock.GetUtcNow().DateTime)
            ctx.Succeed(req);                 // don't call Fail() unless you want to veto other handlers
        return Task.CompletedTask;
    }
}
builder.Services.AddSingleton<IAuthorizationHandler, MinimumAgeHandler>();
```

The comment on `Succeed` matters: a requirement passes if **any** registered handler for it calls `Succeed` — several handlers can each independently vote yes. But if even one handler calls `Fail`, that overrides every yes-vote and vetoes the requirement outright. Handlers are ordinary scoped services, so they can query the database like anything else.

## Resource-based authorization: when the rule depends on which specific row {a}

Policies above answer yes/no questions that don't depend on *which* resource you're looking at. Plenty of real rules do: "a customer can view **their own** orders," "an editor can edit documents **in their department**." Since the rule can't be evaluated until you know which row is involved, the endpoint has to load the resource first, then ask the authorization service imperatively:

```csharp
public sealed class OrderOwnerHandler : AuthorizationHandler<OperationAuthorizationRequirement, Order>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, OperationAuthorizationRequirement op, Order order)
    {
        var userId = ctx.User.FindFirstValue("sub");
        if (order.CustomerId == userId || ctx.User.IsInRole("support")) ctx.Succeed(op);
        return Task.CompletedTask;
    }
}

app.MapGet("/orders/{id:int}", async (int id, ShopDb db, ClaimsPrincipal user, IAuthorizationService authz) =>
{
    var order = await db.Orders.FindAsync(id);
    if (order is null) return Results.NotFound();
    var result = await authz.AuthorizeAsync(user, order, new OperationAuthorizationRequirement { Name = "Read" });
    return result.Succeeded ? Results.Ok(order.ToDto()) : Results.NotFound();   // 404 hides existence (prevents enumeration)
}).RequireAuthorization();
```

Look closely at that last line's comment: returning **404**, not 403, when authorization fails is a deliberate choice, not an inconsistency. If a competitor's order ID returned 403, that confirms to an attacker the order exists at all — a small leak, but a real one. Returning the same 404 whether the order doesn't exist or simply isn't theirs closes that gap. This whole pattern is the standard defence against **IDOR** (insecure direct object reference), consistently one of the most common real-world API vulnerabilities — see [Web security](ch:web-security) for the fuller picture.

## API keys, client certificates and multiple schemes {a}

```csharp
public sealed class ApiKeyHandler(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e, IApiKeyStore keys)
    : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Api-Key", out var key)) return AuthenticateResult.NoResult();
        var client = await keys.FindAsync(key!);                         // compare HASHED keys, constant-time
        if (client is null) return AuthenticateResult.Fail("Invalid API key");
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new("client_id", client.Id)], Scheme.Name));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name));
    }
}

// Accept either JWT or API key on some endpoints
builder.Services.AddAuthorizationBuilder().AddPolicy("PartnerAccess", p => p
    .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme, "ApiKey")
    .RequireAuthenticatedUser());
```

Notice that this custom handler slots into the exact same five-action model (Authenticate/Challenge/Forbid/SignIn/SignOut) described earlier for cookies and JWTs — it's a different mechanism for proving identity, but the framework treats it identically once it's registered. Other options worth knowing by name: **mTLS / client certificates** (`AddCertificate`) for service-to-service calls; **managed identity** tokens for Azure-to-Azure calls, covered in [Identity & secrets](ch:azure-identity-secrets); and a **policy scheme** (`AddPolicyScheme` with `ForwardDefaultSelector`) for picking which underlying scheme to use dynamically, per request.

## Claims transformation and permissions {a}

Tokens typically carry coarse-grained data — a user ID, maybe a couple of roles — because the identity provider that issued them has no idea about your app's fine-grained permission model. **Claims transformation** is the hook for enriching the principal, per request, with exactly that app-specific detail:

```csharp
public sealed class PermissionClaims(IPermissionStore store) : IClaimsTransformation
{
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal p)
    {
        if (p.Identity is not ClaimsIdentity { IsAuthenticated: true } id || id.HasClaim(c => c.Type == "perm")) return p;
        foreach (var perm in await store.GetAsync(p.FindFirstValue("sub")!)) id.AddClaim(new("perm", perm));
        return p;
    }
}
builder.Services.AddScoped<IClaimsTransformation, PermissionClaims>();
```

Worth flagging plainly: this runs on **every** authenticate call, for every request, so whatever `store.GetAsync` does needs to be cheap or cached — otherwise you've quietly added a database round trip to every single authenticated request in the app.

:::qa What's the difference between authentication and authorization?
Authentication establishes who the caller is: it validates credentials (cookie, JWT, API key) and produces a ClaimsPrincipal in HttpContext.User. Authorization decides whether that principal may perform an action on a resource, using roles, claims, policies or resource-based checks. Failure gives 401 for authentication and 403 for authorization.
:::

:::qa How does an ASP.NET Core API validate a JWT?
The JwtBearer handler reads the token from the Authorization header, gets the issuer's public signing keys from the OIDC discovery document (cached), verifies the signature, validates issuer, audience and lifetime (exp/nbf with clock skew), then builds a ClaimsPrincipal from the claims. No call to the identity provider per request.
:::

:::qa Cookies vs JWTs: when would you use each?
Cookies for browser-based apps and BFFs: sent automatically, HttpOnly protects against XSS theft, they need CSRF protection, and they're easy to revoke. JWT bearer tokens for APIs consumed by SPAs, mobile apps and services: stateless and cross-domain, but hard to revoke, so keep them short-lived. For SPAs, the BFF pattern with cookies is now recommended.
:::

:::qa What is in a JWT and is it secure to put data in it?
A header (algorithm, key ID), a payload of claims (iss, sub, aud, exp, roles, scopes…) and a signature, all base64url encoded. It's signed, not encrypted, so anyone can read the payload. Don't put secrets or sensitive data in it.
:::

:::qa Roles vs claims vs policies?
Claims are facts about the user; a role is one kind of claim. Policies are named authorization rules made of requirements that can check roles, claims or custom logic, keeping rules centralised and testable instead of scattering role strings across controllers.
:::

:::qa How do you implement 'users can only access their own orders'?
Resource-based authorization: load the order, then call IAuthorizationService.AuthorizeAsync(user, order, requirement) with an AuthorizationHandler&lt;TRequirement, Order&gt; that checks ownership. Or always scope queries by the current user ID. Return 404 rather than 403 to avoid revealing the resource exists. This prevents IDOR.
:::

:::qa How do you require authentication on every endpoint by default?
Set a fallback policy: `AddAuthorizationBuilder().SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())`, then mark public endpoints with AllowAnonymous.
:::

:::qa What is ASP.NET Core Identity and is it an OAuth server?
A membership library for user storage, password hashing, lockout, 2FA, confirmations and external logins, persisted with EF Core. It's not an OAuth 2.0/OIDC authorization server; for that you use Entra ID/Auth0/Okta/Keycloak or build on Identity with Duende IdentityServer or OpenIddict.
:::

:::qa Why do you need to configure Data Protection when running multiple instances with cookie auth?
Auth cookies (and antiforgery tokens) are encrypted with Data Protection keys. By default each instance has its own keys, so a cookie issued by one instance can't be decrypted by another and users get logged out. Persist the key ring to shared storage (Blob, Redis, DB) protected by Key Vault.
:::

## Further reading

- [Overview of ASP.NET Core authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/)
- [Configure JWT bearer authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication)
- [Policy-based authorization](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies)
- [Resource-based authorization](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resourcebased)
- [Microsoft.Identity.Web](https://learn.microsoft.com/en-us/entra/msal/dotnet/microsoft-identity-web/)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, BCL only — no identity-provider or ASP.NET Core packages needed for these checks).

```csharp
using System.Security.Claims;
using System.Text;

// Claim: "a role is just a claim whose type happens to be 'role'" — nothing structurally special about it.
var identity = new ClaimsIdentity(
    [new Claim(ClaimTypes.NameIdentifier, "7f3c"), new Claim(ClaimTypes.Role, "admin")],
    authenticationType: "TestScheme");
var principal = new ClaimsPrincipal(identity);

if (!principal.IsInRole("admin"))
    throw new Exception("FAIL: expected IsInRole to recognise a plain Role claim");
if (!principal.HasClaim(c => c.Type == ClaimTypes.Role && c.Value == "admin"))
    throw new Exception("FAIL: expected the role to be readable as an ordinary claim too");
Console.WriteLine("OK: IsInRole(\"admin\") and reading the same thing as a plain claim agree — a role is just a claim");

// Claim: a JWT is three base64url-encoded parts joined by dots: header.payload.signature
static string Base64UrlEncode(string s) =>
    Convert.ToBase64String(Encoding.UTF8.GetBytes(s)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

var header = Base64UrlEncode("""{"alg":"RS256","kid":"123"}""");
var payload = Base64UrlEncode("""{"sub":"7f3c","aud":"api://shop-api","exp":1767225600}""");
var fakeSignature = Base64UrlEncode("not-a-real-signature");
var jwt = $"{header}.{payload}.{fakeSignature}";

var parts = jwt.Split('.');
if (parts.Length != 3)
    throw new Exception($"FAIL: expected a JWT to have 3 dot-separated parts, got {parts.Length}");
Console.WriteLine("OK: a JWT has exactly 3 base64url parts (header.payload.signature)");

// Claim: JWTs are signed, not encrypted — anyone can read the payload without the signing key.
string Base64UrlDecode(string s)
{
    var padded = s.Replace('-', '+').Replace('_', '/');
    padded += new string('=', (4 - padded.Length % 4) % 4);
    return Encoding.UTF8.GetString(Convert.FromBase64String(padded));
}
var decodedPayload = Base64UrlDecode(parts[1]);
if (!decodedPayload.Contains("\"sub\":\"7f3c\""))
    throw new Exception("FAIL: expected the payload to be readable without any key — it's signed, not encrypted");
Console.WriteLine($"OK: decoded the payload with no key at all: {decodedPayload} — confirms JWTs are signed, not encrypted");

// Claim: resource-based auth should return 404 (not 403) for "exists but not yours", to avoid confirming existence (IDOR defense).
string CheckOrderAccess(string? order, string currentUserId)
{
    if (order is null) return "404";                 // doesn't exist
    if (order != currentUserId) return "404";         // exists, but isn't theirs — SAME response as "doesn't exist"
    return "200";
}
var responseForMissing = CheckOrderAccess(null, "me");
var responseForSomeoneElses = CheckOrderAccess("someone-else", "me");
if (responseForMissing != responseForSomeoneElses)
    throw new Exception("FAIL: expected 'missing' and 'not yours' to be indistinguishable to the caller (both 404)");
Console.WriteLine("OK: a missing order and someone else's order both answer 404 — an attacker can't tell which one it was");

// Not runtime-verifiable here (needs a live identity provider / ASP.NET Core pipeline) — see Further reading:
// - Real signature verification against an issuer's JWKS, audience/issuer/expiry validation:
//   https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication
// - Policy evaluation, fallback policies, AuthorizationHandler voting (Succeed/Fail) end to end:
//   https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies
// - Data Protection key sharing across instances for cookie auth at scale:
//   https://learn.microsoft.com/en-us/aspnet/core/security/authentication/

Console.WriteLine("All checkable claims verified.");
```
