---
id: blazor-components
title: "Blazor Components: UI as C# Functions of State"
summary: "Kettle's storefront wants an instant basket, live stock and no JavaScript front end. Blazor builds UI from C# components. Covers what a component is and how rendering and diffing work, .razor syntax, parameters, child content and EventCallback, data binding with @bind, the component lifecycle in order, re-rendering rules and @key, cascading values, templated and generic components, forms with EditForm and validation, dependency injection and routing in components, state containers, CSS isolation, and the interview questions."
layer: framework
where: Web UI › Blazor components
fits: Blazor components run inside the same ASP.NET Core host as everything else ([Hosting](ch:aspnet-hosting)), use the same DI ([Dependency injection](ch:dependency-injection)) and, for forms, the same data annotations as [MVC](ch:razor-mvc). Where a component's code actually runs (server, browser or both) is the subject of [Render modes](ch:blazor-render-modes).
levels: b,i,a
prereqs: razor-mvc, delegates-events, async-await
next: blazor-render-modes
---

## The 30-second version

- A **component** is a C# class, usually written as a `.razor` file, that turns its **state** into **UI**. When the state changes, Blazor renders it again and sends only the **differences** to the page.
- Components take **parameters** from their parent, raise events back up with **`EventCallback`**, and can wrap other content (**`ChildContent`**).
- **`@bind`** connects an input to a field in both directions. **`@onclick`** and friends run C# when something happens.
- Lifecycle, in order: `SetParametersAsync` → `OnInitialized{Async}` (once) → `OnParametersSet{Async}` → render → `OnAfterRender{Async}`. Clean up in `Dispose`.
- After an event handler finishes, Blazor re-renders the component automatically. From other threads or timers, call `InvokeAsync(StateHasChanged)`.
- Use **`@key`** on repeated items so Blazor matches them by identity, not position.

## Words you'll meet

| Word | In plain words |
|---|---|
| **component** | A reusable piece of UI with its own state, written as a `.razor` file. |
| **render tree** | Blazor's in-memory description of what a component's HTML should be. |
| **diffing** | Comparing the new render tree with the old one, so only the changes are applied to the page. |
| **parameter** | A value a parent passes into a child component: `<ProductCard Product="tea" />`. |
| **`EventCallback`** | How a child tells its parent something happened, so the parent can re-render. |
| **`RenderFragment`** | A piece of UI passed around as a value, like the content between a component's tags. |
| **cascading value** | A value made available to every component below a point in the tree, without passing it by hand. |
| **lifecycle methods** | The methods Blazor calls as a component is created, updated, rendered and disposed. |
| **circuit** | In Blazor Server, one user's live connection and the component state that goes with it. |

## Previously at Kettle {b}

Kettle's admin site works well as server-rendered pages. The storefront is a different story. Customers want the basket total to update the moment they change a quantity, stock levels that change on screen, and order tracking that moves without refreshing. The team doesn't have a JavaScript specialist, and they'd rather not maintain a second language and a second build.

**The problem:** rich, instant interactivity, but written in C#, sharing models and validation with the server.

**This episode:** Blazor components: how they're built, how they render and re-render, how they talk to each other, and how forms work. Where the code runs is the next episode.

## Start from zero: UI as a function of state {b}

:::plain
You don't write "change this element's text". You write "here's what the page looks like for this state". When the state changes, Blazor works out what's different and updates just that.
:::

Old-style UI code says *how* to change the page: find the basket total element, set its text, find the badge, add a class. Every change is a set of instructions, and it's easy for the page and the data to drift apart.

Blazor flips this round. A component describes *what the UI should be* for its current state:

```razor
<p>Basket: @Items.Count items, £@Items.Sum(i => i.Price * i.Quantity)</p>
```

When `Items` changes, the component **renders again**, producing a fresh description, the **render tree**. Blazor compares it with the previous render tree (**diffing**), works out the smallest set of changes ("this text node changed from £12.50 to £19.00"), and applies only those to the browser's page. You never touch the page directly, so it can't drift from the data.

This is the same idea as React, but the components are C# and the diffing is done by the .NET runtime, either on the server or in the browser.

## Your first component {b}

:::plain
A `.razor` file is HTML plus C#. The `@code` block holds the component's state and methods. Clicking the button runs a method, the state changes, and Blazor re-renders.
:::

