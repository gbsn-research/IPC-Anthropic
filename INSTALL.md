# IPC Free v0.3.0 — installation and verification

## Fastest local installation

1. Install Node.js 18+ and Claude Code; log into Claude Code.
2. Download the `IPC_Free_Local_Plugin_v0.3.0.zip` release.
3. Run `claude --plugin-dir ./IPC_Free_Local_Plugin_v0.3.0.zip` from its directory.
4. Run `/ipc-provenance:ipc-record` and explicitly request a contribution record.
5. Run `/ipc-provenance:ipc-share` to inspect and export the timeline.

The same plugin ZIP can be uploaded as a custom Claude plugin via the Customize/Plugins interface. Its skills may be available in browser chat, but its **local MCP server and recording tools will not execute there**. For full functionality, use Claude Code or a supported local MCP runtime.

## Verify before distributing

```sh
unzip IPC_Free_Local_Plugin_v0.3.0.zip
cd ipc-provenance
npm test
claude plugin validate . --strict
```

The `claude plugin validate` step requires your real Claude Code installation and a sufficiently current CLI. It **cannot** be run in the build environment used for this package. It is mandatory for your release sign-off.

## Your first real test in Claude

Record two events for a harmless synthetic document, generate a Level 3 timeline, export a Level 2 JSON file, and open it in `IPC_Viewer.html`. Check that the timeline shows actor, issuer, action, time and upstream relationships without disclosing Level 4-only event identifiers. Explicitly test that no automatic capture occurs when no record is requested.

## Compatibility and release constraints

- Node.js must exist on the machine actually executing the MCP server.
- Local stdio is supported by Claude Code and appropriate local hosts. Browser-only Claude cannot execute it.
- Public directory submission uses a **public GitHub repository** and review. The release ZIP is a testable artifact, not proof of review or approval.
- For a listing, publish a public privacy-policy URL and complete publisher/profile metadata and visual assets. Do not enter placeholder domains.
- No account linking, OAuth, hosted server, automatic capture, or billing is provided by this free package.
