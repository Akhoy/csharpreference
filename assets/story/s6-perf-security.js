// Parts IX–XI: performance and internals, security, interview preparation.
(S => {
  S.scene({
    id: 'memory-gc', part: 'p9', title: 'Who cleans up?',
    hook: 'Kettle\'s memory climbs all day and never comes back down.',
    a: [
      ['zone', 'g0', 110, 180, 'Gen 0', { w: 180, h: 260 }],
      ['zone', 'g1', 310, 180, 'Gen 1', { w: 180, h: 260 }],
      ['zone', 'g2', 515, 180, 'Gen 2', { w: 200, h: 260 }],
      ...[0, 1, 2, 3, 4, 5].map(i => ['dot', 'o' + i, 70 + (i % 3) * 40, 110 + Math.floor(i / 3) * 50, '', { o: 0 }]),
      ['pill', 'loh', 515, 290, '≥ 85 KB → large object heap', { o: 0, c: 'warn', w: 190 }],
      ['pill', 'leak', 515, 120, 'static list → still reachable', { o: 0, c: 'bad', w: 190 }]
    ],
    b: [
      { say: 'New objects start in **Gen 0**. Most die young, so collecting Gen 0 is cheap and frequent.', show: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5'] },
      { say: 'A collection frees the unreachable ones. Survivors are **promoted** to Gen 1, then Gen 2.', hide: ['o1', 'o2', 'o4', 'o5'], go: [['o0', [310, 130]], ['o3', [310, 190]]] },
      { say: 'Gen 2 collections scan everything: rare but expensive. Big objects start straight in the **large object heap**.', go: [['o0', [500, 200]]], show: ['loh'] },
      { pro: true, say: 'A .NET leak is an object you no longer need that is **still reachable**: a growing static list, or an event nobody unsubscribed. Find it with `dotnet-gcdump` and `gcroot`.', show: ['leak'], pulse: ['leak'] }
    ],
    key: 'Allocate less; anything still reachable stays alive.'
  });

  S.scene({
    id: 'threading-concurrency', part: 'p9', title: 'Two threads, one counter',
    hook: '1,000 orders were placed. The counter says 994.',
    a: [
      ['box', 'cnt', 320, 70, 'count', { sub: '5', w: 130 }],
      ['box', 'ta', 140, 200, 'Thread A', { sub: 'read 5', w: 150 }],
      ['box', 'tb', 500, 200, 'Thread B', { sub: 'read 5', w: 150 }],
      ['arr', 'ra', 'cnt', 'ta', '', { o: 1 }], ['arr', 'rb', 'cnt', 'tb', '', { o: 1 }],
      ['pill', 'fix', 320, 300, 'Interlocked.Increment: one atomic step', { o: 0, c: 'ok' }],
      ['pill', 'dl', 320, 300, 'Deadlock: A waits for B, B waits for A', { o: 0, c: 'bad' }]
    ],
    b: [
      { say: '`count++` is three steps: read, add, write. Both threads read 5.', pulse: ['ta', 'tb'] },
      { say: 'Both write 6. One increment vanished, with no error anywhere. That\'s a **race condition**.', ta: { sub: 'write 6' }, tb: { sub: 'write 6' }, cnt: { sub: '6 (should be 7)', c: 'bad' } },
      { say: 'Make it one indivisible step, or protect it with a `lock`.', show: ['fix'], cnt: { sub: '7', c: 'ok' }, ta: { sub: '' }, tb: { sub: '' } },
      { pro: true, say: 'Locks bring their own risk: a **deadlock**. Always take locks in the same order, and never `await` inside a `lock`; use `SemaphoreSlim`.', hide: ['fix'], show: ['dl'], bad: ['ta', 'tb'], pulse: ['dl'] }
    ],
    key: 'Shared state needs atomic steps or locks, taken in a fixed order.'
  });

  S.scene({
    id: 'performance-engineering', part: 'p9', title: 'Measure, don\'t guess',
    hook: 'Someone rewrote a loop with Span. The page is still slow.',
    a: [
      ['pill', 'b0', 320, 70, 'request · 1.8 s', { w: 560 }],
      ['pill', 'b1', 120, 120, 'C# loop · 3 ms', { w: 150 }],
      ['pill', 'b2', 405, 170, 'SQL query · 1.6 s', { w: 390 }],
      ['txt', 'avg', 180, 270, 'average 148 ms', { big: true, o: 0 }],
      ['txt', 'p99', 470, 270, 'p99 5,000 ms', { big: true, o: 0 }],
      ['pill', 'starve', 320, 335, 'high latency + low CPU = thread-pool starvation', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'Find where the time goes **before** changing anything. A trace shows it\'s the database, not the loop.', bad: ['b2'], pulse: ['b2'] },
      { say: 'Fix the biggest thing first: an index or one N+1 beats any micro-optimisation.', b2: { t: 'SQL query · 12 ms', c: 'ok', w: 160 }, b0: { t: 'request · 0.2 s' } },
      { say: 'Use **percentiles**. An average of 148 ms hid users waiting 5 seconds.', show: ['avg', 'p99'] },
      { pro: true, say: 'Slow but CPU idle? Threads are blocked: **starvation**. Use `dotnet-counters` and `dotnet-trace` first; BenchmarkDotNet only for hot code you have already found.', show: ['starve'], pulse: ['starve'] }
    ],
    key: 'Trace first, fix the biggest cost, watch p95 and p99.'
  });

  // ---------- Part X ----------
  S.scene({
    id: 'web-security', part: 'p10', title: 'Think like an attacker',
    hook: 'Change the number in /orders/41 and you can read a stranger\'s order.',
    a: [
      ['pill', 'u1', 120, 70, 'GET /orders/41', { c: 'bad', w: 160 }],
      ['code', 'q', 400, 70, 'db.Orders.Where(o => o.Id == id\n  && o.CustomerId == me)'],
      ['code', 'sqli', 200, 190, '"… WHERE Email = \'" + email + "\'"', { o: 0 }],
      ['pill', 'par', 470, 190, 'parameters: data, never code', { o: 0, c: 'ok' }],
      ['pill', 'xss', 150, 300, 'XSS: their script in your page', { o: 0 }],
      ['pill', 'csrf', 470, 300, 'CSRF: their site, your cookie', { o: 0 }]
    ],
    b: [
      { say: 'The endpoint checks that you\'re logged in, not that the order is **yours**. That\'s **broken access control**, risk #1.', pulse: ['u1'] },
      { say: 'Scope every query to the caller, and return 404 so you don\'t reveal what exists.', q: { hl: 1 }, ok: ['u1'] },
      { say: 'Gluing input into SQL lets the input become SQL. Parameters fix it.', show: ['sqli', 'par'], q: { hl: -1 } },
      { pro: true, say: '**XSS** runs attacker script in your page; **CSRF** abuses a cookie the browser sends automatically. Different attacks, different defences: encoding and CSP, versus SameSite cookies and antiforgery tokens.', show: ['xss', 'csrf'], pulse: ['xss', 'csrf'] }
    ],
    key: 'Authorise every object, parameterise everything, never trust input.'
  });

  S.scene({
    id: 'oauth-oidc-identity', part: 'p10', title: 'Signing in without passwords',
    hook: 'Kettle shouldn\'t store passwords at all. Let an identity provider do it.',
    a: [
      ['user', 'u', 60, 170, 'Shopper'],
      ['box', 'app', 230, 170, 'Kettle web', { w: 140 }],
      ['box', 'idp', 450, 70, 'Identity provider', { sub: 'Entra · Auth0', w: 190 }],
      ['box', 'api', 450, 280, 'Kettle API', { w: 150 }],
      ['dot', 'c', 230, 170, 'C', { o: 0 }],
      ['dot', 't', 450, 70, 'T', { o: 0, c: 'ok' }],
      ['pill', 'pk', 230, 330, 'PKCE: only the starter can redeem', { o: 0, c: 'why' }],
      ['pill', 'v', 470, 175, 'verify signature · audience · expiry', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: 'Kettle sends the shopper to the **identity provider**, which handles the password and MFA.', go: [['c', 'u', 'idp']], c: { c: 'warn' } },
      { say: 'It returns a one-time **code**. Kettle swaps it, plus a secret proof (**PKCE**), for tokens.', go: [['c', 'app', 'idp']], show: ['pk'] },
      { say: 'The **access token** goes to the API, which checks it before trusting anything inside.', go: [['t', 'app', 'api']], show: ['v'], hide: ['c'] },
      { pro: true, say: 'The **ID token** is for the app, the **access token** for the API: never mix them up. For browser apps, a **BFF** keeps tokens on the server and gives the browser only a cookie.', pulse: ['api'] }
    ],
    key: 'Code + PKCE to sign in; validate every access token.'
  });

  // ---------- Part XI ----------
  S.scene({
    id: 'system-design', part: 'p11', title: 'Design Kettle on a whiteboard',
    hook: '"Design a checkout for 10 million users." 45 minutes. Go.',
    a: [
      ['pill', 's1', 90, 40, '1 Requirements', { w: 150 }], ['pill', 's2', 250, 40, '2 Estimates', { w: 130 }], ['pill', 's3', 400, 40, '3 Design', { w: 110 }], ['pill', 's4', 545, 40, '4 Deep dive', { w: 130 }],
      ['user', 'u', 50, 200, 'Users', { o: 0 }],
      ['box', 'fd', 160, 200, 'Front Door', { w: 110, o: 0 }],
      ['box', 'api', 290, 200, 'API', { w: 90, o: 0 }],
      ['box', 'c', 290, 300, 'Cache', { w: 90, o: 0 }],
      ['db', 'db', 420, 300, 'SQL', { o: 0 }],
      ['box', 'q', 420, 200, 'Queue', { w: 90, o: 0 }],
      ['box', 'w', 560, 200, 'Workers', { w: 110, o: 0 }],
      ['arr', 'a1', 'u', 'fd', '', { o: 0 }], ['arr', 'a2', 'fd', 'api', '', { o: 0 }], ['arr', 'a3', 'api', 'c', '', { o: 0 }], ['arr', 'a4', 'api', 'db', '', { o: 0 }], ['arr', 'a5', 'api', 'q', '', { o: 0 }], ['arr', 'a6', 'q', 'w', '', { o: 0 }],
      ['txt', 'est', 320, 110, '1M requests/day ≈ 12 per second', { mono: true, o: 0 }]
    ],
    b: [
      { say: 'Clarify first: what must it do, how fast, how available? Say what\'s out of scope.', acc: ['s1'] },
      { say: 'Estimate before drawing. The numbers decide the design: read-heavy means cache first.', acc: ['s2'], show: ['est'] },
      { say: 'Draw the building blocks you already know from this story.', acc: ['s3'], hide: ['est'], show: ['u', 'fd', 'api', 'c', 'db', 'q', 'w', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'] },
      { pro: true, say: 'Deep-dive the hardest part: outbox, idempotency keys, a saga with compensation. For every choice, state the **trade-off**.', acc: ['s4'], pulse: ['q', 'w'] }
    ],
    key: 'Clarify, estimate, draw, deep-dive, and name every trade-off.'
  });

  S.scene({
    id: 'study-plan-resources', part: 'p11', title: 'What\'s next',
    hook: 'You\'ve seen every topic once. Now make it stick.',
    a: [
      ['pill', 'b', 140, 90, '1 Breadth: this story', { w: 210, c: 'ok' }],
      ['pill', 'd', 140, 160, '2 Depth: full chapters', { w: 210 }],
      ['pill', 'r', 140, 230, '3 Recall: explain it aloud', { w: 210 }],
      ['pill', 'k', 140, 300, '4 Build Kettle yourself', { w: 210 }],
      ['box', 'you', 470, 190, 'Interview-ready', { sub: 'staff level', w: 190, o: 0, c: 'acc' }]
    ],
    b: [
      { say: 'You now know where every topic fits. That\'s the hard part.', pulse: ['b'] },
      { say: 'Go deep one part at a time. Each scene links to its full chapter.', ok: ['d'] },
      { say: 'Close the page and explain it aloud. Recall beats rereading.', ok: ['r'] },
      { pro: true, say: 'Build a small Kettle yourself, end to end. A bug you actually fixed makes a better interview answer than a definition.', ok: ['k'], show: ['you'], pulse: ['you'] }
    ],
    key: 'Breadth first, then depth, then recall, then build.'
  });
})(window.STORY);
