#!/usr/bin/env node
'use strict';
/*
 * IPC Provenance: local MCP server (stdio), no dependencies, no network access.
 *
 * Stores user-declared contribution events as an append-only, hash-chained
 * JSON Lines file on the user's own machine:
 *   $IPC_HOME/records.jsonl   (default: ~/.ipc-provenance/records.jsonl)
 *
 * It never stores message text. It never contacts any remote service.
 * Records are SELF-DECLARED. The hash chain is local tamper-evidence only,
 * not proof of authenticity, completeness or truth.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const SERVER_INFO = { name: 'ipc-provenance', version: '0.2.1' };
const IPC_VERSION = '0.1-draft';
const HOME = process.env.IPC_HOME || path.join(os.homedir(), '.ipc-provenance');
const FILE = path.join(HOME, 'records.jsonl');
const EXPORT_DIR = path.join(HOME, 'exports');
const LOCK_FILE = path.join(HOME, 'records.lock');
const ZERO_HASH = '0'.repeat(64);
const MAX_INLINE_CHARS = 50000;

const ACTIONS = [
  'proposes', 'generates', 'revises', 'retrieves', 'uses_source',
  'contributes_to', 'infers', 'checks', 'contests', 'supersedes',
  'sends', 'receives', 'reviews', 'approves', 'executes'
];
// Actions whose object is a thing the activity produced (PROV: wasGeneratedBy).
const GENERATING = ['proposes', 'generates', 'revises', 'infers', 'contributes_to', 'supersedes'];
const ORIGINS = ['person-supplied', 'third-party', 'application-observed', 'application-inferred', 'corrected'];
const ACTOR_TYPES = ['human', 'ai', 'software', 'service', 'organization'];

/* ---------- small utilities ---------- */

function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function hashRecord(rec) {
  const rest = Object.assign({}, rec);
  delete rest.hash;
  return sha256(canonical(rest));
}
function nowIso() { return new Date().toISOString(); }
function pad2(n) { return String(n).padStart(2, '0'); }

/* ---------- storage ---------- */

function readRecords() {
  if (!fs.existsSync(FILE)) return [];
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(l => l.trim());
  return lines.map((l, i) => {
    try { return JSON.parse(l); } catch (e) {
      throw new Error('records.jsonl line ' + (i + 1) + ' is not valid JSON. Run ipc_verify_chain for details.');
    }
  });
}
function withLogLock(fn) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  // Inter-process lock so two processes (e.g. two Claude sessions) cannot compute competing chain heads.
  for (let n = 0; n < 100; n++) {
    let fd;
    try {
      fd = fs.openSync(LOCK_FILE, 'wx', 0o600);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Reclaim a dead process lock only after a conservative timeout.
      try { if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 30000) fs.unlinkSync(LOCK_FILE); } catch (_) {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      continue;
    }
    try { return fn(); }
    finally {
      fs.closeSync(fd);
      try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
    }
  }
  throw new Error('Local IPC log is busy; retry the operation.');
}
function appendRecord(rec) {
  fs.appendFileSync(FILE, JSON.stringify(rec) + '\n', { mode: 0o600, flag: 'a' });
}
/* ---------- validation and record construction ---------- */

