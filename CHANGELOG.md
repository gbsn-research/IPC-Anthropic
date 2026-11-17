# Release history

## 0.2.1
- Removed the opt-in Claude Code Stop hook, the automatic-capture setting and its tools, so the plugin never reads assistant responses. Recording is always user-initiated.
- Added `ipc_record_events` to record several approved events at once, all or nothing.
- `payload_text` now requires at least 40 characters, because short text can be guessed from its hash.
- Added `ipcctl.js demo` to create a synthetic sample log for trying the plugin.

## 0.2.0
- Disclosure filtering applied before listing, tracing, counting and export; inter-process log lock; adversarial regression tests.
