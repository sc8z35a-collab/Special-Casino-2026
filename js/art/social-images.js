/* Pictures of the online features and the start screen video. Paths are
   written out in full so tools/build_single.py can embed them. */
(function (BR) {
  'use strict';

  BR.SOCIAL_IMG = {
    avatars: {
      'traveler-green': 'img/avatars/traveler-green.webp',
      'adventurer-blue': 'img/avatars/adventurer-blue.webp',
      'magician-purple': 'img/avatars/magician-purple.webp',
      'dealer-purple': 'img/avatars/dealer-purple.webp',
      'adventurer-gold': 'img/avatars/adventurer-gold.webp',
      'knight-gold': 'img/avatars/knight-gold.webp',
      'karate-red': 'img/avatars/karate-red.webp',
      'rogue-red': 'img/avatars/rogue-red.webp',
      'swordsman-red': 'img/avatars/swordsman-red.webp',
      'pilot-cyan': 'img/avatars/pilot-cyan.webp',
      'explorer-cyan': 'img/avatars/explorer-cyan.webp',
      'healer-cyan': 'img/avatars/healer-cyan.webp',
      'gambler-secret': 'img/avatars/gambler-secret.webp',
      'adam-secret': 'img/avatars/adam-secret.webp',
      'philosopher-secret': 'img/avatars/philosopher-secret.webp',
      'warrior-secret': 'img/avatars/warrior-secret.webp',
      'assassin-secret': 'img/avatars/assassin-secret.webp',
      'waitress-secret': 'img/avatars/waitress-secret.webp',
      'chef-secret': 'img/avatars/chef-secret.webp',
      'wanderer-secret': 'img/avatars/wanderer-secret.webp',
      'fennec-secret': 'img/avatars/fennec-secret.webp',
      'professor-secret': 'img/avatars/professor-secret.webp',
      'chemist-secret': 'img/avatars/chemist-secret.webp',
      'sage-secret': 'img/avatars/sage-secret.webp',
      // the NPCs マイクソン (once ピーター) and ジョンソン, and Ice Smoker公式 (not players' icons)
      peter: 'img/avatars/rogue-red.webp',
      johnson: 'img/avatars/karate-red.webp',
      official: 'img/avatars/official.webp'
    },
    cars: {
      'two-state-sedan': 'img/cars/two-state-sedan.webp',
      'blue-lightning': 'img/cars/blue-lightning.webp',
      onvoro: 'img/cars/onvoro.webp',
      'ferrari-325': 'img/cars/ferrari-325.webp',
      'mercedes-benz-one': 'img/cars/mercedes-benz-one.webp',
      'lamborghini-aventador': 'img/cars/lamborghini-aventador.webp',
      'lamborghini-kuia-spyder': 'img/cars/lamborghini-kuia-spyder.webp',
      'nissan-gt-r': 'img/cars/nissan-gt-r.webp',
      'lamborghini-revuelto': 'img/cars/lamborghini-revuelto.webp',
      'mercedes-amg-one-white': 'img/cars/mercedes-amg-one-white.webp'
    },
    items: {
      omamori: 'img/ui/refresh/charm.webp',
      'repair-kit': 'img/items/lowpoly/repair-kit.webp',
      'car-oil-medium': 'img/items/lowpoly/car-oil-medium.webp',
      'gasoline-full': 'img/items/lowpoly/gasoline-full.webp',
      'engine-v1': 'img/items/lowpoly/engine-v1.webp',
      'engine-v2': 'img/items/lowpoly/engine-v2.webp',
      'engine-v3': 'img/items/lowpoly/engine-v3.webp'
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

  // Optional studio logo, title music and Peter's voice.
  BR.LAUNCH_MEDIA = {
    studio: 'video/studio-low.mp4',
    bgm: 'sounds/bgm-title.mp3',
    peter: ['sounds/peter-1.mp3', 'sounds/peter-2.mp3']
  };

  // supplied title picture, also embedded by tools/build_single.py
  BR.START_ART = 'img/ui/lowpoly/title.webp';

})(window.BR = window.BR || {});
