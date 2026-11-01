---
id: blazor-advanced
title: "Blazor in Production: JavaScript, Sign-in, Speed, Errors and Tests"
summary: "Taking Kettle's Blazor storefront live. Covers JavaScript interop in both directions (modules, DotNetObjectReference, disposal and prerendering), authentication and authorization in each render mode (AuthenticationStateProvider, AuthorizeView, cascading auth state, auth across Server and WebAssembly, the BFF pattern), calling APIs, rendering performance (wasted renders, ShouldRender, Virtualize, QuickGrid, event throttling), error handling with ErrorBoundary and circuit failures, state across refreshes, testing with bUnit and Playwright, and the recent .NET versions' Blazor changes."
layer: framework
where: Web UI › Blazor in production
fits: The last episode of the Web UI part, building on [components](ch:blazor-components) and [render modes](ch:blazor-render-modes). Sign-in reuses [Auth](ch:auth) and [OAuth & OIDC](ch:oauth-oidc-identity); performance work follows [Performance engineering](ch:performance-engineering); testing mirrors [Unit](ch:unit-testing) and [integration testing](ch:integration-testing).
levels: i,a
prereqs: blazor-render-modes
next: data-story
---

## The 30-second version

- **JavaScript interop:** call JS with `IJSRuntime.InvokeAsync`, preferably by importing a **JS module** next to the component. Call .NET from JS with a `DotNetObjectReference`. Only after the first render, and dispose both references.
- **Sign-in:** components read the user from a cascading `Task<AuthenticationState>`. `[Authorize]` protects pages, and `<AuthorizeView>` shows or hides parts. In WebAssembly, the **API** must enforce everything.
- **Speed:** most slowness is **wasted re-renders**. Pass immutable parameters, override `ShouldRender` for expensive components, use `@key`, and use `<Virtualize>` for long lists.
- **Errors:** an unhandled exception in Interactive Server **ends the user's circuit**. Wrap risky areas in `<ErrorBoundary>`.
- **Tests:** **bUnit** renders components in a unit test, and **Playwright** drives a real browser end to end.

## Words you'll meet

| Word | In plain words |
|---|---|
| **JS interop** | Calling JavaScript from C#, or C# from JavaScript. |
| **JS module** | A `.js` file with `export`s, loaded only by the component that needs it. |
| **`DotNetObjectReference`** | A handle that lets JavaScript call methods on a .NET object. |
| **`AuthenticationStateProvider`** | The service that tells Blazor who the current user is. |
| **`ErrorBoundary`** | A component that catches errors from the components inside it and shows a fallback. |
| **virtualization** | Rendering only the list rows currently visible, plus a few spare. |
| **bUnit** | A testing library that renders Blazor components without a browser. |

## Previously at Kettle {b}

Kettle's storefront components work, and each page has its render mode. Going live brings a list of practical needs. The payment provider's card form is a JavaScript widget. Customers must sign in to see their orders. The order history has 4,000 rows for the best customers. One bad product record crashes the whole basket page. And nobody has written a single test for a component.

**The problem:** the things a demo never needs and production always does.

**This episode:** JavaScript interop, authentication, performance, error handling and testing for Blazor.

## JavaScript interop {i}

:::plain
Blazor can call JavaScript functions and get results back, and JavaScript can call C# methods. Do it only after the component is on the page, and clean up afterwards.
:::

**Calling JavaScript from C#.** Put the JavaScript in a **module** next to the component. A file named `CardForm.razor.js` is served with the app, and only loaded by the component that imports it:

```javascript
// CardForm.razor.js
export function mount(element, dotNetRef) {
  const widget = window.PayProvider.mountCard(element);
  widget.onChange(state => dotNetRef.invokeMethodAsync('CardChanged', state.complete));
  return widget;
}
export function tokenize(widget) { return widget.createToken(); }   // returns a Promise
```

```razor
@* CardForm.razor *@
@implements IAsyncDisposable
@inject IJSRuntime JS

<div @ref="host"></div>
<button disabled="@(!complete)" @onclick="PayAsync">Pay</button>

@code {
    private ElementReference host;
    private IJSObjectReference? module, widget;
    private DotNetObjectReference<CardForm>? self;
    private bool complete;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender) return;                                        // the element now exists in the browser
        module = await JS.InvokeAsync<IJSObjectReference>("import", "./Components/CardForm.razor.js");
        self = DotNetObjectReference.Create(this);
        widget = await module.InvokeAsync<IJSObjectReference>("mount", host, self);
    }

    [JSInvokable]                                                       // callable from JavaScript
    public void CardChanged(bool isComplete) { complete = isComplete; StateHasChanged(); }

    private async Task PayAsync()
    {
        var token = await module!.InvokeAsync<string>("tokenize", widget);   // awaits the JS Promise
        await Payments.ChargeAsync(token);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (widget is not null) await widget.DisposeAsync();
            if (module is not null) await module.DisposeAsync();
        }
        catch (JSDisconnectedException) { }                              // the circuit is already gone: nothing to clean up
        self?.Dispose();
    }
}
```

