#!/usr/bin/env node
'use strict';
// Optional offline command line for IPC Provenance. No network, no API keys.
//   node ipcctl.js export [level 0-4] [object-id]   save a shareable JSON file
//   node ipcctl.js demo [folder]                    create a synthetic sample log
const os = require('os');
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2);

if (args[0] === 'demo') {
  // Must set IPC_HOME before server.js is loaded.
  process.env.IPC_HOME = args[1] ? path.resolve(args[1]) : path.join(os.homedir(), '.ipc-provenance-demo');
}
const ipc = require('./server.js');

function demo() {
  const home = process.env.IPC_HOME;
  if (fs.existsSync(path.join(home, 'records.jsonl'))) {
    throw new Error('A log already exists in ' + home + '. Choose an empty folder: node ipcctl.js demo <folder>');
  }
  const e = (a) => ipc.toolRecord(Object.assign({ issuer: 'demo' }, a));
  // Case 1: student assignment (synthetic)
  e({ actor_id: 'student:01', actor_type: 'human', action: 'contributes_to', object: 'essay:thesis', evidence_origin: 'person-supplied', time: '2026-11-01T09:00:00Z', summary: 'Student thesis' });
  e({ actor_id: 'tool:library-search', actor_type: 'software', action: 'retrieves', object: 'source:journal-article-1', evidence_origin: 'third-party', time: '2026-11-01T09:20:00Z' });
  e({ actor_id: 'model:assistant', actor_type: 'ai', action: 'proposes', object: 'essay:outline-v1', parents: ['essay:thesis'], time: '2026-11-01T09:40:00Z' });
  e({ actor_id: 'student:01', actor_type: 'human', action: 'revises', object: 'essay:draft-1', selector: 'paragraph 3', parents: ['essay:outline-v1', 'source:journal-article-1'], time: '2026-11-01T11:00:00Z' });
  e({ actor_id: 'student:01', actor_type: 'human', action: 'sends', object: 'essay:draft-1', handoff_id: 'handoff-1', time: '2026-11-02T08:00:00Z' });
  // Case 2: derived personal profile (synthetic), including a contestation and correction
  e({ actor_id: 'person:subject-1', actor_type: 'human', action: 'contributes_to', object: 'profile:address', evidence_origin: 'person-supplied', data_subject: 'person:subject-1', min_view_level: 4, time: '2026-11-03T10:00:00Z' });
  e({ actor_id: 'vendor:data-co', actor_type: 'service', action: 'contributes_to', object: 'profile:demographic', evidence_origin: 'third-party', time: '2026-11-03T10:05:00Z' });
  e({ actor_id: 'engine:inference-12', actor_type: 'ai', action: 'infers', object: 'profile:relationship-claim-7', evidence_origin: 'application-inferred', uncertainty: 'moderate', parents: ['profile:address', 'profile:demographic', 'urn:ipc:upstream-vendor:E99'], time: '2026-11-03T10:15:00Z' });
  e({ actor_id: 'person:subject-1', actor_type: 'human', action: 'contests', object: 'profile:contest-1', target: 'profile:relationship-claim-7', time: '2026-11-04T09:00:00Z' });
  e({ actor_id: 'engine:inference-12', actor_type: 'ai', action: 'supersedes', object: 'profile:relationship-claim-7-v2', target: 'profile:relationship-claim-7', evidence_origin: 'corrected', time: '2026-11-05T09:00:00Z' });
  // Case 3: enterprise research (synthetic)
  e({ actor_id: 'analyst:02', actor_type: 'human', action: 'contributes_to', object: 'report:brief', evidence_origin: 'person-supplied', time: '2026-11-06T09:00:00Z' });
  e({ actor_id: 'tool:spreadsheet', actor_type: 'software', action: 'generates', object: 'report:chart-1', evidence_origin: 'application-observed', parents: ['report:brief'], time: '2026-11-06T10:00:00Z' });
  e({ actor_id: 'model:assistant', actor_type: 'ai', action: 'proposes', object: 'report:recommendation', parents: ['report:chart-1'], time: '2026-11-06T11:00:00Z' });
  e({ actor_id: 'manager:03', actor_type: 'human', action: 'approves', object: 'report:recommendation', policy_ref: 'policy:review-v1', time: '2026-11-07T09:00:00Z' });
  console.log('Synthetic demo log created in ' + home);
  console.log('To try it in Claude Code:');
  console.log('  IPC_HOME="' + home + '" claude --plugin-dir /path/to/ipc-provenance');
  console.log('Then ask: "Trace the history of essay:draft-1 at level 3."');
}

try {
  if (args[0] === 'export' && args.length >= 1 && args.length <= 3) {
    const level = args[1] === undefined ? 2 : Number(args[1]);
    const object = args[2];
    const out = JSON.parse(ipc.toolExport({ format: 'ipc-json', level, object, save: true }).content[0].text);
    console.log('Saved shareable metadata file: ' + out.saved_to);
    console.log('Disclosure level: ' + out.disclosure_level + ' (self-declared; not independently verified)');
  } else if (args[0] === 'demo' && args.length <= 2) {
    demo();
  } else {
    console.error('Usage:\n  node ipcctl.js export [level:0-4] [object-id]\n  node ipcctl.js demo [empty-folder]');
    process.exitCode = 2;
  }
} catch (err) { console.error(err.message); process.exitCode = 1; }
