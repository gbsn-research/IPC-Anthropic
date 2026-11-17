# Privacy: Interoperable Provenance Contribution (IPC)

IPC runs entirely on your computer.

- **Collected:** only the structured events you ask Claude to record: actor, action, item identifier, timestamps, optional parent references and labels you approve.
- **Not collected:** conversation text, Claude memory or chat history, uploaded files, analytics or telemetry. There are no hooks and no background capture.
- **Storage:** a local folder, `~/.ipc-provenance/` by default (or the folder in `IPC_HOME`). GBSN Research does not receive it.
- **Network:** none. The plugin makes no outbound connections and fetches no URLs.
- **Optional hashes:** if you supply `payload_text`, only its SHA-256 is stored. The text passes through Claude as a tool argument before being discarded, so do not include secrets.
- **Sharing:** only when you export a file and send it yourself. Exports can contain personal data such as names, timestamps and relationships. Choose the disclosure level deliberately. Disclosure levels are views, not access controls.
- **Retention and deletion:** records stay until you delete the folder.
- **Contact:** publications@GBSNResearch.com
