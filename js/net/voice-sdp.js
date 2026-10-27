/* Shared Opus policy: normal calls suppress silence, Turbo retains its
   existing stereo/constant-rate/10 ms behavior. Sender caps remain adaptive. */
(function (BR) {
  'use strict';
  BR.voiceSdp = function (sdp, bps, turbo, fullband) {
    var m = /a=rtpmap:(\d+) opus\/48000[^\r\n]*/i.exec(sdp);
    if (!m) return sdp;
    var pt = m[1], mine = ['maxaveragebitrate=' + bps, 'useinbandfec=1', 'usedtx=' + (turbo ? 0 : 1)];
    if (fullband || turbo) mine.push('maxplaybackrate=48000');
    if (turbo) mine.push('stereo=1', 'sprop-stereo=1', 'cbr=1');
    var re = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
    if (re.test(sdp)) sdp = sdp.replace(re, function (all, params) {
      return 'a=fmtp:' + pt + ' ' + params.split(';').filter(function (x) { return x && !/^\s*(maxaveragebitrate|maxplaybackrate|stereo|sprop-stereo|cbr|usedtx|useinbandfec)=/i.test(x); }).concat(mine).join(';');
    });
    else sdp = sdp.replace(m[0], m[0] + '\r\na=fmtp:' + pt + ' ' + mine.join(';'));
    // Keep packet-time attributes inside the Opus audio section, never video.
    return sdp.replace(/m=audio [\s\S]*?(?=\r\nm=|$)/g, function (section) {
      return section.replace(/\r\na=(?:max)?ptime:\d+/g, '').replace(m[0], m[0] + '\r\na=ptime:' + (turbo ? 10 : 20) + '\r\na=maxptime:' + (turbo ? 10 : 40));
    });
  };
})(window.BR = window.BR || {});
