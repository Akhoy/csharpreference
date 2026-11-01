// Part 0 and Part I: the map, and how code becomes a running program.
(S => {
  const L = ['1 · C# language', '2 · Runtime (CLR)', '3 · Frameworks', '4 · Architecture', '5 · Data and state', '6 · Communication', '7 · Infrastructure', '8 · Cross-cutting'];
  S.scene({
    id: 'big-picture', part: 'p0', title: 'The map',
    hook: 'There is a lot to learn, and nothing seems connected.',
    a: [
      ['zone', 'z', 470, 180, 'What one request touches', { w: 270, h: 346 }],
      ...L.map((t, i) => ['pill', 'L' + i, 470, 58 + i * 38, t, { w: 226, c: 'mute' }]),
      ['user', 'u', 60, 180, 'Customer'],
      ['box', 'api', 210, 180, 'Kettle API', { sub: 'ASP.NET Core' }],
      ['arr', 'a1', 'u', 'api', ''],
      ['dot', 'r', 60, 180, '', { o: 0 }]
    ],
    b: [
      { say: 'A customer taps **Buy tea**. A request leaves their phone and reaches the Kettle API.', go: [['r', 'api']] },
      { say: 'Inside, it is **C#** code, running on the **.NET runtime**, inside a **framework**.', acc: ['L0', 'L1', 'L2'], go: [['r', 'L0', 'L1', 'L2']] },
      { say: 'The code follows an **architecture**, stores **data**, and **talks** to other services.', acc: ['L3', 'L4', 'L5'], go: [['r', 'L3', 'L4', 'L5']] },
      { say: 'All of it runs on **infrastructure**: containers in the cloud.', acc: ['L6'], go: [['r', 'L6']] },
      { pro: true, say: 'Testing, security, observability and performance cut across every layer. Place each new term you meet on this map.', acc: ['L7'], go: [['r', 'L7']], pulse: ['L7'] }
    ],
    key: 'Every topic lives on one of these 8 layers. Know which, and it connects.'
  });

  S.scene({
    id: 'what-is-dotnet', part: 'p1', title: 'One platform for every app',
    hook: 'Kettle needs a web API, a background worker and a command-line tool.',
    a: [
      ['box', 'rt', 320, 185, '.NET', { sub: 'runtime + libraries', w: 160, c: 'acc' }],
      ['pill', 'web', 175, 75, 'Web API', { o: 0 }],
      ['pill', 'wk', 320, 55, 'Worker', { o: 0 }],
      ['pill', 'cli', 465, 75, 'CLI tool', { o: 0 }],
      ['pill', 'desk', 175, 300, 'Desktop', { o: 0 }],
      ['pill', 'mob', 320, 320, 'Mobile', { o: 0 }],
      ['pill', 'game', 465, 300, 'Games', { o: 0 }],
      ['box', 'fw', 85, 185, '.NET Framework', { sub: 'Windows only', w: 140, c: 'mute', o: 0 }],
      ['arr', 'af', 'fw', 'rt', 'replaced by', { dash: true, o: 0 }],
      ['pill', 'sdk', 555, 165, 'SDK: build', { o: 0, c: 'why', w: 150 }],
      ['pill', 'run', 555, 205, 'Runtime: run', { o: 0, c: 'ok', w: 150 }]
    ],
    b: [
      { say: 'One platform builds all three. Same language, same libraries.', show: ['web', 'wk', 'cli'], pulse: ['rt'] },
      { say: 'The same .NET also builds desktop, mobile and game apps.', show: ['desk', 'mob', 'game'] },
      { say: 'The old **.NET Framework** only ran on Windows. Modern **.NET** runs on Linux, macOS and in containers.', show: ['fw', 'af'], rt: { t: '.NET 10', sub: 'any OS' } },
      { say: 'You **build** with the SDK. A server only needs the **runtime** to run the result.', show: ['sdk', 'run'] },
      { pro: true, say: 'Even-numbered releases are **LTS** (3 years of support), odd ones **STS** (2 years). Production usually follows LTS.', rt: { t: '.NET 10 LTS', sub: 'Nov 2025' }, pulse: ['rt'] }
    ],
    key: 'One cross-platform .NET runs every kind of app Kettle needs.'
  });

  S.scene({
    id: 'how-code-runs', part: 'p1', title: 'From C# to machine code',
    hook: 'The CPU cannot read C#. Something has to translate it.',
    a: [
      ['code', 'src', 108, 110, 'int Add(int a, int b)\n  => a + b;'],
      ['box', 'roslyn', 310, 110, 'Compiler', { sub: 'Roslyn' }],
      ['box', 'il', 505, 110, 'IL in a .dll', { sub: 'same on every OS', w: 150 }],
      ['box', 'jit', 310, 255, 'JIT', { sub: 'at run time' }],
      ['box', 'cpu', 505, 255, 'Machine code', { sub: 'x64 or ARM64', w: 150 }],
      ['arr', 'a1', 'src', 'roslyn', '', { o: 0 }],
      ['arr', 'a2', 'roslyn', 'il', '', { o: 0 }],
      ['arr', 'a3', 'il', 'jit', 'first call', { o: 0 }],
      ['arr', 'a4', 'jit', 'cpu', '', { o: 0 }],
      ['pill', 'aot', 150, 255, 'Native AOT: no JIT', { o: 0, c: 'warn' }],
      ['dot', 'p', 108, 110, '', { o: 0 }]
    ],
    b: [
      { say: 'You write C#. Nothing can run it directly yet.', pulse: ['src'] },
      { say: 'At build time the **compiler** turns it into **IL**: portable instructions, stored in a .dll.', show: ['a1', 'a2'], go: [['p', 'roslyn', 'il']], acc: ['il'] },
      { say: 'When a method is first called, the **JIT** compiles its IL into machine code for this CPU.', show: ['a3', 'a4'], go: [['p', 'jit', 'cpu']], acc: ['cpu'] },
      { pro: true, say: 'The JIT starts with quick code, then recompiles **hot** methods using live profile data. **Native AOT** compiles everything up front: fast start, no JIT.', jit: { t: 'Tier 0 → Tier 1', sub: 'PGO on hot paths' }, show: ['aot'], pulse: ['jit'] }
    ],
    key: 'C# becomes IL at build time and machine code at run time.'
  });

  S.scene({
    id: 'projects-sdk-nuget', part: 'p1', title: 'Projects and packages',
    hook: 'Kettle needs other people\'s libraries, and a repeatable build.',
    a: [
      ['code', 'proj', 118, 110, '<Project Sdk="...Web">\n  <PackageReference\n    Include="Dapper"/>\n</Project>'],
      ['db', 'nuget', 340, 55, 'nuget.org'],
      ['box', 'restore', 340, 180, 'dotnet restore'],
      ['box', 'build', 525, 180, 'dotnet build', { sub: 'bin/Kettle.dll', w: 150 }],
      ['box', 'pub', 525, 295, 'dotnet publish', { sub: 'ready to deploy', w: 150 }],
      ['arr', 'a1', 'proj', 'restore', '', { o: 0 }],
      ['arr', 'a2', 'nuget', 'restore', '', { o: 0 }],
      ['arr', 'a3', 'restore', 'build', '', { o: 0 }],
      ['arr', 'a4', 'build', 'pub', '', { o: 0 }],
      ['pill', 'cpm', 150, 295, 'Directory.Packages.props', { o: 0, c: 'why' }],
      ['dot', 'pk', 340, 55, 'pkg', { o: 0 }]
    ],
    b: [
      { say: 'A **.csproj** file lists what to build and which packages Kettle needs.', pulse: ['proj'] },
      { say: '**restore** downloads those packages from NuGet.', show: ['a1', 'a2'], go: [['pk', 'restore']] },
      { say: '**build** compiles to a .dll. **publish** gathers everything needed to deploy it.', show: ['a3', 'a4'], go: [['pk', 'build', 'pub']], acc: ['build', 'pub'] },
      { pro: true, say: 'In big solutions, **Central Package Management** pins every version in one file, and lock files make restores repeatable.', show: ['cpm'], pulse: ['cpm'] }
    ],
    key: 'csproj → restore → build → publish.'
  });
})(window.STORY);
