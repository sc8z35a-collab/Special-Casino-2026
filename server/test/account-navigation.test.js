import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uiFixture, flush } from './ui-fixture.js';
function scene() {
  const ui=uiFixture(), requests=[], effects=[], discarded=[]; let token=false;
  const api={online:true,hasToken:()=>token,lastName:()=>'',rememberName(){},discardSession:t=>{discarded.push(t);return Promise.resolve();}};
  for(const name of ['nameCheck','register','login','loginCode','password','oauthRegister'])api[name]=()=>new Promise((resolve,reject)=>requests.push({name,resolve,reject}));
  const BR={api,util:{$:ui.node,$$:ui.all},kit:{nfkc:s=>String(s??'').normalize('NFKC'),fitOverlay(){},sfx(){},toast:t=>effects.push(['toast',t]),fail(){}},
    CONFIG:{defaultAvatar:'traveler-green'},resources:{ready:()=>true},app:{relayout(){}},avatars:{signupGrid(){}},
    social:{me:()=>({id:1,name:'Owner',hasPassword:true}),setMe:m=>effects.push(['setMe',m]),signIn:(t,m)=>{token=true;effects.push(['signIn',t,m.id]);},firstRun:()=>effects.push(['first'])},oauth:{clear(){},paint(){}}};
  ui.context.BR=BR;vm.runInNewContext(fs.readFileSync(new URL('../../js/ui/account.js',import.meta.url),'utf8'),ui.context);BR.account.init();
  function login(code=false){BR.account.open(code?'code-login':'login');ui.node(code?'#ov-code':'#ov-login-name').value=code?'ABCD-EFGH-JKLM-NPQR':'Owner';ui.node('#ov-login-pass').value='pass1234';ui.node(code?'#ov-code-login':'#ov-login').fire('submit');}
  async function avatar(){BR.account.open('register');ui.node('#ov-name').value='NewOwner';ui.node('#ov-pass').value='pass1234';ui.node('#ov-register').fire('submit');requests.at(-1).resolve({available:true});await flush();}
  return {...ui,BR,requests,effects,discarded,login,avatar};
}

test('a delayed name result cannot reopen the avatar step after signup was closed',async()=>{
  const s=scene();s.BR.account.open('register');s.node('#ov-name').value='OldName';s.node('#ov-pass').value='pass1234';s.node('#ov-register').fire('submit');
  s.BR.account.close();s.requests[0].resolve({available:true});await flush();assert.equal(s.BR.account.isOpen(),false);
});
test('editing a name to an invalid value retires the previous in-flight availability hint immediately',async()=>{
  const s=scene();s.BR.account.open('register');s.node('#ov-name').value='ValidName';s.node('#ov-name').fire('input');
  [...s.timers.values()].find(t=>t.ms===350).fn();s.node('#ov-name').value='!';s.node('#ov-name').fire('input');const message=s.node('#ov-name-hint').textContent;
  s.requests[0].resolve({available:true});await flush();assert.equal(s.node('#ov-name-hint').textContent,message);
});
for(const code of [false,true])test(`a closed ${code?'recovery-code':'password'} login cannot sign in or overwrite a replacement form`,async()=>{
  const s=scene();s.login(code);s.BR.account.close();s.BR.account.open('login');s.node('#ov-login-name').value='NextOwner';
  s.requests[0].resolve({token:'unused-login',me:{id:1,name:'Former',hasPassword:true}});await flush();
  assert.equal(s.effects.some(e=>e[0]==='signIn'),false);assert.equal(s.BR.account.isOpen(),true);assert.deepEqual(s.discarded,['unused-login']);
});
test('a signup completed after cancellation retains the account but retires its unused session and keeps recovery details hidden',async()=>{
  const s=scene();await s.avatar();s.node('#ov-create').fire('click');s.BR.account.close();
  s.requests.at(-1).resolve({token:'unused-signup',recoveryCode:'PRIVATE-CODE',me:{id:1,name:'Former'}});await flush();
  assert.equal(s.BR.account.isOpen(),false);assert.equal(s.effects.some(e=>e[0]==='signIn'),false);assert.deepEqual(s.discarded,['unused-signup']);
  assert.notEqual(s.node('#ov-code-value').textContent,'PRIVATE-CODE');
});
test('a closed password form cannot reopen itself with recovery information when the change completes',async()=>{
  const s=scene();s.BR.account.openPassword();s.node('#ov-pw-new').value='new-password';s.node('#ov-pw-current').value='pass1234';s.node('#ov-password').fire('submit');
  s.BR.account.close();s.requests[0].resolve({recoveryCode:'PRIVATE-CODE',me:{id:1}});await flush();assert.equal(s.BR.account.isOpen(),false);
});
test('canceling a required sign-in does not execute that old navigation after an unrelated later login',async()=>{
  const s=scene();let ran=0;s.BR.account.require(()=>ran++,'login');s.BR.account.close();s.login();
  s.requests[0].resolve({token:'current',me:{id:1,name:'Owner'}});await flush();assert.equal(ran,0);
});
test('an abandoned response cannot enable controls while a new signup lookup is still pending',async()=>{
  const s=scene();await s.avatar();s.BR.account.open('register');s.node('#ov-name').value='FirstName';s.node('#ov-register').fire('submit');const old=s.requests.at(-1);
  s.BR.account.close();s.BR.account.open('register');s.node('#ov-name').value='SecondName';s.node('#ov-register').fire('submit');
  old.resolve({available:true});await flush();assert.equal(s.node('#ov-create').disabled,true);
});
test('normal signup still presents its recovery code and runs the requested action exactly once on completion',async()=>{
  const s=scene();let ran=0;s.BR.account.require(()=>ran++,'register');s.node('#ov-name').value='NewOwner';s.node('#ov-pass').value='pass1234';s.node('#ov-register').fire('submit');
  s.requests[0].resolve({available:true});await flush();s.node('#ov-create').fire('click');s.requests[1].resolve({token:'fresh',recoveryCode:'NEW-CODE',me:{id:2,name:'NewOwner'}});await flush();
  assert.equal(s.node('#ov-code-value').textContent,'NEW-CODE');assert.equal(ran,0);s.node('#ov-done').fire('click');assert.equal(ran,1);assert.equal(s.BR.account.isOpen(),false);
});
