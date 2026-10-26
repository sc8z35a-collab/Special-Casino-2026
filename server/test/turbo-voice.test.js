import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

// an offer as a page sends it, asking the other one for TURBO VOICE's sound (js/net/call.js withBitrate)
const SDP = 'v=0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=510000;maxplaybackrate=48000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0\r\na=ptime:10\r\n';

test('TURBO VOICE: the developer\'s account alone — the server marks its pairs, and cuts what any other pair asks to a VIP\'s best', async () => {
  const s = await startServer({ operators: ['taku'] });
  try {
    const taku = await s.register('TAKU'), a = await s.register('Player1'), b = await s.register('Player2');
    await s.befriend(taku, a);
    await s.befriend(a, b);
    // the developer's own me says so; nobody else's
    assert.equal((await s.call('GET', '/api/me', { token: taku.token })).me.turbo, true);
    assert.equal((await s.call('GET', '/api/me', { token: a.token })).me.turbo, undefined);
    // a home each, with its voice on
    const home = async (host, guest) => {
      await s.call('POST', '/api/watch', { token: guest.token, body: { user: host.me.id, on: true } });
      await s.call('POST', '/api/watch/voice', { token: host.token, body: { user: guest.me.id, on: true } });
    };
    const offer = (from, to, room, turbo) => s.call('POST', '/api/call', { token: from.token, body: { to: to.me.id, type: 'home', callId: `home-${room}`,
      data: { room, op: 'signal', description: { type: 'offer', sdp: SDP }, candidates: [] }, turbo } });
    const fmtpOf = (sdp) => /a=fmtp:111 ([^\r\n]*)/.exec(sdp)[1].split(';');

    // the developer with a player: both ways as asked, and marked by the server
    await home(taku, a);
    const aLive = await s.listen(a), takuLive = await s.listen(taku);
    assert.equal((await offer(taku, a, taku.me.id)).status, 200);
    let got = await aLive.waitFor('call', (d) => d.data && d.data.op === 'signal');
    assert.equal(got.turbo, true);
    assert.equal(got.data.description.sdp, SDP, 'TURBO VOICE: passed along as it is');
    assert.equal((await offer(a, taku, taku.me.id)).status, 200);
    got = await takuLive.waitFor('call', (d) => d.data && d.data.op === 'signal');
    assert.equal(got.turbo, true, 'the player\'s side of the pair too');
    assert.ok(fmtpOf(got.data.description.sdp).includes('maxaveragebitrate=510000'));
    aLive.close(); takuLive.close();

    // two players, one of whom says it is TURBO: not marked, and what it asks is cut to a VIP's best
    await s.call('POST', '/api/watch', { token: a.token, body: { user: taku.me.id, on: false } });
    await home(a, b);
    const bLive = await s.listen(b);
    assert.equal((await offer(a, b, a.me.id, true)).status, 200);
    got = await bLive.waitFor('call', (d) => d.data && d.data.op === 'signal');
    assert.equal(got.turbo, undefined, 'only the server marks a pair');
    const params = fmtpOf(got.data.description.sdp);
    assert.ok(params.includes('maxaveragebitrate=256000'), params.join(';'));
    for (const no of ['stereo=1', 'sprop-stereo=1', 'cbr=1']) assert.ok(!params.includes(no), no);
    assert.ok(params.includes('minptime=10') && params.includes('useinbandfec=1'), 'the rest as it was');
    bLive.close();
  } finally { await s.stop(); }
});
