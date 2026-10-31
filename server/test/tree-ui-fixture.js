import fs from 'node:fs';
import vm from 'node:vm';
import { RULES } from '../core/rules.js';
import { uiFixture, flush } from './ui-fixture.js';

export function treeScene() {
  const ui=uiFixture(),requests={},events={},screens={},balances=[],errors=[],effects=[],confirms=[];
  let screen='slot';
  Object.defineProperty(ui.Element.prototype,'firstChild',{get(){return this.children[0]||null;}});
  ui.Element.prototype.getAttribute=function(k){return this[k]??null;};
  function matches(n,s) {
    if(s[0]==='.')return s.slice(1).split('.').every(c=>n.className.split(' ').includes(c));
    if(s[0]==='#')return n.id===s.slice(1);
    const a=/^\[data-([\w-]+)="([^"]+)"\]$/.exec(s);
    if(a)return n.dataset[a[1]]===a[2];
    return n.tagName===s.toUpperCase();
  }
  ui.Element.prototype.closest=function(s){for(let n=this;n;n=n.parentNode)if(matches(n,s))return n;return null;};
  ui.Element.prototype.querySelectorAll=function(s){
    const [head,...tail]=s.split(' '),found=[];
    for(const n of this.children){if(matches(n,head))found.push(...(tail.length?n.querySelectorAll(tail.join(' ')):[n]));found.push(...n.querySelectorAll(s));}return found;
  };
  ui.Element.prototype.querySelector=function(s){return this.querySelectorAll(s)[0]||null;};
  const el=(tag,cls,text)=>{const n=ui.el(tag,cls,text);if(cls)n.classList.add(...cls.split(' '));return n;};
  const select=s=>{const [id,...tail]=s.split(' '),n=ui.node(id);return tail.length?n.querySelector(tail.join(' ')):n;};
  ui.document.querySelectorAll=s=>ui.document.body.querySelectorAll(s);
  ui.node('#tr-art').appendChild(el('img','tr-art-fallback'));
  const api={online:true};
  for(const name of ['trees','auction','treeGive','treeStart','treeHarvest','auctionStart','auctionBid','auctionLeave']){
    requests[name]=[];api[name]=(...args)=>new Promise((resolve,reject)=>requests[name].push({args,resolve,reject}));
  }
  const S={dollars:1000000000},K={el,sfx(){},toast(){},fail:e=>errors.push(e.message),badge(n,count){n.textContent=String(count);},
    icon:()=>el('i'),fmtTime:String,amountEl(n,c,cls){const row=el('b','amt '+(cls||''));row.appendChild(el('span','',String(n)));return row;},
    confirmBox:()=>new Promise(resolve=>confirms.push(resolve))};
  const BR={CONFIG:{tree:RULES.tree},SOCIAL_IMG:{tree:{stages:Array(9).fill('tree.webp'),seed:'seed.webp',preview:'preview.webp'}},kit:K,util:{$:select,fmt:String,clamp:(n,lo,hi)=>Math.min(hi,Math.max(lo,n))},store:{state:S},api,
    bank:{ready:()=>true},account:{require:f=>f()},app:{serverBalance:r=>{balances.push(r);S.dollars=r.dollars;}},
    live:{on:(name,fn)=>{events[name]=fn;}},clock:{every:()=>1,drop(){}},
    screens:{current:()=>screen,register:(name,handlers)=>{screens[name]=handlers;},show:name=>{screen=name;screens[name]?.open();},enter(){}},
    tree3d:{icon(){},pause(){},show(){},toss(){},zoom(){}},sfx:{},juice:{reward:(...args)=>effects.push(args)}};
  ui.context.BR=BR;
  for(const file of ['game/tree.js','ui/tree.js'])vm.runInNewContext(fs.readFileSync(new URL('../../js/'+file,import.meta.url),'utf8'),ui.context);
  BR.tree.init();
  const at=Date.now();
  function tree(id,changes={}){return {id,name:'Tree '+id,given:100000,rate:BR.TREE.rateOf(100000),stage:1,next:150000,cycle:null,grown:0,harvested:0,at,...changes};}
  function seed(rows=[tree(11),tree(12)]){events.hello({tree:{trees:rows,auction:null,now:at},now:at});}
  function choose(id){const b=el('button','tab');b.dataset.tab=String(id);ui.node('#tree-tabs').fire('click',{target:b});}
  function amount(value){BR.tree.setAmount(value);}
  function harvest(){const b=el('button');b.dataset.act='harvest';ui.node('#tr-harvest').fire('click',{target:b});}
  function start(){const b=el('button','start');b.dataset.cycle='30m';ui.node('#tr-harvest').fire('click',{target:b});}
  function auction(id,changes={}){return {id,status:'live',lot:{name:'Auction tree',stage:1},step:10000,price:100000,bids:[],bidders:[],participants:[],leader:null,
    startsAt:at-1000,closeIn:6000,closeMs:6000,nextChangeAt:at+1000,now:at+1,...changes};}
  function join(){const b=el('button','au-join');b.dataset.market='seed';ui.node('#auction-pane').fire('click',{target:b});}
  return {...ui,BR,S,requests,balances,errors,effects,confirms,at,tree,seed,choose,amount,harvest,start,auction,join,
    show(){BR.tree.open();},give(){ui.node('#tr-give').fire('click');},hide(){screen='slot';screens.tree.close();},
    async settle(name,i,result){requests[name][i].resolve(result);await flush();}};
}
