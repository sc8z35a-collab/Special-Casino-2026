// Real game UI with delayed decoded replies; accounts and microphone data are disposable.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const { startServer } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer(); let browser;
  try {
    const p = await s.register('WatchUI'), a = await s.register('WatchA'), b = await s.register('WatchB');
    s.setUser(p.me.id, { age_ok: 1, guide_done: 1 }); await s.befriend(p, a); await s.befriend(p, b);
    const liveA = await s.listen(a), liveB = await s.listen(b);
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true,
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['microphone'] });
    const page = await ctx.newPage(), errors = []; page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(token => {
      localStorage.setItem('blockbuster-reels/auth', token); Element.prototype.requestFullscreen = () => Promise.resolve();
      window.auditStreams = []; window.auditMicRequests = 0;
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { window.auditMicRequests++; return get(...args).then(stream => { window.auditStreams.push(stream); return stream; }); };
    }, p.token);
    await page.goto(s.base); await page.waitForFunction(() => BR.bank?.ready() && BR.live.isConnected());
    await page.evaluate(() => BR.screens.show('slot')); await page.waitForFunction(() => BR.screens.current() === 'slot');
    const watch = (friend, target, on) => s.call('POST', '/api/watch', { token: friend.token, body: { user: target, on } });
    assert.equal(await page.locator('script[src*="js/ui/watch.js"]').count(), 0, 'watching UI is not an eager startup dependency');
    assert.equal((await watch(a, p.me.id, true)).status, 200);
    await page.waitForFunction(() => !!BR.watch.reset && !document.getElementById('watched-by').hidden, null, { timeout: 10000 });
    assert.equal(await page.locator('script[src*="js/ui/watch.js"]').count(), 1);
    assert.ok((await page.locator('#watched-by').textContent()).includes('WatchA'));
    assert.equal((await watch(a, p.me.id, false)).status, 200); await page.waitForFunction(() => document.getElementById('watched-by').hidden);
    console.log('PASS the first incoming watcher loads the host controls once and is immediately visible');

    await page.evaluate(() => {
      window.auditWatchInflight = 0; window.auditVoiceInflight = 0;
      const watch = BR.api.watch, voice = BR.api.voice;
      BR.api.watch = function (id, on) {
        window.auditWatchInflight++;
        let result = watch(id, on);
        if (on && window.auditHoldWatch) {
          window.auditHoldWatch = false;
          result = result.then(reply => new Promise(resolve => { window.auditHeldWatch = () => { window.auditHeldWatch = null; resolve(reply); }; }));
        }
        return result.then(reply => { window.auditWatchInflight--; return reply; }, error => { window.auditWatchInflight--; throw error; });
      };
      BR.api.voice = function (id, on, since) {
        window.auditVoiceInflight++;
        let result = voice(id, on, since);
        if (on && window.auditHoldVoice) {
          window.auditHoldVoice = false;
          result = result.then(reply => new Promise(resolve => { window.auditHeldVoice = () => { window.auditHeldVoice = null; resolve(reply); }; }));
        }
        return result.then(reply => { window.auditVoiceInflight--; return reply; }, error => { window.auditVoiceInflight--; throw error; });
      };
    });
    const startHeld = async friend => {
      await page.evaluate(friend => { window.auditHoldWatch = true; BR.watch.start({ ...friend, online: true }); }, { id: friend.me.id, name: friend.me.name });
      await page.waitForFunction(() => !!window.auditHeldWatch);
    };
    const finishWatch = async () => {
      await page.evaluate(() => window.auditHeldWatch());
      await page.waitForFunction(() => window.auditWatchInflight === 0);
    };
    const membership = () => s.app.db.prepare('SELECT target_id FROM watchers WHERE watcher_id=?').get(p.me.id)?.target_id;
    await startHeld(a); await page.evaluate(() => { BR.watch.stop(false); BR.screens.show('other'); }); await finishWatch();
    assert.equal(await page.evaluate(() => BR.watch.active()), false); assert.equal(membership(), undefined);
    await page.waitForFunction(() => BR.screens.current() === 'other');
    console.log('PASS an ended pending watch cannot reopen or navigate over another screen');

    await startHeld(a);
    await page.evaluate(friend => { BR.watch.start({ ...friend, online: true }); }, { id: b.me.id, name: b.me.name });
    await finishWatch(); await page.waitForFunction(id => BR.watch.target()?.id === id, b.me.id);
    assert.equal(membership(), b.me.id);
    await page.evaluate(() => BR.watch.stop(false)); await page.waitForFunction(() => window.auditWatchInflight === 0);
    console.log('PASS the latest host wins in both the real UI and server membership');

    await startHeld(a);
    assert.equal((await s.call('POST', '/api/friends/remove', { token: a.token, body: { user: p.me.id } })).status, 200);
    await finishWatch(); assert.equal(await page.evaluate(() => BR.watch.active()), false); assert.equal(membership(), undefined);
    console.log('PASS a friendship revoked before the reply cannot restore a watch');

    assert.equal((await watch(b, p.me.id, true)).status, 200); await page.locator('#watched-by').waitFor({ state: 'visible' });
    await page.locator('#watched-by').click(); await page.locator('#home-panel').waitFor({ state: 'visible' });
    await page.evaluate(() => { window.auditHoldVoice = true; });
    await page.locator('#hp-list [data-voice="on"]').click(); await page.waitForFunction(() => !!window.auditHeldVoice);
    await page.evaluate(id => {
      BR.watch.endVoice();
      BR.call.syncHub(999, [{ id, name: 'WatchB' }]); BR.call.syncHub(0, []);
    }, b.me.id);
    assert.equal(await page.evaluate(() => BR.call.active()), false, 'hang-up clears the cached home immediately');
    await page.evaluate(() => window.auditHeldVoice()); await page.waitForFunction(() => window.auditVoiceInflight === 0);
    assert.equal(await page.evaluate(() => window.auditMicRequests), 0);
    assert.equal(await page.evaluate(() => BR.call.mic()), false);
    assert.equal(await page.evaluate(() => BR.call.active()), false);
    console.log('PASS a delayed grant after hang-up never requests or enables a microphone');

    await page.locator('#hp-list [data-voice="on"]').click(); await page.waitForFunction(() => BR.call.mic());
    assert.equal(await page.evaluate(() => window.auditMicRequests), 1);
    await page.evaluate(() => BR.watch.endVoice()); await page.waitForFunction(() => window.auditVoiceInflight === 0 && !BR.call.active());
    assert.equal(await page.evaluate(() => window.auditStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
    assert.deepEqual(errors, []);
    console.log('PASS ordinary consent captures the fake microphone once; hang-up stops every real media track');
    liveA.close(); liveB.close();
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
