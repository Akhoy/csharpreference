---
id: oauth-oidc-identity
title: OAuth 2.0, OpenID Connect and Token-Based Identity
summary: How modern sign-in and API access really work. The problem OAuth solves, roles and tokens, the authorization code flow with PKCE step by step, client credentials, refresh tokens, the device code and on-behalf-of flows, OpenID Connect on top, scopes vs roles, access token validation, JWT vs reference tokens, the BFF pattern for SPAs, identity providers for .NET, and common mistakes.
layer: cross
where: Cross-cutting › Security › Identity protocols
fits: These protocols produce the tokens that ASP.NET Core's authentication middleware validates ([Auth](ch:auth)). In Azure, Microsoft Entra ID is the authorization server ([Identity & secrets](ch:azure-identity-secrets#protecting-your-own-apis-with-entra-id)); for service-to-service calls, managed identities use the same client-credentials ideas. The attack side is in [Web security](ch:web-security).
levels: i,a
prereqs: auth, web-security
next: system-design, azure-identity-secrets
---

## TL;DR

- **OAuth 2.0** lets an app get a limited, revocable token to act on a user's behalf, without ever seeing their password. **OpenID Connect (OIDC)** adds a standard way to learn *who* that user is (the ID token) on top of OAuth.
- Use the **authorization code flow with PKCE** for anything with a user; it never puts tokens in the browser URL, and PKCE stops a stolen authorization code from being redeemed by someone who didn't start the login.
- The **access token** is for the API; the **ID token** is for the client to learn who signed in; the **refresh token** gets new access tokens without asking the user to log in again. Don't mix up their jobs.
- An API must check the token's **signature, issuer, audience and expiry** before trusting anything in it — skipping the audience check means a token meant for a different API would be silently accepted.
- Scopes/roles say what the *client or app* is allowed to do in general; they don't prove this specific user may see this specific record — you still need resource-based authorization on top.
- For SPAs, the safest pattern is a **Backend-for-Frontend (BFF)**: a server-side component holds the real tokens and gives the browser only an HttpOnly cookie, so XSS can't steal a bearer token directly.

## The problem OAuth solves {i}

Before OAuth, if a printing app wanted your photos from a photo site, you gave it your **photo-site password**. The app then had full access to everything, forever, and the only way to revoke it was to change your password — a crude, all-or-nothing arrangement with no way to grant anything less than complete access.

**OAuth 2.0** (RFC 6749) is a framework for **delegated authorization**: an app gets a **limited, revocable token** to access specific resources **on behalf of a user** (or on its own behalf), **without ever seeing the user's password**.

**OpenID Connect (OIDC)** adds **authentication** on top of OAuth 2.0: a standard way for the app to learn **who the user is**, via an **ID token**.

:::gotcha OAuth 2.0 is not an authentication protocol
An OAuth **access token** says "the bearer may call this API with these scopes". It's meant for the **API**, not for the client to identify the user. Using access tokens as proof of login leads to vulnerabilities (token substitution). For sign-in, use **OIDC's ID token**. In practice you always use OIDC + OAuth together.
:::

## Roles {i}

| Role | Who | Example |
|---|---|---|
| **Resource owner** | The user who owns the data | Ana |
| **Client** | The application requesting access | Shop SPA, mobile app, Billing worker |
| **Authorization server** (identity provider, IdP) | Authenticates the user, gets consent, **issues tokens** | Microsoft Entra ID, Auth0, Okta, Keycloak, Duende IdentityServer |
| **Resource server** | The API that accepts access tokens | Shop API (your ASP.NET Core app) |

**Client types:** **confidential** clients can keep a secret (server-side web apps, background services) and authenticate with a client secret, certificate or federated credential. **Public** clients can't (SPAs, mobile and desktop apps: anyone can extract a secret from the binary or JavaScript), so they use **PKCE** instead.

## Tokens {i}

