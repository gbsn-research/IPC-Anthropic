---
name: ipc-share
description: Trace the locally declared history of an item, inspect a disclosure-limited event list, check log integrity, or create a shareable IPC provenance JSON export when the user asks.
---

# Tracing and sharing local IPC metadata

Use `ipc_list_events`, `ipc_trace_object`, `ipc_verify_chain`, `ipc_export_records`. These are local tools and do not upload data.

Disclosure levels are 0 aggregate declaration, 1 actor roles, 2 contribution map, 3 timeline, and 4 full record. **Default to level 2 for external sharing** unless the user chooses another level. Events above their `min_view_level` are excluded from the current view, including related references and status updates. Don't disclose or infer details of hidden events. Below level 4, a trace is not a complete-history guarantee.

Ask for the scope/item when required. If user asks to share metadata, call `ipc_export_records` with `save: true`, default `format: "ipc-json"` and level 2, then give the local path for the user to send. Be explicit that the recipient gets a self-declared metadata record, not the original document, a verified signature, or independently checked sources.

Only use PROV-JSON if requested; it is an unvalidated experimental mapping. `ipc_verify_chain` only examines the local full log and is not a signature. Never claim independent verification, competence, authorship percentage, truth, or full history.
