// Explanations for Parts VIII (distributed systems) and XI (cloud).
(S => {
  S.explain('messaging-events', {
    base: [
      'When one part of a system calls another directly and waits for the answer, it\'s a **synchronous** call. If the other part is slow or down, the caller is stuck too.',
      'A **message broker** (RabbitMQ, Azure Service Bus) is a separate service that receives messages and holds them until the receivers are ready: like a post office.',
      'An **event** is a message saying something happened, such as "OrderPlaced". The sender is the **publisher**; anyone interested is a **subscriber** (or consumer).'
    ],
    beats: [
      'After saving an order, checkout used to call the email service, then stock, then analytics, one after another, waiting for each. Now it publishes one message, **OrderPlaced**, to the broker and returns to the customer straight away. It doesn\'t know or care who is listening.',
      'The broker gives each subscriber its own copy. Email, stock and analytics each process it at their own pace. If email is down for 10 minutes, its messages wait in its queue and are delivered when it comes back. Checkout keeps working throughout.',
      'Networks and processes fail at awkward moments: a consumer may process a message and crash before telling the broker it\'s done, so the broker delivers it again. Brokers guarantee **at least once**, not exactly once. Consumers must therefore be **idempotent**: processing the same message twice has the same effect as once, for example by recording processed message IDs.',
      'Checkout must save the order (database) **and** publish the event (broker). These are two systems with no shared transaction: a crash between the two loses the event. With the **outbox pattern**, the event is saved into an "outbox" table in the same database transaction as the order. A separate relay reads that table and publishes to the broker, so the order and its event are saved together or not at all.'
    ]
  });

  S.explain('resilience', {
    base: [
      'Anything reached over a network will sometimes fail. Most failures are **transient**: a brief blip that fixes itself in a moment.',
      'A naive response, failing immediately or retrying instantly and forever, often turns a 2-second blip into a long outage.',
      '**Resilience** means handling these failures deliberately: retrying sensibly, setting timeouts, and backing off when something is really broken.'
    ],
    beats: [
      'The first call to the payment provider fails. Retry, but not instantly: wait, say, 200 ms, then 400 ms, then 800 ms (**exponential backoff**), with a little randomness added (**jitter**) so thousands of clients don\'t all retry at the same moment. Most transient failures succeed on the first or second retry.',
      'If calls keep failing, more retries just add load to a service that\'s already struggling. A **circuit breaker** counts failures; past a threshold it **opens**, and calls fail immediately without being sent. Users get a fast error or a fallback, and the provider gets room to recover.',
      'After a pause, the breaker goes **half-open**: it lets one trial call through. If it succeeds, the breaker closes and normal traffic resumes. If it fails, the breaker opens again for another pause.',
      'If the app retries 3 times, and the HTTP client retries 3 times, and the SDK retries 3 times, one failure becomes 27 calls: a **retry storm** that can take the other service down. Retry at one layer only. And only retry operations that are safe to repeat: retrying a payment without an idempotency key could charge twice.'
    ]
  });

  S.explain('observability-aspire', {
    base: [
      '**Observability** is being able to understand what a running system is doing from the outside, using the data it emits.',
      'There are three kinds of data. **Logs** are individual records of events. **Metrics** are numbers measured over time (requests per second, error rate). **Traces** show the path and timing of single requests.',
      'In a system of several services, one user request can pass through five of them, so you need a way to follow it.'
    ],
    beats: [
      'A **trace** gets a unique ID when the request enters the system, and that ID is passed along with every call it makes. Each step (an HTTP call, a database query) is recorded as a **span** with a start time and duration. Together they show the whole journey of one request.',
      'Shown as a waterfall, the spans make the problem obvious: the request took 1.8 seconds, and 1.5 of those were one SQL insert. No guessing across five services.',
      'Each kind answers a different question. **Metrics** cheaply tell you **that** something is wrong: errors are up, latency is up. **Traces** tell you **where**: which service, which call. **Logs** carrying the same trace ID tell you **why**: the exact error and its details.',
      '.NET produces all three through **OpenTelemetry**, an open standard that many monitoring tools accept. Keep metric **tags** to a few values: tagging by user ID creates a separate time series per user, which is slow and expensive. **.NET Aspire** starts all your services and dependencies locally and shows their logs, traces and metrics in one dashboard.'
    ]
  });

  S.explain('cloud-azure-overview', {
    base: [
      'The **cloud** means renting computing resources (servers, databases, storage) from a provider such as Microsoft Azure, AWS or Google Cloud, instead of buying and running your own hardware.',
      'You pay for what you use, and can get more within minutes when you need it.',
      'Cloud services differ in how much the provider manages for you. The less you manage, the less control you have, and the less work you do.'
    ],
    beats: [
      '**IaaS** (infrastructure as a service) rents you **virtual machines**: software-defined computers. The provider runs the hardware, but you install and patch the operating system, the .NET runtime and everything else. Maximum control, most work.',
      '**PaaS** (platform as a service), such as Azure App Service, runs the operating system and runtime for you, including security patches. You upload just your app. Less control, much less work, and usually the right default for a team without dedicated operations staff.',
      'When traffic grows, you can **scale up**: switch to a bigger machine (more CPU and memory), which has a limit and usually needs a restart. Or **scale out**: run more copies of the app behind a **load balancer** that spreads requests between them. Scaling out has no fixed limit and also survives a single copy failing.',
      'Scaling out only works if any copy can handle any request. So nothing important may live only in one copy\'s memory or disk: sessions go in Redis, files in blob storage. The app is **stateless**. Spreading copies across **availability zones** (separate data centres in one region) keeps the app running if a whole building fails.'
    ]
  });

  S.explain('azure-compute', {
    base: [
      '**Compute** is where your code actually runs. Azure offers several options with very different amounts of management.',
      'A **container** packages an app with everything it needs, so it runs the same anywhere. **Kubernetes** is a system for running many containers across many machines.',
      '**Serverless** means you supply code and the platform runs it on demand; you pay per execution and don\'t manage servers at all.'
    ],
    beats: [
      'From most control to most managed: **virtual machines** (you manage everything), **AKS** (managed Kubernetes: powerful, but you run the cluster\'s configuration), **Container Apps** (containers without a cluster to manage), **App Service** (upload your web app), **Functions** (upload individual functions). Each step right means less operations work, and less flexibility.',
      'App Service **deployment slots** are separate copies of your app, such as "staging" next to "production". Deploy to staging, warm it up and check it, then **swap**: the platform switches traffic over instantly. If something\'s wrong, swap back.',
      'Container Apps runs your containers and scales them automatically: by HTTP traffic, by the length of a queue, or down to zero copies when idle (so you pay nothing). You get most of Kubernetes\' benefits without operating Kubernetes.',
      'Functions suit short, event-triggered jobs: run when a file is uploaded, a message arrives or a timer fires. **Durable Functions** coordinate long workflows by recording each step; after a restart they **replay** the history to rebuild where they were, so orchestrator code must give the same result every time (no `DateTime.Now` or random numbers directly).'
    ]
  });

  S.explain('azure-data-messaging', {
    base: [
      'Earlier scenes covered databases, file storage, caches and message brokers. In the cloud, each is available as a **managed service**: the provider runs it, patches it, backs it up and scales it.',
      'Azure has three messaging services that sound alike but do different jobs.',
      'An **SDK client** is the .NET library object your code uses to talk to one of these services.'
    ],
    beats: [
      'Azure SQL Database for relational data, Cosmos DB for documents, Blob Storage for files, Azure Managed Redis for caching. You get backups, high availability and scaling as configuration settings rather than projects of their own.',
      'They look similar because all three move messages, but they\'re built for different shapes of work: important commands that must be processed reliably, notifications that something happened, and huge streams of small data points.',
      '**Service Bus** is for business messages that must not be lost, like orders and payments: queues, topics, ordering, retries and dead-lettering. **Event Grid** pushes short notices that something happened, like "a blob was uploaded", to whoever subscribed. **Event Hubs** ingests millions of events per second, like clicks or telemetry, for streaming and analytics.',
      'SDK clients keep connections open and are safe to share between threads, so create one per app and register it as a singleton, just like `HttpClient`. They also retry transient errors on their own, so wrapping them in another retry layer causes retry storms.'
    ]
  });

  S.explain('azure-identity-secrets', {
    base: [
      'An app needs to prove who it is to use a database or other service. Traditionally that\'s a **secret**: a password or key stored in configuration.',
      'Secrets leak: they get committed to Git, copied into chat, printed in logs. Then they must be found and rotated everywhere.',
      '**Microsoft Entra ID** (formerly Azure Active Directory) is Azure\'s identity system. It can vouch for apps as well as people.'
    ],
    beats: [
      'A connection string with a password ends up in config files, deployment scripts, developers\' laptops and eventually a Git commit. Anyone who sees it can use it, and you rarely know who has.',
      'A **managed identity** is an identity Azure creates for your app\'s resource. When the app needs the database, it asks Azure for a short-lived **token**, and Azure, knowing which resource is asking, issues it. The app presents the token. There\'s no password anywhere to leak.',
      '**RBAC** (role-based access control) grants that identity specific roles on specific resources: "read and write data in this one storage account". If the app is compromised, the attacker gets only that, not everything. That\'s **least privilege**.',
      '`DefaultAzureCredential` tries several ways to get a token in order: on your laptop it uses your own Azure login, and in Azure it uses the managed identity, with no code changes between the two. **Workload identity federation** lets systems outside Azure, such as GitHub Actions pipelines or Kubernetes pods, get tokens the same way without stored secrets.'
    ]
  });

  S.explain('cicd-iac', {
    base: [
      '**CI** (continuous integration): every code change is automatically built and tested. **CD** (continuous delivery or deployment): changes that pass are automatically released through environments to production.',
      'A **pipeline** is the scripted sequence of these steps, run by a tool such as GitHub Actions or Azure DevOps.',
      'An **artifact** is the built output, such as a container image, that gets deployed.',
      '**Infrastructure as code** (IaC) means describing servers, databases and networks in files, so they\'re created and changed by tools rather than by clicking in a portal.'
    ],
    beats: [
      'On every push, the pipeline restores packages, builds, runs all tests and reports the result on the pull request. Broken code is caught minutes after it\'s written, by the person who wrote it, instead of weeks later during a manual release.',
      'The pipeline builds the container image **once** and gives it a unique tag. That exact image goes to the test environment, then staging, then production; only configuration differs between them. What was tested is byte-for-byte what runs in production.',
      'Instead of switching everyone to the new version at once, a **canary** release sends, say, 5% of traffic to it first and watches error rates and latency. If they look fine, it moves to 50%, then 100%. If not, traffic goes back to the old version, and only a few users ever saw the problem.',
      'During a rollout, old and new versions run at the same time against the same database. So a schema change is split across releases: **expand** (add the new column), **migrate** (copy data, switch code to use it), **contract** (remove the old column once nothing uses it). Bicep or Terraform files describe the infrastructure, reviewed and versioned like application code.'
    ]
  });

  S.explain('kubernetes', {
    base: [
      '**Kubernetes** (K8s) runs containers across a group of machines called a **cluster**, and keeps them running.',
      'A **pod** is the smallest unit it runs: usually one container of your app. Pods come and go; they\'re replaceable.',
      'Kubernetes is **declarative**: you describe the state you want, and it works continuously to make reality match.'
    ],
    beats: [
      'A **Deployment** file says: run the `kettle-api` image, version 1.4, with 3 replicas. You apply it once. You don\'t say how or where to start the pods; Kubernetes decides.',
      'At 3 a.m. the machine running pod 3 fails, and the pod disappears.',
      'A **controller** constantly compares the actual state (2 pods running) with the desired state (3). Seeing the difference, it schedules a new pod on a healthy machine. Nobody is woken up; the system repaired itself.',
      'Pods get new IP addresses whenever they\'re replaced, so other parts of the system can\'t rely on them. A **Service** gives the group of pods one stable name and address, and spreads requests across whichever pods are currently healthy.',
      'Kubernetes asks each pod two health questions. **Readiness**: can you take traffic? If not, it\'s removed from the Service but left running. **Liveness**: are you stuck? If not, it\'s restarted. Never check the database in liveness: a brief database outage would make Kubernetes restart every pod at once, turning a blip into an outage.'
    ]
  });
})(window.STORY);
