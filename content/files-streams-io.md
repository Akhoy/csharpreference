---
id: files-streams-io
title: "Files, Streams and Text: Moving Bytes Without Running Out of Memory"
summary: "Kettle's nightly supplier file is 2 GB of gzipped CSV, and reading it with File.ReadAllText crashed the server. Covers the Stream abstraction and how streams wrap each other, bytes vs text and encodings, File and Path helpers and which load everything into memory, reading large files line by line and asynchronously, compression, writing files so readers never see half a file, path traversal, and files in containers."
layer: runtime
where: C# language › Base library: files, streams and text
fits: "A companion to [async/await](ch:async-await): IO is the main reason async exists. Builds on spans and pooled buffers from [Advanced C#](ch:advanced-csharp), and on the encoding facts in [Everyday types](ch:everyday-types). Uploads and blob storage reappear in [Web security](ch:web-security) and [Azure data](ch:azure-data-messaging)."
levels: b,i,a
prereqs: async-await, exceptions-disposal
next: modern-csharp
---

## The 30-second version

- A **`Stream`** is a sequence of bytes you read or write in pieces: a file, memory, a network connection. Streams **wrap** each other: a decompressing stream around a file stream, a text reader around that.
- **Bytes aren't text.** Turning bytes into characters needs an **encoding**, almost always UTF-8.
- `File.ReadAllText`, `ReadAllLines` and `ReadAllBytes` load the **whole file** into memory. For big files, use `File.ReadLines` or a `StreamReader`, which read a piece at a time.
- Use the **async** methods for files and networks in servers, and pass a `CancellationToken`.
- Write files to a temporary name and **rename** them into place, so readers never see a half-written file.
- Never build a path from user input without checking it stays inside the folder you meant.

## Words you'll meet

| Word | In plain words |
|---|---|
| **stream** | Bytes you read or write a chunk at a time, without holding them all at once. |
| **buffer** | A chunk of memory used to carry bytes between a stream and your code. |
| **encoding** | The rule for turning characters into bytes and back: UTF-8, UTF-16. |
| **BOM** | Byte order mark: optional bytes at the start of a text file announcing its encoding. |
| **flush** | Push any bytes still held in a buffer out to the underlying file or connection. |
| **atomic** | Happens completely or not at all; nobody can observe it half done. |
| **path traversal** | Using `../` in a file name to escape the intended folder. |

