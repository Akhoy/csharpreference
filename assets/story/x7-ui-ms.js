// Explanations for Part IV (web UI) and Part IX (microservices).
(S => {
  S.explain('razor-mvc', {
    base: [
      'A web page is **HTML**, the text format browsers display. It can be built in the browser by JavaScript, or on the server and sent ready-made.',
      '**MVC** (model-view-controller) splits a server-rendered page into three parts: the **controller** handles the request, the **model** is the data, and the **view** turns that data into HTML.',
      '**Razor** is the template syntax for views: HTML with C# mixed in, such as `<h1>@Model.Title</h1>`. **Razor Pages** is a simpler variant that puts each page\'s handler and view side by side.',
      'A **form** lets a user send data back to the server, usually with a POST request.'
    ],
    beats: [
      'A staff member opens `/orders/42`. Routing picks the `OrdersController.Details(42)` **action** (a method on the controller), which loads order 42 from the database through a service.',
      'The action builds a **view model**, an object with exactly what the page shows, and passes it to the Razor view. The view fills in the HTML template. Anything written with `@` is **HTML-encoded**: if a customer\'s name contains `<script>`, it\'s shown as text instead of running, which blocks a common attack (cross-site scripting).',
      'The browser receives a complete HTML page and displays it at once. No JavaScript framework has to download and run first, which makes such pages fast to appear and easy for search engines to read. For a dozen admin forms and tables, that\'s the simplest option.',
      'The refund form POSTs to the server. If the refund succeeds, the server answers with a **redirect** to the order page instead of a page directly (the Post/Redirect/Get pattern). Refreshing then reloads the order page rather than resubmitting the refund.',
      'Each form includes a hidden **antiforgery token** that another website can\'t know, so a malicious site can\'t trick a logged-in staff member\'s browser into submitting a refund. **Filters** are code that runs before and after actions, for things like audit logging or converting errors into friendly responses.'
    ]
  });

  S.explain('blazor-components', {
    base: [
      '**Blazor** builds interactive web UIs in C# instead of JavaScript.',
      'A **component** is a reusable piece of UI, written in a `.razor` file: some markup plus the C# that drives it, such as a basket line with + and − buttons.',
      'Components nest: a basket component contains line components. Data flows down as **parameters**; events flow back up.',
      '**Rendering** means working out what the UI should look like from the current data.'
    ],
    beats: [
      'The customer clicks **+** on a basket line. The line component doesn\'t own the basket, so it calls an **EventCallback** parameter its parent gave it: in effect "tell my parent the quantity should go up".',
      'The parent updates its data (that line\'s quantity is now 3) and **re-renders**: it runs its markup again and produces a new **render tree**, an in-memory description of what the UI should look like.',
      'Blazor compares (**diffs**) the new render tree with the previous one and finds the differences: one number and one total changed. It updates only those parts of the real page, not the whole thing, which keeps updates fast.',
      'In a list, Blazor matches old and new items by position unless told otherwise. Insert a row at the top and it thinks every row changed, re-rendering all of them and possibly moving one row\'s state (like a half-typed input) onto another. `@key="line.Id"` tells it which item is which.'
    ]
  });

  S.explain('blazor-render-modes', {
    base: [
      'A Blazor component\'s C# code has to run somewhere: on the server or in the browser. The **render mode** decides where, and whether the component is interactive.',
      '**SEO** (search engine optimisation): search engines index pages best when the HTML arrives complete.',
      '**WebAssembly** (Wasm) lets browsers run compiled code, including the .NET runtime, at near-native speed.',
      'A **WebSocket** is a connection that stays open so the browser and server can send messages either way at any time.'
    ],
    beats: [
      '**Static server-side rendering** (the default): for each request the server runs the component, sends finished HTML and forgets about it. It\'s fast, cheap and indexable, ideal for product pages. But buttons can\'t react without a full page reload, because nothing is running anymore.',
      '**Interactive Server**: the component keeps running on the server, connected to the browser through a WebSocket called a **circuit**. A click travels up, C# runs on the server, and the small UI change travels back down. It\'s instant to start and the code stays on the server, but each connected user uses server memory, and it needs a steady connection.',
      '**Interactive WebAssembly**: the browser downloads the .NET runtime and your app once, then runs components itself. There\'s no server cost per user and it keeps working with a patchy connection. But the first load is bigger, and anything in the browser can be read, so no secrets go there: data comes through APIs.',
      'Interactive components are first **prerendered** on the server as plain HTML, so the page appears immediately, then become interactive once the circuit connects or WebAssembly loads. Their initialisation therefore runs twice (once per phase), which can mean two database calls, unless you persist the prerendered state for the second run.'
    ]
  });

  S.explain('blazor-advanced', {
    base: [
      'Real apps sometimes need JavaScript: a payment provider\'s widget, a chart library. Blazor calls it through **JavaScript interop**.',
      'An unhandled exception in an Interactive Server component can end the user\'s whole **circuit**, the live connection, so the page stops working.',
      'Rendering thousands of rows at once is slow in any UI technology.'
    ],
    beats: [
      'JavaScript works on the page\'s elements, which only exist after the component has rendered. So JS calls go in `OnAfterRenderAsync` (on the first render), usually by importing a small JavaScript module that the component then calls. During prerendering there\'s no browser at all, so JS can\'t run then.',
      'One product in the history has corrupt data, and its component throws while rendering. With Interactive Server, an unhandled exception ends the circuit: the whole page dies and the user must reload.',
      'Wrapping risky parts in an `<ErrorBoundary>` contains the failure: that one item shows fallback content ("couldn\'t display this item"), the error is logged, and everything else keeps working.',
      '`<Virtualize>` renders only the rows currently visible plus a few extra, swapping them as the user scrolls, so 4,000 rows cost about the same as 30. More generally, most Blazor slowness comes from components re-rendering when nothing they show has changed. Check what triggers renders before optimising anything else.'
    ]
  });

  S.explain('ms-boundaries', {
    base: [
      'Splitting a monolith into services starts with deciding where the boundaries go. This decision is the hardest to undo later.',
      'A good boundary keeps things that **change together** inside one service, so a typical feature touches only one service and one team.',
      'A **business capability** is something the business does, like taking payments, managing the catalogue or shipping orders.'
    ],
    beats: [
      'Kettle\'s monolith is already divided into **modules** with clear interfaces: catalogue, ordering, payments, fulfilment. Each changes for its own business reasons. That internal structure is the best evidence of where services could be cut.',
      'Cut along business capabilities. A "Payments" service holds everything about payments: its rules, its data, its integrations. A change to how refunds work happens entirely inside it, deployed by its own team, without coordinating with anyone.',
      'The tempting mistake is one service per database table: Customers, Orders, Products. Then every feature, such as "place an order", needs changes in several services that must be deployed together, and every request makes chains of network calls. You get a **distributed monolith**: all the costs of distribution, none of the independence.',
      'Don\'t split everything at once. Extract one capability at a time with the **strangler fig** approach: build the new service, route its traffic there behind a feature flag, keep the old code as a fallback, then delete it. Start with something peripheral and well understood, like Payments, not the core of the system.'
    ]
  });

  S.explain('ms-communication', {
    base: [
      'Inside a monolith, one part calls another with a method call: instant and reliable. Between services, the same call goes over the **network**: slower, and it can fail or time out.',
      'Services can talk **synchronously** (call and wait for the answer, usually HTTP or gRPC) or **asynchronously** (send a message through a broker and carry on).',
      'A **contract** is the agreed shape of the requests, responses or messages between services.'
    ],
    beats: [
      'Clients (the website, the mobile app) shouldn\'t know about a dozen internal services. An **API gateway** (such as YARP) is the single front door: it routes each URL to the right service and checks tokens and rate limits once, at the edge, instead of in every service.',
      'Ordering can\'t confirm an order without knowing if payment succeeded, so it calls Payments **synchronously** and waits. It passes a **deadline** ("I need an answer within 2 seconds") down the chain, so Payments stops working on a request nobody is waiting for any more.',
      'Fulfilment doesn\'t need to answer Ordering right now; it just needs to know an order was placed. So Ordering publishes an **event** to the broker. If Fulfilment is down for an hour, events queue up and are processed when it\'s back. Ordering never notices.',
      'Services deploy independently, so a change to a contract must not break the other side: add optional fields, never remove or rename existing ones. With **consumer-driven contract tests**, each consumer records what it relies on, and the provider\'s build checks every change against those records, catching breaking changes before they deploy.'
    ]
  });

  S.explain('ms-data', {
    base: [
      'In a microservice system, each service has its **own database**, and other services may not read or write it directly. Otherwise a schema change in one service breaks others, and they can\'t deploy independently.',
      'In one database, a **JOIN** combines tables in a single query, and a **transaction** keeps several changes consistent. Neither works across separate databases.',
      '**Eventual consistency** means copies of data may briefly disagree but will catch up.'
    ],
    beats: [
      'Ordering owns the orders database, Catalogue owns products, Customers owns customers. Other services get data only through the owner\'s API or events. Each team can change its own schema freely.',
      'The "My orders" page needs orders with product names and customer details, now in three databases. A single SQL JOIN is impossible, and there\'s no transaction that spans all three.',
      'One solution is a **read model**: a separate store built for that page. It subscribes to events (OrderPlaced, ProductRenamed) and keeps a ready-made, denormalised copy of exactly what the page shows. The page reads one place, fast, even if Catalogue is down, at the cost of data being maybe a second behind.',
      'A business process spanning services, like "take payment, reserve stock, ship", becomes a **saga**: a series of local transactions, each publishing an event that triggers the next, with **compensating** steps (refund, release stock) if a later step fails. Keep each rule that must never be broken, like "never oversell", inside one service, where a normal transaction can enforce it.'
    ]
  });

  S.explain('ms-operations', {
    base: [
      'Everything you did once for the monolith (building, deploying, monitoring, securing, testing) now has to be done for every service.',
      'Without shared tooling, each team reinvents it, slightly differently. Running many services well depends far more on this operational groundwork than on the code.'
    ],
    beats: [
      'Each service has its own pipeline that builds, tests and deploys it on its own. That independence is the main reason to have services at all, and it only holds if nothing forces services to deploy together.',
      'One customer request may cross five services. A **trace ID**, created at the edge and passed with every call and message, ties all their logs and spans together. With OpenTelemetry in every service, you can follow one failing request across the whole system.',
      'Being inside the private network doesn\'t prove a caller is legitimate: an attacker who gets into one service could call all the others. Each service checks the caller\'s identity, using tokens (OAuth client credentials) or mutual TLS certificates, and allows only what that caller needs. This is called **zero trust**.',
      'A shared test environment with every service deployed is slow, flaky and always broken by someone. Test each service alone, plus **contract tests** for the boundaries between them. And give teams a **paved road**: templates with logging, health checks, tracing and pipelines already set up, plus .NET Aspire for running several services locally, so the right way is also the easy way.'
    ]
  });
})(window.STORY);
