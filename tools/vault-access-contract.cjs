// Public-link accounting against real HTTP; no live account or bucket.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
exports.vaultAccessContract = async function (base) {
  const code='987654321098',bytes=Buffer.alloc(512*1024,37);let token='',ticket='';
  async function call(method,path,body,authenticated=true) {
    const headers={'Content-Type':'application/json','X-Device':crypto.randomBytes(16).toString('hex')};
    if(authenticated&&token)headers.Authorization='Bearer '+token;if(authenticated&&ticket)headers['X-Vault-Ticket']=ticket;
    const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return {...await r.json(),status:r.status};
  }
  const registered=await call('POST','/api/register',{name:'taku',password:'pass1234',avatar:'traveler-green'});assert.equal(registered.status,200,JSON.stringify(registered));token=registered.token;
  assert.equal((await call('POST','/api/ops/dev-code',{code})).status,200);
  async function unlock(){const r=await call('POST','/api/vault/open',{code});assert.equal(r.status,200);ticket=r.ticket;}
  await unlock();const created=await call('POST','/api/vault/files',{name:'recover.txt',size:bytes.length,type:'text/plain'});assert.equal(created.status,200);
  const id=created.file.id,sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal((await call('POST','/api/vault/chunk',{id,n:0,data:bytes.toString('base64'),sha256})).status,200);
  assert.equal((await call('POST','/api/vault/finish',{id})).status,200);
  const link=await call('POST','/api/vault/link',{id,hours:1,maxMb:1});assert.equal(link.status,200);
  async function usage(){const r=await call('GET','/api/vault/links');assert.equal(r.status,200);return r.links.find(l=>l.id===link.id).bytesUsed;}
  assert.equal(await usage(),0);
  for(let i=0;i<2;i++){const r=await call('GET',link.path+'&n=0',undefined,false);assert.equal(r.status,200);assert.equal(r.sha256,sha256);assert.deepEqual(Buffer.from(r.data,'base64'),bytes);}
  assert.equal(await usage(),2*bytes.length);
  const trace=[{label:'vault bytes remain downloadable with exact accounting',data:true}];
  const full=await call('GET',link.path+'&n=0',undefined,false);assert.equal(full.status,429,JSON.stringify(full));assert.equal(await usage(),2*bytes.length);
  trace.push({label:'exhausted vault links cannot spend beyond their allowance',data:true});
  assert.equal((await call('POST','/api/vault/link/stop',{link:link.id})).status,200);
  const stopped=await call('GET',link.path+'&n=0',undefined,false);assert.deepEqual([stopped.status,stopped.error?.code],[404,'no_link']);
  assert.equal(await usage(),2*bytes.length);trace.push({label:'stopped vault links cannot read or spend allowance',data:true});
  const comment=await call('POST','/api/vault/ai',{t:link.token,f:id,comment:'should not be saved'},false);assert.deepEqual([comment.status,comment.error?.code],[404,'no_link']);
  const notes=await call('GET','/api/vault/file?id='+id);assert.equal(notes.status,200);assert.equal(notes.file.notes.length,0);trace.push({label:'stopped vault links cannot add comments',data:true});return trace;
};
