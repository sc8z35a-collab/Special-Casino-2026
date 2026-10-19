/* The voice of a home, or of a hub. In a home, the player being watched
   (the host) picks which of their watchers they talk with; the host and
   those watchers make up the voice of the home, everyone else only watches.
   In a hub (友達と稼ぐ) everyone in it is in its voice, and it takes the
   place of a home's while it lasts. Every microphone starts off: a home's
   host's goes on when they pick someone to talk with, everyone else switches
   theirs on with the microphone button. Audio goes straight between the
   phones (WebRTC); the server only passes connection details along between
   people who may talk (POST /api/call, or the WebSocket). Every pair is
   connected directly; of each pair the one with the lower player id makes
   the offer. A microphone that is off sends nothing (the track is stopped),
   and while a call is on the game's own sounds play quieter. Someone heard
   speaking into an open microphone counts as active (the time quests). */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  // home: { kind: 'home' | 'hub', room: host id (or hub id), host: user (a
  // home's), members: { id: user } (the others in the voice), peers: { id:
  // peer }, stream, mic, micBusy, cid }
  var home = null;
  var ice = null;         // { servers, until }

  function myId() { var m = BR.social.me(); return m ? m.id : 0; }
  function supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  function iceServers() {
    if (ice && ice.until > Date.now()) return Promise.resolve(ice.servers);
    return api.iceServers().then(function (r) {
      ice = { servers: r.iceServers || [], until: Date.now() + 10 * 60000 };
      return ice.servers;
    }, function () { return [{ urls: ['stun:stun.l.google.com:19302'] }]; });
  }

  function getMic() {
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
  function signal(to, data) {
    var h = home;
    data.room = h.room;
    if (BR.live.send({ op: 'call', to: to, type: h.kind, callId: h.cid, data: data })) return Promise.resolve();
    return api.call(to, h.kind, h.cid, data).catch(function () {});
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
    BR.sfx.duck(!!home);
    if (!home) { bar.hidden = true; return; }
    var m = $('#call-mute'), end = $('#call-end');
    var people = Object.keys(home.members).map(function (k) { return home.members[k]; });
    var live = Object.keys(home.peers).filter(function (k) { return home.peers[k].live; }).length;
    bar.hidden = false;
    bar.classList.add('home');
    faces(people);
    $('#call-name').textContent = home.kind === 'hub' ? '友達と稼ぐ・通話' : home.room === myId() ? 'ホーム通話' : home.host.name + 'さんのホーム通話';
    bar.classList.toggle('hub', home.kind === 'hub');
    $('#call-state').textContent = (live ? (live + 1) + '人で通話中' : '接続中…') + (home.mic ? '' : '・マイク オフ');
    bar.classList.toggle('live', live > 0);
    m.classList.toggle('off', !home.mic);
    m.querySelector('.ic').className = 'ic ' + (home.mic ? 'ic-mic-on' : 'ic-mic-off');
    m.disabled = home.micBusy;
    m.setAttribute('aria-label', home.mic ? 'マイクをオフにする' : 'マイクをオンにする');
    end.querySelector('.ic').className = 'ic ic-hangup';
    end.setAttribute('aria-label', '通話を終える');
  }

  /* ------------------------------------------------------------ the microphone --- */
  function setMic(on) {
    var h = home;
    if (!h || h.micBusy || !!h.mic === !!on) return Promise.resolve();
    if (!on) {
      if (h.stream) h.stream.getTracks().forEach(function (t) { t.stop(); });
      h.stream = null;
      h.mic = false;
      eachPeer(h, function (p) { if (p.sender) p.sender.replaceTrack(null).catch(function () {}); });
      renderBar();
      return Promise.resolve();
    }
    h.micBusy = true;
    renderBar();
    return getMic().then(function (stream) {
      h.micBusy = false;
      if (home !== h) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      h.stream = stream;
      h.mic = true;
      listenForVoice(h, stream);
      var track = stream.getAudioTracks()[0];
      eachPeer(h, function (p) { if (p.sender) p.sender.replaceTrack(track).catch(function () {}); });
      renderBar();
    }, function (err) {
      h.micBusy = false;
      renderBar();
      sfx('deny');
      toast(err.message + '（聞くことはできます）', 3600);
    });
  }
  function micTrack(h) { return h.stream ? h.stream.getAudioTracks()[0] || null : null; }

  // Someone speaking into their open microphone is doing something: the time
  // quests keep counting (js/ui/activity.js). A cheap level check twice a second.
  function listenForVoice(h, stream) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !BR.activity) return;
    var ctx, an, buf, timer;
    try {
      ctx = new AC();
      an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      buf = new Uint8Array(an.fftSize);
    } catch (e) { return; }
    timer = setInterval(function () {
      if (home !== h || h.stream !== stream) { clearInterval(timer); try { ctx.close(); } catch (e) { /* closed */ } return; }
      an.getByteTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
      if (Math.sqrt(sum / buf.length) > 0.04) BR.activity.poke();
    }, 500);
  }

  /* ------------------------------------------------------------ connections --- */
  function eachPeer(h, fn) { Object.keys(h.peers).forEach(function (k) { fn(h.peers[k]); }); }

  function peerOf(h, id) {
    return h.peers[id] || (h.peers[id] = { id: id, pc: null, sender: null, ready: Promise.resolve(null), outbox: [], flush: 0, remote: false, pending: [], live: false, timer: 0, at: Date.now() });
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

  // A fresh connection to `id`; `offer`: this side makes the offer. Audio
  // always goes both ways (one transceiver), the microphone track is swapped
  // in and out without asking again. Resolves with the connection.
  function connect(h, id, offer) {
    closePeer(h, id);
    var p = peerOf(h, id);
    p.ready = iceServers().then(function (servers) {
      if (home !== h || h.peers[id] !== p) return null;
      var pc = new RTCPeerConnection({ iceServers: servers });
      p.pc = pc;
      if (offer) {
        var tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
        p.sender = tr.sender;
        if (micTrack(h)) p.sender.replaceTrack(micTrack(h)).catch(function () {});
      }
      pc.onicecandidate = function (e) { if (e.candidate) queue(h, p, { candidate: e.candidate.toJSON() }); };
      pc.ontrack = function (e) { audioFor('home-' + id, e.streams[0] || new MediaStream([e.track])); };
      pc.onconnectionstatechange = function () {
        if (home !== h || h.peers[id] !== p) return;
        var s = pc.connectionState;
        if (s === 'connected') {
          if (!p.live) sfx('callStart');
          p.live = true;
          clearTimeout(p.timer);
        } else if (s === 'failed' || s === 'closed') p.live = false;
        else if (s === 'disconnected') {
          clearTimeout(p.timer);
          p.timer = setTimeout(function () {
            // still down: the offering side tries again
            if (home === h && h.peers[id] === p && pc.connectionState !== 'connected' && myId() < id) connect(h, id, true);
          }, 6000);
        }
        if (s === 'failed' && myId() < id) setTimeout(function () { if (home === h && h.peers[id] === p) connect(h, id, true); }, 1500);
        renderBar();
      };
      if (!offer) return pc;
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
        queue(h, p, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(function () { /* tried again on the next hello */ });
      return pc;
    }).catch(function () { return null; });
    return p.ready;
  }

  // Connection details are batched: a few messages per connection, not dozens.
  function queue(h, p, item) {
    p.outbox.push(item);
    if (p.flush) return;
    p.flush = setTimeout(function () {
      p.flush = 0;
      if (home !== h || !p.outbox.length) return;
      var batch = p.outbox.splice(0, p.outbox.length);
      var msg = { op: 'signal', candidates: [] };
      batch.forEach(function (b) { if (b.description) msg.description = b.description; else if (b.candidate) msg.candidates.push(b.candidate); });
      signal(p.id, msg);
    }, 160);
  }

  function onSignal(h, id, data) {
    var desc = data.description;
    var ready = desc && desc.type === 'offer' ? connect(h, id, false) : (h.peers[id] ? h.peers[id].ready : Promise.resolve(null));
    ready.then(function (pc) {
      if (!pc || home !== h) return;
      var peer = h.peers[id];
      if (!peer) return;
      var next = Promise.resolve();
      if (desc) {
        next = pc.setRemoteDescription(desc).then(function () {
          peer.remote = true;
          peer.pending.splice(0).forEach(function (x) { pc.addIceCandidate(x).catch(function () {}); });
          if (desc.type !== 'offer') return null;
          // answering: send audio back on the same transceiver
          var tr = pc.getTransceivers()[0];
          if (tr) {
            tr.direction = 'sendrecv';
            peer.sender = tr.sender;
            if (micTrack(h)) tr.sender.replaceTrack(micTrack(h)).catch(function () {});
          }
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); }).then(function () {
            queue(h, peer, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          });
        });
      }
      next.then(function () {
        (data.candidates || []).forEach(function (x) {
          if (peer.remote) pc.addIceCandidate(x).catch(function () {});
          else peer.pending.push(x);
        });
      }).catch(function () { /* the offering side retries */ });
    });
  }

  function onCall(ev) {
    var h = home, from = ev.from, data = ev.data;
    if (!h || ev.type !== h.kind || !from || !data || data.room !== h.room) return;
    var id = from.id;
    // only the people the voice is for (the server checks it too)
    if (!h.members[id]) return;
    if (data.op === 'hello') {
      if (myId() < id) {
        // the offering side: (re)connect unless a reply finds a working (or just started) connection
        var p = h.peers[id];
        var working = p && p.pc && (['connected', 'connecting'].indexOf(p.pc.connectionState) >= 0 || Date.now() - p.at < 5000);
        if (!data.reply || !working) connect(h, id, true);
      } else if (!data.reply) {
        closePeer(h, id);
        signal(id, { op: 'hello', reply: true });
      }
    } else if (data.op === 'signal') {
      onSignal(h, id, data);
    } else if (data.op === 'bye') {
      closePeer(h, id);
    }
    renderBar();
  }

  /* ------------------------------------------------------------ joining and leaving --- */
  // The voice of the home `room` (hosted by `host`) is now `voice` (the ids of
  // the watchers the host talks with). Called by js/ui/watch.js for the home
  // I am in, whenever that changes. `opts.mic`: switch my microphone on.
  function sync(room, host, voice, people, opts) {
    lastHome = [room, host, voice, people];
    // a hub's voice comes first
    if (hubVoice) return;
    var me = myId();
    var inVoice = !!room && (room === me ? voice.length > 0 : voice.indexOf(me) >= 0);
    if (!inVoice) { leave(); return; }
    var want = {};
    if (room !== me) want[room] = host;
    voice.forEach(function (id) { if (id !== me) want[id] = people[id] || { id: id, name: '', avatar: null }; });
    join('home', room, host, want);
    if (opts && opts.mic) setMic(true);
    renderBar();
  }

  // The voice of my hub: `people` (everyone in it, me too); 0 / []: none.
  // A home call I was in comes back when it ends.
  var hubVoice = null, lastHome = null;
  function syncHub(hubId, people) {
    var me = myId();
    var want = {};
    (people || []).forEach(function (p) { if (p.id !== me) want[p.id] = p; });
    if (!hubId || !Object.keys(want).length) {
      if (!hubVoice) return;
      hubVoice = null;
      if (home && home.kind === 'hub') leave();
      if (lastHome) sync.apply(null, lastHome);
      return;
    }
    hubVoice = hubId;
    join('hub', hubId, null, want);
    renderBar();
  }

  // into the voice `kind` / `room` with the people in `want` ({ id: user }):
  // whoever is gone is closed, whoever is new is greeted
  function join(kind, room, host, want) {
    if (home && (home.kind !== kind || home.room !== room)) leave();
    if (!home) {
      home = { kind: kind, room: room, host: host, members: {}, peers: {}, stream: null, mic: false, micBusy: false, cid: (kind === 'hub' ? 'hub-room-' : 'home-') + room };
      iceServers();
    }
    var h = home;
    Object.keys(h.members).forEach(function (k) {
      if (!want[k]) { signal(Number(k), { op: 'bye' }); delete h.members[k]; closePeer(h, Number(k)); }
    });
    Object.keys(want).forEach(function (k) {
      var isNew = !h.members[k];
      h.members[k] = want[k];
      if (isNew) signal(Number(k), { op: 'hello' });
    });
  }

  function leave() {
    var h = home;
    if (!h) return;
    home = null;
    Object.keys(h.members).forEach(function (k) {
      var data = { op: 'bye', room: h.room };
      if (!BR.live.send({ op: 'call', to: Number(k), type: h.kind, callId: h.cid, data: data })) api.call(Number(k), h.kind, h.cid, data).catch(function () {});
    });
    Object.keys(h.peers).forEach(function (k) {
      var p = h.peers[k];
      clearTimeout(p.flush);
      clearTimeout(p.timer);
      if (p.pc) try { p.pc.close(); } catch (e) { /* closed */ }
      dropAudio('home-' + k);
    });
    if (h.stream) h.stream.getTracks().forEach(function (t) { t.stop(); });
    sfx('callEnd');
    renderBar();
  }

  function init() {
    $('#call-mute').addEventListener('click', function () {
      if (!home) return;
      sfx('click');
      setMic(!home.mic);
    });
    // hanging up: the watched player stops talking with everyone, a watcher
    // stops talking; in a hub, its voice ends for me (BR.hub can bring it back)
    $('#call-end').addEventListener('click', function () {
      if (!home) return;
      sfx('click');
      if (home.kind === 'hub') { if (BR.hub && BR.hub.hangUp) BR.hub.hangUp(); else syncHub(0, []); return; }
      if (BR.watch && BR.watch.endVoice) BR.watch.endVoice();
      else leave();
    });
    // some phones only start the voices after a tap
    document.addEventListener('pointerdown', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#call-audios audio'), function (a) {
        if (a.srcObject && a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () {}); }
      });
    }, true);
    window.addEventListener('pagehide', function () { if (home) leave(); });
    if (api.online) BR.live.on('call', onCall);
  }

  BR.call = {
    init: init,
    sync: sync,
    syncHub: syncHub,
    leave: leave,
    setMic: setMic,
    active: function () { return !!home; },
    // some voice of a friend comes through (a connection is up)
    live: function () { return !!home && Object.keys(home.peers).some(function (k) { return home.peers[k].live; }); },
    kind: function () { return home ? home.kind : ''; },
    // the home whose voice I am in (0: none, or a hub's)
    room: function () { return home && home.kind === 'home' ? home.room : 0; },
    hangupAll: leave
  };
})(window.BR = window.BR || {});
