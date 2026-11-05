---
id: razor-mvc
title: "MVC and Razor Pages: HTML Built on the Server"
summary: "Kettle's staff need an admin site: look up orders, issue refunds, edit the catalogue. Server-rendered HTML is the simplest way to build it. Covers how server rendering works, Razor syntax and its automatic encoding, MVC's models, views and controllers, layouts, partials, view components and tag helpers, forms with model binding, validation, antiforgery and Post/Redirect/Get, Razor Pages and their handlers, the MVC filter pipeline, how views are compiled, and when to choose MVC, Razor Pages or Blazor."
layer: framework
where: Web UI › Server-rendered HTML
fits: MVC and Razor Pages are endpoint types on the same host, DI, middleware and routing as your APIs ([Hosting](ch:aspnet-hosting), [Routing](ch:routing)). Their forms use the same model binding and validation as [Building APIs](ch:building-apis), and their cookies need the CSRF defences from [Web security](ch:web-security). [Blazor](ch:blazor-components) is the component-based alternative.
levels: b,i,a
prereqs: building-apis, routing
next: blazor-components
---

## The 30-second version

- **Server rendering:** the browser asks for a page, the server builds the HTML, the browser shows it. Forms post back to the server, which answers with a redirect or a new page. No JavaScript framework is required.
- **Razor** is HTML with C# mixed in, using `@`. Everything it writes is **HTML-encoded by default**, which blocks most XSS.
- **MVC** splits each request into a **controller** (decides what to do), a **model** (the data) and a **view** (the HTML). It suits sites with many related actions.
- **Razor Pages** puts each page's handler code next to its view (`Orders/Details.cshtml` + `DetailsModel`). It suits page-shaped sites like admin tools, and is usually simpler.
- Forms get **model binding**, **validation**, **antiforgery tokens** and the **Post/Redirect/Get** pattern almost for free.
- **Filters** run code around MVC actions and pages, much like middleware but with access to the action, its arguments and its result.

## Words you'll meet

| Word | In plain words |
|---|---|
| **server-side rendering (SSR)** | The server produces finished HTML for each request. |
| **Razor** | The syntax for mixing C# into HTML: `@Model.Total`, `@if (…) { … }`. |
| **controller / action** | A class (controller) whose public methods (actions) handle requests. |
| **view** | A `.cshtml` file that turns a model into HTML. |
| **view model** | A class shaped exactly for one view, not your database entity. |
| **layout** | The shared frame around every page: header, menu, footer. |
| **partial view** | A reusable piece of a view, like an order row. |
| **view component** | A partial view with its own logic and data loading, like a mini-controller. |
| **tag helper** | C# that runs on an HTML-looking tag: `<a asp-action="Details">` writes the right `href`. |
| **antiforgery token** | A hidden form value that proves a POST came from your own page, not another site. |
| **PRG** | Post/Redirect/Get: answer a successful form POST with a redirect, so refreshing doesn't resubmit. |
| **filter** | Code that runs before and after an MVC action or a Razor Page handler. |

## Previously at Kettle {b}

Kettle's API serves the mobile app and the storefront. Behind the scenes, though, the staff still fix orders by running SQL by hand. They need an admin site: find an order, issue a refund, edit a product, see today's numbers. It's a dozen screens, used by eight people, mostly forms and tables.

**The problem:** a whole single-page app, with its own build, routing and state management, is a lot of machinery for a dozen forms.

**This episode:** server-rendered HTML with MVC and Razor Pages, the oldest and simplest way to build a web UI in ASP.NET Core, and still the right one for many sites.

## Start from zero: how a server-rendered page works {b}

:::plain
The browser asks for a URL, the server sends back a complete HTML page, and the browser draws it. Clicking a link or submitting a form simply asks for the next page.
:::

1. Staff member opens `/orders/42`. The browser sends `GET /orders/42`.
2. ASP.NET Core routes it to C# code, which loads order 42 from the database.
3. That code hands the order to a **Razor view**, a template that writes HTML with the order's details filled in.
4. The server sends the finished HTML. The browser draws it. No JavaScript had to run.
5. The staff member fills in a refund form and presses **Refund**. The browser sends `POST /orders/42/refund` with the form fields.
6. The server checks the input, issues the refund, and answers with a **redirect** back to `/orders/42`, which the browser then loads with `GET`.