const CONTROL = /[\u0000-\u001f\u007f]/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function buildRecord(a, records) {
  const errs = [];
  const str = (name, v, opts) => {
    opts = opts || {};
    const max = opts.max || 200;
    if (v === undefined || v === null || v === '') {
      if (opts.required) errs.push(name + ' is required');
      return undefined;
    }
    if (typeof v !== 'string') { errs.push(name + ' must be a string'); return undefined; }
    if (v.length > max) { errs.push(name + ' must be at most ' + max + ' characters'); return undefined; }
    if (CONTROL.test(v)) { errs.push(name + ' must not contain control characters'); return undefined; }
    if (opts.noSpace && /\s/.test(v)) { errs.push(name + ' must not contain whitespace'); return undefined; }
    if (opts.pattern && !opts.pattern.test(v)) { errs.push(name + ' has an invalid format'); return undefined; }
    return v;
  };
  const oneOf = (name, v, list, required) => {
    if (v === undefined || v === null || v === '') {
      if (required) errs.push(name + ' is required (one of: ' + list.join(', ') + ')');
      return undefined;
    }
    if (!list.includes(v)) { errs.push(name + ' must be one of: ' + list.join(', ')); return undefined; }
    return v;
  };

  const issuer = str('issuer', a.issuer || 'local-user', { max: 64, pattern: /^[A-Za-z0-9._-]+$/ });
  const actorId = str('actor_id', a.actor_id, { required: true, noSpace: true });
  const actorType = oneOf('actor_type', a.actor_type, ACTOR_TYPES, true);
  const actorName = str('actor_name', a.actor_name, { max: 100 });
  const action = oneOf('action', a.action, ACTIONS, true);
  const object = str('object', a.object, { required: true, noSpace: true });
  const selector = str('selector', a.selector, { max: 200 });
  const target = str('target', a.target, { noSpace: true });
  const context = str('context', a.context, { noSpace: true });
  const handoffId = str('handoff_id', a.handoff_id, { noSpace: true });
  const origin = oneOf('evidence_origin', a.evidence_origin, ORIGINS, false);
  const payloadRef = str('payload_ref', a.payload_ref, { noSpace: true });
  const summary = str('summary', a.summary, { max: 280 });
  const uncertainty = str('uncertainty', a.uncertainty, { max: 100 });
  const policyRef = str('policy_ref', a.policy_ref, { noSpace: true });
  const dataSubject = str('data_subject', a.data_subject, { noSpace: true });

  let parents = [];
  if (a.parents !== undefined) {
    if (!Array.isArray(a.parents) || a.parents.length > 50) {
      errs.push('parents must be an array of at most 50 identifiers');
    } else {
      parents = a.parents.map((p, i) => str('parents[' + i + ']', p, { required: true, noSpace: true })).filter(Boolean);
    }
  }

  let minView = 1;
  if (a.min_view_level !== undefined) {
    if (!Number.isInteger(a.min_view_level) || a.min_view_level < 0 || a.min_view_level > 4) {
      errs.push('min_view_level must be an integer from 0 to 4');
    } else { minView = a.min_view_level; }
  }

  if ((action === 'contests' || action === 'supersedes') && !target) {
    errs.push('target is required when action is ' + action + ' (the scoped assertion being challenged or replaced)');
  }

  let payloadSha;
  if (a.payload_text !== undefined && a.payload_sha256 !== undefined) {
    errs.push('give payload_text or payload_sha256, not both');
  } else if (a.payload_text !== undefined) {
    if (typeof a.payload_text !== 'string' || a.payload_text.length < 40 || a.payload_text.length > 200000) {
      errs.push('payload_text must be 40 to 200000 characters (short text can be guessed from its hash; use payload_ref instead)');
    } else { payloadSha = sha256(a.payload_text); } // text is hashed and discarded
  } else if (a.payload_sha256 !== undefined) {
    if (typeof a.payload_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.payload_sha256)) {
      errs.push('payload_sha256 must be 64 lowercase hex characters');
    } else { payloadSha = a.payload_sha256; }
  }

  const recordedAt = nowIso();
  let time = recordedAt;
  let timeBasis = 'recorded';
  if (a.time !== undefined) {
    if (typeof a.time !== 'string' || !ISO.test(a.time) || Number.isNaN(Date.parse(a.time))) {
      errs.push('time must be ISO 8601 with a timezone, e.g. 2026-11-16T10:15:00Z');
    } else if (Date.parse(a.time) > Date.now() + 5 * 60 * 1000) {
      errs.push('time is in the future');
    } else { time = a.time; timeBasis = 'asserted'; }
  }

  if (errs.length) throw new Error('Could not record event:\n- ' + errs.join('\n- '));

  const n = records.filter(r => r.issuer === issuer).length + 1;
  const prev = records.length ? records[records.length - 1].hash : ZERO_HASH;
  const rec = {
    ipc_version: IPC_VERSION,
    id: 'urn:ipc:' + issuer + ':E' + pad2(n),
    issuer,
    actor: { id: actorId, type: actorType, name: actorName },
    action, object, selector, target, context,
    time, time_basis: timeBasis, recorded_at: recordedAt,
    parents, handoff_id: handoffId,
    evidence_origin: origin, payload_ref: payloadRef, payload_sha256: payloadSha,
    summary, uncertainty, policy_ref: policyRef, data_subject: dataSubject,
    min_view_level: minView,
    prev_hash: prev
  };
  Object.keys(rec).forEach(k => { if (rec[k] === undefined) delete rec[k]; });
  if (rec.actor.name === undefined) delete rec.actor.name;
  rec.hash = hashRecord(rec);
  return rec;
}

