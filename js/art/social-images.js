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
      vampire: 'img/avatars/vampire.webp',
      cap: 'img/avatars/cap.webp',
      catcap: 'img/avatars/catcap.webp',
      // ピーター (not a player's icon)
      peter: 'img/avatars/peter.webp'
    },
    cars: {
      'two-state-sedan': 'img/cars/two-state-sedan.webp'
    },
    items: {
      omamori: 'img/items/omamori.webp'
    },
    fruits: {
      strawberry: 'img/fruits/strawberry.webp',
      watermelon: 'img/fruits/watermelon.webp',
      melon: 'img/fruits/melon.webp'
    },
    chain: 'img/ui/chain.webp',
    sale: 'img/ui/sale.webp',
    loginBonus: 'img/ui/login-bonus.webp',
    // round buttons on the slot screen
    buttons: {
      quest: 'img/ui/quest.webp',
      lobby: 'img/ui/lobby.webp',
      menu: 'img/ui/menu.webp'
    },
    // バイト
    jobs: {
      garage: 'img/jobs/garage.webp'
    }
  };

  // the studio logos (every launch; the small one in the single-file build),
  // the story after signing up, the title music and Peter's voice
  BR.LAUNCH_MEDIA = {
    studio: 'video/studio.mp4',
    studioLite: 'video/studio-lite.mp4',
    intro: 'video/intro.mp4',
    bgm: 'sounds/bgm-title.mp3',
    peter: ['sounds/peter-1.mp3', 'sounds/peter-2.mp3']
  };

  // the start screen: the full video online, the small one in the single-file build
  BR.START_VIDEO = {
    full: 'video/title.mp4',
    lite: 'video/title-lite.mp4',
    poster: 'video/title-poster.webp'
  };
})(window.BR = window.BR || {});
