/* Item tabs reuse the original controls and keep their DOM IDs unique. */
(function(){'use strict';window.createVaultTabs=function(){
 var nav=document.getElementById('vault-work-tabs'),panes=document.getElementById('vault-work-panes'),list=document.getElementById('vault-main'),entries={},active='list',serial=0;
 function draw(){nav.replaceChildren();[['list','一覧']].concat(Object.keys(entries).map(function(k){return[k,entries[k].title];})).forEach(function(item){
  var cell=document.createElement('span');cell.className='vault-work-tab';var b=document.createElement('button');b.type='button';b.textContent=item[1];b.setAttribute('role','tab');b.setAttribute('aria-selected',active===item[0]?'true':'false');b.tabIndex=active===item[0]?0:-1;
  var pane=item[0]==='list'?list:entries[item[0]].pane;b.id=pane.id+'-tab';b.setAttribute('aria-controls',pane.id);pane.setAttribute('aria-labelledby',b.id);b.addEventListener('click',function(){select(item[0]);});
  b.addEventListener('keydown',function(e){if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();var keys=['list'].concat(Object.keys(entries)),i=keys.indexOf(item[0]);select(keys[(i+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length]);nav.querySelector('[aria-selected="true"]').focus();});cell.appendChild(b);
  if(item[0]!=='list'){var x=document.createElement('button');x.type='button';x.textContent='×';x.className='vault-work-close';x.setAttribute('aria-label',item[1]+'を閉じる');x.addEventListener('click',function(){close(item[0]);});cell.appendChild(x);}nav.appendChild(cell);
 });}
 function select(key){if(key!=='list'&&!entries[key])key='list';if(active!==key&&entries[active]&&entries[active].hide)entries[active].hide();active=key;list.hidden=key!=='list';Object.keys(entries).forEach(function(k){entries[k].pane.hidden=k!==key;});if(entries[key]&&entries[key].show)entries[key].show(entries[key].pane);draw();}
 function open(key,title,options){if(!entries[key]){var pane=document.createElement('section');pane.id='vault-work-pane-'+(++serial);pane.className='vault-work-pane';pane.setAttribute('role','tabpanel');panes.appendChild(pane);entries[key]=Object.assign({pane:pane,title:title},options);}entries[key].title=title;select(key);return entries[key].pane;}
 function close(key){var entry=entries[key];if(!entry)return;if(active===key)select('list');delete entries[key];entry.pane.remove();if(entry.close)entry.close();draw();}
 return{open:open,close:close,refresh:function(){select(active);},render:function(key){if(active===key&&entries[key]&&entries[key].show)entries[key].show(entries[key].pane);},reset:function(){select('list');Object.keys(entries).forEach(close);},has:function(key){return!!entries[key];}};
};})();
