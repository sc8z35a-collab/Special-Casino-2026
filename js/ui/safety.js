/* Asking and telling the operators, in overlays outside the scaled stage
   (normal-sized text fields, like js/ui/feedback.js):
   - 18歳以上？ (in Japanese and English): asked once, at launch, of everyone
     who has not answered yet; nothing in the game depends on it for now, the
     operator site shows it.
   - 通報: a player (friend or not) from their profile, a hub's member card or
     the friend search; a kind and as much text as needed, a warning about
     false reports, and the operators' answer once it is sent.
   - 報告 (a bug, an error) and 意見案 (an idea) to Ice Smoker公式ボット: they
     arrive in the chat with the bot, and on the operator site. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $$ = U.$$;
  var el = K.el;

  /* ------------------------------------------------------------ 18歳以上？ --- */
  var age = { root: null, busy: false, asked: 0, timer: 0 };
  function buildAge() {
    var root = el('div', 'ov sf-ov age-ov');
    root.hidden = true;
    var sc = el('div', 'ov-scroll');
    var card = el('div', 'ov-card sf-card age-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '年齢確認 / Age check');
    card.appendChild(el('div', 'ov-brand', 'Two state Casino RP'));
    card.appendChild(el('h2', 'ov-title', 'あなたは18歳以上ですか？'));
    card.appendChild(el('p', 'age-en', 'Are you 18 years of age or older?'));
    card.appendChild(el('p', 'ov-text age-note', '最初に一度だけおたずねします。\nWe ask this only once.'));
    var err = el('p', 'ov-error');
    err.setAttribute('role', 'alert');
    var row = el('div', 'ov-row age-row');
    [[false, 'いいえ', 'No', ''], [true, 'はい', 'Yes', 'gold']].forEach(function (a) {
      var b = el('button', 'ov-btn age-btn' + (a[3] ? ' ' + a[3] : ''));
      b.type = 'button';
      b.appendChild(el('span', '', a[1]));
      b.appendChild(el('small', '', a[2]));
      b.addEventListener('click', function () { answerAge(a[0]); });
      row.appendChild(b);
    });
    card.appendChild(row);
    card.appendChild(err);
    sc.appendChild(card);
    root.appendChild(sc);
    document.body.appendChild(root);
    age.root = root;
    age.err = err;
  }
  function answerAge(adult) {
    if (age.busy) return;
    age.busy = true;
    age.err.textContent = '';
    $$('.age-btn', age.root).forEach(function (b) { b.disabled = true; });
    K.sfx('click');
    api.age(adult).then(function (r) {
      age.busy = false;
      age.root.hidden = true;
      if (r && r.me) BR.social.setMe(r.me);
    }, function (e) {
      age.busy = false;
      $$('.age-btn', age.root).forEach(function (b) { b.disabled = false; });
      age.err.textContent = (e && e.message ? e.message : '送信できませんでした') + '\nCould not be sent. Please try again.';
    });
  }
  // the account loaded: not answered yet, it is asked (as soon as the
  // studio logos are over)
  function onMe(me) {
    clearTimeout(age.timer);
    if (!me) { if (age.root) age.root.hidden = true; age.asked = 0; return; }
    if (me.age !== null && me.age !== undefined) { if (age.root) age.root.hidden = true; return; }
    if (age.asked === me.id && age.root && !age.root.hidden) return;
    if (BR.launch && !BR.launch.done()) { age.timer = setTimeout(function () { onMe(BR.social.me()); }, 500); return; }
    if (!age.root) buildAge();
    age.asked = me.id;
    $$('.age-btn', age.root).forEach(function (b) { b.disabled = false; });
    age.err.textContent = '';
    age.root.hidden = false;
    K.fitOverlay(age.root);
  }

  /* ------------------------------------------------------------ a long form --- */
  // cfg: { title, lead, kinds, kindTitle, label, placeholder, warn, send: label,
  //        submit(kind, text) -> Promise, done(result) -> the thanks to show, or null to close }
  var form = null;
  function openForm(cfg) {
    closeForm();
    var root = el('div', 'ov sf-ov');
    var sc = el('div', 'ov-scroll');
    var card = el('form', 'ov-card wide sf-card');
    card.setAttribute('novalidate', '');
    card.setAttribute('autocomplete', 'off');
    var f = { root: root, card: card, kind: '', busy: false, cfg: cfg };
    form = f;

    var x = el('button', 'ov-close');
    x.type = 'button';
    x.setAttribute('aria-label', '閉じる');
    x.addEventListener('click', function () { K.sfx('click'); closeForm(); });
    card.appendChild(x);
    var title = el('h2', 'ov-title sf-title');
    if (typeof cfg.title === 'string') title.textContent = cfg.title;
    else title.appendChild(cfg.title);
    card.appendChild(title);
    if (cfg.lead) card.appendChild(el('p', 'ov-text sf-lead', cfg.lead));

    if (cfg.kinds) {
      card.appendChild(el('div', 'sf-label', cfg.kindTitle || '種類'));
      var chips = el('div', 'sf-kinds');
      chips.setAttribute('role', 'radiogroup');
      cfg.kinds.forEach(function (k) {
        var b = el('button', 'sf-kind', k.name);
        b.type = 'button';
        b.dataset.kind = k.id;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', 'false');
        chips.appendChild(b);
      });
      chips.addEventListener('click', function (e) {
        var b = e.target.closest('.sf-kind');
        if (!b || f.busy) return;
        K.sfx('click');
        f.kind = b.dataset.kind;
        render(f);
      });
      card.appendChild(chips);
      f.chips = chips;
    }

    var lab = el('label', 'sf-label', cfg.label || '内容');
    lab.htmlFor = 'sf-text';
    card.appendChild(lab);
    var ta = document.createElement('textarea');
    ta.id = 'sf-text';
    ta.className = 'ov-input sf-text';
    ta.rows = 5;
    ta.placeholder = cfg.placeholder || '自由に書いてください（文字数の制限はありません）';
    ta.addEventListener('input', function () { grow(f); render(f); });
    card.appendChild(ta);
    f.ta = ta;
    if (cfg.warn) card.appendChild(el('p', 'ov-notice sf-warn', cfg.warn));
    var err = el('p', 'ov-error');
    err.setAttribute('role', 'alert');
    card.appendChild(err);
    f.err = err;
    var send = el('button', 'ov-btn gold', cfg.send || '送信する');
    send.type = 'submit';
    card.appendChild(send);
    f.sendBtn = send;
    card.addEventListener('submit', function (e) { e.preventDefault(); submit(f); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
    });

    sc.appendChild(card);
    root.appendChild(sc);
    document.body.appendChild(root);
    K.fitOverlay(root);
    render(f);
    grow(f);
  }
  function render(f) {
    if (f.chips) {
      $$('.sf-kind', f.chips).forEach(function (b) {
        var on = b.dataset.kind === f.kind;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    f.sendBtn.disabled = f.busy || !f.ta.value.trim() || (!!f.chips && !f.kind);
    f.sendBtn.textContent = f.busy ? '送信中…' : f.cfg.send || '送信する';
  }
  // the box grows with the text, up to about half the screen
  function grow(f) {
    var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    f.ta.style.height = 'auto';
    f.ta.style.height = Math.min(f.ta.scrollHeight + 2, Math.max(140, Math.round(vh * 0.45))) + 'px';
  }
  function submit(f) {
    if (f.busy || !f.ta.value.trim() || (f.chips && !f.kind)) return;
    f.busy = true;
    f.err.textContent = '';
    render(f);
    f.cfg.submit(f.kind, f.ta.value).then(function (r) {
      f.busy = false;
      var thanks = f.cfg.done ? f.cfg.done(r) : null;
      if (form !== f) return;
      if (!thanks) { closeForm(); return; }
      // the answer, in place of the form
      f.ta.blur();
      f.card.textContent = '';
      var x = el('button', 'ov-close');
      x.type = 'button';
      x.setAttribute('aria-label', '閉じる');
      x.addEventListener('click', function () { K.sfx('click'); closeForm(); });
      f.card.appendChild(x);
      f.card.appendChild(el('i', 'sf-done-mark'));
      f.card.appendChild(el('p', 'sf-done', thanks));
      var ok = el('button', 'ov-btn gold', '閉じる');
      ok.type = 'button';
      ok.addEventListener('click', function () { K.sfx('click'); closeForm(); });
      f.card.appendChild(ok);
      K.sfx('notify');
    }, function (e) {
      f.busy = false;
      f.err.textContent = e && e.message ? e.message : '送信できませんでした。もう一度お試しください';
      render(f);
    });
  }
  function closeForm() {
    if (!form) return;
    var f = form;
    form = null;
    if (f.ta) f.ta.blur();
    if (f.root.parentNode) f.root.parentNode.removeChild(f.root);
    if (BR.app && BR.app.relayout) BR.app.relayout();
  }
  function ready() {
    if (api.online && BR.social.me()) return true;
    K.sfx('deny');
    K.toast('ログインすると使えます');
    return false;
  }

  /* ------------------------------------------------------------ 通報 --- */
  // place: 'profile' | 'hub' | 'search' | 'chat'
  function report(user, place) {
    if (!user || !ready()) return;
    if (user.npc) { K.sfx('deny'); K.toast(user.name + 'は通報できません'); return; }
    K.sfx('click');
    var t = el('span');
    t.appendChild(K.nameSpan(user.name));
    t.appendChild(document.createTextNode('さんを通報'));
    openForm({
      title: t,
      lead: 'どのようなトラブルがあったか教えてください。内容は運営だけが確認し、相手には知らされません。',
      kinds: BR.CONFIG.reportKinds,
      kindTitle: '通報の種類',
      label: 'くわしい内容',
      placeholder: 'いつ・どこで・何があったかを自由に書いてください（文字数の制限はありません）',
      warn: '虚偽の通報や、おふざけでの通報をした場合は、通報したあなたのアカウントがアクセス禁止になる可能性があります。',
      send: '通報する',
      submit: function (kind, text) { return api.report(user.id, kind, text, place || 'profile'); },
      done: function (r) { return (r && r.message) || '今後このようなトラブルがないよう気を付けます。'; }
    });
  }

  /* ------------------------------------------------------------ 報告 / 意見案 --- */
  var TO_BOT = {
    bug: {
      title: '運営に報告',
      lead: '不具合・エラー・おかしな表示など、気づいたことを教えてください。運営が確認し、Ice Smoker公式ボットからお返事します。',
      label: '報告の内容',
      placeholder: 'どの画面で・何をしたら・どうなったかを自由に書いてください（文字数の制限はありません）'
    },
    idea: {
      title: '運営に意見案を送る',
      lead: '「こんな機能がほしい」「ここをこう変えてほしい」など、ゲームへのアイデアを教えてください。',
      label: '意見案',
      placeholder: 'アイデアを自由に書いてください（文字数の制限はありません）'
    }
  };
  function toBot(kind) {
    if (!ready()) return;
    var c = TO_BOT[kind];
    K.sfx('click');
    openForm({
      title: c.title,
      lead: c.lead,
      label: c.label,
      placeholder: c.placeholder,
      send: '送信する',
      submit: function (k, text) { return api.officialFeedback(kind, text); },
      done: function (r) {
        if (r && r.message) BR.social.onMsg(r.message);
        K.sfx('send');
        K.toast('運営に送りました。お返事は公式ボットとのメッセージに届きます', 3400);
        return null;
      }
    });
  }

  function init() {
    if (!api.online) return;
    BR.social.onMe(onMe);
  }

  BR.safety = {
    init: init,
    report: report,
    toBot: toBot,
    isOpen: function () { return !!form || (!!age.root && !age.root.hidden); },
    close: function () { if (form) { closeForm(); return true; } return false; }
  };
})(window.BR = window.BR || {});
