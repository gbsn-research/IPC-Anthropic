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

const SERVER_INFO = { name: 'ipc-provenance', version: '0.3.0' };
const IPC_VERSION = '0.1-draft';
const HOME = process.env.IPC_HOME || path.join(os.homedir(), '.ipc-provenance');
const FILE = path.join(HOME, 'records.jsonl');
const EXPORT_DIR = path.join(HOME, 'exports');
const ZERO_HASH = '0'.repeat(64);
const MAX_RPC_BYTES = 256 * 1024;
const MAX_LOG_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_EXPORT_BYTES = 50 * 1024;
const LOCK = path.join(HOME, '.write.lock');
const ALLOW_LEVEL_4 = process.env.IPC_ALLOW_LEVEL4 === '1';
process.umask(0o077);

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
function ensurePrivateDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('IPC storage directory must be a real directory, not a symbolic link.');
  if (process.platform !== 'win32' && (st.mode & 0o077)) throw new Error('IPC storage directory is accessible to other local users; set permissions to 0700.');
}
function openPrivateFile(file, flags, mode = 0o600) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(file, flags | noFollow, mode);
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1 || (process.platform !== 'win32' && (st.mode & 0o077))) {
    fs.closeSync(fd);
    throw new Error('IPC data file has unsafe type, link count, or permissions.');
  }
  return fd;
}
function ensureLevel4(level, confirmation, fieldName = 'confirm_sensitive_view') {
  if (level !== 4) return;
  if (!ALLOW_LEVEL_4) throw new Error('Level 4 is locked. Restart Claude with IPC_ALLOW_LEVEL4=1 only if you want sensitive record fields available to its tools.');
  if (confirmation !== true) throw new Error('Level 4 requires ' + fieldName + '=true after an explicit user request.');
}
function withWriteLock(task) {
  ensurePrivateDir(HOME);
  let fd;
  try { fd = openPrivateFile(LOCK, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL); }
  catch (e) {
    if (e.code === 'EEXIST') throw new Error('IPC data file is busy (or a stale .write.lock exists). Retry; if the previous process crashed, inspect and remove ~/.ipc-provenance/.write.lock manually.');
    throw e;
  }
  try {
    fs.writeSync(fd, String(process.pid) + ' ' + nowIso() + '\n');
    return task();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(LOCK);
  }
}

/* ---------- storage ---------- */