/* ---------- views (disclosure levels 0-4) ---------- */

// Disclosure views use a strict allowlist; unapproved event IDs, links and statuses
// never enter a lower-level response. Event counts are disclosure-scoped.
function disclosed(records, level) {
  return records.filter(e => (e.min_view_level === undefined ? 1 : e.min_view_level) <= level);
}
function projectEvent(rec, level, visibleEvents) {
  if (level >= 4) return rec;
  const visibleIds = new Set(visibleEvents.map(e => e.id));
  const visibleObjects = new Set(visibleEvents.map(e => e.object));
  const targetAllowed = rec.target && (visibleIds.has(rec.target) || visibleObjects.has(rec.target));
  if (level === 3) {
    // A timeline, not a copy of all stored fields: identifiers linking to undisclosed
    // events, personal data, summaries, evidence pointers and hashes are withheld.
    const out = {
      ipc_version: rec.ipc_version, id: rec.id, issuer: rec.issuer,
      actor: { id: rec.actor.id, type: rec.actor.type },
      action: rec.action, object: rec.object,
      time: rec.time, time_basis: rec.time_basis, recorded_at: rec.recorded_at
    };
    if (targetAllowed) out.target = rec.target;
    const parents = (rec.parents || []).filter(p => visibleIds.has(p) || visibleObjects.has(p));
    if (parents.length) out.parents = parents;
    if (rec.evidence_origin) out.evidence_origin = rec.evidence_origin;
    return out;
  }
  const out = { object: rec.object, action: rec.action, actor_type: rec.actor.type };
  if (rec.selector) out.selector = rec.selector;
  if (targetAllowed) out.target = rec.target;
  if (rec.evidence_origin) out.evidence_origin = rec.evidence_origin;
  return out;
}
function buildView(events, level) {
  const visible = disclosed(events, level);
  const notice = 'Disclosure-scoped view of self-declared events; additional history may be withheld.';
  if (level === 0) {
    const types = Array.from(new Set(visible.map(e => e.actor.type))).sort();
    return {
      level: 0,
      declaration: {
        ai_participated_in_disclosed_events: types.includes('ai'),
        automated_systems_participated_in_disclosed_events: types.some(t => ['ai','software','service'].includes(t)),
        actor_types_in_disclosed_events: types,
        disclosed_event_count: visible.length
      },
      note: notice + ' This is not a statement about total authorship share or quality.'
    };
  }
  if (level === 1) {
    const actors = new Map();
    visible.forEach(e => {
      const key = e.actor.id;
      if (!actors.has(key)) actors.set(key, { id: e.actor.id, type: e.actor.type, roles: new Set() });
      actors.get(key).roles.add(e.action);
    });
    return { level: 1,
      actors: Array.from(actors.values()).map(a => ({ id: a.id, type: a.type, roles: Array.from(a.roles).sort() })),
      note: notice };
  }
  return { level, events: visible.map(e => projectEvent(e, level, visible)), note: level < 4 ? notice : 'Full self-declared records.' };
}

/* ---------- trace ---------- */

function resolveParent(p, records, byId) {
  if (byId.has(p)) return [byId.get(p)];
  return records.filter(r => r.object === p);
}

function traceObject(records, objectId, maxDepth) {
  const byId = new Map(records.map(r => [r.id, r]));
  const seeds = records.filter(r => r.object === objectId || r.id === objectId);
  const seen = new Set();
  const found = [];
  const unresolved = new Set();
  let frontier = seeds.map(s => ({ rec: s, depth: 0 }));
  let truncated = false;
  while (frontier.length) {
    const next = [];
    for (const { rec, depth } of frontier) {
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      found.push(rec);
      for (const p of rec.parents || []) {
        const res = resolveParent(p, records, byId);
        if (!res.length) { unresolved.add(p); continue; }
        if (depth + 1 > maxDepth) { truncated = true; continue; }
        res.forEach(r => next.push({ rec: r, depth: depth + 1 }));
      }
    }
    frontier = next;
  }
  const order = new Map(records.map((r, i) => [r.id, i]));
  found.sort((a, b) => (Date.parse(a.time) - Date.parse(b.time)) || (order.get(a.id) - order.get(b.id)));

  const status = [];
  records.forEach(r => {
    if (r.target === objectId && (r.action === 'supersedes' || r.action === 'contests')) {
      status.push({ by_event: r.id, action: r.action, new_object: r.object });
    }
  });
  return { found, seedCount: seeds.length, unresolved: Array.from(unresolved), status, truncated };
}