Compare that with a single-page app (SPA), where the browser downloads a JavaScript application once, which then calls a JSON API and builds the HTML itself:

| | Server-rendered | Single-page app |
|---|---|---|
| First page shown | fast: the HTML arrives ready | slower: download and start the app, then fetch data |
| Search engines | see the real content | need extra work (pre-rendering) |
| Interactivity | each action is a page load, unless you add some JavaScript | instant, app-like updates |
| Where the state lives | on the server, per request | in the browser |
| What you build | one project | a front end and an API |

For an admin tool, server rendering wins on simplicity. For a highly interactive screen, it doesn't, which is where [Blazor](ch:blazor-components) comes in.

## Razor syntax {b}

:::plain
Razor is HTML, and wherever you write `@`, it switches to C#. Whatever C# writes into the page is made safe for HTML automatically.
:::

```cshtml
@model OrderDetailsViewModel                       @* the type this view expects *@

<h1>Order @Model.Number</h1>                        @* an expression: writes the value *@
<p>Placed @Model.PlacedAt.ToString("d MMM yyyy") by @Model.CustomerName</p>
<p>Total: @(Model.Total + Model.Shipping)</p>       @* parentheses for anything more than a simple name *@

@if (Model.IsRefunded)
{
    <p class="badge">Refunded</p>                  @* HTML inside a C# block just works *@
}

<ul>
@foreach (var line in Model.Lines)
{
    <li>@line.Quantity × @line.ProductName, £@line.Price</li>
}
</ul>

@{
    var late = Model.PlacedAt < DateTime.UtcNow.AddDays(-3);   @* a plain C# code block *@
}
@if (late) { <text>Dispatch is late.</text> }       @* <text> outputs text without adding a tag *@
```

**Encoding is automatic.** If a customer's name is `<script>alert(1)</script>`, `@Model.CustomerName` writes `&lt;script&gt;…`, which the browser shows as text instead of running it. That one default blocks most cross-site scripting ([Web security](ch:web-security#xss-csrf-and-clickjacking)). The escape hatch, `@Html.Raw(value)`, writes HTML as-is. Use it only for HTML you produced yourself, never for anything a user typed.

Razor files are **compiled at build time** into C# classes, so a typo in a property name is a build error, not a runtime surprise.

## MVC: models, views and controllers {b}

:::plain
A controller method decides what to do, loads the data, and picks a view. The view only displays what it's given.
:::

```csharp norun
public sealed class OrdersController(KettleDb db) : Controller
{
    // GET /orders/42
    [HttpGet("/orders/{id:int}")]
    public async Task<IActionResult> Details(int id, CancellationToken ct)
    {
        var vm = await db.Orders
            .Where(o => o.Id == id)
            .Select(o => new OrderDetailsViewModel(o.Id, o.Number, o.PlacedAt, o.Customer.Name,
                o.Total, o.Shipping, o.RefundedAt != null,
                o.Lines.Select(l => new LineVm(l.Quantity, l.Product.Name, l.Price)).ToList()))
            .SingleOrDefaultAsync(ct);

        return vm is null ? NotFound() : View(vm);   // renders Views/Orders/Details.cshtml
    }
}
```

What each piece does:

- **Controller**: a class deriving from `Controller` (for views; `ControllerBase` for APIs). Its public methods are **actions**. Return values like `View(model)`, `RedirectToAction(…)`, `NotFound()` and `File(…)` all implement `IActionResult`, which decides what the response is.
- **View**: found by convention at `Views/{Controller}/{Action}.cshtml`, here `Views/Orders/Details.cshtml`, then in `Views/Shared/`. `View("Other", vm)` picks a different one.
- **View model**: `OrderDetailsViewModel` contains exactly what the page shows, already shaped. Passing EF entities into views invites lazy-loading surprises, over-posting on forms, and views that break when the database changes.

