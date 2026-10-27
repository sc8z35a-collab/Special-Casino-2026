/* Prefer smaller codecs only where the browser supports them. Original URLs
   remain the fallback, including embedded media in the offline build. */
(function (BR) {
  'use strict';
  var audio = document.createElement('audio'), video = document.createElement('video');
  function candidates(url, kind) {
    var supported = kind === 'audio' ? audio.canPlayType('audio/ogg; codecs="opus"') : video.canPlayType('video/webm; codecs="vp9"');
    var pattern = kind === 'audio' ? /^sounds\/[\w-]+\.(?:mp3|wav)$/ : /^video\/(?:title(?:-lite)?|studio-low)\.mp4$/;
    return supported && pattern.test(url) ? [url.replace(/\.[^.]+$/, kind === 'audio' ? '.opus' : '.webm'), url] : [url];
  }
  // Prefetch once, but retry the original when either fetching OR decoding
  // the preferred codec fails (canPlayType is only a capability hint).
  function audioSource(url, bytes) {
    var urls = candidates(url, 'audio'), first = Promise.resolve().then(function () { return bytes(urls[0]); });
    first.catch(function () {});
    return {
      decode: function (decode) {
        return first.then(decode).catch(function (error) {
          if (urls.length < 2) throw error;
          return bytes(urls[1]).then(decode);
        });
      }
    };
  }
  BR.media = { candidates: candidates, audioSource: audioSource };
})(window.BR = window.BR || {});