| Token | For | Format | Lifetime | Notes |
|---|---|---|---|---|
| **Access token** | The **API** (resource server) | Often a **JWT**; can be opaque | Short: 5–60 min | Contains `aud` (which API), `scp`/`roles`, `sub`, `exp`. Sent as `Authorization: Bearer …` |
| **ID token** (OIDC) | The **client** | Always a **JWT** | Short | Who the user is: `sub`, `name`, `email`, `nonce`, `auth_time`, `amr`. **Don't send it to APIs** |
| **Refresh token** | The **authorization server** | Opaque | Long: hours to months; often sliding and rotated | Exchanged for new access tokens without user interaction. Must be stored securely |
| Authorization code | The token endpoint (one-time) | Opaque | ~1–10 min, single use | Intermediate artefact in the code flow |

## Authorization code flow with PKCE, step by step {i}

The **recommended flow for any app with a user**: web apps, SPAs (via a BFF ideally), mobile and desktop. **PKCE** (Proof Key for Code Exchange, RFC 7636) is now required for all clients in OAuth 2.1 and current best practice.

```text
 User/Browser                 Client app                      Authorization server (Entra ID)           API
     │  1. clicks "Sign in"      │                                       │                               │
     │ ─────────────────────────▶│ 2. create code_verifier (random),      │                               │
     │                           │    code_challenge = BASE64URL(SHA256(verifier)), state, nonce          │
     │ ◀── 3. redirect to /authorize?response_type=code&client_id=…&redirect_uri=…&scope=openid profile   │
     │        api://shop/orders.read offline_access&code_challenge=…&code_challenge_method=S256&state=…   │
     │ ─────────────────────────────────────────────────────────────────▶│ 4. user logs in (MFA), consents │
     │ ◀──────────────────────────── 5. redirect to redirect_uri?code=AUTH_CODE&state=… ──────────────────│
     │ ─────────────────────────▶│ 6. verify state; POST /token                                          │
     │                           │    grant_type=authorization_code&code=…&code_verifier=…&redirect_uri=… │
     │                           │ ─────────────────────────────────────▶│ 7. checks SHA256(verifier) ==   │
     │                           │                                       │    challenge; issues tokens     │
     │                           │ ◀── { access_token, id_token, refresh_token, expires_in } ───────────── │
     │                           │ 8. validate id_token (signature, iss, aud=client_id, nonce, exp)        │
     │                           │ 9. GET /orders  Authorization: Bearer <access_token> ──────────────────▶│ 10. validate
     │                           │ ◀────────────────────────────────────────────────────────────────────── │  token, authorize
```

Follow steps 2 and 7 together, because that's where PKCE's actual protection lives: the client generates a random `code_verifier` in step 2 and only ever sends its *hash* (`code_challenge`) over the browser redirect, which anything intercepting the browser traffic can see. The raw `code_verifier` itself travels only once, directly from the client to the authorization server over the back channel in step 6 — so even if an attacker steals the authorization code from step 5 (a malicious app on the same device, a logged referrer), they still can't redeem it without the verifier they never saw. Why each other piece exists:

- **The code is exchanged on a back channel**, so tokens don't appear in browser URLs or history (unlike the deprecated **implicit flow**).
- **`state`** prevents CSRF on the redirect (ties the response to the request).
- **`nonce`** (OIDC) prevents ID token replay.
- **Exact redirect URI matching** at the server prevents tokens being sent to an attacker's URL.

```csharp
// ASP.NET Core web app (confidential client) signing users in with OIDC + cookies
builder.Services.AddAuthentication(o =>
    {
        o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
    })
    .AddCookie(o => { o.Cookie.SameSite = SameSiteMode.Lax; o.Cookie.SecurePolicy = CookieSecurePolicy.Always; })
    .AddOpenIdConnect(o =>
    {
        o.Authority = "https://login.microsoftonline.com/<tenant-id>/v2.0";
        o.ClientId = builder.Configuration["Oidc:ClientId"];
        o.ClientSecret = builder.Configuration["Oidc:ClientSecret"];     // or a certificate / federated credential
        o.ResponseType = "code";                                         // authorization code flow
        o.UsePkce = true;                                                // default true
        o.SaveTokens = true;                                             // keep access/refresh tokens in the auth session
        o.Scope.Add("api://shop-api/orders.read");
        o.Scope.Add("offline_access");                                   // ask for a refresh token
        o.MapInboundClaims = false;
        o.TokenValidationParameters.NameClaimType = "name";
    });
// For Entra ID specifically: builder.Services.AddMicrosoftIdentityWebAppAuthentication(builder.Configuration)
//   .EnableTokenAcquisitionToCallDownstreamApi(["api://shop-api/orders.read"]).AddInMemoryTokenCaches();
```

