---
id: blazor-render-modes
title: "Blazor Render Modes: Server, Browser or Both"
summary: "The same Blazor component can run in four places, and Kettle needs three of them. Covers the Blazor Web App model since .NET 8: static server rendering with streaming, enhanced navigation and enhanced forms; Interactive Server over a SignalR circuit; Interactive WebAssembly with the .NET runtime in the browser; and Auto. Explains prerendering and why data loads twice, persisting state across the boundary, the rules for mixing modes, project layout, scaling Server circuits, WebAssembly size and AOT, security differences, and how to choose per page."
layer: framework
where: Web UI › Blazor render modes
fits: Builds on [Blazor components](ch:blazor-components). Interactive Server runs on [SignalR](ch:app-models#signalr-when-the-server-needs-to-speak-first) and needs the scaling care from [Azure compute](ch:azure-compute). WebAssembly makes the browser a client of your API ([API design](ch:api-design)) with the token concerns from [OAuth & OIDC](ch:oauth-oidc-identity#spas-and-the-bff-pattern).
levels: b,i,a
prereqs: blazor-components
next: blazor-advanced
---

## The 30-second version

| Render mode | Where the C# runs | Interactive? | Best for |
|---|---|---|---|
| **Static server rendering** (the default) | on the server, once per request | no (links and forms only) | content pages, SEO, fast first load |
| **Interactive Server** | on the server, kept alive per user | yes, over a WebSocket | interactive pages with direct access to server resources |
| **Interactive WebAssembly** | in the browser | yes, locally | offline-capable or very chatty UI, no server cost per user |
| **Interactive Auto** | Server first, WebAssembly once downloaded | yes | fast first visit and client-side execution afterwards |

- You choose **per page or per component**, with `@rendermode`.
- Interactive components are **prerendered** on the server first, so the page appears instantly, which means their initialisation **runs twice** unless you persist state.
- **Server** costs memory per connected user and needs a stable connection. **WebAssembly** costs download size and start-up time, and all its code is visible to the user.

## Words you'll meet

| Word | In plain words |
|---|---|
| **static SSR** | The server renders the component to HTML and forgets it. Nothing in the page runs C# afterwards. |
| **streaming rendering** | Send the page at once with placeholders, then stream in the parts that took longer, over the same response. |
| **enhanced navigation** | A small script fetches the next page and patches it in, instead of a full reload. |
| **circuit** | Interactive Server's live link to one browser tab: a WebSocket plus that user's component state in server memory. |
| **WebAssembly (WASM)** | A fast, safe instruction format that browsers run. Blazor ships the .NET runtime compiled to it. |
| **prerendering** | Rendering an interactive component to HTML on the server first, before it becomes interactive. |
| **hydration** | The moment a prerendered page becomes interactive. |

## Previously at Kettle {b}

Kettle's components work on a developer's machine. Now they have to run for real customers, and the pages have different needs. The product pages must load fast and be visible to search engines. The basket must react instantly. The warehouse's tablets roam around a building with patchy Wi-Fi.

**The problem:** one rendering strategy can't serve all three well.

**This episode:** Blazor's render modes, what each one costs, and how to mix them in one app.

## Start from zero: where can C# run for a web page? {b}

:::plain
Either the server runs your C# and sends HTML, or the browser downloads .NET and runs your C# itself. Blazor can do either, and can switch from one to the other.
:::

A web page lives in the browser. Your C# can reach it in only two ways:

1. **Run on the server**, and send the browser HTML, or a stream of small updates.
2. **Run in the browser.** Browsers can't run .NET directly, but they all run **WebAssembly**, a compact instruction format designed to run safely at near-native speed. Blazor ships the .NET runtime compiled to WebAssembly. The browser downloads it once, and then your components run right there in the tab.

Each has a cost. Running on the server needs the server to keep working for every user. Running in the browser needs the browser to download and start a runtime first. Render modes let you choose per page.

## Static server rendering: HTML and nothing more {b}

:::plain
By default, a Blazor page renders on the server like a Razor Page: the user gets plain HTML, quickly. Buttons with `@onclick` do nothing in this mode; links and forms still work.
:::

In a **Blazor Web App** (the template since .NET 8), components with no render mode are rendered **statically**: for each request, the server creates the components, renders them to HTML, sends the HTML and throws the components away. It's the same request-response model as [Razor Pages](ch:razor-mvc), written with components. It's ideal for Kettle's product pages: fast first paint, indexable by search engines, and no per-user server state.

Static rendering gets three enhancements from the small `blazor.web.js` script:

- **Enhanced navigation.** Clicking a link fetches the next page with `fetch` and patches only what changed into the current document, so it feels like a single-page app, with no full reload and no flicker, while still being plain server rendering.
- **Enhanced forms.** An `EditForm` with a `FormName` posts the form normally, binds the posted fields to the `[SupplyParameterFromForm]` model, validates, and runs `OnValidSubmit` on the server. Add `Enhance` to the form to have the response patched in without a reload.
- **Streaming rendering.** Mark a page `[StreamRendering]`, and when `OnInitializedAsync` awaits something slow, Blazor sends the page immediately with your "Loading…" markup, then streams the finished HTML down the **same** response once the data arrives. The user sees the page frame at once, without any WebSocket.

```razor
@page "/teas"
@attribute [StreamRendering]
@inject ICatalog Catalog

@if (teas is null) { <p>Loading teas…</p> }
else { @foreach (var t in teas) { <ProductCard Tea="t" /> } }

@code {
    private IReadOnlyList<TeaView>? teas;
    protected override async Task OnInitializedAsync() => teas = await Catalog.ListAsync();
}
```

What static rendering **can't** do: respond to `@onclick`, `@bind` updates or timers. Those need an interactive render mode.

## Interactive Server: the UI runs on the server {b}

:::plain
The user's browser keeps a live connection to the server. Every click goes up that connection, your C# runs on the server, and the screen changes come back down. Fast to start, but every user takes server memory.
:::

```razor
@page "/basket"
@rendermode InteractiveServer
```

How it works:

1. The page is first **prerendered** to HTML and sent, so it appears immediately.
2. `blazor.web.js` opens a **WebSocket** back to the server using **SignalR**. That connection, plus this user's live component instances, is a **circuit**.
3. The user clicks **+**. The browser sends a tiny "click on element 17" message up the socket.
4. On the server, the component's handler runs, it re-renders, and Blazor diffs the result.
5. Only the **changes** go back down the socket ("text node 23 is now £21.00"), and the script applies them.

**Strengths:**
- Fast start: no runtime download; the page is ready once the HTML arrives.
- The code runs on your server, so it can use the database, files and secrets directly, and users can't read it.
- Works on any browser that supports WebSockets, however slow the device.

**Costs:**
- **Every interaction is a network round trip.** On a 150 ms mobile connection, every keystroke in a `@bind:event="oninput"` box waits 150 ms. Fine for clicks; noticeable for fast typing or dragging.
- **Server memory per user.** Each circuit holds the component tree and its state, tens to hundreds of kilobytes per user. Ten thousand concurrent users means gigabytes, held for as long as their tabs are open, and for a while after.
- **A dropped connection pauses the UI.** The client shows a reconnecting overlay and retries. If it reconnects to the same server within the retention period, the circuit resumes. If the server restarted, or the user returns after the circuit was discarded, the state is gone and the page reloads. Deployments therefore disconnect everyone.
- **Scale-out needs care.** A circuit lives on one server, so a load balancer must keep each user on the same instance (**sticky sessions**). Or use **Azure SignalR Service**, which holds the connections and routes each user's messages to the right server.

## Interactive WebAssembly: the UI runs in the browser {b}

:::plain
The browser downloads a small .NET runtime and your app, then runs your C# itself. Clicks are handled locally, instantly, with no server involved, but the first visit has a download, and everything the browser runs can be inspected.
:::

```razor
@page "/warehouse/pick"
@rendermode InteractiveWebAssembly
```

Components that run in WebAssembly live in a separate **`.Client` project**, because they're compiled and downloaded separately. The server project references it, so it can still prerender those components and serve the files.

**Strengths:**
- **No round trip per interaction.** Typing, dragging and validation are instant.
- **No server memory per user.** The server only serves static files and API calls. A thousand warehouse tablets cost the server nothing between API calls.
- **Survives a flaky connection.** A temporary loss of Wi-Fi only fails the API calls made during it, and those can be retried. With a service worker, the app can even work offline as a Progressive Web App (PWA).

**Costs:**
- **Download and start-up.** The first visit downloads the runtime and your assemblies, typically a few megabytes after compression and trimming, then starts the runtime. Later visits use the browser cache.
- **Everything is visible.** Users can download and decompile the assemblies, and change anything that runs in their browser. **Never put secrets in a WebAssembly app**, and never trust its checks: the API must authorize and validate everything again.
- **No direct server access.** Components get data over HTTP from your API ([Building APIs](ch:building-apis)), which means designing that API and handling auth for it, ideally with the BFF pattern ([OAuth & OIDC](ch:oauth-oidc-identity#spas-and-the-bff-pattern)).
- **CPU-heavy work runs on the user's device**, interpreted by default. **AOT compilation** (`<RunAOTCompilation>true</RunAOTCompilation>`) compiles to WebAssembly ahead of time for much faster execution, at the cost of a noticeably larger download.

## Interactive Auto: the best of both, with complexity {i}

`@rendermode InteractiveAuto` starts a component in **Server** mode on the first visit, so it's interactive at once, while the WebAssembly files download in the background. On later visits, once the runtime is cached, the component runs in **WebAssembly**.

The catch: the same component must work **in both places**. It can't call `KettleDb` directly, because in the browser there's no database. The usual design is an interface with two implementations:

```csharp norun
public interface IBasketService { Task<BasketView> GetAsync(); Task AddAsync(string sku); }

// Server project: talks to the database directly
builder.Services.AddScoped<IBasketService, DbBasketService>();
// .Client project: calls the API over HTTP
builder.Services.AddScoped<IBasketService, HttpBasketService>();
```

The component injects `IBasketService` and never knows where it's running. The API endpoints that `HttpBasketService` calls must exist anyway, so Auto costs you both the Server mode's circuits and the WebAssembly mode's API surface.

## Prerendering: why data loads twice {a}

:::plain
An interactive page is first drawn on the server as plain HTML, so the user sees it immediately. Then it starts up again as a live component. Anything done at start-up, like loading data, happens both times.
:::

By default, every interactive component is **prerendered**:

1. During the HTTP request, the server runs the component, including `OnInitializedAsync`, and renders HTML. The user sees the basket immediately.
2. Then the page becomes interactive: a circuit starts, or WebAssembly boots. Blazor creates the component **again**, and `OnInitializedAsync` **runs again**.

So the basket is loaded from the database twice, and if the two loads return different data, or the second takes a while, the page flickers between the two versions.

**Fixes, best first:**

- **Persist the prerendered state.** Blazor can serialise state into the prerendered page and hand it to the interactive instance, which then skips the second load. Since .NET 8 you do this with `PersistentComponentState`. .NET 10 adds a declarative form, a `[PersistentState]` attribute on the property:

```razor
@code {
    [PersistentState] public BasketView? Basket { get; set; }    // .NET 10: saved during prerender, restored when interactive

    protected override async Task OnInitializedAsync()
        => Basket ??= await Baskets.GetAsync();                    // only loads if nothing was restored
}
```

- **Turn prerendering off** for components where it isn't worth it: `@rendermode @(new InteractiveServerRenderMode(prerender: false))`. The user sees nothing until the component is interactive.
- **Make the double call cheap**, for example with an output-cached or distributed-cached query.

Two more prerendering facts: JavaScript interop isn't available during prerender (there's no browser yet), so do JS work in `OnAfterRenderAsync`. And code can check where it's running with `RendererInfo.IsInteractive` and `RendererInfo.Name` (.NET 9) to show a disabled button until the page is live.

## Mixing render modes: the rules {a}

You can set a render mode in three places:

| Where | Effect |
|---|---|
| `@rendermode InteractiveServer` at the top of a component | that component, everywhere it's used |
| `<Basket @rendermode="InteractiveServer" />` on one usage | that instance only |
| on `<Routes @rendermode="…" />` and `<HeadOutlet>` in `App.razor` | the **whole app** becomes interactive ("global interactivity") |

**Per-page interactivity** (the template's default) keeps most pages static and makes specific pages or components interactive. **Global interactivity** makes navigation itself interactive, like a classic SPA, which simplifies state between pages but gives up the cheap, stateless static pages.

The rules, and the reasons for them:

1. **A static parent can host interactive children.** That's the point of per-component modes.
2. **Inside an interactive component, children inherit its mode.** A Server component can't contain a WebAssembly one, because the two run in different processes.
3. **Parameters passed into an interactive component must be serialisable.** A static parent renders on the server during the request; an interactive child may then start on a circuit, or in the browser. The parameters have to cross that gap as JSON, so you can't pass a delegate, a `RenderFragment` or a `DbContext` across a render-mode boundary.
4. **WebAssembly components must live in the `.Client` project**, which can't reference server-only code.

## Choosing per page: Kettle's decisions {i}

| Kettle page | Mode | Why |
|---|---|---|
| Home, product list, product details | **Static SSR** with streaming | fast, indexable, no per-user cost; nothing interactive except "Add to basket", which is an enhanced form |
| Basket and checkout | **Interactive Server** | instant totals and validation; talks to stock and pricing directly; no secrets in the browser |
| Live order tracking | **Interactive Server** | the server pushes status changes down the existing circuit |
| Warehouse picking app | **Interactive WebAssembly** (PWA) | patchy Wi-Fi, fast scanning interactions, and a hundred tablets that shouldn't each hold a circuit |
| Admin site | Razor Pages (unchanged) | it works, and it's mostly forms |

A rule of thumb: start **static**, add **Server** interactivity where users need it, and choose **WebAssembly** when offline use, per-keystroke latency or the per-user server cost matter more than download size.

## In depth: running Server and WebAssembly in production {a}

**Sizing Interactive Server.** Memory per circuit depends on your components. Measure it under a load test, then multiply by peak concurrent users, remembering that an idle open tab still holds a circuit. Keep circuit state small: page large lists from the database instead of holding them, and don't cache big objects per user. Disconnected circuits are kept for a retention period (a few minutes by default, configurable in `CircuitOptions`) so users can reconnect. Recent .NET versions improve the reconnection experience and can persist a paused circuit's state; check what's new for your version.

**Scaling Interactive Server.** Each circuit is tied to one server, so:
- Behind your own load balancer: enable **session affinity** (sticky sessions), and expect users to be disconnected when their server restarts or scales in.
- On Azure: **Azure SignalR Service** keeps the client connections, so app servers can be added and removed more freely, and it handles the WebSocket fan-out.
- Unhandled exceptions in a component **terminate that user's circuit** (they see the error UI). Use `ErrorBoundary` around risky parts ([Blazor in production](ch:blazor-advanced)).

**Making WebAssembly small and fast.**
- **Trimming** is on by default when publishing: unused framework code is removed. Avoid libraries that rely on reflection the trimmer can't see ([Advanced C#](ch:advanced-csharp-codegen)).
- Files are served **compressed** (Brotli) and, since .NET 9, fingerprinted and cached aggressively through `MapStaticAssets`.
- **Lazy-load** assemblies used only by some pages.
- **AOT compilation** trades download size for CPU speed. Use it when the app does heavy computation in the browser, not by default.
- The **.NET WebAssembly runtime** is downloaded once and cached; your app's own assemblies change with each deploy.

**Security, compared.** In Server mode, your component code is trusted server code, but every UI event is user input: a crafted message can call any handler on the page with any arguments the UI could have sent, so authorize operations in handlers, not only by hiding buttons. In WebAssembly mode, nothing in the client is trusted at all; the API is the security boundary.

## Interview questions {i}

:::qa What are Blazor's render modes and when would you use each?
Static server rendering renders HTML per request with no interactivity: best for content and SEO. Interactive Server keeps components on the server and syncs UI changes over a SignalR circuit: fast start and direct server access, but a round trip per interaction and memory per user. Interactive WebAssembly runs .NET in the browser: instant interactions, offline capability and no server state per user, but a download, slower first start and fully visible code. Auto starts on Server and switches to WebAssembly once it's cached. You choose per page or per component.
:::

:::qa Why does OnInitializedAsync run twice, and how do you fix it?
Interactive components are prerendered on the server during the HTTP request, then created again when the page becomes interactive, so initialisation runs once for each. Persist the prerendered state with `PersistentComponentState` (or the `[PersistentState]` attribute in .NET 10) so the interactive instance skips reloading, disable prerendering for that component, or make the repeated load cheap.
:::

:::qa How do you scale a Blazor Server app?
Each circuit holds per-user state in one server's memory, so measure memory per circuit and plan for peak concurrent users, keep circuit state small, and route each user back to the same server with sticky sessions, or use Azure SignalR Service to manage connections. Expect deployments and scale-in to disconnect circuits, and design for reconnection.
:::

:::qa What are the security implications of Blazor WebAssembly?
All client code and data can be downloaded, decompiled and modified, so it can't hold secrets or enforce rules. Every call must go to an API that authenticates, authorizes and validates independently. Prefer the BFF pattern with cookies over storing tokens in the browser.
:::

:::qa Can you pass a RenderFragment to an interactive component from a static page?
No. Parameters crossing from a statically rendered parent into an interactive child must be serialisable, because the child may start later in a circuit or in the browser. Delegates, render fragments and service instances can't be serialised. Pass plain data, and let the interactive component obtain services itself.
:::

## Next episode {b}

Kettle's render modes are chosen. Going to production raises the remaining questions: calling JavaScript libraries, signing users in, keeping long lists fast, surviving errors, and testing components. [Episode 4 · Blazor in production →](ch:blazor-advanced)

## Further reading

- [ASP.NET Core Blazor render modes](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes)
- [Prerender components and persist state](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/prerender)
- [Static server-side rendering and streaming](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering)
- [Host and deploy Blazor](https://learn.microsoft.com/en-us/aspnet/core/blazor/host-and-deploy/)
- [What's new in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/release-notes/) (Blazor changes each release)
