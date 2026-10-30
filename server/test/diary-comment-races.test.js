import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uiFixture, flush } from './ui-fixture.js';

function scene() {
  const ui=uiFixture(),feeds=[],comments=[],sends=[],errors=[];
  Object.defineProperty(ui.Element.prototype,'isConnected',{get(){return ui.document.body.contains(this);}});
  const deferred=(queue,args)=>new Promise((resolve,reject)=>queue.push({args,resolve,reject}));
  const root=ui.node('#developer-diary'),K={el:ui.el,fail:e=>errors.push(e.message),registerModal(){},showModal(){root.hidden=false;}};
  const BR={kit:K,util:{fmt:String},api:{online:true,hasToken:()=>true,
    diary:(...args)=>deferred(feeds,args),diaryComments:(...args)=>deferred(comments,args),diaryComment:(...args)=>deferred(sends,args),diaryRead:async()=>({})},
    live:{on(){},isConnected:()=>true}};
  ui.context.BR=BR;vm.runInNewContext(fs.readFileSync(new URL('../../js/ui/diary.js',import.meta.url),'utf8'),ui.context);BR.diary.init();
  const post={id:1,title:'Post',text:'Body',at:Date.now(),reward:0,likes:0,liked:false,bookmarked:false};
  async function open() {BR.diary.open();feeds.at(-1).resolve({posts:[post],more:false});await flush();return card();}
  function card() {const row=ui.node('#diary-list').children[0],form=row.children.find(n=>n.tagName==='FORM');return {row,form,input:form.children[0],submit:form.children[1],box:row.children.at(-1)};}
  const text=n=>[n.textContent,...n.children.map(text)].join(' ');
  return {...ui,BR,feeds,comments,sends,errors,post,open,card,text,close(){root.hidden=true;root.fire('closed');}};
}
test('an older diary comments read cannot erase a newer confirmed comment',async()=>{
  const s=scene(),c=await s.open();c.row.open=true;c.row.fire('toggle');
  c.input.value='fresh comment';c.form.fire('submit');s.sends[0].resolve({});await flush();
  s.comments[1].resolve({comments:[{id:1,text:'fresh comment',at:Date.now()}],more:false});await flush();
  s.comments[0].resolve({comments:[],more:false});await flush();assert.match(s.text(c.box),/fresh comment/);
});
test('diary comment success preserves a different draft typed while sending',async()=>{
  const s=scene(),c=await s.open();c.input.value='sent text';c.form.fire('submit');c.input.value='new unsent draft';c.input.fire('input');
  s.sends[0].resolve({});await flush();assert.equal(c.input.value,'new unsent draft');assert.equal(c.submit.disabled,false);
  s.node('#diary-refresh').fire('click');s.feeds[1].resolve({posts:[s.post],more:false});await flush();assert.equal(s.card().input.value,'new unsent draft');
});
test('repeat submit events cannot post the same diary comment twice while waiting',async()=>{
  const s=scene(),c=await s.open();c.input.value='once';c.form.fire('submit');c.form.fire('submit');assert.equal(s.sends.length,1);
});
test('retyping the same diary text while a send is pending still preserves that new draft',async()=>{
  const s=scene(),c=await s.open();c.input.value='same text';c.form.fire('submit');
  c.input.value='replacement';c.input.fire('input');c.input.value='same text';c.input.fire('input');s.sends[0].resolve({});await flush();
  assert.equal(c.input.value,'same text');
});
test('a failed diary comment from a closed form cannot interrupt a replacement diary',async()=>{
  const s=scene(),c=await s.open();c.input.value='old';c.form.fire('submit');s.close();await s.open();
  s.sends[0].reject(new Error('old send'));await flush();assert.deepEqual(s.errors,[]);
});
test('failed comments reads from discarded diary cards do not display stale errors',async()=>{
  const s=scene(),c=await s.open();c.row.open=true;c.row.fire('toggle');s.node('#diary-refresh').fire('click');
  s.feeds[1].resolve({posts:[s.post],more:false});await flush();s.comments[0].reject(new Error('old comments'));await flush();assert.deepEqual(s.errors,[]);
});
test('a current diary send clears the sent draft and loads the private comments normally',async()=>{
  const s=scene(),c=await s.open();c.input.value='normal';c.form.fire('submit');s.sends[0].resolve({});await flush();
  assert.equal(c.input.value,'');assert.equal(c.submit.disabled,false);assert.equal(s.comments.length,1);assert.equal(s.sends[0].args[1],'normal');
});