The rules this code follows:

1. **Only after rendering.** During prerendering there's no browser, and before the first render the element doesn't exist. `OnAfterRenderAsync(firstRender: true)` is the first safe moment. Calling JS earlier throws.
2. **Modules over globals.** `import` loads the module once per component and keeps its functions out of the global scope. `IJSObjectReference` represents a JS object (the module, the widget) held for you on the .NET side.
3. **Calls are asynchronous and serialised.** Arguments and results travel as JSON. In Interactive Server, every call is a network round trip, so make **few, coarse** calls rather than many small ones.
4. **JS calling .NET** goes through a `DotNetObjectReference` to a method marked `[JSInvokable]`. JavaScript holds that reference, so **dispose it**, or the component can never be collected.
5. **Dispose JS references**, and expect `JSDisconnectedException` when disposal happens after a Server circuit has already closed.

Don't use JavaScript to change elements that Blazor renders. Blazor's diffing assumes it owns those elements, and edits behind its back are overwritten or cause errors. Give JavaScript its own empty element (`host` above) to manage.

## Signing in and authorization {i}

:::plain
Blazor asks one service who the user is, and passes the answer down to every component. Pages and parts of pages can be shown only to signed-in users or certain roles, but in the browser that's only cosmetic: the server must check again.
:::

**Who is the user?** Blazor asks an **`AuthenticationStateProvider`**, which returns an `AuthenticationState` containing the `ClaimsPrincipal` you know from [Auth](ch:auth). `builder.Services.AddCascadingAuthenticationState()` makes it available to every component as a cascading `Task<AuthenticationState>`.

```razor
@page "/account/orders"
@attribute [Authorize]                                @* redirects to sign-in if not authenticated *@

<AuthorizeView Roles="Staff">
    <Authorized><a href="/admin">Admin</a></Authorized>
</AuthorizeView>

@code {
    [CascadingParameter] private Task<AuthenticationState> AuthState { get; set; } = default!;

    protected override async Task OnInitializedAsync()
    {
        var user = (await AuthState).User;
        customerId = user.FindFirst("customer_id")?.Value;
    }
    private string? customerId;
}
```

How the user is established differs by render mode:

| Mode | How sign-in works | Where to enforce rules |
|---|---|---|
| Static SSR | the normal cookie or OIDC sign-in of the ASP.NET Core app; each request carries the cookie | on the server, as in Razor Pages |
| Interactive Server | the circuit captures the user from the cookie **when it starts**, and keeps it | in component code and services, which run on the server |
| Interactive WebAssembly | the browser needs to know the user too: the server passes the authentication state down when the app starts (`AddAuthenticationStateSerialization` since .NET 9), or the client signs in through the BFF | **in the API.** The client's `[Authorize]` only hides UI. |

Two traps:

- **In Interactive Server, the user is fixed for the circuit's lifetime.** If their role is removed or they sign out in another tab, the open circuit still has the old principal until it reconnects. For sensitive operations, re-check permissions on the server per operation.
- **In WebAssembly, prefer a BFF to tokens in the browser.** The server signs the user in with a cookie, and the WebAssembly app calls the server's own API with that cookie. The server forwards calls to other APIs with tokens it holds. The browser never sees a token that an XSS bug could steal ([OAuth & OIDC](ch:oauth-oidc-identity#spas-and-the-bff-pattern)).

## Calling APIs from components {i}

In Interactive Server and static rendering, components can call services directly: they're already on the server. In WebAssembly, they call your API with `HttpClient`, registered in the `.Client` project with the base address of the host. Keep components independent of where they run by depending on an interface, with a server implementation and an HTTP implementation, as shown under [Auto mode](ch:blazor-render-modes#interactive-auto-the-best-of-both-with-complexity).

For HTTP from WebAssembly, the same advice as anywhere applies: typed clients, cancellation when the user navigates away (pass a `CancellationToken` cancelled in `Dispose`), and sensible errors. The browser's networking stack handles connection pooling, and a WebAssembly app can't open raw sockets.

