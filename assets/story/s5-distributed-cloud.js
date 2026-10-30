// Parts VII–VIII: distributed systems, cloud and DevOps.
(S => {
  S.scene({
    id: 'messaging-events', part: 'p7', title: 'Don\'t wait, publish',
    hook: 'Checkout calls email, stock and analytics in turn. If one is down, checkout fails.',
    a: [
      ['box', 'ord', 100, 180, 'Ordering', { w: 130 }],
      ['box', 'bus', 300, 180, 'Broker', { sub: 'topic: OrderPlaced', w: 170, c: 'acc' }],
      ['box', 'e', 520, 80, 'Email', { w: 120 }], ['box', 's', 520, 180, 'Stock', { w: 120 }], ['box', 'a', 520, 280, 'Analytics', { w: 120 }],
      ['arr', 'x1', 'ord', 'bus', ''], ['arr', 'x2', 'bus', 'e', ''], ['arr', 'x3', 'bus', 's', ''], ['arr', 'x4', 'bus', 'a', ''],
      ['dot', 'm', 100, 180, '', { o: 0 }], ['dot', 'm1', 300, 180, '', { o: 0 }], ['dot', 'm2', 300, 180, '', { o: 0 }], ['dot', 'm3', 300, 180, '', { o: 0 }],
      ['dot', 'dup', 300, 180, '2', { o: 0, c: 'warn' }],
      ['db', 'ob', 100, 310, 'Outbox table', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'Ordering publishes **OrderPlaced** to a broker and moves on.', go: [['m', 'bus']] },
      { say: 'Each subscriber gets its own copy, whenever it\'s ready. Email being down no longer stops checkout.', go: [['m1', 'e'], ['m2', 's'], ['m3', 'a']], bad: ['e'] },
      { say: 'Brokers deliver **at least once**, so duplicates happen. Consumers must be **idempotent**.', plain: ['e'], go: [['dup', 's']], warn: ['s'] },
      { pro: true, say: 'Saving an order and publishing are two systems with no shared transaction. The **outbox** writes the message in the same DB transaction; a relay publishes it.', show: ['ob'], plain: ['s'], pulse: ['ob'] }
    ],
    key: 'Publish events; consumers are idempotent; use an outbox.'
  });

  S.scene({
    id: 'resilience', part: 'p7', title: 'Expect failure',
    hook: 'The payment provider blips for 2 seconds, and Kettle shows errors for 10 minutes.',
    a: [
      ['box', 'api', 110, 160, 'Kettle', { w: 120 }],
      ['box', 'psp', 520, 160, 'Payment provider', { w: 180 }],
      ['dot', 't1', 110, 160, '1', { o: 0, c: 'bad' }], ['dot', 't2', 110, 160, '2', { o: 0, c: 'bad' }], ['dot', 't3', 110, 160, '3', { o: 0, c: 'ok' }],
      ['pill', 'bo', 315, 75, 'wait 200 ms → 400 ms ± jitter', { o: 0 }],
      ['box', 'cb', 315, 255, 'Circuit breaker', { sub: 'closed', w: 170, o: 0 }],
      ['pill', 'st', 315, 335, '3 layers × 3 retries = 27 calls', { o: 0, c: 'bad' }]
    ],
    b: [
      { say: 'A **transient** failure. Retry, but wait a little longer each time, with randomness (**jitter**).', show: ['bo'], go: [['t1', 'psp', [300, 200]], ['t2', [200, 160], 'psp', [300, 210]], ['t3', [150, 160], 'psp']] },
      { say: 'If it keeps failing, a **circuit breaker** opens and fails fast, giving the provider room to recover.', show: ['cb'], hide: ['t1', 't2', 't3'], cb: { sub: 'open: fail fast', c: 'bad' }, psp: { c: 'bad' } },
      { say: 'After a pause it lets one trial call through. Success closes it again.', cb: { sub: 'half-open → closed', c: 'ok' }, psp: { c: 'ok' } },
      { pro: true, say: 'Retry at **one** layer. Retries at every layer multiply into a storm. Only retry operations that are safe to repeat.', show: ['st'], pulse: ['st'] }
    ],
    key: 'Retry with backoff, break the circuit, never retry everywhere.'
  });

  S.scene({
    id: 'observability-aspire', part: 'p7', title: 'See inside',
    hook: '"Checkout is slow." Which of the five services is it?',
    a: [
      ['txt', 'tid', 320, 30, 'TraceId 4bf92f…', { mono: true }],
      ['pill', 'sp1', 320, 75, 'POST /checkout · 1.8 s', { w: 560 }],
      ['pill', 'sp2', 160, 125, 'pricing · 0.2 s', { w: 180 }],
      ['pill', 'sp3', 440, 175, 'SQL INSERT · 1.5 s', { w: 280, o: 1 }],
      ['pill', 'sp4', 580, 225, 'publish', { w: 90 }],
      ['pill', 'm', 130, 300, 'Metrics: p95 rising', { o: 0, c: 'warn' }],
      ['pill', 'l', 330, 300, 'Logs for this TraceId', { o: 0, c: 'why' }],
      ['pill', 'ot', 535, 300, 'OpenTelemetry export', { o: 0 }]
    ],
    b: [
      { say: 'A **trace** follows one request across every service. Each step is a timed **span**.', pulse: ['sp1'] },
      { say: 'The waterfall makes the slow part obvious: one SQL insert takes most of the time.', bad: ['sp3'], pulse: ['sp3'] },
      { say: '**Metrics** say *that* something is wrong; traces say *where*; **logs** for that TraceId say *why*.', show: ['m', 'l'] },
      { pro: true, say: '.NET emits through **OpenTelemetry**. Keep metric tags low-cardinality: tagging by user ID creates a time series per user. **Aspire** runs it all locally with a dashboard.', show: ['ot'], pulse: ['ot'] }
    ],
    key: 'Metrics say that, traces say where, logs say why.'
  });

  S.scene({
    id: 'cloud-azure-overview', part: 'p8', title: 'Renting the data centre',
    hook: 'Kettle\'s single server in a cupboard can\'t handle the holiday rush.',
    a: [
      ['pill', 'h0', 110, 60, 'App code', { w: 150 }],
      ['pill', 'h1', 110, 110, 'Runtime', { w: 150 }],
      ['pill', 'h2', 110, 160, 'Operating system', { w: 150 }],
      ['pill', 'h3', 110, 210, 'Hardware', { w: 150 }],
      ['txt', 'line', 110, 260, 'IaaS: you own the OS', { mono: true }],
      ['box', 'one', 450, 110, 'One big server', { w: 170, o: 0 }],
      ...[0, 1, 2, 3].map(i => ['box', 'n' + i, 360 + i * 60, 270, '', { w: 50, h: 40, o: 0, c: 'ok' }]),
      ['txt', 'out', 450, 330, 'scale out: needs a stateless app', { mono: true, o: 0 }]
    ],
    b: [
      { say: 'With **IaaS** (virtual machines) you still patch the operating system.', ok: ['h3'], acc: ['h2', 'h1', 'h0'] },
      { say: 'With **PaaS** the provider runs the OS and runtime. You bring only the app.', ok: ['h3', 'h2', 'h1'], line: { t: 'PaaS: you own the app' } },
      { say: '**Scale up** buys a bigger machine. **Scale out** adds more copies behind a load balancer.', show: ['one', 'n0', 'n1', 'n2', 'n3', 'out'] },
      { pro: true, say: 'Scaling out only works if any copy can serve any request: no in-memory sessions or local files. Run copies across **availability zones** to survive a data-centre failure.', pulse: ['n0', 'n1', 'n2', 'n3'] }
    ],
    key: 'Prefer managed services; build stateless so you can scale out.'
  });

  S.scene({
    id: 'docker', part: 'p8', title: 'Ship the whole box',
    hook: '"It works on my machine." Production has a different runtime and libraries.',
    a: [
      ['pill', 'l0', 150, 280, 'Base OS (chiseled)', { w: 200 }],
      ['pill', 'l1', 150, 240, 'ASP.NET runtime', { w: 200 }],
      ['pill', 'l2', 150, 200, 'Your published app', { w: 200 }],
      ['pill', 'w', 150, 160, 'writable layer', { w: 200, o: 0, c: 'warn' }],
      ['txt', 'img', 150, 320, 'image = read-only layers', { mono: true }],
      ['box', 'sdk', 470, 80, 'Build stage', { sub: 'sdk image, ~800 MB', w: 190 }],
      ['box', 'rt', 470, 210, 'Final image', { sub: 'runtime only, small', w: 190, c: 'ok' }],
      ['arr', 'cp', 'sdk', 'rt', 'COPY --from=build', { o: 0 }],
      ['pill', 'sig', 470, 315, 'ENTRYPOINT ["dotnet", "Kettle.dll"]', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'An **image** packs the app with its runtime and OS libraries, as stacked read-only layers.', pulse: ['l0', 'l1', 'l2'] },
      { say: 'A **container** is a running image plus one thin writable layer. Same image on a laptop and in production.', show: ['w'] },
      { say: 'A **multi-stage** build compiles with the big SDK image and ships only the output.', show: ['cp'] },
      { pro: true, say: 'Use the JSON form of `ENTRYPOINT` so `dotnet` is process 1 and receives `SIGTERM` for a graceful shutdown. .NET reads the container\'s CPU and memory limits.', show: ['sig'], pulse: ['sig'] }
    ],
    key: 'Build once, small and non-root; the same image runs everywhere.'
  });

  const comp = [['VMs', 'full control'], ['AKS', 'Kubernetes'], ['Container Apps', 'containers'], ['App Service', 'web apps'], ['Functions', 'event code']];
  S.scene({
    id: 'azure-compute', part: 'p8', title: 'Where Kettle runs',
    hook: 'VMs, Kubernetes, App Service, Functions… which one?',
    a: [
      ...comp.map(([t, s], i) => ['box', 'c' + i, 67 + i * 126.5, 110, t, { sub: s, w: 122, h: 58 }]),
      ['txt', 'ax', 320, 40, '← more control                more managed →', { mono: true }],
      ['box', 'prod', 210, 260, 'Production slot', { sub: 'v1', w: 160, o: 0 }],
      ['box', 'stg', 430, 260, 'Staging slot', { sub: 'v2, warmed up', w: 160, o: 0, c: 'acc' }],
      ['arr', 'sw', 'stg', 'prod', 'swap', { o: 0, both: true }],
      ['pill', 'kd', 320, 335, 'Container Apps: scale on queue length, down to zero', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'It\'s a spectrum. More control means more of the operations work is yours.', acc: ['c0', 'c1', 'c2', 'c3', 'c4'] },
      { say: '**App Service slots**: deploy to staging, warm it up, then swap with production.', show: ['prod', 'stg', 'sw'], plain: ['c0', 'c1', 'c2', 'c4'] },
      { say: '**Container Apps** run containers without managing a cluster, scaling on events.', show: ['kd'], acc: ['c2'] },
      { pro: true, say: '**Functions** suit event glue and spiky jobs. **Durable Functions** replay their history after a restart, so orchestrator code must be deterministic.', acc: ['c4'], pulse: ['c4'] }
    ],
    key: 'Choose by how much operations work you want to own.'
  });

  S.scene({
    id: 'azure-data-messaging', part: 'p8', title: 'Managed data and messaging',
    hook: 'Kettle needs a database, file storage, a cache and a message broker, without running any of them.',
    a: [
      ['db', 'sql', 90, 90, 'Azure SQL'], ['db', 'cos', 230, 90, 'Cosmos DB'], ['db', 'blob', 370, 90, 'Blob Storage'], ['db', 'red', 520, 90, 'Managed Redis'],
      ['box', 'sb', 120, 250, 'Service Bus', { sub: 'business messages', w: 170, o: 0 }],
      ['box', 'eg', 320, 250, 'Event Grid', { sub: '"it happened" push', w: 170, o: 0 }],
      ['box', 'eh', 520, 250, 'Event Hubs', { sub: 'telemetry firehose', w: 170, o: 0 }],
      ['pill', 'sing', 320, 335, 'SDK clients: one per app, auth by managed identity', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: 'Each earlier topic has a managed Azure version, with backups and scaling included.', pulse: ['sql', 'cos', 'blob', 'red'] },
      { say: 'Three messaging services for three different jobs.', show: ['sb', 'eg', 'eh'] },
      { say: 'Orders and payments → **Service Bus**. A file was uploaded → **Event Grid**. Millions of clicks → **Event Hubs**.', acc: ['sb', 'eg', 'eh'] },
      { pro: true, say: 'SDK clients are thread-safe: register them once as singletons, like `HttpClient`. They retry on their own, so don\'t add another retry layer on top.', show: ['sing'], pulse: ['sing'] }
    ],
    key: 'Service Bus for work, Event Grid for notices, Event Hubs for streams.'
  });

  S.scene({
    id: 'azure-identity-secrets', part: 'p8', title: 'No secrets at all',
    hook: 'The database password was committed to Git.',
    a: [
      ['code', 'leak', 160, 80, '"ConnectionStrings": {\n  "Db": "…;Password=hunter2" }'],
      ['box', 'app', 160, 220, 'Kettle API', { sub: 'managed identity', w: 170, o: 0 }],
      ['box', 'entra', 470, 120, 'Microsoft Entra ID', { sub: 'issues tokens', w: 200, o: 0 }],
      ['db', 'db', 470, 280, 'Azure SQL', { o: 0 }],
      ['arr', 'g1', 'app', 'entra', 'get token', { o: 0 }], ['arr', 'g2', 'app', 'db', 'token', { o: 0 }],
      ['pill', 'rbac', 470, 200, 'RBAC: may read/write this DB', { o: 0, c: 'ok' }],
      ['pill', 'kv', 160, 320, 'Unavoidable secret? Key Vault', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'A password in config gets copied, logged and committed. It\'s a breach waiting to happen.', leak: { hl: 1 }, pulse: ['leak'] },
      { say: 'A **managed identity** lets Azure vouch for the app. It asks for a token; there is no password.', show: ['app', 'entra', 'g1'], leak: { hl: -1, t: '"Db": "…;Authentication=\n  Active Directory Default"' } },
      { say: '**RBAC** grants that identity exactly the access it needs, and nothing more.', show: ['db', 'g2', 'rbac'] },
      { pro: true, say: '`DefaultAzureCredential` uses your developer login locally and the managed identity in Azure. **Workload identity federation** extends this to GitHub Actions and Kubernetes.', show: ['kv'], pulse: ['app'] }
    ],
    key: 'Identities instead of secrets; least privilege through RBAC.'
  });

  S.scene({
    id: 'cicd-iac', part: 'p8', title: 'Push to production',
    hook: 'Releases are a monthly, manual, all-hands evening.',
    a: [
      ['pill', 'push', 70, 70, 'git push', { w: 100 }],
      ['box', 'ci', 220, 70, 'CI', { sub: 'build · test · scan', w: 150 }],
      ['box', 'img', 400, 70, 'Image', { sub: 'tag = git SHA', w: 140 }],
      ['arr', 'a1', 'push', 'ci', ''], ['arr', 'a2', 'ci', 'img', ''],
      ['box', 'dev', 130, 200, 'Dev', { w: 110, o: 0 }], ['box', 'stg', 300, 200, 'Staging', { w: 110, o: 0 }], ['box', 'prd', 470, 200, 'Production', { w: 120, o: 0 }],
      ['dot', 'd', 400, 70, '', { o: 0 }],
      ['pill', 'can', 470, 285, 'canary: 5% → 50% → 100%', { o: 0, c: 'why' }],
      ['pill', 'ec', 190, 300, 'DB: expand → migrate → contract', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'Every push is built and tested automatically: **continuous integration**.', go: [['d', 'ci']] },
      { say: 'Build the image **once**. Promote the exact same image through each environment; only config changes.', show: ['dev', 'stg', 'prd'], go: [['d', 'img', 'dev', 'stg', 'prd']], ok: ['prd'] },
      { say: 'Release gradually. A **canary** sends a small share of traffic to the new version first.', show: ['can'] },
      { pro: true, say: 'Old and new code run side by side during a rollout, so schema changes go **expand → migrate → contract** across releases. Infrastructure lives in code too: Bicep or Terraform.', show: ['ec'], pulse: ['ec'] }
    ],
    key: 'Build once, promote the same artefact, release gradually.'
  });

  S.scene({
    id: 'kubernetes', part: 'p8', title: 'Desired state',
    hook: 'At 3 a.m. a server dies, and someone has to restart Kettle by hand.',
    a: [
      ['code', 'want', 120, 70, 'replicas: 3\nimage: kettle:3f1c'],
      ['box', 'ctl', 120, 200, 'Controller', { sub: 'observe → compare → act', w: 200 }],
      ['box', 'p1', 340, 90, 'Pod 1', { w: 100 }], ['box', 'p2', 455, 90, 'Pod 2', { w: 100 }], ['box', 'p3', 570, 90, 'Pod 3', { w: 100 }],
      ['box', 'p4', 570, 90, 'Pod 4', { w: 100, o: 0, c: 'ok' }],
      ['box', 'svc', 480, 220, 'Service', { sub: 'one stable address', w: 170, o: 0 }],
      ['pill', 'pr', 470, 315, 'ready? → traffic · live? → restart', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'You declare what you want: three copies of this image.', pulse: ['want'] },
      { say: 'At 3 a.m. Pod 3 dies.', bad: ['p3'], pulse: ['p3'] },
      { say: 'The controller sees two, wants three, and starts another. Nobody gets paged.', p3: { o: 0 }, show: ['p4'], pulse: ['ctl'] },
      { say: 'A **Service** gives the changing set of pods one stable name and load-balances across them.', show: ['svc'] },
      { pro: true, say: '**Readiness** failing takes a pod out of traffic; **liveness** failing restarts it. Never check the database in liveness, or one blip restarts everything.', show: ['pr'], pulse: ['pr'] }
    ],
    key: 'Declare the state; controllers keep reality matching it.'
  });
})(window.STORY);
