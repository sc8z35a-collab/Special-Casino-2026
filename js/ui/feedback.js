/* 運営へのフィードバック: players rate six things from 1 to 5 stars (any of
   them may be left out) and write whatever they like, as long as they like;
   only the operator's account (FEEDBACK_ADMIN on the server, "taku") reads it,
   in the menu's フィードバック tab. Players who have played a while are asked
   once (the form opens by itself); after ✕ a small icon stays at the top
   right of the slot screen until they have sent something. The form is an
   overlay outside the scaled stage, so the text field keeps a normal size. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$, $$ = U.$$;
  var el = K.el;
  var ASKED = 'blockbuster-reels/feedback-asked';   // the form has opened by itself once
  var SEEN = 'blockbuster-reels/feedback-seen';     // the operator: how many have been read
  var NOTE = '改善点とかお構いなしに書いてくれると助かります。';
  var ITEMS = [
    { key: 'slot', label: 'スロットの面白さ' },
    { key: 'features', label: 'スロット以外の機能の面白さ' },
    { key: 'clarity', label: '全体的なわかりやすさ' },
    { key: 'controls', label: '操作性' },
    { key: 'looks', label: '見やすさ' },
    { key: 'polish', label: '完成度' }
  ];
  var LONG = 420;   // comments longer than this start folded in the operator's list
  // a speech bubble with a star
  var OFFER_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true">' +
    '<path d="M6 5h20a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H14l-6 5v-5H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="#fff"/>' +
    '<path d="M16 8.6l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#e8a91b"/></svg>';

  var me = null;
  var root = null, ta = null, sendBtn = null, errBox = null, offer = null;
  var ratings = {}, sending = false;
  var prompting = false, promptTimer = 0, askedNow = false;
  var admin = { data: null, seq: 0, count: null };

  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* kept for this visit only */ } }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* ------------------------------------------------------------ the form --- */
  function build() {
    root = el('div', 'ov fb-ov');
    root.id = 'fb-ov';
    root.hidden = true;
    var sc = el('div', 'ov-scroll');
    var form = el('form', 'ov-card wide fb-card');
    form.setAttribute('novalidate', '');
    form.setAttribute('autocomplete', 'off');

    var x = el('button', 'ov-close');
    x.type = 'button';
    x.setAttribute('aria-label', '閉じる');
    x.addEventListener('click', function () { K.sfx('click'); close(); });
    form.appendChild(x);
    form.appendChild(el('div', 'ov-brand', 'Two state Casino RP'));
    form.appendChild(el('h2', 'ov-title', '運営にフィードバックを送ろう'));
    form.appendChild(el('p', 'ov-text fb-lead', '遊んでみた感想を星1〜5で教えてください。つけたい項目だけでも送れます。'));

    var rates = el('div', 'fb-rates');
    ITEMS.forEach(function (it) {
      var row = el('div', 'fb-rate');
      row.dataset.key = it.key;
      row.appendChild(el('span', 'fb-label', it.label));
      var stars = el('span', 'fb-stars');
      stars.setAttribute('role', 'group');
      stars.setAttribute('aria-label', it.label);
      for (var n = 1; n <= 5; n++) {
        var b = el('button', 'fb-star');
        b.type = 'button';
        b.dataset.n = n;
        b.setAttribute('aria-label', it.label + '：星' + n);
        b.appendChild(el('i'));
        stars.appendChild(b);
      }
      row.appendChild(stars);
      rates.appendChild(row);
    });
    // a star sets the rating; the same star again takes it back
    rates.addEventListener('click', function (e) {
      var b = e.target.closest('.fb-star');
      if (!b || sending) return;
      var key = b.closest('.fb-rate').dataset.key, n = Number(b.dataset.n);
      ratings[key] = ratings[key] === n ? 0 : n;
      K.sfx('click');
      render();
    });
    form.appendChild(rates);

    var note = el('label', 'fb-note', NOTE);
    note.htmlFor = 'fb-comment';
    form.appendChild(note);
    ta = document.createElement('textarea');
    ta.id = 'fb-comment';
    ta.className = 'ov-input fb-comment';
    ta.rows = 4;
    ta.placeholder = '自由に書いてください（文字数の制限はありません）';
    ta.addEventListener('input', function () { grow(); render(); });
    form.appendChild(ta);

    errBox = el('p', 'ov-error');
    errBox.setAttribute('role', 'alert');
    form.appendChild(errBox);
    sendBtn = el('button', 'ov-btn gold', '送信する');
    sendBtn.type = 'submit';
    form.appendChild(sendBtn);
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    sc.appendChild(form);
    root.appendChild(sc);
    document.body.appendChild(root);
  }

  function filled() {
    for (var i = 0; i < ITEMS.length; i++) if (ratings[ITEMS[i].key] > 0) return true;
    return false;
  }

  function render() {
    if (!root) return;
    $$('.fb-rate', root).forEach(function (row) {
      var v = ratings[row.dataset.key] || 0;
      $$('.fb-star', row).forEach(function (b) {
        var on = Number(b.dataset.n) <= v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    sendBtn.disabled = sending || !(filled() || ta.value.trim());
    sendBtn.textContent = sending ? '送信中…' : '送信する';
  }

  // the comment box grows with the text, up to about half the screen
  function grow() {
    if (!ta) return;
    var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, Math.max(120, Math.round(vh * 0.45))) + 'px';
  }

  function open() {
    if (!api.online || !BR.social.me()) {
      K.sfx('deny');
      K.toast('ログインするとフィードバックを送れます');
      return;
    }
    if (!root) build();
    stopPrompt();
    errBox.textContent = '';
    root.hidden = false;
    K.fitOverlay(root);
    render();
    grow();
    root.querySelector('.ov-scroll').scrollTop = 0;
  }

  function close() {
    if (!root || root.hidden) return;
    if (ta) ta.blur();
    root.hidden = true;
    renderOffer();
    if (BR.app && BR.app.relayout) BR.app.relayout();
  }

  function isOpen() { return !!root && !root.hidden; }

  function submit() {
    if (sending) return;
    var comment = ta.value;
    var r = {};
    ITEMS.forEach(function (it) { r[it.key] = ratings[it.key] || 0; });
    if (!filled() && !comment.trim()) return;
    sending = true;
    errBox.textContent = '';
    render();
    api.sendFeedback(r, comment.trim() ? comment : '').then(function (res) {
      sending = false;
      ratings = {};
      ta.value = '';
      close();
      render();
      if (res && res.me) BR.social.setMe(res.me);
      K.sfx('notify');
      K.toast('フィードバックを送りました。ありがとうございます！', 3400);
    }, function (err) {
      sending = false;
      errBox.textContent = err && err.message ? err.message : '送信できませんでした。もう一度お試しください';
      render();
    });
  }

  /* ------------------------------------------------------------ the icon at the top right --- */
  function buildOffer() {
    var slot = $('#screen-slot');
    if (!slot) return;
    offer = el('button', 'fb-offer');
    offer.type = 'button';
    offer.id = 'btn-feedback';
    offer.setAttribute('aria-label', '運営にフィードバックを送る');
    offer.innerHTML = OFFER_SVG;
    offer.hidden = true;
    offer.addEventListener('click', function () { K.sfx('click'); open(); });
    slot.appendChild(offer);
  }
  function renderOffer() {
    if (offer) offer.hidden = !(api.online && me && me.feedback === 'ask');
  }

  /* ------------------------------------------------------------ asking once --- */
  function asked() { return askedNow || stored(ASKED) === '1'; }
  function stopPrompt() {
    prompting = false;
    clearTimeout(promptTimer);
  }
  function maybePrompt() {
    if (prompting || asked()) return;
    prompting = true;
    clearTimeout(promptTimer);
    promptTimer = setTimeout(tryPrompt, 1500);
  }
  // only on the slot screen with nothing else going on
  function blocked() {
    var L = BR.launch;
    if (document.hidden) return true;
    if (!L || !L.done() || L.introPlaying() || L.maintenance()) return true;
    if (BR.account && BR.account.isOpen()) return true;
    if (BR.bonus && BR.bonus.busy()) return true;
    if (BR.guide && BR.guide.active && BR.guide.active()) return true;
    if (BR.entry && BR.entry.isOpen()) return true;
    if (BR.screens.current() !== 'slot') return true;
    if (BR.game && (BR.game.busy() || BR.game.auto)) return true;
    if (BR.watch && BR.watch.active()) return true;
    var th = $('#thanks'), np = $('#numpad');
    if ((th && !th.hidden) || (np && !np.hidden)) return true;
    if (document.querySelector('#stage .modal:not([hidden]), .ov:not([hidden])')) return true;
    return false;
  }
  function tryPrompt() {
    if (!prompting) return;
    if (!me || me.feedback !== 'ask' || asked()) { prompting = false; return; }
    if (blocked()) { promptTimer = setTimeout(tryPrompt, 800); return; }
    prompting = false;
    askedNow = true;
    store(ASKED, '1');
    open();
  }

  /* ------------------------------------------------------------ the operator's tab --- */
  function seen() { return Number(stored(SEEN)) || 0; }
  function adminCount() {
    var n = me && me.feedbackAdmin ? me.feedbackCount || 0 : 0;
    return admin.count !== null ? Math.max(admin.count, n) : n;
  }
  function renderDot() {
    var dot = $('#feedback-dot');
    if (dot) dot.hidden = !(me && me.feedbackAdmin && adminCount() > seen());
  }
  function paneShown() {
    var p = $('#pane-feedback');
    return BR.screens.current() === 'board' && !!p && p.classList.contains('active');
  }

  function starRow(v, cls) {
    var box = el('span', 'fb-mini-stars' + (cls ? ' ' + cls : ''));
    for (var i = 1; i <= 5; i++) {
      var s = el('i');
      if (v >= i - 0.25) s.className = 'on';
      else if (v >= i - 0.75) s.className = 'half';
      box.appendChild(s);
    }
    return box;
  }
  function stamp(ts) {
    var d = new Date(ts);
    return K.fmtDate(ts) + ' ' + d.getHours() + ':' + pad2(d.getMinutes());
  }

  function adminNote(text) {
    var list = $('#fb-list');
    list.textContent = '';
    list.appendChild(el('div', 'empty', text));
  }

  function renderAdmin(r) {
    var list = $('#fb-list');
    list.textContent = '';
    var sum = el('section', 'fb-sum');
    var head = el('div', 'fb-sum-head');
    head.appendChild(el('span', '', 'みんなのフィードバック'));
    head.appendChild(el('b', '', U.fmt(r.count)));
    head.appendChild(el('span', 'fb-sum-unit', '件'));
    sum.appendChild(head);
    var avg = el('div', 'fb-avg');
    ITEMS.forEach(function (it) {
      var v = r.average ? r.average[it.key] : null;
      var cell = el('div', 'fb-avg-item');
      cell.appendChild(el('span', 'fb-avg-label', it.label));
      var val = el('span', 'fb-avg-val');
      if (typeof v === 'number') {
        val.appendChild(starRow(v));
        val.appendChild(el('b', '', v.toFixed(1)));
      } else {
        val.appendChild(el('b', 'none', '–'));
      }
      cell.appendChild(val);
      avg.appendChild(cell);
    });
    sum.appendChild(avg);
    list.appendChild(sum);

    if (!r.feedback.length) {
      list.appendChild(el('div', 'empty', 'まだフィードバックはありません'));
      return;
    }
    r.feedback.forEach(function (f) {
      var item = el('article', 'fb-item');
      var top = el('div', 'fb-item-head');
      top.appendChild(K.avatarEl(f.user || {}, 'sm'));
      top.appendChild(el('span', 'fb-item-name uname', f.user && f.user.name ? f.user.name : '（いないプレイヤー）'));
      top.appendChild(el('span', 'fb-item-time', stamp(f.at)));
      item.appendChild(top);
      var rates = el('div', 'fb-item-rates');
      ITEMS.forEach(function (it) {
        var v = f.ratings ? f.ratings[it.key] : 0;
        var row = el('div', 'fb-item-rate');
        row.appendChild(el('span', 'fb-item-label', it.label));
        row.appendChild(v > 0 ? starRow(v) : el('span', 'none', '–'));
        rates.appendChild(row);
      });
      item.appendChild(rates);
      var text = f.comment || '';
      var c = el('p', 'fb-item-comment' + (text ? '' : ' none'), text || '（コメントなし）');
      item.appendChild(c);
      if (text.length > LONG || text.split('\n').length > 10) {
        c.classList.add('long');
        var more = el('button', 'text-btn fb-more', '全文を表示');
        more.type = 'button';
        item.appendChild(more);
      }
      list.appendChild(item);
    });
  }

  function showAdmin() {
    var list = $('#fb-list');
    if (!list) return;
    var seq = ++admin.seq;
    if (admin.data) renderAdmin(admin.data);
    else adminNote('読み込み中…');
    api.feedback().then(function (r) {
      if (seq !== admin.seq) return;
      admin.data = r;
      admin.count = r.count;
      store(SEEN, String(r.count));
      renderDot();
      renderAdmin(r);
    }, function (err) {
      if (seq !== admin.seq) return;
      if (admin.data) K.fail(err);
      else adminNote(err && err.message ? err.message : '読み込めませんでした');
    });
  }

  function onLive(d) {
    if (!me || !me.feedbackAdmin) return;
    admin.count = Math.max(admin.count || 0, (d && d.count) || 0);
    K.sfx('message');
    K.toast('新しいフィードバックが届きました' + (d && d.from && d.from.name ? '（' + K.clip(d.from.name, 12) + 'さん）' : ''), 3200);
    if (paneShown()) showAdmin();
    else renderDot();
  }

  /* ------------------------------------------------------------ my profile --- */
  function onMe(m) {
    me = m;
    if (!m) {
      stopPrompt();
      close();
      admin.data = null;
      admin.count = null;
    }
    renderOffer();
    renderDot();
    if (m && m.feedback === 'ask') maybePrompt();
    else stopPrompt();
  }

  function init() {
    buildOffer();
    var list = $('#fb-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var b = e.target.closest('.fb-more');
        if (!b) return;
        var c = b.previousElementSibling;
        if (c) c.classList.remove('long');
        b.parentNode.removeChild(b);
        K.sfx('click');
      });
    }
    if (!api.online) return;
    BR.social.onMe(onMe);
    BR.live.on('feedback', onLive);
  }

  BR.feedback = {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    showAdmin: showAdmin
  };
})(window.BR = window.BR || {});
