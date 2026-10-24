/* The operator site's screen view (server/core/opswatch.js, js/net/watchfeed.js).

   What arrives is not a video: it is the numbers that describe the player's
   game (which screen, the wallet, the bet, the reels, the win), sealed so that
   only this page can open them (js/net/watchcrypto.js). They are drawn again
   here, plainly, on a canvas of the chosen height (540 / 480 / 360 / 240) at
   the chosen rate (20 / 15 / 10 a second), with no animation beyond the reels
   turning. Nothing here can send the player's game a tap or a key: the only
   things this page ever asks of it are a different resolution and rate, a
   short message from Ice Smoker公式, and the same bans the player list has.
   Everything that arrives is treated as untrusted (the player's game could be
   modified): it is reduced to numbers in known ranges (sane()) and only ever
   drawn with fixed texts of our own. The private key lives in this tab's memory
   only and cannot be exported. No timer is shown; the server ends a watch
   after 30 minutes and says so then. */
(function () {
  'use strict';

  var WC = (window.BR || {}).watchCrypto;
  var api = null;
  var w = null;     // the watch this page has: { sid, player, mine, e, keyP, ... }
  var starting = null;   // a start is out: what arrives before its answer is kept here ({ early: [[event, data]] })

  // js/game/config.js: C.symbols (the numbers in a frame index this list)
  var SYMBOLS = ['revolver', 'gold', 'diamond', 'star', 'bar', 'seven', 'statue'];
  var SYMBOL_COLOR = { revolver: '#8a97a6', gold: '#e0b43c', diamond: '#5fc8f0', star: '#f0d24a', bar: '#d85a5a', seven: '#e63b3b', statue: '#d9c7a1' };
  // the screens the game says it is on (anything else is shown as ?)
  var SCREENS = { start: 'タイトル', slot: 'スロット', tokens: 'トークン', rules: 'ルール', tree: '金の生る木', board: 'メニュー（友達・メッセージ・Shop など）', quests: 'クエスト', support: '開発者支援', vip: 'VIP' };
  var TIERS = ['', 'WIN', 'BIG WIN', 'SUPER BIG WIN'];
  var PREF = 'ops-watch-pref';
  var STALE_MS = 8000;

  function size(h) { return [Math.round(h * 2000 / 924), h]; }
  function int(v, lo, hi) {
    v = Math.round(Number(v));
    return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
  }
  function pref() {
    var p = { q: 360, fps: 10 };
    try { var s = JSON.parse(localStorage.getItem(PREF) || '{}'); if ([540, 480, 360, 240].indexOf(s.q) >= 0) p.q = s.q; if ([20, 15, 10].indexOf(s.fps) >= 0) p.fps = s.fps; } catch (e) { /* defaults */ }
    return p;
  }
  function remember(q, fps) { try { localStorage.setItem(PREF, JSON.stringify({ q: q, fps: fps })); } catch (e) { /* this tab only */ } }

  // A frame, reduced to what we draw: numbers in known ranges and indexes into our own tables.
  function sane(o) {
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    var g = [], r = [], i, j, row, src;
    var rr = Array.isArray(o.r) ? o.r : [], t = Array.isArray(o.t) ? o.t : [];
    for (i = 0; i < 5; i++) {
      row = [];
      src = Array.isArray(o.g) && Array.isArray(o.g[i]) ? o.g[i] : [];
      for (j = 0; j < 3; j++) row.push(int(src[j], -1, SYMBOLS.length - 1));
      g.push(row);
      r.push(rr[i] ? 1 : 0);
    }
    return {
      s: typeof o.s === 'string' && Object.prototype.hasOwnProperty.call(SCREENS, o.s) ? o.s : '',
      t: [int(t[0], 0, 9e15), int(t[1], 0, 9e15), int(t[2], 0, 9e15)],
      b: int(o.b, 0, 9e15), r: r, g: g, w: int(o.w, 0, 9e15), x: int(o.x, 0, 3), c: int(o.c, 0, 9999), sp: o.sp ? 1 : 0, k: o.k ? 1 : 0
    };
  }

  /* ------------------------------------------------------------ drawing --- */
  var images = {};
  function symbolImage(name) {
    if (!images[name]) {
      var im = new Image();
      im.onload = function () { if (w) w.dirty = true; };
      im.src = '/img/symbols/' + name + '.webp';
      images[name] = im;
    }
    var i = images[name];
    return i.complete && i.naturalWidth ? i : null;
  }
  function round(ctx, x, y, wd, ht, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + wd, y, x + wd, y + ht, r);
    ctx.arcTo(x + wd, y + ht, x, y + ht, r);
    ctx.arcTo(x, y + ht, x, y, r);
    ctx.arcTo(x, y, x + wd, y, r);
    ctx.closePath();
  }
  function text(ctx, s, x, y, px, color, align, weight) {
    ctx.font = (weight || 700) + ' ' + px + 'px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }

  // the game's own 2000 x 924 layout, scaled to the canvas
  function draw(ts) {
    var c = w.canvas, ctx = c.getContext('2d'), k = c.height / 924, s = w.view;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    var bg = ctx.createLinearGradient(0, 0, 0, 924);
    bg.addColorStop(0, '#171b26');
    bg.addColorStop(1, '#0d1018');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 2000, 924);
    if (!s) {
      w.moving = false;
      text(ctx, w.ended ? '終了しました' : 'プレイヤーの画面を待っています…', 1000, 462, 54, '#9aa4b5', 'center');
      return;
    }
    // the top: which screen
    text(ctx, SCREENS[s.s] || '？', 60, 54, 46, '#e8ecf3', 'left');
    if (s.k) text(ctx, '友達の画面を観戦中', 1940, 54, 38, '#7fc4ff', 'right');
    // the wallet
    var wallet = [['トークン', s.t[0], '#e9c25a'], ['$', s.t[1], '#6fd08c'], ['ロイヤルコイン', s.t[2], '#f08a8a']];
    wallet.forEach(function (x, i) {
      var left = 60 + i * 640;
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      round(ctx, left, 112, 600, 88, 20);
      ctx.fill();
      text(ctx, x[0], left + 28, 156, 34, x[2], 'left');
      text(ctx, fmt(x[1]), left + 572, 156, 46, '#f4f6fa', 'right');
    });
    // the reels
    var X = 340, Y = 232, CW = 264, CH = 180;
    ctx.fillStyle = 'rgba(8,10,16,.85)';
    round(ctx, X - 16, Y - 16, CW * 5 + 32, CH * 3 + 32, 24);
    ctx.fill();
    ctx.strokeStyle = '#c9a23c';
    ctx.lineWidth = 6;
    ctx.stroke();
    var t = ts / 1000;
    var any = false;
    for (var i = 0; i < 5; i++) {
      ctx.save();
      round(ctx, X + i * CW, Y, CW, CH * 3, 8);
      ctx.clip();
      if (s.r[i]) {
        any = true;
        // turning: the symbols run past (the real ones are not known until it stops)
        var step = (t * 9) % 1, base = Math.floor(t * 9);
        for (var j = -1; j < 3; j++) {
          var name = SYMBOLS[(((base + i * 3 + j) % 7) + 7) % 7], im = symbolImage(name);
          ctx.globalAlpha = 0.55;
          if (im) ctx.drawImage(im, X + i * CW + 26, Y + (j + step) * CH + 8, CW - 52, CH - 16);
          else { ctx.fillStyle = SYMBOL_COLOR[name]; round(ctx, X + i * CW + 40, Y + (j + step) * CH + 24, CW - 80, CH - 48, 16); ctx.fill(); }
        }
        ctx.globalAlpha = 1;
      } else {
        for (var r = 0; r < 3; r++) {
          var idx = s.g[i][r], nm = idx >= 0 ? SYMBOLS[idx] : '', img = nm ? symbolImage(nm) : null;
          if (img) ctx.drawImage(img, X + i * CW + 26, Y + r * CH + 8, CW - 52, CH - 16);
          else if (nm) { ctx.fillStyle = SYMBOL_COLOR[nm]; round(ctx, X + i * CW + 40, Y + r * CH + 24, CW - 80, CH - 48, 16); ctx.fill(); }
        }
      }
      ctx.restore();
      if (i) { ctx.fillStyle = 'rgba(201,162,60,.5)'; ctx.fillRect(X + i * CW - 2, Y, 4, CH * 3); }
    }
    w.moving = any;
    // the bottom: the bet, the win
    text(ctx, 'BET', 340, 810, 38, '#9aa4b5', 'left');
    text(ctx, fmt(s.b), 450, 810, 56, '#f4f6fa', 'left');
    if (s.w > 0) {
      text(ctx, TIERS[s.x] || 'WIN', 1660, 790, 40, '#ffd75a', 'right');
      text(ctx, '+' + fmt(s.w), 1660, 850, 62, '#ffd75a', 'right');
    } else if (s.sp) {
      text(ctx, 'SPIN', 1660, 810, 50, '#8aa0c0', 'right');
    }
    if (s.c > 1) text(ctx, s.c + ' COMBO', 1000, 810, 44, '#ff9f5a', 'center');
    // no word from the player's game for a while
    if (w.stale) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, 2000, 924);
      text(ctx, '応答がありません', 1000, 462, 64, '#ffd0d0', 'center');
    }
  }

  function loop(ts) {
    if (!w) return;
    w.raf = requestAnimationFrame(loop);
    if (ts - w.lastDraw < 1000 / w.fps - 3) return;
    if (!w.dirty && !w.moving) return;
    w.lastDraw = ts;
    w.dirty = false;
    draw(ts);
  }

  /* ------------------------------------------------------------ the page --- */
  var $ = function (s) { return document.querySelector(s); };

  function resize() {
    var d = size(w.quality);
    w.canvas.width = d[0];
    w.canvas.height = d[1];
    w.dirty = true;
  }
  function setState(t) { $('#watch-state').textContent = t; }

  function renderStat() {
    if (!w) return;
    var now = Date.now();
    var per = now - w.statAt > 2500 ? 0 : w.stat.perSec;
    var rate = per >= 1024 ? (per / 1024).toFixed(2) + 'KB/秒' : Math.round(per) + 'B/秒';
    $('#watch-stat').textContent = '通信 ' + rate + ' ・ 今回 ' + api.bytes(w.stat.bytes) + ' ・ 累計 ' + api.bytes(w.stat.total);
    var stale = !!w.lastFrameAt && now - w.lastFrameAt > STALE_MS;
    if (stale !== !!w.stale) { w.stale = stale; w.dirty = true; }
    if (!w.ended) {
      if (!w.view) setState('接続中…');
      else if (stale) setState('応答なし');
      else setState('表示中');
    }
  }

  function paintFav() {
    var on = !!(w && api.isFavorite(w.player.id));
    var b = $('#watch-fav');
    b.textContent = on ? '★ お気に入り' : '☆ お気に入りに追加';
    b.classList.toggle('on', on);
  }

  function show() {
    $('#watch').hidden = false;
    $('#watch-name').textContent = w.player.name;
    $('#watch-q').value = String(w.quality);
    $('#watch-fps').value = String(w.fps);
    $('#watch-text').value = '';
    $('#watch-end').textContent = '見るのをやめる';
    ['#watch-q', '#watch-fps', '#watch-send', '#watch-text'].forEach(function (s) { $(s).disabled = false; });
    Array.prototype.forEach.call(document.querySelectorAll('#watch [data-preset], #watch [data-ban]'), function (b) { b.disabled = false; });
    paintFav();
    resize();
    renderStat();
  }

  // The watch is over (here, or the server ended it): nothing more can be done with it.
  function finish(reason) {
    if (!w || w.ended) return;
    w.ended = true;
    cancelAnimationFrame(w.raf);
    clearInterval(w.timer);
    clearTimeout(w.poll);
    setState(reason || '終了しました');
    $('#watch-end').textContent = '閉じる';
    ['#watch-q', '#watch-fps', '#watch-send', '#watch-text'].forEach(function (s) { $(s).disabled = true; });
    Array.prototype.forEach.call(document.querySelectorAll('#watch [data-preset], #watch [data-ban]'), function (b) { b.disabled = true; });
    w.dirty = true;
    draw(performance.now());
    renderStat();
  }
  function close() {
    if (!w) { $('#watch').hidden = true; return; }
    var mine = w;
    if (!mine.ended) {
      finish('見るのをやめました');
      api.request('POST', '/api/ops/watch/stop', { sid: mine.sid }).catch(function () { /* already over */ });
    }
    w = null;
    $('#watch').hidden = true;
  }

  function begin(player) {
    if (!WC || !WC.available) { api.toast('このブラウザでは画面を見る機能を使えません'); return; }
    if (starting) return;
    if (w) close();
    var p = pref();
    var mark = starting = { early: [] };
    WC.newPair().then(function (mine) {
      return api.request('POST', '/api/ops/watch/start', { player: player.id, quality: p.q, fps: p.fps, pub: mine.pub }).then(function (r) {
        var cur = {
          sid: r.sid, player: r.player || player, mine: mine, e: 0, keyP: null, keyResolve: null, keyWait: null, lastN: -1, appliedN: -1, chain: Promise.resolve(),
          view: null, dirty: true, moving: false, quality: r.quality, fps: r.fps, canvas: $('#watch-canvas'), ended: false, raf: 0, lastDraw: 0, lastFrameAt: 0,
          stat: { bytes: 0, perSec: 0, total: (r.totals && r.totals.bytes) || 0 }, statAt: Date.now(), timer: 0, poll: 0
        };
        cur.keyWait = new Promise(function (res) { cur.keyResolve = res; });
        w = cur;
        show();
        cur.raf = requestAnimationFrame(loop);
        cur.timer = setInterval(renderStat, 500);
        // what arrived while the start was being answered (the player's game can be quicker than the answer)
        mark.early.forEach(function (x) { onLive(x[0], x[1]); });
        // the server still has this watch? And if the message with the player's key was missed, ask for it
        // (looked at every 3 seconds until there is a key, then every 10)
        (function look() {
          cur.poll = setTimeout(function () {
            if (w !== cur || cur.ended) return;
            api.request('GET', '/api/ops/watch/state').then(function (s) {
              if (w !== cur || cur.ended) return;
              if (!s.session || s.session.sid !== cur.sid) { finish('サーバー側で終了しました'); return; }
              if (!cur.keyP && s.session.pub && s.session.e) setPeer(cur, s.session.pub, s.session.e);
            }, function () { /* try again */ }).then(look);
          }, cur.keyP ? 10000 : 3000);
        })();
      });
    }).catch(function (err) { api.fail(err); }).then(function () { if (starting === mark) starting = null; });
  }

  // the player's game answered with its public key: the same key is made here
  function setPeer(cur, pub, e) {
    cur.e = Number(e) || 0;
    cur.lastN = -1;
    cur.appliedN = -1;
    cur.keyP = WC.deriveKey(cur.mine, pub, cur.mine.pub, pub, cur.sid).catch(function () { setState('暗号化できませんでした'); return null; });
    cur.keyResolve(cur.keyP);
  }

  // a message from the server about this watch
  function onLive(ev, d) {
    if (!d) return;
    if (!w || d.sid !== w.sid) {
      // (a start is out: keep it, the answer is about to set the watch up)
      if (starting && starting.early.length < 100) starting.early.push([ev, d]);
      return;
    }
    var cur = w;
    if (ev === 'watchhello') {
      setPeer(cur, String(d.pub || ''), d.e);
    } else if (ev === 'watchframe') {
      if (cur.ended || Number(d.e) !== cur.e || !(Number(d.n) > cur.lastN) || typeof d.d !== 'string') return;
      var n = Number(d.n), e = cur.e;
      cur.lastN = n;
      cur.chain = cur.chain.then(function () { return cur.keyWait; }).then(function () { return cur.keyP; }).then(function (k) {
        if (!k || w !== cur || cur.e !== e) return null;
        return WC.open(k, cur.sid, e, n, d.d).then(function (obj) {
          var s = sane(obj);
          if (!s || w !== cur || n < cur.appliedN) return;
          cur.appliedN = n;
          cur.view = s;
          cur.dirty = true;
          cur.lastFrameAt = Date.now();
        });
      }).catch(function () { /* a frame that does not open is dropped */ });
    } else if (ev === 'watchstat') {
      cur.stat = { bytes: int(d.bytes, 0, 9e15), perSec: int(d.perSec, 0, 9e15), total: int(d.total, 0, 9e15) };
      cur.statAt = Date.now();
      renderStat();
    } else if (ev === 'watchend') {
      cur.stat.bytes = int(d.bytes, 0, 9e15) || cur.stat.bytes;
      if (d.total) cur.stat.total = int(d.total, 0, 9e15);
      finish(typeof d.text === 'string' && d.text ? d.text.slice(0, 80) : '終了しました');
    }
  }

  function change() {
    if (!w || w.ended) return;
    var q = Number($('#watch-q').value), fps = Number($('#watch-fps').value);
    w.quality = q;
    w.fps = fps;
    remember(q, fps);
    resize();
    api.request('POST', '/api/ops/watch/quality', { sid: w.sid, quality: q, fps: fps }).catch(api.fail);
  }

  function message(body) {
    if (!w || w.ended) return Promise.resolve();
    return api.request('POST', '/api/ops/watch/message', Object.assign({ sid: w.sid }, body)).then(function () { api.toast('メッセージを送りました'); }, api.fail);
  }

  var BAN = {
    suspend: { name: 'アクセス禁止', long: 'アクセス禁止（1週間）', span: '1週間' },
    ban: { name: 'BAN', long: 'BAN（30日）', span: '30日間' },
    perma: { name: '永久BAN', long: '永久BAN', span: '解除するまで' }
  };
  function ban(kind) {
    if (!w || w.ended) return;
    var cur = w, info = BAN[kind];
    api.ask({
      title: info.long + 'にしますか？',
      text: cur.player.name + ' さんのゲームはすぐにタイトル画面に戻り、' + info.span + '先へ進めなくなります。処分のお知らせが公式から届きます。' + (kind === 'suspend' ? '' : '同じ端末のほかのアカウントも止まります。'),
      ok: info.name + 'にする', danger: true
    }).then(function (ok) {
      if (!ok) return null;
      return api.request('POST', '/api/ops/ban', { id: cur.player.id, kind: kind }).then(function () {
        api.toast(info.long + 'にしました');
        api.reload();
      });
    }).catch(api.fail);
  }

  function wire() {
    $('#watch-end').addEventListener('click', close);
    $('#watch-q').addEventListener('change', change);
    $('#watch-fps').addEventListener('change', change);
    $('#watch-fav').addEventListener('click', function () {
      if (!w) return;
      var on = !api.isFavorite(w.player.id);
      api.setFavorite(w.player.id, on).then(paintFav, api.fail);
    });
    $('#watch-send').addEventListener('click', function () {
      var t = $('#watch-text').value.trim();
      if (!t) return;
      message({ text: t }).then(function () { $('#watch-text').value = ''; });
    });
    $('#watch-text').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#watch-send').click(); }
    });
    $('#watch').addEventListener('click', function (e) {
      var p = e.target.closest('[data-preset]');
      if (p) { message({ preset: p.dataset.preset }); return; }
      var b = e.target.closest('[data-ban]');
      if (b) ban(b.dataset.ban);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && w && !$('#watch').hidden && $('#dialog').hidden) close();
    });
  }

  window.OpsWatch = {
    // api: { request, toast, fail, ask, bytes, reload, isFavorite(id), setFavorite(id, on) -> Promise }
    init: function (a) { api = a; if ($('#watch')) wire(); },
    start: begin,
    onLive: onLive,
    active: function () { return !!w && !w.ended; },
    // after signing in: a watch the server still has from before a reload cannot be opened here (its key is gone), so it ends
    sync: function () {
      return api.request('GET', '/api/ops/watch/state').then(function (s) {
        if (s.session && !w) {
          api.request('POST', '/api/ops/watch/stop', { sid: s.session.sid }).then(function () { api.toast('前の画面を見ていたため、監視を終了しました'); }, function () {});
        }
        return s;
      }, function () { return null; });
    },
    // tests / tools
    sane: sane
  };
})();
