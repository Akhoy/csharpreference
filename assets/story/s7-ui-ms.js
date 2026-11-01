// Parts IV and IX: Web UI (MVC, Razor Pages, Blazor) and Microservices.
(S => {
  S.scene({
    id: 'razor-mvc', part: 'pui', title: 'Pages built on the server',
    hook: 'Staff fix orders with hand-written SQL. They need an admin site: a dozen forms and tables.',
    a: [
      ['user', 'u', 60, 180, 'Staff'],
      ['box', 'ctl', 250, 90, 'OrdersController', { sub: 'loads the order', w: 190 }],
      ['box', 'view', 250, 270, 'Details.cshtml', { sub: 'Razor view', w: 190 }],
      ['pill', 'html', 500, 180, 'finished HTML', { w: 150 }],
      ['arr', 'a1', 'u', 'ctl', 'GET', { o: 0 }],
      ['arr', 'a2', 'ctl', 'view', 'view model', { o: 0 }],
      ['arr', 'a3', 'view', 'html', '', { o: 0 }],
      ['dot', 't', 60, 180, '', { o: 0 }],
      ['pill', 'prg', 500, 80, 'POST → redirect → GET', { o: 0, c: 'why', w: 200 }],
      ['pill', 'af', 500, 290, 'antiforgery token checked', { o: 0, c: 'ok', w: 210 }]
    ],
    b: [
      { say: 'Staff open **/orders/42**. A controller action loads the order.', show: ['a1'], go: [['t', 'ctl']] },
      { say: 'The action hands a **view model** to a Razor view, which fills in the HTML. Everything it writes is encoded.', show: ['a2'], go: [['t', 'view']] },
      { say: 'The browser receives **finished HTML**. No JavaScript had to run.', show: ['a3'], go: [['t', 'html']], ok: ['html'] },
      { say: 'A refund form posts back. On success the server **redirects**, so a refresh can\'t refund twice.', show: ['prg'] },
      { pro: true, say: 'Forms carry an **antiforgery token**, and **filters** run around each action, for auditing or turning errors into responses.', show: ['af'], pulse: ['af'] }
    ],
    key: 'The server builds the HTML; forms post back and redirect.'
  });

  S.scene({
    id: 'blazor-components', part: 'pui', title: 'Render, diff, patch',
    hook: 'The basket should update instantly, without a JavaScript front end.',
    a: [
      ['box', 'parent', 180, 90, 'Basket', { sub: 'passes parameters ↓', w: 190 }],
      ['box', 'child', 180, 260, 'BasketLine', { sub: 'Sencha × 1', w: 170 }],
      ['arr', 'down', 'parent', 'child', '', { bend: 70 }],
      ['arr', 'up', 'child', 'parent', 'EventCallback', { o: 0, bend: 90, c: 'acc' }],
      ['pill', 'old', 480, 90, 'old tree: £6.50', { w: 190 }],
      ['pill', 'new', 480, 160, 'new tree: £13.00', { w: 190, o: 0 }],
      ['pill', 'diff', 480, 230, 'diff: 2 text changes', { w: 190, o: 0, c: 'acc' }],
      ['pill', 'key', 480, 310, '@key matches rows by ID', { w: 210, o: 0, c: 'why' }],
      ['dot', 't', 180, 260, '', { o: 0 }]
    ],
    b: [
      { say: 'The customer clicks **+**. The child tells its parent through an **EventCallback**.', show: ['up'], go: [['t', 'parent']] },
      { say: 'The parent updates the line and **re-renders**, producing a new render tree.', child: { sub: 'Sencha × 2' }, show: ['new'] },
      { say: 'Blazor **diffs** the new tree against the old one and applies only the changes to the page.', show: ['diff'], pulse: ['diff'] },
      { pro: true, say: 'In lists, `@key` matches rows by ID, so inserting a row doesn\'t re-render every row or move their state.', show: ['key'] }
    ],
    key: 'State changes, the component renders, Blazor patches only the difference.'
  });

  S.scene({
    id: 'blazor-render-modes', part: 'pui', title: 'Where does the C# run?',
    hook: 'Product pages need speed and SEO, the basket needs instant updates, the warehouse has patchy Wi-Fi.',
    a: [
      ['zone', 'z1', 110, 195, 'Static SSR', { w: 200, h: 290 }],
      ['zone', 'z2', 320, 195, 'Interactive Server', { w: 200, h: 290 }],
      ['zone', 'z3', 530, 195, 'WebAssembly', { w: 200, h: 290 }],
      ['box', 's1', 110, 115, 'Server', { sub: 'renders once', w: 160 }],
      ['box', 's2', 110, 270, 'Browser', { sub: 'shows HTML', w: 160 }],
      ['box', 'c1', 320, 115, 'Server', { sub: 'runs components', w: 160 }],
      ['box', 'c2', 320, 270, 'Browser', { sub: 'sends clicks', w: 160 }],
      ['box', 'w1', 530, 115, 'Server', { sub: 'files + API', w: 160 }],
      ['box', 'w2', 530, 270, 'Browser', { sub: 'runs .NET', w: 160 }],
      ['arr', 'sa', 's1', 's2', 'HTML', {}],
      ['arr', 'ca', 'c2', 'c1', 'circuit', { o: 0, both: true, dash: true }],
      ['arr', 'wa', 'w1', 'w2', 'download once', { o: 0 }],
      ['pill', 'pre', 320, 22, 'prerendered first: init runs twice', { o: 0, c: 'warn', w: 300 }]
    ],
    b: [
      { say: '**Static SSR**, the default: the server renders HTML per request and forgets it. Fast and indexable, not interactive.', acc: ['s1', 's2'] },
      { say: '**Interactive Server**: a live WebSocket **circuit**. Clicks go up, UI changes come down. Memory per user.', plain: ['s1', 's2'], acc: ['c1', 'c2'], show: ['ca'] },
      { say: '**WebAssembly**: the browser downloads .NET once and runs components itself. No server cost per user, but no secrets.', plain: ['c1', 'c2'], acc: ['w1', 'w2'], show: ['wa'] },
      { pro: true, say: 'Interactive components are **prerendered** first, so their initialisation runs twice unless you persist state.', show: ['pre'], pulse: ['pre'] }
    ],
    key: 'Static where you can, interactive where you must.'
  });

  S.scene({
    id: 'blazor-advanced', part: 'pui', title: 'Blazor goes live',
    hook: 'A JavaScript payment widget, a 4,000-row order history, and one bad record that crashes the page.',
    a: [
      ['box', 'comp', 150, 95, 'CardForm', { sub: 'component', w: 160 }],
      ['box', 'js', 460, 95, 'CardForm.razor.js', { sub: 'payment widget', w: 190, o: 0 }],
      ['arr', 'j', 'comp', 'js', 'after first render', { o: 0, both: true }],
      ['zone', 'eb', 150, 262, 'ErrorBoundary', { w: 250, h: 140 }],
      ['box', 'bad', 150, 272, 'BasketLine', { sub: 'throws', w: 160, o: 0 }],
      ['pill', 'fb', 150, 272, 'couldn\'t show this item', { o: 0, c: 'warn', w: 210 }],
      ['pill', 'virt', 460, 262, 'Virtualize: 15 of 4,000 rows', { o: 0, c: 'ok', w: 240 }]
    ],
    b: [
      { say: 'JavaScript runs only **after the first render**, through a module the component imports.', show: ['js', 'j'] },
      { say: 'One bad product throws. Without a boundary, the whole Server circuit would end.', show: ['bad'], bad: ['bad'], pulse: ['bad'] },
      { say: 'An **ErrorBoundary** catches it and shows fallback content for that item only.', hide: ['bad'], show: ['fb'] },
      { pro: true, say: 'Long lists render only what\'s visible with **Virtualize**. Most Blazor slowness is wasted re-renders.', show: ['virt'], pulse: ['virt'] }
    ],
    key: 'JS after render, boundaries around risk, render only what changed.'
  });

  // ---------- Part IX ----------
  const svc = ['Catalogue', 'Ordering', 'Payments', 'Fulfilment'];
  S.scene({
    id: 'ms-boundaries', part: 'pms', title: 'Where to cut',
    hook: 'A bad split is worse than no split. Where do you cut?',
    a: [
      ['zone', 'mono', 170, 180, 'Kettle monolith', { w: 300, h: 260 }],
      ...svc.map((t, i) => ['box', 'm' + i, i % 2 ? 240 : 100, i < 2 ? 125 : 235, t, { w: 120 }]),
      ...svc.map((t, i) => ['box', 's' + i, 500, 60 + i * 70, t + ' service', { sub: 'own data', w: 190, o: 0 }]),
      ['pill', 'ent', 450, 335, 'per-table services = distributed monolith', { o: 0, c: 'bad', w: 300 }]
    ],
    b: [
      { say: 'Kettle\'s monolith already has clean **modules**, each changing for its own reasons.', pulse: ['m0', 'm1', 'm2', 'm3'] },
      { say: 'Cut along **business capabilities**, so most changes stay inside one service.', show: ['s0', 's1', 's2', 's3'] },
      { say: 'Splitting per **table** instead makes every feature cross every service: a distributed monolith.', show: ['ent'] },
      { pro: true, say: 'Extract one capability at a time behind a feature flag (the **strangler fig**), starting with something peripheral like Payments.', hide: ['ent'], acc: ['s2'], mute: ['m2'] }
    ],
    key: 'Put what changes together inside one service.'
  });

  S.scene({
    id: 'ms-communication', part: 'pms', title: 'Calls and messages',
    hook: 'Method calls became network calls that are slow and sometimes fail.',
    a: [
      ['user', 'u', 50, 180, 'Client'],
      ['box', 'gw', 185, 180, 'Gateway', { sub: 'YARP', w: 130 }],
      ['box', 'ord', 360, 90, 'Ordering', { w: 130 }],
      ['box', 'pay', 560, 90, 'Payments', { w: 130 }],
      ['box', 'bus', 360, 275, 'Broker', { w: 130, c: 'acc' }],
      ['box', 'ful', 560, 275, 'Fulfilment', { w: 130 }],
      ['arr', 'x1', 'u', 'gw', ''], ['arr', 'x2', 'gw', 'ord', ''],
      ['arr', 'x3', 'ord', 'pay', '800 ms', { o: 0 }],
      ['arr', 'x4', 'ord', 'bus', 'OrderPlaced', { o: 0 }],
      ['arr', 'x5', 'bus', 'ful', '', { o: 0 }],
      ['dot', 't', 50, 180, '', { o: 0 }], ['dot', 'e', 360, 90, '', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'Clients see **one front door**. The gateway routes, checks tokens and rate-limits once.', go: [['t', 'gw', 'ord']] },
      { say: 'Ordering needs a payment answer now: a **synchronous** call, with the deadline passed down.', show: ['x3'], go: [['t', 'pay']] },
      { say: 'Everything else goes as an **event** through the broker, so Fulfilment can be down for a while.', show: ['x4', 'x5'], go: [['e', 'bus', 'ful']] },
      { pro: true, say: 'Contracts change only **compatibly**, and consumer-driven contract tests catch breaks in the provider\'s build.', pulse: ['ord', 'pay'] }
    ],
    key: 'Messages by default, calls when you need the answer now.'
  });

  S.scene({
    id: 'ms-data', part: 'pms', title: 'Data without a shared database',
    hook: 'No JOIN and no transaction can span the services any more.',
    a: [
      ['box', 'o', 110, 85, 'Ordering', { w: 130 }], ['box', 'p', 320, 85, 'Payments', { w: 130 }], ['box', 'f', 530, 85, 'Fulfilment', { w: 130 }],
      ['db', 'od', 110, 195, 'orders'], ['db', 'pd', 320, 195, 'payments'], ['db', 'fd', 530, 195, 'stock'],
      ['arr', 'a1', 'o', 'od', '', { nohead: true }], ['arr', 'a2', 'p', 'pd', '', { nohead: true }], ['arr', 'a3', 'f', 'fd', '', { nohead: true }],
      ['pill', 'nj', 320, 22, 'no JOIN, no shared transaction', { o: 0, c: 'bad', w: 260 }],
      ['box', 'rm', 320, 312, 'My orders read model', { w: 230, o: 0, c: 'why' }],
      ['dot', 'e1', 110, 85, '', { o: 0 }], ['dot', 'e2', 320, 85, '', { o: 0 }], ['dot', 'e3', 530, 85, '', { o: 0 }]
    ],
    b: [
      { say: 'Each service **owns its database**. Others never read its tables.', pulse: ['od', 'pd', 'fd'] },
      { say: 'So there\'s no JOIN and no transaction across them.', show: ['nj'] },
      { say: 'Events build a **read model** shaped for the "My orders" page: fast and resilient, a second behind.', show: ['rm'], go: [['e1', [190, 260], 'rm'], ['e2', [400, 260], 'rm'], ['e3', [450, 260], 'rm']] },
      { pro: true, say: 'Multi-service processes are **sagas**. Keep each invariant, like "never oversell", inside one service.', acc: ['f', 'fd'] }
    ],
    key: 'Own your data; read across with composition or read models.'
  });

  S.scene({
    id: 'ms-operations', part: 'pms', title: 'Running many services',
    hook: 'Everything done once for the monolith must now be done for every service.',
    a: [
      ...['Gateway', ...svc.slice(1)].map((t, i) => ['box', 'v' + i, 75 + i * 155, 125, t, { w: 120 }]),
      ['pill', 'tr', 310, 225, 'trace 4bf9…: one ID across every service', { o: 0, w: 520, c: 'acc' }],
      ['pill', 'zt', 310, 40, 'every call authenticated: zero trust', { o: 0, w: 290 }],
      ['pill', 'ct', 180, 315, 'contract tests per pair', { o: 0, c: 'ok', w: 210 }],
      ['pill', 'as', 450, 315, 'Aspire: run it all locally', { o: 0, c: 'why', w: 220 }]
    ],
    b: [
      { say: 'Four services, four pipelines. Each deploys **alone**.', pulse: ['v0', 'v1', 'v2', 'v3'] },
      { say: 'One **trace ID** follows a request through every service, so failures can be found.', show: ['tr'] },
      { say: 'Services **authenticate each other**. Being inside the network isn\'t trust.', show: ['zt'] },
      { pro: true, say: 'Test with **contracts**, not a giant shared environment, and give teams a **paved road** with templates and Aspire.', show: ['ct', 'as'], pulse: ['ct', 'as'] }
    ],
    key: 'Deploy alone, trace everything, trust nothing, test the contracts.'
  });
})(window.STORY);
