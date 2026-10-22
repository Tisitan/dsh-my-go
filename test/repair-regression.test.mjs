import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync} from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SettingsForms} from '@deepseek-ai/dsh-settings'
import {Config} from '../lib/config.js'
import {apply} from '../preset/tools/broker.mjs'
import {createMockCtx,agentOf,execOf,snapOf,waitFor,setHostBindings} from './helpers/mock-ctx.mjs'
import {writeBoard,readBoardSlice} from '../preset/shared/board.mjs'
import {createUsageAggregator} from '../lib/usage-aggregator.mjs'
import {createLedgerOps} from '../preset/tools/broker-ledger.mjs'
import {typeOfAgent,agentRoleLabel} from '../preset/shared/misc.mjs'
import {migrateLegacyRolesOps,mergeRoleBindings} from '../preset/shared/roles.mjs'

for (const lane of ['explore','hermes']) test(`revive reservation: ${lane}, concurrent admission and rejection release`,async()=>{
 let n=0;const pending=[];let rejectDelivery=false
 const parent=agentOf('p-'+lane)
 const {ctx,tools,dispatch}=createMockCtx({startContinuable:async()=>({childId:'c'+ ++n}),agents:{get:id=>id===parent.id?parent:undefined},subagentsExtra:{followup:async()=>{if(rejectDelivery)throw new Error('delivery rejected');return new Promise(resolve=>pending.push(resolve))}}})
 await apply(ctx,{reportExternalization:false,readPoolSize:3,writePoolSize:3})
 for(let i=0;i<2;i++){const r=await tools.get('go_work').execute({agent:lane,prompt:'synthetic'},execOf(parent));dispatch('subagent/end',{id:r.childId,stopReason:'completed',lastAssistantMessage:[]})}
 for(let i=0;i<2;i++)await tools.get('go_work').execute({agent:lane,prompt:'busy'},execOf(parent))
 const first=tools.get('continue').execute({id:'c1',prompt:'revive'},execOf(parent));await waitFor(()=>pending.length===1)
 await assert.rejects(()=>tools.get('continue').execute({id:'c2',prompt:'revive'},execOf(parent)),/no free slot/)
 pending[0]('m');await first;assert.equal(snapOf(parent.id).currentRecords.length,3)
 dispatch('subagent/end',{id:'c1',stopReason:'completed',lastAssistantMessage:[]})
 rejectDelivery=true;await assert.rejects(()=>tools.get('continue').execute({id:'c2',prompt:'revive'},execOf(parent)),/delivery rejected/)
 rejectDelivery=false;const again=tools.get('continue').execute({id:'c2',prompt:'revive'},execOf(parent));await waitFor(()=>pending.length===2);pending[1]('m2');await again
 assert.equal(snapOf(parent.id).currentRecords.length,3)
})

test('board: failed backup preserves canonical report; concurrent replacements serialize',async()=>{
 process.env.DSH_HOME=mkdtempSync(join(tmpdir(),'mygo-fixed-board-'))
 const first=await writeBoard('p','c','old report');mkdirSync(first.path.replace(/\.md$/,'.prev.md'))
 await assert.rejects(()=>writeBoard('p','c','new report'))
 assert.equal((await readBoardSlice('p','c',0,10)).text,'old report')
 assert.equal(readdirSync(join(first.path,'..')).some(n=>n.endsWith('.tmp')),false)
 await fs.rm(first.path.replace(/\.md$/,'.prev.md'),{recursive:true})
 await Promise.all([writeBoard('p','c','second'),writeBoard('p','c','third')])
 assert.equal((await readBoardSlice('p','c',0,10)).text,'third')
 assert.equal(readFileSync(first.path.replace(/\.md$/,'.prev.md'),'utf8'),'second')
})

test('usage: terminal partial stream is rebuilt and recovered without cursor gaps or duplicates',async()=>{
 let available=false,reads=0
 const event=(seq,inputTokens)=>({seq,type:'assistant/message',data:{usage:{inputTokens,outputTokens:1,cacheReadTokens:0,cacheWriteTokens:0}}})
 const agg=createUsageAggregator({loadLedger:async()=>({version:3,parents:{p:[{childId:'c',status:'done'}]}}),readArchive:async id=>{if(id==='p')return {events:[],complete:true};reads++;return available?{events:[event(1,1),event(5,100),event(10,22)],complete:true}:{events:[event(1,1),event(10,22)],complete:false}}})
 assert.equal((await agg.getUsage('p')).children[0].frozen,false)
 available=true;const recovered=await agg.getUsage('p');assert.equal(recovered.children[0].totals.inputTokens,123);assert.equal(recovered.children[0].partial,false)
 await agg.getUsage('p');assert.equal(reads,2)
})

for(const reason of ['error','aborted','refusal','max-tokens'])test(`waiting ${reason}: settles and releases queue`,async()=>{
 let n=0;const parent=agentOf('p-'+reason),child=agentOf('c1',{parentSession:parent.id,label:'dsh-my-go:explore: synthetic'})
 const {ctx,tools,dispatch}=createMockCtx({startContinuable:async()=>({childId:'c'+ ++n}),agents:{get:id=>id===parent.id?parent:undefined},subagentsExtra:{reportFrom:async()=> 'help'}})
 await apply(ctx,{reportExternalization:false});await tools.get('go_work').execute({agent:'explore',prompt:'synthetic'},execOf(parent))
 await tools.get('need_help').execute({intent:'consult',content:'synthetic help'},execOf(child));await tools.get('go_work').execute({agent:'explore',prompt:'queued'},execOf(parent))
 dispatch('subagent/end',{id:'c1',stopReason:reason,lastAssistantMessage:[]})
 await waitFor(()=>snapOf(parent.id).currentRecords.some(r=>r.childId==='c2'))
 assert.equal(snapOf(parent.id).history.find(r=>r.childId==='c1').status,'failed');assert.equal(snapOf(parent.id).helpRequests.length,0)
})

