// Explanations for Part III (ASP.NET Core).
(S => {
  S.explain('aspnet-hosting', {
    base: [
      '**HTTP** is the language browsers, apps and servers use to talk. A request has a **method** (GET to read, POST to create, and so on), a **URL** (`/orders/42`), headers and sometimes a body. The response has a **status code** (200 OK, 404 Not Found...) and usually a body.',
      '**ASP.NET Core** is .NET\'s framework for web apps and APIs. It does the HTTP work so your code only handles "what should happen for this request".',
      'A **web server** is the part that listens on a network port and accepts connections. In ASP.NET Core it\'s built into your own program and called **Kestrel**.',
      '`Program.cs` is where a web app starts. It has a set-up half and a running half.'
    ],
    beats: [
      '`WebApplication.CreateBuilder(args)` creates a **builder**. It has already loaded configuration (settings files, environment variables) and logging. You now **register services**: tell the app which classes it can create when code needs them, such as the database context or the payment client. Nothing runs yet; you are filling in a list.',
      '`builder.Build()` turns that list into the finished app; after this, no more services can be added. Then you set up how requests are handled: **middleware** (steps every request passes through, like error handling and authentication) and **endpoints** (the code for each URL, such as `app.MapGet("/teas", ...)`).',
      '`app.Run()` starts Kestrel, which listens for connections. For each request, Kestrel builds an `HttpContext` object (the request plus a response being filled in) and sends it through the middleware to the matching endpoint. The response travels back out the same way.',
      'The **host** looks after the whole app\'s lifetime. When the server is told to stop (a deploy, a scale-down), it stops accepting new connections, lets requests already in progress finish, tells background services to stop, and only then exits. Without that, deploys would cut orders off halfway.'
    ]
  });

  S.explain('dependency-injection', {
    base: [
      'A **dependency** is something a class needs to do its job: an order service needs a database and a payment client.',
      'If a class creates its dependencies itself with `new`, it\'s glued to those exact classes: you can\'t swap them for a different provider or a fake in a test without editing it.',
      '**Dependency injection** (DI) flips it: the class lists what it needs in its constructor, and someone else supplies it.',
      'In ASP.NET Core that "someone" is the **DI container**, set up in `Program.cs`.'
    ],
    beats: [
      'The checkout endpoint declares a parameter of type `IPayment`, an interface. It only cares that whatever arrives can `Charge`. It doesn\'t know whether that\'s Stripe, PayPal or a test fake, so changing provider never touches the endpoint.',
      'At startup you registered `builder.Services.AddScoped<IPayment, CardPayment>()`: "when someone asks for `IPayment`, create a `CardPayment`". When the request arrives, the container sees the endpoint needs an `IPayment`, creates a `CardPayment` (and anything that needs, the same way), and passes it in. Swapping providers is now one line.',
      'A **lifetime** says how long one created instance is reused. **Singleton**: one instance for the whole app, shared by all requests. **Scoped**: one per request, thrown away when the request ends (EF Core\'s `DbContext` is scoped). **Transient**: a new one every time it\'s asked for.',
      'If a singleton receives a scoped service in its constructor, it keeps that one instance forever, so a per-request object (say, one customer\'s `DbContext`) gets shared by every request at the same time: a **captive dependency**, which causes data mixing and threading errors. In Development, ASP.NET Core\'s scope validation throws at startup when it detects this.'
    ]
  });

  S.explain('configuration-options', {
    base: [
      '**Configuration** is the settings an app reads instead of hard-coding: connection strings, API keys, timeouts, feature switches.',
      'The same compiled app runs on a laptop, in testing and in production, so settings must come from outside the code and differ per place.',
      'A **secret** is a setting that must never be shared, such as a password or API key. Secrets must never be committed to source control.',
      'An **environment variable** is a named value set on the machine or container, outside the app.'
    ],
    beats: [
      'ASP.NET Core reads settings from several sources, in order: `appsettings.json` (defaults), `appsettings.Production.json` (per environment), user secrets on a developer laptop, environment variables, then command-line arguments. Later sources override earlier ones, so a server can change one value without editing files. All of them merge into one set of keys like `Payments:ApiKey`.',
      'Reading strings by name everywhere invites typos. Instead, write a small class, `PaymentsOptions { string ApiKey; int TimeoutSeconds; }`, and **bind** the `Payments` section to it. Code then receives a typed object. Validation attributes like `[Required]` and `[Range]` describe what\'s allowed.',
      'With `ValidateOnStart()`, the app checks all settings while starting. A missing key stops startup, so the deploy fails and the old version keeps running. Without it, the problem appears only when a customer first triggers that code.',
      'There are three ways to receive options. `IOptions<T>` is read once and never changes. `IOptionsSnapshot<T>` is re-read for each request. `IOptionsMonitor<T>` notifies you the moment a value changes. In production, real secrets come from a secret store such as Azure **Key Vault**, accessed with a **managed identity** so no password is stored anywhere.'
    ]
  });

  S.explain('middleware', {
    base: [
      'Many things must happen for **every** request: logging, catching errors, checking who the user is, compressing the response. Copying that code into every endpoint would be repetitive and easy to forget.',
      '**Middleware** is a small component that every request passes through. You add several in `Program.cs`, and together they form the **pipeline**.',
      'Each middleware receives the request and a `next` function that runs the rest of the pipeline.'
    ],
    beats: [
      'The request enters the first middleware (exception handling), which passes it to the next (HTTPS redirection), then routing, authentication, authorization and so on, until it reaches the endpoint, your code. The order is exactly the order of the `app.Use...` lines in `Program.cs`.',
      'A middleware does some work, then calls `await next(context)` to run everything after it, then does more work when that returns. So the response passes back through each layer in reverse. A timing middleware starts a stopwatch before `next` and stops it after, measuring everything inside.',
      'A middleware doesn\'t have to call `next`. Authentication sees no valid token, sets status 401 and returns. The layers after it, including your endpoint, never run. This is called **short-circuiting**, and it\'s how one layer can protect everything behind it.',
      'Because each layer only sees what the layers before it let through, order is behaviour. The exception handler goes first so it can catch errors from everything else. Authentication (who are you?) must come before authorization (may you?). Middleware objects are created once for the whole app, so per-request services are taken as parameters of `InvokeAsync`, not the constructor.'
    ]
  });

  S.explain('routing', {
    base: [
      'An app has many **endpoints**, each a piece of code for one kind of request: list teas, get order 42, create an order.',
      '**Routing** decides which endpoint handles an incoming request, by looking at its URL path and HTTP method.',
      'A **route template** is a URL pattern with placeholders: `/orders/{id}` matches `/orders/42` and captures `42` as `id`.'
    ],
    beats: [
      'Each endpoint is registered with a template: `app.MapGet("/orders/{id:int}", GetOrder)`. `{id}` is a **route parameter**, and `:int` is a **constraint**: this route only matches if that part of the URL is a whole number, so `/orders/abc` doesn\'t match.',
      'For `GET /orders/42`, routing checks the method and path against every registered template. If several could match, the most specific wins: a fixed segment like `/orders/latest` beats `/orders/{id}`. If none match, the result is 404.',
      'The captured value `42` is passed to the handler parameter with the same name, `int id`, already converted to a number. Your code never parses the URL itself.',
      'Routing runs in two steps: **matching** early in the pipeline, and **executing** the endpoint at the end. In between, middleware such as authorization and rate limiting can look at the chosen endpoint\'s **metadata**, like `[Authorize]` or a rate-limit policy, and decide what to do before your code runs.'
    ]
  });

  S.explain('building-apis', {
    base: [
      'An **API** (application programming interface) is a set of URLs other programs call to use your service. A web API usually exchanges data as **JSON**, a text format like `{"teaId": 7, "quantity": 2}`.',
      'A **DTO** (data transfer object) is a small class that describes exactly what a request or response contains, such as `CreateOrder`.',
      '**Binding** is ASP.NET Core filling your handler\'s parameters from the request: the URL, the query string, headers, the JSON body.',
      '**Validation** checks the input is acceptable before your business code uses it.'
    ],
    beats: [
      'The handler looks like `(CreateOrder dto, IOrderService svc) => ...`. ASP.NET Core sees a complex type and reads it from the JSON body; it sees a registered service and takes it from DI. Simple values like `int id` come from the route or query string.',
      'With valid input, the handler creates the order and returns `Results.Created("/orders/42", order)`. Status **201 Created** says a new thing exists, and the **Location** header says where to find it. Precise status codes let clients react correctly without reading text.',
      'If required fields are missing or values are out of range, the API returns **400 Bad Request** with a **ProblemDetails** body: a standard JSON shape listing what\'s wrong with each field. Every client can handle errors the same way.',
      'If you bind straight to a database entity, a client can send extra fields, like `"isPaid": true` or `"price": 0`, and they get saved: **over-posting**. A DTO only contains the fields you mean to accept. Using typed results also lets ASP.NET Core describe every response in its **OpenAPI** document, which generates documentation and client code.'
    ]
  });

  S.explain('serialization', {
    base: [
      '**Serialization** turns an object into text or bytes to send or store, such as C# object → JSON. **Deserialization** is the reverse.',
      '.NET\'s built-in JSON library is **System.Text.Json**.',
      'The JSON your API sends and accepts is a **contract**: other programs are written against those exact names and shapes, and changing them breaks those programs.'
    ],
    beats: [
      'Only property names and values travel in JSON, not your C# class. If you rename `Total` to `Amount`, an old client still sends `total`, nothing matches, and the value is silently left at its default. Treat JSON names as a published contract and change them deliberately.',
      'ASP.NET Core uses "web defaults": property names are written in camelCase (`orderId`, the JavaScript convention), and reading ignores case. Enums are numbers by default (`"status": 2`), which is meaningless and breaks if the enum order changes, so register a string enum converter to get `"status": "Paid"`.',
      'If a property\'s type is a base class like `Payment`, the receiver needs to know which subclass to create. A **discriminator** field (`"$type": "card"`) says which, and you list the allowed subtypes explicitly. Never let input name an arbitrary .NET type to create: attackers have used that to run code.',
      'Creating serializer options is expensive because it builds caches, so create them once and reuse them. The JSON **source generator** writes the serialization code at compile time, which makes startup faster, avoids reflection and is required for Native AOT.'
    ]
  });

  S.explain('errors-logging', {
    base: [
      'When code throws an exception nobody catches, the request fails. What the caller sees, and what the developers can find out later, depends on how errors and logs are set up.',
      'A **stack trace** lists the methods that were running when the error happened. It\'s vital for developers and dangerous to show the public, because it reveals internals.',
      'A **log** is a record the app writes about what it\'s doing, used to investigate problems later. A **trace ID** links every log line from one request together.'
    ],
    beats: [
      'An exception handler placed first in the pipeline catches anything unhandled. It returns status 500 with a **ProblemDetails** body: a short title, the status code and a trace ID, but no stack trace and no internal details. The full exception goes to the logs, where developers can find it using that trace ID.',
      '`logger.LogInformation("Order {OrderId} paid by {CustomerId}", order.Id, customer.Id)` is a **message template** with named placeholders. Don\'t build the message yourself with `$"..."`: the logging system needs the values separately.',
      'A structured-logging backend stores each placeholder as its own field. So you can search "OrderId = 42" and get every line about that order, across every server, or count failures per customer. With plain text you could only grep and hope.',
      'Logging inside very busy code can cost time and memory. `[LoggerMessage]` makes the compiler generate a fast logging method that does almost nothing when that log level is switched off. And logs get copied, kept and read widely, so never log passwords, tokens, card numbers or personal data you don\'t need.'
    ]
  });

  S.explain('auth', {
    base: [
      '**Authentication** answers "who are you?". **Authorization** answers "are you allowed to do this?". They\'re separate steps.',
      'A **token** is a signed piece of data the client sends with each request, usually in the `Authorization: Bearer ...` header, proving who it is. A **JWT** (JSON Web Token) is the common format.',
      'A **claim** is one fact about the user inside the token: their ID, email, or role.',
      'A **policy** is a named rule, such as "must be an admin" or "must have the orders:write permission".'
    ],
    beats: [
      'The authentication middleware reads the token and checks its signature (so it wasn\'t forged or changed), its issuer, its audience and its expiry. If all is well, it builds `HttpContext.User` from the claims inside, so later code knows who is calling.',
      'No token, or an invalid or expired one, and the request isn\'t authenticated. An endpoint that requires a user returns **401 Unauthorized**, which really means "unauthenticated": we don\'t know who you are, so sign in.',
      'Authorization then checks the known user against the endpoint\'s policy. A customer calling an admin-only endpoint is known but not permitted: **403 Forbidden**. Signing in again won\'t help.',
      'Policies check general rules, like "is a customer". But `GET /orders/42` must also check that order 42 **belongs** to this customer, otherwise anyone signed in can read anyone\'s orders by changing the number. That check needs the order itself, so it happens after loading it ("resource-based authorization"). It\'s the most common real-world security bug.'
    ]
  });

  S.explain('http-client', {
    base: [
      'Backends often call other services: a shipping API, a payment provider, another team\'s service. In .NET you do that with `HttpClient`.',
      'Each call uses a **TCP connection** over a **socket**, the operating system\'s handle for a network connection. Opening one takes time, so connections are reused for many calls.',
      'A **circuit breaker** stops calling a service that\'s failing, giving it time to recover instead of piling on more requests.'
    ],
    beats: [
      'Creating `new HttpClient()` for every call and disposing it closes the connection, but the operating system keeps each closed socket in a waiting state for a while. Under load, thousands pile up, the server runs out of sockets, and every outgoing call fails.',
      '`IHttpClientFactory` manages the underlying connection handlers for you: it keeps them in a pool, reuses connections, and replaces handlers every few minutes. You register a client once (`AddHttpClient<ShippingClient>()`) and inject it wherever it\'s needed.',
      'Calls to other services fail sometimes. `AddStandardResilienceHandler()` adds, in one line, a timeout per attempt, retries with growing gaps between them, and a circuit breaker. Your code just makes the call.',
      'One shared static `HttpClient` also avoids running out of sockets, but it keeps its connections open forever, so if the other service moves to a new IP address (a DNS change), it never notices. Setting `PooledConnectionLifetime` makes it reconnect periodically. And `HttpClient`\'s default timeout is 100 seconds: much too long for a user who is waiting, so always set your own.'
    ]
  });

  S.explain('caching-ratelimit-cors', {
    base: [
      'A **cache** keeps a copy of data that\'s expensive to fetch, so the next request can use the copy. It trades freshness for speed.',
      'The cache can be in the app\'s own memory (very fast, but separate on each server) or shared, such as **Redis** (one copy for all servers, one network hop away).',
      '**Rate limiting** caps how many requests a client may make in a period.',
      'A browser\'s **same-origin policy** stops JavaScript on one website from reading responses from another website, unless that other site allows it. **CORS** is how the API says who is allowed.'
    ],
    beats: [
      'The catalogue changes once a day but is read 10,000 times a minute. **Cache-aside**: look in the cache first; if it\'s there (a hit), return it. If not (a miss), read the database, store the result with an expiry time, and return it. Almost every request now skips the database.',
      'When a popular cache entry expires, every request arriving at that moment misses and goes to the database together, a **stampede**, which can overload it. `HybridCache` makes concurrent misses for the same key wait for one database call and share the result. It also combines fast in-memory caching with a shared Redis cache.',
      'A rate limiter counts requests per client (by user, API key or IP address) within a time window. Over the limit, the API answers **429 Too Many Requests**, ideally with a `Retry-After` header. One misbehaving script can\'t slow the site for everyone else.',
      'CORS doesn\'t protect your API from other servers or scripts: they can call it freely. It only tells **browsers** which other websites\' JavaScript may read your responses. Allow only your own front-end origins, and never treat CORS as authentication.'
    ]
  });

  S.explain('background-work', {
    base: [
      'Some work doesn\'t have to finish before the customer gets an answer: sending an email, resizing images, syncing with another system.',
      'A **queue** holds jobs in order until a worker picks them up.',
      'A **BackgroundService** is a class the host starts with the app and runs alongside request handling, for the app\'s whole life.',
      'A **replica** is one running copy of the app. Production often runs several for capacity and resilience.'
    ],
    beats: [
      'Checkout used to send the confirmation email itself, waiting 3 seconds for the email provider before responding. Now it puts a "send email for order 42" job on a queue and responds straight away. The customer sees the confirmation page instantly.',
      'A `BackgroundService` runs a loop: take the next job from the queue, send the email, repeat. If the email provider is slow, nobody is waiting. Within one process, a `Channel<T>` is a fast, built-in queue for this.',
      'With three replicas running, each one has its own background service. A job scheduled for "every night at 2 a.m." now runs three times: three invoices, three reminder emails.',
      'To run a job exactly once, take a **distributed lock** that only one replica can hold (for example in the database or Redis), or use a scheduler such as Hangfire or Quartz. Also, an in-memory queue disappears when the app restarts or deploys. Work that must not be lost goes to a durable message broker or a database table.'
    ]
  });

  S.explain('api-design', {
    base: [
      '**REST** is a common style for web APIs: URLs name things ("resources" such as `/orders/42`), and HTTP methods say what to do with them: GET reads, POST creates, PUT replaces, PATCH changes part, DELETE removes.',
      'Networks are unreliable. A client can send a request, the server can do the work, and the response can still get lost on the way back. The client doesn\'t know whether it worked.',
      'An operation is **idempotent** if doing it twice has the same effect as doing it once.'
    ],
    beats: [
      'The app sends `POST /orders`. The server creates the order and charges the card, but the mobile connection drops before the reply arrives. From the app\'s point of view the request timed out, so it sends it again.',
      'The app generates a unique **idempotency key** (a random ID) per checkout and sends it as a header. The server stores the key with the result of the first successful attempt, in the same transaction as the order.',
      'When the retry arrives with the same key, the server finds it, doesn\'t charge again, and returns the original response. The customer is charged once, and the app can retry safely whenever it\'s unsure.',
      'Other habits of a trustworthy API: URLs are nouns and methods are verbs; status codes are precise; lists are **paginated** with a limit and a cursor ("give me the next page after this item"), so nobody downloads a million rows; **ETags** (version stamps) stop two people overwriting each other\'s changes; and a versioning plan exists before the first breaking change is needed.'
    ]
  });

  S.explain('app-models', {
    base: [
      'An **app model** is a style of web application: a JSON API, server-rendered HTML pages, an interactive UI, live updates, or fast service-to-service calls.',
      'ASP.NET Core supports all of them on the same foundation: the same host, configuration, DI, middleware and authentication.',
      'The right choice depends on **who the client is**: a browser, a mobile app, or another service.'
    ],
    beats: [
      'Until now Kettle has been a JSON API that apps call. But the shop also needs an admin website, live order tracking for customers, and fast calls between its own services.',
      '**Razor Pages** and **MVC** build HTML on the server with C# templates and send finished pages to the browser: simple, fast and search-engine friendly. **Blazor** builds interactive pages from C# components, running on the server or in the browser via WebAssembly. Part IV covers both.',
      '**SignalR** keeps a connection open between browser and server, so the server can push "your order has shipped" the moment it happens instead of the browser asking every few seconds. **gRPC** is a fast, strongly typed way for services to call each other, using a shared contract file and a compact binary format.',
      'Rules of thumb: public browser pages → Razor Pages or Blazor; mobile and third-party clients → JSON APIs; internal service calls → gRPC or JSON; live dashboards and notifications → SignalR. They can all live in one app, sharing the same services and security.'
    ]
  });
})(window.STORY);
