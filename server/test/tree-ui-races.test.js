import {test} from 'node:test';
import assert from 'node:assert/strict';
import {treeScene} from './tree-ui-fixture.js';
import {flush} from './ui-fixture.js';

function scene(rows){const s=treeScene();s.seed(rows?.(s));s.show();return s;}
const result=(s,id,extra={})=>({tree:s.tree(id,{at:s.at+100,...extra}),balance:{dollars:900000000,rev:2}});
test('queued tree gifts keep the tree selected for each tap',async()=>{
  const s=scene();s.give();s.choose(12);s.give();
  await s.settle('treeGive',0,result(s,11));assert.equal(s.requests.treeGive[1].args[0],12);
});
test('queued tree gifts keep their tapped amount when the amount changes later',async()=>{
  const s=scene(),initial=s.BR.TREE.rules.amounts[1];s.give();s.give();s.amount(s.BR.TREE.rules.amounts[2]);
  await s.settle('treeGive',0,result(s,11));assert.deepEqual(s.requests.treeGive[1].args,[11,initial]);
});
test('mixed gift amounts reserve their actual sum rather than multiplying the latest amount',async()=>{
  const s=scene(),[small,large]=s.BR.TREE.rules.amounts;s.S.dollars=small+large;s.amount(small);s.give();s.amount(large);s.give();
  await s.settle('treeGive',0,result(s,11));assert.equal(s.requests.treeGive.length,2);assert.deepEqual(s.requests.treeGive[1].args,[11,large]);
});
test('an older full tree list cannot undo a confirmed gift',async()=>{
  const s=scene();s.give();await s.settle('treeGive',0,result(s,11,{rate:9,given:500000}));
  await s.settle('trees',0,{trees:[s.tree(11),s.tree(12)],auction:null,now:s.at});assert.equal(s.node('#tr-rate').textContent,'9.00');
});
test('reset starts a fresh tree read while an old account read is pending',()=>{
  const s=scene();s.BR.tree.reset();s.seed([s.tree(21)]);s.show();assert.equal(s.requests.trees.length,2);
});
test('old tree gift success cannot change a replacement account or drain its queue',async()=>{
  const s=scene();s.give();s.give();s.BR.tree.reset();s.seed([s.tree(21)]);s.show();
  await s.settle('treeGive',0,result(s,11));assert.equal(s.balances.length,0);assert.equal(s.requests.treeGive.length,1);
  s.give();assert.equal(s.requests.treeGive.length,2);assert.equal(s.requests.treeGive[1].args[0],21);
});
test('old gift failure cannot cancel a replacement account gift queue',async()=>{
  const s=scene();s.give();s.BR.tree.reset();s.seed([s.tree(21)]);s.show();s.give();s.give();
  s.requests.treeGive[0].reject(new Error('old gift'));await flush();assert.deepEqual(s.errors,[]);
  assert.equal(s.requests.treeGive.length,2);await s.settle('treeGive',1,result(s,21));assert.equal(s.requests.treeGive.length,3);
});
test('an old cycle confirmation cannot start a tree in a replacement login',async()=>{
  const s=scene();s.start();s.BR.tree.reset();s.seed([s.tree(21)]);s.show();s.confirms[0](true);await flush();assert.equal(s.requests.treeStart.length,0);
});
test('cycle confirmation cannot submit twice while the first start is pending',async()=>{
  const s=scene();s.start();s.start();s.confirms[0](true);await flush();s.confirms[1](true);await flush();assert.equal(s.requests.treeStart.length,1);
});
for(const action of ['treeStart','treeHarvest'])test(`reset releases ${action} and ignores its old completion`,async()=>{
  const s=scene(x=>[x.tree(11,{cycle:action==='treeHarvest'?{id:'30m',at:x.at-1800001,end:x.at-1,mult:1}:null})]);
  if(action==='treeStart'){s.start();s.confirms[0](true);await flush();}else s.harvest();
  assert.equal(s.requests[action].length,1);s.BR.tree.reset();s.seed([s.tree(21)]);s.show();const count=s.confirms.length;s.start();
  assert.equal(s.confirms.length,count+1,'a replacement login can open its own cycle confirmation');s.confirms.at(-1)(true);await flush();
  assert.equal(s.requests.treeStart.length,action==='treeStart'?2:1);
  await s.settle(action,0,{...result(s,11),paid:9000});assert.equal(s.balances.length,0);assert.equal(s.effects.length,0);
});
test('a harvest completed after selecting another tree does not animate the other tree',async()=>{
  const s=scene(x=>[x.tree(11,{cycle:{id:'30m',at:x.at-1800001,end:x.at-1,mult:1}}),x.tree(12)]);
  s.harvest();s.choose(12);await s.settle('treeHarvest',0,{...result(s,11),paid:9000});assert.equal(s.effects.length,0);assert.equal(s.balances.length,1);
});
test('tree growth completed after switching trees does not animate the replacement tree',async()=>{
  const s=scene();s.give();s.choose(12);await s.settle('treeGive',0,result(s,11,{given:150000,stage:2,rate:7}));
  assert.equal(s.effects.length,0);assert.equal(s.balances.length,1);
});
test('a current gift still updates its tree, balance and next queued tap',async()=>{
  const s=scene();s.give();s.give();await s.settle('treeGive',0,result(s,11,{given:500000,rate:9}));
  assert.equal(s.balances.length,1);assert.equal(s.node('#tr-rate').textContent,'9.00');assert.equal(s.requests.treeGive.length,2);
});
test('a late empty auction read cannot erase the auction just joined',async()=>{
  const s=scene();s.choose('auction');s.join();await s.settle('auctionStart',0,{auction:s.auction(1)});
  assert.ok(s.node('#auction-pane').querySelector('.au-live'));
  await s.settle('auction',1,{auction:null,balance:{dollars:1}});assert.ok(s.node('#auction-pane').querySelector('.au-live'));assert.equal(s.balances.length,0);
});
test('old auction reads cannot apply their balance after an account reset',async()=>{
  const s=scene();s.BR.tree.reset();s.seed([s.tree(21)]);s.show();
  await s.settle('auction',0,{auction:null,balance:{dollars:1}});assert.equal(s.balances.length,0);
});
test('reset releases a joining auction and ignores its old response',async()=>{
  const s=scene();s.choose('auction');s.join();s.BR.tree.reset();s.seed([s.tree(21)]);s.show();s.choose('auction');s.join();
  assert.equal(s.requests.auctionStart.length,2);await s.settle('auctionStart',0,{auction:s.auction(1)});assert.equal(s.node('#auction-pane').querySelector('.au-live'),null);
});
test('a canceled tree screen cannot approve its old cycle confirmation',async()=>{
  const s=scene();s.start();s.hide();s.confirms[0](true);await flush();assert.equal(s.requests.treeStart.length,0);
});
test('a newer authoritative tree list still reconciles after a local gift',async()=>{
  const s=scene();s.give();await s.settle('treeGive',0,result(s,11,{rate:9,given:500000}));
  await s.settle('trees',0,{trees:[s.tree(11,{at:s.at+200,given:1500000,rate:10})],auction:null,now:s.at+200});assert.equal(s.node('#tr-rate').textContent,'10.00');
});
