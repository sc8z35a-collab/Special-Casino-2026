/* Persistent player state (localStorage, guarded - the game works without it). */
(function (BR) {
  'use strict';

  // Online, balances live on the server; only UI preferences are stored here.
  var mode = document.querySelector('meta[name="br-mode"]');
  var online = !!mode && mode.getAttribute('content') === 'online';
  var KEY = online ? 'blockbuster-reels/online-prefs' : 'blockbuster-reels/v1';
  var PREFS = ['betIndex', 'muted', 'coach'];

  function defaults() {
    var s = BR.CONFIG.start;
    return {
      tokens: s.tokens,
      dollars: s.dollars,
      coins: s.coins,
      betIndex: 0,
      muted: true,
      coach: false,
      boughtDay: '',
      boughtToday: 0,
      freeDay: '',
      stats: { spins: 0, won: 0, biggest: 0 }
    };
  }

  var state = defaults();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      Object.keys(state).forEach(function (k) {
        if (saved[k] !== undefined && (!online || PREFS.indexOf(k) >= 0)) state[k] = saved[k];
      });
    }
  } catch (e) { /* private mode etc. */ }

  var timer = 0;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var data = state;
      if (online) { data = {}; PREFS.forEach(function (k) { data[k] = state[k]; }); }
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    }, 120);
  }

  function dayRoll() {
    var d = BR.util.utcDay();
    if (state.boughtDay !== d) { state.boughtDay = d; state.boughtToday = 0; save(); }
  }

  BR.store = {
    state: state,
    save: save,
    dayRoll: dayRoll,
    reset: function () {
      var d = defaults();
      Object.keys(d).forEach(function (k) { state[k] = d[k]; });
      save();
    }
  };
})(window.BR = window.BR || {});