`ViewData` and `ViewBag` pass loosely typed values to a view. They're untyped dictionaries, so typos fail silently. Prefer properties on the view model.

**Registering MVC:**

```csharp norun
builder.Services.AddControllersWithViews();
var app = builder.Build();
app.UseStaticFiles();                 // or app.MapStaticAssets() in .NET 9+
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllerRoute("default", "{controller=Home}/{action=Index}/{id?}");   // conventional routes
app.Run();
```

Actions can use **attribute routes** (`[HttpGet("/orders/{id:int}")]`, as above) or the **conventional** route template, which maps `/Orders/Details/42` to `OrdersController.Details(42)`. Many apps use conventional routes for pages and attributes for anything irregular.

## Layouts, partials, view components and tag helpers {i}

**Layouts.** `Views/Shared/_Layout.cshtml` holds the page frame. `@RenderBody()` marks where each view's content goes. `@RenderSection("Scripts", required: false)` lets a view add, say, page-specific scripts. Two special files apply to every view in their folder and below:

- `_ViewStart.cshtml` runs first, and usually just sets `Layout = "_Layout";`.
- `_ViewImports.cshtml` holds shared `@using` lines and `@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers`.

**Partial views** are reusable fragments with no logic of their own: `<partial name="_OrderRow" model="line" />`. Use them to avoid repeating markup.

**View components** are for fragments that need **their own data**, like a "low stock" sidebar on every admin page. A view component is a class with an `InvokeAsync` method that can use DI and query the database, plus its own view:

```csharp norun
public sealed class LowStockViewComponent(KettleDb db) : ViewComponent
{
    public async Task<IViewComponentResult> InvokeAsync(int threshold)
    {
        var items = await db.Products.Where(p => p.Stock < threshold).OrderBy(p => p.Stock).Take(5).ToListAsync();
        return View(items);   // Views/Shared/Components/LowStock/Default.cshtml
    }
}
// in any view or the layout:  <vc:low-stock threshold="10" />
```

A partial only formats what it's given. A view component fetches what it needs. Don't make the layout's controller load sidebar data for every page.

**Tag helpers** look like HTML attributes, but they run C# on the server:

```cshtml
<a asp-action="Details" asp-route-id="@Model.Id">View order</a>   @* writes href="/orders/42", from your routes *@

<form asp-action="Refund" asp-route-id="@Model.Id" method="post">  @* adds the antiforgery token automatically *@
    <label asp-for="Amount"></label>                               @* label text from [Display] or the property name *@
    <input asp-for="Amount" />                                     @* name, id, type="number", current value, validation attributes *@
    <span asp-validation-for="Amount"></span>                      @* the error message for this field *@
    <button>Refund</button>
</form>

<environment include="Development"><p>Development build</p></environment>
<cache expires-after="@TimeSpan.FromMinutes(5)"><vc:low-stock threshold="10" /></cache>
```

`asp-action` builds URLs from your **routes**, so renaming a URL template doesn't leave broken links behind. `asp-for` uses the model's **property** to fill in `name`, `id`, the input `type`, the current value, and the client-side validation rules from your data annotations. The older HTML helpers (`@Html.TextBoxFor(m => m.Amount)`) do the same job in method form.

## Forms: binding, validation, antiforgery and PRG {b}

:::plain
The form's fields arrive as a C# object, the validation rules are checked for you, a hidden token proves the form came from your site, and a successful post ends with a redirect.
:::

```csharp norun
public sealed class RefundInput
{
    [Required, Range(0.01, 10_000)]
    public decimal Amount { get; set; }

    [Required, StringLength(200)]
    public string Reason { get; set; } = "";
}

[HttpPost("/orders/{id:int}/refund"), ValidateAntiForgeryToken]
public async Task<IActionResult> Refund(int id, RefundInput input, CancellationToken ct)
{
    if (!ModelState.IsValid)
        return View("Details", await LoadDetails(id, input, ct));   // show the page again, with errors and their input kept

    await refunds.IssueAsync(id, input.Amount, input.Reason, ct);
    TempData["Message"] = $"Refunded £{input.Amount:0.00}";       // survives exactly one redirect
    return RedirectToAction(nameof(Details), new { id });          // Post/Redirect/Get
}
```

