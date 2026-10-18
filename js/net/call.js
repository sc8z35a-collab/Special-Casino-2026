/* Voice chat. Audio goes straight between the phones (WebRTC); the server
   only passes invitations and connection details along (POST /api/call, or
   the WebSocket for the chatty part).
   - 稼ぎに招待: a call between two friends. Someone already in a call (or in
     a home) is busy: nobody else can call them.
   - ホーム通話: everyone in a home - the player and the friends watching their
     screen (稼ぎに参加), up to 10 - talks together. Joining a home moves one
     into its call (a 1:1 call ends). Every pair of people is connected
     directly; of each pair the one with the lower player id makes the offer. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  var RING_MS = 30000;
  var call = null;        // the 1:1 call (see begin())
  var ringing = null;     // an invitation waiting for an answer: { id, peer, timer, loop }
  var home = null;        // the home call (see homeEnter())
  var ice = null;         // { servers, until }

  function myId() { var m = BR.social.me(); return m ? m.id : 0; }
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

  // Signalling: over the WebSocket when there is one, else a request.
  function signal(to, type, callId, data) {
    if (BR.live.send({ op: 'call', to: to, type: type, callId: callId, data: data === undefined ? null : data })) return Promise.resolve();
    return api.call(to, type, callId, data);
  }

  /* ------------------------------------------------------------ audio out --- */
  function audioFor(key, stream) {
    var box = $('#call-audios');
    var a = box.querySelector('[data-key="' + key + '"]');
    if (!a) {
      a = document.createElement('audio');
      a.autoplay = true;
      a.setAttribute('playsinline', '');
      a.dataset.key = key;
      box.appendChild(a);
    }
    a.srcObject = stream;
    var p = a.play();
    if (p && p.catch) p.catch(function () { /* starts with the next tap */ });
    return a;
  }
  function dropAudio(key) {
    var a = $('#call-audios [data-key="' + key + '"]');
    if (!a) return;
    a.srcObject = null;
    a.parentNode.removeChild(a);
  }

  /* ------------------------------------------------------------ the bar --- */
  function faces(users) {
    var box = $('#call-faces');
    box.textContent = '';
    users.slice(0, 4).forEach(function (u) { box.appendChild(K.avatarEl(u, 'sm')); });
    if (users.length > 4) box.appendChild(el('span', 'call-more', '+' + (users.length - 4)));
  }
  function renderBar() {
    var bar = $('#call-bar');
    var m = $('#call-mute'), end = $('#call-end');
    if (call) {
      bar.hidden = false;
      bar.classList.remove('home', 'out');
      faces([call.peer]);
      $('#call-name').textContent = call.peer.name;
      $('#call-state').textContent = call.state === 'calling' ? '呼び出し中…'
        : call.state === 'connecting' ? '接続中…'
          : '通話中 ' + clock(Date.now() - call.since);
      bar.classList.toggle('live', call.state === 'live');
      m.hidden = false;
      m.classList.toggle('off', call.muted);
      m.querySelector('.ic').className = 'ic ' + (call.muted ? 'ic-mic-off' : 'ic-mic-on');
      m.disabled = call.state === 'calling';
      end.querySelector('.ic').className = 'ic ic-hangup';
      end.setAttribute('aria-label', '通話を終了');
      return;
    }
    if (home) {
      bar.hidden = false;
      bar.classList.add('home');
      bar.classList.toggle('out', !home.joined);
      var live = Object.keys(home.peers).map(function (k) { return home.peers[k]; }).filter(function (p) { return p.live; });
      var people = Object.keys(home.members).map(function (k) { return home.members[k]; });
      faces(people);
      $('#call-name').textContent = 'ホーム通話';
      $('#call-state').textContent = !home.joined ? (people.length + 1) + '人のホーム（タップで参加）'
        : live.length ? (live.length + 1) + '人で通話中' + (home.listenOnly ? '（聞くだけ）' : '')
          : people.length ? '接続中…' : 'ホームに一人';
      bar.classList.toggle('live', home.joined && live.length > 0);
      m.hidden = !home.joined || home.listenOnly;
      m.classList.toggle('off', home.muted);
      m.querySelector('.ic').className = 'ic ' + (home.muted ? 'ic-mic-off' : 'ic-mic-on');
      m.disabled = false;
      end.querySelector('.ic').className = 'ic ' + (home.joined ? 'ic-hangup' : 'ic-phone');
      end.setAttribute('aria-label', home.joined ? 'ホーム通話から抜ける' : 'ホーム通話に参加');
      return;
    }
    bar.hidden = true;
  }
  function clock(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ------------------------------------------------------------ 1:1 calls --- */
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
    if (home) { sfx('deny'); toast('ホーム通話中は稼ぎに招待できません（稼ぎに参加要請なら送れます）', 3400); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです'); return; }
    var id = newId();
    var peer = { id: user.id, name: user.name, avatar: user.avatar };
    mic().then(function (stream) {
      if (call || home) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
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
    if (home) { api.call(r.peer.id, 'busy', r.id).catch(function () {}); return; }
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
      pc.ontrack = function (e) { audioFor('call', e.streams[0] || new MediaStream([e.track])); };
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
          send(c, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        });
      }
    });
  }

  // Connection details are batched: a few messages per call, not dozens.
  function send(c, item) {
    c.outbox.push(item);
    if (c.flush) return;
    c.flush = setTimeout(function () {
      c.flush = 0;
      if (call !== c || !c.outbox.length) return;
      var batch = c.outbox.splice(0, c.outbox.length);
      var desc = null, cands = [];
      batch.forEach(function (b) { if (b.description) desc = b.description; else if (b.candidate) cands.push(b.candidate); });
      if (desc) signal(c.peer.id, 'signal', c.id, { description: desc }).catch(function () {});
      if (cands.length) signal(c.peer.id, 'signal', c.id, { candidates: cands }).catch(function () {});
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

  // `quiet`: no hang-up message to the friend (they ended it, or it never started);
  // `why`: told to the friend with the hang-up ({ home: <host id> } when it moves to a home)
  function end(message, quiet, why) {
    var c = call;
    if (!c) return;
    call = null;
    c.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    clearTimeout(c.flush);
    if (!quiet) api.call(c.peer.id, 'hangup', c.id, why || null).catch(function () {});
    if (c.pc) try { c.pc.close(); } catch (e) { /* closed */ }
    if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop(); });
    dropAudio('call');
    renderBar();
    if (c.state === 'live' || message) sfx('callEnd');
    if (message) toast(message, 3200);
  }

  function toggleMute() {
    var s = call || home;
    if (!s || !s.stream) return;
    s.muted = !s.muted;
    s.stream.getAudioTracks().forEach(function (t) { t.enabled = !s.muted; });
    sfx('click');
    renderBar();
  }

  /* ------------------------------------------------------------ the home call --- */
  // home: { room: host id, host: user, members: { id: user } (everyone else
  // in the home), peers: { id: peer }, joined, stream, listenOnly, muted }
  function homeEnter(room, host, members, opts) {
    var me = myId();
    if (home && home.room === room) { members.forEach(function (u) { homeMember(u, true); }); return; }
    homeLeave(true);
    // a 1:1 call ends when its people go to a home
    if (call) {
      var other = call.peer;
      end(null, false, { home: room });
      toast(room === me ? 'ホーム通話に切り替えました' : other.name + 'さんとの通話を終えて、ホーム通話に入りました', 3200);
    }
    home = { room: room, host: host, members: {}, peers: {}, joined: false, stream: null, listenOnly: false, muted: false, cid: 'home-' + room };
    members.forEach(function (u) { if (u && u.id !== me) home.members[u.id] = u; });
    if (room !== me && host) home.members[host.id] = host;
    renderBar();
    if (!opts || opts.join !== false) homeJoin();
  }

  // The microphone (or just listening) and hello to everyone in the home.
  function homeJoin() {
    var h = home;
    if (!h || h.joined || h.joining) return;
    h.joining = true;
    renderBar();
    mic().then(function (stream) { return stream; }, function (err) {
      toast(err.message + '（聞くだけで参加します）', 3600);
      return null;
    }).then(function (stream) {
      h.joining = false;
      if (home !== h) { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      h.stream = stream;
      h.listenOnly = !stream;
      h.joined = true;
      iceServers();
      Object.keys(h.members).forEach(function (k) { homeSend(h, Number(k), { op: 'hello' }); });
      sfx('callStart');
      renderBar();
    });
  }

  function homeSend(h, to, data) {
    data.room = h.room;
    return signal(to, 'home', h.cid, data).catch(function () {});
  }

  function peerOf(h, id) {
    return h.peers[id] || (h.peers[id] = { id: id, pc: null, ready: Promise.resolve(null), outbox: [], flush: 0, remote: false, pending: [], live: false, timer: 0 });
  }

  function closePeer(h, id) {
    var p = h.peers[id];
    if (!p) return;
    delete h.peers[id];
    clearTimeout(p.flush);
    clearTimeout(p.timer);
    if (p.pc) try { p.pc.close(); } catch (e) { /* closed */ }
    dropAudio('home-' + id);
  }

  // A fresh connection to `id`; `offer`: this side makes the offer.
  // Resolves with the connection (also kept as peer.ready for what follows).
  function homeConnect(h, id, offer) {
    closePeer(h, id);
    var p = peerOf(h, id);
    p.ready = iceServers().then(function (servers) {
      if (home !== h || h.peers[id] !== p) return null;
      var pc = new RTCPeerConnection({ iceServers: servers });
      p.pc = pc;
      if (h.stream) h.stream.getTracks().forEach(function (t) { pc.addTrack(t, h.stream); });
      else if (offer && pc.addTransceiver) pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.onicecandidate = function (e) { if (e.candidate) homeQueue(h, p, { candidate: e.candidate.toJSON() }); };
      pc.ontrack = function (e) { audioFor('home-' + id, e.streams[0] || new MediaStream([e.track])); };
      pc.onconnectionstatechange = function () {
        if (home !== h || h.peers[id] !== p) return;
        var s = pc.connectionState;
        if (s === 'connected') { p.live = true; clearTimeout(p.timer); }
        else if (s === 'failed' || s === 'closed') p.live = false;
        else if (s === 'disconnected') {
          clearTimeout(p.timer);
          p.timer = setTimeout(function () {
            // still down: the offering side tries again
            if (home === h && h.peers[id] === p && pc.connectionState !== 'connected' && myId() < id) homeConnect(h, id, true);
          }, 6000);
        }
        if (s === 'failed' && myId() < id) setTimeout(function () { if (home === h && h.peers[id] === p) homeConnect(h, id, true); }, 1500);
        renderBar();
      };
      if (!offer) return pc;
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
        homeQueue(h, p, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(function () { /* tried again on the next hello */ });
      return pc;
    }).catch(function () { return null; });
    return p.ready;
  }

  function homeQueue(h, p, item) {
    p.outbox.push(item);
    if (p.flush) return;
    p.flush = setTimeout(function () {
      p.flush = 0;
      if (home !== h || !p.outbox.length) return;
      var batch = p.outbox.splice(0, p.outbox.length);
      var msg = { op: 'signal', candidates: [] };
      batch.forEach(function (b) { if (b.description) msg.description = b.description; else if (b.candidate) msg.candidates.push(b.candidate); });
      homeSend(h, p.id, msg);
    }, 160);
  }

  function onHome(from, data) {
    var h = home;
    if (!h || !data || data.room !== h.room || !h.joined) return;
    var id = from.id, me = myId();
    if (!h.members[id]) h.members[id] = { id: from.id, name: from.name, avatar: from.avatar };
    if (data.op === 'hello') {
      if (me < id) {
        // the offering side: (re)connect unless a reply finds a working connection
        var p = h.peers[id];
        if (!data.reply || !p || !p.pc || ['connected', 'connecting'].indexOf(p.pc.connectionState) < 0) homeConnect(h, id, true);
      } else if (!data.reply) {
        closePeer(h, id);
        homeSend(h, id, { op: 'hello', reply: true });
      }
    } else if (data.op === 'signal') {
      var desc = data.description;
      var ready = desc && desc.type === 'offer' ? homeConnect(h, id, false) : (h.peers[id] ? h.peers[id].ready : Promise.resolve(null));
      ready.then(function (pc) {
        if (!pc || home !== h) return;
        var peer = h.peers[id];
        var next = Promise.resolve();
        if (desc) {
          next = pc.setRemoteDescription(desc).then(function () {
            peer.remote = true;
            peer.pending.splice(0).forEach(function (x) { pc.addIceCandidate(x).catch(function () {}); });
            if (desc.type === 'offer') {
              return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); }).then(function () {
                homeQueue(h, peer, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
              });
            }
          });
        }
        next.then(function () {
          (data.candidates || []).forEach(function (x) {
            if (peer.remote) pc.addIceCandidate(x).catch(function () {});
            else peer.pending.push(x);
          });
        }).catch(function () { /* the offering side retries */ });
      });
    } else if (data.op === 'bye') {
      closePeer(h, id);
    }
    renderBar();
  }

  // Someone came into the home or left it.
  function homeMember(user, on) {
    var h = home;
    if (!h || !user || user.id === myId()) return;
    if (on) {
      h.members[user.id] = user;
    } else {
      delete h.members[user.id];
      closePeer(h, user.id);
    }
    renderBar();
  }

  // Leaving the home call (the home itself is left through watching).
  function homeOut() {
    var h = home;
    if (!h || !h.joined) return;
    Object.keys(h.members).forEach(function (k) { homeSend(h, Number(k), { op: 'bye' }); });
    Object.keys(h.peers).forEach(function (k) { closePeer(h, Number(k)); });
    if (h.stream) h.stream.getTracks().forEach(function (t) { t.stop(); });
    h.stream = null;
    h.joined = false;
    h.muted = false;
    sfx('callEnd');
    renderBar();
  }

  function homeLeave(quiet) {
    if (!home) return;
    if (home.joined) {
      if (quiet) {
        var h = home;
        Object.keys(h.members).forEach(function (k) { homeSend(h, Number(k), { op: 'bye' }); });
        Object.keys(h.peers).forEach(function (k) { closePeer(h, Number(k)); });
        if (h.stream) h.stream.getTracks().forEach(function (t) { t.stop(); });
      } else {
        homeOut();
      }
    }
    home = null;
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
    if (ev.type === 'home') { onHome(from, ev.data); return; }
    var c = call;
    switch (ev.type) {
      case 'invite':
        // two people per call, and a home counts as a call
        if (c || ringing || home) { api.call(from.id, 'busy', ev.callId).catch(function () {}); return; }
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
        if (c && c.id === ev.callId) {
          var moved = ev.data && ev.data.home;
          if (!moved) end('通話が終了しました', true);
          else if (moved !== from.id) end(from.name + 'さんは別のホーム通話に移りました', true);
          else {
            // the friend's call became the call of their home: one tap to follow
            end(null, true);
            if (BR.watch) BR.watch.offer(from, 'moved');
          }
        } else if (ringing && ringing.id === ev.callId) stopRinging();
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
    $('#call-end').addEventListener('click', function () {
      sfx('click');
      if (call) { end(call.state === 'calling' ? null : '通話を終了しました'); return; }
      if (home) { if (home.joined) homeOut(); else homeJoin(); }
    });
    // some phones only start the voices after a tap
    document.addEventListener('pointerdown', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#call-audios audio'), function (a) {
        if (a.srcObject && a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () {}); }
      });
    }, true);
    window.addEventListener('pagehide', function () {
      if (call) end(null);
      if (ringing) decline();
      if (home) homeLeave(true);
    });
    if (api.online) BR.live.on('call', onCall);
  }

  BR.call = {
    init: init,
    invite: invite,
    active: function () { return !!call || !!home; },
    inCall: function () { return !!call; },
    homeEnter: homeEnter,
    homeMember: homeMember,
    homeLeave: function () { homeLeave(false); },
    homeRoom: function () { return home ? home.room : 0; },
    hangupAll: function () { stopRinging(); end(null); homeLeave(true); }
  };
})(window.BR = window.BR || {});
