# Changelog

## 0.3.0 — Local install & security hardening

- Preserved six MCP tools and the local contribution timeline/map/evidence explorer.
- Applied disclosure filtering before lookup; restricted items cannot be discovered from lower-level trace/export queries.
- Default-denied Level 4 unless the local host explicitly sets `IPC_ALLOW_LEVEL4=1`; explicit confirmation needed for all Level 4 reads and exports.
- Added bounded JSON-RPC streaming, request/notification handling, private file checks, exclusive write lock, 50 MB log limit and collision-resistant event IDs.
- Strengthened offline viewer input limits and added Content Security Policy.
- Added automated security regression tests, offline manifest preflight, install guide, security notes and package scripts.

## 0.2.1 — Timeline wording improvements

- Adjusted presentation of IPC as a working contribution-traceability proposal and retained relevant evidence caveats.

## 0.2.0 — First visual output and privacy fixes

- Added timeline, disclosure filtering and offline HTML explorer.
