export const flush = async () => { for (let i=0; i<25; i++) await Promise.resolve(); };
export function uiFixture() {
  const nodes = new Map(), timers = new Map(); let sequence = 0;
  class Element {
    constructor(tag='div', cls='', text='') {
      this.tagName=tag.toUpperCase(); this.className=cls; this.text=text; this.children=[]; this.listeners={};
      this.hidden=true; this.value=''; this.disabled=false; this.dataset={}; this.style={ removeProperty(){}, setProperty(){} };
      const classes = new Set(); this.classList={add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},contains:x=>classes.has(x),toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x);}};
    }
    appendChild(n){n.parentNode=this;this.children.push(n);return n;}
    removeChild(n){this.children=this.children.filter(x=>x!==n);n.parentNode=null;}
    replaceChild(n,old){const i=this.children.indexOf(old);this.children[i]=n;n.parentNode=this;if(n.id)nodes.set('#'+n.id,n);return old;}
    replaceChildren(...ns){this.children=[];ns.forEach(n=>this.appendChild(n));}
    set textContent(t){this.text=t;this.children=[];}
    get textContent(){return this.text||'';}
    setAttribute(k,v){this[k]=v;}
    addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
    fire(k,e={}){for(const f of this.listeners[k]||[])f({preventDefault(){},target:this,...e});}
    contains(n){return n===this||this.children.some(c=>c.contains(n));}
    querySelector(s){return this.children.find(c=>s[0]==='.'?c.className.split(' ').includes(s.slice(1)):c.id===s.slice(1))||this.children.map(c=>c.querySelector(s)).find(Boolean)||null;}
    querySelectorAll(){return [];}
    blur(){} focus(){} scrollTo(){} remove(){this.parentNode?.removeChild(this);}
  }
  const body=new Element(); body.hidden=false;
  function node(s){if(!nodes.has(s)){const n=new Element();n.id=s.slice(1);nodes.set(s,n);body.appendChild(n);}return nodes.get(s);}
  const document={body,activeElement:null,documentElement:new Element(),createElement:t=>new Element(t),createTextNode:t=>new Element('span','',t),
    addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},getElementById:id=>node('#'+id)};
  const context={document,Promise,Date,console,location:{search:'',pathname:'/',protocol:'https:'},history:{replaceState(){}},navigator:{},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:()=>++sequence,clearInterval(){},addEventListener(){},Uint8Array,URLSearchParams};context.window=context;
  return {context,node,nodes,timers,Element,el:(tag,cls,text)=>new Element(tag,cls,text),all:s=>s.includes('button,')?[...nodes.values()]:[],document};
}
