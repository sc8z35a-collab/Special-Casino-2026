/* バイト (a tab of the menu): part-time jobs paid by the hour for every
   second worked, also while the player is away. The wages so far come in with
   「給料を受け取る」 (with the sound of coins); changing or quitting a job pays
   them as well. One more job can be worked at once every 3 player levels
   (BR.LEVEL.jobSlots), and in 友達と稼ぐ with its benefits on, the best paid
   job being worked pays x1.5 (the server counts that time from the beats). */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, C = BR.CONFIG, LV = BR.LEVEL;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;

  var state = null;   // { level, slots, every, working: [{ id, since, boost }], offset, at }
  var busy = false, ticker = 0;

  function now() { return Date.now() + (state ? state.offset : 0); }
  function shown() { return BR.screens.current() === 'board' && $('#pane-jobs').classList.contains('active'); }
  function jobOf(id) {
    for (var i = 0; i < C.jobs.length; i++) if (C.jobs[i].id === id) return C.jobs[i];
    return null;
  }
  function working(id) {
    if (!state) return null;
    for (var i = 0; i < state.working.length; i++) if (state.working[i].id === id) return state.working[i];
    return null;
  }
  // the best paid job being worked: the one 友達と稼ぐ pays x1.5
  function best() {
    if (!state || !state.working.length) return null;
    var b = null;
    state.working.forEach(function (w) { if (!w.paused && (!b || jobOf(w.id).wage > jobOf(b.id).wage)) b = w; });
    return b;
  }
  function hubOn() { return !!(BR.hub && BR.hub.on && BR.hub.on()); }
  // VIP: { until, mult } (mult 1: no more pay), and the free trial's { trialUntil, trialMult }
  function vip() {
    var m = BR.social.me(), v = m && m.vip;
    return v ? { until: v.until, mult: BR.VIP.wage(v.level), trialUntil: v.trialUntil || 0, trialMult: BR.VIP.wage(C.vip.trial.level), permanentAt: v.permanentAt || 0 } : { until: 0, mult: 1, trialUntil: 0, trialMult: 1 };
  }
  function vipNow() {
    var v = vip(), t = now();
    return v.trialUntil > t ? Math.max(v.mult, v.trialMult) : v.mult > 1 && v.until > t ? v.mult : v.permanentAt ? BR.VIP.wage(C.vip.permanent.level) : 1;
  }
  function earned(w) {
    if (w.paused) return C.jobMaxPay;
    var job = jobOf(w.id);
    if (!job) return 0;
    var v = vip();
    var pay = Math.floor(BR.VIP.earned(job.wage, w.since, now(), v.until, v.mult, v.trialUntil, v.trialMult, v.permanentAt));
    // the time with a hub's benefits on: since loading too, while they are on (an estimate)
    var boost = (w.boost || 0) + (w === best() && hubOn() ? Math.max(0, Date.now() - state.at) : 0);
    return Math.min(C.jobMaxPay, pay + Math.floor(boost * job.wage * (C.hub.wage - 1) / 3600000));
  }
  function level() {
    var xp = BR.quests && BR.quests.xp();
    return typeof xp === 'number' ? LV.of(xp) : state ? state.level : 1;
  }

  function set(r) {
    if (!r) return;
    state = { level: r.level, slots: r.slots || LV.jobSlots(r.level), every: r.every || C.jobSlotEvery, working: r.working || [],
      offset: (r.now || Date.now()) - Date.now(), at: Date.now() };
    renderDot();
    if (shown()) render();
  }
  function load() { return api.jobs().then(set); }

  // a dot on the tab once an hour's wages are waiting
  function renderDot() {
    var waiting = state ? state.working.some(function (w) { return earned(w) >= jobOf(w.id).wage; }) : false;
    $('#jobs-dot').hidden = !waiting;
  }

  function show() {
    render();
    load().catch(function (err) { if (!state) renderNote(err.message); });
    clearInterval(ticker);
    ticker = setInterval(function () {
      if (!shown()) { clearInterval(ticker); return; }
      tick();
    }, 1000);
  }

  function renderNote(text) {
    var list = $('#jobs-list');
    list.textContent = '';
    list.appendChild(el('div', 'empty', text));
  }

  function button(label, act, cls) {
    var b = el('button', 'act-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.dataset.act = act;
    return b;
  }

  function render() {
    if (!state) { renderNote('読み込み中…'); return; }
    var list = $('#jobs-list');
    list.textContent = '';
    C.jobs.forEach(function (job) { list.appendChild(card(job)); });
    tick();
  }

  function card(job) {
    var w = working(job.id);
    var c = el('div', 'job-card' + (w ? ' working' : ''));
    c.dataset.job = job.id;
    var pic = el('div', 'job-pic');
    var src = BR.SOCIAL_IMG.jobs && BR.SOCIAL_IMG.jobs[job.id];
    if (src) pic.style.backgroundImage = 'url("' + src + '")';
    if (w) pic.appendChild(el('span', 'job-live', '勤務中'));
    c.appendChild(pic);
    var info = el('div', 'job-info');
    info.appendChild(el('h3', 'job-name', job.name));
    var wage = el('div', 'job-wage');
    wage.appendChild(K.amountEl(job.wage, 'dollars'));
    wage.appendChild(el('span', 'job-per', '/ 1時間'));
    // 友達と稼ぐ: this one pays x1.5 now
    if (w && w === best() && hubOn()) wage.appendChild(el('span', 'job-boost', '友達と稼ぐ 時給×' + C.hub.wage));
    if (vipNow() > 1) wage.appendChild(el('span', 'job-boost vip', 'VIP 時給×' + vipNow().toFixed(1)));
    info.appendChild(wage);
    info.appendChild(el('div', 'job-state', w ? '' : 'まだ働いていません'));
    var acts = el('div', 'job-acts');
    if (w) {
      acts.appendChild(button('給料を受け取る', 'collect', 'gold'));
      acts.appendChild(button('やめる', 'stop'));
    } else {
      var locked = level() < job.level;
      var full = state.working.length >= LV.jobSlots(level());
      var b = button(locked ? 'Lv.' + job.level + 'で解放' : full ? 'このバイトに変更' : '働く', 'start', 'gold');
      b.disabled = locked;
      acts.appendChild(b);
    }
    info.appendChild(acts);
    c.appendChild(info);
    return c;
  }

  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    return Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
  }

  // the wages tick up while the tab is open
  function tick() {
    if (!state) return;
    state.working.forEach(function (w) {
      var c = $('#jobs-list .job-card[data-job="' + w.id + '"]');
      if (!c) return;
      var st = c.querySelector('.job-state');
      st.textContent = '';
      var waiting = earned(w) >= C.jobMaxPay;
      if (waiting) w.paused = true;
      c.classList.toggle('waiting', waiting);
      c.querySelector('.job-live').textContent = waiting ? '回収待ち' : '勤務中';
      st.appendChild(el('span', 'job-time', waiting ? '回収待ち' : '勤務中 ' + clock(now() - w.since)));
      var pay = el('span', 'job-pay');
      pay.appendChild(document.createTextNode('受け取れる給料 '));
      pay.appendChild(K.amountEl(earned(w), 'dollars'));
      st.appendChild(pay);
      var b = c.querySelector('[data-act="collect"]');
      if (b) b.disabled = busy || earned(w) < 1;
    });
    renderDot();
  }

  // wages come in with the sound of coins and the wallet counting up
  function after(r, done) {
    busy = false;
    if (r.balance) BR.app.serverBalance(r.balance, !r.paid);
    set(r);
    if (r.paid > 0) {
      sfx('money');
      if (BR.juice) BR.juice.reward('#jobs-list .job-card.working', 2);
    }
    if (done) toast(done + (r.paid > 0 ? '（給料 $' + U.fmt(r.paid) + ' を受け取りました）' : ''), 3000);
    else if (r.paid > 0) toast('給料 $' + U.fmt(r.paid) + ' を受け取りました', 2600);
  }

  function act(name, id) {
    if (busy || !state) return;
    var job = jobOf(id);
    if (name === 'collect') {
      busy = true;
      api.collectJobs().then(function (r) {
        after(r);
        if (!r.paid) toast('まだ受け取れる給料がありません');
      }, function (err) { busy = false; fail(err); });
      return;
    }
    if (name === 'stop') {
      K.confirmBox(function (p) {
        p.appendChild(document.createTextNode('「' + job.name + '」をやめますか？'));
        p.appendChild(el('small', 'confirm-sub', 'ここまでの給料は受け取られます。'));
      }, 'やめる').then(function (ok) {
        if (!ok) return;
        busy = true;
        api.stopJob(id).then(function (r) { after(r, 'バイトをやめました'); }, function (err) { busy = false; fail(err); });
      });
      return;
    }
    var go = function () {
      busy = true;
      api.startJob(id).then(function (r) {
        after(r, '「' + job.name + '」を始めました！1時間ごとに $' + U.fmt(job.wage) + ' たまります');
      }, function (err) { busy = false; fail(err); });
    };
    if (state.working.length < LV.jobSlots(level())) { go(); return; }
    var cur = jobOf(state.working[0].id);
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('「' + (cur ? cur.name : '') + '」をやめて、このバイトに変更しますか？'));
      p.appendChild(el('small', 'confirm-sub', 'ここまでの給料は受け取られます。'));
    }, '変更する').then(function (ok) { if (ok) go(); });
  }

  function init() {
    $('#jobs-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      var c = e.target.closest('[data-job]');
      if (!b || !c || b.disabled) return;
      sfx('click');
      act(b.dataset.act, c.dataset.job);
    });
  }

  BR.jobs = {
    init: init,
    show: show,
    set: function (me) { if (me && me.jobs) set({ level: LV.of(me.xp || 0), working: me.jobs, now: Date.now() }); },
    reset: function () { state = null; $('#jobs-dot').hidden = true; }
  };
})(window.BR = window.BR || {});
