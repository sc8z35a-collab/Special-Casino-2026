/* Requires Playwright, Sharp and gltf-validator. BEFORE_ASSETS points to an
   unmodified img/3d copy when before/after visual comparisons are desired. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sharp = require('sharp'), validator = require('gltf-validator');
const ROOT = path.resolve(__dirname, '..');
const BEFORE = process.env.BEFORE_ASSETS;
const allRows = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/model-compression.json'))).models;
const range = (process.env.MODEL_RANGE || '0:42').split(':').map(Number);
const rows = allRows.slice(range[0], range[1]);
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'img/3d/auction/assets.json')));
const models = rows.map(r => ({ name: r.name, files: r.files, animations: r.animations, joints: r.joints }));
function fileAt(url) {
 const name = decodeURIComponent(new URL(url, 'http://x').pathname);
 if (name.startsWith('/before/')) return BEFORE && path.join(BEFORE, name.slice('/before/img/3d/'.length));
 return path.join(ROOT, name);
}
(async () => {
 let browser, server, game;
 const results = [];
 try {
  for (const row of rows) {
   const bytes = Buffer.concat(row.files.map(f => fs.readFileSync(path.join(ROOT, f))));
   assert.equal(bytes.length, row.after);
   const result = await validator.validateBytes(new Uint8Array(bytes), { uri: row.name, maxIssues: 10 });
   assert.equal(result.issues.numErrors, 0, row.name + ': ' + JSON.stringify(result.issues.messages));
  }
  for (const entry of Object.values(catalog)) assert.equal(entry.files.reduce((n, f) => n + fs.statSync(path.join(ROOT, 'img/3d/auction', f)).size, 0), entry.bytes);
  const imageReport = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/image-compression.json')));
  for (const image of imageReport.images) { const meta = await sharp(path.join(ROOT, image.path)).metadata(); assert.ok(meta.width > 0 && meta.height > 0); }
   console.log('PASS '+rows.length+' models validate, auction parts match, and all 200 runtime images decode');
  server = http.createServer((req, res) => {
   if (req.url === '/asset-check') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body style="margin:0"></body></html>'); return; }
   const p = fileAt(req.url); if (!p) { res.writeHead(404);res.end();return; }
   fs.readFile(p, (err, data) => { if(err) {res.writeHead(404);res.end();return; } res.setHeader('Content-Type', ({'.js':'text/javascript','.glb':'model/gltf-binary','.json':'application/json'})[path.extname(p)] || 'application/octet-stream');res.end(data); });
  }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless:true, args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport:{width:600,height:340} });
  page.setDefaultTimeout(30000);
  await page.goto(base+'/asset-check'); await page.addScriptTag({url:base+'/js/vendor/three-bundle.js'});
  await page.evaluate(() => {
   const T=window.BR3D;
   window.renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); renderer.setSize(192,192);renderer.setClearColor(0xdce5ef,1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
   const pm=new T.PMREMGenerator(renderer);window.environment=pm.fromScene(new T.RoomEnvironment(),.04).texture;pm.dispose();
  });
  const shots=process.env.ASSET_SCREENSHOTS; if(shots)fs.mkdirSync(shots,{recursive:true});
  for (const model of models) {
   const value = await page.evaluate(async ({model,before}) => {
    const T=window.BR3D;
    async function load(prefix) {
     const buffers=await Promise.all(model.files.map(async f=>{const r=await fetch(prefix+'/'+f);if(!r.ok)throw Error(f);return new Uint8Array(await r.arrayBuffer());}));
     const bytes=new Uint8Array(buffers.reduce((n,b)=>n+b.length,0));let off=0;buffers.forEach(b=>{bytes.set(b,off);off+=b.length;});
     return await new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder).parseAsync(bytes.buffer,location.origin+'/');
    }
    const after=await load(''), old=before?await load('/before'):after;
    const b=new T.Box3().setFromObject(old.scene), sphere=b.getBoundingSphere(new T.Sphere()), radius=sphere.radius||1;
    const next=new T.Box3().setFromObject(after.scene);
    const a=b.getSize(new T.Vector3()),c=next.getSize(new T.Vector3());
    const boundsDelta=Math.max(...['x','y','z'].map(k=>Math.abs(a[k]-c[k])/Math.max(radius,1e-6)));
    if(!Number.isFinite(boundsDelta))throw Error('Invalid bounds');
    const scene=new T.Scene();scene.environment=environment;scene.add(new T.HemisphereLight(0xffffff,0x555b66,2));const light=new T.DirectionalLight(0xffffff,3);light.position.set(4,7,8);scene.add(light);
    const camera=new T.PerspectiveCamera(35,1,radius/100,radius*100);camera.position.copy(sphere.center).add(new T.Vector3(1,.55,1).normalize().multiplyScalar(radius/Math.sin(17.5*Math.PI/180)*1.1));camera.lookAt(sphere.center);
    function render(g) {
     scene.add(g.scene); let mixer;
     if(g.animations.length) { mixer=new T.AnimationMixer(g.scene);const idle=g.animations.find(a=>a.name==='idle')||g.animations[0];mixer.clipAction(idle).play();mixer.update(Math.min(.7,idle.duration*.4)); }
     renderer.render(scene,camera);const png=renderer.domElement.toDataURL('image/png');
     // Exercise every named clip, including skinning, before disposing it.
     if(mixer)for(const clip of g.animations){mixer.stopAllAction();mixer.clipAction(clip).play();mixer.update(clip.duration*.5);renderer.render(scene,camera);} if(mixer)mixer.stopAllAction();
     scene.remove(g.scene);return png;
    }
    const reference=render(old),current=render(after);
    const clips=after.animations.map(a=>({name:a.name,channels:a.tracks.length,duration:a.duration}));
    function dispose(g) {g.scene.traverse(n=>{if(n.geometry)n.geometry.dispose();for(const m of [].concat(n.material||[])){for(const t of Object.values(m))if(t&&t.isTexture){t.source?.data?.close?.();t.dispose();}m.dispose();}});}
    dispose(old); if(old!==after)dispose(after);
    return {reference,current,boundsDelta,clips};
   },{model,before:!!BEFORE});
   const before=await sharp(Buffer.from(value.reference.split(',')[1],'base64')).removeAlpha().raw().toBuffer();
   const after=await sharp(Buffer.from(value.current.split(',')[1],'base64')).removeAlpha().raw().toBuffer();
   let delta=0;for(let i=0;i<before.length;i++)delta+=Math.abs(before[i]-after[i]);delta/=before.length*255;
   assert.ok(value.boundsDelta<.015,model.name+' bounds changed: '+value.boundsDelta);
   assert.ok(delta<.08,model.name+' render changed: '+delta);
   assert.deepEqual(value.clips.map(c=>c.name),model.animations.map(c=>c.name),model.name+' clip names');
   for(let i=0;i<value.clips.length;i++)assert.ok(Math.abs(value.clips[i].duration-model.animations[i].duration)<.001,model.name+' clip duration');
   if(shots) {
    const stem=model.name.replace(/[^a-z0-9.-]/gi,'_');
    fs.writeFileSync(path.join(shots,stem+'-before.png'),Buffer.from(value.reference.split(',')[1],'base64'));
    fs.writeFileSync(path.join(shots,stem+'-after.png'),Buffer.from(value.current.split(',')[1],'base64'));
   }
   results.push({name:model.name,boundsDelta:BEFORE?value.boundsDelta:null,meanPixelDelta:BEFORE?delta:null,clips:value.clips.length});console.log('PASS render '+model.name+(BEFORE?' ('+(delta*100).toFixed(2)+'% mean pixel delta)':' (render-only; no baseline)'));
  }
  await page.close();
  if (process.env.ASSET_MODELS_ONLY) {
   fs.writeFileSync(process.env.ASSET_VALIDATION_OUTPUT, JSON.stringify({models:results},null,2)+'\n'); return;
  }
  const { startServer }=await import('../server/test/helpers.js');game=await startServer();
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',userAgent:'Mozilla/5.0 Android TwoStateCasinoApp/1.0.12'});
  await context.addInitScript(()=>{window.TwoStateApp={versionCode:()=>112,clearWebCache:()=>{sessionStorage.setItem('native-cache-cleared','yes');}};sessionStorage.setItem('blockbuster-reels/reloaded',String(Date.now()));});
  const ui=await context.newPage();const errors=[];ui.on('pageerror',e=>errors.push(e.message));
  await ui.goto(game.base+'/'); await ui.waitForFunction(()=>window.BR&&BR.install&&Array.from(document.querySelectorAll('style')).some(s=>s.textContent.includes('#start-app.update{width:320px')));
  if(await ui.locator('#splash').isVisible())await ui.locator('#splash').click();
  await ui.locator('#splash').waitFor({state:'hidden'});
  await ui.evaluate(()=>BR.install.outdated());
  const update=ui.locator('#start-app');await update.waitFor({state:'visible'});
  const css=await update.evaluate(n=>({width:getComputedStyle(n).width,image:getComputedStyle(n).backgroundImage}));assert.equal(css.width,'320px');assert.match(css.image,/update.webp/);
  await ui.route('**/*_update=*', async route => {
   if (route.request().isNavigationRequest()) await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Updated game response</title>'});
   else await route.continue();
  });
  // The update control pulses continuously; a real pointer click does not
  // wait for its animation to become still, unlike Locator.click().
  const hit = await update.boundingBox();
  try { await Promise.all([ui.waitForURL(url=>url.searchParams.has('_update'), {waitUntil:'commit'}),ui.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2)]); }
  catch(e) { console.error({url:ui.url(),errors,cleared:await ui.evaluate(()=>sessionStorage.getItem('native-cache-cleared'))});throw e; }
  assert.equal(await ui.evaluate(()=>sessionStorage.getItem('native-cache-cleared')),'yes');
  console.log('PASS supplied larger update button performs a real update navigation in app mode');
  await ui.unroute('**/*_update=*'); await ui.goto(game.base+'/');
  const tierResults=await ui.evaluate(async()=>{
   await BR.resources.load('board');
   await new Promise(resolve=>{if(window.BR&&BR.UI_IMG)return resolve();const t=setInterval(()=>{if(window.BR&&BR.UI_IMG){clearInterval(t);resolve();}},20);});
   const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:999999;background:#34223e;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:24px;color:white';
   for(const tier of Object.keys(BR.UI_IMG.questTiers)) {const row=document.createElement('div');row.className='q-row t-'+tier;const label=document.createElement('b');label.textContent=tier;row.append(label);host.append(row);}
   document.body.append(host);
   const manifest=await fetch('/manifest.webmanifest').then(r=>r.json());
   for(const src of Object.values(BR.UI_IMG.questTiers).concat(manifest.icons.map(i=>i.src))){const im=new Image();im.src='/'+src;await im.decode();}
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return Array.from(host.children).map(n=>({alpha:getComputedStyle(n,'::before').opacity,label:getComputedStyle(n.firstChild).opacity,art:getComputedStyle(n,'::before').backgroundImage}));
  });assert.equal(tierResults.length,9);tierResults.forEach(r=>{assert.equal(r.alpha,'1');assert.equal(r.label,'1');assert.match(r.art,/quest-tiers/);assert.ok(!r.art.includes('/css/img/'));});assert.deepEqual(errors,[]);
  if(shots)await ui.screenshot({path:path.join(shots,'quest-tiers.png')});
  console.log('PASS nine opaque (darkened, nothing shows through) rarity images, fully opaque labels, and app icon decoding');
  if (process.env.ASSET_VALIDATION_OUTPUT || rows.length === allRows.length) {
   // A normal CI render check has no uncompressed baseline. Preserve the
   // reviewed historical evidence instead of replacing its deltas with zero.
   const output=process.env.ASSET_VALIDATION_OUTPUT || path.join(ROOT,'dist/asset-validation.json');
   fs.mkdirSync(path.dirname(output),{recursive:true});
   fs.writeFileSync(output,JSON.stringify({comparison:BEFORE?'before-after':'render-only',models:results,updateClick:true,tiers:9,modelErrors:0},null,2)+'\n');
  }
 } finally {if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(game)await game.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
