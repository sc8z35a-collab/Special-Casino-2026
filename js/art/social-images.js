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
      // the NPCs マイクソン (once ピーター) and ジョンソン, and Ice Smoker公式 (not players' icons)
      peter: 'img/avatars/peter.webp',
      johnson: 'img/avatars/johnson.webp',
      official: 'img/avatars/official.webp'
    },
    cars: {
      'two-state-sedan': 'img/cars/two-state-sedan.webp',
      'blue-lightning': 'img/cars/blue-lightning.webp'
    },
    items: {
      omamori: 'img/items/omamori.webp'
    },
    // presents in a chat (js/ui/presents.js)
    presents: {
      cookie: 'img/gifts/cookie.webp',
      bear: 'img/gifts/bear.webp',
      snowman: 'img/gifts/snowman.webp',
      pumpkin: 'img/gifts/pumpkin.webp',
      diamond: 'img/gifts/diamond.webp'
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
      quest: 'img/ui/lowpoly/quest.webp',
      lobby: 'img/ui/lobby.webp',
      menu: 'img/ui/lowpoly/menu.webp',
      tree: 'img/ui/lowpoly/money-tree.webp'
    },
    tabs: {
      friends: 'img/ui/lowpoly/friends.webp',
      messages: 'img/ui/lowpoly/messages.webp',
      jobs: 'img/ui/lowpoly/jobs.webp'
    },
    // 金の生る木: its nine looks, and the seed sold at the auctions
    tree: {
      stages: ['img/tree/stage-1.webp', 'img/tree/stage-2.webp', 'img/tree/stage-3.webp', 'img/tree/stage-4.webp', 'img/tree/stage-5.webp',
        'img/tree/stage-6.webp', 'img/tree/stage-7.webp', 'img/tree/stage-8.webp', 'img/tree/stage-9.webp'],
      seed: 'img/tree/seed.webp',
      preview: 'img/tree/preview.webp'
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
    bgm: 'sounds/bgm-title.mp3',
    peter: ['sounds/peter-1.mp3', 'sounds/peter-2.mp3']
  };

  // supplied title picture, also embedded by tools/build_single.py
  BR.START_ART = 'img/ui/lowpoly/title.webp';
})(window.BR = window.BR || {});
