/* Pictures of the online features and the start screen video. Paths are
   written out in full so tools/build_single.py can embed them. */
(function (BR) {
  'use strict';

  BR.SOCIAL_IMG = {
    avatars: {
      bald: 'img/avatars/bald.webp',
      beard: 'img/avatars/beard.webp',
      curly: 'img/avatars/curly.webp',
      blond: 'img/avatars/blond.webp',
      witch: 'img/avatars/witch.webp',
      pumpkin: 'img/avatars/pumpkin.webp',
      red: 'img/avatars/red.webp',
      vampire: 'img/avatars/vampire.webp'
    },
    cars: {
      'two-state-sedan': 'img/cars/two-state-sedan.webp'
    },
    chain: 'img/ui/chain.webp',
    sale: 'img/ui/sale.webp'
  };

  // the start screen: the full video online, the small one in the single-file build
  BR.START_VIDEO = {
    full: 'video/title.mp4',
    lite: 'video/title-lite.mp4',
    poster: 'video/title-poster.webp'
  };
})(window.BR = window.BR || {});
