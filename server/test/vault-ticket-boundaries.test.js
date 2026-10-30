import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vaultFixture } from './vault-fixture.js';

for(const action of ['rename','notes','folders','link'])test(`an expiring vault ticket cannot authorize a delayed ${action} body`,async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);const f=await vaultFixture(t),file=await f.put();
  const cases={rename:{id:file.id,name:'changed.txt'},notes:{id:file.id,text:'late',days:0},folders:{name:'late'},link:{id:file.id,hours:1}};
  let release,enter;const ready=new Promise(r=>{enter=r;});
  const headers={authorization:'Bearer '+f.dev.token,'x-vault-ticket':f.dev.ticket,'content-type':'application/json'};
  const pending=f.s.app.api.handle({method:'POST',path:'/api/vault/'+action,query:new URLSearchParams(),ip:'127.0.0.1',
    header:name=>headers[name.toLowerCase()]||'',json:()=>{enter();return new Promise(r=>{release=()=>r(cases[action]);});}});
  await ready;now+=30*60000;release();const result=await pending;assert.equal(result.status,403);
  assert.equal(f.q('SELECT name FROM vault_files WHERE id=?').get(file.id).name,file.name);
  for(const table of ['vault_notes','vault_folders','vault_links'])assert.equal(f.q('SELECT COUNT(*) AS n FROM '+table).get().n,0);
});
