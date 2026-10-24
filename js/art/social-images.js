/* Optional per-scene artwork. Every file is local; no network image hosts.
 * The file:// single-file build replaces the relative paths with data URIs.
 */
(function (BR) {
  'use strict';

  // Tile / face art. The renderer falls back to the procedural look if a file is absent.
  BR.SOCIAL_IMG = {
    tiles: {
      bamboo: 'img/tiles/bamboo.webp',
      characters: 'img/tiles/characters.webp',
      dots: 'img/tiles/dots.webp',
      honors: 'img/tiles/honors.webp'
    },
    faces: {
      peter: 'img/faces/peter.webp',
      job: 'img/faces/job.webp',
      butters: 'img/faces/butters.webp',
      cartman: 'img/faces/cartman.webp',
      kenny: 'img/faces/kenny.webp',
      kyle: 'img/faces/kyle.webp',
      stan: 'img/faces/stan.webp',
      wendy: 'img/faces/wendy.webp'
    },
    // Lobby and table background art
    lobby: 'img/bg/lobby.webp',
    table: 'img/bg/table.webp',
    felt: 'img/bg/felt.webp',
    // Auction / collection / tree
    auction: 'img/bg/auction.webp',
    vault: 'img/bg/vault.webp',
    tree: {
      stages: ['img/tree/stage-1.webp', 'img/tree/stage-2.webp', 'img/tree/stage-3.webp', 'img/tree/stage-4.webp',
        'img/tree/stage-5.webp', 'img/tree/stage-6.webp', 'img/tree/stage-7.webp', 'img/tree/stage-8.webp', 'img/tree/stage-9.webp'],
      seed: 'img/tree/seed.webp',
      preview: 'img/tree/preview.webp'
    },
    // バイト
    jobs: {
      garage: 'img/jobs/garage.webp'
    }
  };

  // Optional studio logo, title music and Peter's voice.
  BR.LAUNCH_MEDIA = {
    studio: 'video/studio-low.mp4',
    bgm: 'sounds/bgm-title.mp3',
    peter: ['sounds/peter-1.mp3', 'sounds/peter-2.mp3']
  };

  // supplied title picture, also embedded by tools/build_single.py
  BR.START_ART = 'img/ui/lowpoly/title.webp';

  // Profile customisations load after the regular boot modules have initialised.
  function loadProfileCustomisations() {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'css/profile-custom.css';
    document.head.appendChild(css);
    var assets = [
      'profile-images.js', 'profile-images-2.js', 'profile-images-2-password.js',
      'profile-images-2-notification.js', 'profile-images-3.js',
      'profile-images-4.js', 'profile-images-5.js', 'profile-images-6.js'
    ];
    function loadAsset(index) {
      if (index === assets.length) {
        var script = document.createElement('script');
        script.src = 'js/ui/profile-custom.js';
        document.body.appendChild(script);
        return;
      }
      var art = document.createElement('script');
      art.src = 'js/art/' + assets[index];
      art.onload = function () { loadAsset(index + 1); };
      document.body.appendChild(art);
    }
    loadAsset(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadProfileCustomisations);
  else loadProfileCustomisations();
})(window.BR = window.BR || {});