```razor
@* BasketLine.razor *@
<div class="line">
    <span>@Name</span>
    <button @onclick="Decrease" disabled="@(Quantity == 1)">−</button>
    <span>@Quantity</span>
    <button @onclick="Increase">+</button>
    <span>£@(Price * Quantity)</span>
</div>

@code {
    [Parameter, EditorRequired] public string Name { get; set; } = "";
    [Parameter] public decimal Price { get; set; }
    [Parameter] public int Quantity { get; set; } = 1;
    [Parameter] public EventCallback<int> QuantityChanged { get; set; }

    private Task Increase() => QuantityChanged.InvokeAsync(Quantity + 1);
    private Task Decrease() => QuantityChanged.InvokeAsync(Quantity - 1);
}
```

What each piece does:

- **The file is the class.** `BasketLine.razor` compiles to a C# class called `BasketLine`, deriving from `ComponentBase`. Markup becomes rendering code, as with MVC views.
- **`[Parameter]`** marks a property the parent may set: `<BasketLine Name="Sencha" Price="6.50m" />`. `[EditorRequired]` makes the compiler warn when a parent forgets it.
- **`@onclick="Increase"`** runs `Increase` when the button is clicked. Handlers can take the event details (`MouseEventArgs`) and can be `async`.
- **`EventCallback<int>`** reports the new quantity to the parent. It does two jobs: it calls the parent's handler, and it makes the **parent** re-render afterwards, which a plain `Action<int>` wouldn't.
- Attribute values like `disabled="@(Quantity == 1)"` take C# expressions. A `false` boolean attribute is left out entirely.

The parent owns the data, and the child reports changes:

```razor
@* Basket.razor *@
@foreach (var line in Lines)
{
    <BasketLine @key="line.Sku" Name="@line.Name" Price="line.Price"
                Quantity="line.Quantity" QuantityChanged="q => line.Quantity = q" />
}
<p>Total: £@Lines.Sum(l => l.Price * l.Quantity)</p>

@code {
    private List<LineState> Lines { get; } = [new("TEA-01", "Sencha", 6.50m, 1), new("TEA-02", "Assam", 4.00m, 2)];

    private sealed class LineState(string sku, string name, decimal price, int quantity)
    {
        public string Sku { get; } = sku;
        public string Name { get; } = name;
        public decimal Price { get; } = price;
        public int Quantity { get; set; } = quantity;
    }
}
```

Click **+** on Sencha:

1. `BasketLine.Increase` calls `QuantityChanged.InvokeAsync(2)`.
2. The parent's lambda runs: `line.Quantity = 2`.
3. Because it was an `EventCallback`, Blazor re-renders `Basket`. That produces a new render tree with Sencha's quantity at 2 and the total at £21.00.
4. Diffing finds two changes, the quantity text and the total text, and applies just those to the page.

The pair of `Quantity` and `QuantityChanged` parameters follows a naming convention. It lets the parent write `<BasketLine @bind-Quantity="line.Quantity" />` instead of wiring both by hand.

## Binding inputs {b}

:::plain
`@bind` keeps an input and a field in sync both ways: the field's value shows in the box, and typing in the box updates the field.
:::

```razor
<input @bind="Search" />                                @* updates when the input loses focus (onchange) *@
<input @bind="Search" @bind:event="oninput" />          @* updates on every keystroke *@
<input type="number" @bind="Quantity" @bind:after="SaveAsync" />   @* run SaveAsync after the value is set (.NET 7) *@
<input @bind:get="Postcode" @bind:set="SetPostcode" />  @* custom setter, e.g. to normalise the text *@
<input type="date" @bind="DeliveryDate" @bind:format="yyyy-MM-dd" />

@code {
    private string Search { get; set; } = "";
    private int Quantity { get; set; } = 1;
    private string Postcode { get; set; } = "";
    private DateOnly DeliveryDate { get; set; } = DateOnly.FromDateTime(DateTime.Today);
    private void SetPostcode(string value) => Postcode = value.Trim().ToUpperInvariant();
    private Task SaveAsync() => Task.CompletedTask;
}
```

`@bind` converts between the input's text and the field's type (`int`, `decimal`, `DateOnly`, enums). If the text can't be converted, the field keeps its old value. Inside an `EditForm`, the `Input*` components also report such conversion failures as validation errors.

## The component lifecycle {i}

:::plain
Blazor calls certain methods at certain moments: when the component first gets its parameters, every time its parameters change, and after it has drawn itself. Load data in the first, react to changes in the second, and touch JavaScript only in the third.
:::

