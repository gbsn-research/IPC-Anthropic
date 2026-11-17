'use strict';
// Run: node test/smoke.js
// Uses a temporary IPC_HOME; never touches the real log.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { IPC_HOME: home }) });
let buf = '';
const waiting = new Map();
srv.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  }
});
let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise(res => { waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
}
async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r.result.content[0].text;
  return { isError: !!r.result.isError, text: t, json: (() => { try { return JSON.parse(t); } catch (e) { return null; } })() };
}

(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.strictEqual(init.result.serverInfo.name, 'ipc-provenance');

  const list = await rpc('tools/list', {});
  const tools = list.result.tools;
  assert.strictEqual(tools.length, 6);
  tools.forEach(t => {
    assert.ok(t.name.length <= 64);
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean' && typeof t.annotations.destructiveHint === 'boolean' && t.annotations.title);
  });

  // Personal-profile scenario from the paper (section 7.2), synthetic.
  let r = await call('ipc_record_event', { actor_id: 'person:subject1', actor_type: 'human', action: 'contributes_to', object: 'profile:address', evidence_origin: 'person-supplied', data_subject: 'person:subject1', min_view_level: 4 });
  assert.ok(!r.isError, r.text);
  const e1 = r.json.recorded;
  r = await call('ipc_record_event', { actor_id: 'vendor:demo', actor_type: 'service', action: 'contributes_to', object: 'profile:demographic', evidence_origin: 'third-party', issuer: 'data-provider' });
  const e2 = r.json.recorded;
  r = await call('ipc_record_event', { actor_id: 'inference-engine-12', actor_type: 'ai', action: 'infers', object: 'profile:relationship-claim-7', evidence_origin: 'application-inferred', parents: [e1, e2, 'urn:ipc:somewhere-else:E99'], uncertainty: 'moderate', payload_text: 'secret evidence text that must never be written to the log file itself' });
  assert.ok(!r.isError, r.text);
  assert.deepStrictEqual(r.json.unresolved_parents, ['urn:ipc:somewhere-else:E99']);
  r = await call('ipc_record_event', { actor_id: 'person:subject1', actor_type: 'human', action: 'contests', object: 'profile:contest-1', target: 'profile:relationship-claim-7' });
  assert.ok(!r.isError, r.text);
  r = await call('ipc_record_event', { actor_id: 'vendor:demo', actor_type: 'service', action: 'supersedes', object: 'profile:relationship-claim-7-v2', target: 'profile:relationship-claim-7', evidence_origin: 'corrected' });
  assert.ok(!r.isError, r.text);

  // Validation errors are helpful, not generic.
  r = await call('ipc_record_event', { actor_id: 'x', actor_type: 'robot', action: 'supersedes', object: 'o' });
  assert.ok(r.isError && /actor_type must be one of/.test(r.text) && /target is required/.test(r.text), r.text);
  r = await call('ipc_record_event', { actor_id: 'x', actor_type: 'ai', action: 'generates', object: 'o', time: '2999-01-01T00:00:00Z' });
  assert.ok(r.isError && /future/.test(r.text));
  r = await call('ipc_record_event', { actor_id: 'x', actor_type: 'ai', action: 'generates', object: 'o', payload_text: 'a', payload_sha256: 'b' });
  assert.ok(r.isError);

  // Trace: marks where history ends, shows later status.
  r = await call('ipc_trace_object', { object: 'profile:relationship-claim-7', level: 3 });
  assert.deepStrictEqual(r.json.unresolved_upstream, []); // lower levels must not expose upstream identifiers
  assert.strictEqual(r.json.history_complete, null); // partial disclosure cannot claim complete history
  assert.strictEqual(r.json.later_status_events.length, 2);
  const lvl3 = JSON.stringify(r.json.view);
  assert.ok(!/payload_sha256|data_subject/.test(lvl3), 'level 3 must not expose level-4 fields');
  assert.ok(!JSON.stringify(r.json).includes(e1), 'level 3 must not expose hidden parent event ID');

  r = await call('ipc_trace_object', { object: 'profile:relationship-claim-7', level: 4 });
  assert.ok(/payload_sha256/.test(JSON.stringify(r.json.view)));
  assert.ok(!/secret evidence text that must never/.test(JSON.stringify(r.json)), 'payload text must never be stored');

  r = await call('ipc_trace_object', { object: 'profile:relationship-claim-7', level: 0 });
  assert.ok(r.isError, 'No events marked level 0, so trace must not reveal records');
  r = await call('ipc_export_records', { level: 0 });
  assert.strictEqual(r.json.view.declaration.ai_participated_in_disclosed_events, false); // default min level is 1
  r = await call('ipc_trace_object', { object: 'nope' });
  assert.ok(r.isError);

  // Integrity.
  r = await call('ipc_verify_chain', {});
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.events, 5);

  // Exports.
  r = await call('ipc_export_records', { level: 2 });
  assert.strictEqual(r.json.view.level, 2);
  r = await call('ipc_export_records', { level: 2, format: 'prov-json' });
  assert.ok(r.isError, 'prov-json requires level >= 3');
  r = await call('ipc_export_records', { level: 3, format: 'prov-json' });
  const prov = r.json;
  assert.ok(prov.activity && prov.agent && prov.entity && prov.wasAssociatedWith);
  assert.ok(Object.values(prov.wasDerivedFrom).some(x => x['prov:type'] === 'prov:Revision'));
  r = await call('ipc_export_records', { level: 1, save: true });
  assert.ok(fs.existsSync(r.json.saved_to));

  // Events explicitly visible at L0 still must not expose IDs or status links
  // through the trace wrapper (L0 and L1 are aggregate/actors-only views).
  r = await call('ipc_record_event', {
    actor_id: 'human:public', actor_type: 'human', action: 'generates',
    object: 'public-zero-object', min_view_level: 0
  });
  r = await call('ipc_record_event', {
    actor_id: 'human:public', actor_type: 'human', action: 'contests',
    object: 'public-zero-contest', target: 'public-zero-object', min_view_level: 0
  });
  for (const level of [0, 1]) {
    r = await call('ipc_trace_object', { object: 'public-zero-object', level });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(r.json.later_status_events, []);
    assert.ok(!JSON.stringify(r.json.view).includes('public-zero-contest'));
  }
  r = await call('ipc_export_records', { level: 0, object: 'public-zero-object' });
  assert.strictEqual(r.json.scope, 'selected disclosed records');

  // Privacy regression: an event visible only at L4 must never appear in
  // L0-L3 lists, direct traces, status events, linked parent IDs, or exports.
  const secret = 'supersecret-REDACT-ME-27';
  r = await call('ipc_record_event', {
    actor_id: 'private-actor-' + secret, actor_type: 'human', action: 'contests',
    object: 'private-object-' + secret, target: 'profile:relationship-claim-7',
    summary: 'private summary ' + secret, min_view_level: 4
  });
  const secretId = r.json.recorded;
  assert.ok(!r.isError);
  r = await call('ipc_record_event', {
    actor_id: 'model:claude', actor_type: 'ai', action: 'revises',
    object: 'safe-output', parents: [secretId], min_view_level: 2
  });
  assert.ok(!r.isError);
  for (let level = 0; level <= 3; level++) {
    for (const [tool, params] of [
      ['ipc_list_events', { level }],
      ['ipc_trace_object', { object: 'profile:relationship-claim-7', level }],
      ['ipc_trace_object', { object: 'safe-output', level }],
      ['ipc_export_records', { level }],
    ]) {
      const view = await call(tool, params);
      assert.ok(!JSON.stringify(view).includes(secret), tool + ' level ' + level + ' leaked private data');
      assert.ok(!JSON.stringify(view).includes(secretId), tool + ' level ' + level + ' leaked private event ID');
    }
    const direct = await call('ipc_trace_object', { object: 'private-object-' + secret, level });
    assert.ok(direct.isError && !JSON.stringify(direct).includes(secret), 'hidden seed must not be identified');
  }
  r = await call('ipc_export_records', { level: 3, format: 'prov-json' });
  assert.ok(!JSON.stringify(r).includes(secret) && !JSON.stringify(r).includes(secretId));
  r = await call('ipc_trace_object', { object: 'profile:relationship-claim-7', level: 3 });
  assert.ok(!r.json.later_status_events.some(x => x.by_event === secretId), 'hidden contest must not leak via status');
  r = await call('ipc_trace_object', { object: 'safe-output', level: 3 });
  assert.ok(!JSON.stringify(r.json).includes(secretId), 'hidden ancestor must be redacted');
  r = await call('ipc_export_records', { level: 4 });
  assert.ok(JSON.stringify(r.json).includes(secret), 'level 4 must include full sensitive record');

  // No automatic capture: no hook files, no capture tools, no settings file.
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'hooks')), 'plugin must ship no hooks');
  assert.ok(!tools.some(t => /capture/.test(t.name)), 'no capture tools');
  assert.ok(!fs.existsSync(path.join(home, 'settings.json')), 'no settings file');

  // Batch recording: all-or-nothing, parents by object id, no text stored.
  const countLines = () => fs.readFileSync(path.join(home, 'records.jsonl'), 'utf8').trim().split('\n').length;
  let before = countLines();
  r = await call('ipc_record_events', { events: [
    { actor_id: 'student:01', actor_type: 'human', action: 'contributes_to', object: 'essay:thesis', evidence_origin: 'person-supplied' },
    { actor_id: 'model:assistant', actor_type: 'ai', action: 'proposes', object: 'essay:outline-v1', parents: ['essay:thesis'] },
    { actor_id: 'student:01', actor_type: 'human', action: 'revises', object: 'essay:draft-1', parents: ['essay:outline-v1'] }
  ] });
  assert.ok(!r.isError, r.text);
  assert.strictEqual(r.json.recorded.length, 3);
  assert.deepStrictEqual(r.json.recorded[1].unresolved_parents, [], 'batch parent resolved by object id');
  assert.strictEqual(countLines(), before + 3);
  r = await call('ipc_trace_object', { object: 'essay:draft-1', level: 4 });
  assert.strictEqual(r.json.history_complete, true);
  assert.strictEqual(r.json.view.events.length, 3);

  before = countLines();
  r = await call('ipc_record_events', { events: [
    { actor_id: 'a', actor_type: 'human', action: 'revises', object: 'ok-one' },
    { actor_id: 'b', actor_type: 'robot', action: 'revises', object: 'bad-one' }
  ] });
  assert.ok(r.isError && /events\[1\]/.test(r.text) && /No events were recorded/.test(r.text), r.text);
  assert.strictEqual(countLines(), before, 'invalid batch must write nothing');
  r = await call('ipc_record_events', { events: [] });
  assert.ok(r.isError);
  r = await call('ipc_record_events', { events: new Array(21).fill({ actor_id: 'a', actor_type: 'human', action: 'revises', object: 'x' }) });
  assert.ok(r.isError && countLines() === before);

  // payload_text: minimum length, hashed and discarded.
  r = await call('ipc_record_event', { actor_id: 'a', actor_type: 'human', action: 'revises', object: 'short-text', payload_text: 'yes' });
  assert.ok(r.isError && /40/.test(r.text), r.text);
  const doc = 'This sentence is a stand-in for a document that must never be stored in the log file.';
  r = await call('ipc_record_event', { actor_id: 'a', actor_type: 'human', action: 'revises', object: 'long-text', payload_text: doc });
  assert.ok(!r.isError, r.text);
  const raw = fs.readFileSync(path.join(home, 'records.jsonl'), 'utf8');
  assert.ok(!raw.includes('stand-in for a document'), 'payload text must not be stored');
  assert.ok(raw.includes(require('crypto').createHash('sha256').update(doc).digest('hex')));

  // Concurrent batches from several processes keep one valid chain.
  const { spawnSync } = require('child_process');
  await Promise.all([1, 2, 3, 4, 5, 6].map(n => new Promise((resolve, reject) => {
    const p = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { IPC_HOME: home }) });
    p.on('error', reject); p.on('close', resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ipc_record_event', arguments: { actor_id: 'p' + n, actor_type: 'software', action: 'generates', object: 'concurrent:' + n } } }) + '\n');
    setTimeout(() => p.stdin.end(), 700);
  })));
  r = await call('ipc_verify_chain', {});
  assert.strictEqual(r.json.ok, true, JSON.stringify(r.json.problems));

  // ipcctl demo creates a synthetic log in an empty folder and refuses to overwrite.
  const demoDir = path.join(home, 'demo-log');
  let cp = spawnSync('node', [path.join(__dirname, '..', 'ipcctl.js'), 'demo', demoDir]);
  assert.strictEqual(cp.status, 0, String(cp.stderr));
  assert.ok(fs.existsSync(path.join(demoDir, 'records.jsonl')));
  cp = spawnSync('node', [path.join(__dirname, '..', 'ipcctl.js'), 'demo', demoDir]);
  assert.notStrictEqual(cp.status, 0, 'demo must refuse an existing log');

  // Tamper detection.
  const file = path.join(home, 'records.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  lines[1] = lines[1].replace('third-party', 'person-supplied');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  r = await call('ipc_verify_chain', {});
  assert.strictEqual(r.json.ok, false);
  assert.ok(r.json.problems.length >= 1);

  // File permissions (POSIX).
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'log must not be group/world accessible');
  }

  console.log('All smoke tests passed.');
  srv.kill();
  fs.rmSync(home, { recursive: true, force: true });
})().catch(e => { console.error('FAIL:', e.stack || e.message); srv.kill(); process.exit(1); });
