/* Sound effects: the supplied recordings (sounds/) for clicks, the SPIN
   button, the turning reels, wins and money (coins jingling whenever money
   comes in, a cash register at the till, coins sent away); everything else
   is synthesised with WebAudio. The synthesised versions also stand in until
   the recordings are decoded. Every sound plays from the start: the sound
   button on the slot screen only changes its own look. */
(function (BR) {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, comp = null, verb = null, verbIn = null;
  var muted = false, unlocked = false;
  // during a voice call phones play everything louder: the game's own sounds step back
  var ducked = false, DUCK = 0.3;
  function masterLevel() { return muted ? 0 : ducked ? 0.8 * DUCK : 0.8; }
  var noiseBuf = null;
  var reelLoop = null;
  var feverOn = false;   // FEVER (js/render/combo.js): the reels run faster

  /* ------------------------------------------------------------ recordings --- */
  var RECORDINGS = {
    click: 'sounds/click.wav',
    spin: 'sounds/spin-button.wav',
    reels: 'sounds/reels.wav',      // two tick cycles, cut to loop seamlessly
    win: 'sounds/win.mp3',
    money: 'sounds/money.mp3',      // お金がジャラジャラ: money coming in
    register: 'sounds/register.mp3',
    registerHigh: 'sounds/register-high.mp3',
    coins: 'sounds/coins.mp3'
  };
  // (money a little louder than the rest)
  var LEVEL = { click: 0.7, spin: 1, reels: 0.6, win: 0.9, money: 1.15, register: 0.85, registerHigh: 0.8, coins: 0.8 };
  var quietCoins = 0;   // while the coins recording plays, the made-up clinks keep still
  var raw = {}, buffers = {}, winVoice = null;

  function bytes(url) {
    var m = /^data:[^,]*;base64,(.*)$/.exec(url);   // single-file build
    if (m) {
      var bin = atob(m[1]), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return Promise.resolve(out.buffer);
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    });
  }
  // fetched right away, decoded once the audio context exists
  Object.keys(RECORDINGS).forEach(function (k) {
    raw[k] = bytes(RECORDINGS[k]);
    raw[k].catch(function () { /* the synthesised sound is used instead */ });
  });

  function decode(ab) {
    return new Promise(function (resolve, reject) {
      var p = ctx.decodeAudioData(ab, resolve, reject);   // callback form for older Safari
      if (p && p.then) p.then(resolve, reject);
    });
  }

  function decodeRecordings() {
    Object.keys(raw).forEach(function (k) {
      raw[k].then(decode).then(function (b) { buffers[k] = b; }, function () { /* keep the synthesised sound */ });
    });
    if (music.bytes && !music.loading) musicLoad();
  }

  /* ------------------------------------------------------------ title music --- */
  // Loops without a gap, quieter than the effects and outside their
  // compressor; it fades out when the title screen is left and picks up
  // where it stopped when it comes back.
  var MUSIC_LEVEL = 0.32;
  var music = { url: null, bytes: null, loading: null, buf: null, src: null, gain: null, want: false, offset: 0, started: 0 };

  function musicLoad() {
    music.loading = music.bytes.then(decode).then(function (b) {
      music.buf = b;
      musicStart();
    }, function () { /* no music */ });
  }
  function musicStart() {
    if (!ctx || ctx.state !== 'running' || !music.want || music.src || !music.buf) return;
    var t = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, t + 1.4);
    g.connect(ctx.destination);
    var src = ctx.createBufferSource();
    src.buffer = music.buf;
    src.loop = true;
    src.connect(g);
    var at = music.offset % music.buf.duration;
    src.start(t, at);
    music.started = t - at;
    music.src = src;
    music.gain = g;
  }
  function musicStop(fade) {
    if (!music.src) return;
    var t = ctx.currentTime, src = music.src, g = music.gain;
    music.offset = (t - music.started) % music.buf.duration;
    music.src = music.gain = null;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    try { src.stop(t + fade + 0.05); } catch (e) { /* stopped */ }
  }

  /* ------------------------------------------------------------ voices --- */
  var voices = {};   // url -> Promise<AudioBuffer>
  var voiceNow = null;
  function voiceBuffer(url) {
    if (!voices[url]) {
      voices[url] = bytes(url).then(decode);
      voices[url].catch(function () { delete voices[url]; });
    }
    return voices[url];
  }

  // Plays a decoded recording; null while it is not available.
  function sample(name, t, o) {
    var b = buffers[name];
    if (!b) return null;
    o = o || {};
    var src = ctx.createBufferSource();
    src.buffer = b;
    if (o.rate) src.playbackRate.value = o.rate;
    var g = ctx.createGain();
    g.gain.value = LEVEL[name] * (o.gain || 1);
    src.connect(g);
    g.connect(comp);
    src.start(t);
    return { src: src, g: g };
  }

  function fadeOut(voice, t, d) {
    try {
      voice.g.gain.cancelScheduledValues(t);
      voice.g.gain.setValueAtTime(voice.g.gain.value, t);
      voice.g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      voice.src.stop(t + d + 0.02);
    } catch (e) { /* already stopped */ }
  }

  // The win recording: one at a time, cut short when the next spin starts.
  function winSample(t) {
    if (winVoice) fadeOut(winVoice, t, 0.12);
    winVoice = sample('win', t);
    return winVoice;
  }

  function init() {
    if (ctx || !AC) return;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = masterLevel();
    comp.connect(master);
    master.connect(ctx.destination);
    // small hall reverb from a generated impulse response
    verb = ctx.createConvolver();
    verb.buffer = impulse(1.8, 2.6);
    verbIn = ctx.createGain();
    verbIn.gain.value = 0.32;
    verbIn.connect(verb);
    verb.connect(comp);
    noiseBuf = makeNoise(2);
    decodeRecordings();
  }

  function impulse(sec, decay) {
    var len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function makeNoise(sec) {
    var len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function out(wet) {
    var g = ctx.createGain();
    g.connect(comp);
    if (wet) { var s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(verbIn); }
    return g;
  }

  // enveloped oscillator
  function tone(o) {
    var t = o.t || ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.d));
    if (o.detune) osc.detune.value = o.detune;
    var g = ctx.createGain();
    var a = o.a || 0.004, d = o.d || 0.2, v = o.v || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    if (o.hold) g.gain.setValueAtTime(v, t + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + (o.hold || 0) + d);
    var node = g;
    if (o.lp) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + a + (o.hold || 0) + d);
      f.Q.value = o.q || 0.8;
      g.connect(f);
      node = f;
    }
    osc.connect(g);
    node.connect(o.dest || out(o.wet));
    osc.start(t);
    osc.stop(t + a + (o.hold || 0) + d + 0.05);
    return osc;
  }

  // filtered noise burst
  function noise(o) {
    var t = o.t || ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.ftype || 'bandpass';
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.d || 0.2));
    f.Q.value = o.q || 1;
    var g = ctx.createGain();
    var a = o.a || 0.002, d = o.d || 0.1, v = o.v || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f); f.connect(g); g.connect(o.dest || out(o.wet));
    var off = Math.random() * 1.5;
    src.start(t, off, a + d + 0.05);
  }

  // metallic bell (simple FM)
  function bell(f, t, v, d, wet) {
    var car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.51;
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + d);
    mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    car.connect(g); g.connect(out(wet === undefined ? 0.5 : wet));
    car.start(t); mod.start(t);
    car.stop(t + d + 0.05); mod.stop(t + d + 0.05);
  }

  function coin(t, p, v) {
    var base = 2300 + (p || 0) * 1400;
    tone({ t: t, f: base, d: 0.09, v: (v || 0.12), type: 'sine', wet: 0.2 });
    tone({ t: t + 0.012, f: base * 1.5, d: 0.07, v: (v || 0.12) * 0.7, type: 'sine', wet: 0.2 });
    noise({ t: t, f: 7000, q: 2, d: 0.03, v: 0.05 });
  }

  // a struck coin (チャリン): the inharmonic partials of a thin metal disc
  // ringing out fast over the click of the hit, a little different each time
  function clink(t, f, v) {
    [[1, 1, 0.16], [2.76, 0.55, 0.1], [5.4, 0.28, 0.06]].forEach(function (k) {
      tone({ t: t, f: f * k[0] * (0.995 + Math.random() * 0.01), d: k[2] * (0.75 + Math.random() * 0.5), v: v * k[1], type: 'sine', wet: 0.22 });
    });
    noise({ t: t, ftype: 'highpass', f: 6500, q: 0.7, d: 0.018, v: v * 0.7 });
    noise({ t: t + 0.002, ftype: 'bandpass', f: f * 1.9, q: 9, d: 0.05, v: v * 0.35 });
  }

  // brass-ish chord stab
  function brass(freqs, t, dur, v) {
    freqs.forEach(function (f, i) {
      [-7, 7].forEach(function (det) {
        tone({ t: t, f: f, type: 'sawtooth', detune: det, a: 0.03, hold: dur * 0.6, d: dur * 0.6, v: v / freqs.length, lp: 900 + i * 200, lp2: 3200, q: 1.2, wet: 0.35 });
      });
    });
  }

  function cymbal(t, v, d) {
    noise({ t: t, ftype: 'highpass', f: 5000, q: 0.5, a: 0.004, d: d || 1.6, v: v || 0.18, wet: 0.4 });
    noise({ t: t, ftype: 'bandpass', f: 9000, q: 1.5, a: 0.002, d: (d || 1.6) * 0.6, v: (v || 0.18) * 0.6 });
  }

  function timpani(t, f, v) {
    tone({ t: t, f: f * 1.6, f2: f, glide: 0.08, d: 0.9, v: v || 0.5, type: 'sine', wet: 0.3 });
    noise({ t: t, ftype: 'lowpass', f: 600, d: 0.25, v: (v || 0.5) * 0.3 });
  }

  var N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

  var SOUNDS = {
    click: function (t) {
      if (sample('click', t)) return;
      tone({ t: t, f: 1800, f2: 1200, d: 0.05, v: 0.12, type: 'triangle' });
      noise({ t: t, f: 4000, q: 3, d: 0.02, v: 0.06 });
    },
    slider: function (t) { tone({ t: t, f: 2600, d: 0.025, v: 0.04, type: 'sine' }); },
    // the click, pitched a little up / down
    betUp: function (t) {
      if (sample('click', t, { rate: 1.08 })) return;
      tone({ t: t, f: 660, d: 0.07, v: 0.12, type: 'triangle' }); tone({ t: t + 0.06, f: 990, d: 0.09, v: 0.12, type: 'triangle' });
    },
    betDown: function (t) {
      if (sample('click', t, { rate: 0.93 })) return;
      tone({ t: t, f: 990, d: 0.07, v: 0.12, type: 'triangle' }); tone({ t: t + 0.06, f: 660, d: 0.09, v: 0.12, type: 'triangle' });
    },
    deny: function (t) { tone({ t: t, f: 140, d: 0.22, v: 0.18, type: 'square', lp: 600 }); tone({ t: t + 0.12, f: 110, d: 0.25, v: 0.16, type: 'square', lp: 500 }); },
    spinStart: function (t) {
      if (winVoice) { fadeOut(winVoice, t, 0.15); winVoice = null; }
      if (sample('spin', t)) return;
      noise({ t: t, ftype: 'bandpass', f: 400, f2: 2400, q: 1.2, a: 0.02, d: 0.28, v: 0.22 });
      tone({ t: t, f: 120, f2: 70, d: 0.14, v: 0.3, type: 'sine' });
      noise({ t: t + 0.01, ftype: 'lowpass', f: 1200, d: 0.06, v: 0.2 });
    },
    reelStop: function (t, i) {
      var k = i || 0;
      tone({ t: t, f: 150 - k * 6, f2: 55, glide: 0.12, d: 0.16, v: 0.42, type: 'sine' });
      noise({ t: t, ftype: 'lowpass', f: 1800, d: 0.05, v: 0.3 });
      noise({ t: t + 0.004, ftype: 'bandpass', f: 3200 + k * 150, q: 6, d: 0.06, v: 0.08 });
    },
    anticipate: function (t) {
      var o = tone({ t: t, f: 220, f2: 880, glide: 1.25, a: 0.05, hold: 1.0, d: 0.25, v: 0.12, type: 'sawtooth', lp: 900, lp2: 4000, wet: 0.3 });
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 9; lg.gain.value = 18;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t); lfo.stop(t + 1.4);
      tone({ t: t, f: 110, f2: 220, glide: 1.25, a: 0.05, hold: 1.0, d: 0.25, v: 0.12, type: 'triangle' });
    },
    // wins: the recording, with drum hits (no pitched parts to clash) for the big ones
    win: function (t) {
      if (winSample(t)) return;
      [N.C6, N.E6, N.G6, N.C7].forEach(function (f, i) { bell(f, t + i * 0.075, 0.1, 0.7); });
      coin(t + 0.32, 0.5, 0.1);
    },
    bigWin: function (t) {
      if (winSample(t)) {
        timpani(t, 98, 0.5);
        cymbal(t + 0.02, 0.12, 1.8);
        return;
      }
      timpani(t, 98, 0.55);
      brass([N.C4, N.E4, N.G4], t, 0.16, 0.5);
      brass([N.C4, N.E4, N.G4], t + 0.18, 0.12, 0.45);
      brass([N.D4, N.F4, N.A4], t + 0.33, 0.12, 0.45);
      brass([N.E4, N.G4, N.C5], t + 0.5, 0.75, 0.6);
      cymbal(t + 0.5, 0.16, 2.0);
      timpani(t + 0.5, 131, 0.5);
      [N.C6, N.E6, N.G6, N.C7].forEach(function (f, i) { bell(f, t + 0.55 + i * 0.06, 0.07, 1.2); });
    },
    superWin: function (t) {
      if (winSample(t)) {
        timpani(t, 82, 0.65);
        timpani(t + 0.42, 131, 0.5);
        cymbal(t, 0.2, 2.4);
        for (var k = 0; k < 10; k++) coin(t + 0.45 + k * 0.05, k / 10, 0.07);
        return;
      }
      timpani(t, 82, 0.7);
      cymbal(t, 0.22, 2.6);
      brass([N.G4, N.B4, N.D5], t, 0.18, 0.55);
      brass([N.A4, N.C5, N.E5], t + 0.2, 0.18, 0.55);
      brass([N.C5, N.E5, N.G5], t + 0.42, 1.1, 0.7);
      timpani(t + 0.42, 131, 0.6);
      for (var i = 0; i < 10; i++) coin(t + 0.45 + i * 0.05, i / 10, 0.09);
      [N.C6, N.E6, N.G6, N.C7, N.G6, N.C7].forEach(function (f, i) { bell(f, t + 0.45 + i * 0.07, 0.07, 1.4); });
    },
    // the win recording already carries the count-up
    tick: function (t, p) { if (!buffers.win) coin(t, p || 0, 0.07); },
    countEnd: function (t, tier) {
      if (buffers.win) {
        cymbal(t, tier >= 2 ? 0.14 : 0.07, 1.4);
        coin(t + 0.05, 1, 0.08);
        return;
      }
      if (tier >= 2) {
        brass([N.C5, N.E5, N.G5], t, 0.5, 0.45);
        cymbal(t, 0.14, 1.6);
      }
      bell(N.C7, t, 0.1, 1.2);
      bell(N.G6, t + 0.05, 0.08, 1.2);
      coin(t + 0.1, 1, 0.1);
    },
    firework: function (t) {
      noise({ t: t, ftype: 'lowpass', f: 900, a: 0.005, d: 0.5, v: 0.28, wet: 0.5 });
      for (var i = 0; i < 9; i++) noise({ t: t + 0.12 + Math.random() * 0.6, ftype: 'highpass', f: 3000, d: 0.02, v: 0.06 + Math.random() * 0.05 });
    },
    purchase: function (t) {
      bell(N.E6, t, 0.12, 0.9);
      bell(N.C7, t + 0.09, 0.12, 1.1);
      for (var i = 0; i < 4; i++) coin(t + 0.05 + i * 0.045, 0.6 + i * 0.1, 0.07);
    },
    // money comes in (wages, rewards, bonuses, a friend's 送金): coins jingling
    money: function (t) {
      if (sample('money', t)) { quietCoins = t + 1.5; return; }
      SOUNDS.coinShower(t, 14);
      SOUNDS.purchase(t + 0.15);
    },
    // paying at the till (SHOP, cars, tokens): the cash register
    register: function (t) {
      if (!sample('register', t)) SOUNDS.purchase(t);
    },
    // a lighter till: changing tokens back into $, paying back a loan
    registerHigh: function (t) {
      if (!sample('registerHigh', t)) SOUNDS.purchase(t);
    },
    // money (or a present) sent away to someone
    coins: function (t) {
      if (!sample('coins', t)) SOUNDS.coinPile(t, 6);
    },
    // incoming chat message
    message: function (t) {
      bell(N.G5 * 2, t, 0.06, 0.5, 0.3);
      bell(N.E6, t + 0.08, 0.05, 0.6, 0.3);
    },
    // outgoing chat message
    send: function (t) {
      tone({ t: t, f: 900, f2: 1500, glide: 0.06, d: 0.07, v: 0.07, type: 'sine' });
    },
    // friend request / accepted
    notify: function (t) {
      bell(N.C6, t, 0.08, 0.7, 0.35);
      bell(N.E6, t + 0.1, 0.08, 0.7, 0.35);
      bell(N.G6, t + 0.2, 0.09, 1.0, 0.35);
    },
    // a locked (chained) icon: heavy links rattling
    chain: function (t) {
      for (var i = 0; i < 5; i++) {
        var tt = t + i * 0.055 + Math.random() * 0.02;
        bell(1700 + Math.random() * 900, tt, 0.05, 0.16, 0.15);
        noise({ t: tt, ftype: 'bandpass', f: 4200 + Math.random() * 2500, q: 3, d: 0.05, v: 0.08 });
      }
      noise({ t: t, ftype: 'lowpass', f: 500, d: 0.12, v: 0.12 });
    },
    // the chain breaks: a crack, falling links, a sparkle
    unchain: function (t) {
      noise({ t: t, ftype: 'highpass', f: 1800, a: 0.001, d: 0.09, v: 0.3 });
      timpani(t, 90, 0.35);
      for (var i = 0; i < 7; i++) bell(1500 + Math.random() * 1500, t + 0.12 + i * 0.07, 0.05, 0.2, 0.2);
      bell(N.C7, t + 0.45, 0.1, 1.2);
      bell(N.G6 * 2, t + 0.55, 0.08, 1.4);
    },
    // incoming call (one ring; repeated while ringing)
    ring: function (t) {
      for (var i = 0; i < 2; i++) {
        tone({ t: t + i * 0.42, f: N.E6, d: 0.32, hold: 0.06, v: 0.1, type: 'sine', wet: 0.2 });
        tone({ t: t + i * 0.42, f: N.G6, d: 0.32, hold: 0.06, v: 0.07, type: 'sine', wet: 0.2 });
      }
    },
    // calling out, waiting for the friend
    ringback: function (t) {
      tone({ t: t, f: 440, d: 0.9, hold: 0.6, v: 0.06, type: 'sine' });
      tone({ t: t, f: 480, d: 0.9, hold: 0.6, v: 0.05, type: 'sine' });
    },
    callStart: function (t) {
      tone({ t: t, f: N.C5, d: 0.12, v: 0.12, type: 'triangle' });
      tone({ t: t + 0.1, f: N.G5, d: 0.2, v: 0.12, type: 'triangle' });
    },
    callEnd: function (t) {
      tone({ t: t, f: N.G5, d: 0.12, v: 0.12, type: 'triangle' });
      tone({ t: t + 0.1, f: N.C5, d: 0.22, v: 0.12, type: 'triangle' });
    },
    // the お守り加護 is switched on: a temple bell and a shimmer
    charmOn: function (t) {
      bell(N.G5, t, 0.16, 2.4, 0.5);
      bell(N.D6, t + 0.02, 0.07, 2.0, 0.5);
      for (var i = 0; i < 6; i++) bell(N.G6 * (1 + i * 0.12), t + 0.25 + i * 0.06, 0.035, 0.5, 0.4);
    },
    // it saved some tokens (`full`: all of them)
    charmSave: function (t, full) {
      bell(N.C6, t, 0.12, 1.2, 0.4);
      bell(N.E6, t + 0.1, 0.12, 1.2, 0.4);
      bell(N.G6, t + 0.2, 0.13, 1.6, 0.4);
      if (full) { bell(N.C7, t + 0.34, 0.14, 2.2, 0.5); for (var i = 0; i < 6; i++) coin(t + 0.4 + i * 0.05, 0.8, 0.08); }
    },
    // a coin dropping into the wallet (`p` 0..1: how far into a run of them,
    // the later ones a little higher: ちゃりちゃり…)
    coinIn: function (t, p) {
      if (t < quietCoins) return;
      clink(t, 1900 + Math.random() * 700 + (p || 0) * 600, 0.085);
    },
    // the last of them: a handful landing on the pile (ジャラッ) and a sparkle
    coinPile: function (t, n) {
      if (t < quietCoins) return;
      var k = Math.max(4, Math.min(12, n || 8));
      for (var i = 0; i < k; i++) clink(t + i * 0.026 + Math.random() * 0.018, 1700 + Math.random() * 1500, 0.05);
      noise({ t: t, ftype: 'highpass', f: 5200, q: 0.6, a: 0.004, d: 0.32, v: 0.05, wet: 0.3 });
      bell(N.C7, t + k * 0.026 + 0.04, 0.05, 0.9, 0.4);
    },
    // coins pouring out of a big win into the wallet (ジャラジャラ)
    coinShower: function (t, n) {
      var k = Math.max(8, Math.min(26, n || 16));
      for (var i = 0; i < k; i++) clink(t + i * 0.045 + Math.random() * 0.03, 1800 + Math.random() * 1600 + i * 25, 0.045 + Math.random() * 0.03);
      noise({ t: t, ftype: 'highpass', f: 4800, q: 0.5, a: 0.05, d: k * 0.045, v: 0.035, wet: 0.35 });
    },
    // ready... (the anticipation banner): a rising whoosh into a hit
    chance: function (t) {
      noise({ t: t, ftype: 'bandpass', f: 500, f2: 5200, q: 1.4, a: 0.18, d: 0.28, v: 0.16, wet: 0.3 });
      timpani(t + 0.42, 110, 0.45);
      bell(N.E6, t + 0.42, 0.08, 0.8, 0.4);
      bell(N.A5 * 2, t + 0.46, 0.06, 0.9, 0.4);
    },
    // one more of a kind on the pay line (n: how many now): a bell a step higher each time
    match: function (t, n) {
      var notes = [N.C6, N.C6, N.E6, N.G6, N.C7, N.E6 * 2];
      var f = notes[Math.min(5, n || 2)];
      bell(f, t, 0.09, 0.8, 0.45);
      bell(f * 1.5, t + 0.05, 0.05, 0.7, 0.45);
      if (n >= 4) bell(f * 2, t + 0.1, 0.05, 0.9, 0.5);
    },
    // a 7, a BAR or the statue lands on the pay line
    premium: function (t, s) {
      if (s === 'statue') {
        bell(N.C6, t, 0.08, 1.6, 0.6);
        bell(N.G6, t + 0.03, 0.06, 1.6, 0.6);
        bell(N.E6 * 2, t + 0.07, 0.04, 1.4, 0.6);
      } else if (s === 'seven') {
        bell(N.A5 * 2, t, 0.08, 0.6, 0.4);
        tone({ t: t, f: 1760, f2: 2640, glide: 0.08, d: 0.15, v: 0.05, type: 'triangle' });
      } else {
        noise({ t: t, ftype: 'bandpass', f: 3500, q: 4, d: 0.08, v: 0.08 });
        bell(N.E6, t, 0.06, 0.5, 0.3);
      }
    },
    // a リーチ that did not come: the fire goes out (a hiss and a sigh down)
    miss: function (t) {
      noise({ t: t, ftype: 'highpass', f: 3000, f2: 900, a: 0.01, d: 0.55, v: 0.07, wet: 0.2 });
      tone({ t: t + 0.04, f: 520, f2: 260, glide: 0.4, d: 0.45, v: 0.07, type: 'triangle', wet: 0.3 });
    },
    // something big hits the screen (SUPER, the glass breaking)
    impact: function (t) {
      tone({ t: t, f: 90, f2: 38, glide: 0.35, d: 0.5, v: 0.5, type: 'sine', wet: 0.3 });
      noise({ t: t, ftype: 'lowpass', f: 2400, f2: 300, a: 0.002, d: 0.45, v: 0.32, wet: 0.4 });
      for (var i = 0; i < 8; i++) noise({ t: t + 0.03 + Math.random() * 0.25, ftype: 'highpass', f: 4000 + Math.random() * 4000, d: 0.03, v: 0.05 + Math.random() * 0.05 });
    },
    // the player level went up: a short fanfare and a sparkle
    levelUp: function (t) {
      [N.C5, N.E5, N.G5].forEach(function (f, i) { tone({ t: t + i * 0.09, f: f, d: 0.16, v: 0.12, type: 'triangle', wet: 0.3 }); });
      brass([N.C5, N.E5, N.G5], t + 0.28, 0.5, 0.42);
      [N.C6, N.E6, N.G6, N.C7].forEach(function (f, i) { bell(f, t + 0.32 + i * 0.05, 0.06, 1.1); });
      cymbal(t + 0.28, 0.1, 1.2);
    },
    // FEVER: a rush of flame up into a fanfare, fire crackling under it
    fever: function (t) {
      noise({ t: t, ftype: 'bandpass', f: 300, f2: 6000, q: 1.2, a: 0.25, d: 0.3, v: 0.2, wet: 0.3 });
      tone({ t: t, f: 70, f2: 40, glide: 0.5, d: 0.6, v: 0.32, type: 'sine', wet: 0.2 });
      timpani(t + 0.45, 98, 0.55);
      cymbal(t + 0.45, 0.18, 2.2);
      brass([N.G4, N.B4, N.D5], t + 0.45, 0.12, 0.5);
      brass([N.A4, N.C5, N.E5], t + 0.6, 0.12, 0.5);
      brass([N.C5, N.E5, N.G5], t + 0.76, 0.9, 0.62);
      [N.C6, N.E6, N.G6, N.C7].forEach(function (f, i) { bell(f, t + 0.8 + i * 0.05, 0.06, 1.1); });
      for (var i = 0; i < 16; i++) noise({ t: t + 0.4 + Math.random() * 1.4, ftype: 'highpass', f: 2500 + Math.random() * 4000, d: 0.015 + Math.random() * 0.02, v: 0.04 + Math.random() * 0.05 });
    },
    // a win in a FEVER: a gust of fire
    feverWin: function (t) {
      noise({ t: t, ftype: 'bandpass', f: 600, f2: 4200, q: 1, a: 0.04, d: 0.32, v: 0.13, wet: 0.25 });
      for (var i = 0; i < 6; i++) noise({ t: t + 0.05 + Math.random() * 0.4, ftype: 'highpass', f: 3000 + Math.random() * 3000, d: 0.02, v: 0.05 });
    },
    // the FEVER goes out: a long hiss and a falling sigh
    feverEnd: function (t) {
      noise({ t: t, ftype: 'highpass', f: 4000, f2: 700, a: 0.02, d: 0.9, v: 0.08, wet: 0.3 });
      tone({ t: t + 0.05, f: N.G5, f2: N.C5, glide: 0.6, d: 0.6, v: 0.07, type: 'triangle', wet: 0.3 });
      tone({ t: t + 0.05, f: N.E5, f2: N.A4 / 2, glide: 0.7, d: 0.7, v: 0.05, type: 'triangle', wet: 0.3 });
    },
    // the curtains open on the machine: velvet sweeping aside and a ta-da
    curtain: function (t) {
      noise({ t: t, ftype: 'lowpass', f: 300, f2: 2400, q: 0.7, a: 0.3, d: 0.6, v: 0.16, wet: 0.2 });
      noise({ t: t + 0.12, ftype: 'bandpass', f: 900, f2: 3000, q: 0.8, a: 0.25, d: 0.5, v: 0.07 });
      brass([N.G4, N.B4, N.D5], t + 0.42, 0.1, 0.4);
      brass([N.C5, N.E5, N.G5], t + 0.56, 0.7, 0.5);
      cymbal(t + 0.56, 0.08, 1.3);
      [N.G6, N.C7].forEach(function (f, i) { bell(f, t + 0.6 + i * 0.07, 0.05, 1.0); });
    },
    // a fruit thrown or caught
    fruit: function (t) {
      tone({ t: t, f: 520, f2: 1240, glide: 0.08, d: 0.12, v: 0.12, type: 'triangle' });
      coin(t + 0.07, 0.9, 0.06);
    }
  };

  function startReels() {
    if (!ctx || muted || reelLoop) return;
    var t = ctx.currentTime;
    var rec = sample('reels', t, feverOn ? { rate: 1.14 } : null);
    if (rec) {
      rec.src.loop = true;
      reelLoop = rec;
      return;
    }
    var src = ctx.createBufferSource();
    // build a 1s loop of mechanical clicks over rolling noise
    var sr = ctx.sampleRate, len = sr, b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    var hz = 22;
    for (var i = 0; i < len; i++) {
      var ph = (i / sr) * hz % 1;
      var click = Math.exp(-ph * 60) * (Math.random() * 2 - 1);
      d[i] = (Math.random() * 2 - 1) * 0.12 + click * 0.8;
    }
    src.buffer = b;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.25);
    src.connect(f); f.connect(g); g.connect(comp);
    src.start(t);
    reelLoop = { src: src, g: g };
  }

  function stopReels() {
    if (!reelLoop) return;
    var t = ctx.currentTime, r = reelLoop;
    reelLoop = null;
    r.g.gain.cancelScheduledValues(t);
    r.g.gain.setValueAtTime(r.g.gain.value, t);
    r.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    r.src.stop(t + 0.25);
  }

  BR.sfx = {
    unlock: function () {
      if (!AC) return;
      init();
      if (ctx.state === 'suspended') ctx.resume().then(musicStart, function () {});
      if (!unlocked) {
        // iOS: play a silent buffer inside the gesture
        var s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
        unlocked = true;
      }
    },
    play: function (name, arg) {
      if (muted || !ctx || !SOUNDS[name]) return;
      if (ctx.state !== 'running') return;
      try { SOUNDS[name](ctx.currentTime + 0.005, arg); } catch (e) { /* ignore */ }
    },
    // names of the recordings decoded so far (diagnostics)
    recordings: function () { return Object.keys(buffers); },
    // title music: play(url) / stop(); it starts as soon as sound is allowed
    music: {
      play: function (url) {
        music.want = true;
        if (music.url !== url) {
          music.url = url;
          music.bytes = bytes(url);
          music.bytes.catch(function () { /* no music */ });
          music.buf = null;
          music.offset = 0;
          if (ctx) musicLoad();
        }
        musicStart();
      },
      stop: function () { music.want = false; if (ctx) musicStop(0.8); },
      playing: function () { return !!music.src; }
    },
    // a recorded voice line, at most one at a time; resolves when it starts
    voice: function (url) {
      if (!ctx || ctx.state !== 'running') return Promise.reject(new Error('no sound yet'));
      return voiceBuffer(url).then(function (b) {
        if (voiceNow) try { voiceNow.stop(); } catch (e) { /* ended */ }
        var src = ctx.createBufferSource();
        src.buffer = b;
        var g = ctx.createGain();
        g.gain.value = 1;
        src.connect(g);
        g.connect(ctx.destination);
        src.start(ctx.currentTime + 0.02);
        voiceNow = src;
        src.onended = function () { if (voiceNow === src) voiceNow = null; };
      });
    },
    preloadVoice: function (url) { if (ctx) voiceBuffer(url).catch(function () {}); },
    startReels: startReels,
    // FEVER on / off: the turning reels sound faster
    fever: function (on) { feverOn = !!on; },
    stopReels: function () { if (ctx) stopReels(); },
    // kept for the sound button, which is decoration: the sounds stay on
    setMuted: function () {},
    // quieter while a voice call is on (on), back to normal after (off)
    duck: function (on) {
      if (ducked === !!on) return;
      ducked = !!on;
      if (!ctx || !master) return;
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(masterLevel(), t + 0.35);
      if (music.gain) {
        music.gain.gain.cancelScheduledValues(t);
        music.gain.gain.setValueAtTime(music.gain.gain.value, t);
        music.gain.gain.linearRampToValueAtTime(ducked ? MUSIC_LEVEL * DUCK : MUSIC_LEVEL, t + 0.35);
      }
    },
    suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume: function () { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume().then(musicStart, function () {}); },
    running: function () { return !!ctx && ctx.state === 'running'; }
  };
})(window.BR = window.BR || {});