| Method | When it runs | Use it for |
|---|---|---|
| `SetParametersAsync` | every time the parent passes parameters, before anything else | rarely overridden: advanced parameter handling |
| `OnInitialized` / `OnInitializedAsync` | **once**, when the component is first created | loading the data the component needs |
| `OnParametersSet` / `OnParametersSetAsync` | after initialisation, and again **whenever the parent re-renders** with new parameters | reloading when an `Id` parameter changes |
| *(render)* | after each of the above, and after event handlers | |
| `OnAfterRender` / `OnAfterRenderAsync(bool firstRender)` | after the component's output is on the page | JavaScript interop, focusing an input |
| `Dispose` / `DisposeAsync` | when the component is removed | unsubscribing from events, stopping timers |

```razor
@page "/orders/{Id:int}"
@implements IDisposable
@inject IOrderService Orders
@inject OrderUpdates Updates

@if (order is null) { <p>Loading…</p> }
else { <h1>Order @order.Number</h1> <p>Status: @order.Status</p> }

@code {
    [Parameter] public int Id { get; set; }
    private OrderView? order;

    protected override void OnInitialized() => Updates.Changed += OnOrderChanged;

    protected override async Task OnParametersSetAsync()
        => order = await Orders.GetAsync(Id);        // runs again when the URL changes /orders/42 → /orders/43

    private void OnOrderChanged(int changedId)
    {
        if (changedId == Id)
            _ = InvokeAsync(async () => { order = await Orders.GetAsync(Id); StateHasChanged(); });
    }

    public void Dispose() => Updates.Changed -= OnOrderChanged;   // or the service keeps this component alive
}
```

Three behaviours catch people out:

1. **Async methods render twice.** If `OnInitializedAsync` awaits something slow, Blazor renders once at the first `await` (so you see "Loading…"), then again when the method completes. That's why the markup handles `order is null`.
2. **`OnInitialized` doesn't run on navigation between two URLs for the same page.** Going from `/orders/42` to `/orders/43` reuses the component and only changes `Id`. Load data in `OnParametersSetAsync` if it depends on parameters.
3. **Forgetting `Dispose` leaks.** `Updates.Changed += …` makes a long-lived service hold a reference to the component, which keeps it, and everything it references, alive ([the event leak](ch:delegates-events)).

## When does a component re-render? {i}

A component renders again when:

- one of its **event handlers** finishes (for an `async` handler: once when it first awaits, and again when it completes);
- its **parent re-renders** and passes parameters that may have changed;
- it calls **`StateHasChanged()`** itself.

Calling `StateHasChanged` is only necessary when the change came from outside Blazor's own events: a timer, a message from a service, a background task. Those run on other threads, so marshal back with **`InvokeAsync(StateHasChanged)`**. Blazor processes each component's work one item at a time, like a UI thread, and `InvokeAsync` queues your code onto that.

**`@key` keeps list items matched to the right data.** Without it, Blazor matches a list's items **by position**. Insert a new order at the top, and Blazor thinks every row changed, updating each one. Worse, component state, such as an expanded panel or text typed into an input, stays with the *position*, so it ends up on the wrong order. With `@key="order.Id"`, Blazor matches items by their key: it inserts one new row and keeps every other row, and its state, where it belongs.

**Parameters and wasted renders.** When a parent re-renders, every child with parameters is offered a re-render too. Blazor skips a child automatically only if all its parameters are of known-immutable types (strings, numbers, `DateTime` and so on) and none changed. Pass a mutable object, such as a list or a class instance, and the child re-renders every time, because Blazor can't tell whether its contents changed. For expensive children, override `ShouldRender()`, or pass immutable records ([Blazor in production](ch:blazor-advanced) covers performance).

## Passing UI around: child content and templates {i}

**Child content.** A component can wrap whatever its parent puts between its tags:

```razor
@* Card.razor *@
<div class="card">
    <h2>@Title</h2>
    @ChildContent
</div>
@code {
    [Parameter] public string Title { get; set; } = "";
    [Parameter] public RenderFragment? ChildContent { get; set; }
}

@* usage *@
<Card Title="Today's offer"><p>20% off all green teas.</p></Card>
```

**Templates.** `RenderFragment<T>` is UI with a blank in it, which the component fills for each item. With `@typeparam`, a component is generic, so one list component works for orders, products or customers:

```razor
@* PagedList.razor *@
@typeparam TItem
@foreach (var item in Items.Skip(Page * Size).Take(Size))
{
    @Row(item)
}
<button @onclick="() => Page++" disabled="@((Page + 1) * Size >= Items.Count)">Next</button>
@code {
    [Parameter, EditorRequired] public IReadOnlyList<TItem> Items { get; set; } = [];
    [Parameter, EditorRequired] public RenderFragment<TItem> Row { get; set; } = default!;
    [Parameter] public int Size { get; set; } = 20;
    private int Page;
}

@* usage: the type is inferred from Items *@
<PagedList Items="orders" Context="order">
    <Row><p>@order.Number: £@order.Total</p></Row>
</PagedList>
```

