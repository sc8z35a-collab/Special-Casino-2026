import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uiFixture, flush } from './ui-fixture.js';
function scene() {
  const ui=uiFixture(), resets=[], confirms=[], cleanups=[], reads=[], events={}, badges=[], effects=[]; let token='owner-token';
  const api={online:true,hasToken:()=>!!token,setToken:t=>{token=t;},restored:new Promise(()=>{}),on(){},me:()=>new Promise(()=>{}),
    logout:async()=>{effects.push(['logout',token]);},read:chat=>new Promise(resolve=>reads.push({chat,resolve}))};
  const reset=name=>()=>resets.push(name), noop=()=>{};
  const BR={api,util:{$:ui.node,$$:()=>[],fmt:String},store:{state:{}},CONFIG:{tokenPrice:1000,dailyLimit:100},clock:{every:noop},engine:{},
    kit:{el:ui.el,avatarEl:()=>ui.el('span'),addVip:noop,vipLevel:()=>0,badge:(n,v)=>badges.push([n.id,v]),registerModal:noop,dragScroll:noop,
      closeModals:noop,isOpen:()=>false,sfx:noop,toast:t=>effects.push(['toast',t]),fail:noop,confirmBox:()=>new Promise(resolve=>confirms.push(resolve))},
    app:{renderWallet:noop,renderBet:noop,relayout:noop},screens:{current:()=> 'slot',show:noop,tabs:()=>({}),register:noop},resources:{ready:()=>true},
    live:{close:noop,connect:noop,on:(e,f)=>{events[e]=f;},send:()=>false},
    quests:{reset:reset('quests'),setXp:noop,setReady:noop,setBonuses:noop},jobs:{reset:reset('jobs'),set:noop},
    tree:{reset:reset('tree')},gacha:{reset:reset('gacha')},lineReward:{reset:reset('lineReward')},bonus:{reset:reset('bonus'),show:noop,schedule:noop},
    call:{hangupAll:reset('call'),setBlocked:noop},watch:{reset:reset('watch')},lazy:{cancelPending:reset('lazy')},
    shop:{renderCharm:noop,setSale:noop},avatars:{setShop:noop},peter:{set:noop},johnson:{set:noop},official:{set:noop},news:{serverRelease:noop,checkRelease:noop},
    account:{invalidate:reset('account')},push:{forget:()=>new Promise(resolve=>cleanups.push(resolve))}};
  ui.context.BR=BR;vm.runInNewContext(fs.readFileSync(new URL('../../js/game/bank.js',import.meta.url),'utf8'),ui.context);
  // Expose the existing private handlers only in this VM, keeping production
  // source and callback bodies unchanged so queued work can be controlled.
  const source=fs.readFileSync(new URL('../../js/ui/social.js',import.meta.url),'utf8');
  assert.equal(source.split('  BR.social = {').length,2);
  vm.runInNewContext(source.replace('  BR.social = {','  BR.social = { auditLogout: logout, auditRead: markRead,'),ui.context);BR.social.init();
  const profile=(id=1,rev=10)=>({id,rev,name:'Owner'+id,xp:1000,coins:3,dollars:10000,tokens:1000,dailyReady:false,boughtToday:50,items:{},vip:{level:2}});
  BR.social.setMe(profile());
  return {...ui,BR,resets,confirms,cleanups,reads,events,badges,effects,profile,readToken:()=>token};
}

test('older full profiles and hello snapshots cannot restore the previous VIP, avatar or inventory',()=>{
  const s=scene(), latest={...s.profile(1,20),avatar:'new-avatar',items:{seed:2},vip:{level:3}};s.BR.social.setMe(latest);
  const old={...s.profile(1,19),avatar:'old-avatar',items:{},vip:{level:1}};s.BR.social.setMe(old);assert.equal(s.BR.social.me(),latest);
  s.events.hello({me:old});assert.equal(s.BR.social.me(),latest);assert.equal(s.BR.bank.me(),latest);
});
test('an unrelated account profile cannot replace the signed-in profile or its bank cache',()=>{
  const s=scene(), latest=s.BR.social.me();s.BR.social.setMe(s.profile(2,99));assert.equal(s.BR.social.me(),latest);assert.equal(s.BR.bank.me(),latest);
});
test('a valid same-account profile update with unchanged balance revision remains accepted',()=>{
  const s=scene(), update={...s.profile(),avatar:'changed-without-spending'};s.BR.social.setMe(update);assert.equal(s.BR.social.me(),update);
});
test('direct account switching resets quest levels and every cached account-specific screen before loading the new account',()=>{
  const s=scene(),callOwners=[];s.resets.length=0;const hangup=s.BR.call.hangupAll;
  s.BR.call.hangupAll=()=>{callOwners.push(s.readToken());hangup();};
  const next={...s.profile(2,1),xp:0};s.BR.social.signIn('next-token',next);
  assert.deepEqual(callOwners,['owner-token'],'end the previous call under its original account before replacing the token');
  for(const name of ['quests','jobs','tree','gacha','lineReward','watch','account'])assert.ok(s.resets.includes(name),name+' must not retain the old account');
  assert.equal(s.BR.social.me(),next);assert.equal(s.BR.bank.me(),next);assert.equal(s.BR.store.state.rev,1);
});
test('an old logout confirmation cannot start notification cleanup for a replacement account',async()=>{
  const s=scene();s.BR.social.auditLogout();s.BR.social.signIn('next-token',s.profile(2,1));s.confirms[0](true);await flush();assert.equal(s.cleanups.length,0);
});
test('logout cleanup completing after an account switch cannot log out the replacement account',async()=>{
  const s=scene();s.BR.social.auditLogout();s.confirms[0](true);await flush();assert.equal(s.cleanups.length,1);
  const next=s.profile(2,1);s.BR.social.signIn('next-token',next);s.cleanups[0]();await flush();
  assert.equal(s.effects.some(e=>e[0]==='logout'),false);assert.equal(s.BR.social.me(),next);
});
test('account switching cancels pending read receipts and does not mark the new account conversation as read',()=>{
  const s=scene();s.BR.social.auditRead('dm:7');s.BR.social.signIn('next-token',s.profile(2,1));assert.equal([...s.timers.values()].some(t=>t.ms===200),false);
});
test('a queued read response cannot restore the old account unread badge after switching',async()=>{
  const s=scene();s.BR.social.auditRead('dm:7');[...s.timers.values()].find(t=>t.ms===200).fn();s.reads[0].resolve({unread:99});
  s.BR.social.signIn('next-token',s.profile(2,1));await flush();assert.notEqual(s.badges.filter(x=>x[0]==='radio-badge').at(-1)[1],99);
});
test('a normal confirmed logout still cleans up and clears the active account',async()=>{
  const s=scene();s.BR.social.auditLogout();s.confirms[0](true);await flush();s.cleanups[0]();await flush();
  assert.equal(s.effects.filter(e=>e[0]==='logout').length,1);assert.equal(s.BR.social.me(),null);
});
