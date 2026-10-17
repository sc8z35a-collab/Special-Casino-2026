/* Sound effects: the supplied recordings (sounds/) for clicks, the SPIN
   button, the turning reels and wins; everything else is synthesised with
   WebAudio. The synthesised versions also stand in until the recordings
   are decoded. */
(function (BR) {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, comp = null, verb = null, verbIn = null;
  var muted = true, unlocked = false;
  var noiseBuf = null;
  var reelLoop = null;

  /* ------------------------------------------------------------ recordings --- */
  var RECORDINGS = {
    click: 'sounds/click.wav',
    spin: 'sounds/spin-button.wav',
    reels: 'sounds/reels.wav',      // two tick cycles, cut to loop seamlessly
    win: 'sounds/win.mp3'
  };
  var LEVEL = { click: 0.7, spin: 1, reels: 0.6, win: 0.9 };
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

  function decodeRecordings() {
    Object.keys(raw).forEach(function (k) {
      raw[k].then(function (ab) {
        return new Promise(function (resolve, reject) {
          var p = ctx.decodeAudioData(ab, resolve, reject);   // callback form for older Safari
          if (p && p.then) p.then(resolve, reject);
        });
      }).then(function (b) { buffers[k] = b; }, function () { /* keep the synthesised sound */ });
    });
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
    master.gain.value = muted ? 0 : 0.8;
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
    // incoming chat message
    message: function (t) {
      bell(N.G5 * 2, t, 0.06, 0.5, 0.3);
      bell(N.E6, t + 0.08, 0.05, 0.6, 0.3);
    },
    // outgoing chat message
    send: function (t) {
      tone({ t: t, f: 900, f2: 1500, glide: 0.06, d: 0.07, v: 0.07, type: 'sine' });
    }
  };

  function startReels() {
    if (!ctx || muted || reelLoop) return;
    var t = ctx.currentTime;
    var rec = sample('reels', t);
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
      if (ctx.state === 'suspended') ctx.resume();
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
    startReels: startReels,
    stopReels: function () { if (ctx) stopReels(); },
    setMuted: function (m) {
      muted = m;
      if (ctx) {
        var t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(m ? 0 : 0.8, t, 0.03);
        if (m) stopReels();
      }
    },
    suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume: function () { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume(); }
  };
})(window.BR = window.BR || {});
