/* Small UI toolkit shared by the online screens: elements, player icons,
   amounts, times, dialogs, badges, unscaled overlays and drag-scrolling for
   the turned (portrait) stage. */
(function (BR) {
  'use strict';

  var U = BR.util;
  var $ = U.$, $$ = U.$$;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function icon(name) { return el('i', 'ic ic-' + name); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function yesterday() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1); }
  function fmtTime(ts) {
    var d = new Date(ts);
    var hm = d.getHours() + ':' + pad2(d.getMinutes());
    if (sameDay(d, new Date())) return hm;
    if (sameDay(d, yesterday())) return '昨日 ' + hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  function fmtDay(ts) {
    var d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return '今日';
    if (sameDay(d, yesterday())) return '昨日';
    return (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '年' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function fmtDate(ts) { var d = new Date(ts); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  function clip(s, n) {
    var a = Array.from(String(s || '').replace(/\s+/g, ' '));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  }
  function nfkc(s) { s = String(s || ''); return s.normalize ? s.normalize('NFKC') : s; }

  var CUR = { tokens: { icon: 'chip', name: 'トークン' }, dollars: { icon: 'dollar', name: 'ドル' } };
  function amountEl(n, currency, cls) {
    var a = el('span', 'amt' + (cls ? ' ' + cls : ''));
    a.appendChild(icon((CUR[currency] || CUR.tokens).icon));
    a.appendChild(el('span', '', U.fmt(n)));
    return a;
  }

  /* player icons */
  var LETTER_BG = ['#b8322a', '#c1621b', '#a8871a', '#2f8f4e', '#1f8a7a', '#2f6fae', '#7b48a8', '#b0336f', '#6d4c41', '#4f6b7a'];
  function avatarInfo(id) {
    var list = BR.CONFIG.avatars;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function avatarSrc(id) { return (BR.SOCIAL_IMG && BR.SOCIAL_IMG.avatars[id]) || null; }
  // the portrait (or the first letter of the name for an unknown icon)
  function avatarEl(user, cls) {
    var a = el('span', 'avatar' + (cls ? ' ' + cls : ''));
    var id = user && user.avatar, src = avatarSrc(id);
    if (src) {
      a.classList.add('pic');
      a.style.backgroundImage = 'url("' + src + '")';
      var info = avatarInfo(id);
      if (info && info.rare) a.classList.add('rare');
    } else {
      a.textContent = (Array.from(String((user && user.name) || '?'))[0] || '?').toUpperCase();
      a.style.background = LETTER_BG[Math.abs((user && user.id) | 0) % LETTER_BG.length];
    }
    return a;
  }

  function presence(on) { return el('i', 'dot' + (on ? ' on' : '')); }
  function nameSpan(name) { return el('span', 'uname', name); }
  // the VIP badge of someone whose VIP is on (`level` 0-3; null: none)
  function vipBadge(level) {
    if (level === null || level === undefined) return null;
    var b = el('i', 'vip-badge vip-' + level, 'VIP');
    b.appendChild(el('b', '', String(level)));
    return b;
  }
  function addVip(node, level) { var b = vipBadge(level); if (b) node.appendChild(b); return node; }
  function toast(msg, ms, tap) { BR.app.toast(msg, ms, tap); }
  function sfx(n, arg) { BR.sfx.play(n, arg); }
  function fail(err) {
    sfx('deny');
    toast(err && err.message ? err.message : 'エラーが発生しました', 3200);
  }
  function badge(node, n) {
    var was = Number(node.dataset.n) || 0;
    node.hidden = !n;
    node.textContent = n > 99 ? '99+' : String(n);
    node.dataset.n = String(n || 0);
    // one more: it jumps (css/juice.css)
    if (n > was && was > 0) {
      node.classList.remove('jc-pop');
      void node.offsetWidth;
      node.classList.add('jc-pop');
    }
  }

  /* dialogs inside the stage */
  var MODALS = [];       // ids, most important first (Escape closes the first open one)
  var confirmDone = null;
  function registerModal(id) {
    if (MODALS.indexOf(id) < 0) MODALS.push(id);
    var m = document.getElementById(id);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.closest('[data-close]')) {
        sfx('click');
        closeModal(id);
      }
    });
  }
  function showModal(id) { $('#' + id).hidden = false; }
  function isOpen(id) { return !$('#' + id).hidden; }
  function closeModal(id) {
    var m = $('#' + id);
    if (m.hidden) return;
    m.hidden = true;
    if (id === 'confirm' && confirmDone) {
      var f = confirmDone;
      confirmDone = null;
      f(false);
    }
    m.dispatchEvent(new Event('closed'));
  }
  function closeModals() {
    MODALS.forEach(closeModal);
    $('#numpad').hidden = true;
  }
  // build(p) fills the question; resolves true when confirmed
  function confirmBox(build, okLabel, cancelLabel) {
    if (confirmDone) closeModal('confirm');
    var p = $('#confirm-text');
    p.textContent = '';
    build(p);
    $('#confirm-yes').textContent = okLabel || 'OK';
    $('#confirm-no').textContent = cancelLabel || 'キャンセル';
    showModal('confirm');
    return new Promise(function (resolve) { confirmDone = resolve; });
  }
  function escape() {
    for (var i = 0; i < MODALS.length; i++) if (isOpen(MODALS[i])) { closeModal(MODALS[i]); return true; }
    return false;
  }

  /* overlays outside the scaled stage */
  // Keep fixed overlays inside the visible area while the keyboard is up
  // (iOS and recent Android shrink only the visual viewport).
  var fitted = [];
  function fitAll() {
    var vv = window.visualViewport;
    fitted.forEach(function (n) {
      if (n.hidden || !vv) return;
      n.style.height = vv.height + 'px';
      n.style.transform = 'translateY(' + vv.offsetTop + 'px)';
    });
  }
  function fitOverlay(node) {
    if (fitted.indexOf(node) < 0) fitted.push(node);
    fitAll();
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitAll);
    window.visualViewport.addEventListener('scroll', fitAll);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:0;top:0;opacity:0;';
    document.body.appendChild(t);
    t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* unsupported */ }
    document.body.removeChild(t);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }

  // In the portrait fallback the stage is turned 90°, where native touch
  // scrolling would follow the wrong axis: those panes are dragged by hand.
  function dragScroll(sc) {
    var d = null, fling = 0, swallow = false;
    sc.addEventListener('pointerdown', function (e) {
      cancelAnimationFrame(fling);
      swallow = false;
      d = null;
      if (!BR.app.view.portrait || e.pointerType === 'mouse') return;
      d = { id: e.pointerId, x: e.clientX, top: sc.scrollTop, moved: false, v: 0, lx: e.clientX, lt: U.now() };
    });
    sc.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== d.id) return;
      var s = BR.app.view.s;
      if (!d.moved && Math.abs(e.clientX - d.x) > 8) {
        d.moved = true;
        try { sc.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      }
      if (!d.moved) return;
      // the stage's y axis runs along the screen's -x axis
      sc.scrollTop = d.top + (e.clientX - d.x) / s;
      var now = U.now(), dt = Math.max(1, now - d.lt);
      d.v = 0.75 * ((e.clientX - d.lx) / s / dt) + 0.25 * d.v;
      d.lx = e.clientX;
      d.lt = now;
    });
    function end(e) {
      if (!d || e.pointerId !== d.id) return;
      if (d.moved) {
        swallow = true;
        var v = d.v, last = U.now();
        (function step() {
          var now = U.now(), dt = now - last;
          last = now;
          v *= Math.pow(0.995, dt);
          if (Math.abs(v) < 0.02) return;
          sc.scrollTop += v * dt;
          fling = requestAnimationFrame(step);
        })();
      }
      d = null;
    }
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
    sc.addEventListener('click', function (e) {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function init() {
    $('#confirm-yes').addEventListener('click', function () {
      var f = confirmDone;
      confirmDone = null;
      $('#confirm').hidden = true;
      sfx('click');
      if (f) f(true);
    });
    $('#confirm-no').addEventListener('click', function () { sfx('click'); closeModal('confirm'); });
    registerModal('confirm');
  }

  BR.kit = {
    init: init,
    el: el, icon: icon, fmtTime: fmtTime, fmtDay: fmtDay, fmtDate: fmtDate, sameDay: sameDay, clip: clip, nfkc: nfkc,
    CUR: CUR, amountEl: amountEl, avatarEl: avatarEl, avatarInfo: avatarInfo, avatarSrc: avatarSrc,
    presence: presence, nameSpan: nameSpan, vipBadge: vipBadge, addVip: addVip, toast: toast, sfx: sfx, fail: fail, badge: badge,
    registerModal: registerModal, showModal: showModal, closeModal: closeModal, closeModals: closeModals, isOpen: isOpen,
    confirmBox: confirmBox, escape: escape, fitOverlay: fitOverlay, copyText: copyText, dragScroll: dragScroll
  };
})(window.BR = window.BR || {});
