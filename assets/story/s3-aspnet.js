// Part III: ASP.NET Core. Kettle becomes a web API.
(S => {
  S.scene({
    id: 'aspnet-hosting', part: 'p3', title: 'Program.cs, start to finish',
    hook: 'Kettle needs to answer HTTP requests, start cleanly and stop without dropping orders.',
    a: [
      ['code', 'prog', 175, 120, 'var builder = WebApplication\n  .CreateBuilder(args);\nbuilder.Services.Add…();\nvar app = builder.Build();\napp.Use…(); app.Map…();\napp.Run();'],
      ['box', 'kes', 470, 70, 'Kestrel', { sub: 'listens on :8080', w: 160, o: 0 }],
      ['box', 'pipe', 470, 170, 'Middleware pipeline', { w: 190, o: 0 }],
      ['box', 'ep', 470, 270, 'Endpoint', { sub: 'your handler', w: 160, o: 0 }],
      ['arr', 'k1', 'kes', 'pipe', '', { o: 0 }], ['arr', 'k2', 'pipe', 'ep', '', { o: 0 }],
      ['dot', 'rq', 470, 10, '', { o: 0 }],
      ['pill', 'sig', 175, 300, 'SIGTERM → drain, then stop', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'Phase one, the **builder**: register services and read configuration.', prog: { hl: [0, 1, 2] } },
      { say: '`Build()` freezes the services. Phase two: arrange the middleware and map the endpoints.', prog: { hl: [3, 4] }, show: ['pipe', 'ep', 'k2'] },
      { say: '`Run()` starts **Kestrel**, the web server. Every request flows through the pipeline to an endpoint.', prog: { hl: 5 }, show: ['kes', 'k1'], go: [['rq', 'kes', 'pipe', 'ep']] },
      { pro: true, say: 'The **host** owns the app\'s lifetime. On shutdown it stops accepting work, drains in-flight requests and stops background services.', show: ['sig'], prog: { hl: -1 }, pulse: ['sig'] }
    ],
    key: 'Register services, build, arrange the pipeline, run.'
  });

  S.scene({
    id: 'dependency-injection', part: 'p3', title: 'Let the container build it',
    hook: 'Every class news up its own dependencies. Swapping the payment provider means editing ten files.',
    a: [
      ['box', 'ctl', 120, 180, 'OrdersEndpoint', { sub: 'needs IPayment', w: 170 }],
      ['box', 'di', 340, 180, 'DI container', { w: 150, c: 'acc', o: 0 }],
      ['box', 'impl', 545, 180, 'CardPayment', { sub: 'registered as IPayment', w: 180, o: 0 }],
      ['arr', 'ask', 'ctl', 'di', 'asks for', { o: 0 }], ['arr', 'mk', 'di', 'impl', 'creates', { o: 0 }],
      ['pill', 'sg', 115, 300, 'Singleton: one per app', { o: 0, w: 200 }],
      ['pill', 'sc', 325, 300, 'Scoped: one per request', { o: 0, w: 200 }],
      ['pill', 'tr', 530, 300, 'Transient: new each time', { o: 0, w: 190 }],
      ['dot', 'dep', 545, 180, '', { o: 0 }]
    ],
    b: [
      { say: 'The endpoint asks for an `IPayment`. It does not know or care which class it gets.', pulse: ['ctl'] },
      { say: 'The **container** knows what is registered for each interface, builds it, and passes it in.', show: ['di', 'impl', 'ask', 'mk'], go: [['dep', 'di', 'ctl']] },
      { say: '**Lifetimes** decide how long an instance lives.', show: ['sg', 'sc', 'tr'] },
      { pro: true, say: 'A singleton that holds a scoped service keeps it forever: a **captive dependency**. Scope validation catches it in Development.', sg: { c: 'bad' }, sc: { c: 'bad' }, pulse: ['sg'] }
    ],
    key: 'Ask for interfaces; the container builds and manages lifetimes.'
  });

  const layers = ['appsettings.json', 'appsettings.Production.json', 'User secrets (dev)', 'Environment variables', 'Command line'];
  S.scene({
    id: 'configuration-options', part: 'p3', title: 'Settings in layers',
    hook: 'The payment key differs on a laptop, in staging and in production.',
    a: [
      ...layers.map((t, i) => ['pill', 'c' + i, 160, 310 - i * 55, t, { w: 250, c: 'mute' }]),
      ['txt', 'win', 160, 22, 'later layers win ↑', { mono: true }],
      ['code', 'opt', 470, 120, 'class PaymentOptions {\n  public string ApiKey…\n  [Range(1, 30)]\n  public int TimeoutS…\n}', { o: 0 }],
      ['pill', 'v', 470, 245, 'ValidateOnStart(): fail fast', { o: 0, c: 'ok' }],
      ['pill', 'kv', 470, 305, 'Secrets: Key Vault, never JSON', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'Configuration is a stack of sources. Each layer can override the ones below it.', acc: ['c0', 'c1', 'c2', 'c3', 'c4'] },
      { say: 'Bind a section to a typed **options** class, and validate it.', show: ['opt'] },
      { say: 'Validate at startup, so a bad setting fails the deploy, not the first customer.', show: ['v'] },
      { pro: true, say: '`IOptions` is read once, `IOptionsSnapshot` once per request, `IOptionsMonitor` live. Real secrets come from **Key Vault** or a managed identity.', show: ['kv'], pulse: ['c3'] }
    ],
    key: 'Layered sources, typed options, validated at startup.'
  });

  const mw = ['Exception handler', 'HTTPS redirect', 'Routing', 'Authentication', 'Authorization', 'Endpoint'];
  S.scene({
    id: 'middleware', part: 'p3', title: 'The request pipeline',
    hook: 'Every request needs logging, auth and error handling, and copying it into each endpoint won\'t scale.',
    a: [
      ...mw.map((t, i) => ['box', 'm' + i, 320, 35 + i * 58, t, { w: 260 - i * 18, h: 44 }]),
      ['dot', 'rq', 70, 35, '', { o: 0 }],
      ['txt', 'in', 70, 70, 'request ↓', { mono: true }],
      ['txt', 'out', 570, 70, '↑ response', { mono: true, o: 0 }],
      ['pill', 'sc', 545, 190, 'short-circuit: 401', { c: 'bad', o: 0 }]
    ],
    b: [
      { say: 'Middleware are layers the request passes through, in the order you add them.', go: [['rq', 'm0', 'm1', 'm2', 'm3', 'm4', 'm5']], acc: ['m5'] },
      { say: 'Each layer can act **before** and **after** the rest: `await next(context)`.', show: ['out'], go: [['rq', 'm4', 'm3', 'm2', 'm1', 'm0', [570, 35]]] },
      { say: 'Any layer can stop early. No valid token? Authentication returns 401 and the endpoint never runs.', show: ['sc'], bad: ['m3'], go: [['rq', 'm0', 'm1', 'm2', 'm3', [570, 175]]], plain: ['m5'] },
      { pro: true, say: '**Order matters**: the exception handler goes first so it catches everything, and authentication before authorization. Middleware is created once, so inject scoped services into `InvokeAsync`.', plain: ['m3'], acc: ['m0'], pulse: ['m0'] }
    ],
    key: 'Middleware wrap each other; order is behaviour.'
  });

  S.scene({
    id: 'routing', part: 'p3', title: 'Which code handles this URL?',
    hook: 'GET /orders/42 has to find exactly one handler.',
    a: [
      ['pill', 'url', 110, 70, 'GET /orders/42', { c: 'acc', w: 170 }],
      ['box', 'm', 110, 180, 'UseRouting', { sub: 'matches a template', w: 170 }],
      ['pill', 'e1', 450, 70, 'GET /orders', { w: 230 }],
      ['pill', 'e2', 450, 130, 'GET /orders/{id:int}', { w: 230 }],
      ['pill', 'e3', 450, 190, 'POST /orders', { w: 230 }],
      ['pill', 'e4', 450, 250, 'GET /orders/{id:int}/items', { w: 230 }],
      ['box', 'au', 110, 300, 'Authorization', { sub: 'reads endpoint metadata', w: 200, o: 0 }],
      ['dot', 't', 110, 70, '', { o: 0 }],
      ['pill', 'id', 450, 320, 'id = 42 → handler argument', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: 'Endpoints register **route templates**. `{id:int}` is a parameter with a constraint.', pulse: ['e2'] },
      { say: 'Routing compares the URL and method against every template and picks the best match.', go: [['t', 'm', 'e2']], acc: ['e2'] },
      { say: 'Route values bind to handler arguments by name.', show: ['id'] },
      { pro: true, say: 'Matching happens **before** authorization runs, so middleware in between can read the chosen endpoint\'s metadata, like `[Authorize]` or a rate-limit policy.', show: ['au'], go: [['t', 'au']], pulse: ['au'] }
    ],
    key: 'Templates match URLs; the matched endpoint carries its rules.'
  });

  S.scene({
    id: 'building-apis', part: 'p3', title: 'An endpoint, end to end',
    hook: 'POST /orders must accept JSON, reject bad input and say what it created.',
    a: [
      ['code', 'h', 320, 70, 'app.MapPost("/orders", (CreateOrder dto,\n    IOrderService svc) => …);'],
      ['pill', 'body', 90, 190, 'JSON body', { w: 120 }],
      ['pill', 'dto', 260, 190, 'CreateOrder', { w: 130 }],
      ['pill', 'val', 420, 190, 'Validation', { w: 120 }],
      ['pill', 'res', 565, 190, '201 Created', { w: 120, c: 'ok', o: 0 }],
      ['arr', 'b1', 'body', 'dto', 'bind'], ['arr', 'b2', 'dto', 'val', ''], ['arr', 'b3', 'val', 'res', '', { o: 0 }],
      ['pill', 'bad', 420, 290, '400 ProblemDetails', { c: 'bad', o: 0 }],
      ['arr', 'b4', 'val', 'bad', 'invalid', { o: 0, c: 'bad' }],
      ['dot', 't', 90, 190, '', { o: 0 }]
    ],
    b: [
      { say: 'Parameters bind automatically: the body to a DTO, the service from DI.', go: [['t', 'dto']] },
      { say: 'Valid input runs the handler and returns **201 Created** with a `Location`.', show: ['res', 'b3'], go: [['t', 'val', 'res']] },
      { say: 'Invalid input returns **400** with a standard ProblemDetails body.', show: ['bad', 'b4'] },
      { pro: true, say: 'Bind to **DTOs**, never entities, or clients can post fields you never meant to accept (**over-posting**). Typed results feed the OpenAPI document.', pulse: ['dto'], acc: ['dto'] }
    ],
    key: 'Bind to DTOs, validate, return precise status codes.'
  });

  S.scene({
    id: 'errors-logging', part: 'p3', title: 'When it breaks at 2 a.m.',
    hook: 'A customer sees a stack trace, and the logs are unsearchable text.',
    a: [
      ['box', 'ex', 110, 90, 'Exception', { c: 'bad', w: 140 }],
      ['box', 'eh', 320, 90, 'Exception handler', { w: 180 }],
      ['code', 'pd', 520, 90, '{ "status": 500,\n  "title": "Server error",\n  "traceId": "4bf9…" }'],
      ['arr', 'e1', 'ex', 'eh', ''], ['arr', 'e2', 'eh', 'pd', ''],
      ['code', 'log', 210, 260, 'log.LogWarning("Payment {OrderId}\n  declined: {Reason}", id, reason);', { o: 0 }],
      ['db', 'store', 540, 265, 'Log store', { sub: 'OrderId = 42', o: 0, c: 'why' }],
      ['arr', 'e3', 'log', 'store', '', { o: 0 }]
    ],
    b: [
      { say: 'Unhandled exceptions reach one handler, which returns a safe **ProblemDetails** body with a trace ID and no stack trace.', acc: ['eh'] },
      { say: '**Structured logging**: a message template plus named values, not a pasted-together string.', show: ['log'], log: { hl: [0, 1] } },
      { say: 'Each value becomes a searchable field, so you can find every log for order 42.', show: ['store', 'e3'], log: { hl: -1 } },
      { pro: true, say: '`[LoggerMessage]` source-generated methods log without allocating. Never log secrets, tokens or card numbers; use redaction.', pulse: ['log'] }
    ],
    key: 'One error handler, safe responses, structured logs.'
  });

  S.scene({
    id: 'auth', part: 'p3', title: 'Who are you, and may you?',
    hook: 'Anyone can call DELETE /orders/42.',
    a: [
      ['pill', 'tok', 90, 80, 'Bearer JWT', { c: 'acc', w: 130 }],
      ['box', 'authn', 300, 80, 'Authentication', { sub: 'who are you?', w: 180 }],
      ['box', 'authz', 300, 200, 'Authorization', { sub: 'may you?', w: 180 }],
      ['box', 'own', 300, 315, 'Resource check', { sub: 'is it YOUR order?', w: 180, o: 0 }],
      ['arr', 'a1', 'tok', 'authn', ''], ['arr', 'a2', 'authn', 'authz', '', { o: 0 }], ['arr', 'a3', 'authz', 'own', '', { o: 0 }],
      ['pill', 'chk', 520, 80, 'valid signature, not expired', { o: 0, c: 'ok' }],
      ['pill', 'p401', 520, 140, 'no valid token → 401', { o: 0, c: 'bad' }],
      ['pill', 'p403', 520, 200, 'not allowed → 403', { o: 0, c: 'bad' }],
      ['pill', 'pol', 520, 260, 'policy: role = Admin', { o: 0, c: 'why' }]
    ],
    b: [
      { say: '**Authentication** checks the token and builds a user with claims.', show: ['chk'] },
      { say: 'No valid token? **401**: we don\'t know who you are.', show: ['p401'] },
      { say: '**Authorization** applies policies to that user. Known but not allowed? **403**.', show: ['a2', 'p403', 'pol'] },
      { pro: true, say: 'Policies alone don\'t stop a customer reading **someone else\'s** order. Check ownership against the resource itself.', show: ['own', 'a3'], acc: ['own'], pulse: ['own'] }
    ],
    key: '401: who are you? 403: you may not. Then check the resource.'
  });

  S.scene({
    id: 'http-client', part: 'p3', title: 'Calling other services',
    hook: 'Under load, Kettle runs out of sockets calling the shipping API.',
    a: [
      ...[0, 1, 2, 3].map(i => ['pill', 'n' + i, 120, 70 + i * 50, 'new HttpClient()', { c: 'bad', w: 160, o: 1 }]),
      ['box', 'f', 300, 180, 'IHttpClientFactory', { sub: 'pooled handlers', w: 190, o: 0, c: 'acc' }],
      ['box', 'tc', 120, 180, 'ShippingClient', { sub: 'typed client', w: 170, o: 0 }],
      ['box', 'api', 545, 180, 'Shipping API', { w: 150 }],
      ['pill', 'res', 420, 300, 'timeout · retry · circuit breaker', { o: 0, c: 'ok' }],
      ['arr', 'h1', 'tc', 'f', '', { o: 0 }], ['arr', 'h2', 'f', 'api', '', { o: 0 }]
    ],
    b: [
      { say: 'A new `HttpClient` per call leaves sockets waiting to close. Under load, they run out.', pulse: ['n0', 'n1', 'n2', 'n3'] },
      { say: '**IHttpClientFactory** pools and recycles the connection handlers for you.', hide: ['n0', 'n1', 'n2', 'n3'], show: ['f', 'tc', 'h1', 'h2'] },
      { say: 'Add a resilience handler: timeouts, retries and a circuit breaker in one line.', show: ['res'] },
      { pro: true, say: 'One static `HttpClient` fixes sockets but never notices DNS changes, unless you set `PooledConnectionLifetime`. The default timeout is **100 seconds**: far too long.', pulse: ['f'] }
    ],
    key: 'Use the factory, typed clients and a resilience handler.'
  });

  S.scene({
    id: 'caching-ratelimit-cors', part: 'p3', title: 'Cache, limit, allow',
    hook: 'The tea catalogue is read 10,000 times a minute and changes once a day.',
    a: [
      ['box', 'api', 120, 120, 'API', { w: 120 }],
      ['box', 'c', 320, 120, 'Cache', { sub: 'Redis / memory', w: 150 }],
      ['db', 'db', 520, 120, 'Database'],
      ['arr', 'x1', 'api', 'c', ''], ['arr', 'x2', 'c', 'db', 'on a miss', { o: 0 }],
      ['dot', 't', 120, 120, '', { o: 0 }],
      ['pill', 'hc', 320, 215, 'HybridCache: one fetch for many misses', { c: 'ok', o: 0 }],
      ['pill', 'rl', 160, 300, 'Rate limit → 429', { c: 'warn', o: 0 }],
      ['pill', 'cors', 450, 300, 'CORS: the browser asks first', { c: 'why', o: 0 }]
    ],
    b: [
      { say: '**Cache-aside**: check the cache, fall back to the database on a miss, then store the result.', show: ['x2'], go: [['t', 'c', 'db', 'c', 'api']] },
      { say: 'When a hot key expires, a thousand requests miss at once: a **stampede**. HybridCache lets one of them fetch.', show: ['hc'], pulse: ['db'] },
      { say: '**Rate limiting** protects the API from its own popularity. Over the limit: 429.', show: ['rl'] },
      { pro: true, say: '**CORS** is enforced by browsers, not servers. It controls which websites may call you from JavaScript; it is not authentication.', show: ['cors'], pulse: ['cors'] }
    ],
    key: 'Cache hot reads, limit abuse, configure CORS for browsers.'
  });

  S.scene({
    id: 'background-work', part: 'p3', title: 'Work after the response',
    hook: 'Sending the confirmation email makes checkout 3 seconds slower.',
    a: [
      ['box', 'api', 110, 120, 'Checkout', { sub: 'returns at once', w: 150 }],
      ['box', 'ch', 320, 120, 'Channel<T>', { sub: 'bounded queue', w: 150, c: 'acc' }],
      ['box', 'bg', 530, 120, 'BackgroundService', { sub: 'sends email', w: 180 }],
      ['arr', 'b1', 'api', 'ch', ''], ['arr', 'b2', 'ch', 'bg', ''],
      ['dot', 'm', 110, 120, '✉', { o: 0 }],
      ['box', 'r1', 160, 285, 'Replica 1', { sub: 'nightly job', w: 140, o: 0 }],
      ['box', 'r2', 320, 285, 'Replica 2', { sub: 'nightly job', w: 140, o: 0 }],
      ['box', 'r3', 480, 285, 'Replica 3', { sub: 'nightly job', w: 140, o: 0 }]
    ],
    b: [
      { say: 'Checkout drops the email job on a queue and returns immediately.', go: [['m', 'ch']] },
      { say: 'A **BackgroundService** reads the queue and does the slow work.', go: [['m', 'bg']], ok: ['bg'] },
      { say: 'Scale to three replicas, and a scheduled job runs three times.', show: ['r1', 'r2', 'r3'], bad: ['r1', 'r2', 'r3'] },
      { pro: true, say: 'Use a **distributed lock** or a scheduler so one replica runs it. An in-memory queue loses work on restart; use a durable broker for anything that matters.', r1: { c: 'ok', sub: 'holds the lock' }, r2: { c: 'mute', sub: 'skips' }, r3: { c: 'mute', sub: 'skips' } }
    ],
    key: 'Queue slow work; make scheduled jobs run once.'
  });

  S.scene({
    id: 'api-design', part: 'p3', title: 'An API people can trust',
    hook: 'A mobile client retries POST /orders after a timeout. The customer is charged twice.',
    a: [
      ['user', 'app', 70, 180, 'Mobile app'],
      ['box', 'api', 330, 180, 'POST /orders', { sub: 'Idempotency-Key: 7f3a', w: 200 }],
      ['db', 'keys', 560, 180, 'Seen keys', { o: 0, c: 'why' }],
      ['dot', 'p1', 70, 180, '1', { o: 0 }], ['dot', 'p2', 70, 180, '2', { o: 0, c: 'warn' }],
      ['pill', 'r', 330, 300, 'Same key → return the first result', { o: 0, c: 'ok' }],
      ['pill', 'pg', 330, 60, 'GET /orders?cursor=…&limit=50', { o: 0 }]
    ],
    b: [
      { say: 'The first request succeeds, but the response is lost. The app retries.', go: [['p1', 'api']], api: { sub: 'no key' }, bad: ['api'] },
      { say: 'With an **idempotency key**, the server remembers what it already did.', show: ['keys'], api: { sub: 'Idempotency-Key: 7f3a', c: 'ok' }, go: [['p1', 'keys']] },
      { say: 'The retry with the same key gets the original response. One charge.', go: [['p2', 'api', 'keys']], show: ['r'] },
      { pro: true, say: 'Also: nouns and verbs, precise status codes, **cursor** pagination with a limit, ETags for safe concurrent updates, and versioning from day one.', show: ['pg'], pulse: ['pg'] }
    ],
    key: 'Make retries safe; be predictable everywhere else.'
  });

  S.scene({
    id: 'app-models', part: 'p3', title: 'Many front doors, one host',
    hook: 'Kettle needs an admin site, live order tracking and fast internal calls.',
    a: [
      ['box', 'core', 320, 185, 'ASP.NET Core host', { sub: 'same DI, config, middleware', w: 230, c: 'acc' }],
      ['pill', 'mvc', 130, 70, 'Razor Pages / MVC: HTML', { o: 0 }],
      ['pill', 'bz', 520, 70, 'Blazor: UI in C#', { o: 0 }],
      ['pill', 'sr', 120, 300, 'SignalR: live push', { o: 0 }],
      ['pill', 'grpc', 520, 300, 'gRPC: fast service calls', { o: 0 }],
      ['pill', 'wk', 320, 330, 'Worker service: no HTTP', { o: 0 }],
      ['pill', 'api', 320, 40, 'Minimal APIs: JSON', { c: 'ok' }]
    ],
    b: [
      { say: 'So far Kettle is a JSON API. The same host runs other kinds of app too.', pulse: ['core'] },
      { say: '**Razor Pages and MVC** render HTML on the server. **Blazor** builds interactive UI in C#.', show: ['mvc', 'bz'] },
      { say: '**SignalR** pushes live updates. **gRPC** makes compact, fast calls between services.', show: ['sr', 'grpc'] },
      { pro: true, say: 'Choose by the client: browsers want HTML or JSON, services want gRPC, live dashboards want SignalR. Underneath, it\'s one host.', show: ['wk'], pulse: ['core'] }
    ],
    key: 'Pick the app model by its client; the host underneath is the same.'
  });
})(window.STORY);
