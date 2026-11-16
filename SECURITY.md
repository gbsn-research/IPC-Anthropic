# Security design and responsible disclosure

## Architecture

IPC Free is a local, dependency-free Node.js stdio MCP server. It does not listen on TCP ports, start a browser server, fetch URLs, run shell hooks, or call a payment service. It stores only metadata explicitly provided by a tool caller; the host AI may still process the tool request and response in its own environment.

## Controls implemented in v0.3.0

- Input lengths, enumerated fields, ISO timestamps and identifier shapes checked before a record is written.
- Bounded stdio JSON-RPC input (256 KiB); oversized messages are rejected *before* a newline arrives. Malformed or notification messages do not crash the process or record events.
- Private storage directory, private files, symlink/hard-link checks where supported, maximum 50 MB log size, write lock, and append/flush.
- Unique random event IDs and a local SHA-256 chain checked before any append.
- Disclosure view filtering before trace and export queries, preventing existence of higher-restricted objects being exposed by lower-level queries.
- Level 4 details disabled unless a user deliberately starts the local host with `IPC_ALLOW_LEVEL4=1`; tool calls also need an explicit confirmation flag.
- Viewer displays imported strings with `textContent`, limits file/event sizes, and has a restrictive CSP disabling network connections and embedded objects.
- No third-party packages or installation hooks.

## Important boundaries

- The local hash chain is not a digital signature, independent timestamp, identity assurance, proof of completeness, or proof that a source is accurate.
- `min_view_level` is a display/export filter, **not** an authorization mechanism. An owner of the raw local log can read its contents. Host model tool-call permissions and disk encryption are external controls.
- Once `IPC_ALLOW_LEVEL4=1` is active, the host AI can request Level 4 data; the `confirm_sensitive_view` flag is tool-level intent, not a cryptographic proof of user consent. Use Level 4 only in a dedicated trusted session.
- The AI host can receive source labels that include malicious instructions. Skills tell it to treat recorded text strictly as untrusted data, but no prompt-injection defense can be guaranteed solely by instructions.
- Windows ACL behavior, malicious local administrators, compromised hosts, access through other software and provider-side data retention are outside this local server's control.
- A power loss or disk corruption can damage the log; back it up. A stale lock may need manual removal. The basic exclusive lock is not a distributed transaction system.
- This package has not undergone external penetration testing or a full independent security assessment.

## Report a vulnerability

Contact publications@GBSNResearch.com. Do not include sensitive user records or credentials in an initial report. Review `PRIVACY.md` before sharing any logs.
