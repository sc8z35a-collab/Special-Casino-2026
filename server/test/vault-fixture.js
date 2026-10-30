import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
export const vaultHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function vaultBucket() {
  const data = new Map();
  return { data,
    async get(key) { return data.get(key) || null; }, async head(key) { return data.get(key) || null; },
    async put(key, bytes, sha256, options={}) { if (options.onlyIfAbsent && data.has(key)) return false; data.set(key, { bytes: Buffer.from(bytes), sha256 }); return true; },
    async list(prefix) { return [...data].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, sha256: o.sha256 })); },
    async del(keys) { for (const key of keys) data.delete(key); }
  };
}
export async function vaultFixture(t, options={}) {
  const s = await startServer({ operators: ['taku', 'VaultOp'], vaultSnapshots: false, ...options });
  const releases=[]; t.after(async()=>{ releases.forEach(f=>f()); await s.stop(); });
  const dev=await s.register('taku'), op=await s.register('VaultOp'), code='987654321098';
  assert.equal((await s.call('POST','/api/ops/dev-code',{token:dev.token,body:{code}})).status,200);
  const opened=await s.call('POST','/api/vault/open',{token:dev.token,body:{code}}); assert.equal(opened.status,200);
  dev.ticket=opened.ticket;
  const call=(method,path,body,actor=dev)=>s.call(method,path,{token:actor.token,body,headers:actor.ticket?{'X-Vault-Ticket':actor.ticket}:{}});
  async function put(name='private.txt', space='') {
    const actor=space==='u:'+op.me.id?op:dev;
    const bytes=Buffer.from('private document bytes'), created=await call('POST','/api/vault/files',{name,size:bytes.length,type:'text/plain',space},actor);
    assert.equal(created.status,200,JSON.stringify(created));
    assert.equal((await call('POST','/api/vault/chunk',{id:created.file.id,n:0,data:bytes.toString('base64'),sha256:vaultHash(bytes)},actor)).status,200);
    const finished=await call('POST','/api/vault/finish',{id:created.file.id},actor);assert.equal(finished.status,200,JSON.stringify(finished));return finished.file;
  }
  return {s,dev,op,call,put,q:sql=>s.app.db.prepare(sql),cleanup:f=>releases.push(f)};
}
export function holdVaultRead(f, blobs, id) {
  let release, enter; const ready=new Promise(r=>{enter=r;}), gate=new Promise(r=>{release=r;}), original=blobs.get;
  blobs.get=async key=>{const value=await original(key);if(key.startsWith('vault/'+id+'/')){enter();await gate;}return value;};
  f.cleanup(release);return {ready,release};
}