## Cascading values: data for a whole subtree {i}

Some values are needed everywhere below a point: the current user, the theme, the selected store. Passing them through every level by hand is tedious. A **cascading value** makes a value available to every descendant that asks for it:

```razor
<CascadingValue Value="currentStore">
    <Router … />
</CascadingValue>

@* in any component below *@
@code {
    [CascadingParameter] public Store? CurrentStore { get; set; }
}
```

Since .NET 8 you can also register a cascading value for the whole app in DI: `builder.Services.AddCascadingValue(sp => new Store("London"));`. Authentication state is supplied this way (`AddCascadingAuthenticationState()`).

Cascading values are matched by **type** (or by name, with `Name`). Changing a cascaded value re-renders every component that receives it. For values that never change, set `IsFixed="true"`, so Blazor doesn't track subscribers.

## Forms and validation {b}

:::plain
`EditForm` wraps a model, the `Input` components bind to its properties, and a validator checks the data annotations. Your submit method runs only if everything is valid.
:::

```razor
<EditForm Model="address" OnValidSubmit="SaveAsync" FormName="delivery-address">
    <DataAnnotationsValidator />
    <ValidationSummary />

    <label>Postcode <InputText @bind-Value="address.Postcode" /></label>
    <ValidationMessage For="() => address.Postcode" />

    <label>Delivery day <InputDate @bind-Value="address.Day" /></label>
    <label>Gift wrap <InputCheckbox @bind-Value="address.GiftWrap" /></label>

    <button type="submit">Save</button>
</EditForm>

@code {
    [SupplyParameterFromForm] private DeliveryAddress address { get; set; } = new();
    private async Task SaveAsync() { /* … */ }

    public sealed class DeliveryAddress
    {
        [Required, RegularExpression(@"^[A-Z0-9 ]{5,8}$", ErrorMessage = "Enter a UK postcode")]
        public string Postcode { get; set; } = "";
        public DateOnly Day { get; set; } = DateOnly.FromDateTime(DateTime.Today.AddDays(1));
        public bool GiftWrap { get; set; }
    }
}
```

- **`EditForm`** creates an **`EditContext`** that tracks each field: is it modified, what are its errors. `OnValidSubmit` runs only if validation passes; `OnInvalidSubmit` and `OnSubmit` give you more control.
- **`DataAnnotationsValidator`** checks the same attributes as MVC. Validation runs as fields change and again on submit.
- **`InputText`, `InputNumber<T>`, `InputDate<T>`, `InputSelect<T>`, `InputCheckbox`, `InputRadioGroup<T>`, `InputFile`** bind with `@bind-Value` and add CSS classes (`modified`, `invalid`), so you can style errors.
- `FormName` and **`[SupplyParameterFromForm]`** matter when the form is rendered statically on the server (next episode): the form is then a real HTML form post, and these tell Blazor which model to bind the posted fields to. `EditForm` also adds an **antiforgery token** automatically.

For rules that annotations can't express, such as "delivery date must be a weekday in this postcode", add a custom validator component that writes into the `EditContext`'s `ValidationMessageStore`, or use a library such as FluentValidation with a Blazor integration. And as always, **validate again on the server**: anything that runs in the browser can be bypassed.

## Services, routing and layouts {i}

**Dependency injection.** `@inject IOrderService Orders` in markup, or `[Inject]` on a property, gets a service from the container. .NET 9 also allows **constructor injection** in components. A crucial difference from MVC is what **scoped** means:

| Where the component runs | One "scope" lasts for… |
|---|---|
| Static server rendering | one HTTP request, as in MVC |
| Interactive Server | one **circuit**: the user's whole session in that browser tab, often many minutes |
| Interactive WebAssembly | the whole app in that tab, so scoped behaves like singleton |

So a scoped `DbContext` injected into an interactive Server component lives for the whole session and is shared by every operation in it, which is a recipe for stale data and concurrency errors. Inject `IDbContextFactory<KettleDb>` instead, and create a short-lived context per operation (`await using var db = await factory.CreateDbContextAsync();`). `OwningComponentBase` gives a component its own DI scope that ends when the component is disposed.

