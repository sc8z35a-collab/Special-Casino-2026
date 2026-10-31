import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, shopSale, carBuyback, CARS } from '../core/rules.js';
const buy = (s,p,id,count=1,price) => s.call('POST','/api/shop/buy',{token:p.token,body:{id,count,...(price===undefined?{}:{price})}});
const equip = (s,p,car,engine) => s.call('POST','/api/cars/engine',{token:p.token,body:{car,engine}});
const insertCar = (s,p,fields={}) => {
  const id=Number(s.app.db.prepare('INSERT INTO cars(owner_id,model,created_at,acquired_at) VALUES(?,?,?,?)').run(p.me.id,'two-state-sedan',Date.now(),Date.now()).lastInsertRowid);
  for(const [key,value] of Object.entries(fields))s.app.db.prepare(`UPDATE cars SET ${key}=? WHERE id=?`).run(value,id);
  return id;
};
test('CAR SHOP prices are fixed across sale hours, charged per unit, and stock survives login refresh',async t=>{
 const s=await startServer();t.after(()=>s.stop());const p=await s.register('PartsBuyer');s.setUser(p.me.id,{dollars:40000000});
 const expected={'repair-kit':450000,'car-oil-medium':550000,'gasoline-full':25000,'engine-v1':2500000,'engine-v2':4800000,'engine-v3':8200000};
 let paid=0;
 for(const [id,price] of Object.entries(expected)){
  const item=RULES.shop.find(x=>x.id===id);
  for(let hour=0;hour<24;hour++)assert.equal(shopSale(item,Date.UTC(2026,9,24,hour)).price,price);
  const forged=await buy(s,p,id,1,1);assert.equal(forged.error.code,'price_changed');
  const result=await buy(s,p,id,2,price);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.paid,price*2);paid+=price*2;
 }
 const me=(await s.call('GET','/api/me',{token:p.token})).me;
 assert.equal(me.dollars,40000000-paid);for(const id of Object.keys(expected))assert.equal(me.items[id],2);
});
test('install, retry, swap and detach conserve engines without changing cash',async t=>{
 const s=await startServer();t.after(()=>s.stop());const p=await s.register('Mechanic');s.setUser(p.me.id,{dollars:10000000});const car=insertCar(s,p);
 await buy(s,p,'engine-v1');await buy(s,p,'engine-v2');
 let r=await equip(s,p,car,'engine-v1');assert.equal(r.status,200);assert.equal(r.car.engine,'engine-v1');assert.equal(r.me.items['engine-v1'],undefined);const cash=r.me.dollars;
 r=await equip(s,p,car,'engine-v1');assert.equal(r.status,200);assert.equal(r.me.dollars,cash);
 r=await equip(s,p,car,'engine-v2');assert.equal(r.me.items['engine-v1'],1);assert.equal(r.me.items['engine-v2'],undefined);
 r=await equip(s,p,car,null);assert.equal(r.car.engine,null);assert.equal(r.me.items['engine-v2'],1);assert.equal(r.me.dollars,cash);
});
test('engine installation enforces ownership, inventory and car locks without consuming stock',async t=>{
 const s=await startServer();t.after(()=>s.stop());const a=await s.register('Owner'),b=await s.register('Other');s.setUser(a.me.id,{dollars:10000000});
 const own=insertCar(s,a),other=insertCar(s,b);await buy(s,a,'engine-v3');
 for(const [car,engine,code] of [[other,'engine-v3','no_car'],[own,'engine-v2','insufficient'],[own,'repair-kit','bad_engine']])assert.equal((await equip(s,a,car,engine)).error.code,code);
 s.app.db.prepare('UPDATE cars SET rent_start=? WHERE id=?').run(Date.now(),own);assert.equal((await equip(s,a,own,'engine-v3')).error.code,'rented');
 s.app.db.prepare('UPDATE cars SET rent_start=0,offer_id=1 WHERE id=?').run(own);assert.equal((await equip(s,a,own,'engine-v3')).error.code,'on_offer');
 assert.equal((await s.call('GET','/api/items',{token:a.token})).items['engine-v3'],1);
});
test('buyback includes exactly 90 percent of the installed engine once and rejects forged quotes',async t=>{
 const s=await startServer();t.after(()=>s.stop());const p=await s.register('Seller');s.setUser(p.me.id,{dollars:10000000});
 const car=insertCar(s,p);await buy(s,p,'engine-v3');await equip(s,p,car,'engine-v3');
 const base=carBuyback(CARS.get('two-state-sedan')).price,quote=base+7380000;
 const garage=await s.call('GET','/api/cars',{token:p.token});assert.equal(garage.cars[0].buyback.price,quote);
 assert.equal((await s.call('POST','/api/cars/sell',{token:p.token,body:{car,price:base}})).error.code,'price_changed');
 const before=(await s.call('GET','/api/me',{token:p.token})).me.dollars;
 const sold=await s.call('POST','/api/cars/sell',{token:p.token,body:{car,price:quote}});assert.equal(sold.paid,quote);assert.equal(sold.me.dollars,before+quote);
 assert.equal((await s.call('POST','/api/cars/sell',{token:p.token,body:{car,price:quote}})).error.code,'no_car');
 assert.equal(sold.me.items['engine-v3'],undefined);
});
test('concurrent installs cannot duplicate one engine between two cars',async t=>{
 const s=await startServer();t.after(()=>s.stop());const p=await s.register('Concurrent');s.setUser(p.me.id,{dollars:10000000});
 const a=insertCar(s,p),b=insertCar(s,p);await buy(s,p,'engine-v1');
 const results=await Promise.all([equip(s,p,a,'engine-v1'),equip(s,p,b,'engine-v1')]);assert.equal(results.filter(r=>r.status===200).length,1);
 const cars=await s.call('GET','/api/cars',{token:p.token});assert.equal(cars.cars.filter(c=>c.engine==='engine-v1').length,1);
 assert.equal((await s.call('GET','/api/items',{token:p.token})).items['engine-v1'],undefined);
});
test('installed engines travel with gifted cars and only their new owner can detach them',async t=>{
 const s=await startServer();t.after(()=>s.stop());const a=await s.register('Sender'),b=await s.register('Receiver');
 await s.befriend(a,b);s.setUser(a.me.id,{dollars:10000000});const car=insertCar(s,a);
 await buy(s,a,'engine-v2');await equip(s,a,car,'engine-v2');
 const gift=await s.call('POST','/api/cars/gift',{token:a.token,body:{car,to:b.me.id}});assert.equal(gift.status,200);
 assert.equal((await s.call('POST','/api/messages/claim',{token:b.token,body:{message:gift.message.id}})).status,200);
 const garage=await s.call('GET','/api/cars',{token:b.token});assert.equal(garage.cars[0].engine,'engine-v2');
 assert.equal((await equip(s,a,car,null)).error.code,'no_car');
 const detached=await equip(s,b,car,null);assert.equal(detached.status,200);assert.equal(detached.me.items['engine-v2'],1);
});
test('a full inventory cannot swallow an engine during a detach or swap',async t=>{
 const s=await startServer();t.after(()=>s.stop());const p=await s.register('FullStock');s.setUser(p.me.id,{dollars:10000000});const car=insertCar(s,p);
 await buy(s,p,'engine-v1');await buy(s,p,'engine-v2');await equip(s,p,car,'engine-v1');
 s.app.db.prepare('INSERT OR REPLACE INTO items(user_id,item,count) VALUES(?,?,999)').run(p.me.id,'engine-v1');
 for(const next of [null,'engine-v2'])assert.equal((await equip(s,p,car,next)).error.code,'max');
 const garage=await s.call('GET','/api/cars',{token:p.token});assert.equal(garage.cars[0].engine,'engine-v1');
 assert.equal((await s.call('GET','/api/items',{token:p.token})).items['engine-v2'],1);
});
