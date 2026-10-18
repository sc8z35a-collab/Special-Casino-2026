/* Persistent player state (localStorage, guarded - the game works without it).
   Offline, the balances live here: they are written to two keys and read back
   from whichever copy is intact, and nothing in the game ever resets them. */
(function (BR) {
  'use strict';

  // Online, balances live on the server; only UI preferences are stored here.
  var mode = document.querySelector('meta[name="br-mode"]');
  // (a page opened straight from a file has no server behind it)
  var online = !!mode && mode.getAttribute('content') === 'online' && location.protocol !== 'file:';
  var KEY = online ? 'blockbuster-reels/online-prefs' : 'blockbuster-reels/v1';
  var BACKUP = KEY + '/backup';
  var PREFS = ['betIndex', 'muted', 'coach'];

  function defaults() {
    var s = BR.CONFIG.start;
    return {
      tokens: s.tokens,
      dollars: s.dollars,
      coins: s.coins,
      betIndex: 0,
      muted: true,        // only the look of the sound button: sounds always play
      coach: false,
      boughtDay: '',
      boughtToday: 0,
      freeDay: '',
      stats: { spins: 0, won: 0, biggest: 0 }
    };
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      return saved && typeof saved === 'object' ? saved : null;
    } catch (e) { return null; }
  }
  function valid(s) {
    return !!s && ['tokens', 'dollars', 'coins'].every(function (k) { return typeof s[k] === 'number' && isFinite(s[k]) && s[k] >= 0; });
  }

  var state = defaults();
  var saved = read(KEY);
  if (!online && !valid(saved)) saved = valid(read(BACKUP)) ? read(BACKUP) : saved;
  if (saved) {
    Object.keys(state).forEach(function (k) {
      if (saved[k] !== undefined && (!online || PREFS.indexOf(k) >= 0)) state[k] = saved[k];
    });
  }

  var timer = 0;
  function write() {
    var data = state;
    if (online) { data = {}; PREFS.forEach(function (k) { data[k] = state[k]; }); }
    var json = JSON.stringify(data);
    try { localStorage.setItem(KEY, json); } catch (e) { /* ignore */ }
    if (!online) try { localStorage.setItem(BACKUP, json); } catch (e) { /* ignore */ }
  }
  function save() {
    clearTimeout(timer);
    timer = setTimeout(write, 120);
  }
  // don't lose the last spin when the page is closed right after it
  window.addEventListener('pagehide', function () { if (timer) { clearTimeout(timer); write(); } });

  function dayRoll() {
    var d = BR.util.utcDay();
    if (state.boughtDay !== d) { state.boughtDay = d; state.boughtToday = 0; save(); }
  }

  BR.store = {
    state: state,
    save: save,
    dayRoll: dayRoll
  };
})(window.BR = window.BR || {});