Step by step:

1. **Model binding** reads the posted form fields (`Amount=12.50&Reason=Damaged`) into a `RefundInput`, the same machinery as in [Building APIs](ch:building-apis). Bind to an **input model** with only the fields the form should change. Binding straight to an entity lets an attacker post extra fields such as `IsAdmin=true` (over-posting).
2. **Validation** runs the data annotations and records any problems in `ModelState`. Check `ModelState.IsValid` yourself: unlike `[ApiController]` APIs, MVC actions don't return 400 automatically. With the validation scripts included, the same rules also run in the browser before submitting, but the server check is the one you can trust.
3. **Antiforgery.** Admin sites use cookie authentication, and browsers attach cookies to *every* request to your site, including one triggered by a malicious page elsewhere. The form tag helper adds a hidden token, and `[ValidateAntiForgeryToken]` rejects posts without a matching one. Add `AutoValidateAntiforgeryTokenAttribute` as a global filter so no action is forgotten.
4. **Post/Redirect/Get.** If a successful POST returned a page directly, refreshing it would resubmit the refund. Redirecting to a GET means a refresh just reloads the order. `TempData` carries the "Refunded £12.50" message across that redirect, then deletes it.

## Razor Pages: one page, one file pair {b}

:::plain
In Razor Pages, the URL is the file's location, and each page has its own small class handling its GET and POST. For screen-by-screen sites it's less ceremony than MVC.
:::

```text
Pages/
├── _ViewImports.cshtml
├── Shared/_Layout.cshtml
└── Orders/
    ├── Index.cshtml       + Index.cshtml.cs      → /Orders
    └── Details.cshtml     + Details.cshtml.cs    → /Orders/Details/42  (or a custom template)
```

```csharp norun
// Pages/Orders/Details.cshtml.cs
public sealed class DetailsModel(KettleDb db, IRefundService refunds) : PageModel
{
    public OrderDetailsViewModel Order { get; private set; } = default!;

    [BindProperty] public RefundInput Refund { get; set; } = new();   // bound on POST only, by default

    public async Task<IActionResult> OnGetAsync(int id, CancellationToken ct)
    {
        var order = await Queries.OrderDetails(db, id, ct);
        if (order is null) return NotFound();
        Order = order;
        return Page();
    }

    public async Task<IActionResult> OnPostRefundAsync(int id, CancellationToken ct)   // a named handler
    {
        if (!ModelState.IsValid) { Order = (await Queries.OrderDetails(db, id, ct))!; return Page(); }
        await refunds.IssueAsync(id, Refund.Amount, Refund.Reason, ct);
        TempData["Message"] = "Refund issued";
        return RedirectToPage(new { id });
    }

    public async Task<IActionResult> OnPostResendEmailAsync(int id, CancellationToken ct) { /* … */ return RedirectToPage(new { id }); }
}
```

```cshtml
@page "{id:int}"
@model DetailsModel

<h1>Order @Model.Order.Number</h1>
<form method="post" asp-page-handler="Refund" asp-route-id="@Model.Order.Id">
    <input asp-for="Refund.Amount" /> <span asp-validation-for="Refund.Amount"></span>
    <input asp-for="Refund.Reason" />
    <button>Refund</button>
</form>
<form method="post" asp-page-handler="ResendEmail" asp-route-id="@Model.Order.Id"><button>Resend email</button></form>
```

- `@page` makes the file an endpoint. Its route comes from its folder, plus an optional template (`"{id:int}"`).
- `OnGet`, `OnPost`, `OnPostRefund`: the method name picks the HTTP verb and, after `OnPost`, the **handler name**. `asp-page-handler="Refund"` makes the form post to `?handler=Refund`, so one page can have several forms.
- `[BindProperty]` binds form fields into a property on POST. Add `SupportsGet = true` only for harmless values like search filters.
- Antiforgery validation is **on by default** for Razor Pages.
- Protect whole folders in one line: `builder.Services.AddRazorPages(o => o.Conventions.AuthorizeFolder("/Admin", "StaffOnly"));`.