## Performance: stop rendering what didn't change {a}

:::plain
Blazor is usually slow for one reason: components render again when nothing they show has changed. Fix that first, then render less of long lists.
:::

**Find wasted renders.** Override `OnAfterRender` in a suspect component and log a counter, or use the browser's profiler. Common causes:

| Cause | What happens | Fix |
|---|---|---|
| A **mutable object** passed as a parameter | Blazor can't tell if it changed, so the child re-renders on every parent render | pass immutable records or primitives, or override `ShouldRender` |
| A **lambda created during render**, e.g. `OnClick="() => Select(item)"` | each render makes a new delegate, so the child sees a changed parameter | usually fine; for big lists, pass the item and let the child raise one `EventCallback<Item>` |
| An event that fires very often (`oninput`, `onmousemove`, `onscroll`) | every event is a render, and in Server mode, a round trip | `@bind:event="onchange"`, debounce in JS, or `@onmousemove:preventDefault` and throttle |
| A cascading value that changes | every subscriber re-renders | split values that change from values that don't, and use `IsFixed` |
| One giant component | any change re-renders all of it | split it into smaller components so changes stay local |

**`ShouldRender`.** Override it to return `false` when nothing relevant changed. Be careful: get it wrong and the UI silently stops updating.

**Long lists.** Rendering 4,000 order rows makes 4,000 components and a page that scrolls badly. **`<Virtualize>`** renders only the rows in view, plus a few spare, and swaps them as the user scrolls:

```razor
<Virtualize Items="orders" Context="order" ItemSize="48">
    <OrderRow Order="order" />
</Virtualize>

@* or fetch pages lazily from the database as the user scrolls *@
<Virtualize ItemsProvider="LoadOrdersAsync" Context="order"><OrderRow Order="order" /></Virtualize>
```

**QuickGrid** (`Microsoft.AspNetCore.Components.QuickGrid`) is a fast, simple data grid with sorting, paging and virtualization, and it can query an EF Core `IQueryable` directly through its EF adapter package.

**Server-mode extras.** Each render's diff goes over the network, so keep the rendered DOM lean (no hidden copies of large markup), and don't re-render on timers more often than needed. **WebAssembly extras.** CPU-heavy work runs on the user's device: move it to the server, cache results, or consider AOT compilation.

## Errors: keep one bad component from taking the page down {i}

In **Interactive Server**, an unhandled exception in a component's event handler or lifecycle method is treated as fatal for that **circuit**: the user sees the "An error has occurred" bar and must reload. One bad product record shouldn't do that to the whole basket.

**`<ErrorBoundary>`** catches exceptions thrown by components inside it and renders fallback content instead:

```razor
@foreach (var line in Basket.Lines)
{
    <ErrorBoundary @key="line.Sku">
        <ChildContent><BasketLine Line="line" /></ChildContent>
        <ErrorContent>
            <p class="error">We couldn't show this item. It's still in your basket.</p>
        </ErrorContent>
    </ErrorBoundary>
}
```

- An error boundary catches errors from **rendering, lifecycle methods and event handlers** of the components inside it, not exceptions in your own background tasks.
- After an error, it stays in the error state until you call `Recover()`, for example when the user navigates or retries.
- **Log the exception.** An error boundary logs through `ILogger`, so your normal logging and telemetry see it ([Errors & logging](ch:errors-logging)).

Exceptions inside `Task`s you start yourself and don't await escape everything. Catch and log inside them.

## State that survives refreshes and reconnections {a}

