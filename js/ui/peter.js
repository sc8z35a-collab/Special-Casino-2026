/* ピーター in the chat: always online, top of the message list. His own
   offers come with his voice, played once when the chat is opened, and a
   「借りる」 button while the offer stands; the chat header shows what is
   owed with a 「返済する」 button. Loans can also be asked for in plain words
   ("300万貸して"): the server reads them. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var VOICED = 'blockbuster-reels/peter-voiced';

  var who = null;      // { id, name, avatar, npc }
  var debt = null;     // { principal, owed, offer, stage, chat, max, available }
  var busy = false;

  function is(user) { return !!user && (user.npc === 'peter' || (who && user.id === who.id)); }
  function yen(n) {
    var man = Math.floor(n / 10000), rest = n % 10000;
    if (!man) return rest + '円';
    return rest ? man + '万' + rest + '円' : man + '万円';
  }
  function offerAmount(n) { var o = BR.CONFIG.lender.offers[n - 1]; return o ? o.amount : 0; }

  function voiced() { try { return JSON.parse(localStorage.getItem(VOICED) || '[]'); } catch (e) { return []; } }
  function markVoiced(id) {
    var list = voiced();
    if (list.indexOf(id) >= 0) return;
    list.push(id);
    try { localStorage.setItem(VOICED, JSON.stringify(list.slice(-30))); } catch (e) { /* plays again next time */ }
  }

  function play(n) {
    var url = BR.LAUNCH_MEDIA.peter[n - 1];
    if (url) BR.sfx.voice(url).catch(function () { /* sound not allowed yet */ });
  }

  /* ------------------------------------------------------------ state --- */
  function load() {
    return api.peter().then(function (r) {
      who = r.peter;
      debt = r.debt;
      refresh();
      return r;
    });
  }
  function setDebt(d) {
    if (!d) return;
    debt = d;
    refresh();
  }
  // the open chat with him follows
  function refresh() {
    if (!BR.social.peerIs || !BR.social.peerIs(who)) return;
    renderHead();
    BR.social.rerenderChat();
  }

  /* ------------------------------------------------------------ the chat --- */
  function renderHead() {
    var box = $('#dm-debt');
    box.hidden = false;
    var owed = debt ? debt.owed : null;
    $('#dm-debt-amt').textContent = owed === null ? '-' : owed > 0 ? '$' + U.fmt(owed) : 'なし';
    // he lends 累計1100万円 at most, ever (paying back does not bring it back)
    var max = debt ? debt.max : BR.CONFIG.lender.max;
    $('#dm-debt-cap').textContent = '貸してくれるのは累計' + yen(max) + 'まで' + (debt ? '（あと' + yen(debt.available) + '）' : '');
    $('#dm-repay').disabled = !(owed > 0) || busy;
  }

  // one of his offers, with his voice and the 「借りる」 button while it stands
  function offerEl(m) {
    var node = el('div', 'msg theirs peter-offer');
    var bubble = el('div', 'bubble');
    bubble.appendChild(el('div', 'offer-text', m.text));
    var row = el('div', 'offer-acts');
    var again = el('button', 'offer-voice');
    again.type = 'button';
    again.setAttribute('aria-label', 'もう一度聞く');
    again.appendChild(K.icon('speaker'));
    again.addEventListener('click', function () { sfx('click'); play(m.amount); });
    row.appendChild(again);
    var open = !!debt && debt.offer === m.amount;
    var take = el('button', 'act-btn gold offer-take', open ? '借りる（' + yen(offerAmount(m.amount)) + '）' : debt ? 'この話は終わりました' : '…');
    take.type = 'button';
    take.disabled = !open || busy;
    take.addEventListener('click', function () { sfx('click'); borrow(m.amount); });
    row.appendChild(take);
    bubble.appendChild(row);
    node.appendChild(bubble);
    node.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
    return node;
  }

  function borrow(n) {
    if (busy) return;
    busy = true;
    refresh();
    api.borrow(n).then(function (r) {
      BR.app.serverBalance(r.me);
      BR.social.setMe(r.me);
      BR.social.onMsg(r.reply);
      if (r.lent) BR.social.onMsg(r.lent);
      sfx('purchase');
      toast(yen(r.amount) + '貸しました（利息' + r.rate + '%・返済額 ' + yen(r.owed) + '）', 4200);
      busy = false;
      setDebt(r.debt);
    }, function (err) {
      busy = false;
      fail(err);
      load().catch(function () {});
    });
  }

  function repay() {
    if (!debt || !(debt.owed > 0) || busy) return;
    var max = Math.min(debt.owed, S.dollars);
    if (max <= 0) { sfx('deny'); toast('$が足りません'); return; }
    BR.screens.numpad({
      icon: 'dollar',
      value: max,
      max: max,
      onOk: function (n) {
        if (!(n > 0)) return;
        K.confirmBox(function (p) {
          p.appendChild(document.createTextNode('ピーターに'));
          p.appendChild(K.amountEl(n, 'dollars', 'confirm-amt'));
          p.appendChild(document.createTextNode('返済しますか？'));
          p.appendChild(el('small', 'confirm-sub', n >= debt.owed ? 'これで全額返済です。' : '返済後の残り: $' + U.fmt(debt.owed - n)));
        }, '返済する').then(function (ok) {
          if (!ok) return;
          busy = true;
          refresh();
          api.repay(n).then(function (r) {
            BR.app.serverBalance(r.me);
            BR.social.setMe(r.me);
            BR.social.onMsg(r.reply);
            sfx('purchase');
            busy = false;
            setDebt(r.debt);
          }, function (err) { busy = false; refresh(); fail(err); });
        });
      }
    });
  }

  // The chat with him was opened (or a message came while it is open):
  // his newest offer that has not been heard plays once.
  function opened(list) {
    load().catch(function () {});
    var heard = voiced(), last = null;
    (list || []).forEach(function (m) { if (m.kind === 'offer') last = m; });
    if (last && heard.indexOf(last.id) < 0) {
      markVoiced(last.id);
      play(last.amount);
    }
  }

  // a message from him arrived (the chat is not open): tap to open it
  function notify(m, open) {
    sfx('notify');
    toast('ピーター: ' + K.clip(m.text, 30), 4200, open);
  }

  function init() {
    $('#dm-repay').addEventListener('click', function () { sfx('click'); repay(); });
    if (!api.online) return;
    BR.live.on('hello', function (h) { if (h.peter) who = h.peter; });
    BR.live.on('msg', function (m) {
      if (!m || !m.from || !is(m.from) || m.kind !== 'offer') return;
      load().catch(function () {});
      // already looking at his chat: hear it now
      if (BR.social.peerIs && BR.social.peerIs(who) && BR.social.viewingDm()) opened([m]);
    });
  }

  BR.peter = {
    init: init,
    is: is,
    set: function (p) { if (p) who = p; },
    who: function () { return who; },
    offerEl: offerEl,
    renderHead: renderHead,
    opened: opened,
    notify: notify,
    setDebt: setDebt,
    // the row shown at the top of the message list before he has written
    placeholder: function () {
      return who ? { user: { id: who.id, name: who.name, avatar: who.avatar, online: true, npc: 'peter' }, unread: 0, at: 0, friend: false, last: null } : null;
    }
  };
})(window.BR = window.BR || {});
