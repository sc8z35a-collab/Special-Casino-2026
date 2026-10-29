import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uiFixture, flush } from './ui-fixture.js';
function scene({ permission='granted', holdFirst=false, open='', app=false }={}) {
  const ui=uiFixture(), calls=[], opens=[], users=[], notices=[], events={}; let owner=null,onMe,first=true,release,allow;
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/browser',toJSON:()=>({endpoint:sub.endpoint,keys:{}}),unsubscribe:()=>{calls.push(['native-unsubscribe',owner?.id]);return Promise.resolve();}};
  const reg={pushManager:{getSubscription:async()=>sub,subscribe:async()=>sub}};
  const serviceWorker={ready:Promise.resolve(reg),register:async()=>reg,addEventListener(){},getRegistration(){
    if(holdFirst&&first){first=false;return new Promise(resolve=>{release=()=>resolve(reg);});}return Promise.resolve(reg);
  }};
  ui.context.isSecureContext=true;ui.context.PushManager=function(){};ui.context.Notification={get permission(){return permission;},requestPermission:()=>new Promise(resolve=>{allow=p=>{permission=p;resolve(p);};})};
  ui.context.navigator.serviceWorker=serviceWorker;ui.context.location.search=open?'?open='+encodeURIComponent(open):'';ui.document.hidden=app;
  if(app)ui.context.TwoStateApp={notice:(...a)=>notices.push(a),notifyState:()=>permission,askNotify(){},notifyOff(){}};
  const api={online:true,hasToken:()=>!!owner,pushKey:async()=>({key:'AQID'}),pushSubscribe:async()=>calls.push(['subscribe',owner?.id]),
    pushUnsubscribe:async()=>calls.push(['unsubscribe',owner?.id]),user:id=>new Promise((resolve,reject)=>users.push({id,owner:owner?.id,resolve,reject}))};
  const BR={api,util:{$:ui.node,fmt:String},kit:{el:ui.el,fitOverlay(){},sfx(){},toast:t=>notices.push(t),clip:s=>s},
    social:{onMe:f=>{onMe=f;},open:v=>opens.push(v),openDm:u=>opens.push(u.id),openGroup:id=>opens.push(id)},
    live:{on:(e,f)=>{events[e]=f;},send:()=>true},launch:{done:()=>false,maintenance:()=>false},screens:{current:()=> 'slot'}};
  ui.context.BR=BR;vm.runInNewContext(fs.readFileSync(new URL('../../js/net/push.js',import.meta.url),'utf8'),ui.context);BR.push.init();
  const all=n=>[n,...n.children.flatMap(all)], root=()=>ui.document.body.children.find(n=>n.className==='ov push-ov');
  const button=text=>all(root()).find(n=>n.tagName==='BUTTON'&&n.textContent===text);
  return {...ui,BR,calls,opens,users,notices,events,root,button,profile:m=>{owner=m;onMe(m);},release:()=>release(),allow:p=>allow(p)};
}

test('logout notification cleanup cancels an earlier automatic subscription before it can subscribe again',async()=>{
  const s=scene({holdFirst:true});s.profile({id:1});await s.BR.push.forget();assert.deepEqual(s.calls,[['unsubscribe',1]]);
  s.release();await flush();assert.equal(s.calls.some(c=>c[0]==='subscribe'),false);
});
test('notification cleanup waiting for the browser cannot unsubscribe the account that replaced its owner',async()=>{
  const s=scene({permission:'default',holdFirst:true});s.profile({id:1});const old=s.BR.push.forget();
  s.profile({id:2});s.release();await old;assert.equal(s.calls.some(c=>c[0]==='unsubscribe'),false);
});
test('turning notifications off retires an older automatic subscription request',async()=>{
  const s=scene({holdFirst:true});s.profile({id:1});s.BR.push.settings();s.button('通知をオフにする').fire('click');await flush();
  s.release();await flush();assert.equal(s.calls.filter(c=>c[0]==='native-unsubscribe').length,1);assert.equal(s.calls.some(c=>c[0]==='subscribe'),false);
});
test('an old account subscription cannot make an extra registration after the replacement account has synced',async()=>{
  const s=scene({holdFirst:true});s.profile({id:1});s.profile({id:2});await flush();s.release();await flush();
  assert.deepEqual(s.calls.filter(c=>c[0]==='subscribe'),[['subscribe',2]]);
});
test('a permission answer from a closed dialog cannot close a newly opened settings dialog',async()=>{
  const s=scene({permission:'default'});s.profile({id:1});s.BR.push.settings();s.button('通知をオンにする').fire('click');
  s.button('閉じる').fire('click');s.BR.push.settings();const fresh=s.root();s.allow('granted');await flush();
  assert.equal(s.root(),fresh);assert.equal(s.calls.some(c=>c[0]==='subscribe'),false);
});
test('a notification user lookup failure from an old account cannot navigate the new account',async()=>{
  const s=scene({permission:'default'});s.profile({id:1});s.BR.push.openTarget('dm:7');s.profile({id:2});
  s.users[0].reject({code:'session_changed'});await flush();assert.deepEqual(s.opens,[]);
});
test('a delayed notification deep link belongs to its initial signed-in account',async()=>{
  const s=scene({permission:'default',open:'dm:7'});s.profile({id:1});const old=[...s.timers.values()].find(t=>t.ms===600);
  s.profile({id:2});old.fn();await flush();assert.equal(s.users.length,0);
});
test('native incoming-call suppression is cleared when changing accounts',()=>{
  const s=scene({app:true}), call={type:'home',from:{id:7,name:'Caller'},data:{op:'hello'}};
  s.profile({id:1});s.events.call(call);s.profile({id:2});s.events.call(call);assert.equal(s.notices.length,2);
});
test('normal permission acceptance subscribes once and repeated profile refreshes retain the current registration',async()=>{
  const s=scene({permission:'default'});s.profile({id:1});s.BR.push.settings();s.button('通知をオンにする').fire('click');s.allow('granted');await flush();
  assert.deepEqual(s.calls,[['subscribe',1]]);assert.equal(s.root(),undefined);s.profile({id:1});await flush();assert.equal(s.calls.length,1);
});
