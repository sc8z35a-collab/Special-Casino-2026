/* Shared audio congestion control. No signalling traffic: local WebRTC stats,
   one poll per active peer every three seconds; ceilings remain VIP/TURBO's. */
(function (BR) {
  'use strict';
  BR.adaptVoice = function (pc, sender, ceiling, priority) {
    var cap = ceiling, current = ceiling, applied = 0, busy = false, stopped = false;
    var bad = 0, good = 0, previous = null, writing = false;
    function apply() {
      if (stopped || writing || current === applied || !sender.getParameters || !sender.setParameters) return;
      try {
        var params = sender.getParameters(), value = current;
        params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = value;
        if (priority) { params.encodings[0].priority = 'high'; params.encodings[0].networkPriority = 'high'; }
        writing = true;
        Promise.resolve(sender.setParameters(params)).then(function () { applied = value; }, function () {}).then(function () { writing = false; });
      } catch (e) { writing = false; /* optional browser support */ }
    }
    function inspect(stats) {
      var remote = null, sent = null, rtt = null, available = null, jitter = null;
      stats.forEach(function (s) {
        if ((s.kind || s.mediaType) && (s.kind || s.mediaType) !== 'audio') return;
        if (s.type === 'remote-inbound-rtp') remote = s;
        if (s.type === 'outbound-rtp' && !s.isRemote) sent = s;
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) {
          if (Number.isFinite(s.currentRoundTripTime)) rtt = s.currentRoundTripTime;
          if (Number.isFinite(s.availableOutgoingBitrate) && s.availableOutgoingBitrate > 0) available = s.availableOutgoingBitrate;
        }
      });
      var loss = remote && Number.isFinite(remote.fractionLost) ? Math.max(0, remote.fractionLost) : null;
      if (remote) {
        if (Number.isFinite(remote.roundTripTime)) rtt = remote.roundTripTime;
        if (Number.isFinite(remote.jitter)) jitter = remote.jitter;
        if (sent && Number.isFinite(remote.packetsLost) && Number.isFinite(sent.packetsSent)) {
          var next = { lost: remote.packetsLost, sent: sent.packetsSent };
          if (previous && next.sent > previous.sent && next.lost >= previous.lost) loss = (next.lost - previous.lost) / (next.sent - previous.sent);
          previous = next;
        }
      }
      if (loss === null && rtt === null && jitter === null && available === null) return;
      var poor = loss > 0.06 || rtt > 0.6 || jitter > 0.05 || (available !== null && available < current * 1.25);
      var healthy = (loss === null || loss < 0.02) && (rtt === null || rtt < 0.35) && (jitter === null || jitter < 0.02) && (available === null || available > current * 2);
      bad = poor ? bad + 1 : 0; good = !poor && healthy ? good + 1 : 0;
      var floor = Math.min(cap, 16000);
      if (bad >= 2 || loss > 0.2 || rtt > 1.5) {
        current = Math.max(floor, Math.min(Math.floor(current * 0.7), available === null ? cap : Math.floor(available * 0.65)));
        bad = good = 0;
      } else if (good >= 3) { current = Math.min(cap, Math.ceil(current * 1.25)); good = 0; }
      apply();
    }
    function sample() {
      if (stopped || busy) return;
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') { stop(); return; }
      if (pc.connectionState !== 'connected' || !pc.getStats) return;
      busy = true;
      Promise.resolve().then(function () { return pc.getStats(); }).then(function (stats) { if (!stopped) inspect(stats); }, function () {}).then(function () { busy = false; }, function () { busy = false; });
    }
    var timer = setInterval(sample, 3000);
    function stop() { stopped = true; clearInterval(timer); }
    apply();
    return { stop: stop, setCap: function (value) { cap = value; current = Math.min(current, cap); apply(); } };
  };
})(window.BR = window.BR || {});
