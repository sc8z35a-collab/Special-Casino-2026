/* Presentation adapter for /ops/. It keeps every original view, control, id,
   listener and permission in place. Opening an app clicks its ORIGINAL tab;
   internal navigation is observed, never replaced. No API or auth code here. */
(function () {
  'use strict';
  var app = document.getElementById('app'), frame = document.getElementById('frame');
  var tabs = document.getElementById('tabs'), top = app.querySelector('.top');
  if (!app || !tabs || !top) return;

  var APPS = [
    ['players', 'プレイヤー一覧', 'players'], ['archive', 'アーカイブ', 'archive'],
    ['reports', '通報', 'reports'], ['detections', '検知', 'detections'],
    ['feedback', '報告・意見案', 'feedback'], ['log', 'ログ', 'log'],
    ['operators', '運営者', 'operators'], ['team', '運営チャット', 'team'],
    ['security', 'セキュリティ', 'security'], ['server', 'サーバー', 'server'],
    ['pay', '課金', 'pay'], ['vault', '保管庫', 'vault'],
    ['devunit', 'DEV UNIT', 'devunit'], ['securityhome', 'セキュリティーホーム', 'securityhome'],
    ['diary', '開発者日記', 'diary'], ['profile', '自分のプロフィール', 'operators']
  ];
  var windows = {}, active = null, order = 0, signedIn = false, grouped = false;
  var overview = false, desktopSaved = null, silentRouting = false, suppressedRoute = '';
  var internalLaunch = false;
  var menu = null, overlay = null, returnFocus = null;
  var fullscreenWindow = null, fullscreenZoomed = false;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktop, area, dock, help, menuHost, account, announce;
  var noticeLayout = window.matchMedia('(min-width: 1100px)');
  var notices = [], noticeCounts = {}, noticeSequence = 0, noticesOpen = noticeLayout.matches, noticeSignature = '';
  // with a mouse the notification centre is a small tab until the pointer comes to it (and goes back when it leaves)
  var noticeHover = window.matchMedia('(hover: hover) and (pointer: fine)');
  var noticesMinimized = noticeHover.matches && noticeLayout.matches, noticeTimer = 0;

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(cls, text, label) {
    var b = node('button', cls, text); b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function picture(name, cls) {
    var img = node('img', cls); img.src = 'assets/' + name + '.webp';
    img.alt = ''; img.draggable = false; img.width = 64; img.height = 64;
    return img;
  }
  function allowed(w) { return !w.tab.hidden && !w.tab.disabled; }
  function openWindows() { return APPS.map(function (a) { return windows[a[0]]; }).filter(function (w) { return w.open && allowed(w); }); }
  function reduced() { return motion.matches || document.body.classList.contains('mac-reduce-motion'); }
  function say(text) { announce.textContent = text; }
  function isBlocked() {
    return ['dialog', 'money', 'chat', 'viewer', 'vcomments', 'emergency'].some(function (id) {
      var n = document.getElementById(id); return n && !n.hidden && !n.closest('.vault-work-pane');
    });
  }
  function prefs(key, value) {
    try {
      if (value === undefined) return localStorage.getItem('two-state-ops/ui/' + key);
      localStorage.setItem('two-state-ops/ui/' + key, value);
    } catch (e) { /* Layout preferences are optional. */ }
    return null;
  }

  // Keep original account controls, but place the system tray in the bottom bar.
  var brand = top.querySelector('.brand'), controls = top.querySelector('.top-right');
  brand.replaceChildren();
  var home = button('mac-system-menu', '', 'ウインドウとデスクトップの設定'); home.appendChild(picture('menu-bars'));
  home.dataset.menu = 'system';
  home.setAttribute('aria-haspopup', 'menu'); home.setAttribute('aria-expanded', 'false');
  brand.appendChild(home);
  var status = node('div', 'mac-status');
  var notificationToggle = button('mac-status-button mac-notification-toggle', '', '通知センター');
  notificationToggle.appendChild(picture('bell', 'mac-bell-img'));
  var notificationBadge = node('b', 'mac-notification-badge'); notificationBadge.hidden = true;
  notificationToggle.appendChild(notificationBadge);
  notificationToggle.setAttribute('aria-controls', 'mac-notifications');
  notificationToggle.setAttribute('aria-expanded', 'false');
  notificationToggle.addEventListener('click', function () {
    var behindWindows = !document.body.classList.contains('mac-notices-raised') && openWindows().some(function (w) { return !w.minimized; });
    var on = !noticesOpen || noticesMinimized || behindWindows;
    if (on) setNoticesMinimized(false);
    setNoticesOpen(on);
    if (on && autoNotices()) { clearTimeout(noticeTimer); noticeTimer = setTimeout(function () { if (!notifications.matches(':hover')) { setNoticesMinimized(true); document.body.classList.remove('mac-notices-raised'); } }, 2500); }
    document.body.classList.toggle('mac-notices-raised', on);
  });
  status.appendChild(notificationToggle);
  var profile = button('mac-status-button mac-profile', '', '運営アカウントと更新頻度');
  profile.appendChild(picture('operators')); profile.dataset.menu = 'account';
  profile.setAttribute('aria-haspopup', 'true'); profile.setAttribute('aria-expanded', 'false'); status.appendChild(profile);
  var clock = node('time', 'mac-clock'); status.appendChild(clock); top.appendChild(status);

  account = node('div', 'mac-account mac-popover'); account.id = 'mac-account'; account.hidden = true;
  var accountHead = node('div', 'mac-account-head'); accountHead.appendChild(picture('operators'));
  accountHead.appendChild(node('span', '', '運営アカウント')); account.appendChild(accountHead);
  account.appendChild(controls); app.appendChild(account);
  // items other parts of the page add to the account menu (ops/ext.js)
  var extras = node('div', 'mac-account-extras'); account.appendChild(extras);
  window.OpsDesktop = {
    addItem: function (label, fn) {
      var b = button('btn small mac-account-item', label);
      b.addEventListener('click', function () { account.hidden = true; fn(); });
      extras.appendChild(b);
    },
    clearItems: function () { extras.replaceChildren(); }
  };
  menuHost = node('div', 'mac-dropdown'); menuHost.id = 'mac-menu'; menuHost.hidden = true;
  menuHost.setAttribute('role', 'menu'); app.appendChild(menuHost);

  desktop = node('div', 'mac-desktop'); desktop.setAttribute('aria-label', 'デスクトップ');
  desktop.addEventListener('pointerdown', function () { closeMenu(); });
  app.insertBefore(desktop, top.nextSibling);
  area = node('div', 'mac-windows'); area.id = 'mac-windows'; app.appendChild(area);
  area.addEventListener('pointerdown', function (e) {
    document.body.classList.remove('mac-notices-raised', 'mac-dock-revealed');
    if (dock.contains(document.activeElement)) {
      var win = e.target.closest('.mac-window'); if (win) win.focus({ preventScroll: true });
    }
  });

  dock = node('div', 'mac-dock'); dock.setAttribute('aria-label', 'Dock');
  var dockHome = button('mac-dock-home', '', 'デスクトップを表示');
  dockHome.appendChild(picture('site')); dockHome.appendChild(node('span', 'mac-dock-label', 'デスクトップ'));
  dockHome.addEventListener('click', showDesktop); dock.appendChild(dockHome);
  // 軽量化: one tap turns the liquid glass and the gliding animations off together (and back on)
  var liteButton = button('mac-dock-tool', '', '軽量化（リキッドグラスとアニメーションをオフ）');
  liteButton.appendChild(picture('lite')); liteButton.appendChild(node('span', 'mac-dock-label', '軽量化'));
  liteButton.addEventListener('click', function () { setLite(!isLite()); });
  // 背景: the pictures to put behind the windows
  var wallButton = button('mac-dock-tool', '', '背景を変える');
  wallButton.appendChild(picture('wallpaper-app')); wallButton.appendChild(node('span', 'mac-dock-label', '背景'));
  wallButton.addEventListener('click', function () { showWallpapers(); });
  dock.appendChild(liteButton); dock.appendChild(wallButton);
  dock.appendChild(node('span', 'mac-dock-divider')); dock.appendChild(tabs); dock.appendChild(top); app.appendChild(dock);
  // Windows may cover the taskbar. Its bottom edge and keyboard shortcut
  // keep every application reachable without constraining window movement.
  var taskbarEdge = button('mac-taskbar-edge', '', 'アプリバーを表示');
  taskbarEdge.addEventListener('pointerenter', revealTaskbar);
  taskbarEdge.addEventListener('click', revealTaskbar);
  taskbarEdge.addEventListener('focus', revealTaskbar);
  function revealTaskbar() { document.body.classList.add('mac-dock-revealed'); showDock(true); }
  dock.addEventListener('pointerleave', function () { document.body.classList.remove('mac-dock-revealed'); });
  // With the mouse wheel the app bar moves left and right, so no app is cut off at its ends.
  dock.addEventListener('wheel', function (e) {
    if (e.ctrlKey || tabs.scrollWidth <= tabs.clientWidth + 1) return;
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    tabs.scrollBy({ left: d * (e.deltaMode === 1 ? 32 : 1), behavior: 'auto' });
  }, { passive: false });

  // The app bar sinks out of sight like a drop of water when the mouse is away from it, and rises
  // again when the mouse comes to the bottom of the screen (mouse only: a touch screen keeps it).
  var hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var autoHide = prefs('autohide') !== 'no', dockShown = true, hideTimer = 0;
  var dockHint = node('span', 'mac-dock-hint'); app.appendChild(dockHint);
  function canHide() {
    if (!autoHide || !hoverPointer.matches || app.hidden || menu || overlay || !signedIn) return false;
    var f = document.activeElement;
    if (f && dock.contains(f) && f.matches && f.matches(':focus-visible')) return false;
    return !document.body.classList.contains('mac-dock-revealed') || !dock.matches(':hover');
  }
  function showDock(now) {
    clearTimeout(hideTimer);
    if (dockShown && !dock.classList.contains('mac-dock-away')) return;
    dockShown = true;
    dock.classList.remove('mac-dock-away'); dock.classList.add('mac-dock-back');
    document.body.classList.remove('mac-dock-hidden');
  }
  function hideDock() {
    if (!dockShown || !canHide()) return;
    dockShown = false; tooltip.hidden = true;
    dock.classList.remove('mac-dock-back'); dock.classList.add('mac-dock-away');
    document.body.classList.add('mac-dock-hidden');
  }
  function scheduleHide(ms) { clearTimeout(hideTimer); hideTimer = setTimeout(hideDock, ms === undefined ? 700 : ms); }
  function nearDock(e) {
    var p = app.getBoundingClientRect(), cx = p.left + app.clientWidth / 2, half = dock.offsetWidth / 2 + 90;
    var bottom = p.bottom - e.clientY;
    return bottom < (dockShown ? dock.offsetHeight + 40 : 46) && Math.abs(e.clientX - cx) < half;
  }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' || !autoHide || !signedIn) return;
    if (nearDock(e)) showDock(); else if (dockShown) scheduleHide();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', function () { if (autoHide) scheduleHide(250); });
  dock.addEventListener('focusin', function () { showDock(); });
  dock.addEventListener('focusout', function () { if (autoHide) scheduleHide(1200); });
  hoverPointer.addEventListener('change', function () { if (!hoverPointer.matches) showDock(true); });
  app.appendChild(taskbarEdge);
  tabs.setAttribute('aria-label', '運営アプリケーション');
  tabs.setAttribute('tabindex', '0');
  tabs.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-view]'), w = tab && windows[tab.dataset.view];
    if (!w || internalLaunch || app.hidden || isBlocked()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // (a window in the background comes to the front; the one in front is put away)
    if (w.open && !w.minimized && active === w.id) minimize(w.id); else activate(w.id);
  }, true);

  APPS.forEach(function (a) {
    var id = a[0], tab = tabs.querySelector('[data-view="' + id + '"]');
    var view = document.getElementById('view-' + id);
    var count = tab.querySelector('.count');
    var w = windows[id] = { id: id, name: a[1], image: a[2], tab: tab, view: view, open: false, minimized: false, zoomed: false, rank: 0, animation: null, bounds: null };
    tab.replaceChildren(picture(w.image), node('span', 'mac-dock-label', w.name));
    if (count) tab.appendChild(count);
    tab.setAttribute('aria-label', w.name); tab.removeAttribute('title');

    var win = node('section', 'mac-window'); win.id = 'mac-window-' + id;
    win.setAttribute('role', 'region'); win.setAttribute('aria-label', w.name); win.tabIndex = -1;
    var titlebar = node('div', 'mac-titlebar'), lights = node('div', 'mac-window-controls');
    [['minimize', '−', '最小化'], ['zoom', '□', '最大化 / 元に戻す'], ['close', '×', '閉じる']].forEach(function (a) {
      var b = button('mac-window-control mac-' + a[0], a[1], w.name + '：' + a[2]); b.title = a[2];
      b.addEventListener('click', function () {
        if (a[0] === 'close') closeWindow(id);
        else if (a[0] === 'minimize') minimize(id);
        else zoom(id);
      }); lights.appendChild(b);
    });
    titlebar.appendChild(lights);
    var title = node('div', 'mac-window-title'); title.appendChild(picture(w.image)); title.appendChild(node('strong', '', w.name));
    titlebar.appendChild(title);
    win.appendChild(titlebar);
    var strip = node('div', 'mac-window-tabs'); strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-label', '開いているアプリケーション');
    win.appendChild(strip); win.appendChild(view);
    var shade = button('mac-window-shade', '', w.name + 'を前面に表示');
    shade.addEventListener('click', function () { if (overview) setOverview(false); activate(id); }); win.appendChild(shade);
    var resize = button('mac-resize', '', w.name + 'のサイズを変更（矢印キー）'); resize.title = 'ドラッグでサイズ変更';
    resize.addEventListener('keydown', function (e) {
      if (!/^Arrow/.test(e.key)) return;
      e.preventDefault(); if (w.zoomed || grouped) return;
      var b = w.bounds, step = e.shiftKey ? 40 : 16;
      if (e.key === 'ArrowRight') b.width += step; if (e.key === 'ArrowLeft') b.width -= step;
      if (e.key === 'ArrowDown') b.height += step; if (e.key === 'ArrowUp') b.height -= step;
      clamp(w); layout();
    }); win.appendChild(resize);
    w.node = win; w.strip = strip; w.titlebar = titlebar;
    area.appendChild(win); installDrag(w, win, false); installDrag(w, resize, true);
    win.addEventListener('dblclick', function (e) {
      if (movableTarget(e.target) && (!w.lastTouchFullscreen || Date.now() - w.lastTouchFullscreen > 500)) { e.preventDefault(); realFullscreen(id); }
    });
    titlebar.addEventListener('pointerdown', function (e) {
      if (!overview && !e.target.closest('button') && active !== id) activate(id);
    });
  });

  help = node('div', 'mac-help mac-overlay'); help.hidden = true; help.setAttribute('role', 'dialog'); help.setAttribute('aria-modal', 'true'); help.setAttribute('aria-label', 'デスクトップの使い方');
  var helpPanel = node('div', 'mac-help-panel'); helpPanel.appendChild(picture('site')); helpPanel.appendChild(node('h2', '', 'TWO STATE デスクトップ'));
  helpPanel.appendChild(node('p', '', '下のアイコンでアプリを表示・非表示にします。ウインドウの余白をドラッグして移動、右下でサイズ変更、余白をダブルクリックすると全画面になります。スマホでは上部をドラッグして移動、内容はスワイプでスクロールできます。'));
  var helpList = node('dl', 'mac-shortcuts');
  [['Alt W', 'ウインドウを閉じる'], ['Alt M', '最小化'], ['Alt Enter', '最大化 / 元に戻す'], ['Alt `', '次のウインドウ'], ['Esc', '一覧やメニューを閉じる']].forEach(function (r) { helpList.appendChild(node('dt', '', r[0])); helpList.appendChild(node('dd', '', r[1])); });
  helpPanel.appendChild(helpList); helpPanel.appendChild(node('p', 'mac-help-note', '下部のメニューからタブ表示に切り替えられます。閉じても入力中の内容はこのページに残ります。'));
  var helpClose = button('btn primary', '閉じる'); helpClose.addEventListener('click', closeOverlay); helpPanel.appendChild(helpClose); help.appendChild(helpPanel); app.appendChild(help);
  help.addEventListener('click', function (e) { if (e.target === help) closeOverlay(); });
  announce = node('div', 'mac-sr-only'); announce.setAttribute('role', 'status'); announce.setAttribute('aria-live', 'polite'); app.appendChild(announce);

  var notifications = node('aside', 'mac-notifications'); notifications.id = 'mac-notifications';
  notifications.setAttribute('aria-label', 'すべてのアプリの通知');
  var noticeHead = node('div', 'mac-notice-head'); noticeHead.appendChild(node('h2', '', '通知センター'));
  var noticeClose = button('mac-notice-close', '×', '通知センターを閉じる');
  noticeClose.addEventListener('click', function () { setNoticesOpen(false); notificationToggle.focus(); }); noticeHead.appendChild(noticeClose);
  notifications.appendChild(noticeHead);
  var noticeContent = node('div', 'mac-notice-content'); noticeContent.id = 'mac-notice-content'; notifications.appendChild(noticeContent);
  var noticePending = node('div', 'mac-notice-pending'); noticeContent.appendChild(noticePending);
  var noticeHistory = node('div', 'mac-notice-history'); noticeHistory.setAttribute('role', 'log'); noticeHistory.setAttribute('aria-label', '通知の履歴'); noticeContent.appendChild(noticeHistory);
  app.appendChild(notifications);
  function setNoticesMinimized(on) {
    noticesMinimized = on;
    notifications.classList.toggle('is-minimized', on); noticeContent.hidden = on;
  }
  function autoNotices() { return noticeHover.matches && noticeLayout.matches; }
  notifications.addEventListener('pointerenter', function (e) {
    if (e.pointerType !== 'mouse' || !autoNotices()) return;
    clearTimeout(noticeTimer); setNoticesMinimized(false); document.body.classList.add('mac-notices-raised');
  });
  notifications.addEventListener('pointerleave', function (e) {
    if (e.pointerType !== 'mouse' || !autoNotices()) return;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { if (!notifications.matches(':hover') && !notifications.contains(document.activeElement)) { setNoticesMinimized(true); document.body.classList.remove('mac-notices-raised'); } }, 450);
  });
  setNoticesMinimized(noticesMinimized);
  function setNoticesOpen(on) {
    noticesOpen = on; document.body.classList.toggle('mac-notices-open', on);
    document.body.classList.toggle('mac-notices-hidden', !on);
    notificationToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  setNoticesOpen(noticesOpen);
  noticeLayout.addEventListener('change', function (e) { setNoticesOpen(e.matches); setNoticesMinimized(autoNotices()); });
  function noticeCard(id, text, at, dismiss) {
    var card = node('article', 'mac-notice-card'), w = windows[id];
    var open = button('mac-notice-open', '', w.name + '：' + text);
    open.appendChild(picture(w.image));
    var body = node('span', 'mac-notice-body'); body.appendChild(node('strong', '', w.name)); body.appendChild(node('span', '', text));
    if (at) body.appendChild(node('time', '', new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })));
    open.appendChild(body); open.addEventListener('click', function () { activate(id); if (window.innerWidth < 1100) setNoticesOpen(false); }); card.appendChild(open);
    if (dismiss) { var x = button('mac-notice-dismiss', '×', 'この通知を消す'); x.addEventListener('click', dismiss); card.appendChild(x); }
    return card;
  }
  function renderNotices() {
    if (!noticePending) return;
    var signature = JSON.stringify([noticeCounts, notices.map(function (n) { return n.id; }), APPS.map(function (a) { return allowed(windows[a[0]]); })]);
    if (signature === noticeSignature) return; noticeSignature = signature;
    noticePending.replaceChildren(); noticeHistory.replaceChildren();
    var total = 0;
    APPS.forEach(function (a) {
      var w = windows[a[0]], n = noticeCounts[w.id] || 0;
      if (!allowed(w) || !n) return;
      total += n; noticePending.appendChild(noticeCard(w.id, '未確認 ' + n + '件'));
    });
    notices.filter(function (n) { return allowed(windows[n.app]); }).forEach(function (n) {
      noticeHistory.appendChild(noticeCard(n.app, n.text, n.at, function () { notices = notices.filter(function (item) { return item.id !== n.id; }); renderNotices(); }));
    });
    if (!total && !noticeHistory.children.length) noticeHistory.appendChild(node('p', 'mac-notice-empty', '新しい通知はありません'));
    notificationBadge.textContent = total > 99 ? '99+' : String(total); notificationBadge.hidden = !total;
    notificationToggle.setAttribute('aria-label', '通知センター' + (total ? '・未確認 ' + total + '件' : ''));
  }
  function addNotice(id, text) {
    if (app.hidden || !windows[id] || !allowed(windows[id]) || typeof text !== 'string' || !text.trim()) return;
    var previous = notices[0];
    if (previous && previous.app === id && previous.text === text && Date.now() - previous.at < 2000) return;
    notices.unshift({ id: ++noticeSequence, app: id, text: text.slice(0, 1000), at: Date.now() }); notices.length = Math.min(notices.length, 50); renderNotices();
  }
  document.addEventListener('ops:notice', function (e) { var n = e.detail || {}; addNotice(n.app, n.text); });
  document.addEventListener('ops:count', function (e) {
    var n = e.detail || {}; if (app.hidden || !windows[n.app] || !allowed(windows[n.app])) return;
    noticeCounts[n.app] = Math.max(0, Number(n.count) || 0); renderNotices();
  });
  // Accept the independent security app's notifications only from its own frame.
  window.addEventListener('message', function (e) {
    var embedded = document.getElementById('securityhome-frame'), n = e.data;
    if (e.origin !== location.origin || !embedded || e.source !== embedded.contentWindow || !n || app.hidden) return;
    if (n.type === 'ops:desktop-shortcut' && n.action === 'menu') { if (!isBlocked()) openMenu(home); return; }
    if (n.type !== 'ops:security-notice') return;
    if (n.text) addNotice('securityhome', n.text);
    if (typeof n.count === 'number') { noticeCounts.securityhome = Math.max(0, n.count); renderNotices(); }
  });

  var loginStatus = node('div', 'mac-login-status');
  var loginBrand = node('span', 'mac-login-brand'); loginBrand.appendChild(picture('site')); loginBrand.appendChild(node('span', '', 'TWO STATE')); loginStatus.appendChild(loginBrand);
  var loginInfo = node('span', 'mac-login-info'); loginInfo.appendChild(node('span', '', 'ABC'));
  var loginConnection = node('span', 'mac-connection'); loginConnection.setAttribute('role', 'img'); loginInfo.appendChild(loginConnection);
  var loginClock = node('time', 'mac-clock'); loginInfo.appendChild(loginClock); loginStatus.appendChild(loginInfo); frame.appendChild(loginStatus);
  document.querySelectorAll('[data-mac-reload]').forEach(function (b) { b.addEventListener('click', function () { location.reload(); }); });
  var dialog = document.getElementById('dialog'); dialog.querySelector('.dialog').prepend(picture('security', 'mac-dialog-icon'));

  function updateClock() {
    var date = new Date(), text = date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    [clock, loginClock].forEach(function (n) { n.textContent = text; n.dateTime = date.toISOString(); });
    [loginConnection].forEach(function (n) { n.classList.toggle('is-offline', !navigator.onLine); n.setAttribute('aria-label', navigator.onLine ? 'ネットワーク接続あり' : 'オフライン'); n.title = n.getAttribute('aria-label'); });
  }
  updateClock(); setInterval(updateClock, 30000); window.addEventListener('online', updateClock); window.addEventListener('offline', updateClock);

  function defaultBounds(w) {
    var compact = area.clientWidth <= 700, i = compact ? 0 : openWindows().length % 4;
    var width = Math.min(1320, area.clientWidth - (compact ? 16 : 48));
    var height = Math.min(860, area.clientHeight - (compact ? 108 : 148));
    w.bounds = { x: compact ? 8 : (area.clientWidth - width) / 2 + i * 12 - 18, y: (compact ? 8 : 16) + i * 12, width: width, height: height };
    clamp(w);
  }
  function clamp(w) {
    var b = w.bounds, aw = area.clientWidth, ah = area.clientHeight;
    if (!b || !aw || !ah) return;
    b.width = Math.max(Math.min(480, aw - 12), Math.min(b.width, aw - 12));
    b.height = Math.max(Math.min(280, ah - 8), Math.min(b.height, ah - 8));
    // Keep enough of the titlebar reachable while allowing windows off-screen.
    b.x = Math.max(96 - b.width, Math.min(b.x, aw - 96));
    b.y = Math.max(0, Math.min(b.y, ah - Math.min(51, ah)));
  }
  function layout() {
    var list = openWindows(), aw = area.clientWidth, ah = area.clientHeight;
    if (!aw || !ah) return;
    var cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(list.length * aw / Math.max(ah, 1))))), rows = Math.ceil(list.length / cols);
    list.forEach(function (w, index) {
      if (!w.bounds) defaultBounds(w); clamp(w);
      var b = w.bounds, s = w.node.style; s.transformOrigin = overview ? 'top left' : 'center center'; s.removeProperty('transform');
      if (overview) {
        var cellW = (aw - 48) / cols, cellH = (ah - 48) / Math.max(rows, 1);
        var scale = Math.min((cellW - 20) / b.width, (cellH - 30) / b.height, .8);
        s.width = b.width + 'px'; s.height = b.height + 'px';
        s.left = 24 + (index % cols) * cellW + (cellW - b.width * scale) / 2 + 'px';
        s.top = 24 + Math.floor(index / cols) * cellH + (cellH - b.height * scale) / 2 + 'px'; s.transform = 'scale(' + scale + ')';
      } else if (w.zoomed || grouped) {
        s.left = '6px'; s.top = '4px'; s.width = aw - 12 + 'px'; s.height = ah - 8 + 'px';
      } else { s.left = b.x + 'px'; s.top = b.y + 'px'; s.width = b.width + 'px'; s.height = b.height + 'px'; }
    });
  }
  function render() {
    document.body.classList.toggle('mac-grouped', grouped); document.body.classList.toggle('mac-overview', overview);
    APPS.forEach(function (a) {
      var w = windows[a[0]], selected = active === w.id;
      w.node.classList.toggle('is-open', w.open); w.node.classList.toggle('is-minimized', w.minimized);
      w.node.classList.toggle('is-active', selected); w.node.classList.toggle('is-zoomed', w.zoomed);
      var shown = w.open && (!w.minimized || overview) && (!grouped || selected || overview);
      w.node.inert = !shown; w.node.setAttribute('aria-hidden', shown ? 'false' : 'true');
      w.node.style.zIndex = selected ? order + 1 : Math.max(1, w.rank);
      w.tab.classList.toggle('mac-running', w.open); w.tab.classList.toggle('mac-visible', w.open && !w.minimized); w.tab.classList.toggle('mac-focused', selected);
      w.tab.setAttribute('aria-pressed', selected ? 'true' : 'false');
      w.tab.setAttribute('aria-label', w.name + (selected ? '（操作中）' : w.open ? w.minimized ? '（最小化）' : '（表示中）' : ''));
      w.node.querySelector('.mac-zoom').setAttribute('aria-pressed', w.zoomed ? 'true' : 'false');
    });
    buildStrips(); layout();
    var cur = active && windows[active] && windows[active].tab;
    if (cur && tabs.scrollWidth > tabs.clientWidth) {
      var l = cur.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft, pad = 40;
      if (l < tabs.scrollLeft + pad) tabs.scrollLeft = Math.max(0, l - pad);
      else if (l + cur.offsetWidth > tabs.scrollLeft + tabs.clientWidth - pad) tabs.scrollLeft = l + cur.offsetWidth - tabs.clientWidth + pad;
    }
  }
  function buildStrips() {
    if (!grouped) return;
    var list = openWindows();
    list.forEach(function (host) {
      host.strip.replaceChildren();
      list.forEach(function (w) {
        var cell = node('div', 'mac-app-tab' + (active === w.id ? ' is-selected' : ''));
        var b = button('mac-tab-switch', '', w.name); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', active === w.id ? 'true' : 'false'); b.setAttribute('aria-controls', w.node.id); b.tabIndex = active === w.id ? 0 : -1;
        b.appendChild(picture(w.image)); b.appendChild(node('span', '', w.name));
        b.addEventListener('click', function () { activate(w.id); windows[w.id].strip.querySelector('[aria-selected="true"]').focus(); });
        b.addEventListener('keydown', function (e) {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); var i = list.indexOf(w), n = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
          activate(list[n].id); windows[list[n].id].strip.querySelector('[aria-selected="true"]').focus();
        });
        cell.appendChild(b); var x = button('mac-tab-close', '×', w.name + 'のタブを閉じる'); x.addEventListener('click', function () { closeWindow(w.id); }); cell.appendChild(x); host.strip.appendChild(cell);
      });
    });
  }
  function stopAnimation(w) {
    if (w.animation) { w.animation.cancel(); w.animation = null; }
    w.node.classList.remove('is-minimizing', 'is-closing');
  }
  function animate(w, frames, ms, finished) {
    if (reduced() || !w.node.animate) { if (finished) finished(); return; }
    var animation = w.node.animate(frames, { duration: ms, easing: 'cubic-bezier(.22,.8,.26,1)' }); w.animation = animation;
    animation.finished.then(function () { if (w.animation !== animation) return; w.animation = null; if (finished) finished(); }, function () {});
  }
  function present(id) {
    var w = windows[id]; if (!w || !allowed(w) || app.hidden) return;
    var restoring = w.open && w.minimized;
    var fresh = !w.open || w.minimized; stopAnimation(w); closeMenu(); desktopSaved = null;
    document.body.classList.remove('mac-notices-raised');
    if (overview) setOverview(false);
    w.open = true; w.minimized = false; active = id;
    // Ranks stay below the overlays; renumbering avoids an ever-growing z-index.
    openWindows().sort(function (a, b) { return a.rank - b.rank; }).forEach(function (x, i) { x.rank = i + 1; });
    w.rank = ++order; if (order > 14) { order = openWindows().length; w.rank = order; }
    render();
    if (fresh) {
      var rect = w.node.getBoundingClientRect(), target = w.tab.getBoundingClientRect();
      var dx = target.left + target.width / 2 - rect.left - rect.width / 2;
      var dy = target.top + target.height / 2 - rect.top - rect.height / 2;
      if (frame.classList.contains('turned')) { var t = dx; dx = dy; dy = -t; }
      animate(w, [{ opacity: 0, transform: restoring ? 'translate(' + dx + 'px,' + dy + 'px) scale(.12)' : 'translateY(28px) scale(.92)' }, { opacity: 1, transform: 'translate(0,0) scale(1)' }], restoring ? 360 : 280);
      if (!reduced() && w.tab.animate) w.tab.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-13px)', offset: .4 }, { transform: 'translateY(0)' }], { duration: 450, easing: 'ease-out' });
      say(w.name + 'を開きました');
    }
  }
  function activate(id) {
    if (fullscreenWindow && fullscreenWindow !== id) leaveFullscreen();
    var w = windows[id]; if (!w || !allowed(w) || app.hidden || isBlocked()) return;
    closeOverlay(false); suppressedRoute = '';
    internalLaunch = true;
    try { w.tab.click(); } finally { internalLaunch = false; }
  }
  // Keep the original app's active-view semantics even when the last window
  // is put away (notably the existing background-call reminder). No endpoint
  // or business operation is invented for desktop navigation.
  function nextWindow() {
    var next = openWindows().filter(function (w) { return !w.minimized; }).sort(function (a, b) { return b.rank - a.rank; })[0];
    if (next) { activate(next.id); return; }
    active = null;
    var fallback = APPS.map(function (a) { return windows[a[0]]; }).find(allowed);
    if (fallback) { suppressedRoute = fallback.id; silentRouting = true; internalLaunch = true; try { fallback.tab.click(); } finally { internalLaunch = false; silentRouting = false; } }
    render();
  }
  function closeWindow(id) {
    if (fullscreenWindow === id) leaveFullscreen();
    var w = windows[id]; if (!w || !w.open) return;
    stopAnimation(w); var wasActive = active === id; w.open = false; w.minimized = false;
    w.node.classList.add('is-closing');
    if (wasActive) nextWindow(); else render();
    animate(w, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'translateY(6px) scale(.97)' }], 140, function () { w.node.classList.remove('is-closing'); });
    say(w.name + 'を閉じました');
    if (wasActive) { var focus = active ? windows[active].node : w.tab; focus.focus({ preventScroll: true }); }
  }
  function minimize(id) {
    if (fullscreenWindow === id) leaveFullscreen();
    var w = windows[id]; if (!w || !w.open || w.minimized) return;
    stopAnimation(w); var rect = w.node.getBoundingClientRect(), target = w.tab.getBoundingClientRect();
    w.minimized = true; w.node.classList.add('is-minimizing');
    var wasActive = active === id; if (wasActive) nextWindow(); else render();
    var dx = target.left + target.width / 2 - rect.left - rect.width / 2;
    var dy = target.top + target.height / 2 - rect.top - rect.height / 2;
    if (frame.classList.contains('turned')) { var t = dx; dx = dy; dy = -t; }
    animate(w, [{ opacity: 1, transform: 'translate(0,0) scale(1)' }, { opacity: 0, transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.12)' }], 280, function () { w.node.classList.remove('is-minimizing'); });
    say(w.name + 'を最小化しました'); if (wasActive) w.tab.focus({ preventScroll: true });
  }
  function zoom(id) {
    var w = windows[id]; if (!w || !w.open) return;
    if (fullscreenWindow) { leaveFullscreen(); return; }
    stopAnimation(w); if (active !== id) activate(id); w.zoomed = !w.zoomed; render();
  }
  function leaveFullscreen() {
    var id = fullscreenWindow; fullscreenWindow = null;
    document.body.classList.remove('mac-fullscreen');
    if (id && windows[id]) windows[id].zoomed = fullscreenZoomed;
    if (document.fullscreenElement === app && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    render();
  }
  function realFullscreen(id) {
    if (app.hidden || isBlocked()) return;
    if (fullscreenWindow) { leaveFullscreen(); return; }
    var w = windows[id]; if (!w || !w.open) return;
    if (!app.requestFullscreen) { zoom(id); say('このブラウザではウインドウを最大化します'); return; }
    fullscreenZoomed = w.zoomed; fullscreenWindow = id;
    activate(id); w.zoomed = true; document.body.classList.add('mac-fullscreen'); render();
    app.requestFullscreen({ navigationUI: 'hide' }).catch(function () {
      fullscreenWindow = null; document.body.classList.remove('mac-fullscreen'); render();
      say('全画面を利用できないため、ウインドウを最大化しました');
    });
  }
  document.addEventListener('fullscreenchange', function () {
    if (fullscreenWindow && document.fullscreenElement !== app) leaveFullscreen();
    requestAnimationFrame(layout);
  });
  function setOverview(on) {
    closeMenu(); if (!openWindows().length) return;
    overview = on; render(); if (on) say('開いているウインドウを一覧表示しています');
  }
  function showDesktop() {
    if (fullscreenWindow) leaveFullscreen();
    closeMenu(); closeOverlay(false); if (overview) overview = false;
    if (desktopSaved) {
      var saved = desktopSaved; desktopSaved = null;
      saved.ids.forEach(function (id) { if (windows[id].open) windows[id].minimized = false; });
      if (saved.active && windows[saved.active].open) activate(saved.active); else nextWindow();
    } else {
      desktopSaved = { active: active, ids: openWindows().filter(function (w) { return !w.minimized; }).map(function (w) { return w.id; }) };
      openWindows().forEach(function (w) { stopAnimation(w); w.minimized = true; }); nextWindow();
    }
    render();
  }
  // Operational controls retain their clicks, text editing and native scrolling.
  function movableTarget(target) {
    return !target.closest('button, a, input, textarea, select, label, summary, iframe, canvas, video, audio, [contenteditable], [role="button"], [role="tab"], tr[data-id], [data-chat], [data-vact], .vitem, #vault-list, #vault-folders, #vault-backups, .mac-window-tabs');
  }
  function installDrag(w, handle, resizing) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !e.isPrimary || overview || isBlocked() || (!resizing && !movableTarget(e.target)) || (resizing && w.zoomed)) return;
      // On touch screens body swipes scroll; a deliberate long press moves the
      // window. The titlebar always moves immediately without scrolling.
      var touchBody = e.pointerType === 'touch' && !e.target.closest('.mac-titlebar');
      var start = point(e), dragging = false, ready = !touchBody, b, timer;
      if (!touchBody) e.preventDefault();
      function begin() {
        if (fullscreenWindow) leaveFullscreen();
        if (grouped) { grouped = false; prefs('tabs', 'no'); }
        stopAnimation(w); if (active !== w.id) activate(w.id);
        if (w.zoomed) {
          var ratio = Math.max(0, Math.min(1, start.x / area.clientWidth));
          w.zoomed = false; w.bounds.x = start.x - w.bounds.width * ratio; w.bounds.y = Math.max(0, start.y - 28);
        }
        b = Object.assign({}, w.bounds); dragging = true;
        handle.setPointerCapture(e.pointerId); w.node.classList.add('is-dragging'); render();
      }
      function move(ev) {
        if (ev.pointerId !== e.pointerId) return;
        var p = point(ev), dx = p.x - start.x, dy = p.y - start.y;
        if (!dragging) {
          if (!ready) { if (Math.hypot(dx, dy) > 6) done(); return; }
          if (Math.hypot(dx, dy) < 5) return;
          begin();
        }
        ev.preventDefault();
        w.bounds = resizing ? { x: b.x, y: b.y, width: b.width + dx, height: b.height + dy } : { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height };
        clamp(w); layout();
      }
      function done(ev) {
        if (ev && ev.pointerId !== e.pointerId) return;
        clearTimeout(timer); w.node.classList.remove('is-dragging');
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', done); handle.removeEventListener('lostpointercapture', done);
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        if (dragging) {
          // A drag must not trigger a click on whichever control it ends over.
          var cancelClick = function (event) { event.preventDefault(); event.stopImmediatePropagation(); };
          window.addEventListener('click', cancelClick, { once: true, capture: true });
          setTimeout(function () { window.removeEventListener('click', cancelClick, true); }, 0);
        } else if (ev && ev.type === 'pointerup' && e.pointerType === 'touch') {
          var now = Date.now();
          if (w.lastTap && now - w.lastTap.at < 350 && Math.hypot(ev.clientX - w.lastTap.x, ev.clientY - w.lastTap.y) < 20) { w.lastTap = null; w.lastTouchFullscreen = now; realFullscreen(w.id); }
          else w.lastTap = { at: now, x: ev.clientX, y: ev.clientY };
        }
      }
      if (touchBody) timer = setTimeout(function () { ready = true; begin(); }, 280);
      window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', done); window.addEventListener('pointercancel', done); handle.addEventListener('lostpointercapture', done);
    });
  }
  function point(e) {
    var r = area.getBoundingClientRect();
    return frame.classList.contains('turned') ? { x: e.clientY - r.top, y: r.right - e.clientX } : { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function closeMenu(restore) {
    menuHost.hidden = true; account.hidden = true;
    if (menu) { menu.setAttribute('aria-expanded', 'false'); if (restore) menu.focus(); }
    menu = null;
  }
  function menuItem(text, action, shortcut, disabled, selected) {
    var b = button('mac-menu-item', ''); b.setAttribute('role', selected === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (selected !== undefined) b.setAttribute('aria-checked', selected ? 'true' : 'false');
    b.appendChild(node('span', 'mac-menu-check', selected ? '✓' : '')); b.appendChild(node('span', 'mac-menu-text', text));
    if (shortcut) b.appendChild(node('kbd', '', shortcut)); b.disabled = !!disabled;
    b.addEventListener('click', function () { closeMenu(); action(); }); menuHost.appendChild(b);
  }
  function divider() { var d = node('div', 'mac-menu-separator'); d.setAttribute('role', 'separator'); menuHost.appendChild(d); }
  function openMenu(trigger) {
    if (menu === trigger) { closeMenu(true); return; }
    closeMenu(); menu = trigger; trigger.setAttribute('aria-expanded', 'true');
    var key = trigger.dataset.menu;
    if (key === 'account') { account.hidden = false; var first = account.querySelector('select:not(:disabled), button'); if (first) first.focus(); return; }
    menuHost.replaceChildren();
    menuItem('デスクトップを表示', showDesktop);
    menuItem('ウインドウを一覧表示', function () { setOverview(true); }, '', !openWindows().length);
    menuItem('ウインドウをタブにまとめる', function () { grouped = !grouped; prefs('tabs', grouped ? 'yes' : 'no'); if (!active) nextWindow(); render(); }, '', false, grouped);
    divider();
    // lighter on a slow phone or computer: no blur behind the glass, no gliding
    menuItem('リキッドグラス（ぼかし）', function () { var flat = document.body.classList.toggle('mac-flat'); prefs('glass', flat ? 'off' : 'on'); }, '', false, !document.body.classList.contains('mac-flat'));
    menuItem('滑らかなアニメーション', function () { var off = document.body.classList.toggle('mac-reduce-motion'); prefs('motion', off ? 'reduce' : 'full'); }, '', false, !document.body.classList.contains('mac-reduce-motion'));
    if (hoverPointer.matches) menuItem('アプリ一覧を自動で隠す', function () { autoHide = !autoHide; prefs('autohide', autoHide ? 'yes' : 'no'); if (autoHide) scheduleHide(300); else showDock(true); }, '', false, autoHide);
    menuItem('背景を変える', showWallpapers);
    menuItem('デスクトップの使い方', showHelp);
    menuHost.hidden = false;
    var r = trigger.getBoundingClientRect(), p = app.getBoundingClientRect();
    var left = frame.classList.contains('turned') ? r.top - p.top : r.left - p.left;
    menuHost.style.left = Math.max(6, Math.min(left, app.clientWidth - menuHost.offsetWidth - 6)) + 'px';
    var item = menuHost.querySelector('button:not(:disabled)'); if (item) item.focus();
  }
  top.addEventListener('click', function (e) { var b = e.target.closest('[data-menu]'); if (b) openMenu(b); });
  document.addEventListener('pointerdown', function (e) { if (menu && !e.target.closest('.mac-dropdown, .mac-account, [data-menu]')) closeMenu(); }, true);

  function isLite() { return document.body.classList.contains('mac-flat') && document.body.classList.contains('mac-reduce-motion'); }
  function setLite(on) {
    document.body.classList.toggle('mac-flat', on); document.body.classList.toggle('mac-reduce-motion', on);
    prefs('glass', on ? 'off' : 'on'); prefs('motion', on ? 'reduce' : 'full'); say(on ? '軽量化：オン' : '軽量化：オフ');
  }
  function syncLite() { var on = isLite(); liteButton.classList.toggle('is-on', on); liteButton.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  new MutationObserver(syncLite).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // 背景: the two that came with the site, and every one listed in assets/wallpapers.json
  // ([{ "id": "…", "name": "…", "file": "name.webp" }], the pictures in assets/wallpapers/).
  // 手動: the one chosen stays. ランダム: one every 10 minutes from a shuffled bag that holds each
  // picture once; when the bag is empty (every picture has been shown once: one cycle) it is
  // shuffled again, and the first of the next cycle is never the last of the one before.
  var WALLS = [{ id: 'desktop', name: '標準', url: 'assets/wallpaper-desktop.webp' }, { id: 'reserve', name: '予備', url: 'assets/wallpaper-reserve.webp' }];
  var WALL_EVERY = 10 * 60000, wallsLoaded = null, wallOverlay = null, wallTimer = 0;
  function wall(id) { return WALLS.filter(function (x) { return x.id === id; })[0] || WALLS[0]; }
  function applyWallpaper(id) {
    var w = wall(id), custom = w.id !== 'desktop' && w.id !== 'reserve';
    function set() {
      document.body.classList.toggle('mac-reserve-wallpaper', w.id === 'reserve');
      document.body.classList.toggle('mac-custom-wallpaper', custom);
      if (custom) document.body.style.setProperty('--mac-wall', "url('" + w.url + "')"); else document.body.style.removeProperty('--mac-wall');
    }
    // (the next picture is read first, so the screen never flashes empty)
    if (!custom) { set(); return; }
    var im = new Image(); im.onload = im.onerror = set; im.src = w.url;
  }
  function shuffled(list, notFirst) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    if (a.length > 1 && a[0] === notFirst) { var t2 = a[0]; a[0] = a[1]; a[1] = t2; }
    return a;
  }
  function readJson(key) { try { return JSON.parse(prefs(key) || 'null'); } catch (e) { return null; } }
  function wallMode() { return prefs('wallmode') === 'random' ? 'random' : 'manual'; }
  // the bag: { bag: [ids still to show], last: id, at: when the picture changed, cycle: how many cycles are done }
  function stepWallpaper(force) {
    if (wallMode() !== 'random' || !wallsLoaded) return;
    var ids = WALLS.map(function (x) { return x.id; }), st = readJson('wallbag') || { bag: [], last: '', at: 0, cycle: 0 };
    st.bag = (st.bag || []).filter(function (id) { return ids.indexOf(id) >= 0; });
    var now = Date.now(), due = force || !st.at || now - st.at >= WALL_EVERY || st.at > now;
    if (!due) { applyWallpaper(st.last); return; }
    if (!st.bag.length) { st.bag = shuffled(ids, st.last); if (st.last) st.cycle = (st.cycle || 0) + 1; }
    st.last = st.bag.shift(); st.at = now;
    prefs('wallbag', JSON.stringify(st)); prefs('wallpaper', st.last); applyWallpaper(st.last);
  }
  function wallTick() {
    clearInterval(wallTimer); wallTimer = 0;
    if (wallMode() !== 'random') return;
    wallTimer = setInterval(function () { stepWallpaper(false); }, 15000);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) stepWallpaper(false); });
  function setWallMode(m) {
    prefs('wallmode', m);
    if (m === 'random') {
      // (the picture shown now counts as shown: it is not in the bag again this cycle)
      var cur = prefs('wallpaper') || 'desktop', ids = WALLS.map(function (x) { return x.id; });
      prefs('wallbag', JSON.stringify({ bag: shuffled(ids.filter(function (id) { return id !== cur; }), cur), last: cur, at: Date.now(), cycle: 0 }));
    }
    wallTick();
  }
  function loadWalls() {
    if (wallsLoaded) return wallsLoaded;
    wallsLoaded = fetch('assets/wallpapers.json', { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      (Array.isArray(list) ? list : []).slice(0, 200).forEach(function (x) {
        if (!x || !/^[\w-]{1,40}$/.test(x.id) || !/^[\w.-]{1,80}\.(webp|jpg|jpeg|png)$/i.test(x.file)) return;
        if (!WALLS.some(function (w) { return w.id === x.id; })) WALLS.push({ id: x.id, name: String(x.name || x.id).slice(0, 20), url: 'assets/wallpapers/' + x.file });
      });
    }).catch(function () { /* only the two that came with the site */ }).then(function () {
      if (wallMode() === 'random') stepWallpaper(false); else applyWallpaper(prefs('wallpaper') || 'desktop');
      wallTick();
    });
    return wallsLoaded;
  }
  function showWallpapers() {
    if (app.hidden) return;
    loadWalls().then(function () {
      if (!wallOverlay) {
        wallOverlay = node('div', 'mac-help mac-overlay'); wallOverlay.setAttribute('role', 'dialog'); wallOverlay.setAttribute('aria-modal', 'true'); wallOverlay.setAttribute('aria-label', '背景を変える');
        wallOverlay.addEventListener('click', function (e) { if (e.target === wallOverlay) closeOverlay(); });
        app.appendChild(wallOverlay);
      }
      var panel = node('div', 'mac-help-panel mac-wall-panel'); panel.appendChild(picture('wallpaper-app')); panel.appendChild(node('h2', '', '背景を変える'));
      var modes = node('div', 'mac-wall-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '切り替え方');
      var info = node('p', 'mac-wall-info');
      function drawInfo() {
        var st = readJson('wallbag') || {};
        info.textContent = wallMode() === 'random'
          ? '10分ごとに、全部で ' + WALLS.length + ' 枚の背景を1枚ずつ順に出します（全部出し終わるまで同じ画像は出ません。出し終えたら次のサイクル）。いまの周回：' + (WALLS.length - (st.bag || []).length) + ' / ' + WALLS.length + ' 枚目'
          : '選んだ背景のままです。';
      }
      var current = prefs('wallpaper') || 'desktop', grid = node('div', 'mac-wall-grid');
      function paint() {
        Array.prototype.forEach.call(modes.children, function (b) { var on = b.dataset.mode === wallMode(); b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        current = prefs('wallpaper') || 'desktop';
        Array.prototype.forEach.call(grid.children, function (b) { var on = b.dataset.id === current; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        drawInfo();
      }
      [['manual', '手動'], ['random', 'ランダム（10分ごと）']].forEach(function (m) {
        var b = button('mac-wall-mode', m[1]); b.dataset.mode = m[0];
        b.addEventListener('click', function () { setWallMode(m[0]); paint(); });
        modes.appendChild(b);
      });
      WALLS.forEach(function (w) {
        var b = button('mac-wall-item', '', w.name); b.dataset.id = w.id;
        var img = node('img'); img.src = w.url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false; b.appendChild(img); b.appendChild(node('span', '', w.name));
        // (choosing one by hand is choosing 手動)
        b.addEventListener('click', function () { if (wallMode() !== 'manual') setWallMode('manual'); prefs('wallpaper', w.id); applyWallpaper(w.id); paint(); });
        grid.appendChild(b);
      });
      panel.appendChild(modes); panel.appendChild(info); panel.appendChild(grid);
      var close = button('btn primary', '閉じる'); close.addEventListener('click', function () { closeOverlay(); }); panel.appendChild(close);
      wallOverlay.replaceChildren(panel); paint(); showOverlay(wallOverlay);
    });
  }

  function showOverlay(n) {
    closeMenu(); closeOverlay(false); returnFocus = document.activeElement; overlay = n; n.hidden = false;
    var input = n.querySelector('input, button'); if (input) input.focus();
  }
  function closeOverlay(restore) {
    if (!overlay) return; overlay.hidden = true; overlay = null;
    if (restore !== false) {
      var target = returnFocus && returnFocus.isConnected && returnFocus.getClientRects().length ? returnFocus : home;
      target.focus({ preventScroll: true });
    }
    returnFocus = null;
  }
  function showHelp() { if (!app.hidden) showOverlay(help); }

  // Capture clicks only to update the window chrome. The ORIGINAL bubbling
  // listener on #tabs still performs every route, data load and permission check.
  tabs.addEventListener('click', function (e) {
    var t = e.target.closest('.tab[data-view]'); if (!t || t.hidden || silentRouting) return;
    suppressedRoute = ''; present(t.dataset.view);
  }, true);
  function syncPermissions() {
    APPS.forEach(function (a) {
      var w = windows[a[0]];
      if (!allowed(w)) { stopAnimation(w); w.open = false; w.minimized = false; if (active === w.id) active = null; }
    });
    renderNotices();
  }
  function syncSession() {
    var now = !app.hidden;
    document.body.classList.toggle('mac-signed-in', now);
    if (now === signedIn) return; signedIn = now;
    if (!now) {
      if (fullscreenWindow) leaveFullscreen();
      notices = []; noticeCounts = {}; renderNotices();
      active = null; overview = false; desktopSaved = null; suppressedRoute = ''; closeOverlay(false); closeMenu();
      APPS.forEach(function (a) { var w = windows[a[0]]; stopAnimation(w); w.open = false; w.minimized = false; w.zoomed = false; w.bounds = null; });
    }
    syncPermissions(); render();
    if (now) { showDock(true); scheduleHide(2600); }
  }
  function syncDialog() {
    var field = document.getElementById('dialog-field'), input = document.getElementById('dialog-input');
    dialog.classList.toggle('mac-auth-dialog', !dialog.hidden && !field.hidden && input.type === 'password');
  }
  new MutationObserver(syncSession).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  var navObserver = new MutationObserver(function (records) {
    syncPermissions();
    var changed = records.some(function (r) {
      return r.type === 'attributes' && r.attributeName === 'class' && r.target.classList.contains('tab') && /(^|\s)on(\s|$)/.test(r.oldValue || '') !== r.target.classList.contains('on');
    });
    if (changed && !app.hidden) {
      var tab = tabs.querySelector('.tab.on');
      if (tab && tab.dataset.view !== suppressedRoute && active !== tab.dataset.view) present(tab.dataset.view);
    }
  });
  navObserver.observe(tabs, { attributes: true, attributeFilter: ['hidden', 'class'], attributeOldValue: true, childList: true, characterData: true, subtree: true });
  var viewObserver = new MutationObserver(function (records) {
    if (app.hidden) return;
    var shown = records.find(function (r) { return !r.target.hidden && r.target.id && r.target.id.indexOf('view-') === 0; });
    if (shown) { var id = shown.target.id.slice(5); if (id !== suppressedRoute && (!active || active !== id)) present(id); }
  });
  APPS.forEach(function (a) { viewObserver.observe(windows[a[0]].view, { attributes: true, attributeFilter: ['hidden'] }); });
  var authObserver = new MutationObserver(syncDialog);
  [dialog, document.getElementById('dialog-field'), document.getElementById('dialog-input')].forEach(function (n) { authObserver.observe(n, { attributes: true, attributeFilter: ['hidden', 'type'] }); });

  var tooltip = node('div', 'mac-tooltip'); tooltip.hidden = true; app.appendChild(tooltip);
  function showTooltip(e) {
    var tab = e.target.closest('#tabs .tab'); if (!tab) return;
    var r = tab.getBoundingClientRect(), p = app.getBoundingClientRect();
    tooltip.textContent = tab.getAttribute('aria-label'); tooltip.hidden = false;
    tooltip.style.bottom = p.bottom - r.top + 12 + 'px';
    tooltip.style.left = Math.max(10, Math.min(r.left - p.left + r.width / 2 - tooltip.offsetWidth / 2, app.clientWidth - tooltip.offsetWidth - 10)) + 'px';
  }
  tabs.addEventListener('pointerover', function (e) { if (e.pointerType !== 'touch') showTooltip(e); });
  tabs.addEventListener('focusin', showTooltip);
  tabs.addEventListener('focusout', function () { tooltip.hidden = true; });
  tabs.addEventListener('pointerleave', function () { tooltip.hidden = true; });
  tabs.addEventListener('click', function () { tooltip.hidden = true; }, true);
  dock.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch' || reduced()) return;
    Array.prototype.forEach.call(dock.querySelectorAll('.tab:not([hidden]), .mac-dock-home, .mac-dock-tool'), function (b) {
      var r = b.getBoundingClientRect(), dist = frame.classList.contains('turned') ? Math.abs(e.clientY - r.top - r.height / 2) : Math.abs(e.clientX - r.left - r.width / 2);
      b.style.setProperty('--dock-scale', 1 + .5 * Math.pow(Math.max(0, 1 - dist / 110), 2));
    });
  });
  dock.addEventListener('pointerleave', function () { dock.querySelectorAll('button').forEach(function (b) { b.style.removeProperty('--dock-scale'); }); });
  window.addEventListener('resize', function () { requestAnimationFrame(layout); });
  if (window.ResizeObserver) new ResizeObserver(layout).observe(area);

  document.addEventListener('keydown', function (e) {
    if (app.hidden) return;
    if (overlay) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeOverlay(); return; }
      if (e.key === 'Tab') {
        var focusable = Array.from(overlay.querySelectorAll('input, button:not([hidden]), a[href]')).filter(function (n) { return !n.disabled && n.getClientRects().length; });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (menu) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(true); return; }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && !menuHost.hidden) {
        e.preventDefault(); var items = Array.from(menuHost.querySelectorAll('button:not(:disabled)')), i = items.indexOf(document.activeElement);
        var next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; if (items[next]) items[next].focus(); return;
      }
      if (e.key === 'Tab') closeMenu();
    }
    if (isBlocked()) return;
    if (e.altKey && e.code === 'Space') { e.preventDefault(); openMenu(home); return; }
    if (e.key === 'Escape' && fullscreenWindow) { e.preventDefault(); leaveFullscreen(); return; }
    if (e.key === 'Escape' && noticesOpen) { setNoticesOpen(false); notificationToggle.focus(); return; }
    if (e.key === 'Escape' && overview) { e.preventDefault(); setOverview(false); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'w' && active) { e.preventDefault(); closeWindow(active); }
    else if (e.key.toLowerCase() === 'm' && active) { e.preventDefault(); minimize(active); }
    else if (e.key === 'Enter' && active) { e.preventDefault(); zoom(active); }
    else if (e.code === 'Backquote') {
      var list = openWindows().filter(function (w) { return !w.minimized; }); if (!list.length) return;
      e.preventDefault(); var index = list.findIndex(function (w) { return w.id === active; }); activate(list[(index + 1) % list.length].id);
    }
  }, true);

  document.body.classList.toggle('mac-reserve-wallpaper', prefs('wallpaper') === 'reserve');
  loadWalls();
  document.body.classList.toggle('mac-reduce-motion', prefs('motion') === 'reduce');
  document.body.classList.toggle('mac-flat', prefs('glass') === 'off');
  grouped = prefs('tabs') === 'yes';
  document.body.classList.add('mac-ui'); syncSession(); syncDialog(); syncPermissions(); render(); syncLite();
})();