Notice this registers **both** a cookie scheme and an OIDC scheme, with the cookie as the default: once the OIDC flow completes, the app doesn't repeat the full redirect dance on every request — it issues its own cookie and relies on that, re-engaging OIDC only when the session needs to be re-established.

## Client credentials flow {i}

**Service-to-service**, no user involved: a background worker, a daemon, or one microservice calling another **as itself**.

```http
POST /oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=…&client_secret=…   (or client_assertion with a certificate/federated token)
&scope=api://inventory-api/.default
```

The token carries the **client's identity** and **application permissions** (`roles` claim, e.g. `Inventory.Read`), with no `scp` and no user. In Azure, prefer **managed identity** (no secret at all) or a **certificate/federated credential** over client secrets — the exact same preference order [Identity & secrets](ch:azure-identity-secrets#the-problem-secrets-everywhere) laid out generally, here specifically for the OAuth grant type that would otherwise need a secret.

```csharp
var credential = new ManagedIdentityCredential();     // or ClientSecretCredential/ClientCertificateCredential outside Azure
var token = await credential.GetTokenAsync(new TokenRequestContext(["api://inventory-api/.default"]), ct);
// Typically wrapped in a DelegatingHandler that caches tokens until shortly before expiry (see HttpClient chapter)
```

## Refresh tokens {i}

Access tokens are short-lived because they can't be revoked once issued (a JWT is valid until `exp`) — exactly the tradeoff [Auth](ch:auth#jwt-bearer-authentication-traced-claim-by-claim) named when it explained why access-token lifetimes stay short. Refresh tokens give a good user experience without long-lived access tokens:

```http
POST /token
grant_type=refresh_token&refresh_token=…&client_id=…&scope=…
→ { access_token (new), refresh_token (new: ROTATED), expires_in }
```

Best practices: **rotation** (each use returns a new refresh token and invalidates the old one; reuse of an old one signals theft, so the whole family is revoked), **binding** to the client (sender-constrained tokens: DPoP or mTLS), **revocation** on logout and password change, **secure storage** (server side, or the OS keychain on mobile; **never `localStorage`**), and absolute lifetimes.

## Other flows {a}

