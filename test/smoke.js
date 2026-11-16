'use strict';
// Integration tests: real stdio MCP process; never use a user's home directory.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-free-test-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
  { env: { ...process.env, IPC_HOME: home, IPC_ALLOW_LEVEL4: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let idCounter = 0;
const waiting = new Map();
let errLog = '';
srv.stderr.on('data', d => { errLog += d.toString(); });
srv.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  }
});
async function rpc(method, params) {
  const id = ++idCounter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('RPC timeout: ' + method + '\n' + errLog)); }, 5000);
    waiting.set(id, m => { clearTimeout(timer); resolve(m); });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function raw(line) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for malformed-request response')), 5000);
    waiting.set(null, m => { clearTimeout(timer); resolve(m); });
    srv.stdin.write(line + '\n');
  });
}
async function call(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) return { isError: true, text: r.error.message, json: null };
  const text = r.result.content[0].text;
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { isError: !!r.result.isError, text, json };
}
(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'ipc-provenance');
  const tools = (await rpc('tools/list', {})).result.tools;
  assert.equal(tools.length, 6);
  assert.ok(tools.some(t => t.name === 'ipc_render_timeline'));
  tools.forEach(t => assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean'));

  // Reference manuscript: synthetic student, AI, research, and human revision events.
  let r = await call('ipc_record_event', { actor_id: 'student:01', actor_type: 'human', actor_name: 'Researcher', action: 'proposes', object: 'essay:thesis', evidence_origin: 'person-supplied', public_label: 'Researcher introduced the main research question.' });
  assert.equal(r.isError, false, r.text);
  const thesis = r.json.recorded;
  r = await call('ipc_record_event', { actor_id: 'source:private', actor_type: 'service', actor_name: 'PRIVATE-SOURCE-NAME', action: 'retrieves', object: 'essay:restricted-source', summary: 'SECRET SOURCE PASSAGE', payload_text: 'SECRET_PAYLOAD_TEXT_NOT_STORED', payload_ref: 'SECRET-PAYLOAD-REF', data_subject: 'SECRET-PERSON', min_view_level: 4 });
  assert.equal(r.isError, false, r.text);
  const hidden = r.json.recorded;
  r = await call('ipc_record_event', { actor_id: 'model:claude', actor_type: 'ai', actor_name: 'Claude', action: 'generates', object: 'essay:outline', evidence_origin: 'application-inferred', parents: [thesis, hidden], public_label: 'AI proposed a draft outline based on the research question.' });
  assert.equal(r.isError, false, r.text);
  const aiEvent = r.json.recorded;
  r = await call('ipc_record_event', { actor_id: 'student:01', actor_type: 'human', actor_name: 'Researcher', action: 'revises', object: 'essay:outline', parents: [aiEvent], selector: 'Introduction', public_label: 'Researcher revised and accepted the outline.' });
  assert.equal(r.isError, false, r.text);
  r = await call('ipc_record_event', { actor_id: 'reviewer:01', actor_type: 'human', action: 'contests', object: 'essay:contest', target: 'essay:outline', min_view_level: 4 });
  assert.equal(r.isError, false, r.text);

  for (const level of [0, 1, 2, 3]) {
    for (const [name, args] of [
      ['ipc_list_events', { level }],
      ['ipc_trace_object', { object: 'essay:outline', level }],
      ['ipc_export_records', { level }]
    ]) {
      const v = await call(name, args);
      assert.equal(v.isError, false, `${name} L${level}: ${v.text}`);
      assert.ok(!v.text.includes(hidden), `${name} L${level} leaked hidden event ID`);
      for (const secret of ['PRIVATE-SOURCE-NAME', 'SECRET SOURCE PASSAGE', 'SECRET-PAYLOAD-REF', 'SECRET-PERSON', 'essay:restricted-source']) {
        assert.ok(!v.text.includes(secret), `${name} L${level} leaked: ${secret}`);
      }
    }
  }
  r = await call('ipc_render_timeline', { object: 'essay:outline' });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.text.includes('IPC | Contribution timeline'));
  assert.ok(r.text.includes('Researcher'));
  assert.ok(r.text.includes('Claude'));
  assert.ok(r.text.includes('AI proposed a draft outline'));
  assert.ok(!r.text.includes(hidden));
  assert.ok(!r.text.includes('PRIVATE-SOURCE-NAME'));

  // An invisible-only object must be indistinguishable from a nonexistent one.
  for (const name of ['ipc_trace_object', 'ipc_render_timeline']) {
    const absent = await call(name, { object: 'item:never-recorded', level: 3 });
    const hiddenOnly = await call(name, { object: 'essay:restricted-source', level: 3 });
    assert.equal(hiddenOnly.isError, true);
    assert.equal(absent.text, hiddenOnly.text, `${name}: hidden record existence was disclosed`);
  }
  const absentExport = await call('ipc_export_records', { object: 'item:never-recorded', level: 3 });
  const hiddenExport = await call('ipc_export_records', { object: 'essay:restricted-source', level: 3 });
  assert.equal(absentExport.text, hiddenExport.text);

  r = await call('ipc_trace_object', { object: 'essay:outline', level: 4 });
  assert.equal(r.isError, true, 'level 4 trace requires confirmation');
  r = await call('ipc_list_events', { level: 4 });
  assert.equal(r.isError, true, 'level 4 list requires confirmation');
  r = await call('ipc_render_timeline', { object: 'essay:outline', level: 4 });
  assert.equal(r.isError, true, 'level 4 timeline requires confirmation');
  r = await call('ipc_trace_object', { object: 'essay:outline', level: 4, confirm_sensitive_view: true });
  assert.ok(r.text.includes(hidden), 'level 4 should show authorized private record');
  assert.ok(!r.text.includes('SECRET_PAYLOAD_TEXT_NOT_STORED'), 'payload text is never stored');
  r = await call('ipc_export_records', { level: 4 });
  assert.equal(r.isError, true, 'level 4 requires explicit user approval');
  assert.match(r.text, /confirm_sensitive_export/);
  r = await call('ipc_export_records', { level: 4, confirm_sensitive_export: true });
  assert.equal(r.isError, false, r.text);
  r = await call('ipc_export_records', { level: 3, format: 'prov-json' });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.json.activity && r.json.agent && r.json.entity);
  assert.ok(!r.text.includes(hidden));
  r = await call('ipc_export_records', { level: 2, format: 'prov-json' });
  assert.equal(r.isError, true);
  r = await call('ipc_export_records', { level: 2, save: true });
  assert.equal(r.isError, false, r.text);
  assert.ok(fs.existsSync(r.json.saved_to));

  // Invalid input must not kill the process, nor skip schema validation.
  let reply = await raw('null');
  assert.equal(reply.error.code, -32600);
  reply = await raw('[]');
  assert.equal(reply.error.code, -32600);
  reply = await raw('{bad json}');
  assert.equal(reply.error.code, -32700);
  reply = await rpc('tools/call', { name: 'ipc_list_events', arguments: 'not-an-object' });
  assert.equal(reply.error.code, -32602);
  assert.equal((await rpc('ping', {})).result instanceof Object, true, 'process still alive');
  r = await call('ipc_record_event', { actor_id: 'a', actor_type: 'human', action: 'generates', object: 'x', min_view_level: 9 });
  assert.equal(r.isError, true);

  // Integrity and tampering; no more appends when file is corrupt.
  r = await call('ipc_verify_chain');
  assert.equal(r.json.ok, true);
  assert.equal(r.json.events, 5);
  const file = path.join(home, 'records.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  lines[1] = lines[1].replace('PRIVATE-SOURCE-NAME', 'ALTERED-SOURCE-NAME');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  r = await call('ipc_verify_chain');
  assert.equal(r.json.ok, false);
  r = await call('ipc_record_event', { actor_id: 'a', actor_type: 'human', action: 'proposes', object: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.text, /verification/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);

  console.log('PASS: 6 MCP tools, consent-based record capture, levels 0–4, hidden-event redaction in list/trace/export/timeline, PROV mapping, level-4 approval, malformed requests, integrity and fail-closed writes.');
})().catch(err => { console.error('FAIL:', err.stack || err); process.exitCode = 1; }).finally(() => {
  srv.kill();
  fs.rmSync(home, { recursive: true, force: true });
});