/* ---------- export ---------- */

function q(id) { return 'ipc:' + encodeURIComponent(id); }

function toProvJson(events) {
  const byId = new Map(events.map(e => [e.id, e]));
  const doc = {
    prefix: { prov: 'http://www.w3.org/ns/prov#', ipc: 'urn:ipc:ns:' },
    entity: {}, activity: {}, agent: {},
    wasGeneratedBy: {}, used: {}, wasAssociatedWith: {}, wasInformedBy: {}, wasDerivedFrom: {},
    'ipc:notice': 'EXPERIMENTAL mapping of self-declared records. Not validated against PROV constraints or any conformance suite.'
  };
  let k = 0;
  const rel = () => '_:r' + (++k);
  events.forEach(e => {
    const act = {
      'prov:startedAtTime': e.time,
      'ipc:action': e.action,
      'ipc:issuer': e.issuer,
      'ipc:recordedAt': e.recorded_at,
      'ipc:timeBasis': e.time_basis
    };
    if (e.context) act['ipc:context'] = e.context;
    if (e.evidence_origin) act['ipc:evidenceOrigin'] = e.evidence_origin;
    if (e.handoff_id) act['ipc:handoffId'] = e.handoff_id;
    const unresolved = (e.parents || []).filter(p => !byId.has(p));
    if (unresolved.length) act['ipc:unresolvedParents'] = unresolved.join(' ');
    doc.activity[q(e.id)] = act;

    const provAgentType = e.actor.type === 'human' ? 'prov:Person'
      : e.actor.type === 'organization' ? 'prov:Organization' : 'prov:SoftwareAgent';
    doc.agent[q(e.actor.id)] = { 'prov:type': provAgentType, 'ipc:actorType': e.actor.type };
    doc.wasAssociatedWith[rel()] = { 'prov:activity': q(e.id), 'prov:agent': q(e.actor.id) };

    const ent = doc.entity[q(e.object)] || {};
    if (e.selector) ent['ipc:selector'] = e.selector;
    doc.entity[q(e.object)] = ent;
    if (GENERATING.includes(e.action)) {
      doc.wasGeneratedBy[rel()] = { 'prov:entity': q(e.object), 'prov:activity': q(e.id) };
    } else {
      doc.used[rel()] = { 'prov:activity': q(e.id), 'prov:entity': q(e.object) };
    }
    if (e.action === 'supersedes' && e.target) {
      doc.entity[q(e.target)] = doc.entity[q(e.target)] || {};
      doc.wasDerivedFrom[rel()] = { 'prov:generatedEntity': q(e.object), 'prov:usedEntity': q(e.target), 'prov:type': 'prov:Revision' };
    }
    (e.parents || []).forEach(p => {
      if (byId.has(p)) doc.wasInformedBy[rel()] = { 'prov:informed': q(e.id), 'prov:informant': q(p) };
    });
  });
  Object.keys(doc).forEach(key => {
    if (doc[key] && typeof doc[key] === 'object' && !Object.keys(doc[key]).length && key !== 'prefix') delete doc[key];
  });
  return doc;
}

/* ---------- tool implementations ---------- */

function text(obj) { return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] }; }

