# Interoperable Provenance Contribution (IPC)

IPC is a free, local-first plugin for recording **who or what contributed what** to a piece of work, and for sharing that history with someone else in a controlled way. It needs no account, no subscription and no server. Everything is stored on your own computer.

## What it is about

Finished work hides its history. A report, an essay or a customer profile can combine a person's ideas, AI-generated wording, software calculations, third-party data and later human corrections, and the final file does not show which was which. A label like "AI used" is too blunt to be useful.

IPC gives that history a shared structure so it can be inspected and exchanged instead of reconstructed from memory. Each event says who acted, who recorded the claim, what was affected, what it depended on, where the information came from (supplied by a person, third party, observed, inferred or corrected), and when. The structure is a candidate application profile based on the W3C PROV model, from a GBSN Research research proposal that has not been peer reviewed. It is not a W3C standard, and this plugin makes no claim of conformance or cross-vendor interoperability.

## How we intend to work

- **You decide what is recorded.** Nothing is logged unless you ask. The plugin does not watch your conversations, does not read Claude's memory or chat history, and never stores message text.
- **Describe, don't judge.** Records show what was declared. They do not measure skill, authorship share, effort or honesty, and should not be the only basis for adverse decisions about students, workers or data subjects.
- **Keep roles apart.** The actor, the issuer recording the claim, and the person an assertion is about are separate fields.
- **Corrections add, never erase.** A correction supersedes or contests an earlier assertion and the earlier record stays. When upstream history is unknown, a trace says it ends there.
- **Share only what you choose.** Five disclosure levels let you share a declaration, the actors, a contribution map, a timeline or full records.
- **Local first.** No network access, no analytics, no dependencies.

## Try it

Requires Node.js 18 or newer and a Claude app that loads local plugin servers (for example Claude Code). From a terminal:

```sh
claude --plugin-dir /full/path/to/ipc-provenance
```

Example prompts:

1. "Record that I wrote the thesis for my essay myself, then that an AI assistant proposed an outline from it, then that I revised paragraph 3. Show me the events first."
2. "Trace the history of essay:draft-1 and tell me where the recorded history ends."
3. "Export my records for essay:draft-1 at level 2 and save the file so I can send it to my instructor."

To explore with synthetic sample data (a student essay, a contested profile inference, an enterprise report) without touching your own log:

```sh
node ipcctl.js demo ~/ipc-demo
IPC_HOME=~/ipc-demo claude --plugin-dir /full/path/to/ipc-provenance
```

## What it runs and what each tool does

The plugin starts one local Node.js program, `server.js`, through `.mcp.json`. It also includes an optional command line, `ipcctl.js`, that you run yourself. There are no hooks, no background processes and no network calls.

| Tool | Purpose | Changes data |
| --- | --- | --- |
| `ipc_record_event` | Append one event you asked to record | Appends to the local log |
| `ipc_record_events` | Append up to 20 events you approved, all or nothing | Appends to the local log |
| `ipc_list_events` | List events visible at a disclosure level | No |
| `ipc_trace_object` | Follow one item's history upstream | No |
| `ipc_verify_chain` | Recompute the hash chain and report problems | No |
| `ipc_export_records` | Export IPC JSON or experimental PROV-JSON; optional local file | Writes a file only if you ask |

## Disclosure levels

| Level | Shared information |
| --- | --- |
| 0 | A declaration that AI or automated systems took part, about disclosed events only |
| 1 | Actors and roles |
| 2 | Contribution map: item, action, actor type, origin |
| 3 | Timeline of events, with permitted links only |
| 4 | Full records, including hashes, summaries and data subjects |

Give each event a `min_view_level` (0 to 4): the lowest level at which you are willing to show it. The default is 1. Hidden events are excluded before listing, tracing, counting and exporting, and hidden identifiers do not appear in lower-level views. Levels filter what you show. They are not encryption or access control, and anyone who can read your local log can read everything in it. Identifiers you mark visible can themselves reveal sensitive facts, so use neutral identifiers and `min_view_level: 4` for sensitive events.

## Files and limits

- Data lives in `~/.ipc-provenance/` (override with the `IPC_HOME` environment variable): `records.jsonl` and an `exports/` folder. Files are created readable only by you where the operating system supports it.
- Delete that folder to erase everything. A file you already sent cannot be recalled.
- If you give `payload_text` (at least 40 characters, such as a document), only its SHA-256 is stored, but the text still passes through Claude as a tool argument, so do not send secrets. Short text can be guessed from its hash, so use `payload_ref` for that.
- Records are self-declared. The hash chain detects casual edits only; anyone who can rewrite the whole file can rebuild it. It is not a signature and does not prove authenticity, completeness or truth.
- The PROV-JSON export is an experimental mapping that has not been validated against any conformance suite.

Run `node test/smoke.js` to check your copy. It uses a temporary folder and never touches your real log.

## Support, privacy, license

Support and security reports: publications@GBSNResearch.com. See `PRIVACY.md` and `SECURITY_NOTES.md`. Released under the MIT License.
