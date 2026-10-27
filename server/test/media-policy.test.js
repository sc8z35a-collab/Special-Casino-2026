import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function media(support = true) {
  const c = { window: {}, document: { createElement: () => ({ canPlayType: () => support ? 'probably' : '' }) }, Promise };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/core/media.js', import.meta.url), 'utf8'), c);
  return c.window.BR.media;
}
test('media selects supported codecs, preserves embedded sources and falls back on fetch/decode errors', async () => {
  const m = media(), calls = [];
  const bytes = async u => { calls.push(u); return u; };
  const decode = async u => { if (u.endsWith('.opus')) throw Error('unsupported decoder'); return 'decoded:' + u; };
  assert.equal(await m.audioSource('sounds/click.wav', bytes).decode(decode), 'decoded:sounds/click.wav');
  assert.deepEqual(calls, ['sounds/click.opus', 'sounds/click.wav']);
  assert.deepEqual(Array.from(m.candidates('video/title.mp4', 'video')), ['video/title.webm', 'video/title.mp4']);
  assert.deepEqual(Array.from(media(false).candidates('sounds/click.wav', 'audio')), ['sounds/click.wav']);
  assert.deepEqual(Array.from(m.candidates('data:audio/wav;base64,AAA', 'audio')), ['data:audio/wav;base64,AAA']);
  const fallback = m.audioSource('sounds/win.mp3', async u => { if (u.endsWith('.opus')) throw Error('HTTP 404'); return u; });
  assert.equal(await fallback.decode(async u => u), 'sounds/win.mp3');
});
test('Opus normal calls use silence suppression/FEC; Turbo and other media sections retain their policy', () => {
  const c = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('../../js/net/voice-sdp.js', import.meta.url), 'utf8'), c);
  const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;usedtx=0;stereo=1;useinbandfec=0\r\na=ptime:10\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=ptime:30\r\n';
  const normal = c.window.BR.voiceSdp(sdp, 64000, false, false);
  assert.match(normal, /usedtx=1/); assert.match(normal, /useinbandfec=1/); assert.match(normal, /maxaveragebitrate=64000/);
  assert.doesNotMatch(normal, /stereo=/); assert.match(normal, /a=ptime:20/); assert.match(normal, /m=video[^]*a=ptime:30/);
  const turbo = c.window.BR.voiceSdp(normal, 510000, true, true);
  for (const text of ['usedtx=0', 'stereo=1', 'cbr=1', 'a=ptime:10', 'maxaveragebitrate=510000']) assert.ok(turbo.includes(text));
  assert.equal(c.window.BR.voiceSdp('v=0\r\nm=audio 9 RTP/AVP 0', 64000), 'v=0\r\nm=audio 9 RTP/AVP 0');
});