:::note What you need first
- **[Async and Await: Don't Hold a Thread While You Wait](ch:async-await)**: `await` waits for a `Task` without blocking a thread, so one server thread can serve many requests while they wait on I/O.
- **[Exceptions and Cleanup: Failing Safely (try/catch, using, IDisposable)](ch:exceptions-disposal)**: exceptions jump to the nearest matching `catch`; `using` guarantees `Dispose` runs to release files and connections.
:::

## Previously at Kettle {b}

Kettle's async code serves Black Friday without starving threads. Then the supplier changes their nightly feed: one 2 GB gzipped CSV instead of many small files. The import, which did `File.ReadAllText`, takes the server down with an out-of-memory error. The same week, the warehouse picks up a stock export while Kettle is still writing it, and ships half the orders.

**The problem:** bytes have to move in pieces, as text in the right encoding, without anyone seeing a half-finished file.

**This episode:** streams, text and encodings, the file helpers, large files, compression, safe writes and safe paths.

## Start from zero: what a stream is {b}

:::plain
A stream is like a tap rather than a bucket. You don't get all the water at once; you take some, use it, and take some more. That way a 2 GB file never has to fit in memory.
:::

`File.ReadAllText` is the bucket: it reads the entire file into one string. For a 2 GB file, that's a 4 GB string (two bytes per character), and the process runs out of memory.

A **stream** is the tap. You ask it for, say, 80 KB at a time, process those bytes, then ask for more. Memory use stays at 80 KB however big the file is. Every source of bytes in .NET looks like the same `Stream` type, so the same code works for a file, a network response, a blob in Azure Storage, or a block of memory:

| Stream | Bytes come from or go to |
|---|---|
| `FileStream` | a file on disk |
| `MemoryStream` | an array in memory |
| `NetworkStream`, HTTP response streams | a network connection |
| `GZipStream`, `BrotliStream` | another stream, compressed or decompressed on the way through |
| `CryptoStream` | another stream, encrypted or decrypted on the way through |

The core members: `Read`/`ReadAsync` (fill a buffer, returning how many bytes arrived, 0 at the end), `Write`/`WriteAsync`, `Flush`, and, for streams that support it (`CanSeek`), `Position`, `Length` and `Seek`. Network and compression streams can't seek: you can only go forward.

## Streams wrap streams {b}

:::plain
You stack streams like pipes: the file goes into a decompressor, the decompressor into a text reader, and your code reads lines from the end of the pipe.
:::

Kettle's supplier file needs three steps: read bytes from disk, decompress them, and turn them into lines of text. Each step is a stream or reader wrapped around the previous one, which is the [Decorator pattern](ch:design-patterns):

```csharp norun
await using var file = File.OpenRead("/feeds/prices-2026-11-27.csv.gz");          // bytes from disk
await using var gzip = new GZipStream(file, CompressionMode.Decompress);          // decompressed bytes
using var reader = new StreamReader(gzip, Encoding.UTF8);                          // characters, line by line

string? line;
while ((line = await reader.ReadLineAsync(ct)) is not null)
    Import(line);                                                                  // one line in memory at a time
```

Disposing the outermost wrapper disposes the ones inside it by default. Pass `leaveOpen: true` when you need the inner stream afterwards, such as a `MemoryStream` you're about to read back.

:::walk Write text into memory, then read it back
```csharp
using System.Text;

using var memory = new MemoryStream();
using (var writer = new StreamWriter(memory, Encoding.UTF8, leaveOpen: true))
{
    writer.WriteLine("TEA-01,Sencha,6.50");
    writer.WriteLine("TEA-02,Assam,4.00");
    Console.WriteLine($"before dispose: {memory.Length} bytes in the stream");
}
Console.WriteLine($"after dispose: {memory.Length} bytes in the stream");

memory.Position = 0;
using var reader = new StreamReader(memory, Encoding.UTF8);
Console.WriteLine(reader.ReadLine());
Console.WriteLine(reader.ReadLine());
```
@3 | memory = MemoryStream (empty)
A stream whose bytes live in an array in memory, standing in for a file.
@4-7 | writer = StreamWriter wrapping memory
A `StreamWriter` turns lines of text into UTF-8 bytes and writes them into the stream it wraps. `leaveOpen: true` keeps `memory` usable after the writer is gone.
@8 | | > before dispose: 0 bytes in the stream
Nothing has reached the stream yet. The writer **buffers**, collecting text before writing it in one go.
@10 | | > after dispose: 40 bytes in the stream
Disposing the writer **flushes** its buffer into the stream. That's 40 bytes: two lines of 18 and 17 characters plus a newline each (37), and **3 bytes of BOM** at the start, because `Encoding.UTF8` announces itself with a byte order mark. A forgotten `using` would have lost all of it.
@12 | memory.Position = 0
Rewind, so reading starts at the first byte.
@13-15 | | > TEA-01,Sencha,6.50 | > TEA-02,Assam,4.00
A `StreamReader` wraps the same stream the other way: bytes back into lines of text.
:::

The same wrapping, with a compression stream in the middle, is how the supplier's file is read, and how Kettle compresses an export:

```csharp norun
await using var output = File.Create("/exports/orders.csv.gz");
await using var gzip = new GZipStream(output, CompressionLevel.Optimal);   // bytes are compressed on their way to disk
await using var writer = new StreamWriter(gzip, Encoding.UTF8);
await writer.WriteLineAsync("id,total");
```

## Bytes vs text: encodings {b}

:::plain
A file only holds bytes. To get text, you need to know which rule turned the characters into bytes. Today that rule is almost always UTF-8.
:::

| Encoding | Bytes per character | Notes |
|---|---|---|
| **UTF-8** | 1 for English letters, 2 for £ and é, 3 for most Asian scripts, 4 for emoji | the standard for files, HTTP and JSON |
| UTF-16 | 2, or 4 for emoji | how .NET strings are held in memory |
| ASCII, Latin-1, Windows-1252 | 1 | legacy files; characters outside their small range get lost or garbled |

:::walk How many bytes is a character?
```csharp
using System.Text;

foreach (var s in new[] { "A", "£", "🍵" })
    Console.WriteLine($"{s}: {s.Length} UTF-16 units, {Encoding.UTF8.GetByteCount(s)} UTF-8 bytes");
```
@3-4 | s = "A" | > A: 1 UTF-16 units, 1 UTF-8 bytes
A plain English letter is one unit either way.
@3-4 | s = "£" | > £: 1 UTF-16 units, 2 UTF-8 bytes
The pound sign takes two bytes in UTF-8. Reading a UTF-8 file as Windows-1252 shows those two bytes as `Â£`: the classic sign of a wrong encoding.
@3-4 | s = "🍵" | > 🍵: 2 UTF-16 units, 4 UTF-8 bytes
An emoji needs two UTF-16 units (a surrogate pair) and four UTF-8 bytes. Truncating a string or a byte array in the middle of one corrupts it.
:::

Rules:

- **Say the encoding** whenever you turn bytes into text and back: `new StreamReader(stream, Encoding.UTF8)`. .NET's file helpers default to UTF-8, which is right for almost everything you create.
- A **BOM** (`EF BB BF` at the start of a UTF-8 file) helps some programs, notably Excel, recognise UTF-8. `StreamReader` detects and skips it. `File.WriteAllText` writes UTF-8 **without** a BOM; pass `new UTF8Encoding(encoderShouldEmitUTF8Identifier: true)` if a consumer needs one.
- Legacy code pages such as Windows-1252 need `Encoding.RegisterProvider(CodePagesEncodingProvider.Instance)` on .NET Core and later.

## The File and Path helpers {b}

:::plain
`File` and `Directory` have one-line methods for common jobs. The ones with "All" in the name read or write the whole file at once: fine for small files, dangerous for big ones.
:::

| Job | Whole file in memory | A piece at a time |
|---|---|---|
| Read text | `File.ReadAllText`, `ReadAllLines` | `File.ReadLines` (lazy), `StreamReader` |
| Read bytes | `File.ReadAllBytes` | `File.OpenRead` + `ReadAsync` into a buffer |
| Write text | `File.WriteAllText`, `WriteAllLines` | `StreamWriter`, `File.AppendAllLinesAsync` |
| List files | `Directory.GetFiles` (array) | `Directory.EnumerateFiles` (lazy) |

`File.ReadLines` returns a lazy sequence, like a LINQ query ([LINQ](ch:linq)): each line is read when the `foreach` asks for it, so `File.ReadLines(path).Where(...).Take(10)` reads only as far as it needs.

**Paths.** Build them with `Path.Combine` or `Path.Join`, never with string concatenation and a hard-coded `\`, because Linux uses `/` and Kettle runs in Linux containers. Other useful members: `Path.GetFileName`, `GetExtension`, `GetFileNameWithoutExtension`, `GetTempPath` and `GetRandomFileName`.

## Async IO, buffers and cancellation {i}

On a server, waiting for a disk or network blocks a thread, which is the starvation problem from [async/await](ch:async-pitfalls#deadlocks-and-thread-pool-starvation). The async methods release the thread while the bytes are in flight:

```csharp norun
await using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
                                        bufferSize: 81_920, FileOptions.Asynchronous | FileOptions.SequentialScan);