function toolRecord(args) {
  return withLogLock(() => {
    const records = readRecords();
    const rec = buildRecord(args || {}, records);
    appendRecord(rec);
    const missing = (rec.parents || []).filter(p => !records.some(r => r.id === p || r.object === p));
    return text({ recorded: rec.id, object: rec.object,
      time: rec.time, time_basis: rec.time_basis,
      note: 'Self-declared event stored locally. Message text was not stored.',
      unresolved_parents: missing });
  });
}
function toolRecordBatch(args) {
  const items = args && args.events;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new Error('events must be an array of 1 to 20 event objects');
  }
  return withLogLock(() => {
    const records = readRecords();
    const working = records.slice();
    const built = [];
    const problems = [];
    items.forEach((a, i) => {
      try {
        const rec = buildRecord(a || {}, working);
        working.push(rec);
        built.push(rec);
      } catch (e) { problems.push('events[' + i + ']: ' + e.message.replace(/^Could not record event:\n/, '')); }
    });
    if (problems.length) throw new Error('No events were recorded. Fix and resend all:\n' + problems.join('\n'));
    fs.appendFileSync(FILE, built.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600, flag: 'a' });
    return text({
      recorded: built.map(r => ({ id: r.id, object: r.object, action: r.action,
        unresolved_parents: (r.parents || []).filter(p => !working.some(w => w.id === p || w.object === p)) })),
      note: 'Self-declared events stored locally as one batch. Message text was not stored.'
    });
  });
}
function toolList(args) {
  args = args || {};
  const level = args.level === undefined ? 2 : args.level;
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('level must be an integer from 0 to 4');
  const limit = args.limit === undefined ? 20 : args.limit;
  const offset = args.offset === undefined ? 0 : args.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1 to 100');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer');
  const visible = disclosed(readRecords(), level);
  const page = visible.slice(offset, offset + limit);
  // No total count of hidden records and no names/IDs of hidden records.
  return text({ level, total_disclosed: visible.length, offset, returned: page.length,
    view: buildView(page, level), note: 'Pagination and totals reflect only events visible at the selected level.' });
}
function toolTrace(args) {
  args = args || {};
  if (typeof args.object !== 'string' || !args.object || args.object.length > 200) throw new Error('object must be a nonempty identifier of at most 200 characters');
  const level = args.level === undefined ? 2 : args.level;
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('level must be an integer from 0 to 4');
  const maxDepth = args.max_depth === undefined ? 10 : args.max_depth;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 50) throw new Error('max_depth must be 1 to 50');
  // Trace ONLY disclosed records. Hidden seeds, upstream refs and later corrections
  // must not leak via status, counts, object IDs or error messages.
  const records = disclosed(readRecords(), level);
  const t = traceObject(records, args.object, maxDepth);
  if (!t.seedCount) throw new Error('No records available at this disclosure level for the requested item.');
  const full = level === 4;
  return text({
    object: args.object,
    view: buildView(t.found, level),
    later_status_events: level < 2 ? [] : (level === 2
      ? t.status.map(e => ({ action: e.action, new_object: e.new_object }))
      : t.status),
    history_complete: full ? t.unresolved.length === 0 && !t.truncated : null,
    unresolved_upstream: full ? t.unresolved : [],
    note: full
      ? (t.unresolved.length || t.truncated
        ? 'Recorded history ends at the listed upstream references (or depth limit). Earlier history is unknown.'
        : 'All referenced upstream events are in this log. This does not prove nothing else happened.')
      : 'Disclosure-limited trace: completeness cannot be assessed at this level; hidden and external references are not exposed.'
  });
}

function toolVerify() {
  if (!fs.existsSync(FILE)) return text({ ok: true, events: 0, note: 'No log yet.' });
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(l => l.trim());
  let prev = ZERO_HASH;
  const problems = [];
  const ids = new Set();
  lines.forEach((l, i) => {
    let r;
    try { r = JSON.parse(l); } catch (e) { problems.push('line ' + (i + 1) + ': invalid JSON'); return; }
    if (ids.has(r.id)) problems.push('line ' + (i + 1) + ': duplicate id ' + r.id);
    ids.add(r.id);
    if (r.prev_hash !== prev) problems.push('line ' + (i + 1) + ' (' + r.id + '): prev_hash does not match the previous record');
    if (hashRecord(r) !== r.hash) problems.push('line ' + (i + 1) + ' (' + r.id + '): content does not match its hash');
    prev = r.hash;
  });
  return text({
    ok: problems.length === 0,
    events: lines.length,
    head_hash: prev,
    problems,
    limits: 'Detects accidental or casual edits to this file. Anyone who can rewrite the whole file can rebuild a valid chain. This is not a signature and does not prove authenticity, completeness or truth. Share head_hash separately if you want others to detect later rewriting.'
  });
}