function readRecords() {
  ensurePrivateDir(HOME);
  if (!fs.existsSync(FILE)) return [];
  const fd = openPrivateFile(FILE, fs.constants.O_RDONLY);
  let contents;
  try {
    if (fs.fstatSync(fd).size > MAX_LOG_BYTES) throw new Error('IPC log exceeds 50 MB local safety limit. Make a backup and archive old records before adding more.');
    contents = fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
  const lines = contents.split('\n').filter(l => l.trim());
  return lines.map((l, i) => {
    try {
      const record = JSON.parse(l);
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.hash !== 'string') throw new Error('invalid record');
      return record;
    } catch (e) {
      throw new Error('records.jsonl line ' + (i + 1) + ' is not a valid record. Restore a trusted backup before recording further data.');
    }
  });
}
function appendRecord(rec) {
  const fd = openPrivateFile(FILE, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT);
  try {
    const line = Buffer.from(JSON.stringify(rec) + '\n');
    if (fs.fstatSync(fd).size + line.length > MAX_LOG_BYTES) throw new Error('IPC log would exceed 50 MB local safety limit.');
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

/* ---------- validation and record construction ---------- */

const CONTROL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
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
  const publicLabel = str('public_label', a.public_label, { max: 160 });
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

  let minView = 0;
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
    if (typeof a.payload_text !== 'string' || a.payload_text.length === 0 || a.payload_text.length > 200000) {
      errs.push('payload_text must be a non-empty string of at most 200000 characters');
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

  // UUID prevents collisions when individually created logs are later exchanged.
  const prev = records.length ? records[records.length - 1].hash : ZERO_HASH;
  const rec = {
    ipc_version: IPC_VERSION,
    id: 'urn:ipc:' + issuer + ':' + crypto.randomUUID(),
    issuer,
    actor: { id: actorId, type: actorType, name: actorName },
    action, object, selector, target, context,
    time, time_basis: timeBasis, recorded_at: recordedAt,
    parents, handoff_id: handoffId,
    evidence_origin: origin, payload_ref: payloadRef, payload_sha256: payloadSha,
    summary, public_label: publicLabel, uncertainty, policy_ref: policyRef, data_subject: dataSubject,
    min_view_level: minView,
    prev_hash: prev
  };
  Object.keys(rec).forEach(k => { if (rec[k] === undefined) delete rec[k]; });
  if (rec.actor.name === undefined) delete rec.actor.name;
  rec.hash = hashRecord(rec);
  return rec;
}

/* ---------- views (disclosure levels 0-4) ---------- */

// Disclosure levels are informational views, NOT identity-based access control.
// Every operation that returns shareable information filters first; sensitive
// events MUST NOT influence lower-level fields, lists or relationship arrays.
function permitted(records, level) {
  return records.filter(e => (e.min_view_level === undefined ? 1 : e.min_view_level) <= level);
}
function projectEvent(rec, level, visibleIds, visibleObjects) {
  if (level >= 4) return rec;
  if (level === 3) {
    const out = {
      id: rec.id, issuer: rec.issuer,
      actor: { id: rec.actor.id, type: rec.actor.type, ...(rec.actor.name ? { name: rec.actor.name } : {}) },
      action: rec.action, object: rec.object, time: rec.time,
      time_basis: rec.time_basis, recorded_at: rec.recorded_at
    };
    if (rec.public_label) out.public_label = rec.public_label;
    if (rec.selector) out.selector = rec.selector;
    if (rec.evidence_origin) out.evidence_origin = rec.evidence_origin;
    if (rec.target && (visibleObjects.has(rec.target) || visibleIds.has(rec.target))) out.target = rec.target;
    const parents = (rec.parents || []).filter(p => visibleIds.has(p));
    if (parents.length) out.parents = parents;
    if ((rec.parents || []).length !== parents.length) {
      out.upstream_note = 'Some upstream references are not shown in this view.';
    }
    return out;
  }
  const out = { object: rec.object, action: rec.action, actor_type: rec.actor.type };
  if (rec.selector) out.selector = rec.selector;
  if (rec.evidence_origin) out.evidence_origin = rec.evidence_origin;
  return out;
}
function buildView(events, level) {
  const visible = permitted(events, level);
  if (level === 0) {
    const types = Array.from(new Set(visible.map(e => e.actor.type))).sort();
    return {
      level: 0,
      declaration: {
        ai_participated: types.includes('ai'),
        automated_systems_participated: types.some(t => ['ai', 'software', 'service'].includes(t)),
        actor_types: types,
        event_count: visible.length
      },
      note: 'Visible declarations only; withheld records are not counted. No inference about authorship, skill or quality.'
    };
  }
  if (level === 1) {
    const actors = new Map();
    visible.forEach(e => {
      const key = e.actor.id;
      if (!actors.has(key)) actors.set(key, { id: key, type: e.actor.type, name: e.actor.name, roles: new Set() });
      actors.get(key).roles.add(e.action);
    });
    return {
      level: 1,
      actors: Array.from(actors.values()).map(a => {
        const out = { id: a.id, type: a.type, roles: Array.from(a.roles).sort() };
        if (a.name) out.name = a.name;
        return out;
      }),
      note: 'Only actors and roles from events allowed at this level.'
    };
  }
  const ids = new Set(visible.map(e => e.id));
  const objects = new Set(visible.map(e => e.object));
  return {
    level,
    events: visible.map(e => projectEvent(e, level, ids, objects)),
    note: level === 4 ? 'Full locally stored declarations. May contain sensitive metadata.' : 'Some events or references may be withheld; view does not establish complete history.'
  };
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
  return withWriteLock(() => {
    const records = readRecords();
    if (records.length && !verifyRawRecords(records)) throw new Error('Local record chain failed verification; refusing to append to it.');
    const rec = buildRecord(args || {}, records);
    appendRecord(rec);
    const missing = (rec.parents || []).filter(p => !records.some(r => r.id === p || r.object === p));
    return text({
      recorded: rec.id,
      time: rec.time,
      time_basis: rec.time_basis,
      note: 'Self-declared event stored locally. Message text was not stored.',
      unresolved_parents: missing
    });
  });
}

function toolList(args) {
  args = args || {};
  const level = args.level === undefined ? 2 : args.level;
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('level must be an integer from 0 to 4');
  const limit = Math.min(Math.max(Number.isInteger(args.limit) ? args.limit : 20, 1), 100);
  const offset = Math.max(Number.isInteger(args.offset) ? args.offset : 0, 0);
  ensureLevel4(level, args.confirm_sensitive_view);
  const visible = permitted(readRecords(), level);
  const selected = visible.slice(offset, offset + limit);
  return text({ level, total_visible_at_this_level: visible.length, offset,
    items: buildView(selected, level),
    note: 'Only events visible at the chosen disclosure level are listed. Other records are not identified.' });
}

function safeTrace(records, objectId, level, maxDepth) {
  // Query and walk only permitted records. Hidden-only objects must be indistinguishable from missing objects.
  records = permitted(records, level);
  const t = traceObject(records, objectId, maxDepth);
  if (!t.seedCount) throw new Error('No matching recorded event. List your visible items to find an object identifier.');
  const visibleStatus = permitted(records.filter(r =>
    r.target === objectId && (r.action === 'contests' || r.action === 'supersedes')), level);
  const result = {
    scope: level >= 2 ? objectId : 'Selected item',
    view: buildView(t.found, level),
    evidence_status: 'Contributor-declared events. Inspect supporting evidence separately.'
  };
  if (level >= 2) {
    const visibleIds = new Set(visibleStatus.map(e => e.id));
    const objects = new Set(visibleStatus.map(e => e.object));
    result.later_status_events = visibleStatus.map(e => level >= 4
      ? { by_event: e.id, action: e.action, new_object: e.object }
      : { action: e.action, ...(level === 3 && visibleIds.has(e.id) ? { by_event: e.id } : {}),
          ...(level === 3 && objects.has(e.object) ? { new_object: e.object } : {}) });
  }
  if (level === 4) {
    result.recorded_references_resolved = t.unresolved.length === 0 && !t.truncated;
    result.unresolved_upstream = t.unresolved;
    result.depth_limit_hit = t.truncated;
  } else {
    result.completeness = 'Unknown. This view may omit events and upstream references.';
  }
  return result;
}

function toolTrace(args) {
  args = args || {};
  if (typeof args.object !== 'string' || !args.object || args.object.length > 200) throw new Error('object must be a non-empty identifier (max 200 characters)');
  const level = args.level === undefined ? 3 : args.level;
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('level must be an integer from 0 to 4');
  ensureLevel4(level, args.confirm_sensitive_view);
  const maxDepth = Math.min(Math.max(Number.isInteger(args.max_depth) ? args.max_depth : 10, 1), 50);
  return text(safeTrace(readRecords(), args.object, level, maxDepth));
}

function cleanMarkdown(s) { return String(s).replace(/[\\`*_{}\[\]()#+.!|<>]/g, '\\$&').replace(/[\r\n]/g, ' '); }
function timelineMarkdown(t, level) {
  const lines = ['# IPC | Contribution timeline', '',
    '**Record basis:** Contributor-declared events.',
    '**Disclosure view:** Level ' + level,
    '**Artifact:** ' + cleanMarkdown(t.scope), '',
    'Event times are asserted or recorded locally, not externally authenticated.', ''];
  const v = t.view;
  if (level < 3) {
    lines.push('This view does not provide an event-level timeline. Choose Level 3 for a timeline or Level 4 for sensitive local details.');
    return lines.join('\n');
  }
  if (!v.events.length) lines.push('_No events visible at this level._');
  v.events.forEach((e, i) => {
    const actor = (e.actor.name || e.actor.id) + ' (' + e.actor.type + ')';
    lines.push('### ' + (i + 1) + '. ' + cleanMarkdown(e.action) + ' — ' + cleanMarkdown(e.object));
    if (e.public_label) lines.push(cleanMarkdown(e.public_label));
    lines.push('- **When:** ' + cleanMarkdown(e.time) + ' (' + cleanMarkdown(e.time_basis) + ')');
    lines.push('- **Actor:** ' + cleanMarkdown(actor));
    lines.push('- **Issuer:** ' + cleanMarkdown(e.issuer));
    if (e.evidence_origin) lines.push('- **Origin:** ' + cleanMarkdown(e.evidence_origin));
    if (e.selector) lines.push('- **Output element:** ' + cleanMarkdown(e.selector));
    if (e.parents && e.parents.length) lines.push('- **Recorded upstream IDs:** ' + e.parents.map(cleanMarkdown).join(', '));
    if (e.upstream_note) lines.push('- **Upstream:** Some references are not shown at this level.');
    lines.push('');
  });
  if (t.later_status_events && t.later_status_events.length) {
    lines.push('## Later contests or corrections');
    t.later_status_events.forEach(e => lines.push('- ' + cleanMarkdown(e.action) + (e.new_object ? ': ' + cleanMarkdown(e.new_object) : '')));
    lines.push('');
  }
  lines.push('**Coverage:** ' + (level === 4 && t.recorded_references_resolved ?
    'All referenced events in this trace were found in the local file; other unrecorded work may exist.' :
    'History may be partial or redacted. Missing evidence is unknown, not absent.'));
  lines.push('**Sharing:** Review the selected disclosure level and supporting evidence before sharing.');
  return lines.join('\n');
}
function toolTimeline(args) {
  args = args || {};
  if (!args.object || typeof args.object !== 'string') throw new Error('object is required');
  const level = args.level === undefined ? 3 : args.level;
  if (level !== 3 && level !== 4) throw new Error('timeline requires level 3 or 4');
  ensureLevel4(level, args.confirm_sensitive_view);
  const t = safeTrace(readRecords(), args.object, level, 50);
  return text(timelineMarkdown(t, level));
}

function verifyRawRecords(records) {
  let prev = ZERO_HASH;
  const seen = new Set();
  for (const r of records) {
    if (!r || !r.id || seen.has(r.id) || r.prev_hash !== prev || r.hash !== hashRecord(r)) return false;
    seen.add(r.id); prev = r.hash;
  }
  return true;
}
function toolVerify() {
  let records;
  try { records = readRecords(); }
  catch (e) {
    if (/records\.jsonl line /.test(String(e.message))) return text({ ok: false, events: null, problems: [String(e.message)] });
    throw e;
  }
  if (!records.length) return text({ ok: true, events: 0, note: 'No log yet.' });
  const lines = records.map(r => JSON.stringify(r));
  let prev = ZERO_HASH;
  const problems = [];
  const ids = new Set();
  lines.forEach((l, i) => {
    let r;
    try { r = JSON.parse(l); } catch (e) { problems.push('line ' + (i + 1) + ': invalid JSON'); return; }
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.hash !== 'string') { problems.push('line ' + (i + 1) + ': invalid record shape'); return; }
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
  if (level === 4) ensureLevel4(level, args.confirm_sensitive_export, 'confirm_sensitive_export');
  const format = args.format || 'ipc-json';
  if (!['ipc-json', 'prov-json'].includes(format)) throw new Error('format must be ipc-json or prov-json');
  if (format === 'prov-json' && level < 3) throw new Error('prov-json needs level 3 or 4 because it contains event-level detail');
  if (args.save !== undefined && typeof args.save !== 'boolean') throw new Error('save must be boolean');
  let records = permitted(readRecords(), level);
  if (args.object !== undefined) {
    if (typeof args.object !== 'string' || !args.object || args.object.length > 200) throw new Error('object must be a short non-empty string');
    const t = traceObject(records, args.object, 50);
    if (!t.seedCount) throw new Error('No recorded event matches that item.');
    records = t.found;
  }
  const view = buildView(records, level);
  let body;
  if (format === 'prov-json') {
    body = toProvJson(view.events);
  } else {
    body = {
      ipc_version: IPC_VERSION,
      exported_at: nowIso(),
      disclosure_level: level,
      scope: args.object && level >= 2 ? 'trace of ' + args.object : args.object ? 'selected item' : 'visible events',
      self_declared: true,
      integrity: level === 4 ?
        'Stored event hashes included; a filtered or selectively disclosed file is NOT independently chain-verifiable.' :
        'No transferable cryptographic authentication at this level.',
      view
    };
  }
  const json = JSON.stringify(body, null, 2);
  if (args.save) {
    ensurePrivateDir(EXPORT_DIR);
    const name = 'ipc-export-' + nowIso().replace(/[:.]/g, '-') + '-L' + level + '-' + format + '-' + crypto.randomBytes(3).toString('hex') + '.json';
    const p = path.join(EXPORT_DIR, name);
    const fd = openPrivateFile(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return text({ saved_to: p, bytes: Buffer.byteLength(json), disclosure_level: level, format,
      note: 'Locally written only. Review the file before sharing.' });
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_INLINE_EXPORT_BYTES) throw new Error('Export is too long. Use save=true or narrow the object/level.');
  return text(json);
}

/* ---------- tool registry ---------- */

const objectStr = { type: 'string', description: 'Identifier of the item, assertion or version affected. No spaces.' };
const TOOLS = [
  {
    name: 'ipc_record_event',
    title: 'Record a contribution event',
    description: 'Append one user-declared contribution event to the local IPC provenance log on the user\'s machine. Call only when the user explicitly asks to record, log or declare a contribution, handoff, correction or approval. Never call automatically and never use it to log conversation text; it stores structured metadata only.',
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
        payload_text: { type: 'string', description: 'Optional. Hashed with SHA-256 and discarded; only the hash is stored.' },
        payload_sha256: { type: 'string', description: 'Optional precomputed SHA-256 (64 lowercase hex characters).' },
        summary: { type: 'string', description: 'Optional sensitive summary, at most 280 characters; Level 4 only.' },
        public_label: { type: 'string', description: 'Optional short user-approved timeline label (up to 160 chars). Shown at disclosure level 3; avoid secrets.' },
        uncertainty: { type: 'string', description: 'Optional, e.g. "low confidence".' },
        policy_ref: { type: 'string', description: 'Optional reference to a governing policy.' },
        data_subject: { type: 'string', description: 'Optional identifier of the person the assertion is about.' },
        min_view_level: { type: 'integer', minimum: 0, maximum: 4, description: 'Lowest disclosure level at which this event may appear. Default 0; use 4 for sensitive events. Explicitly controls inclusion in lower views.' }
      },
      required: ['actor_id', 'actor_type', 'action', 'object']
    },
    annotations: { title: 'Record a contribution event', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: toolRecord
  },
  {
    name: 'ipc_list_events',
    title: 'List recorded events',
    description: 'List only events permitted by the chosen disclosure view. Defaults to Level 2, which hides event identifiers and personal names.',
    inputSchema: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 4 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 }, confirm_sensitive_view: { type: 'boolean', description: 'Required true for Level 4, subject to IPC_ALLOW_LEVEL4=1.' } } },
    annotations: { title: 'List recorded events', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: toolList
  },
  {
    name: 'ipc_trace_object',
    title: 'Trace the history of one item',
    description: 'Show the recorded history of one item by following parent references, at a chosen disclosure level (0 declaration, 1 actors, 2 contribution map, 3 timeline, 4 full). Reports where recorded history ends and any later contest or supersede events.',
    inputSchema: {
      type: 'object',
      properties: {
        object: objectStr,
        level: { type: 'integer', minimum: 0, maximum: 4, description: 'Default 3.' },
        max_depth: { type: 'integer', minimum: 1, maximum: 50 },
        confirm_sensitive_view: { type: 'boolean', description: 'Required true for Level 4, subject to IPC_ALLOW_LEVEL4=1.' }
      },
      required: ['object']
    },
    annotations: { title: 'Trace the history of one item', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: toolTrace
  },
  {
    name: 'ipc_render_timeline',
    title: 'Show a readable IPC contribution timeline',
    description: 'Render the user-declared contribution history of one artifact as readable Markdown with actors, issuers, times, origins and recorded connections. No web access, no capture. Use Level 3 by default; Level 4 only with explicit user permission for sensitive details.',
    inputSchema: { type: 'object', properties: { object: objectStr, level: { type: 'integer', enum: [3, 4] }, confirm_sensitive_view: { type: 'boolean', description: 'Required true for Level 4, subject to IPC_ALLOW_LEVEL4=1.' } }, required: ['object'] },
    annotations: { title: 'Render an IPC timeline', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: toolTimeline
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
        save: { type: 'boolean', description: 'Write to a local file instead of returning the content.' },
        confirm_sensitive_export: { type: 'boolean', description: 'Required true for Level 4, after the user explicitly agrees to export sensitive record metadata and enables IPC_ALLOW_LEVEL4=1.' }
      }
    },
    annotations: { title: 'Export records for sharing', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: toolExport
  }
];

/* ---------- MCP over stdio (bounded newline-delimited JSON-RPC) ---------- */

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  }
  const id = msg.id;
  if (id !== undefined && id !== null && !['string', 'number'].includes(typeof id)) {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request id' } });
  }
  const isRequest = id !== undefined && id !== null;
  if (!isRequest) return; // JSON-RPC notifications cannot produce responses or mutate the log.
  try {
    switch (msg.method) {
      case 'initialize':
        return send({ jsonrpc: '2.0', id, result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        } });
      case 'ping':
        return send({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(t => ({
          name: t.name, title: t.title, description: t.description,
          inputSchema: t.inputSchema, annotations: t.annotations })) } });
      case 'tools/call': {
        const params = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? msg.params : {};
        const tool = TOOLS.find(t => t.name === params.name);
        if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } });
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!args || typeof args !== 'object' || Array.isArray(args)) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Tool arguments must be an object' } });
        let result;
        try { result = tool.run(args); } catch (e) {
          result = { content: [{ type: 'text', text: String(e.message || e) }], isError: true };
        }
        return send({ jsonrpc: '2.0', id, result });
      }
      default:
        return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
  } catch (_e) {
    return send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } });
  }
}

// Reject oversized requests *as they arrive*, even if a sender never terminates a line.
let buffer = Buffer.alloc(0);
let dropping = false;
process.stdin.on('data', chunk => {
  let i = 0;
  while (i < chunk.length) {
    const end = chunk.indexOf(10, i);
    const part = end < 0 ? chunk.subarray(i) : chunk.subarray(i, end);
    if (!dropping) {
      if (buffer.length + part.length > MAX_RPC_BYTES) {
        buffer = Buffer.alloc(0);
        dropping = true;
        send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
      } else if (part.length) {
        buffer = Buffer.concat([buffer, part]);
      }
    }
    if (end < 0) break;
    if (!dropping && buffer.length) {
      let msg;
      try { msg = JSON.parse(buffer.toString('utf8')); }
      catch (_e) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      if (msg !== undefined) handle(msg);
    }
    buffer = Buffer.alloc(0);
    dropping = false;
    i = end + 1;
  }
});
