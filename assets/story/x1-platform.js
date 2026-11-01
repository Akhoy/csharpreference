// Explanations for Part 0 and Part I scenes: a from-zero primer (base) and one explanation per beat (beats).
(S => {
  S.explain('big-picture', {
    base: [
      'A **program** is a list of instructions a computer follows. A **backend** is the program on a server that a website or app talks to: it checks orders, saves them and sends emails.',
      'A **request** is one message from a phone or browser to that server ("buy this tea"), and the **response** is the answer it gets back.',
      'Building a backend involves many separate skills: the language, the platform it runs on, how code is organised, where data is kept, how servers talk, and where it all runs. Beginners get lost because these are usually taught separately.',
      'This scene gives you one map with eight layers. Every later scene sits on one of them.'
    ],
    beats: [
      'Follow one request from start to finish. A customer taps a button in the Kettle app. The phone sends a request over the internet to Kettle\'s server, the "Kettle API". Everything in this storybook is about what happens to that request and the code that handles it.',
      'The code that handles it is written in **C#** (layer 1). C# can\'t run by itself: the **.NET runtime** (layer 2) loads and runs it. A **framework** such as ASP.NET Core (layer 3) is ready-made code that does the common work, like reading the request, so Kettle only writes what is specific to tea.',
      '**Architecture** (layer 4) is how the code is organised so it stays easy to change. **Data** (layer 5) is where orders are kept, usually a database. **Communication** (layer 6) is how Kettle talks to other programs, such as a payment provider.',
      '**Infrastructure** (layer 7) is the machines everything runs on. Today that is usually rented servers in a cloud data centre, with the app packaged in a **container**: a sealed box holding the app and everything it needs.',
      'Some concerns aren\'t a layer of their own because they touch every layer: **testing** (proving it works), **security** (keeping attackers out), **observability** (seeing what it\'s doing in production) and **performance** (speed and cost). When you meet a new word, ask which layer it belongs to.'
    ]
  });

  S.explain('what-is-dotnet', {
    base: [
      '**.NET** is a free platform from Microsoft for building and running programs. You write the code in a language, usually **C#**, and .NET provides everything around it.',
      'It has three main parts: the **runtime**, which runs your program; a large **library** of ready-made code (for files, networking, text, dates, JSON and much more); and the **SDK**, the tools that build your program.',
      'A **web API** answers requests from apps. A **background worker** does jobs nobody is waiting for, like sending emails. A **command-line tool** is a program you run by typing its name in a terminal.',
      'A **cross-platform** program runs on more than one operating system: Windows, Linux and macOS.'
    ],
    beats: [
      'Kettle needs three different kinds of program. With .NET they are all written in C#, use the same library, and are built with the same tools. A developer who knows one can work on all three, and code such as the pricing rules can be shared between them.',
      'The same platform also builds desktop apps, mobile apps and games. This book focuses on backends, but everything about the language and runtime applies everywhere.',
      'There are two generations. **.NET Framework** (2002) only ever ran on Windows and is now only maintained. **Modern .NET** (called ".NET Core" until version 5) runs on Linux and macOS too, which matters because most servers and containers run Linux. New projects always use modern .NET.',
      'The **SDK** is for developers and build servers: it compiles your code. The result is a set of files that only needs the much smaller **runtime** to run. So a laptop has the SDK, and a production server usually has just the runtime, or a copy bundled with the app.',
      'A new .NET version ships every November. **LTS** (long-term support) versions get security fixes for three years; **STS** versions for two. Running an unsupported version means no security fixes, so production teams usually pick an LTS release and upgrade on a schedule.'
    ]
  });

  S.explain('first-app', {
    base: [
      'A **project** is a folder with a `.csproj` file, which describes what to build, and `.cs` files, which hold the C# code.',
      'The **`dotnet` command** is the tool you type commands into: create a project, run it, test it, publish it. Editors such as Visual Studio, VS Code and Rider run the same commands for you.',
      '**Building** (or compiling) turns your C# into a form the computer can run. **Running** starts the result.',
      '**Debugging** means pausing a running program to look inside it. A **test** is a small piece of code that checks other code gives the right answer.',
      '**Publishing** produces the final folder you copy to a server.'
    ],
    beats: [
      '`dotnet new console` creates a starter project in a few seconds. The `.csproj` file says it\'s an executable program and which .NET version to use. `Program.cs` holds the code. With "top-level statements", the lines at the top of `Program.cs` are where the program starts: there\'s no need to write a `Main` method yourself.',
      '`dotnet run` does three things: downloads any libraries the project needs, compiles the code, then runs it. Here it prints "Assam". `dotnet watch` keeps the program running and reapplies your changes each time you save a file, so you see the result in a second.',
      'Click next to a line to set a **breakpoint**, then start with debugging (F5). The program runs normally until it reaches that line, then freezes. You can now see the value of every variable, run one line at a time (F10), or step into a method (F11). It\'s the fastest way to see what code really does.',
      'Tests go in a separate project that references the code it checks, so test code never ships with the app. Each test sets something up, calls the code, and checks the answer. `dotnet test` runs every test and lists any that fail.',
      '`dotnet publish -c Release` compiles with optimisations on and copies everything needed into one folder. That folder runs on a server without the SDK and without your source code. "Release" matters: the default "Debug" build is slower and is meant only for development.'
    ]
  });

  S.explain('how-code-runs', {
    base: [
      'A **CPU** (processor) only understands **machine code**: very simple numbered instructions, and different kinds of CPU (Intel, ARM) use different ones.',
      'A **compiler** is a program that translates code from one language to another.',
      '.NET translates in two steps. At build time, C# becomes **IL** (Intermediate Language), a portable in-between form. At run time, the **JIT** (just-in-time compiler) turns IL into machine code for the exact CPU it\'s running on.',
      'The compiled IL is saved in a file called an **assembly**, which is the `.dll` file you see after building.'
    ],
    beats: [
      'C# is written for people: names, structure, comments. The CPU can\'t read any of it. Something has to translate it, and the question is when: all at once before shipping, or at the last moment on the machine that runs it. .NET does a bit of both.',
      'When you build, the C# compiler checks your code for errors and translates it into **IL**. IL is not machine code: it\'s a compact, CPU-independent instruction set. The `.dll` also stores **metadata**, a full description of every type and method, which tools, debuggers and the runtime read.',
      'When the app runs and a method is called for the first time, the **JIT** translates that method\'s IL into machine code for this CPU, then runs it. The machine code is kept, so later calls skip translation. That\'s why the same `.dll` runs on Windows, Linux, Intel and ARM.',
      'The JIT first compiles quickly so the app starts fast. It counts how often each method runs; methods that run a lot are compiled again with more optimisation, using what it saw while the app ran (this is called tiered compilation with dynamic PGO). **Native AOT** skips the JIT entirely by compiling to machine code at build time: very fast startup and low memory, but features that generate or inspect code at run time are limited.'
    ]
  });

  S.explain('projects-sdk-nuget', {
    base: [
      'Almost every app uses code written by other people: libraries for JSON, databases, logging and so on. In .NET, these come as **packages** from **NuGet**, the public package store at nuget.org.',
      'Your `.csproj` file lists the packages your project needs. You don\'t copy library files into your project yourself.',
      'A **repeatable build** gives the same result on every machine, every time. Without it, "it works on my machine" bugs appear.',
      'A **solution** groups several projects, such as the API, a shared library and the tests.'
    ],
    beats: [
      'The `.csproj` is a short XML file. It says what kind of project this is (web app, library, test), which .NET version to target, which other projects it uses, and which NuGet packages it needs, by name and version.',
      '**Restore** reads that list and downloads each package, plus the packages they depend on, into a shared cache on your machine. It happens automatically before a build. Because the list is in the `.csproj`, a new teammate gets exactly the same libraries.',
      '**Build** compiles your code and links it with the packages, producing your `.dll` in the `bin` folder. **Publish** goes one step further: it gathers your `.dll`, every package\'s files and the configuration files into one folder that is ready to deploy.',
      'With 30 projects, each might ask for a different version of the same library, and bugs appear. **Central Package Management** lists every version once in `Directory.Packages.props`. **Lock files** record the exact versions actually used, including indirect ones, so a build next month uses the same versions as today unless someone deliberately changes them.'
    ]
  });
})(window.STORY);
