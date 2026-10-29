// Native WebRTC with synthetic microphones and local signalling only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const audioFlows = page => page.waitForFunction(async () => {
  const stats = [...(await auditPeers.at(-1).getStats()).values()];
  return ['inbound-rtp', 'outbound-rtp'].every(type => stats.some(s => s.type === type &&
    (s.kind || s.mediaType) === 'audio' && (type === 'inbound-rtp' ? s.packetsReceived : s.packetsSent) > 0));
});
(async () => {
  const { startServer } = await import(root + '/server/test/helpers.js');
  const s = await startServer(); let browser, pages = [], verified = false;
  try {
    const left = await s.register('VoiceLeft'), right = await s.register('VoiceRight');
    const members = [left.me, right.me].map(u => ({ id: u.id, name: u.name, avatar: u.avatar }));
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true,
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    pages = [await browser.newPage(), await browser.newPage()]; const players = [left.me, right.me], errors = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i], other = pages[1 - i], me = players[i];
      page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
      await page.context().grantPermissions(['microphone'], { origin: s.base });
      await page.exposeFunction('auditVoiceSend', async message => {
        assert.equal(message.to, players[1 - i].id);
        if (!other.isClosed()) await other.evaluate(event => window.auditVoiceDeliver(event), { from: me, type: message.type, data: message.data });
      });
      await page.goto(s.base + '/api/health');
      await page.evaluate(({ html, me }) => {
        const parsed = new DOMParser().parseFromString(html, 'text/html'); document.body.replaceChildren();
        for (const id of ['call-bar', 'call-vol-panel', 'call-audios']) if (!document.getElementById(id)) document.body.appendChild(document.importNode(parsed.getElementById(id), true));
        window.auditPeers = []; window.auditStreams = []; window.auditSignals = []; window.auditNativeErrors = [];
        const NativePeer = window.RTCPeerConnection, getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.RTCPeerConnection = function (...args) {
          const pc = new NativePeer(...args); auditPeers.push(pc);
          for (const method of ['createOffer', 'createAnswer', 'setLocalDescription', 'setRemoteDescription', 'addIceCandidate']) {
            const original = pc[method].bind(pc);
            pc[method] = (...args) => Promise.resolve(original(...args)).catch(e => { auditNativeErrors.push({ method, error: e.message }); throw e; });
          }
          return pc;
        };
        navigator.mediaDevices.getUserMedia = options => getMedia(options).then(stream => { auditStreams.push(stream); return stream; });
        const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text !== undefined) n.textContent = text; return n; };
        window.BR = { util: { $: selector => document.querySelector(selector) },
          kit: { el, avatarEl: user => el('span', 'avatar', user.name), sfx() {}, toast() {} },
          social: { me: () => me }, sfx: { duck() {}, callLevel: () => 100 },
          VIP: { boost: () => 0, tier: () => 0, now: () => 0, kbps: () => 128 },
          api: { online: true, iceServers: async () => ({ iceServers: [] }) },
          live: { on(name, fn) { if (name === 'call') window.auditVoiceDeliver = fn; if (name === 'block') window.auditBlockDeliver = fn; },
            send(message) { auditSignals.push(message); window.auditVoiceSend(message).catch(() => {}); return true; } } };
      }, { html: fs.readFileSync(root + '/index.html', 'utf8'), me });
      for (const file of ['voice-sdp.js', 'voice-quality.js', 'call.js']) await page.addScriptTag({ url: s.base + '/js/net/' + file });
      await page.evaluate(() => BR.call.init());
    }
    for (const page of pages) await page.evaluate(members => BR.call.syncHub(77, members), members);
    for (const page of pages) {
      await page.waitForFunction(() => BR.call.live());
      assert.equal(await page.evaluate(() => BR.call.mic()), false, 'joining must keep the microphone off');
      await page.locator('#call-mute').click(); await page.waitForFunction(() => BR.call.mic());
      await page.waitForFunction(async () => [...(await auditPeers.at(-1).getStats()).values()].some(s => s.type === 'outbound-rtp' && (s.kind || s.mediaType) === 'audio' && s.packetsSent > 0));
      assert.match(await page.evaluate(() => auditPeers.at(-1).localDescription.sdp), /maxaveragebitrate=128000/);
    }
    for (const page of pages) await audioFlows(page);
    const [a, b] = pages;
    await a.evaluate(peer => {
      const pc = auditPeers.at(-1); window.auditRetired = { track: pc.ontrack, ice: pc.onicecandidate, stream: document.querySelector('#call-audios audio').srcObject };
      auditVoiceDeliver({ from: peer, type: 'hub', data: { room: 77, op: 'hello' } });
    }, right.me);
    for (const page of pages) {
      await page.waitForFunction(() => auditPeers.length > 1 && BR.call.live());
      await audioFlows(page);
    }
    const guarded = await a.evaluate(async () => {
      const current = document.querySelector('#call-audios audio').srcObject;
      auditRetired.track({ streams: [auditRetired.stream] });
      auditRetired.ice({ candidate: { toJSON: () => ({ candidate: 'obsolete' }) } });
      await new Promise(resolve => setTimeout(resolve, 250));
      return { sameStream: document.querySelector('#call-audios audio').srcObject === current,
        obsoleteSignals: auditSignals.filter(s => (s.data.candidates || []).some(c => c.candidate === 'obsolete')).length };
    });
    assert.deepEqual(guarded, { sameStream: true, obsoleteSignals: 0 });
    await a.locator('#call-mute').click(); await a.waitForFunction(() => !BR.call.mic());
    assert.equal(await a.evaluate(() => auditStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
    for (const page of pages) {
      await page.evaluate(() => BR.call.leave());
      assert.equal(await page.locator('#call-audios audio').count(), 0);
      assert.equal(await page.evaluate(() => auditStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')) && auditPeers.every(p => p.connectionState === 'closed')), true);
    }
    for (const page of pages) await page.evaluate(members => BR.call.syncHub(88, members), members);
    for (const page of pages) { await page.waitForFunction(() => BR.call.live()); await page.locator('#call-mute').click(); await page.waitForFunction(() => BR.call.mic()); }
    for (const page of pages) await audioFlows(page);
    await a.evaluate(id => auditBlockDeliver({ user: id, blocked: true, rev: 5 }), right.me.id);
    await a.waitForFunction(() => !BR.call.active() && auditPeers.every(p => p.connectionState === 'closed'));
    assert.equal(await a.evaluate(() => auditStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
    assert.equal(await a.locator('#call-audios audio').count(), 0);
    await a.evaluate(members => BR.call.syncHub(88, members), members);
    assert.equal(await a.evaluate(() => BR.call.active()), false, 'a stale roster cannot rejoin a blocked peer');
    await b.evaluate(() => BR.call.hangupAll());
    console.log('PASS native block: established RTP peer closes, microphone tracks end and stale roster stays disconnected');
    assert.deepEqual(errors, []);
    verified = true;
    console.log('PASS native voice: bidirectional audio, Opus ceiling, reconnect, retired callbacks, microphone stop and complete peer/audio cleanup');
  } finally {
    if (!verified) for (const page of pages) if (!page.isClosed()) {
      try { console.error('VOICE STATE', await page.evaluate(() => ({
        active: window.BR?.call?.active(), live: window.BR?.call?.live(),
        peers: (window.auditPeers || []).map(p => ({ connection: p.connectionState, ice: p.iceConnectionState, gathering: p.iceGatheringState, local: p.localDescription?.type, remote: p.remoteDescription?.type })),
        signals: (window.auditSignals || []).map(s => ({ op: s.data.op, description: s.data.description?.type, candidates: s.data.candidates?.length })),
        errors: window.auditNativeErrors
      }))); } catch { /* a failed browser launch has no page */ }
    }
    if (browser) await browser.close(); await s.stop();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