**Routing.** `@page "/orders/{Id:int}"` makes a component routable, with the same constraint syntax as [Routing](ch:routing). A component can have several `@page` lines. Query-string values bind with `[SupplyParameterFromQuery]`. `NavigationManager.NavigateTo("/orders/42")` navigates from code, and `<NavLink href="/orders">` adds an `active` class when its URL matches. The `Router` component (in `Routes.razor`) finds the component for the URL and wraps it in its `@layout`, a component with a `@Body` placeholder.

**CSS isolation.** A file named `BasketLine.razor.css` applies only to that component. The build rewrites its selectors with a unique attribute, so `.line { … }` can't leak into other components. Use `::deep` to style a child component's elements from the parent.

## State that outlives a component {a}

Component fields disappear when the component is removed. For state that several components share, such as the basket shown in the header and on the basket page, use a **state container**: a service registered as scoped, holding the state and raising an event when it changes.

```csharp norun
public sealed class BasketState
{
    private readonly List<BasketItem> _items = [];
    public IReadOnlyList<BasketItem> Items => _items;
    public event Action? Changed;

    public void Add(BasketItem item) { _items.Add(item); Changed?.Invoke(); }
}
// Program.cs: builder.Services.AddScoped<BasketState>();
// components: @inject BasketState Basket, subscribe Changed → InvokeAsync(StateHasChanged), unsubscribe in Dispose
```

Where that state actually lives depends on the render mode. In Interactive Server it's in server memory, and a lost connection may lose it. In WebAssembly it's in the browser tab and survives connection drops, but not a refresh. State that must survive a refresh belongs in the URL (filters, page number), in browser storage, or on the server, such as a basket saved to the database or Redis. The next episode covers how state crosses from server rendering to interactivity.

## Interview questions {i}

:::qa What is a Blazor component and how does rendering work?
A component is a C# class, usually a `.razor` file compiled to a `ComponentBase` subclass, that describes its UI for its current state. When it renders, it produces a render tree; Blazor diffs it against the previous one and sends only the changes to the DOM. Components re-render after their event handlers run, when their parent re-renders with parameters that may have changed, or when they call `StateHasChanged`.
:::

:::qa What's the Blazor component lifecycle?
`SetParametersAsync` receives parameters, then `OnInitialized{Async}` runs once, then `OnParametersSet{Async}` runs on first load and whenever the parent supplies parameters again, then the component renders, then `OnAfterRender{Async}` runs with `firstRender` true the first time. Async lifecycle methods cause a render at the first incomplete await and again on completion. `Dispose`/`DisposeAsync` run when the component is removed.
:::

:::qa Why use EventCallback instead of Action for a child's events?
`EventCallback` invokes the parent's handler and then re-renders the parent, because it carries a reference to the component that created it. It also handles async handlers and errors properly. With a plain `Action` or `Func`, the parent's state changes but it doesn't re-render unless it calls `StateHasChanged` itself.
:::

:::qa What does @key do and when do you need it?
It tells the diffing algorithm to match elements and components by a key, such as an ID, instead of by position. Without it, inserting or reordering list items makes Blazor update every row and can attach component state, such as a typed value, to the wrong item. Use it on any list whose items can be inserted, removed or reordered.
:::

:::qa When do you need to call StateHasChanged, and why InvokeAsync?
Only when state changes outside Blazor's own event handling and lifecycle, such as from a timer, a service event or a background task. Those callbacks run on other threads, while each component's rendering is processed sequentially by its renderer, so wrap the call in `InvokeAsync(StateHasChanged)` to dispatch it correctly.
:::

:::qa What does "scoped" mean in Blazor, and why is it dangerous with DbContext?
It depends on the render mode: per request when rendering statically, per circuit (the user's whole session) in Interactive Server, and effectively singleton in WebAssembly. A scoped `DbContext` in Interactive Server therefore lives for the whole session and is shared by concurrent operations, leading to stale tracked data and threading errors. Use `IDbContextFactory` and a short-lived context per operation.
:::

:::qa How do Blazor components share state?
Parent to child through parameters, child to parent with `EventCallback`, a whole subtree with cascading values, and across unrelated components with a scoped state-container service that raises change events. State that must survive refreshes belongs in the URL, browser storage or server-side persistence.
:::

## Next episode {b}

Kettle's components work. But where do they run? The basket needs instant updates, the product pages need to be fast and visible to search engines, and the warehouse tablets need to keep working on a flaky connection. Blazor can run the same component on the server, in the browser, or both. [Episode 3 · Render modes →](ch:blazor-render-modes)

## Further reading

- [Blazor components](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/)
- [Component lifecycle](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/lifecycle)
- [Data binding](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/data-binding)
- [Forms and validation](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/)
- [State management](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management)