function toolExport(args) {
  args = args || {};
  const level = args.level === undefined ? 2 : args.level;
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('level must be an integer from 0 to 4');
  const format = args.format || 'ipc-json';
  if (!['ipc-json', 'prov-json'].includes(format)) throw new Error('format must be ipc-json or prov-json');
  if (format === 'prov-json' && level < 3) throw new Error('prov-json needs level 3 or 4 because it contains event-level detail');
  let records = disclosed(readRecords(), level);
  if (args.object !== undefined) {
    if (typeof args.object !== 'string' || !args.object || args.object.length > 200) throw new Error('object must be a nonempty identifier at most 200 chars');
    const t = traceObject(records, args.object, 50);
    if (!t.seedCount) throw new Error('No records available at this disclosure level for the requested item.');
    records = t.found;
  }
  let body;
  if (format === 'prov-json') {
    body = toProvJson(records.map(e => projectEvent(e, level, records)));
  } else {
    body = {
      ipc_version: IPC_VERSION,
      exported_at: nowIso(),
      disclosure_level: level,
      scope: args.object ? (level >= 2 ? 'trace of ' + args.object : 'selected disclosed records') : 'all disclosed events',
      self_declared: true,
      integrity: level === 4
        ? 'Records include prev_hash and hash. Verify with ipc_verify_chain on the full log. Filtered exports cannot be chain-verified.'
        : 'Not chain-verifiable at this level.',
      view: buildView(records, level)
    };
  }
  const json = JSON.stringify(body, null, 2);
  if (args.save) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true, mode: 0o700 });
    const name = 'ipc-export-' + nowIso().replace(/[:.]/g, '-') + '-L' + level + '-' + format + '-' + crypto.randomUUID().slice(0, 8) + '.json';
    const p = path.join(EXPORT_DIR, name);
    fs.writeFileSync(p, json, { mode: 0o600, flag: 'wx' });
    return text({ saved_to: p, bytes: json.length, disclosure_level: level, format });
  }
  if (json.length > MAX_INLINE_CHARS) {
    throw new Error('Export is ' + json.length + ' characters. Call again with save=true, a lower level, or an object filter.');
  }
  return text(json);
}

/* ---------- tool registry ---------- */

