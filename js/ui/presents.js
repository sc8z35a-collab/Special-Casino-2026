/* Presents in a chat (server: POST /api/present and /api/present/claim). The
   gift button left of the message bar opens the five presents (クッキー $1万,
   クマのぬいぐるみ $5万, 雪だるま $10万, パンプキンヘッド $25万, ダイヤモンド $100万);
   the sender pays when it is sent, and the friend taps it in the chat once
   to get its price in $. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx;

  var to = null;        // { id, name } of the friend it goes to
  var pick = '';        // the chosen present
  var busy = false;
  var claiming = {};    // message id -> true while it is being received

  function list() { return BR.CONFIG.presents; }
  function info(id) {
    var l = list();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function name(id) { var p = info(id); return p ? p.name : 'プレゼント'; }
  function pic(id, cls) {
    var n = el('span', 'pr-pic' + (cls ? ' ' + cls : ''));
    var src = BR.SOCIAL_IMG.presents[id];
    if (src) n.style.backgroundImage = 'url("' + src + '")';
    return n;
  }
  function dollars() { return S.dollars || 0; }

  /* ------------------------------------------------------------ choosing one --- */
  function open(user) {
    if (!user) return;
    to = { id: user.id, name: user.name };
    pick = '';
    busy = false;
    $('#pr-name').textContent = user.name;
    render();
    K.showModal('present');
  }
  function render() {
    var grid = $('#pr-grid');
    grid.textContent = '';
    list().forEach(function (p) {
      var b = el('button', 'pr-tile' + (pick === p.id ? ' on' : ''));
      b.type = 'button';
      b.dataset.id = p.id;
      b.disabled = busy || dollars() < p.price;
      b.appendChild(pic(p.id));
      b.appendChild(el('span', 'pr-tile-name', p.name));
      b.appendChild(K.amountEl(p.price, 'dollars', 'pr-tile-price'));
      grid.appendChild(b);
    });
    var p = info(pick);
    $('#pr-note').textContent = p ? p.name + 'を贈ります（相手はタップで $' + U.fmt(p.price) + ' を受け取れます）'
      : '所持 $' + U.fmt(dollars()) + '・相手はタップでその金額を受け取れます';
    var go = $('#pr-go');
    go.disabled = busy || !p || dollars() < p.price;
    go.textContent = busy ? '贈っています…' : 'プレゼントする';
  }
  function send() {
    var p = info(pick);
    if (!p || busy || !to) return;
    busy = true;
    render();
    api.present(to.id, p.id).then(function (r) {
      busy = false;
      if (r.balance) BR.app.serverBalance(r.balance);
      K.closeModal('present');
      sfx('send');
      BR.social.onMsg(r.message);
      toast(to.name + 'さんに' + p.name + 'を贈りました');
    }, function (err) {
      busy = false;
      render();
      K.fail(err);
    });
  }
  function toast(t) { K.toast(t, 2600); }

  /* ------------------------------------------------------------ in the chat --- */
  // the card: the friend's to tap (once); the sender sees whether it was received
  function bubble(m, mine) {
    var p = info(m.text);
    var open = !mine && !m.claimed && !K.receiptExpired(m);
    var node = el('div', 'msg xfer present' + (mine ? ' mine' : ' theirs') + (open ? ' can-claim' : '') + (m.claimed ? ' claimed' : ''));
    node.dataset.pid = m.id;
    var card = el(open ? 'button' : 'div', 'xfer-card present-card');
    if (open) card.type = 'button';
    card.appendChild(el('div', 'xfer-label', mine ? 'プレゼントを贈りました' : 'プレゼントが届きました！'));
    card.appendChild(pic(m.text, 'big'));
    card.appendChild(el('div', 'gift-name', p ? p.name : 'プレゼント'));
    card.appendChild(K.amountEl(m.amount || (p ? p.price : 0), 'dollars', 'pr-worth'));
    card.appendChild(el('div', 'pr-state', K.receiptExpired(m) ? '期限を過ぎたため受け取れません' : mine ? (m.claimed ? '受け取られました' : 'まだ受け取られていません')
      : m.claimed ? '受け取り済み' : claiming[m.id] ? '受け取っています…' : 'タップして受け取る'));
    K.receiptHint(card, m);
    if (open) card.addEventListener('click', function () { claim(m); });
    node.appendChild(card);
    return node;
  }
  function claim(m) {
    if (m.claimed || K.receiptExpired(m) || claiming[m.id]) return;
    claiming[m.id] = true;
    BR.social.refreshMsg(m.id);
    api.presentClaim(m.id).then(function (r) {
      delete claiming[m.id];
      m.claimed = true;
      if (r.balance) BR.app.serverBalance(r.balance);
      sfx('money');
      toast(name(m.text) + 'を受け取りました！ +$' + U.fmt(r.paid));
      if (BR.juice && BR.juice.reward) BR.juice.reward('#toast', 2);
      BR.social.refreshMsg(m.id);
    }, function (err) {
      delete claiming[m.id];
      if (err && err.code === 'claimed') m.claimed = true;
      if (err && err.code === 'expired') m.expired = true;
      BR.social.refreshMsg(m.id);
      K.fail(err);
    });
  }
  // the message list's line for it
  function preview(last) {
    return (last.mine ? 'プレゼントしました: ' : 'プレゼントが届きました: ') + name(last.text);
  }

  function init() {
    K.registerModal('present');
    $('#pr-grid').addEventListener('click', function (e) {
      var b = e.target.closest('.pr-tile');
      if (!b || b.disabled) return;
      sfx('click');
      pick = b.dataset.id;
      render();
    });
    $('#pr-go').addEventListener('click', function () { sfx('click'); send(); });
  }

  BR.presents = {
    init: init,
    open: open,
    bubble: bubble,
    preview: preview,
    name: name
  };
})(window.BR = window.BR || {});
