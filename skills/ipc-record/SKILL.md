---
name: ipc-record
description: Record user-declared contribution events (who or what did which action to which item, from which source) in the local IPC provenance log. Use only when the user explicitly asks to log, record or declare a contribution, source, handoff, correction or approval.
---

# Recording IPC events

Use `ipc_record_event` for one event or `ipc_record_events` for several (up to 20, all or nothing). Record only when the user explicitly asks. Never record on your own initiative, and never log message text.

## Where events come from

Base events only on what the user states in their request or explicitly confirms. Do not use memory or past conversations. If the user asks you to draft events from the current conversation, write a short numbered draft, let them correct it, and record only after they say yes.

## Before recording

1. Make sure you know the actor, the actor type (human, ai, software, service, organization), the action and the item affected. If one is missing, ask one short question. Do not guess.
2. Keep three roles separate. The **actor** performed the action. The **issuer** records the claim (default `local-user`). The **data subject** is the person an assertion is about.
3. Set `evidence_origin` when the item is a claim about a person or data: person-supplied, third-party, application-observed, application-inferred, or corrected.
4. For corrections use `supersedes` or `contests` and always set `target` to the earlier assertion. Never try to delete or overwrite earlier records.
5. Record handoffs as separate `sends` and `receives` events sharing a `handoff_id`.
6. List `parents` only for things the user says the event depended on. In a batch, refer to earlier events by their object identifier. If upstream history is unknown, leave it out; the trace will mark where history ends.
7. Pass `time` only if the user gave it. Otherwise the recording time is used and marked as such.
8. To tie evidence to a record without storing it, pass `payload_ref`, or `payload_text` of at least 40 characters (it is hashed and discarded). Do not copy prompts or documents into `summary`.
9. Use `min_view_level` 4 for anything sensitive and tell the user what it means.

## After recording

Tell the user the event ids and that records are self-declared and stored only on their machine.

## Do not

- Judge competence, authorship share, honesty or misconduct from records.
- Invent percentages such as "70% human".
- Present a record as verified. Records are declarations.