test('route: unsupported effort cleared after model switch; invalid route is atomic',async()=>{
 const restore=setHostBindings({roles:{explore:{provider:'p2',model:'m2',reasoningEffort:'high'}}})
 try{
  let exists=true;const {ctx,dispatch}=createMockCtx({llm:{listModels:async()=>exists?[{id:'m2'}]:[],resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low'}]}})}})
  await apply(ctx,{reportExternalization:false});const child=agentOf('c',{parentSession:'p',label:'dsh-my-go:explore: synthetic'})
  const seed=()=>({provider:'p1',model:'m1',reasoningEffort:'max'})
  const next=await dispatch('agent/request',{agent:child},seed);assert.deepEqual(next,{provider:'p2',model:'m2'})
  exists=false;const reset=setHostBindings({roles:{explore:{provider:'p3',model:'missing'}}})
  try{assert.deepEqual(await dispatch('agent/request',{agent:child},seed),seed())}finally{reset()}
 }finally{restore()}
})

test('ledger: close blocks an already in-flight old write and future schedules',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mygo-fixed-ledger-')),ledgerPath=join(dir,'ledger.json')
 let unblock;const gate=new Promise(r=>unblock=r);let entered=false,wroteOld=false
 const realWrite=fs.writeFile;fs.writeFile=async(...args)=>{if(String(args[0]).startsWith(ledgerPath+'.')&&!entered){entered=true;await gate;const value=await realWrite(...args);wroteOld=true;return value}return realWrite(...args)};syncBuiltinESMExports()
 const orch={history:[{childId:'old',agentType:'explore'}],chains:[]}
 const ops=createLedgerOps({ledgerPath,orchestrations:new Map([['p',orch]]),orchFor:()=>orch,findRecordEverywhere:()=>undefined,bump(){}})
 try{
  ops.scheduleLedgerSave();await waitFor(()=>entered)
  orch.history.push({childId:'new',agentType:'explore'});ops.scheduleLedgerSave();ops.closeLedger();unblock()
  await waitFor(()=>wroteOld&&!readdirSync(dir).some(f=>f.endsWith('.tmp')))
  assert.equal(JSON.parse(readFileSync(ledgerPath,'utf8')).parents.p.length,2)
  orch.history=[];ops.scheduleLedgerSave();ops.closeLedger()
  assert.equal(JSON.parse(readFileSync(ledgerPath,'utf8')).parents.p.length,2)
 }finally{unblock();fs.writeFile=realWrite;syncBuiltinESMExports()}
})

test('legacy migration: real host volatile write accepts sets, preserves old base and is idempotent',async()=>{
 let raw={hermes:{provider:'legacy',model:'old'}},edited=0
 const forms={schema:()=>Config,describe:()=>[{ns:'dsh-my-go',revision:0}],ownerContext:{configEditor:{entries:()=>[{options:{id:'dsh-my-go'}}],edit:async(_entry,fn)=>{raw=fn(raw,{});edited++}}},write:SettingsForms.prototype.write}
 assert.equal(mergeRoleBindings({},raw).hermes.model,'old','read fallback protects binding before persistence')
 await SettingsForms.prototype.mutate.call(forms,'dsh-my-go',migrateLegacyRolesOps(raw))
 assert.equal(edited,1);assert.equal(raw.roles.hermes.model,'old');assert.equal(raw.hermes.model,'old');assert.equal(migrateLegacyRolesOps(raw),null)
 raw.roles.hermes={model:'new',toolFilter:{deny:['read_probe']}};assert.equal(mergeRoleBindings({},raw).hermes.model,'new');assert.equal(mergeRoleBindings({},raw).hermes.toolFilter,undefined)
})


test('rc.2 descriptor label: first request, cold resume and fallback pending use durable role identity',()=>{
 const session={header:{label:'dsh-my-go:oracle: inherited seed'},snapshotEvents:()=>[
  {type:'subagent/descriptor',data:{label:'dsh-my-go:oracle: inherited seed'}},
  {type:'subagent/descriptor',data:{label:'dsh-my-go:custom-role: task#placeholder'}}]}
 const agent={id:'cold-child',session}
 assert.equal(typeOfAgent(new Map(),agent),'custom-role')
 assert.equal(agentRoleLabel(agent),'dsh-my-go:custom-role: task#placeholder')
 assert.equal(typeOfAgent(new Map([[agent.id,'hermes']]),agent),'hermes')
 assert.equal(typeOfAgent(new Map(),{session:{header:{label:'dsh-my-go:explore: legacy'}}}),'explore')
})

test('spawn: invalid explicit route preserves parent provider instead of mixing routes',async()=>{
 const parent=agentOf('p-route');parent.options={provider:'p1',model:'m1'}
 let seen
 const {ctx,tools}=createMockCtx({startContinuable:async spec=>{seen=spec;return{childId:'new-child'}},llm:{listModels:async()=>[]}})
 await apply(ctx,{reportExternalization:false,bindings:{hermes:{provider:'p2',model:'missing'}}})
 await tools.get('go_work').execute({agent:'hermes',prompt:'synthetic'},execOf(parent))
 assert.deepEqual(seen.request.agentOptions,{provider:'p1'})
})