const objectStr = { type: 'string', description: 'Identifier of the item, assertion or version affected. No spaces.' };
const TOOLS = [
  {
    name: 'ipc_record_event',
    title: 'Record a contribution event',
    description: 'Append one user-declared contribution event to a local IPC log. Use for explicitly requested manual records. Never call automatically and never store conversation text.',
    inputSchema: {
      type: 'object',
      properties: {
        actor_id: { type: 'string', description: 'Who or what performed the action, e.g. student:01, tool:pubmed-search, model:claude. No spaces.' },
        actor_type: { type: 'string', enum: ACTOR_TYPES },
        actor_name: { type: 'string', description: 'Optional display name.' },
        action: { type: 'string', enum: ACTIONS },
        object: objectStr,
        issuer: { type: 'string', description: 'Who is recording the claim (not necessarily the actor). Defaults to local-user.' },
        selector: { type: 'string', description: 'Optional part of the object, e.g. "paragraph 3".' },
        target: { type: 'string', description: 'Required for contests and supersedes: the earlier assertion being challenged or replaced.' },
        context: { type: 'string', description: 'Optional session or run identifier.' },
        time: { type: 'string', description: 'When it happened, ISO 8601 with timezone. Omit to use the recording time.' },
        parents: { type: 'array', items: { type: 'string' }, description: 'Event ids or object ids this event depends on.' },
        evidence_origin: { type: 'string', enum: ORIGINS },
        handoff_id: { type: 'string', description: 'Correlates a sends event with its receives event.' },
        payload_ref: { type: 'string', description: 'Pointer to restricted evidence held elsewhere. Not resolved by this plugin.' },
        payload_text: { type: 'string', description: 'Optional, at least 40 characters, e.g. a document. Hashed with SHA-256 and discarded; only the hash is stored.' },
        payload_sha256: { type: 'string', description: 'Optional precomputed SHA-256 (64 lowercase hex characters).' },
        summary: { type: 'string', description: 'Optional short user-approved label, at most 280 characters.' },
        uncertainty: { type: 'string', description: 'Optional, e.g. "low confidence".' },
        policy_ref: { type: 'string', description: 'Optional reference to a governing policy.' },
        data_subject: { type: 'string', description: 'Optional identifier of the person the assertion is about.' },
        min_view_level: { type: 'integer', minimum: 0, maximum: 4, description: 'Lowest disclosure level at which this event may appear. Default 1; use 4 for sensitive events.' }
      },
      required: ['actor_id', 'actor_type', 'action', 'object']
    },
    annotations: { title: 'Record a contribution event', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: toolRecord
  },
  {
    name: 'ipc_list_events',
    title: 'List disclosed events',
    description: 'List locally recorded events at a chosen disclosure level. Default level 2. Sensitive events are excluded before pagination.',
    inputSchema: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 4, description: 'Default 2.' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } } },
    annotations: { title: 'List recorded events', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: toolList
  },
  {
    name: 'ipc_trace_object',
    title: 'Trace the history of one item',
    description: 'Trace only records visible at the requested disclosure level (0 declaration, 1 actors, 2 contribution map, 3 timeline, 4 full). Hidden records and reference identifiers never appear in lower-level traces. At levels below 4 completeness is unknown.',
    inputSchema: {
      type: 'object',
      properties: {
        object: objectStr,
        level: { type: 'integer', minimum: 0, maximum: 4, description: 'Default 2.' },
        max_depth: { type: 'integer', minimum: 1, maximum: 50 }
      },
      required: ['object']
    },
    annotations: { title: 'Trace the history of one item', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: toolTrace
  },
  {
    name: 'ipc_verify_chain',
    title: 'Check log integrity',
    description: 'Recompute the local hash chain and report edited, reordered or malformed records. Detects casual edits only; it is not a signature.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Check log integrity', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: toolVerify
  },
  {
    name: 'ipc_export_records',
    title: 'Export records for sharing',
    description: 'Export the user\'s records at a chosen disclosure level as IPC JSON or an experimental PROV-JSON mapping, optionally limited to one item\'s trace. With save=true, writes a file under the plugin data folder on the user\'s machine; nothing is uploaded.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'integer', minimum: 0, maximum: 4, description: 'Default 2.' },
        format: { type: 'string', enum: ['ipc-json', 'prov-json'] },
        object: { type: 'string', description: 'Optional: export only the trace of this item.' },
        save: { type: 'boolean', description: 'Write to a local file instead of returning the content.' }
      }
    },
    annotations: { title: 'Export records for sharing', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: toolExport
  }
];

/* ---------- MCP over stdio (newline-delimited JSON-RPC) ---------- */

const recordTool = TOOLS.find(t => t.name === 'ipc_record_event');
TOOLS.splice(1, 0, {
  name: 'ipc_record_events',
  title: 'Record several contribution events',
  description: 'Append up to 20 user-declared contribution events to the local IPC log in one step. Use only after the user has explicitly asked to record them and has seen the list. All events are validated first; if any is invalid none are written. Refer to earlier events in the same batch by their object identifier. Stores structured metadata only, never message text.',
  inputSchema: {
    type: 'object',
    properties: { events: { type: 'array', minItems: 1, maxItems: 20, items: recordTool.inputSchema } },
    required: ['events']
  },
  annotations: { title: 'Record several contribution events', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  run: toolRecordBatch
});

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function handle(msg) {
  const id = msg.id;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (msg.method) {
      case 'initialize':
        return send({ jsonrpc: '2.0', id, result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        } });
      case 'ping':
        return isRequest && send({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(t => ({
          name: t.name, title: t.title, description: t.description,
          inputSchema: t.inputSchema, annotations: t.annotations })) } });
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === (msg.params || {}).name);
        if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + (msg.params || {}).name } });
        let result;
        try { result = tool.run((msg.params || {}).arguments || {}); } catch (e) {
          result = { content: [{ type: 'text', text: String(e.message || e) }], isError: true };
        }
        return send({ jsonrpc: '2.0', id, result });
      }
      default:
        if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
    }
  } catch (e) {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } });
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_) {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    handle(msg);
  });
}
module.exports = { toolRecord, toolRecordBatch, toolExport, readRecords, buildView, traceObject, disclosed };
