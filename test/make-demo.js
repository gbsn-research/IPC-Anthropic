'use strict';
// Creates synthetic demonstration output by calling the actual MCP server.
const {spawn} = require('child_process');
const fs = require('fs'), os=require('os'), path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'ipc-demo-'));
const root=path.join(__dirname,'..');
const srv=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,IPC_HOME:home},stdio:['pipe','pipe','pipe']});
let seq=0, buf=''; const pending=new Map();
srv.stdout.on('data',chunk=>{buf+=chunk;let i;while((i=buf.indexOf('\n'))!==-1){let msg=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);const fn=pending.get(msg.id);if(fn){pending.delete(msg.id);fn(msg);}}});
function rpc(method,params){const id=++seq;return new Promise(res=>{pending.set(id,res);srv.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function call(name,args){const r=await rpc('tools/call',{name,arguments:args});if(r.result?.isError)throw Error(r.result.content[0].text);return r.result.content[0].text;}
(async()=>{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'demo-generator',version:'1'}});
 const input={actor_id:'researcher:01',actor_type:'human',actor_name:'Researcher',issuer:'local-user',evidence_origin:'person-supplied'};
 async function ev(x){return JSON.parse(await call('ipc_record_event',x)).recorded;}
 const a=await ev({...input,action:'proposes',object:'study:question',time:'2026-11-10T09:00:00Z',public_label:'Researcher defined the research question and study scope.'});
 const b=await ev({actor_id:'tool:scholar-search',actor_type:'software',actor_name:'Research search tool',issuer:'local-user',action:'retrieves',object:'source:published-research',evidence_origin:'third-party',time:'2026-11-10T09:12:00Z',parents:[a],public_label:'The tool retrieved a published research source.'});
 const c=await ev({actor_id:'model:claude',actor_type:'ai',actor_name:'Claude',issuer:'local-user',action:'proposes',object:'report:version-1',evidence_origin:'application-inferred',time:'2026-11-10T09:22:00Z',parents:[a,b],public_label:'Claude proposed a draft synthesis referencing the research source.'});
 const d=await ev({...input,action:'checks',object:'report:version-1',time:'2026-11-10T09:34:00Z',parents:[c],selector:'Claim 2',public_label:'Researcher checked a claim against the retrieved source.'});
 const e=await ev({...input,action:'revises',object:'report:version-2',time:'2026-11-10T09:47:00Z',parents:[c,d],selector:'Conclusion',public_label:'Researcher revised the conclusion and prepared a new version.'});
 const f=await ev({actor_id:'reviewer:01',actor_type:'human',actor_name:'Reviewer',issuer:'local-user',action:'reviews',object:'report:version-2',time:'2026-11-10T10:05:00Z',parents:[e],public_label:'Reviewer inspected the revised document.'});
 const json=await call('ipc_export_records',{object:'report:version-2',level:3,format:'ipc-json'});
 const md=await call('ipc_render_timeline',{object:'report:version-2',level:3});
 const parsed=JSON.parse(json);parsed.demo={synthetic:true,subject:'AI-assisted research synthesis',limitations:'Six-event sample of human, AI and software contributions. Open your own IPC JSON to inspect a record.'};
 fs.writeFileSync(path.join(root,'examples','synthetic_output_L3.json'),JSON.stringify(parsed,null,2)+'\n');
 fs.writeFileSync(path.join(root,'examples','synthetic_timeline_L3.md'),md+'\n');
 console.log('Created synthetic example: '+parsed.view.events.length+' events, markdown '+md.length+' chars');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{srv.kill();fs.rmSync(home,{recursive:true,force:true});});
