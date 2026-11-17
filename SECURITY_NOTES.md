# Security and trust boundary

- **Local only.** No network connections, no remote tokens, no billing or account linking. Anyone with access to your operating system account or to an exported file can read it.
- **No hooks, no automatic capture.** The plugin acts only when Claude calls one of its tools, and the skills tell Claude to do so only on your request.
- **Disclosure.** `min_view_level` filters tool output and exports. It is not an authorization boundary over local storage.
- **Integrity.** The hash chain is local tamper evidence. It is not a digital signature, identity check or proof of authorship.
- **Concurrency.** Writes take a local lock so two sessions cannot compute competing chain heads.
- **Known gaps.** No independent security review, no Windows file-permission test, no signed distribution, no external timestamping. Suitable for personal and controlled use, not for regulated evidence assurance.

Report security issues to publications@GBSNResearch.com.
