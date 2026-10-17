/* 稼ぎに招待: voice chat with a friend while both keep playing. Audio goes
   straight between the two phones (WebRTC); the server only passes the
   invitation and the connection details along (POST /api/call + live
   "call" events). One call at a time. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var sfx = K.sfx, toast = K.toast;

  var RING_MS = 30000;
  var call = null;        // the current call (see begin())
  var ringing = null;     // an invitation waiting for an answer: { id, peer, timer, loop }
  var ice = null;         // { servers, until }

  function newId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return 'c-' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  function iceServers() {
    if (ice && ice.until > Date.now()) return Promise.resolve(ice.servers);
    return api.iceServers().then(function (r) {
      ice = { servers: r.iceServers || [], until: Date.now() + 10 * 60000 };
      return ice.servers;
    }, function () { return [{ urls: ['stun:stun.l.google.com:19302'] }]; });
  }

  function mic() {
    if (!supported()) {
      return Promise.reject(new Error(window.isSecureContext === false
        ? 'この接続ではマイクが使えません（https で開いてください）'
        : 'このブラウザでは音声通話が使えません'));
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .catch(function (e) {
        throw new Error(e && e.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください'
          : 'マイクを使えませんでした');
      });
  }

  /* ------------------------------------------------------------ the bar --- */
  function renderBar() {
    var bar = $('#call-bar');
    if (!call) { bar.hidden = true; return; }
    bar.hidden = false;
    var old = $('#call-avatar');
    var av = K.avatarEl(call.peer, 'sm');
    av.id = 'call-avatar';
    old.parentNode.replaceChild(av, old);
    $('#call-name').textContent = call.peer.name;
    var st = call.state === 'calling' ? '呼び出し中…'
      : call.state === 'connecting' ? '接続中…'
        : '通話中 ' + clock(Date.now() - call.since);
    $('#call-state').textContent = st;
    bar.classList.toggle('live', call.state === 'live');
    var m = $('#call-mute');
    m.classList.toggle('off', call.muted);
    m.querySelector('.ic').className = 'ic ' + (call.muted ? 'ic-mic-off' : 'ic-mic-on');
    m.disabled = call.state === 'calling';
  }
  function clock(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ------------------------------------------------------------ calling --- */
  function begin(peer, id, role, stream) {
    call = {
      id: id, peer: peer, role: role, stream: stream, state: role === 'caller' ? 'calling' : 'connecting',
      pc: null, since: 0, muted: false, outbox: [], flush: 0, remote: false, pending: [], timers: []
    };
    renderBar();
    return call;
  }

  function invite(user) {
    if (!user) return;
    if (call) { sfx('deny'); toast(call.peer.id === user.id ? 'すでに通話中です' : '通話中です。終了してから招待してください'); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです'); return; }
    var id = newId();
    var peer = { id: user.id, name: user.name, avatar: user.avatar };
    mic().then(function (stream) {
      if (call) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var c = begin(peer, id, 'caller', stream);
      ringback(c);
      iceServers();
      api.call(peer.id, 'invite', id).then(function () {
        toast(peer.name + 'さんを稼ぎに招待しました');
      }, function (err) {
        end(null, true);
        K.fail(err);
      });
      c.timers.push(setTimeout(function () {
        if (call === c && c.state === 'calling') {
          api.call(peer.id, 'cancel', id).catch(function () {});
          end(peer.name + 'さんは応答しませんでした', true);
        }
      }, RING_MS));
    }, function (err) { sfx('deny'); toast(err.message, 3600); });
  }

  function ringback(c) {
    var beat = function () { if (call === c && c.state === 'calling') { sfx('ringback'); c.timers.push(setTimeout(beat, 2600)); } };
    beat();
  }

  function accept() {
    var r = ringing;
    if (!r) return;
    stopRinging();
    mic().then(function (stream) {
      var c = begin(r.peer, r.id, 'callee', stream);
      return connect(c).then(function () { return api.call(r.peer.id, 'accept', r.id); });
    }).catch(function (err) {
      api.call(r.peer.id, 'decline', r.id).catch(function () {});
      end(null, true);
      sfx('deny');
      toast(err.message, 3600);
    });
  }

  function decline() {
    var r = ringing;
    if (!r) return;
    stopRinging();
    sfx('click');
    api.call(r.peer.id, 'decline', r.id).catch(function () {});
  }

  // Sets up the connection. The caller makes the offer once the friend has accepted.
  function connect(c) {
    return iceServers().then(function (servers) {
      if (call !== c) return;
      var pc = new RTCPeerConnection({ iceServers: servers });
      c.pc = pc;
      c.stream.getTracks().forEach(function (t) { pc.addTrack(t, c.stream); });
      pc.onicecandidate = function (e) { send(c, { candidate: e.candidate ? e.candidate.toJSON() : null }); };
      pc.ontrack = function (e) {
        var audio = $('#call-audio');
        audio.srcObject = e.streams[0] || new MediaStream([e.track]);
        var p = audio.play();
        if (p && p.catch) p.catch(function () { /* starts with the next tap */ });
      };
      pc.onconnectionstatechange = function () {
        if (call !== c) return;
        var s = pc.connectionState;
        if (s === 'connected' && c.state !== 'live') {
          c.state = 'live';
          c.since = Date.now();
          sfx('callStart');
          c.timers.push(setInterval(renderBar, 1000));
          renderBar();
        } else if (s === 'failed') {
          end('通話の接続が切れました');
        } else if (s === 'disconnected') {
          c.timers.push(setTimeout(function () {
            if (call === c && pc.connectionState === 'disconnected') end('通話の接続が切れました');
          }, 8000));
        }
      };
      if (c.role === 'caller') {
        return pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
          send(c, { description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        });
      }
    });
  }

  // Connection details are batched: a few requests per call, not dozens.
  function send(c, item) {
    c.outbox.push(item);
    if (c.flush) return;
    c.flush = setTimeout(function () {
      c.flush = 0;
      if (call !== c || !c.outbox.length) return;
      var batch = c.outbox.splice(0, c.outbox.length);
      var desc = null, cands = [];
      batch.forEach(function (b) { if (b.description) desc = b.description; else if (b.candidate) cands.push(b.candidate); });
      if (desc) api.call(c.peer.id, 'signal', c.id, { description: desc }).catch(function () {});
      if (cands.length) api.call(c.peer.id, 'signal', c.id, { candidates: cands }).catch(function () {});
    }, 180);
  }

  function onSignal(c, data) {
    if (!c.pc || !data) return;
    var pc = c.pc;
    if (data.description) {
      pc.setRemoteDescription(data.description).then(function () {
        c.remote = true;
        c.pending.splice(0).forEach(function (x) { pc.addIceCandidate(x).catch(function () {}); });
        if (data.description.type === 'offer') {
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); }).then(function () {
            send(c, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          });
        }
      }).catch(function () { end('通話を開始できませんでした'); });
    }
    (data.candidates || []).forEach(function (x) {
      if (c.remote) pc.addIceCandidate(x).catch(function () {});
      else c.pending.push(x);
    });
  }

  // `quiet`: no hang-up message to the friend (they ended it, or it never started)
  function end(message, quiet) {
    var c = call;
    if (!c) return;
    call = null;
    c.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    clearTimeout(c.flush);
    if (!quiet) api.call(c.peer.id, 'hangup', c.id).catch(function () {});
    if (c.pc) try { c.pc.close(); } catch (e) { /* closed */ }
    if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop(); });
    var audio = $('#call-audio');
    audio.srcObject = null;
    renderBar();
    if (c.state === 'live' || message) sfx('callEnd');
    if (message) toast(message, 3200);
  }

  function toggleMute() {
    if (!call || !call.stream) return;
    call.muted = !call.muted;
    call.stream.getAudioTracks().forEach(function (t) { t.enabled = !call.muted; });
    sfx('click');
    renderBar();
  }

  /* ------------------------------------------------------------ invitations --- */
  function showRinging(r) {
    ringing = r;
    var old = $('#call-in-avatar');
    var av = K.avatarEl(r.peer, 'big');
    av.id = 'call-in-avatar';
    old.parentNode.replaceChild(av, old);
    $('#call-in-name').textContent = r.peer.name;
    $('#call-in').hidden = false;
    var beat = function () { if (ringing === r) { sfx('ring'); r.loop = setTimeout(beat, 2400); } };
    beat();
    r.timer = setTimeout(function () {
      if (ringing !== r) return;
      stopRinging();
      toast(r.peer.name + 'さんから稼ぎに招待がありました', 3600);
    }, RING_MS);
  }
  function stopRinging() {
    if (!ringing) return;
    clearTimeout(ringing.timer);
    clearTimeout(ringing.loop);
    ringing = null;
    $('#call-in').hidden = true;
  }

  function onCall(ev) {
    var from = ev.from;
    if (!from) return;
    var c = call;
    switch (ev.type) {
      case 'invite':
        if (c || ringing) { api.call(from.id, 'busy', ev.callId).catch(function () {}); return; }
        showRinging({ id: ev.callId, peer: { id: from.id, name: from.name, avatar: from.avatar } });
        break;
      case 'cancel':
        if (ringing && ringing.id === ev.callId) { stopRinging(); toast(from.name + 'さんから稼ぎに招待がありました', 3600); }
        break;
      case 'accept':
        if (c && c.id === ev.callId && c.role === 'caller' && c.state === 'calling') {
          c.state = 'connecting';
          renderBar();
          connect(c).catch(function () { end('通話を開始できませんでした'); });
        }
        break;
      case 'decline':
        if (c && c.id === ev.callId) end(from.name + 'さんは今は参加できないようです', true);
        break;
      case 'busy':
        if (c && c.id === ev.callId) end(from.name + 'さんは別の通話中です', true);
        break;
      case 'hangup':
        if (c && c.id === ev.callId) end('通話が終了しました', true);
        else if (ringing && ringing.id === ev.callId) stopRinging();
        break;
      case 'signal':
        if (c && c.id === ev.callId) onSignal(c, ev.data);
        break;
    }
  }

  function init() {
    $('#call-accept').addEventListener('click', function () { sfx('click'); accept(); });
    $('#call-decline').addEventListener('click', decline);
    $('#call-mute').addEventListener('click', toggleMute);
    $('#call-end').addEventListener('click', function () { sfx('click'); end(call && call.state === 'calling' ? null : '通話を終了しました'); });
    // some phones only start the friend's voice after a tap
    document.addEventListener('pointerdown', function () {
      var a = $('#call-audio');
      if (call && a.srcObject && a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () {}); }
    }, true);
    window.addEventListener('pagehide', function () {
      if (call) end(null);
      if (ringing) decline();
    });
    if (api.online) BR.live.on('call', onCall);
  }

  BR.call = {
    init: init,
    invite: invite,
    active: function () { return !!call; },
    hangupAll: function () { stopRinging(); end(null); }
  };
})(window.BR = window.BR || {});
