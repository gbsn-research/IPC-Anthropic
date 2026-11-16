# Privacy — Interoperable Provenance Contribution (IPC) Free Local Edition

The IPC Free Local plugin's MCP server runs locally on the user's machine (or in the local environment hosting the plugin). The server does **not** transmit data to GBSN Research or any third party. It has no telemetry, billing, remote API, network fetch, or background conversation watcher.

- **Stored only after the user requests recording:** event identifiers, issuer, acting agent, action, object, timestamp, explicit parent links, optional evidence origin, human-readable labels, optional data-subject identifiers and optional evidence-reference metadata.
- **Not automatically collected:** message history, full prompts, replies, uploaded documents, or external browsing content. If the user explicitly provides `payload_text`, the server computes and stores a SHA-256 digest and discards the input text. A supplied `summary` or `public_label` **is stored**.
- **Location:** `$IPC_HOME/records.jsonl`, default `~/.ipc-provenance/records.jsonl`. Files are created with restrictive OS permissions where supported. Export files are stored in `exports/` only when requested.
- **Sharing:** Only happens when the user manually sends an exported file. The plugin's offline viewer reads the selected file locally and makes no automatic outbound requests. Links to external research websites may be opened if the user clicks them.
- **Retention/deletion:** records remain on the local machine until the user deletes them; delete `$IPC_HOME` to remove that local copy. Copies exported or shared with others are not deleted automatically.
- **Claude processing:** Inputs and tool results appearing within Claude may be processed and stored by Anthropic according to the user's plan and Anthropic's policies. This plugin cannot control that processing; do not confuse the local MCP server's no-network behavior with an assurance about the AI platform itself.
- **Disclosure:** levels 0–4 are informational views, not authentication or authorization. Users should inspect files before sharing. Level 4 may reveal sensitive metadata and needs explicit confirmation.
- **Contact:** publications@GBSNResearch.com.

## Sensitive views and retention

Level 4 access is disabled unless `IPC_ALLOW_LEVEL4=1` is set before launching the host. Protect your local records and exports with device encryption and backups; a local file with no network access can still be accessed by malware or another user with the same account. Delete `~/.ipc-provenance` after closing IPC processes to remove locally stored records. The Claude provider may retain its own tool input/output history under its policies; IPC cannot erase that.
