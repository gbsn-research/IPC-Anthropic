# IPC Free v0.3.0 — release sign-off

## Verified locally

- [x] Manifest, MCP wiring and skill files structurally checked by offline preflight.
- [x] All 6 MCP tools exercised by real stdio integration test.
- [x] Recording only on explicitly requested tool invocation; no automatic hooks or network I/O in server.
- [x] Redacted list/trace/export and hidden-object existence checks.
- [x] Level 4 default denied and optional consent/capability gates tested.
- [x] Malformed JSON-RPC and >256 KiB stream tested without process crash.
- [x] Private file permissions, symlink rejection, write locking and log integrity tested on Linux.
- [x] Offline viewer uses safe text nodes and a no-connect Content Security Policy.
- [x] Browser rendering, tabs, malicious imported HTML rendered as text, and reset checked in headless Chromium.
- [x] ZIP contains one plugin manifest, no package dependencies, no secrets and no nested ZIPs.

## Required before public directory submission

- [ ] Validate in current Claude Code with `claude plugin validate ./ipc-provenance --strict`.
- [ ] Install and exercise the ZIP within Claude Code, and test locally in Cowork if you target that surface.
- [ ] Confirm plugin components and tool experience in Claude web chat; local MCP tools will not work there.
- [ ] Independent review of the shipped `server.js`, UI and privacy/retention approach.
- [ ] Confirm the intended MIT software license and publisher rights.
- [ ] Publish the source under a dedicated path in the public GitHub repository.
- [ ] Publish a live HTTPS privacy-policy URL, support details and directory listing assets.
- [ ] Submit the **public repository URL** via Anthropic's official plugin submission route and address review comments.
- [ ] If supporting browser-only chat is a requirement, design and security-test a separate hosted, authenticated MCP service.

**No public directory approval, verified live host installation, or external penetration test is claimed.**
