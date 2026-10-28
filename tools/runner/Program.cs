#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

Console.WriteLine("C# runner ready.");

public partial class Runner
{
    // Assemblies loaded into a browser-wasm app report an empty Assembly.Location
    // (there's no real filesystem to point at), so the high-level Roslyn Scripting
    // API (CSharpScript.RunAsync) can't be used here: it unconditionally tries to
    // build a "host corlib" MetadataReference straight from a loaded Assembly object,
    // which throws on wasm no matter what references you already supplied.
    // The fix is to skip Scripting entirely and compile with the plain CSharpCompilation
    // API instead — the same "regular" compilation `dotnet run` uses for a top-level-statements
    // Program.cs — then emit to memory and invoke the generated entry point by reflection.
    //
    // References come from the SDK's own reference-assembly pack (Microsoft.NETCore.App.Ref),
    // not the published, trimmed _framework runtime assemblies: ref assemblies are metadata-only
    // (no IL bodies, so tiny) and carry the FULL untrimmed API surface the compiler expects —
    // fetching trimmed runtime assemblies instead caused exactly the type-forwarding gaps
    // (CancellationTokenSource, SemaphoreSlim, Parallel, …) that motivated this switch.
    // The exact list of shipped ref assemblies lives in refs/manifest.json alongside them.

    // .NET console templates enable ImplicitUsings, which brings these namespaces into
    // every file without an explicit `using`. Mirrored here so pasted book snippets
    // (written assuming that template) compile the same way in the browser.
    // CSharpCompilationOptions.WithUsings only takes effect for Script-kind compilations,
    // not the Regular top-level-statements kind used below, so these are added as a
    // separate synthetic tree instead — that also keeps the user's own line numbers
    // intact in any diagnostics they see.
    static readonly SyntaxTree ImplicitUsingsTree = CSharpSyntaxTree.ParseText(
        "global using System;\n" +
        "global using System.Collections.Generic;\n" +
        "global using System.Linq;\n" +
        "global using System.Threading.Tasks;\n" +
        "global using System.IO;\n",
        path: "ImplicitUsings.cs");

    static readonly HttpClient Http = new();
    static readonly object Gate = new();
    static Task<List<MetadataReference>>? _referencesTask;

    static Task<List<MetadataReference>> GetReferencesAsync(string refsBaseUrl)
    {
        lock (Gate)
        {
            _referencesTask ??= BuildReferencesAsync(refsBaseUrl);
            return _referencesTask;
        }
    }

    static async Task<List<MetadataReference>> BuildReferencesAsync(string refsBaseUrl)
    {
        var manifestJson = await Http.GetStringAsync($"{refsBaseUrl}manifest.json");
        var names = JsonSerializer.Deserialize<string[]>(manifestJson) ?? [];

        var refs = new List<MetadataReference>(names.Length);
        foreach (var name in names)
        {
            var bytes = await Http.GetByteArrayAsync($"{refsBaseUrl}{name}.dll");
            refs.Add(MetadataReference.CreateFromImage(bytes, filePath: name + ".dll"));
        }
        return refs;
    }

    // One JS-exported entry point. Compiles `code` as a regular top-level-statements
    // C# file (same grammar `dotnet run` accepts — bare statements, then optional
    // type declarations below them) and runs it. refsBaseUrl is the absolute URL of
    // this app's own refs/ folder (reference assemblies + manifest.json), computed
    // by the page so it stays correct regardless of hosting subpath or the current
    // #/route. Returns a small JSON envelope so the JS side never parses free-form text.
    [JSExport]
    internal static async Task<string> Run(string code, string refsBaseUrl)
    {
        var stdout = new StringBuilder();
        var originalOut = Console.Out;
        var originalErr = Console.Error;
        var writer = new StringWriter(stdout);

        try
        {
            var refs = await GetReferencesAsync(frameworkBaseUrl);
            var tree = CSharpSyntaxTree.ParseText(code, new CSharpParseOptions(LanguageVersion.Latest));
            // ConcurrentBuild spins up worker Tasks that block via Monitor.Wait for
            // parallel diagnostics (e.g. CLS-compliance checking) during Emit — real
            // OS thread blocking, unsupported on this single-threaded wasm build.
            var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, optimizationLevel: OptimizationLevel.Release)
                .WithPlatform(Platform.AnyCpu)
                .WithConcurrentBuild(false);
            var compilation = CSharpCompilation.Create("BookSnippet_" + Guid.NewGuid().ToString("N"), [ImplicitUsingsTree, tree], refs, options);

            using var peStream = new MemoryStream();
            var emit = compilation.Emit(peStream);
            if (!emit.Success)
            {
                var msg = string.Join("\n", emit.Diagnostics
                    .Where(d => d.Severity == DiagnosticSeverity.Error)
                    .Select(d => d.ToString()));
                return Envelope(ok: false, stdout: "", kind: "compile", message: msg);
            }

            Console.SetOut(writer);
            Console.SetError(writer);
            try
            {
                var asm = Assembly.Load(peStream.ToArray());
                var entry = asm.EntryPoint ?? throw new InvalidOperationException("No entry point was generated for this snippet.");
                var args = entry.GetParameters().Length > 0 ? new object?[] { Array.Empty<string>() } : null;
                var result = entry.Invoke(null, args);
                if (result is Task task) await task;
            }
            finally
            {
                Console.SetOut(originalOut);
                Console.SetError(originalErr);
            }

            return Envelope(ok: true, stdout: stdout.ToString(), kind: null, message: null);
        }
        catch (Exception ex)
        {
            // Unwrap the reflection-invoke wrapper so the user sees their own exception, not TargetInvocationException.
            var real = ex is TargetInvocationException { InnerException: { } inner } ? inner : ex;
            return Envelope(ok: false, stdout: stdout.ToString(), kind: "runtime", message: real.ToString());
        }
        finally
        {
            Console.SetOut(originalOut);
            Console.SetError(originalErr);
        }
    }

    static string Envelope(bool ok, string stdout, string? kind, string? message) =>
        JsonSerializer.Serialize(new { ok, stdout, kind, message });
}