| Need | Where to keep it |
|---|---|
| A filter, a page number, a selected tab | the **URL** (`[SupplyParameterFromQuery]`), so refresh and sharing work |
| A draft the user is typing, in Server mode | browser storage. In Server mode, `ProtectedSessionStorage`/`ProtectedLocalStorage` encrypt values with Data Protection, so users can't read or tamper with them. |
| A basket | the **server**: database or Redis, keyed by user or by an anonymous basket cookie |
| Data loaded during prerendering | persisted component state ([Render modes](ch:blazor-render-modes#prerendering-why-data-loads-twice)) |

Anything held only in an Interactive Server circuit is lost when the circuit is discarded: after a long disconnect, a deployment or a server restart. Keep the circuit for UI state, not for data you can't afford to lose.

## Testing Blazor components {i}

**bUnit** renders a component in an ordinary xUnit or NUnit test, with no browser, so you can click buttons and assert on the markup:

```csharp norun
public sealed class BasketLineTests : BunitContext
{
    [Fact]
    public void Clicking_plus_reports_the_new_quantity()
    {
        int? reported = null;
        var cut = Render<BasketLine>(p => p
            .Add(x => x.Name, "Sencha").Add(x => x.Price, 6.50m).Add(x => x.Quantity, 1)
            .Add(x => x.QuantityChanged, q => reported = q));

        cut.FindAll("button")[1].Click();       // the "+" button

        Assert.Equal(2, reported);
        Assert.True(cut.Find("button").HasAttribute("disabled"));   // "−" is still disabled: the parent hasn't passed the new quantity back yet
    }
}
```

bUnit gives you a test DI container (`Services.AddSingleton<IBasketService>(fake)`), a fake `NavigationManager`, a fake authorization state and a mock for JS interop, so components that call JavaScript can be tested too. (The base class and method names have changed between bUnit versions; check the version you install.)

For whole pages in a real browser, including render modes, enhanced navigation and JavaScript, use **Playwright** against the app hosted with `WebApplicationFactory` or a test deployment ([Integration testing](ch:integration-testing)). Keep those tests few and focused on critical journeys like checkout.

## What changed recently {a}

Blazor has changed more than any other part of ASP.NET Core in recent releases. The highlights, by version:

| Version | Notable Blazor changes |
|---|---|
| .NET 8 | **Blazor Web App** model: static SSR by default, streaming rendering, enhanced navigation and forms, per-component render modes, Auto mode, root-level cascading values, QuickGrid in the box |
| .NET 9 | `MapStaticAssets` (compressed, fingerprinted static files), `RendererInfo` and `AssignedRenderMode` to detect where a component runs, constructor injection, better reconnection, auth state serialisation to WebAssembly, `[ExcludeFromInteractiveRouting]` for pages that must stay static |
| .NET 10 | declarative persisted state with `[PersistentState]`, further reconnection and circuit-state improvements, and many smaller refinements |

Check *What's new in ASP.NET Core* for your version before relying on details: Blazor features are still being refined.

## Interview questions {i}

:::qa How do you call JavaScript from Blazor, and what are the pitfalls?
Inject `IJSRuntime` and use `InvokeAsync`, ideally importing a collocated JS module as an `IJSObjectReference`. Call it only from `OnAfterRenderAsync`, since there's no browser during prerendering. Calls are async and JSON-serialised, and in Server mode each is a network round trip, so keep them coarse. For JS-to-.NET calls, pass a `DotNetObjectReference` to `[JSInvokable]` methods and dispose it. Don't let JS modify DOM that Blazor renders.
:::

:::qa How does authorization work in Blazor, and what's different in WebAssembly?
An `AuthenticationStateProvider` supplies the user, cascaded to components as `Task<AuthenticationState>`. `[Authorize]` protects routable components and `AuthorizeView` shows UI by policy or role. On the server those checks are enforced. In WebAssembly they only affect the UI, because the client can be modified, so the API must authorize every request, preferably with a BFF holding tokens server-side.
:::

:::qa A Blazor Server page is slow. How do you investigate?
Look for wasted renders first: count renders in suspect components, check for mutable parameters, frequent events such as `oninput`, and changing cascading values. Then reduce work: split large components, override `ShouldRender`, use `@key`, virtualize long lists, and debounce chatty events. Measure render diff sizes and circuit memory, since every update crosses the network.
:::

:::qa What happens when a Blazor Server component throws an unhandled exception?
The circuit is considered corrupted and is terminated: the user sees the error UI and must reload, losing in-circuit state. Wrap risky UI in `ErrorBoundary` to show fallback content and log the error, and catch exceptions in fire-and-forget tasks yourself.
:::

:::qa How do you test Blazor components?
With bUnit for component tests: render a component with parameters and fake services, interact with it, and assert on markup and callbacks, with test doubles for navigation, authorization and JS interop. Use Playwright for a small number of end-to-end browser tests of critical flows.
:::

## Next episode {b}

Kettle now has three faces: an API for the mobile app, a Razor Pages admin site, and a Blazor storefront. All three still keep their data in memory, so every deploy wipes the orders. [Part V · Kettle Remembers →](ch:data-story)

## Further reading

- [JavaScript interop](https://learn.microsoft.com/en-us/aspnet/core/blazor/javascript-interoperability/)
- [Blazor authentication and authorization](https://learn.microsoft.com/en-us/aspnet/core/blazor/security/)
- [Blazor performance best practices](https://learn.microsoft.com/en-us/aspnet/core/blazor/performance)
- [Handle errors in Blazor apps](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/handle-errors)
- [bUnit](https://bunit.dev/)