| Flow | Use | Notes |
|---|---|---|
| **Device authorization grant** (device code) | Input-constrained devices and CLIs (TV apps, `az login --use-device-code`) | The user enters a code on another device |
| **On-Behalf-Of** (OBO, token exchange RFC 8693) | An API calling a downstream API **as the user** | API A exchanges the incoming user token for a token to API B; preserves user context and permissions |
| **Implicit** | ✘ **Deprecated**: tokens returned in the URL fragment | Replaced by code + PKCE |
| **Resource Owner Password Credentials** (ROPC) | ✘ **Deprecated**: the client collects the user's password | Breaks MFA and SSO; only for legacy migration |
| **Client-initiated backchannel (CIBA)** | Decoupled authentication (e.g. a bank app approval) | Specialised |
| **Federated credentials / JWT bearer assertion** | Workload identity federation (GitHub Actions, Kubernetes) | No secrets ([Identity & secrets](ch:azure-identity-secrets#workload-identity-federation-ci-cd-and-kubernetes)) |

## OpenID Connect in more detail {a}

OIDC standardises:

- The **`openid` scope** (plus `profile`, `email`, `address`, `phone`) and **standard claims** (`sub`, `name`, `given_name`, `email`, `email_verified`…).
- The **ID token** JWT and its validation rules (`iss`, `aud` = client ID, `exp`, `iat`, `nonce`, signature).
- **Discovery**: `{authority}/.well-known/openid-configuration` publishes the endpoints (`authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `end_session_endpoint`) and **`jwks_uri`** (the public signing keys). This is how ASP.NET Core configures itself from just `Authority` — the exact discovery mechanism [Auth](ch:auth#jwt-bearer-authentication-traced-claim-by-claim) traced as step 2 of JWT validation.
- **UserInfo endpoint** for additional claims; **session management and logout** (RP-initiated logout, front- and back-channel logout).

```json
// ID token payload (decoded)
{
  "iss": "https://login.microsoftonline.com/9188…/v2.0",
  "aud": "3f2a…-client-id",
  "sub": "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
  "oid": "00000000-0000-0000-66f3-3332eca7ea81",
  "name": "Ana Silva",
  "preferred_username": "ana@contoso.com",
  "nonce": "7362CAEA-9CA5-4B43-9BA3-34D7C303EBA7",
  "iat": 1761570000, "exp": 1761573600, "auth_time": 1761569990, "amr": ["pwd", "mfa"]
}
```

## Scopes, roles and claims for APIs {a}

| Concept | Meaning | Claim | Example |
|---|---|---|---|
| **Scope** (delegated permission) | What the **client** may do **on the user's behalf**; the user consented | `scp` (Entra) / `scope` | `orders.read`, `orders.write` |
| **App role** | A role assigned to a user/group **or an application** | `roles` | `Orders.Admin` (user), `Inventory.Read` (app) |
| **Audience** | Which API the token is for | `aud` | `api://shop-api` |

The **effective permission** for delegated access is the **intersection** of what the app was granted (scopes) and what the user is allowed to do (roles or your own data rules). An API must check **both** the token's scopes or roles **and** resource-level authorization ("is this the user's order?"). Scopes alone don't prevent IDOR — a token scoped to `orders.read` proves the client is allowed to read *some* orders, not that this particular user is allowed to read *this specific* order, exactly the gap [Web security](ch:web-security#broken-access-control-and-idor) warned against closing with scope checks alone.

```csharp
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("orders:read", p => p.RequireAssertion(ctx =>
        ctx.User.FindFirst("scp")?.Value.Split(' ').Contains("orders.read") == true   // delegated: user via client
        || ctx.User.IsInRole("Orders.Reader")));                                     // application: daemon
```

## Validating access tokens in an API {a}

An API receiving a JWT access token must check:

1. **Signature**: with the issuer's public key from `jwks_uri` (cached; rotated keys found by `kid`). Reject `alg: none` and unexpected algorithms.
2. **Issuer** (`iss`): the expected tenant or authority.
3. **Audience** (`aud`): **this API**. Without this check, a token issued for another API in the same tenant would be accepted (the "confused deputy").
4. **Lifetime**: `exp`, `nbf` (with small clock skew).
5. **Scopes/roles** for the operation, then **resource authorization**.

ASP.NET Core's JwtBearer handler does 1–4 from `Authority` + `Audience` ([Auth](ch:auth#jwt-bearer-authentication-traced-claim-by-claim)) — this chapter's list is exactly that same five-step validation, now explicitly in the context of the token lifecycle that produced the JWT in the first place.

### JWT vs reference (opaque) tokens

| | JWT (self-contained) | Reference token (opaque) |
|---|---|---|
| Validation | Locally, with public keys: fast, no network call | **Introspection** call to the authorization server (RFC 7662), usually cached |
| Revocation | Hard: valid until expiry (keep it short) | Immediate: the server just forgets it |
| Size and privacy | Larger; claims are readable by anyone holding it | Small; reveals nothing |
| Use | Most APIs | High-security or revocation-critical APIs; tokens leaving your boundary |

## SPAs and the BFF pattern {a}

SPAs are **public clients running in a hostile environment** (any XSS can read tokens in JS memory or `localStorage`). Options:

| Approach | How | Verdict |
|---|---|---|
| Tokens in the browser (code + PKCE in JS, e.g. MSAL.js) | SPA gets tokens and calls APIs with bearer headers | Works, widely used; **XSS = token theft**; use short lifetimes and refresh-token rotation; avoid `localStorage` |
| **Backend-for-Frontend (BFF)** | A thin server-side ASP.NET Core app (often with YARP) performs OIDC as a **confidential client**, keeps tokens **server-side**, and gives the browser only an **HttpOnly, Secure, SameSite** session cookie; it proxies API calls and attaches access tokens | **Recommended** by the IETF "OAuth 2.0 for Browser-Based Apps" guidance; needs CSRF protection (SameSite + antiforgery/custom header) |

```text
Browser (SPA) ──cookie──▶ BFF (ASP.NET Core + YARP, holds tokens) ──Bearer token──▶ Shop API
                           └─ OIDC code flow + PKCE with Entra ID (confidential client)
```

Recognise this as the same architectural recommendation from both [Auth](ch:auth#cookies-vs-bearer-tokens-the-tradeoff-behind-how-do-i-stay-l) and [Microservices](ch:microservices#api-gateway-bff-and-service-mesh), arrived at from three different angles — token security, cookie ergonomics, and client-specialised gateways — all converging on the same shape.

Libraries: **Duende.BFF**, or ASP.NET Core with `AddOpenIdConnect` + YARP + token management (Duende.AccessTokenManagement).

## Identity providers for .NET {a}

| Option | Type | Fits |
|---|---|---|
| **Microsoft Entra ID** | Cloud IdP (workforce) | Employees, B2B, Azure-integrated apps; Microsoft.Identity.Web + MSAL |
| **Microsoft Entra External ID** | Cloud CIAM | Customer sign-up/sign-in (successor of Azure AD B2C) |
| **Auth0 (Okta), Okta** | Cloud IdP/CIAM | Multi-cloud, rich features |
| **Keycloak** | Open-source, self-hosted | On-premises, full control |
| **Duende IdentityServer** | .NET framework to **build** your own OIDC server (commercial licence for most companies) | Custom requirements, on-premises, full control in .NET |
| **OpenIddict** | Open-source .NET OIDC server framework | Self-hosted authorization server in ASP.NET Core |
| **ASP.NET Core Identity** | User store/membership (not an OIDC server) | Simple first-party login; combine with Duende or OpenIddict to become an IdP |

Rule: **don't build your own authorization server unless you must.** Identity is security-critical, specification-heavy and constantly attacked; use a managed provider when you can.

## Common mistakes {a}

| Mistake | Consequence | Fix |
|---|---|---|
| Not validating `aud` | Tokens for other APIs accepted | Always set `Audience` / `ValidAudiences` |
| Accepting ID tokens at APIs | Wrong token type; no scopes | APIs accept access tokens only |
| Long-lived access tokens | Stolen tokens usable for days | 5–60 minute lifetimes plus refresh tokens |
| Tokens in `localStorage` | XSS steals them | BFF with cookies, or in-memory with short lifetimes |
| Implicit flow / ROPC | Token leakage; password exposure | Code + PKCE; client credentials for services |
| Wildcard or loose redirect URIs | Codes or tokens sent to attackers | Exact, registered HTTPS redirect URIs |
| Client secrets in SPAs/mobile apps | Secret extracted | Public client + PKCE |
| Checking only scopes, not data ownership | IDOR | Resource-based authorization |
| Rolling your own JWT issuance with HS256 shared keys | Any service with the key can mint tokens | Asymmetric keys at a real IdP |
| Sensitive data in JWT claims | Readable by anyone holding the token | Keep claims minimal; look up details server-side |

:::qa What's the difference between OAuth 2.0 and OpenID Connect?
OAuth 2.0 is a framework for delegated authorization: clients obtain access tokens to call APIs with limited scopes on behalf of a user or themselves. OpenID Connect is an identity layer on top that adds authentication: an ID token describing the user, standard claims and scopes (openid, profile, email), the UserInfo endpoint, discovery and logout.
:::

:::qa Explain the authorization code flow with PKCE.
The client creates a random code_verifier and sends its SHA-256 hash (code_challenge) with the /authorize redirect. The user authenticates at the IdP, which redirects back with a one-time authorization code. The client exchanges the code plus the original code_verifier at the token endpoint over a back channel; the server checks the hash and returns access, ID and refresh tokens. PKCE prevents intercepted codes from being redeemed.
:::

:::qa Which OAuth flow would you use for a service calling another API without a user?
Client credentials: the service authenticates as itself (a certificate, federated credential or managed identity, rather than a secret) and receives an access token with application permissions (roles) for the target API's audience.
:::

:::qa Access token vs ID token vs refresh token?
The access token is for the API: it states audience, scopes/roles and expiry and is sent as a bearer token. The ID token is for the client: it proves who the user is and must not be sent to APIs. The refresh token goes to the authorization server to get new access tokens silently; it's long-lived, rotated and stored securely.
:::

:::qa Why was the implicit flow deprecated?
It returned tokens directly in the redirect URL fragment, exposing them to browser history, logs, referrer leaks and malicious scripts, with no way to bind them to the client and no refresh tokens. The authorization code flow with PKCE provides the same for public clients securely.
:::

:::qa What must an API validate on an incoming JWT access token?
The signature with the issuer's current public keys (from jwks_uri, by kid), the issuer, the audience (it must be this API), expiry and not-before (with small clock skew), and then the required scopes or roles, followed by resource-level authorization.
:::

:::qa How should a SPA handle tokens securely?
Preferably via the Backend-for-Frontend pattern: a server-side component performs the OIDC code flow as a confidential client, stores tokens server-side, issues an HttpOnly Secure SameSite cookie to the browser, and proxies API calls with access tokens attached. If tokens must live in the browser, use code + PKCE, keep them in memory with short lifetimes and refresh-token rotation, and never put them in localStorage.
:::

:::qa What is the On-Behalf-Of flow?
A middle-tier API that received a user's access token exchanges it at the authorization server for a new access token for a downstream API, so the downstream call carries the user's identity and delegated permissions (Entra ID OBO, or RFC 8693 token exchange).
:::

## Further reading

- [OAuth 2.0 and OpenID Connect protocols on the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols)
- [RFC 6749 (OAuth 2.0)](https://www.rfc-editor.org/rfc/rfc6749) · [RFC 7636 (PKCE)](https://www.rfc-editor.org/rfc/rfc7636) · [OAuth 2.0 Security Best Current Practice (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 for Browser-Based Applications (IETF draft)](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/)
- [oauth.com "OAuth 2.0 Simplified"](https://www.oauth.com/) by Aaron Parecki, the best plain-English guide.

## Verify this chapter

Run with `dotnet run` (a plain console app, .NET 8/9, only base-class-library crypto/JSON — no extra packages, no network call to a real identity provider). It verifies the actual protocol mechanics: PKCE's hash check, a hand-built HS256 JWT's signature validation (and that tampering breaks it), audience/expiry validation, scope-vs-role authorization, and exact redirect-URI matching. The full login round trip against a real authorization server needs a browser and a real IdP, so that part is left to the Further reading links instead of faked here.

```csharp
// Verify this chapter: run with `dotnet run`. No external packages needed
// (plain System.Security.Cryptography + System.Text.Json) and no network
// call to a real identity provider -- this verifies the PROTOCOL MECHANICS
// (PKCE hashing, JWT structure/signature, audience/expiry checks) that the
// chapter describes, not a live login against Entra ID.
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

void Check(string name, bool ok)
{
    if (!ok) throw new Exception($"FAIL: {name}");
    Console.WriteLine($"OK: {name}");
}

string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
byte[] Base64UrlDecode(string s)
{
    s = s.Replace('-', '+').Replace('_', '/');
    switch (s.Length % 4) { case 2: s += "=="; break; case 3: s += "="; break; }
    return Convert.FromBase64String(s);
}

// 1. PKCE: code_challenge = BASE64URL(SHA256(code_verifier)). The server
// recomputes this from the verifier sent later and must get the exact same
// value; a different verifier must NOT produce the same challenge.
string codeVerifier = Base64Url(RandomNumberGenerator.GetBytes(32));
string codeChallenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier)));

string serverRecomputedChallenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier)));
Check("the server can recompute the same code_challenge from the code_verifier it receives later",
    serverRecomputedChallenge == codeChallenge);

string wrongVerifier = Base64Url(RandomNumberGenerator.GetBytes(32));
string wrongChallenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(wrongVerifier)));
Check("a different code_verifier produces a different code_challenge (a stolen code alone is useless)",
    wrongChallenge != codeChallenge);

// 2. A minimal HS256 JWT: header.payload.signature, each base64url, signature
// = HMACSHA256(header + "." + payload, secret). This is exactly the shape
// ASP.NET Core's JwtBearer handler parses, just built and checked by hand.
string MakeJwt(object payload, byte[] secret)
{
    string header = Base64Url(Encoding.UTF8.GetBytes("""{"alg":"HS256","typ":"JWT"}"""));
    string body = Base64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    string signature = Base64Url(new HMACSHA256(secret).ComputeHash(Encoding.ASCII.GetBytes($"{header}.{body}")));
    return $"{header}.{body}.{signature}";
}
bool VerifyJwtSignature(string jwt, byte[] secret)
{
    var parts = jwt.Split('.');
    if (parts.Length != 3) return false;
    var expected = Base64Url(new HMACSHA256(secret).ComputeHash(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}")));
    return CryptographicOperations.FixedTimeEquals(Base64UrlDecode(expected), Base64UrlDecode(parts[2]));
}

byte[] signingKey = RandomNumberGenerator.GetBytes(32);
long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
string goodToken = MakeJwt(new { aud = "api://shop-api", exp = now + 300, sub = "user-123" }, signingKey);
Check("a JWT signed with the issuer's key validates against that same key", VerifyJwtSignature(goodToken, signingKey));

byte[] attackerKey = RandomNumberGenerator.GetBytes(32);
Check("the same JWT fails validation against a DIFFERENT key (an attacker can't forge one without the real key)",
    !VerifyJwtSignature(goodToken, attackerKey));

// Tamper with the payload (classic "none"/forged-claim attack) -- the
// signature no longer matches because it was computed over the original body.
var parts = goodToken.Split('.');
string tamperedPayload = Base64Url(Encoding.UTF8.GetBytes("""{"aud":"api://shop-api","exp":9999999999,"sub":"admin"}"""));
string tamperedToken = $"{parts[0]}.{tamperedPayload}.{parts[2]}";
Check("changing the payload after signing invalidates the signature", !VerifyJwtSignature(tamperedToken, signingKey));

// 3. Audience and expiry validation -- the two checks the chapter calls out
// as the ones that stop a "confused deputy" (wrong aud) and a stale token.
bool ValidateAudienceAndExpiry(JsonElement claims, string expectedAudience) =>
    claims.GetProperty("aud").GetString() == expectedAudience &&
    claims.GetProperty("exp").GetInt64() > DateTimeOffset.UtcNow.ToUnixTimeSeconds();

var originalClaims = JsonSerializer.Deserialize<JsonElement>(Base64UrlDecode(parts[1]));
Check("a token with the expected audience and a future exp passes validation",
    ValidateAudienceAndExpiry(originalClaims, "api://shop-api"));
Check("a token for a DIFFERENT audience fails validation (prevents the confused-deputy problem)",
    !ValidateAudienceAndExpiry(originalClaims, "api://inventory-api"));

var expiredClaims = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(new { aud = "api://shop-api", exp = now - 10 }));
Check("an expired token (exp in the past) fails validation", !ValidateAudienceAndExpiry(expiredClaims, "api://shop-api"));

// 4. Scope/role authorization: the effective permission is the intersection
// of what the client was granted (scopes) and what the user/app is allowed.
bool HasOrdersReadAccess(string? scp, string[] roles) =>
    (scp?.Split(' ').Contains("orders.read") == true) || roles.Contains("Orders.Reader");

Check("a delegated token with the orders.read scope is authorized", HasOrdersReadAccess("openid orders.read", []));
Check("a token missing the scope AND the role is NOT authorized", !HasOrdersReadAccess("openid profile", []));
Check("an application token with the Orders.Reader role (no scopes) is authorized", HasOrdersReadAccess(null, ["Orders.Reader"]));

// 5. Redirect URI must match EXACTLY, not just as a prefix -- a common
// misconfiguration lets an attacker register a URI like the real one plus
// an extra path segment and redirect tokens/codes there instead.
bool IsRegisteredRedirectUri(string requested, string[] registered) => registered.Contains(requested);
string[] registeredUris = ["https://shop.example.com/signin-oidc"];
Check("the exact registered redirect URI is accepted",
    IsRegisteredRedirectUri("https://shop.example.com/signin-oidc", registeredUris));
Check("a redirect URI that merely STARTS WITH the registered one is rejected (exact match only)",
    !IsRegisteredRedirectUri("https://shop.example.com/signin-oidc.attacker.com", registeredUris));

// Not runtime-verifiable here (needs a real authorization server, browser
// redirects and user interaction): the full authorization code + PKCE
// round trip against Entra ID, token introspection for reference tokens,
// and BFF cookie/session behavior -- see Further reading: RFC 6749, RFC
// 7636, and the Microsoft identity platform docs.

Console.WriteLine("All checks passed.");
```
