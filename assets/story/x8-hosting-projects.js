// Explanations for Part X (hosting in production) and Part XIV (building real projects).
(S => {
  S.explain('request-journey', {
    base: [
      'Between a customer\'s phone and your C# code sit several other systems, called **hops**. Each one can be slow, fail, or change the request.',
      '**DNS** (Domain Name System) is the internet\'s phone book: it turns a name like `kettle.example` into an **IP address**, the number computers use to find each other.',
      '**TLS** is the encryption behind HTTPS. It keeps traffic private and proves the server is really kettle.example, using a **certificate**.',
      'A **reverse proxy** is a server that receives requests on behalf of your app and forwards them to it. A **load balancer** spreads requests across several copies of the app.'
    ],
    beats: [
      'The phone first asks DNS for the IP address of `kettle.example`. The answer is cached for a while (the TTL). If DNS points to the wrong place, nothing else matters: nobody reaches you.',
      'The phone opens a connection and does the **TLS handshake**: it checks the certificate and agrees encryption keys. TLS is usually **terminated** (decrypted) at the edge, at a CDN, load balancer or proxy, not in your app. That keeps certificate handling in one place. The load balancer then picks a healthy copy of the app.',
      'The proxy forwards the request to **Kestrel**, the web server inside your app, over plain HTTP on the private network. Now the app sees the proxy\'s IP and "http", not the customer\'s. The proxy adds **forwarded headers** (`X-Forwarded-For` for the original IP, `X-Forwarded-Proto` for the original scheme), and `UseForwardedHeaders` restores them, but only from proxies you trust, or anyone could fake their IP.',
      'Each hop gives up after its own **timeout**. If the proxy waits 30 seconds but the app keeps working for 60, the customer gets an error while the app carries on with work nobody will see. Inner timeouts must be shorter than outer ones, so the innermost layer fails first with a clear error.',
      'Errors from the proxy point at the hop that failed. **502 Bad Gateway**: the proxy got no valid answer (app crashed, wrong port). **503 Service Unavailable**: no healthy app instance to send to. **504 Gateway Timeout**: the app didn\'t answer in time. Matching request IDs in the proxy\'s and the app\'s logs shows exactly what happened.'
    ]
  });

  S.explain('reverse-proxy-nginx', {
    base: [
      '**nginx** is a widely used, very fast web server and reverse proxy. It\'s commonly put in front of ASP.NET Core apps on Linux servers.',
      'Kestrel can face the internet directly, but a proxy handles certificates, limits, compression and multiple apps in one well-tested place.',
      '**localhost** (`127.0.0.1`) is the machine talking to itself. A program listening only on localhost can\'t be reached from other machines.',
      'nginx is configured with text files made of nested blocks: `http`, `server` (one per website) and `location` (one per URL path).'
    ],
    beats: [
      'nginx listens on port 443 for HTTPS, decrypts the request with the site\'s certificate, and passes it to Kestrel at `127.0.0.1:5001` (`proxy_pass`). Kestrel listens only on localhost, so the only way in from outside is through nginx.',
      'nginx checks limits before the app does any work. Request bodies over `client_max_body_size` (default **1 MB**) are rejected with 413, so a 20 MB image upload fails at nginx, never reaching the app, until you raise that limit. It also buffers slow clients so Kestrel isn\'t tied up by them.',
      'An `upstream` block lists one or more app instances, and nginx spreads requests across them. To change configuration, run `nginx -t` to test it, then **reload**: nginx starts new workers with the new settings while old workers finish their current requests. Nothing is dropped. A restart, by contrast, cuts connections.',
      'A classic trap: directives like `proxy_set_header` and `add_header` are inherited from outer blocks only if the inner block sets **none** of its own. Set one header in a `location` and every inherited one disappears. WebSockets (used by SignalR and Blazor Server) also need the `Upgrade` and `Connection` headers forwarded and a long read timeout, or live connections drop.'
    ]
  });

  S.explain('other-proxies', {
    base: [
      'nginx isn\'t the only reverse proxy. Several others do the same basic job (accept requests, forward them to your app) with different strengths.',
      'A **certificate authority** such as Let\'s Encrypt issues the certificates HTTPS needs. They expire, so they must be renewed regularly.',
      'In the cloud, the platform often provides the proxy as a managed service.'
    ],
    beats: [
      '**Caddy** gets a certificate from Let\'s Encrypt for your domain automatically and renews it forever, with no extra tools. A complete production configuration can be three lines. It\'s great for small teams and single servers.',
      '**Traefik** watches Docker (or Kubernetes) and reads **labels** attached to your containers, such as "route kettle.example to me". When a container starts, the route appears; when it stops, the route goes. Nothing has to be edited by hand when containers change.',
      '**YARP** is a library, not a separate program: you build your proxy as an ASP.NET Core app, so routing, authentication and request changes are ordinary C#. It suits API gateways with custom logic. **IIS** is the Windows web server; with the ASP.NET Core Module it hosts .NET apps, usually inside its own process.',
      'On a cloud platform, a **managed front door** (Azure Front Door, AWS load balancers, Cloudflare, Kubernetes ingress) does this job, often adding a web application firewall. Lock your app so it accepts traffic **only** from that front door, or attackers can call it directly and skip every protection the front door provides.'
    ]
  });

  S.explain('linux-deploy', {
    base: [
      '**Deploying** means getting a new version of your app running on the server, replacing the old one.',
      'Most servers run **Linux**. On Linux, **systemd** is the program that starts services at boot, restarts them if they crash, and stops them on request.',
      '**Downtime** is any period when users can\'t use the app. A plain stop-then-start deploy causes a few seconds of it.',
      '**Rollback** is going back to the previous version when a new one misbehaves.'
    ],
    beats: [
      'The app runs as a systemd service, described in a short "unit" file: which program to run, as which user, with which settings. systemd starts it at boot, restarts it if it crashes, and on stop sends a signal (SIGTERM) that makes .NET shut down gracefully, finishing requests in progress. It runs as a dedicated user, not root, so a bug can\'t take over the whole machine.',
      'Two copies of the service exist, on ports 5001 and 5002: **blue/green slots**. v41 is live on 5001. CI uploads v42, and the deploy script unpacks it into the **idle** slot (5002) and starts it. The script then polls the app\'s `/health/ready` endpoint until it says it\'s ready, which includes reaching the database. Customers are still on v41 throughout.',
      'Once v42 is ready, the script points nginx\'s upstream at port 5002, checks the config with `nginx -t`, and reloads nginx. New requests go to v42; requests already in progress on v41 finish normally. After a short wait the script stops v41. Customers saw no gap.',
      'If v42 turns out to be broken, rolling back is the same move in reverse: v41\'s files are still on disk, so start it, point nginx back, reload. It takes seconds, and no rebuild is needed.',
      'Old and new versions briefly share one database, and a rollback means the old version runs against it again. So database changes must be backward compatible: add first, remove later (**expand, then contract**). And because a single server can die, the database is backed up every night to somewhere else, and restoring a backup is tested regularly.'
    ]
  });

  S.explain('docker', {
    base: [
      'Apps depend on more than their own code: a specific .NET runtime version, system libraries, configuration. If production differs from a developer\'s laptop, things break in confusing ways.',
      'A **container image** packages the app with everything it needs to run, so it behaves the same everywhere. **Docker** is the most common tool for building and running images.',
      'A **container** is a running instance of an image: an isolated process with its own filesystem view, sharing the host\'s operating system kernel.'
    ],
    beats: [
      'An image is a stack of read-only **layers**: a minimal operating system at the bottom, then the ASP.NET Core runtime, then your published app on top. Layers are cached and shared, so if only your code changes, only the top layer is rebuilt and uploaded.',
      'Starting a container adds a thin **writable layer** on top for any files it writes, which disappears with the container. The same image runs on a laptop, in CI and in production, so "it works on my machine" now means it works everywhere.',
      'A Dockerfile can have several stages. The first uses the big .NET **SDK** image to build and publish the app. The final stage starts from a small runtime-only image and copies in just the published output. The SDK (hundreds of megabytes) never ships, making images smaller, faster to deploy and with less for attackers to use.',
      'Write `ENTRYPOINT ["dotnet", "Kettle.dll"]` in the JSON (exec) form, so `dotnet` is the main process and receives the stop signal directly, which lets .NET shut down gracefully. .NET also reads the container\'s CPU and memory limits and sizes its thread pool and garbage collector to fit them.'
    ]
  });

  S.explain('containers-single-host', {
    base: [
      'A real app is several containers working together: a proxy, the API, a background worker, a database.',
      '**Docker Compose** describes all of them in one file, `compose.yaml`: which images, which settings, which order, how they connect. One command starts or updates the whole set.',
      'A **volume** is storage that lives outside a container, so data survives when the container is replaced.',
      'An image **tag** is a version label, such as `api:v42`.'
    ],
    beats: [
      'The server runs only Docker. Everything else is described in `compose.yaml`, kept in Git. Staging and production use the same file with different settings, so they stop drifting apart, and a lost server can be rebuilt from the file and a backup.',
      'Each service has a **health check**, a command Docker runs to ask "are you ready?". With `depends_on: condition: service_healthy`, the API only starts once Postgres reports healthy, and the proxy once the API does, so nothing starts before what it needs.',
      'CI builds images tagged with a version and pushes them to a registry. To deploy, change the tag (v41 → v42) and run `docker compose up -d --wait`: Docker pulls the new images, replaces only the changed containers, and waits until they\'re healthy. Rolling back is setting the old tag again. Database files live in a named **volume**, so they survive the container being replaced.',
      'Only the proxy publishes ports (80, 443) to the outside world; the others talk on a private network Compose creates. This matters because Docker\'s published ports skip the firewall (`ufw`) on many Linux setups, so a published database port can be open to the whole internet. Secrets are mounted as files, not environment variables, which leak into logs and debugging tools.'
    ]
  });

  S.explain('prod-config', {
    base: [
      'An app that works in testing can still fail in production, under real load, with slow dependencies, during deploys. Most protection comes from settings, not new code.',
      'A **health check** is an endpoint the platform calls to ask whether the app is OK.',
      '**Graceful shutdown** means finishing work in progress before exiting, instead of cutting it off.',
      'Every platform gives a stopping app a **grace period**, then kills it if it hasn\'t exited.'
    ],
    beats: [
      'With `ValidateOnStart`, the app checks its configuration while starting. A missing connection string stops startup, so the deploy fails and the old version keeps serving. Without it, the app starts fine and fails on the first customer\'s request.',
      'There are two different health questions. **Liveness**: is the process stuck, so should the platform restart it? **Readiness**: can it handle requests right now, so should traffic go to it? Only readiness checks dependencies such as the database.',
      'If liveness checked the database, a 30-second database blip would make the platform restart **every** copy of the app at once. They\'d all come back cold and reconnect together, turning a short blip into a long outage.',
      'On shutdown, the app\'s own timeout (`HostOptions.ShutdownTimeout`) must be shorter than its supervisor\'s (systemd\'s or Docker\'s stop timeout), which must be shorter than the platform\'s grace period. If the inner timeout is longer, requests are killed mid-flight. Docker\'s default is only 10 seconds.',
      'If the app is slow but CPU is low, threads are blocked waiting, usually from `.Result` or `.Wait()` on async code: **thread-pool starvation**. More generally, put a limit on everything: request body size, request duration, and a timeout on every outgoing call. Anything unbounded becomes an outage under load.'
    ]
  });

  S.explain('project-foundations', {
    base: [
      'Starting a new project, the first two weeks set habits that last for years. Rules that are easy to set now become huge clean-up projects later.',
      'A **build** compiles and checks the code. A **quality gate** is a check the build enforces: if it fails, the change can\'t be merged.',
      '**CI** runs these checks automatically on every proposed change.',
      'A **walking skeleton** is the thinnest version of the whole system that runs end to end in production.'
    ],
    beats: [
      'Settings every project shares go in a few files at the repository root. `Directory.Build.props` holds build rules (target framework, nullable checks, warnings as errors). `Directory.Packages.props` holds every package version once. `.editorconfig` holds code style. `global.json` pins the SDK version. Projects then only say what\'s unique to them.',
      'Each change goes through the **CI gate**: check formatting, build with warnings treated as errors and analysers on, run every test. If anything fails, it can\'t be merged. Style arguments become compiler errors, so code reviews can focus on design and correctness.',
      'Before building features, ship a **walking skeleton**: one tiny endpoint, deployed by the real pipeline through staging to production, with health checks and monitoring working. The hard, boring problems (networking, secrets, permissions, deployment) surface on day three instead of launch week, and every feature after that is a small change to a working system.',
      'Some decisions are expensive to reverse: the database, the architecture, the hosting platform. Write each down in a one-page **decision record**: the context, the decision, the alternatives, the consequences. A year later, whoever wonders "why did we do this?" can find out.'
    ]
  });

  S.explain('delivering-work', {
    base: [
      'Large projects rarely fail because the code is hard. They fail because problems are discovered late: pieces that don\'t fit, work that was bigger than it looked.',
      'A **branch** is a separate line of development in Git. A **long-lived branch** stays separate for weeks or months, then has to be merged back.',
      'A **feature flag** is a setting that switches a piece of code on or off without redeploying.'
    ],
    beats: [
      'Building all the database code, then all the API code, then all the UI means nothing works until everything is finished, and the end is when integration surprises appear, with no time left to fix them.',
      'A **vertical slice** is one small feature built through every layer at once: quote, then credit check, then order, then invoice. Each slice works on its own and can be shown to real users, so progress is visible and problems appear early.',
      'Everyone merges small changes into the main branch every day (**trunk-based development**). Unfinished features are deployed but hidden behind a flag that\'s switched off. Releasing then becomes flipping the flag, for some users first, and switching it off again if something breaks, with no redeploy.',
      'To replace code that\'s already live, like pricing, run the new version alongside the old one on real requests (**shadow run**): customers still get the old result while differences are logged. Switch over only once the only differences are the intended ones. Note that a percentage flag decides randomly on every call, so for users, use **targeting**, which keeps each user consistently in one group.'
    ]
  });

  S.explain('production-ownership', {
    base: [
      'Shipping is the start of a service\'s life, not the end. The team that builds it is responsible for keeping it working.',
      'An **SLO** (service level objective) is a target for reliability, measured from the user\'s point of view, such as "99.9% of quote requests succeed over 30 days".',
      'An **incident** is any unplanned problem that hurts users. A **runbook** is a written guide for handling a specific alert.'
    ],
    beats: [
      'A 99.9% target allows 0.1% failure: about **43 minutes** of total outage a month. That allowance is the **error budget**. While it lasts, the team can ship and take risks; when it\'s spent, reliability work comes first. It turns "how reliable is enough?" into a number everyone agrees on.',
      'Alert on how fast the budget is being used up (the **burn rate**), not on every small blip. Burning at 14.4 times the sustainable rate for an hour uses 2% of the month\'s budget, so wake someone up. Slow burns create a ticket instead. Every alert links to a **runbook** that says what to check and do first.',
      'During an incident, restore service before investigating: roll back the last deploy or switch off the feature flag. Finding the root cause can wait until users are no longer affected. One person coordinates, so people don\'t work against each other.',
      'Afterwards, write a **blameless postmortem**: the timeline, the contributing factors and the specific actions to prevent a repeat, each with an owner and a date. Blame makes people hide information; looking at how the system allowed the mistake leads to real fixes.',
      'The **DORA** metrics measure delivery: how often you deploy, how long a change takes to reach production, how often deploys fail, and how fast you recover. Research shows teams that deploy small changes often have **fewer** failures and recover faster: speed and stability go together.'
    ]
  });

  S.explain('staff-engineer', {
    base: [
      'A **staff engineer** is a senior technical role, above senior engineer, focused on technical direction across several teams rather than on one team\'s code.',
      'The job is less about writing the most code and more about making good decisions happen: through documents, reviews, mentoring and influence.',
      'Most of that influence comes without formal authority: staff engineers usually don\'t manage the people they lead.'
    ],
    beats: [
      'With three teams and fifteen engineers, you can\'t review every pull request or attend every meeting. Your impact now comes through other people: helping teams make good technical choices that fit together.',
      'A **design doc** lays out a problem, the goals and non-goals, the options with their trade-offs, and a recommendation, before expensive work starts. People who weren\'t in the room can review the reasoning, and the decision is recorded for later.',
      'A **technical strategy** names the real underlying problem ("releases take three weeks because all teams share one deployable"), the general approach to fixing it, and a few concrete actions. Its value is in what it says **not** to do, so everyone stops debating the same alternatives.',
      'You lead mostly through influence: build trust by being right and following through, talk to key people **before** big meetings so objections come out early, decide reversible things quickly and take care over irreversible ones, and finish the large migrations everyone starts and nobody completes.'
    ]
  });

  S.explain('capstone-wholesale', {
    base: [
      'Every earlier scene showed one technique. In a real project they all happen at once, under a deadline, and the order matters.',
      'This scene follows Kettle Wholesale, a new product, from first idea to a running, well-run service.',
      'Each phase has **exit criteria**: concrete checks that say it\'s really done.'
    ],
    beats: [
      'Discovery: talk to real customers, write down what they need, list the biggest risks and unknowns, and agree what\'s out of scope for the first release. Building the wrong thing well is still failure.',
      'Set up the foundations (shared build rules, CI, decision records), then deploy a **walking skeleton** to production. From then on, each feature is a small change to a system that already deploys and is already monitored.',
      'Build features in vertical slices, merged daily behind feature flags. Then **harden**: load-test at ten times the expected traffic, deliberately break dependencies to check failure handling, review security, and set up reliability targets, alerts and runbooks.',
      'Launch gradually: internal users, then a few friendly customers, then everyone, watching the metrics at each step with a rollback ready. Then operate: on-call, postmortems after incidents, and a steady budget for paying down technical debt.',
      'The architecture starts simple: a modular monolith on a managed platform. The decision record lists the **triggers** for changing it, such as "split out pricing when a separate team owns it". That way complexity is added when there\'s a real reason, not up front.'
    ]
  });
})(window.STORY);
