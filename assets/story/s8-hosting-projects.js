// Part X (Hosting in production) and Part XIV (Building real projects).
(S => {
  S.scene({
    id: 'request-journey', part: 'phost', title: 'A request\'s journey',
    hook: 'Every customer shows the same IP, HTTPS redirects loop, and big uploads time out.',
    a: [
      ['user', 'u', 45, 190, 'Customer'],
      ['box', 'dns', 150, 70, 'DNS', { sub: 'name → IP', w: 110 }],
      ['box', 'edge', 175, 190, 'CDN / WAF', { sub: 'TLS ends here', w: 112 }],
      ['box', 'lb', 300, 190, 'Load balancer', { sub: 'healthy instance', w: 124 }],
      ['box', 'px', 430, 190, 'Reverse proxy', { sub: 'nginx', w: 120 }],
      ['box', 'k', 565, 190, 'Kestrel', { sub: 'your app', w: 116, c: 'acc' }],
      ['dot', 'r', 45, 150, '', { o: 0 }],
      ['pill', 'xf', 430, 290, 'X-Forwarded-For · X-Forwarded-Proto', { o: 0, c: 'why' }],
      ['pill', 'to', 320, 330, 'timeouts: edge 60 s > proxy 30 s > app 25 s', { o: 0, c: 'ok' }],
      ['txt', 'codes', 470, 70, '502 bad · 503 none healthy · 504 too slow', { o: 0, mono: true }]
    ],
    b: [
      { say: 'First, **DNS** turns `kettle.example` into an IP address.', go: [['r', 'dns', 'u']] },
      { say: 'The connection is encrypted with **TLS**, usually ended at the edge or the proxy, not in your app.', go: [['r', 'edge', 'lb']], acc: ['edge'] },
      { say: 'The proxy forwards plain HTTP to Kestrel. The original IP and scheme travel in **forwarded headers**, and `UseForwardedHeaders` must run first.', go: [['r', 'px', 'k']], show: ['xf'] },
      { say: 'Each hop has a timeout, and the inner ones must be **shorter**, so the app gives up first with a clear error.', show: ['to'], pulse: ['to'] },
      { pro: true, say: 'Read errors by hop: **502** the proxy got a bad answer, **503** nothing healthy to send to, **504** the app was too slow. Trust forwarded headers only from known proxies.', show: ['codes'], bad: ['px'] }
    ],
    key: 'Know every hop, what it changes, and which one failed.'
  });

  S.scene({
    id: 'reverse-proxy-nginx', part: 'phost', title: 'nginx in front of Kestrel',
    hook: 'Kestrel faces the internet alone.',
    a: [
      ['user', 'u', 55, 180, 'Internet'],
      ['box', 'px', 300, 180, 'nginx :443', { sub: 'TLS, limits, buffering', w: 190, h: 64 }],
      ['box', 'k1', 545, 120, 'Kestrel 127.0.0.1:5001', { w: 170 }],
      ['box', 'k2', 545, 240, 'Kestrel 127.0.0.1:5002', { w: 170, o: 0 }],
      ['arr', 'a1', 'px', 'k1', 'proxy_pass'],
      ['arr', 'a2', 'px', 'k2', '', { o: 0 }],
      ['dot', 'r', 55, 140, '', { o: 0 }],
      ['pill', 'lim', 300, 300, '20 MB upload → 413 (default limit is 1 MB)', { o: 0, c: 'bad' }],
      ['pill', 'tr', 300, 55, 'add_header in a location replaces the parent\'s', { o: 0, c: 'warn' }]
    ],
    b: [
      { say: 'nginx accepts HTTPS from the internet and forwards to Kestrel on **localhost**, so nothing else can reach the app.', go: [['r', 'px', 'k1']] },
      { say: 'It enforces limits before the app does any work. The default body limit is **1 MB**, so uploads need `client_max_body_size`.', show: ['lim'], go: [['r', 'u', 'px', 'u']], bad: ['px'] },
      { say: 'An **upstream** with two instances lets nginx balance load, and `nginx -t` then **reload** swaps config without dropping requests.', show: ['k2', 'a2'], ok: ['px'], hide: ['lim'] },
      { pro: true, say: 'The trap: `proxy_set_header` or `add_header` in a `location` **replaces** everything inherited from above. WebSockets need the Upgrade headers and a long read timeout.', show: ['tr'], pulse: ['tr'] }
    ],
    key: 'nginx guards the door; Kestrel listens only on localhost.'
  });

  const px = [['nginx', 'explicit config'], ['Caddy', 'auto HTTPS'], ['Traefik', 'reads labels'], ['YARP', 'proxy in C#'], ['IIS + ANCM', 'Windows']];
  S.scene({
    id: 'other-proxies', part: 'phost', title: 'Other proxies',
    hook: 'One proxy doesn\'t fit every place Kettle runs.',
    a: [
      ...px.map(([t, s], i) => ['box', 'p' + i, 70 + i * 125, 110, t, { sub: s, w: 116, h: 58 }]),
      ['box', 'fd', 320, 250, 'Managed front door', { sub: 'Front Door · ALB · Cloudflare · ingress', w: 300, o: 0 }],
      ['pill', 'lock', 320, 330, 'lock the origin: accept traffic only from the front door', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: '**Caddy** gets and renews certificates by itself: a production config in three lines.', acc: ['p1'] },
      { say: '**Traefik** watches Docker and routes to containers from their labels as they come and go.', acc: ['p2'], plain: ['p1'] },
      { say: '**YARP** is a library: your gateway is an ASP.NET Core app, so routing logic is plain C#. **IIS** hosts apps in-process on Windows.', acc: ['p3', 'p4'], plain: ['p2'] },
      { pro: true, say: 'On a platform, a **managed front door** is the proxy. Lock the origin to it, or attackers go around the WAF.', show: ['fd', 'lock'], plain: ['p3', 'p4'], pulse: ['lock'] }
    ],
    key: 'Same job, different trade-offs: pick by where Kettle runs.'
  });

  S.scene({
    id: 'linux-deploy', part: 'phost', title: 'Deploying to a Linux server',
    hook: 'Nobody has taken a .NET app to a real server before.',
    a: [
      ['box', 'ci', 70, 110, 'CI', { sub: 'build once', w: 100 }],
      ['zone', 'vm', 390, 190, 'Linux VM (ufw: 22, 80, 443)', { w: 450, h: 320 }],
      ['box', 'ng', 390, 85, 'nginx + certbot', { w: 170 }],
      ['box', 'blue', 285, 190, 'kettle-api@5001', { sub: 'v41 · live', w: 160, c: 'ok' }],
      ['box', 'green', 495, 190, 'kettle-api@5002', { sub: 'v42 · starting', w: 160, o: 0 }],
      ['arr', 'up1', 'ng', 'blue', ''],
      ['arr', 'up2', 'ng', 'green', '', { o: 0 }],
      ['db', 'db', 390, 300, 'Postgres'],
      ['dot', 'art', 70, 160, '', { o: 0 }],
      ['pill', 'bk', 80, 250, 'backups off-site', { o: 0, c: 'why' }]
    ],
    b: [
      { say: '**systemd** runs the app as its own user, restarts it if it crashes, and stops it gracefully on SIGTERM.', pulse: ['blue'] },
      { say: 'Deploy: the artifact from CI goes to the **idle slot**, which starts and must pass `/health/ready`.', go: [['art', 'green']], show: ['green'] },
      { say: 'Ready? Rewrite the upstream, `nginx -t`, **reload**. New requests go to v42; v41 finishes what it has.', hide: ['up1'], show: ['up2'], ok: ['green'], green: { sub: 'v42 · live' }, plain: ['blue'], blue: { sub: 'v41 · draining' } },
      { say: '**Rollback** is the same move in reverse: the old slot is still there.', blue: { sub: 'v41 · standby' } },
      { pro: true, say: 'Both versions share one database, so migrations must be **expand then contract**. Backups go off the server, and a restore is tested.', show: ['bk'], pulse: ['db'] }
    ],
    key: 'Start the new one, check it, switch, drain, and keep the way back.'
  });

  S.scene({
    id: 'docker', part: 'phost', title: 'Ship the whole box',
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

  S.scene({
    id: 'containers-single-host', part: 'phost', title: 'Containers on one host',
    hook: 'The server is a hand-built pet that drifts.',
    a: [
      ['zone', 'host', 320, 182, 'One host · compose.yaml in git', { w: 580, h: 300 }],
      ['box', 'cad', 320, 92, 'caddy', { sub: 'ports 80, 443 only', w: 170 }],
      ['box', 'api', 200, 180, 'api', { sub: 'ghcr.io/kettle/api:v41', w: 190 }],
      ['box', 'wk', 440, 180, 'worker', { sub: 'ghcr.io/kettle/worker:v41', w: 200 }],
      ['db', 'db', 320, 285, 'postgres'],
      ['pill', 'vol', 500, 285, 'named volumes', { c: 'why' }],
      ['pill', 'hc', 130, 285, 'healthy?', { o: 0, c: 'ok' }],
      ['pill', 'ufw', 320, 344, 'a published db port bypasses ufw', { o: 0, c: 'bad' }]
    ],
    b: [
      { say: 'The server runs only **Docker**. One file describes every service, the same on staging and production.', pulse: ['host'] },
      { say: 'Services start in order of **health**: the API waits for Postgres to be ready, the proxy for the API.', show: ['hc'], ok: ['db', 'api'] },
      { say: 'Deploying is changing a tag and `docker compose up -d --wait`. Rolling back is the old tag.', api: { sub: 'ghcr.io/kettle/api:v42' }, wk: { sub: 'ghcr.io/kettle/worker:v42' }, acc: ['api', 'wk'] },
      { pro: true, say: 'Only the proxy publishes ports. Docker\'s published ports **bypass ufw**, so an exposed database is open to the internet. Secrets go in as files, not environment variables.', show: ['ufw'], pulse: ['ufw'] }
    ],
    key: 'Everything in one file, deployed by tag, with only the proxy exposed.'
  });

  S.scene({
    id: 'prod-config', part: 'phost', title: 'Production configuration',
    hook: 'Will it survive ten times the traffic and a slow database?',
    a: [
      ['box', 'st', 110, 80, 'Startup', { sub: 'ValidateOnStart', w: 150 }],
      ['pill', 'live', 330, 60, '/health/live: restart me?', { w: 210 }],
      ['pill', 'ready', 330, 105, '/health/ready: send me traffic?', { w: 250 }],
      ['db', 'db', 545, 85, 'database'],
      ['zone', 'z1', 320, 260, 'platform grace 30 s', { w: 520, h: 150 }],
      ['zone', 'z2', 290, 268, 'systemd / Docker stop 45 s', { w: 400, h: 110, o: 0 }],
      ['zone', 'z3', 260, 276, 'app shutdown 25 s', { w: 280, h: 70, o: 0 }]
    ],
    b: [
      { say: 'Bad configuration should **fail at startup**, so the deploy fails and the old version keeps serving.', bad: ['st'], pulse: ['st'] },
      { say: '**Liveness** asks "restart me?". **Readiness** asks "send me traffic?". Only readiness checks the database.', ok: ['live', 'ready'] },
      { say: 'If liveness checked the database, one blip would restart **every** instance at once.', bad: ['live', 'db'] },
      { say: 'Shutdown timeouts must **nest**: the app finishes before its supervisor kills it, and the supervisor before the platform.', show: ['z2', 'z3'], plain: ['live', 'db'] },
      { pro: true, say: 'High latency with low CPU usually means **thread-pool starvation** from blocking on async. Bound everything: body size, request time, outgoing calls.', pulse: ['z3'] }
    ],
    key: 'Fail early, bound everything, and shut down inside the platform\'s window.'
  });

  S.scene({
    id: 'project-foundations', part: 'pproj', title: 'Starting a project right',
    hook: 'The old codebase drifted into hundreds of warnings and two-day setups.',
    a: [
      ['zone', 'repo', 150, 180, 'Repository root', { w: 260, h: 260 }],
      ['pill', 'f1', 150, 95, 'Directory.Build.props', { w: 210 }],
      ['pill', 'f2', 150, 140, 'Directory.Packages.props', { w: 210 }],
      ['pill', 'f3', 150, 185, '.editorconfig', { w: 210 }],
      ['pill', 'f4', 150, 230, 'global.json', { w: 210 }],
      ['pill', 'f5', 150, 275, 'docs/adr/0001-*.md', { w: 210, o: 0 }],
      ['box', 'ci', 400, 110, 'CI gate', { sub: 'format · build · test', w: 170 }],
      ['box', 'stg', 400, 250, 'Staging', { w: 120, o: 0 }],
      ['box', 'prod', 560, 250, 'Production', { w: 120, o: 0, c: 'ok' }],
      ['dot', 'c', 560, 110, '', { o: 0 }],
      ['txt', 'commit', 560, 75, 'a commit', { mono: true }]
    ],
    b: [
      { say: 'Shared settings live in **one place**: build rules, package versions, style and the SDK.', acc: ['f1', 'f2', 'f3', 'f4'] },
      { say: 'Warnings are errors, analyzers are on, style is enforced in the build. Review time goes on design, not formatting.', go: [['c', 'ci']], ok: ['ci'] },
      { say: 'A **walking skeleton** goes all the way to production on day three: one endpoint, health checks, telemetry.', show: ['stg', 'prod'], go: [['c', 'stg', 'prod']] },
      { pro: true, say: 'Expensive-to-reverse decisions get a short **decision record**, so the next person knows why.', show: ['f5'], pulse: ['f5'] }
    ],
    key: 'Make the right way the default before the first feature.'
  });

  S.scene({
    id: 'delivering-work', part: 'pproj', title: 'Delivering large projects',
    hook: 'The last big feature lived on a branch for six months and broke payments.',
    a: [
      ['box', 'h1', 140, 90, 'UI for everything', { w: 220, h: 40 }],
      ['box', 'h2', 140, 140, 'API for everything', { w: 220, h: 40 }],
      ['box', 'h3', 140, 190, 'DB for everything', { w: 220, h: 40 }],
      ['txt', 'ht', 140, 235, 'works in month 3, maybe', { mono: true }],
      ...[0, 1, 2, 3].map(i => ['box', 'v' + i, 380 + i * 62, 140, ['quote', 'credit', 'order', 'invoice'][i], { w: 56, h: 140, o: 0 }]),
      ['txt', 'vt', 473, 235, 'something works every week', { mono: true, o: 0 }],
      ['pill', 'flag', 470, 300, 'flag: CreditAccounts = off', { o: 0, c: 'warn' }],
      ['pill', 'shadow', 170, 300, 'shadow run: old vs new', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'Building layer by layer means nothing works until the end, and the end is where surprises live.', bad: ['h1', 'h2', 'h3'] },
      { say: 'Build **vertical slices** instead: each goes through every layer and can be demoed.', show: ['v0', 'v1', 'v2', 'v3', 'vt'], ok: ['v0', 'v1', 'v2', 'v3'], plain: ['h1', 'h2', 'h3'] },
      { say: 'Merge to main **every day**. Unfinished work ships switched off behind a **feature flag**.', show: ['flag'], warn: ['v1'] },
      { pro: true, say: 'Replace live code by running the new path in its **shadow**, comparing results, then switching gradually. Percentage flags re-roll per call; use targeting for users.', show: ['shadow'], pulse: ['shadow'] }
    ],
    key: 'Small slices, merged daily, released with flags.'
  });

  S.scene({
    id: 'production-ownership', part: 'pproj', title: 'Running what you built',
    hook: 'The first invoice run failed silently at 2 a.m.',
    a: [
      ['box', 'slo', 110, 80, 'SLO 99.9%', { sub: 'budget: 43 min/month', w: 170 }],
      ['box', 'al', 320, 80, 'Burn-rate alert', { sub: '14.4× for 1 h', w: 170, o: 0 }],
      ['box', 'rb', 530, 80, 'Runbook', { sub: 'mitigate first', w: 150, o: 0 }],
      ['box', 'mi', 530, 210, 'Rollback / flag off', { w: 170, o: 0, c: 'ok' }],
      ['box', 'pm', 320, 210, 'Blameless postmortem', { sub: 'owned, dated actions', w: 200, o: 0 }],
      ['arr', 'e1', 'slo', 'al', '', { o: 0 }],
      ['arr', 'e2', 'al', 'rb', '', { o: 0 }],
      ['arr', 'e3', 'rb', 'mi', '', { o: 0 }],
      ['arr', 'e4', 'mi', 'pm', '', { o: 0 }],
      ['pill', 'dora', 320, 320, 'DORA: deploy often, recover fast, fail rarely', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'Decide what "working" means in numbers. At 99.9%, the **error budget** is 43 minutes a month.', pulse: ['slo'] },
      { say: 'Page when the budget is burning fast, not on every blip. Every alert links to a **runbook**.', show: ['al', 'rb', 'e1', 'e2'], warn: ['al'] },
      { say: 'In an incident, **mitigate first**: roll back or switch the flag off. Investigate after.', show: ['mi', 'e3'] },
      { say: 'Then learn without blame, and make sure the actions actually get done.', show: ['pm', 'e4'] },
      { pro: true, say: 'Speed and stability improve **together**: small, frequent deploys fail less and recover faster.', show: ['dora'], pulse: ['dora'] }
    ],
    key: 'Measure what users feel, respond calmly, and learn every time.'
  });

  S.scene({
    id: 'staff-engineer', part: 'pproj', title: 'Working as a staff engineer',
    hook: 'One person can\'t review everything for three teams.',
    a: [
      ['user', 'you', 320, 170, 'You'],
      ['box', 't1', 110, 300, 'Storefront team', { w: 160 }],
      ['box', 't2', 320, 300, 'Wholesale team', { w: 160 }],
      ['box', 't3', 530, 300, 'Platform team', { w: 160 }],
      ['box', 'doc', 140, 70, 'Design doc', { sub: 'options · trade-offs', w: 170, o: 0 }],
      ['box', 'str', 500, 70, 'Strategy', { sub: 'diagnosis · policy · actions', w: 200, o: 0 }],
      ['arr', 'l1', 'you', 't1', '', { o: 0, dash: true }],
      ['arr', 'l2', 'you', 't2', '', { o: 0, dash: true }],
      ['arr', 'l3', 'you', 't3', '', { o: 0, dash: true }]
    ],
    b: [
      { say: 'Your work now happens **through other people**: three teams, one technical direction.', acc: ['t1', 't2', 't3'] },
      { say: 'A **design doc** makes a decision reviewable by people who weren\'t in the room.', show: ['doc'] },
      { say: 'A **strategy** names the real problem, the approach, and what you won\'t do.', show: ['str'] },
      { pro: true, say: 'Influence without authority: talk to people **before** the meeting, decide reversible things fast, and finish the migrations others start.', show: ['l1', 'l2', 'l3'], pulse: ['you'] }
    ],
    key: 'Leverage comes from documents, decisions and people.'
  });

  const ph = ['Discover', 'Set up', 'Skeleton', 'Slices', 'Harden', 'Launch', 'Operate'];
  S.scene({
    id: 'capstone-wholesale', part: 'pproj', title: 'Zero to production',
    hook: 'Knowing each piece isn\'t knowing what to do on Monday.',
    a: [
      ...ph.map((t, i) => ['pill', 'p' + i, 52 + i * 89, 120, t, { w: 84 }]),
      ['dot', 'd', 52, 80, '', { o: 0 }],
      ['box', 'arch', 320, 250, 'Modular monolith on Container Apps', { sub: 'Postgres · Front Door · outbox · flags', w: 340 }],
      ['pill', 'tr', 320, 330, 'written triggers for extracting services', { o: 0, c: 'why' }]
    ],
    b: [
      { say: 'Seven phases, each with exit criteria you can check. First: real users, risks, and a scope line.', go: [['d', 'p0']], acc: ['p0'] },
      { say: 'Foundations and a walking skeleton make every later feature a small change to a working system.', go: [['d', 'p1', 'p2']], ok: ['p0', 'p1', 'p2'] },
      { say: 'Slices merged daily, then hardening: load, failure and security tests, SLOs and runbooks.', go: [['d', 'p3', 'p4']], ok: ['p3', 'p4'] },
      { say: 'Launch gradually behind flags, then operate: on-call, postmortems, steady debt paydown.', go: [['d', 'p5', 'p6']], ok: ['p5', 'p6'] },
      { pro: true, say: 'Start simple, and write down what would make you change it.', show: ['tr'], pulse: ['arch'] }
    ],
    key: 'Every chapter, used together, in the right order.'
  });
})(window.STORY);
