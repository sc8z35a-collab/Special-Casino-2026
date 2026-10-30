import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vaultFixture, vaultBucket, holdVaultRead } from './vault-fixture.js';

for (const change of ['stop','expire','implement','delete']) test(`a public vault read cannot deliver private bytes after ${change} while R2 was pending`,async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const blobs=vaultBucket(),f=await vaultFixture(t,{blobs}),file=await f.put();
  const link=await f.call('POST','/api/vault/link',{id:file.id,hours:1});assert.equal(link.status,200);
  const held=holdVaultRead(f,blobs,file.id), pending=f.s.call('GET',link.path+'&n=0');await held.ready;
  if(change==='stop')assert.equal((await f.call('POST','/api/vault/link/stop',{link:link.id})).status,200);
  if(change==='expire')now+=3600000;
  if(change==='implement')assert.equal((await f.call('POST','/api/vault/implemented',{id:file.id,text:'integrated'})).status,200);
  if(change==='delete')assert.equal((await f.call('POST','/api/vault/delete',{id:file.id})).status,200);
  held.release();const result=await pending;assert.equal(result.status,404,JSON.stringify(result));assert.equal(result.data,undefined);
});
for(const raw of [false,true])test(`an authenticated ${raw?'raw':'JSON'} vault read rechecks operator rights after R2 returns`,async t=>{
  const blobs=vaultBucket(),f=await vaultFixture(t,{blobs}),file=await f.put('operator.txt','u:'+f.op.me.id);
  const held=holdVaultRead(f,blobs,file.id), pending=raw
    ? fetch(f.s.base+'/api/vault/chunk?id='+file.id+'&n=0&raw=1',{headers:{Authorization:'Bearer '+f.op.token}})
    : f.call('GET','/api/vault/chunk?id='+file.id+'&n=0',undefined,f.op);
  await held.ready;
  f.q('INSERT INTO ops_access(name_key,granted,at,by_id) VALUES(?,0,?,?) ON CONFLICT(name_key) DO UPDATE SET granted=0').run(f.op.me.name.toLowerCase(),Date.now(),f.dev.me.id);
  held.release();const result=await pending;
  assert.equal(result.status,403);if(!raw)assert.equal(result.data,undefined);
});
test('failed public piece reads do not consume its download allowance or successful-file count',async t=>{
  const blobs=vaultBucket(),f=await vaultFixture(t,{blobs}),file=await f.put();
  const link=await f.call('POST','/api/vault/link',{id:file.id,hours:1});blobs.data.clear();
  const r=await f.s.call('GET',link.path+'&n=0');assert.equal(r.status,404);
  assert.equal(f.q('SELECT bytes_used FROM vault_links').get().bytes_used,0);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM vault_link_files').get().n,0);
});
test('a successful public piece read still returns bytes and consumes exactly their size',async t=>{
  const blobs=vaultBucket(),f=await vaultFixture(t,{blobs}),file=await f.put(),link=await f.call('POST','/api/vault/link',{id:file.id,hours:1});
  const r=await f.s.call('GET',link.path+'&n=0');assert.equal(r.status,200);assert.ok(r.data);
  assert.equal(f.q('SELECT bytes_used FROM vault_links').get().bytes_used,file.size);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM vault_link_files').get().n,1);
});
