# IPC Free — Claude public-directory submission notes

**Plugin:** Interoperable Provenance Contribution (IPC) — Free Local Edition

**Short description:** Record human, AI and software contributions to your work, inspect a clear timeline and share selectively disclosed provenance records. Free, local-first and opt-in.

**Publisher:** GBSN Research
**Support:** publications@GBSNResearch.com
**Homepage / public research code:** https://github.com/gbsn-research/IPC-Interoperable-Contribution-Provenance
**Demonstration:** https://huggingface.co/spaces/GBSNResearch/ipc-provenance-explorer
**Archived research:** https://zenodo.org/records/24281403
**Software license currently bundled:** MIT (confirm publisher consent before releasing)

## Submission route

Anthropic's official directory accepts submissions from individual developers through Console, or from eligible Claude Team/Enterprise org accounts through claude.ai. The directory requires a **public GitHub source repository** and validation/review. This repository link identifies the existing research project; add the plugin under a permanent public folder and use the resulting path in the submission.

- Individual/Console: https://platform.claude.com/plugins/submit
- Organization: https://claude.ai/admin-settings/directory/submissions/plugins/new
- Official requirements: https://claude.com/docs/plugins/submit

## Compatibility note for reviewers

Local Node stdio tools work in Claude Code and compatible local plugin runtimes, not in web-only Claude Chat. Skills remain readable on other surfaces. Do not describe this as automatic capture or universal conversation tracking. If a listing requires all functionality in browser chat, host a separate authenticated remote MCP server and re-review its security first.

## Outstanding publisher-provided assets

- Public HTTPS privacy policy and optional terms, reviewed for your actual distribution.
- Directory icon and screenshots meeting the portal's image rules.
- Actual published GitHub plugin source path and publisher verification.
- Real-host install + `claude plugin validate --strict` output.
- Reviewer feedback and approval.

These cannot be produced or certified locally without your host installation, hosting/domain, and developer account.