byte[] buffer = ArrayPool<byte>.Shared.Rent(81_920);
try
{
    int read;
    while ((read = await source.ReadAsync(buffer.AsMemory(0, 81_920), ct)) > 0)
        await target.WriteAsync(buffer.AsMemory(0, read), ct);        // or simply: await source.CopyToAsync(target, ct)
}
finally { ArrayPool<byte>.Shared.Return(buffer); }
```

- `FileOptions.Asynchronous` makes the OS do the waiting, rather than a thread pool thread pretending to. `SequentialScan` tells the OS you'll read front to back, so it reads ahead.
- `ReadAsync` can return **fewer** bytes than you asked for, even when more are coming. Always use the returned count, and loop until it returns 0.
- Rent the buffer from the pool ([Advanced C#](ch:advanced-csharp-pool)) instead of allocating 80 KB per copy. `CopyToAsync` does all of this for you when you just need to move bytes.
- `StreamWriter` and `FileStream` **buffer** writes. If you don't dispose or flush them, the last bytes never reach the file. `await using` handles it.

For very high-throughput parsing of network data, **System.IO.Pipelines** manages pooled buffers and partial reads for you; it's what Kestrel is built on.

## Writing files safely {i}

:::plain
If you write straight into the final file, anyone reading it at the same moment sees half of it. Write to a temporary file, then rename it into place in one step.
:::

The warehouse's import job polls a folder for `stock.csv`. Kettle was writing that file in place, so the warehouse sometimes read it halfway through. Renaming a file within the same disk is **atomic**: other processes see either the old file or the new one, never a mixture.

```csharp norun
string final = Path.Combine(exportDir, "stock.csv");
string temp = Path.Combine(exportDir, $".stock.{Guid.NewGuid():N}.tmp");    // same folder, so the same disk

await using (var writer = new StreamWriter(temp, append: false, Encoding.UTF8))
{
    await writer.WriteLineAsync("sku,quantity");
    foreach (var s in stock) await writer.WriteLineAsync($"{s.Sku},{s.Quantity}");
}                                                                          // disposed: everything flushed to disk

