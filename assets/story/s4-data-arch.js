// Parts IV–VI: data access, architecture and design, testing.
(S => {
  S.scene({
    id: 'relational-fundamentals', part: 'p4', title: 'Tables, indexes, transactions',
    hook: 'Kettle\'s orders need to survive crashes, and finding them must stay fast.',
    a: [
      ['box', 'cust', 110, 80, 'Customers', { sub: 'Id (key)', w: 150 }],
      ['box', 'ord', 330, 80, 'Orders', { sub: 'CustomerId (foreign key)', w: 210 }],
      ['arr', 'fk', 'ord', 'cust', 'JOIN', {}],
      ...Array.from({ length: 8 }, (_, i) => ['dot', 'r' + i, 80 + i * 40, 190, '', { c: 'mute' }]),
      ['dot', 'scan', 80, 190, '?', { c: 'warn', o: 0 }],
      ['pill', 'ix', 520, 190, 'Index on Email: sorted', { c: 'ok', o: 0 }],
      ['box', 'tx', 330, 300, 'Transaction', { sub: 'debit + order: both or neither', w: 300, o: 0, c: 'acc' }]
    ],
    b: [
      { say: 'Data lives in **tables**. Keys link rows: each order points to its customer.', pulse: ['fk'] },
      { say: 'Without an **index**, finding one email means scanning every row.', go: [['scan', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']] },
      { say: 'An index keeps a sorted copy of a column, so the database jumps straight to the row.', show: ['ix'], go: [['scan', 'ix', 'r5']], ok: ['r5'] },
      { say: 'A **transaction** makes several changes act as one. All commit, or none do.', show: ['tx'] },
      { pro: true, say: '**Isolation levels** trade correctness for concurrency. Azure SQL defaults to read-committed snapshot: readers see the last committed version and don\'t block writers.', pulse: ['tx'] }
    ],
    key: 'Keys relate, indexes find, transactions protect.'
  });

  S.scene({
    id: 'ado-dapper', part: 'p4', title: 'Talking SQL directly',
    hook: 'One report needs hand-tuned SQL, and it must be safe from injection.',
    a: [
      ['box', 'conn', 100, 90, 'Connection', { sub: 'from the pool', w: 150 }],
      ['box', 'cmd', 320, 90, 'Command', { sub: 'SQL + parameters', w: 170 }],
      ['box', 'rd', 540, 90, 'Reader', { sub: 'row by row', w: 140 }],
      ['arr', 'a1', 'conn', 'cmd', ''], ['arr', 'a2', 'cmd', 'rd', ''],
      ['code', 'dp', 320, 215, 'var orders = await conn.QueryAsync<Order>(\n  "SELECT * FROM Orders WHERE Email = @email",\n  new { email });', { o: 0 }],
      ['pill', 'inj', 320, 320, '@email is sent as data, never as SQL', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: '**ADO.NET** is the base layer every .NET data tool uses: connection, command, reader.', pulse: ['cmd'] },
      { say: '**Dapper** runs your SQL and maps the rows onto objects for you.', show: ['dp'], dp: { hl: 0 } },
      { say: 'Values travel as **parameters**, so user input can never become SQL.', show: ['inj'], dp: { hl: 1 } },
      { pro: true, say: 'Connections are **pooled**: open late, close early, and the pool reuses them. A leaked connection drains the pool and every request waits.', dp: { hl: -1 }, pulse: ['conn'] }
    ],
    key: 'Parameterise everything; let the pool reuse connections.'
  });

  S.scene({
    id: 'efcore-fundamentals', part: 'p4', title: 'Objects in, rows out',
    hook: 'Hand-written SQL for every insert and update is slow to write and easy to get wrong.',
    a: [
      ['box', 'cls', 100, 110, 'Order class', { w: 140 }],
      ['box', 'ctx', 320, 110, 'DbContext', { sub: 'change tracker', w: 160, c: 'acc' }],
      ['db', 'db', 540, 110, 'Orders table'],
      ['arr', 'm1', 'cls', 'ctx', '', { both: true }], ['arr', 'm2', 'ctx', 'db', '', { both: true }],
      ['pill', 'chg', 320, 210, 'Status: Pending → Paid', { o: 0, c: 'warn' }],
      ['code', 'sql', 320, 290, 'UPDATE Orders SET Status = @p0\nWHERE Id = @p1;', { o: 0 }],
      ['pill', 'mig', 540, 210, 'Migration: add column', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'EF Core maps classes to tables. The **DbContext** is your unit of work.', pulse: ['ctx'] },
      { say: 'Load an order and change it. The **change tracker** notices.', show: ['chg'] },
      { say: '`SaveChanges()` writes only what changed, in one transaction.', show: ['sql'] },
      { say: '**Migrations** evolve the schema as the model changes.', show: ['mig'] },
      { pro: true, say: 'A DbContext is **not thread-safe**: one per request. In production, ship migrations as scripts or bundles, and never drop a column the running code still uses.', pulse: ['mig'] }
    ],
    key: 'Track changes, save once, migrate the schema with the model.'
  });

  S.scene({
    id: 'efcore-querying', part: 'p4', title: 'The N+1 trap',
    hook: 'The order list page sends 101 SQL queries.',
    a: [
      ['box', 'app', 110, 180, 'Order list', { w: 140 }],
      ['db', 'db', 520, 180, 'Database'],
      ...Array.from({ length: 6 }, (_, i) => ['dot', 'q' + i, 110, 180, '', { o: 0, c: 'bad' }]),
      ['dot', 'one', 110, 180, '1', { o: 0, c: 'ok' }],
      ['code', 'fix', 320, 310, 'db.Orders.Select(o => new { o.Id,\n  Customer = o.Customer.Name })', { o: 0 }],
      ['pill', 'cnt', 320, 60, '1 query + 100 more = 101', { c: 'bad', o: 0 }]
    ],
    b: [
      { say: 'Load 100 orders: one query.', go: [['q0', 'db']] },
      { say: 'Then the loop touches each order\'s customer, and each one triggers **another** query.', show: ['cnt'], go: [['q1', 'db'], ['q2', [300, 150], 'db'], ['q3', [300, 210], 'db'], ['q4', [250, 120], 'db'], ['q5', [250, 240], 'db']] },
      { say: 'Ask for what you need **up front**. A projection becomes one SQL query with a JOIN.', hide: ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'cnt'], show: ['fix'], go: [['one', 'db']] },
      { pro: true, say: 'For reads, use `AsNoTracking()` and project to DTOs. Large `Include` graphs explode into cartesian results; split queries fix that.', pulse: ['fix'] }
    ],
    key: 'One page, one query. Project what you need.'
  });

  S.scene({
    id: 'efcore-advanced', part: 'p4', title: 'Two people, one order',
    hook: 'Two staff members edit the same order. The second save silently wins.',
    a: [
      ['user', 'u1', 70, 100, 'Ana'],
      ['user', 'u2', 70, 270, 'Ben'],
      ['box', 'row', 340, 185, 'Order 42', { sub: 'RowVersion = 7', w: 170 }],
      ['dot', 'e1', 70, 100, 'A', { o: 0 }], ['dot', 'e2', 70, 270, 'B', { o: 0 }],
      ['pill', 'conf', 505, 270, 'DbUpdateConcurrencyException', { o: 0, c: 'bad' }],
      ['pill', 'qf', 530, 90, 'Global filter: TenantId', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'Both load version 7. Ana saves first; the version becomes 8.', go: [['e1', 'row']], row: { sub: 'RowVersion = 8', c: 'ok' } },
      { say: 'Ben saves with version 7. It no longer matches, so EF throws instead of overwriting.', go: [['e2', 'row']], show: ['conf'], row: { c: 'bad' } },
      { say: 'This is **optimistic concurrency**: no locks, just a check at save time.', row: { c: 'acc' } },
      { pro: true, say: '**Global query filters** add `WHERE TenantId = …` to every query. `ExecuteUpdate` changes thousands of rows in one statement without loading them.', show: ['qf'], pulse: ['qf'] }
    ],
    key: 'Detect conflicting writes with a version check.'
  });

  S.scene({
    id: 'nosql-redis', part: 'p4', title: 'Not everything is a table',
    hook: 'Shopping carts change constantly and are read by one key. A relational table is overkill.',
    a: [
      ['code', 'doc', 140, 110, '{ "id": "cart-77",\n  "customerId": "c-9",\n  "items": [ … ] }'],
      ['box', 'p1', 410, 70, 'Partition A', { w: 130 }],
      ['box', 'p2', 560, 70, 'Partition B', { w: 130 }],
      ['dot', 'd', 140, 110, '', { o: 0 }],
      ['box', 'redis', 140, 280, 'Redis', { sub: 'in memory', w: 140, c: 'bad', o: 0 }],
      ['pill', 'use', 400, 280, 'cache · sessions · counters · locks', { o: 0 }],
      ['pill', 'cap', 480, 180, 'Network split: consistent or available?', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'A **document database** stores the whole cart as one JSON document.', pulse: ['doc'] },
      { say: 'The **partition key** decides which server holds it. Reads by that key are fast and cheap.', go: [['d', 'p2']], acc: ['p2'] },
      { say: '**Redis** keeps data in memory: microsecond reads for caching, sessions and counters.', show: ['redis', 'use'] },
      { pro: true, say: 'During a network split a distributed store must choose **consistency or availability** (CAP). The partition key is the one choice you can\'t easily change.', show: ['cap'], pulse: ['cap'] }
    ],
    key: 'Model for your access pattern; the partition key is forever.'
  });

  // ---------- Part V ----------
  S.scene({
    id: 'design-principles', part: 'p5', title: 'Code that bends',
    hook: 'Adding Apple Pay means editing a 900-line class that also sends emails.',
    a: [
      ['box', 'god', 160, 180, 'OrderService', { sub: 'pay + email + PDF + tax', w: 230, c: 'bad' }],
      ['box', 'pay', 470, 70, 'PaymentProcessor', { w: 180, o: 0 }],
      ['box', 'mail', 470, 150, 'EmailSender', { w: 180, o: 0 }],
      ['box', 'pdf', 470, 230, 'InvoiceRenderer', { w: 180, o: 0 }],
      ['pill', 'ip', 160, 310, 'depends on IPayment, not Stripe', { o: 0, c: 'ok' }],
      ['pill', 'ap', 470, 310, '+ ApplePay: new class, no edits', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: 'One class does everything, so every change risks breaking something unrelated.', pulse: ['god'] },
      { say: '**Single responsibility**: one reason to change per class.', show: ['pay', 'mail', 'pdf'], god: { c: 'acc', sub: 'coordinates', w: 180 } },
      { say: '**Dependency inversion**: depend on an interface, not a concrete vendor.', show: ['ip'] },
      { say: '**Open/closed**: add Apple Pay as a new class, without editing the old ones.', show: ['ap'] },
      { pro: true, say: 'SOLID is a means to **low coupling and high cohesion**. Apply it where change actually happens; YAGNI applies to abstractions too.', pulse: ['pay', 'mail', 'pdf'] }
    ],
    key: 'Small, focused classes that depend on abstractions.'
  });

  S.scene({
    id: 'design-patterns', part: 'p5', title: 'Named solutions',
    hook: 'The same design problems keep coming back in slightly different shapes.',
    a: [
      ['box', 'pr', 130, 90, 'Pricing', { sub: 'strategy?', w: 150 }],
      ['pill', 's1', 130, 170, 'Weekday', { o: 0 }], ['pill', 's2', 130, 215, 'Sale', { o: 0 }],
      ['box', 'svc', 470, 90, 'CatalogService', { w: 170 }],
      ['box', 'dec', 470, 180, 'CachingCatalog', { sub: 'wraps the real one', w: 200, o: 0, c: 'acc' }],
      ['pill', 'obs', 112, 310, 'Observer: OrderPlaced', { o: 0 }],
      ['pill', 'st', 320, 310, 'State: order lifecycle', { o: 0 }],
      ['pill', 'fa', 522, 310, 'Factory: creation', { o: 0 }]
    ],
    b: [
      { say: '**Strategy**: swap an algorithm at run time. Pricing rules plug in.', show: ['s1', 's2'], acc: ['pr'] },
      { say: '**Decorator**: wrap a service to add caching or logging, without changing it.', show: ['dec'], svc: { y: 260 }, pulse: ['dec'] },
      { say: 'More you\'ll meet: **Observer** (events), **State** (lifecycles), **Factory** (creation).', show: ['obs', 'st', 'fa'], svc: { o: 0 } },
      { pro: true, say: 'Patterns are a vocabulary for trade-offs. ASP.NET middleware is **Chain of Responsibility**; DI with decorators is how you add cross-cutting behaviour.', pulse: ['dec'] }
    ],
    key: 'Patterns name recurring solutions and their costs.'
  });

  S.scene({
    id: 'app-architectures', part: 'p5', title: 'Organising the codebase',
    hook: 'Kettle\'s project is a tangle: controllers call SQL, and SQL formats emails.',
    a: [
      ['box', 'web', 140, 70, 'Web / API', { w: 200 }],
      ['box', 'app', 140, 155, 'Application', { w: 200 }],
      ['box', 'dom', 140, 240, 'Domain', { w: 200, c: 'acc' }],
      ['box', 'inf', 140, 325, 'Infrastructure', { w: 200 }],
      ['arr', 'd1', 'web', 'app', ''], ['arr', 'd2', 'app', 'dom', ''], ['arr', 'd3', 'inf', 'dom', 'implements', { o: 0 }],
      ['pill', 'f1', 470, 110, 'Features/PlaceOrder', { o: 0, w: 220 }],
      ['pill', 'f2', 470, 175, 'Features/CancelOrder', { o: 0, w: 220 }],
      ['pill', 'f3', 470, 240, 'Features/TopCustomers', { o: 0, w: 220 }]
    ],
    b: [
      { say: '**Layers** split by technical role: web, application, domain, data.' },
      { say: '**Clean Architecture** points every dependency **inward**. The domain depends on nothing; infrastructure implements its interfaces.', show: ['d3'], pulse: ['dom'] },
      { say: '**Vertical slices** organise by feature instead: everything for one use case lives together.', show: ['f1', 'f2', 'f3'] },
      { pro: true, say: 'A **modular monolith** gives clear boundaries without network calls. Pick the structure that matches how your code actually changes.', pulse: ['f1', 'f2', 'f3'] }
    ],
    key: 'Dependencies point inward; group code by how it changes.'
  });

  S.scene({
    id: 'cqrs-mediator-result', part: 'p5', title: 'Commands, queries, results',
    hook: 'Read screens need different shapes from write rules, and errors are thrown everywhere.',
    a: [
      ['pill', 'cmd', 110, 90, 'PlaceOrder (command)', { c: 'warn' }],
      ['pill', 'qry', 110, 270, 'GetOrder (query)', { c: 'why' }],
      ['box', 'med', 330, 180, 'Mediator', { sub: 'logging · validation', w: 170, o: 0 }],
      ['box', 'h1', 540, 90, 'Command handler', { sub: 'domain + write DB', w: 180 }],
      ['box', 'h2', 540, 270, 'Query handler', { sub: 'fast read model', w: 180 }],
      ['arr', 'c1', 'cmd', 'h1', ''], ['arr', 'c2', 'qry', 'h2', ''],
      ['pill', 'res', 330, 330, 'Result<Order>: Ok or Error, no throw', { o: 0, c: 'ok' }],
      ['dot', 't', 110, 90, '', { o: 0 }]
    ],
    b: [
      { say: '**CQRS**: commands change state, queries read it. Each can be shaped for its job.', pulse: ['cmd', 'qry'] },
      { say: 'A **mediator** routes each message to its handler, through shared steps like validation.', show: ['med'], hide: ['c1', 'c2'], go: [['t', 'med', 'h1']] },
      { say: 'Expected failures return a **Result** instead of throwing.', show: ['res'] },
      { pro: true, say: 'Separate read models mean **eventual consistency** between write and read. Use the full pattern where reads and writes really differ, not everywhere.', pulse: ['h2'] }
    ],
    key: 'Separate reads from writes; return expected failures as values.'
  });

  S.scene({
    id: 'ddd', part: 'p5', title: 'Speak the business language',
    hook: '"Product" means one thing to the catalogue team and another to the warehouse.',
    a: [
      ['zone', 'z1', 165, 160, 'Catalogue context', { w: 270, h: 230 }],
      ['zone', 'z2', 475, 160, 'Shipping context', { w: 270, h: 230 }],
      ['box', 'p1', 165, 110, 'Product', { sub: 'name, photos, price', w: 190 }],
      ['box', 'p2', 475, 110, 'Product', { sub: 'weight, box size', w: 190 }],
      ['box', 'agg', 165, 210, 'Order (aggregate)', { sub: 'guards its lines', w: 200, o: 0, c: 'acc' }],
      ['pill', 'ev', 320, 325, 'OrderPlaced → other contexts', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'A **bounded context** gives each word one meaning. Two contexts can model "Product" differently.', pulse: ['p1', 'p2'] },
      { say: 'An **aggregate** is a cluster changed as one unit. Its root enforces the rules.', show: ['agg'] },
      { say: 'Contexts communicate with **domain events**, not shared tables.', show: ['ev'] },
      { pro: true, say: 'Change **one aggregate per transaction**, and refer to other aggregates by ID. That rule is what lets contexts become separate services later.', pulse: ['agg'] }
    ],
    key: 'Model the business language; aggregates protect invariants.'
  });

  S.scene({
    id: 'microservices', part: 'p5', title: 'One app or many?',
    hook: 'Three teams keep blocking each other\'s releases.',
    a: [
      ['box', 'mono', 320, 180, 'Kettle monolith', { w: 220, h: 120 }],
      ['box', 's1', 140, 110, 'Ordering', { w: 130, o: 0 }], ['box', 's2', 320, 110, 'Catalogue', { w: 130, o: 0 }], ['box', 's3', 500, 110, 'Payments', { w: 130, o: 0 }],
      ['db', 'd1', 140, 225, 'DB', { o: 0 }], ['db', 'd2', 320, 225, 'DB', { o: 0 }], ['db', 'd3', 500, 225, 'DB', { o: 0 }],
      ['arr', 'o1', 's1', 'd1', '', { o: 0 }], ['arr', 'o2', 's2', 'd2', '', { o: 0 }], ['arr', 'o3', 's3', 'd3', '', { o: 0 }],
      ['box', 'gw', 320, 30, 'API gateway', { w: 160, o: 0, h: 40 }],
      ['pill', 'cost', 320, 320, 'Cost: network failures, distributed data, ops', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'One deployable is simple, until teams and scaling needs diverge.', pulse: ['mono'] },
      { say: '**Microservices**: each service owns its data and deploys on its own.', hide: ['mono'], show: ['s1', 's2', 's3', 'd1', 'd2', 'd3', 'o1', 'o2', 'o3'] },
      { say: 'A **gateway** gives clients one front door.', show: ['gw'] },
      { pro: true, say: 'Services sharing a database or calling each other synchronously in chains form a **distributed monolith**. Split gradually with the **strangler fig**.', show: ['cost'], pulse: ['cost'] }
    ],
    key: 'Split for team and scaling reasons, and own your data.'
  });

  // ---------- Part VI ----------
  S.scene({
    id: 'unit-testing', part: 'p6', title: 'Fast proof',
    hook: 'A discount change quietly broke free shipping. Nobody noticed for a week.',
    a: [
      ['pill', 'ar', 110, 80, 'Arrange', { w: 120 }], ['pill', 'ac', 110, 160, 'Act', { w: 120 }], ['pill', 'as', 110, 240, 'Assert', { w: 120 }],
      ['box', 'sut', 340, 160, 'PriceCalculator', { w: 180 }],
      ['box', 'fake', 540, 160, 'Fake clock', { sub: 'TimeProvider', w: 150, o: 0 }],
      ['arr', 'f', 'sut', 'fake', '', { o: 0, dash: true }],
      ['pill', 'pass', 340, 270, '✓ 312 tests · 1.4 s', { o: 0, c: 'ok' }],
      ['pill', 'pyr', 340, 330, 'many unit · some integration · few end-to-end', { o: 0 }]
    ],
    b: [
      { say: 'A unit test sets up a case, runs one behaviour and checks the result.', acc: ['ar', 'ac', 'as'] },
      { say: 'Replace slow or random edges (the clock, a payment gateway) with **fakes**.', show: ['fake', 'f'] },
      { say: 'Hundreds of tests run in seconds, on every change.', show: ['pass'] },
      { pro: true, say: 'Test **behaviour**, not implementation, or every refactor breaks tests. Mutation testing shows whether your tests would actually catch a bug.', show: ['pyr'], pulse: ['pass'] }
    ],
    key: 'Fast tests on behaviour, with fakes only at the edges.'
  });

  S.scene({
    id: 'integration-testing', part: 'p6', title: 'Prove the parts fit',
    hook: 'Every unit test passes, but the deployed API returns 401 for everyone.',
    a: [
      ['box', 'wf', 160, 110, 'WebApplicationFactory', { sub: 'real Program.cs in memory', w: 240 }],
      ['box', 'pipe', 160, 230, 'Real pipeline', { sub: 'middleware · DI · routing', w: 240 }],
      ['db', 'sql', 480, 110, 'SQL Server', { sub: 'Testcontainers', o: 0 }],
      ['pill', 'rs', 480, 230, 'Respawn: reset data per test', { o: 0 }],
      ['pill', 'ext', 480, 310, 'Fake only what you don\'t own', { o: 0, c: 'why' }],
      ['arr', 'p', 'wf', 'pipe', ''], ['arr', 'q', 'pipe', 'sql', '', { o: 0 }],
      ['dot', 't', 160, 110, '', { o: 0 }]
    ],
    b: [
      { say: 'Boot the real app in memory and send real HTTP requests. Middleware order, DI and routing all run.', go: [['t', 'pipe']] },
      { say: 'Use a real database in a throwaway container.', show: ['sql', 'q'], go: [['t', 'sql']] },
      { say: 'Reset the data between tests so they stay independent.', show: ['rs'] },
      { pro: true, say: 'Replace only what you don\'t own: payment providers, email, the clock. Keep your own code and database real, or it\'s a unit test in disguise.', show: ['ext'], pulse: ['ext'] }
    ],
    key: 'Real app, real database, fakes only at the outer edge.'
  });
})(window.STORY);
