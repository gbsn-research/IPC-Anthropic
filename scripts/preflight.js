'use strict';
// Offline package-level structural check; not a substitute for `claude plugin validate`.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'ipc-provenance');
assert.match(manifest.name, /^[a-z][a-z0-9-]*$/);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.license, 'MIT');
assert.equal(mcp.mcpServers.ipc.command, 'node');
assert.deepEqual(mcp.mcpServers.ipc.args, ['${CLAUDE_PLUGIN_ROOT}/server.js']);
assert.equal(Object.keys(pkg.dependencies).length, 0);
for (const rel of ['server.js','LICENSE','PRIVACY.md','IPC_Viewer.html','skills/ipc-record/SKILL.md','skills/ipc-share/SKILL.md','test/smoke.js','test/security.js']) {
  assert.ok(fs.statSync(path.join(root, rel)).isFile(), rel + ' missing');
}
for (const name of ['ipc-record','ipc-share']) {
  const skill = fs.readFileSync(path.join(root,'skills',name,'SKILL.md'),'utf8');
  assert.ok(skill.startsWith('---\nname: '+name+'\n'), 'Invalid SKILL.md frontmatter: '+name);
}
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert.ok(server.includes("version: '0.3.0'"));
console.log('PASS: offline plugin manifest, MCP wiring, skill frontmatter, dependency-free package, version alignment.');