File.Move(temp, final, overwrite: true);                                   // the swap is atomic
```

The temp file must be in the **same folder or at least on the same disk**: a move across disks is a copy, which isn't atomic. Readers should also ignore files whose names start with `.` or end in `.tmp`.

## Path traversal: user input in file names {a}

:::plain
If a user can choose a file name, they can try names like `../../secrets.json` to reach files outside the folder you meant. Resolve the full path and check it's still inside your folder.
:::

:::walk Catching ../ in a file name
```csharp
string root = Path.GetFullPath("/data/uploads/");
foreach (var name in new[] { "invoice-42.pdf", "../secrets/keys.json" })
{
    string full = Path.GetFullPath(Path.Combine(root, name));
    bool safe = full.StartsWith(root, StringComparison.Ordinal);
    Console.WriteLine($"{name} → {full} : {(safe ? "allowed" : "BLOCKED")}");
}
```
@1 | root = "/data/uploads/"
The folder downloads are allowed to come from, as a full path ending in a separator.
@4-6 | name = "invoice-42.pdf" ; full = "/data/uploads/invoice-42.pdf" ; safe = true | > invoice-42.pdf → /data/uploads/invoice-42.pdf : allowed
`Path.GetFullPath` resolves the combined path. It's still under the root.
@4-6 | name = "../secrets/keys.json" ; full = "/data/secrets/keys.json" ; safe = false | > ../secrets/keys.json → /data/secrets/keys.json : BLOCKED
The `..` climbs out of `uploads`. Only after resolving the full path can you see it has left the folder.
:::

Better still, never use the user's name as a path at all: store uploads under a generated name (a GUID) and keep the original name in a database column ([Web security](ch:web-security#secure-file-uploads)). Also note that `Path.Combine(root, "/etc/passwd")` returns `/etc/passwd`, because a rooted second argument replaces the first, which is one more reason to check the resolved result.

## Files in containers and the cloud {a}

Kettle runs in containers, where the local file system is **temporary**: anything written there disappears when the container is replaced, and each replica has its own copy ([Docker](ch:docker#configuration-secrets-and-storage-in-containers)).

- Use **Blob Storage** for anything that must persist or be shared: uploads, exports, the supplier feed. Its SDK reads and writes **streams**, so everything in this chapter applies: `await blob.DownloadToAsync(stream)`, or `OpenReadAsync` for streaming reads ([Azure data](ch:azure-data-messaging#storage-accounts-blob-queue-table-files)).
- Local disk is fine for **scratch** work within one request or job: `Path.GetTempPath()` plus a random name, deleted in `finally`.
- `FileSystemWatcher` raises events when files change, but it can miss or duplicate events under load and doesn't work on all network shares. Use it as a hint, combined with a periodic scan, or use Event Grid's blob-created events instead.

## Interview questions {i}

:::qa What's the difference between File.ReadAllLines and File.ReadLines?
`ReadAllLines` reads the whole file into a `string[]` before returning, so memory grows with the file. `ReadLines` returns a lazy `IEnumerable<string>` that reads one line as each is requested, so memory stays flat and a query can stop early. For large files, use `ReadLines` or a `StreamReader`, and the async versions on servers.
:::

:::qa How do streams compose, and why is that useful?
Many streams wrap another stream and transform the bytes passing through, such as compression, encryption or buffering, and text readers and writers wrap streams to convert bytes to characters. Stacking them, for example file → `GZipStream` → `StreamReader`, processes a large compressed file a piece at a time, with each layer unaware of the others. It's the Decorator pattern.
:::

:::qa Why must you always specify an encoding?
Files and network data are bytes, and the same bytes mean different text under different encodings, so a mismatch produces garbled text such as `Â£`. UTF-8 is the standard for files and HTTP, while .NET strings are UTF-16 in memory. Characters can take several bytes, so byte and character counts differ, and splitting in the middle of a character corrupts it.
:::

:::qa How do you write a file so that another process never reads it half-written?
Write to a temporary file in the same folder, dispose it so everything is flushed, then rename it over the final name with `File.Move(temp, final, overwrite: true)`. A rename on the same volume is atomic, so readers see either the complete old file or the complete new one. Readers should ignore temporary names.
:::

:::qa How do you prevent path traversal?
Don't use user input as a path: store files under generated names and keep the original name as data. If you must, resolve the combined path with `Path.GetFullPath` and check it still starts with the intended root folder, remembering that `Path.Combine` with a rooted second argument discards the first.
:::

## Next {b}

Kettle's imports now stream and its exports can't be read half-written. Back to the story: a 3 a.m. `NullReferenceException`, and 300 lines of boilerplate for simple data. [Episode 9 · Modern C# →](ch:modern-csharp)

## Further reading

- [File and stream I/O](https://learn.microsoft.com/en-us/dotnet/standard/io/)
- [Character encoding in .NET](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-encoding-introduction)
- [System.IO.Pipelines](https://learn.microsoft.com/en-us/dotnet/standard/io/pipelines)
- [Compression in .NET](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression)