**MVC or Razor Pages?** They share everything underneath: Razor, tag helpers, binding, validation, filters. Razor Pages organises code **by page**, which fits sites where each screen is its own thing, like Kettle's admin. MVC organises code **by controller**, which fits many actions sharing one resource and the same dependencies. Both can live in one app.

## The MVC filter pipeline {i}

:::plain
Filters are like middleware that runs inside MVC, around one action. Because they run after routing and model binding, they can see which action is running and what its arguments are.
:::

When a request reaches an MVC action or a Razor Page, it passes through filters in a fixed order:

| Filter type | Runs | Typical use |
|---|---|---|
| **Authorization** | first, before anything else | `[Authorize]`, custom permission checks |
| **Resource** | before model binding, and after everything else | caching a whole response, short-circuiting early |
| **Action** (MVC) / **Page** (Razor Pages) | just before and after the action method, with its arguments available | validation, auditing (`[Audit]` from [Advanced C#](ch:advanced-csharp-reflection)), changing arguments |
| **Exception** | when the action or an earlier filter throws | turning domain exceptions into views or error codes |
| **Result** | before and after the result (the view) runs | adding headers, changing the result |

```csharp norun
public sealed class AuditRefundsFilter(IAuditLog audit) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        var executed = await next();                          // run the action
        if (executed.Exception is null && ctx.ActionArguments.TryGetValue("id", out var id))
            await audit.WriteAsync($"refund on order {id} by {ctx.HttpContext.User.Identity?.Name}");
    }
}
builder.Services.AddControllersWithViews(o => o.Filters.Add<AuditRefundsFilter>());   // global, from DI
// or per action: [ServiceFilter(typeof(AuditRefundsFilter))]
```

**Middleware or filter?** Middleware sees every request but not which MVC action will handle it. A filter sees the action, its arguments and its result, but only for MVC and Razor Pages. Use middleware for HTTP-level concerns (HTTPS, compression, CORS) and filters for application-level ones (auditing an action, translating domain errors). Minimal APIs have their own lighter equivalent, **endpoint filters** ([Building APIs](ch:building-apis)).

## In depth: how views are compiled and found {a}

**Views are C# classes.** At build time, the Razor compiler turns each `.cshtml` into a C# class deriving from `RazorPage<TModel>`. Literal HTML becomes `WriteLiteral("…")` calls, and `@expressions` become `Write(…)` calls that encode their value. That's why Razor errors show up in the build, and why views are fast: nothing is parsed per request. During development, the `Microsoft.AspNetCore.Mvc.Razor.RuntimeCompilation` package recompiles changed views without a rebuild. Hot Reload covers most of that need now; never ship runtime compilation to production.

**How a view is found.** `View()` with no name uses the action name. The view engine searches `Views/{Controller}/{Action}.cshtml`, then `Views/Shared/{Action}.cshtml`. With **areas** (`[Area("Admin")]`), `Areas/Admin/Views/…` comes first. You can add your own locations, for example "feature folders" that keep a feature's controller, views and view models together, by implementing `IViewLocationExpander`.

**Model binding sources and order.** For a complex type, MVC looks in form fields, then route values, then the query string, unless you say `[FromForm]`, `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromBody]` or `[FromServices]`. Custom types can bind from a string by implementing `IParsable<T>` (or a `TryParse` method), or through a custom `IModelBinder` for anything more complex.

**Output caching.** Pages that are the same for everyone, such as the public catalogue, can be cached whole with `app.UseOutputCache()` and `[OutputCache(Duration = 60)]`, with tag-based eviction when a product changes ([Caching](ch:caching-ratelimit-cors)). The `<cache>` tag helper caches a fragment inside a page that otherwise varies per user.

**Adding interactivity without a framework.** Server-rendered pages can get small dynamic touches without becoming an SPA. A sprinkle of JavaScript works, and so does **htmx**, a small library that lets an element fetch a partial view and swap it into the page (`hx-get="/orders/42/lines"`). Return those fragments from MVC as `PartialView(…)`, or from Razor Pages as `Partial(…)`. For richer interactivity in C#, use Blazor instead.

## Choosing: MVC, Razor Pages or Blazor {i}

| You're building | Choose |
|---|---|
| An admin tool or internal site: forms, tables, a few dozen screens | **Razor Pages** |
| A large site with many actions per resource, or an existing MVC codebase | **MVC** |
| Mostly static public pages that must be fast and indexable | Razor Pages, MVC, or **Blazor static SSR** |
| Rich interactivity (live updates, drag and drop, instant validation) written in C# | **Blazor** interactive render modes |
| A front end owned by a JavaScript team | an SPA (React, Angular, Vue) plus your API |

Since .NET 8, Blazor can also render pages statically on the server, like Razor Pages, and add interactivity only where it's needed. New projects often start there. Razor Pages and MVC remain fully supported and are the simplest choice for form-heavy sites. The next episode covers Blazor.

## Interview questions {i}

:::qa What's the difference between MVC and Razor Pages?
Both are server-side HTML frameworks on the same Razor, binding, validation and filter infrastructure. MVC routes requests to actions on controllers and finds views by convention, so related actions share a controller. Razor Pages pairs each page's `.cshtml` with a `PageModel` holding its handlers (`OnGet`, `OnPost…`), with routes from the folder structure. Razor Pages suits page-centred sites like admin tools; MVC suits many actions around shared resources. Both can coexist in one app.
:::

:::qa How does Razor protect against XSS, and when can you break that?
Every `@expression` is HTML-encoded before it's written, so user data containing markup is shown as text. `@Html.Raw` and `HtmlString` bypass encoding and should only carry HTML you generated or sanitised. Encoding is context-specific, so values placed inside JavaScript or attributes need care, and a Content-Security-Policy is a second layer.
:::

:::qa What is the Post/Redirect/Get pattern and why use it?
After a successful form POST, the server responds with a redirect to a GET page instead of rendering a page directly. Refreshing then repeats the harmless GET, not the POST, so the browser doesn't offer to resubmit a refund or an order. TempData carries a one-time message across the redirect.
:::

:::qa How does antiforgery protection work in MVC and Razor Pages?
The form tag helper writes a hidden token tied to a cookie, and the server validates that the posted token matches. A malicious site can make the browser send your cookies but can't read your page to get the token, so its forged POST fails. Razor Pages validate automatically; for MVC, use `[ValidateAntiForgeryToken]` or the global `AutoValidateAntiforgeryTokenAttribute`. It matters for cookie-authenticated apps, not for bearer-token APIs.
:::

:::qa What are MVC filters and how do they differ from middleware?
Filters run inside MVC and Razor Pages, after routing and model binding, in a fixed order: authorization, resource, action or page, exception and result. Unlike middleware, they know which action is executing, can read and change its arguments and result, and can be applied per action, per controller or globally. Use middleware for HTTP-level concerns across all endpoints and filters for application concerns tied to actions.
:::

:::qa Partial view vs view component?
A partial view renders markup from a model it's given and has no logic or dependencies. A view component is a class with `InvokeAsync` that can use DI and load its own data, plus a view, so it suits self-contained widgets such as a cart summary or a low-stock panel that appear on many pages.
:::

:::qa Why use view models instead of passing entities to views?
A view model contains exactly what the page needs, already shaped, so the view doesn't trigger lazy loading or depend on the database schema. On forms, binding to a dedicated input model prevents over-posting, where an attacker posts extra fields such as `IsAdmin` that would otherwise be bound onto the entity.
:::

## Next episode {b}

Kettle's admin site works, and the staff love it. Meanwhile, the storefront team wants the basket to update instantly, live order tracking, and stock levels that change on screen, all without writing a JavaScript front end. [Episode 2 · Blazor components →](ch:blazor-components)

## Further reading

- [Razor syntax reference](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/razor)
- [Razor Pages architecture and concepts](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/)
- [Tag helpers](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/tag-helpers/intro)
- [Filters in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters)
- [Prevent cross-site request forgery](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery)
