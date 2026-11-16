'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
function start(home, vars = {}) {
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, IPC_HOME: home, IPC_ALLOW_LEVEL4: '', ...vars }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let seq = 0; let out = ''; let stderr = '';
  child.stderr.on('data', b => stderr += b.toString());
  child.stdout.on('data', b => {
    out += b.toString(); let i;
    while ((i = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, i); out = out.slice(i + 1);
      const msg = JSON.parse(line);
      if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const promiseFor = (id) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Timeout for ' + id + ', stderr: ' + stderr)), 5000);
    pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
  });
  const request = (method, params = {}) => {
    const id = ++seq;
    const promise = promiseFor(id);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return promise;
  };
  const call = async (name, args = {}) => {
    const m = await request('tools/call', { name, arguments: args });
    return m.result || m.error;
  };
  return { child, call, request, waitNull: () => promiseFor(null), write: s => child.stdin.write(s), stop: () => child.kill() };
}
const sample = { actor_id: 'researcher:01', actor_type: 'human', action: 'proposes', object: 'paper:v1', public_label: 'Human drafted scope' };
const text = r => r.content?.[0]?.text || r.message || '';
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-security-'));
  const s = start(home);
  try {
    let r = await s.call('ipc_record_event', sample);
    assert.equal(r.isError, undefined, text(r));
    const id = JSON.parse(text(r)).recorded;
    assert.match(id, /^urn:ipc:local-user:[0-9a-f-]{36}$/);
    r = await s.call('ipc_list_events', { level: 4, confirm_sensitive_view: true });
    assert.equal(r.isError, true);
    assert.match(text(r), /IPC_ALLOW_LEVEL4/);
    r = await s.call('ipc_export_records', { level: 4, confirm_sensitive_export: true });
    assert.equal(r.isError, true);
    const leak = await s.call('ipc_trace_object', { object: 'paper:v1', level: 4, confirm_sensitive_view: true });
    assert.equal(leak.isError, true);

    // Request size enforced before newline. A new request on the same stream must still work.
    const oversize = s.waitNull();
    s.write('a'.repeat(300000));
    const m = await oversize;
    assert.equal(m.error.code, -32600);
    s.write('\n');
    assert.deepEqual((await s.request('ping')).result, {});
    // Valid JSON primitives must not crash the server.
    const invalid = s.waitNull(); s.write('false\n');
    assert.equal((await invalid).error.code, -32600);
    assert.deepEqual((await s.request('ping')).result, {});

    // Record file must not be a symlink or a world-readable file.
    const log = path.join(home, 'records.jsonl');
    assert.equal(fs.statSync(log).mode & 0o077, 0);
    assert.equal(fs.statSync(home).mode & 0o077, 0);
    const original = fs.readFileSync(log);
    const target = path.join(os.tmpdir(), 'ipc-outside-' + process.pid + '-' + Date.now());
    fs.writeFileSync(target, 'outside-sentinel', { mode: 0o600 });
    fs.unlinkSync(log); fs.symlinkSync(target, log);
    r = await s.call('ipc_record_event', sample);
    assert.equal(r.isError, true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'outside-sentinel');
    fs.unlinkSync(log); fs.writeFileSync(log, original, { mode: 0o600 });
    fs.unlinkSync(target);

    // A lock protects against concurrent or interrupted local writes.
    const lock = path.join(home, '.write.lock');
    fs.writeFileSync(lock, 'stale', { mode: 0o600 });
    r = await s.call('ipc_record_event', sample);
    assert.equal(r.isError, true);
    assert.match(text(r), /busy/);
    fs.unlinkSync(lock);
    r = await s.call('ipc_record_event', { ...sample, object: 'paper:v2' });
    assert.equal(r.isError, undefined, text(r));
    assert.equal(JSON.parse(text(await s.call('ipc_verify_chain'))).ok, true);
    console.log('PASS: Level 4 default-deny, oversized stream recovery, malformed JSON recovery, private file modes, symlink rejection, write lock, UUIDs, chain integrity.');
  } finally { s.stop(); fs.rmSync(home, { recursive: true, force: true }); }
})().catch(err => { console.error('FAIL: ' + (err.stack || err)); process.exitCode = 1; });
