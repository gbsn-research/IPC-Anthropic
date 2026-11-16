# Interoperable Provenance Contribution (IPC) — Free Local Plugin v0.3.0

IPC Free records user-requested contribution events, builds a chronological provenance timeline, and exports selective records you can share. It uses the event conventions described in the [IPC v2.3 research](https://zenodo.org/records/24281403). The accompanying viewer shows the same timeline, contribution map, and record data structure as the IPC explorer.

**Free, no account, no subscriptions.** The Node MCP server stores records only on the device where it runs, makes no network requests, and does not monitor Claude conversations. The Claude host itself may process tool inputs and results in its conversation; read [PRIVACY.md](PRIVACY.md).

## Install in Claude Code

You need Node.js **18 or newer** and an installed/signed-in Claude Code version supporting plugin ZIPs (see [Anthropic's docs](https://code.claude.com/docs/en/plugins/create)). From the directory containing the ZIP:

```sh
claude --plugin-dir ./IPC_Free_Local_Plugin_v0.3.0.zip
```

Or extract the ZIP, then:

```sh
claude plugin validate ./ipc-provenance
claude --plugin-dir ./ipc-provenance
```

The `--plugin-dir` install is session-scoped. To test the local server without Claude:

```sh
cd ipc-provenance
npm test
```

No `npm install` is needed. The package has **zero third-party dependencies**, and the plugin does not run shell hooks. Use `/ipc-provenance:ipc-record` or ask Claude to record a user-declared event; use `/ipc-provenance:ipc-share` or ask for a timeline/export. Depending on the host, `ipc_*` MCP tools will appear after the local server starts.

**Claude web chat:** Skills can load, but the local Node MCP server does not run in a browser chat. The recording/trace tools require Claude Code or a compatible local MCP host; a separately hosted remote connector is required for full web-chat functionality. This release does **not** provide a hosted service, OAuth, cloud storage, or paid organizational features.

## Try the workflow

1. Say: “Record that I wrote the research question for `report:v1`.”
2. Say: “Record that Claude proposed an outline for `report:v1`, referencing the first event.”
3. Say: “Show the IPC contribution timeline for `report:v1`.”
4. Say: “Export `report:v1` at Level 3 and save the IPC JSON locally.”
5. Open `IPC_Viewer.html` in your browser. Select **Open my IPC JSON** and choose the exported file.

The viewer opens a six-event synthetic example by default. Its three tabs are **Contribution timeline**, **Contribution map**, and **Event data**. Input data is rendered as text, not executable HTML.

## Tools and default privacy choices

| Tool | Role |
| --- | --- |
| `ipc_record_event` | Manually record an event with actor, issuer, action, object, source links and optional output selector. |
| `ipc_list_events` | List recorded items through a chosen disclosure view (default Level 2). |
| `ipc_trace_object` | Follow recorded dependencies for one item (default Level 3). |
| `ipc_render_timeline` | Display a readable chronological history (default Level 3). |
| `ipc_verify_chain` | Check the locally stored SHA-256 chain. |
| `ipc_export_records` | Export IPC JSON or preliminary PROV-JSON, optionally writing a local file. |

Disclosure views range from Level 0 (participation declaration) to Level 4 (all stored fields). Entries can set `min_view_level` so they appear only in suitably detailed views. These are **view filters, not user authorization**. Store sensitive fields with `min_view_level=4` and never put them in Level 3 `public_label` values.

Level 4 is **off by default**. If you deliberately want the MCP tools to expose full locally stored fields to Claude, start the host with the environment variable `IPC_ALLOW_LEVEL4=1` and explicitly request a Level 4 tool call, which also requires `confirm_sensitive_view=true` (or `confirm_sensitive_export=true` when exporting). Environment setup varies by OS and host. Treat that switch as a sensitive session-wide capability: it is not a replacement for identity-based authentication.

The plugin does not fetch external source URLs. An optional `payload_text` argument is hashed and discarded; recorded `summary`, `public_label`, source identifiers and other metadata persist in the local log. A hash chain detects some edits but does not prove a contributor's identity or the truth of a statement.

## Files and maintenance

- Storage: `~/.ipc-provenance/records.jsonl` (override with `IPC_HOME`).
- Exports: `~/.ipc-provenance/exports/`.
- Private 0700 directory and 0600 log/export permissions on Unix; Windows access depends on Windows ACLs.
- A local exclusive `.write.lock` prevents simultaneous writes. If a process crashes and leaves this lock, **first confirm no IPC server is still writing**, then remove it manually.
- To delete local data, close IPC hosts and delete the `~/.ipc-provenance` directory after backing up anything you want to retain.
- When upgrading from v0.2.x, existing records are kept. New IDs use random UUIDs; old event identifiers remain valid. Back up `records.jsonl` before upgrading.
- The data file has a 50 MB local limit; export and archive older records if you approach the limit.

See [INSTALL.md](INSTALL.md), [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Research and support

- GitHub: https://github.com/gbsn-research/IPC-Interoperable-Contribution-Provenance
- Hugging Face: https://huggingface.co/spaces/GBSNResearch/ipc-provenance-explorer
- Zenodo: https://zenodo.org/records/24281403
- Support: publications@GBSNResearch.com

This software uses the MIT license from v0.2.x. The research manuscript and commercial IPC service are separate artifacts. Review your licensing policy before publicly distributing source code.
