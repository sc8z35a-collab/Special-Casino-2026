/* 功績: the medals — those still to be earned (取得可能) and those that are mine
   (コレクション), rarest last, four to a row and two rows to a page, the next
   page peeking in at the side. A tap shows a medal; one that is mine and not
   received yet is received there. The server decides everything and says
   which medals there are (server/core/medals.js). */
(function (BR) {
  'use strict';
  var K = BR.kit, api = BR.api, el = K.el, fmt = BR.util.fmt;
  var PER_PAGE = 8, PEEK = 0.88, SWIPE = 0.16;
  var RANK = { green: '緑', blue: '青', purple: '紫', gold: '金', red: '赤', secret: 'シークレット' };
  var TICKET = { rare: 'レアガチャ', legendary: 'レジェンダリーガチャ', secret: 'シークレットガチャ' };
  // (the medals with no picture yet: a medal drawn in its colour, with this on it)
  var MARK = { pioneer: '先', loser: '負', 'invest-talent': '投' };
  var root, ui = {}, list = [], tab = '', chosen = '', page = 0, pages = 1, busy = false, generation = 0, drag = null, wheelAt = 0;

  function byId(id) { return document.getElementById(id); }
  function shown() { return !!root && !root.hidden; }
  function short(n) { return n >= 1e6 ? fmt(n / 1e6) + 'M' : n >= 1e3 ? fmt(n / 1e3) + 'K' : fmt(n); }
  function amount(n, money) { return money ? '$' + short(n) : fmt(n); }
  function img(src, cls) { var i = el('img', cls); i.alt = ''; i.draggable = false; i.decoding = 'async'; i.loading = 'lazy'; i.src = src; return i; }
  function button(cls, text, run) { var b = el('button', cls, text); b.type = 'button'; if (run) b.addEventListener('click', function (e) { if (drag && drag.swallow) return; K.sfx('click'); run(e); }); return b; }
  function mine(m) { return m.earned > 0; }
  function shelf() { return list.filter(function (m) { return tab === 'mine' ? mine(m) : !mine(m); }); }
  function find(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function day(ms) { var d = new Date(ms); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }

  // the medal's picture (or one drawn in its colour), shining when it is a special one
  function art(m, big) {
    var a = el('span', 'md-art' + (big ? ' big' : '') + (m.glow ? ' glow' : ''));
    a.dataset.rank = m.rank;
    if (m.img) a.appendChild(img('img/medals/' + m.img + '.webp', 'md-pic'));
    else a.appendChild(el('span', 'md-blank', MARK[m.id] || Array.from(m.name)[0]));
    if (m.glow) a.appendChild(el('i', 'md-shine'));
    return a;
  }
  function rewardChip(r) {
    var c = el('span', 'md-reward');
    var pic = r.type === 'dollars' ? 'img/ui/dollar.webp' : r.type === 'coins' ? 'img/ui/coin.webp' : r.type === 'garage' ? 'img/ui/garage.webp'
      : r.type === 'ticket' ? 'img/gacha/ticket-' + r.kind + '.webp' : '';
    if (pic) c.appendChild(img(pic, r.type === 'ticket' ? 'md-reward-ticket' : ''));
    c.appendChild(el('span', '', r.type === 'dollars' ? '$' + short(r.n) : r.type === 'coins' ? 'ロイヤルコイン ×' + r.n
      : r.type === 'garage' ? 'ガレージコイン ×' + r.n : r.type === 'ticket' ? TICKET[r.kind] + '無料券 ×' + r.n
        : r.type === 'icons' ? 'シークレットアイコン ×' + r.n : r.type === 'login' ? 'ログインボーナス +' + r.n + '%' : r.name));
    return c;
  }

  /* -------------------------------------------------------------- shelf --- */
  function cell(m) {
    var b = button('md-cell', '', function () { pick(m.id); });
    b.dataset.id = m.id;
    b.dataset.rank = m.rank;
    if (!mine(m)) b.classList.add('locked');
    if (m.closed) b.classList.add('closed');
    b.setAttribute('aria-pressed', String(m.id === chosen));
    b.setAttribute('aria-label', m.name + '・' + RANK[m.rank] + (mine(m) ? m.claimed ? '' : '・受け取れます' : ''));
    b.appendChild(art(m));
    b.appendChild(el('span', 'md-name', m.name));
    if (mine(m) && !m.claimed) b.appendChild(el('b', 'md-new', '受け取る'));
    else if (m.closed) b.appendChild(el('span', 'md-state', '期間終了'));
    else if (m.progress) {
      var bar = el('i', 'md-bar'), fill = el('i', 'md-fill');
      fill.style.width = Math.round(m.progress.have / m.progress.goal * 100) + '%';
      bar.appendChild(fill);
      b.appendChild(bar);
    }
    return b;
  }
  function renderShelf() {
    var items = shelf(), track = ui.track;
    pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    var fragment = document.createDocumentFragment();
    for (var p = 0; p < pages; p++) {
      var grid = el('div', 'md-page');
      items.slice(p * PER_PAGE, (p + 1) * PER_PAGE).forEach(function (m) { grid.appendChild(cell(m)); });
      fragment.appendChild(grid);
    }
    track.replaceChildren(fragment);
    ui.empty.hidden = !!items.length;
    ui.dots.replaceChildren();
    for (var i = 0; i < pages && pages > 1; i++) {
      (function (n) {
        var d = button('md-dot', '', function () { go(n); });
        d.setAttribute('aria-label', (n + 1) + 'ページ');
        ui.dots.appendChild(d);
      })(i);
    }
    place(false);
  }
  // the pages side by side, each a little narrower than the shelf: the next one shows at the edge
  function metrics() {
    var w = ui.view.clientWidth, gap = 12, pw = Math.round(w * PEEK);
    return { w: w, pw: pw, step: pw + gap, max: Math.max(0, pages * pw + (pages - 1) * gap - w) };
  }
  function place(animate, offset) {
    var m = metrics();
    Array.prototype.forEach.call(ui.track.children, function (p) { p.style.width = m.pw + 'px'; });
    var x = Math.min(page * m.step, m.max) - (offset || 0);
    ui.track.classList.toggle('moving', !!animate);
    ui.track.style.transform = 'translateX(' + (-Math.max(-m.w * 0.25, Math.min(m.max + m.w * 0.25, x))) + 'px)';
    Array.prototype.forEach.call(ui.dots.children, function (d, i) { d.setAttribute('aria-current', i === page ? 'true' : 'false'); });
    ui.prev.disabled = page <= 0;
    ui.next.disabled = page >= pages - 1;
  }
  function go(n) {
    n = Math.max(0, Math.min(pages - 1, n));
    if (n !== page) K.sfx('click');
    page = n;
    place(true);
  }

  // a swipe along the stage (on a phone held upright the stage is turned: its x runs down the screen)
  function along(e) { var v = BR.app.view; return (v.portrait ? e.clientY : e.clientX) / (v.s || 1); }
  function swipeStart(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, at: along(e), dx: 0, moved: false, swallow: false };
  }
  function swipeMove(e) {
    if (!drag || drag.id !== e.pointerId) return;
    drag.dx = along(e) - drag.at;
    if (!drag.moved && Math.abs(drag.dx) > 12) {
      drag.moved = true;
      try { ui.view.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    }
    if (drag.moved) place(false, drag.dx);
  }
  function swipeEnd(e) {
    if (!drag || drag.id !== e.pointerId) return;
    var d = drag;
    if (d.moved) {
      d.swallow = true;
      var m = metrics();
      go(d.dx < -m.step * SWIPE ? page + 1 : d.dx > m.step * SWIPE ? page - 1 : page);
      setTimeout(function () { if (drag === d) drag = null; }, 0);
    } else drag = null;
  }
  function wheel(e) {
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 8 || Date.now() - wheelAt < 350) return;
    e.preventDefault();
    wheelAt = Date.now();
    go(page + (d > 0 ? 1 : -1));
  }

  /* ------------------------------------------------------------- detail --- */
  function renderDetail() {
    var m = find(chosen), box = ui.detail;
    box.replaceChildren();
    if (!m) return;
    box.dataset.rank = m.rank;
    box.appendChild(art(m, true));
    box.appendChild(el('span', 'md-rank', RANK[m.rank]));
    box.appendChild(el('h3', 'md-title-name', m.name));
    box.appendChild(el('p', 'md-text', m.text));
    if (!mine(m) && m.progress) {
      var bar = el('div', 'md-progress'), fill = el('i', 'md-fill');
      fill.style.width = Math.round(m.progress.have / m.progress.goal * 100) + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
      box.appendChild(el('span', 'md-count', amount(m.progress.have, m.progress.money) + ' / ' + amount(m.progress.goal, m.progress.money)));
    }
    var rewards = el('div', 'md-rewards');
    if (m.reward.length) m.reward.forEach(function (r) { rewards.appendChild(rewardChip(r)); });
    else rewards.appendChild(el('span', 'md-reward none', '報酬なし'));
    box.appendChild(rewards);
    if (mine(m) && !m.claimed) {
      var take = button('act-btn gold md-claim', m.reward.length ? '受け取る' : 'OK', function () { claim(m); });
      take.disabled = busy;
      box.appendChild(take);
    } else if (mine(m)) box.appendChild(el('span', 'md-when', day(m.earned) + ' 獲得'));
    else if (m.closed) box.appendChild(el('span', 'md-when', '期間終了'));
  }
  function pick(id) {
    chosen = id;
    Array.prototype.forEach.call(ui.track.querySelectorAll('.md-cell'), function (c) { c.setAttribute('aria-pressed', String(c.dataset.id === id)); });
    renderDetail();
  }
  function renderTabs() {
    var open = list.filter(function (m) { return !mine(m); }).length, have = list.length - open;
    var ready = list.filter(function (m) { return mine(m) && !m.claimed; }).length;
    ui.tabs.replaceChildren();
    [['open', '取得可能', open], ['mine', 'コレクション', have]].forEach(function (t) {
      var b = button('md-tab', '', function () { if (tab !== t[0]) { tab = t[0]; page = 0; chosen = ''; renderAll(); } });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === t[0]));
      b.appendChild(el('span', '', t[1]));
      b.appendChild(el('b', 'md-tab-n', String(t[2])));
      if (t[0] === 'mine' && ready) b.appendChild(el('i', 'md-tab-dot'));
      ui.tabs.appendChild(b);
    });
  }
  function renderAll() {
    renderTabs();
    var items = shelf();
    if (!find(chosen) || (tab === 'mine') !== mine(find(chosen))) {
      var first = items.filter(function (m) { return mine(m) && !m.claimed; })[0] || items[0];
      chosen = first ? first.id : '';
      if (first) page = Math.floor(items.indexOf(first) / PER_PAGE);
    }
    renderShelf();
    renderDetail();
  }

  /* ------------------------------------------------------- the server --- */
  function apply(r) {
    list = r.medals || [];
    BR.feats.set(r.ready);
    if (!tab) tab = r.ready ? 'mine' : 'open';
  }
  function load() {
    var gen = generation;
    ui.status.textContent = list.length ? '' : '読み込み中…';
    return api.medals().then(function (r) {
      if (gen !== generation) return;
      ui.status.textContent = '';
      apply(r);
      renderAll();
    }, function (e) { if (gen === generation) ui.status.textContent = e.message || '読み込めませんでした'; });
  }
  function claim(m) {
    if (busy) return;
    busy = true;
    renderDetail();
    var gen = generation;
    api.medalClaim(m.id).then(function (r) {
      if (gen !== generation) return;
      var i = list.indexOf(find(m.id));
      if (i >= 0) list[i] = r.medal;
      BR.feats.set(r.ready);
      if (r.me) { BR.social.setMe(r.me); BR.app.serverBalance(r.me, true); }
      if (!r.again && r.reward.length) {
        K.sfx('win');
        var names = (r.icons || []).map(function (id) { var a = K.avatarInfo(id); return a ? a.name : id; });
        K.toast('受け取りました：' + r.reward.map(function (x) {
          return x.type === 'dollars' ? '$' + short(x.n) : x.type === 'coins' ? 'ロイヤルコイン×' + x.n : x.type === 'garage' ? 'ガレージコイン×' + x.n
            : x.type === 'ticket' ? TICKET[x.kind] + '無料券×' + x.n : x.type === 'icons' ? 'シークレットアイコン（' + names.join('・') + '）'
              : x.type === 'login' ? 'ログインボーナス+' + x.n + '%' : x.name;
        }).join('、'), 4200);
        root.classList.remove('md-got');
        void root.offsetWidth;
        root.classList.add('md-got');
      }
      busy = false;
      renderAll();
      // (a medal that came with the reward)
      if (r.reward.some(function (x) { return x.type === 'medal'; })) load();
    }, function (e) {
      if (gen !== generation) return;
      busy = false;
      renderDetail();
      K.fail(e);
    });
  }

  function open() {
    if (!api.online || !api.hasToken()) { K.fail({ message: 'ログインしてから利用してください' }); return; }
    generation++;
    busy = false;
    K.showModal('medals-modal');
    renderAll();
    load();
  }

  BR.medals = {
    open: open,
    // a medal earned while the screen is open: shown at once
    earned: function () { if (shown()) load(); },
    reset: function () { generation++; list = []; tab = ''; chosen = ''; page = 0; busy = false; },
    init: function () {
      root = byId('medals-modal');
      ['tabs', 'view', 'track', 'dots', 'detail', 'status', 'empty', 'prev', 'next'].forEach(function (k) { ui[k] = byId('md-' + k); });
      K.registerModal('medals-modal');
      ui.prev.addEventListener('click', function () { go(page - 1); });
      ui.next.addEventListener('click', function () { go(page + 1); });
      ui.view.addEventListener('pointerdown', swipeStart);
      ui.view.addEventListener('pointermove', swipeMove);
      ui.view.addEventListener('pointerup', swipeEnd);
      ui.view.addEventListener('pointercancel', swipeEnd);
      ui.view.addEventListener('wheel', wheel, { passive: false });
      // (a click that ended a swipe opens nothing)
      ui.view.addEventListener('click', function (e) { if (drag && drag.swallow) { e.stopPropagation(); e.preventDefault(); drag = null; } }, true);
      window.addEventListener('resize', function () { if (shown()) place(false); });
      root.addEventListener('closed', function () { generation++; busy = false; });
    }
  };
})(window.BR = window.BR || {});
