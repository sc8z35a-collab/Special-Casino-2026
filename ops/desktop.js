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
    ['devunit', 'DEV UNIT', 'devunit'], ['securityhome', 'セキュリティーホーム', 'securityhome']
  ];
  var windows = {}, active = null, order = 0, signedIn = false, grouped = false;
  var overview = false, desktopSaved = null, silentRouting = false, suppressedRoute = '';
  var internalLaunch = false;
  var menu = null, overlay = null, returnFocus = null, editingTarget = null;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktop, icons, area, dock, launcher, help, menuHost, account, announce;

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
      var n = document.getElementById(id); return n && !n.hidden;
    });
  }
  function prefs(key, value) {
    try {
      if (value === undefined) return localStorage.getItem('two-state-ops/ui/' + key);
      localStorage.setItem('two-state-ops/ui/' + key, value);
    } catch (e) { /* Layout preferences are optional. */ }
    return null;
  }

  // The old top bar becomes the menu bar; its existing account controls live
  // in a popover and its actual tabs become the Dock (no duplicate IDs).
  var brand = top.querySelector('.brand'), controls = top.querySelector('.top-right');
  brand.replaceChildren();
  var home = button('mac-system-menu', '', 'TWO STATE メニュー');
  home.appendChild(picture('site')); home.dataset.menu = 'system';
  home.setAttribute('aria-haspopup', 'menu'); home.setAttribute('aria-expanded', 'false');
  brand.appendChild(home);
  brand.appendChild(node('strong', 'mac-active-app', 'TWO STATE'));
  var menuButtons = node('div', 'mac-menu-buttons');
  [['file', 'ファイル'], ['edit', '編集'], ['view', '表示'], ['window', 'ウインドウ'], ['help', 'ヘルプ']].forEach(function (m) {
    var b = button('mac-menu-trigger', m[1]); b.dataset.menu = m[0];
    b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); menuButtons.appendChild(b);
  });
  top.appendChild(menuButtons);
  var status = node('div', 'mac-status');
  var search = button('mac-status-button mac-search-icon', '', 'アプリケーションを検索（Ctrl / ⌘ K）');
  search.addEventListener('click', function () { showLauncher(); }); status.appendChild(search);
  var mission = button('mac-status-button mac-mission-icon', '▦', '開いているウインドウを一覧表示');
  mission.addEventListener('click', function () { setOverview(!overview); }); status.appendChild(mission);
  var connection = node('span', 'mac-connection'); connection.setAttribute('role', 'img'); status.appendChild(connection);
  var profile = button('mac-status-button mac-profile', '', '運営アカウントと更新頻度');
  profile.appendChild(picture('operators')); profile.dataset.menu = 'account';
  profile.setAttribute('aria-haspopup', 'true'); profile.setAttribute('aria-expanded', 'false'); status.appendChild(profile);
  var clock = node('time', 'mac-clock'); status.appendChild(clock); top.appendChild(status);

  account = node('div', 'mac-account mac-popover'); account.id = 'mac-account'; account.hidden = true;
  var accountHead = node('div', 'mac-account-head'); accountHead.appendChild(picture('operators'));
  accountHead.appendChild(node('span', '', '運営アカウント')); account.appendChild(accountHead);
  account.appendChild(controls); app.appendChild(account);
  menuHost = node('div', 'mac-dropdown'); menuHost.id = 'mac-menu'; menuHost.hidden = true;
  menuHost.setAttribute('role', 'menu'); app.appendChild(menuHost);

  desktop = node('div', 'mac-desktop'); desktop.setAttribute('aria-label', 'デスクトップ');
  icons = node('div', 'mac-desktop-icons'); desktop.appendChild(icons);
  desktop.appendChild(node('span', 'mac-desktop-note', 'TWO STATE · サーバー運営サイト'));
  desktop.addEventListener('pointerdown', function (e) {
    if (e.target === desktop) {
      icons.querySelectorAll('.is-selected').forEach(function (n) { n.classList.remove('is-selected'); });
      closeMenu();
    }
  });
  app.insertBefore(desktop, top.nextSibling);
  area = node('div', 'mac-windows'); area.id = 'mac-windows'; app.appendChild(area);

  dock = node('div', 'mac-dock'); dock.setAttribute('aria-label', 'Dock');
  var dockHome = button('mac-dock-home', '', 'デスクトップを表示');
  dockHome.appendChild(picture('site')); dockHome.appendChild(node('span', 'mac-dock-label', 'デスクトップ'));
  dockHome.addEventListener('click', showDesktop); dock.appendChild(dockHome);
  dock.appendChild(node('span', 'mac-dock-divider')); dock.appendChild(tabs); app.appendChild(dock);
  tabs.setAttribute('aria-label', '運営アプリケーション');
  tabs.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-view]'), w = tab && windows[tab.dataset.view];
    if (!w || internalLaunch || app.hidden || isBlocked()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (w.open && !w.minimized) minimize(w.id); else activate(w.id);
  }, true);

  APPS.forEach(function (a) {
    var id = a[0], tab = tabs.querySelector('[data-view="' + id + '"]');
    var view = document.getElementById('view-' + id);
    var count = tab.querySelector('.count');
    var w = windows[id] = { id: id, name: a[1], image: a[2], tab: tab, view: view, open: false, minimized: false, zoomed: false, rank: 0, animation: null, bounds: null };
    tab.replaceChildren(picture(w.image), node('span', 'mac-dock-label', w.name));
    if (count) tab.appendChild(count);
    tab.setAttribute('aria-label', w.name); tab.title = w.name;

    var launch = button('mac-desktop-app', '', w.name + 'を開く'); launch.dataset.app = id;
    launch.appendChild(picture(w.image)); launch.appendChild(node('span', 'mac-desktop-label', w.name));
    launch.appendChild(node('b', 'mac-desktop-badge')); icons.appendChild(launch); w.launch = launch;
    launch.addEventListener('click', function () {
      icons.querySelectorAll('.is-selected').forEach(function (n) { n.classList.remove('is-selected'); });
      launch.classList.add('is-selected');
      if (window.matchMedia('(pointer: coarse)').matches) activate(id);
    });
    launch.addEventListener('dblclick', function () { activate(id); });
    launch.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); activate(id); } });

    var win = node('section', 'mac-window'); win.id = 'mac-window-' + id;
    win.setAttribute('role', 'region'); win.setAttribute('aria-label', w.name); win.tabIndex = -1;
    var titlebar = node('div', 'mac-titlebar'), lights = node('div', 'mac-traffic-lights');
    [['close', '×', '閉じる'], ['minimize', '−', '最小化'], ['zoom', '↗', '最大化 / 元に戻す']].forEach(function (a) {
      var b = button('mac-light mac-' + a[0], a[1], w.name + '：' + a[2]); b.title = a[2];
      b.addEventListener('click', function () {
        if (a[0] === 'close') closeWindow(id);
        else if (a[0] === 'minimize') minimize(id);
        else zoom(id);
      }); lights.appendChild(b);
    });
    titlebar.appendChild(lights);
    var title = node('div', 'mac-window-title'); title.appendChild(picture(w.image)); title.appendChild(node('strong', '', w.name));
    titlebar.appendChild(title);
    var allApps = button('mac-window-apps', '▦', '別のアプリケーションを開く');
    allApps.addEventListener('click', function () { showLauncher(); }); titlebar.appendChild(allApps);
    titlebar.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) zoom(id); });
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
    area.appendChild(win); installDrag(w, titlebar, false); installDrag(w, resize, true);
    titlebar.addEventListener('pointerdown', function (e) {
      if (!overview && !e.target.closest('button') && active !== id) activate(id);
    });
  });

  // Search and help contain UI controls only; they never copy any app content.
  launcher = node('div', 'mac-launchpad mac-overlay'); launcher.id = 'mac-launchpad'; launcher.hidden = true;
  launcher.setAttribute('role', 'dialog'); launcher.setAttribute('aria-modal', 'true'); launcher.setAttribute('aria-label', 'アプリケーション');
  var launchPanel = node('div', 'mac-launch-panel'), launchHead = node('div', 'mac-launch-head');
  launchHead.appendChild(node('h2', '', 'アプリケーション'));
  var launchClose = button('mac-overlay-close', '×', 'アプリケーション一覧を閉じる'); launchClose.addEventListener('click', closeOverlay); launchHead.appendChild(launchClose);
  launchPanel.appendChild(launchHead);
  var launchSearch = node('input', 'mac-launch-search'); launchSearch.type = 'search'; launchSearch.placeholder = 'アプリケーションを検索'; launchSearch.setAttribute('aria-label', 'アプリケーションを検索');
  launchPanel.appendChild(launchSearch);
  var launchGrid = node('div', 'mac-launch-grid'); launchPanel.appendChild(launchGrid);
  var launchEmpty = node('p', 'mac-launch-empty', '該当するアプリケーションはありません'); launchEmpty.hidden = true; launchPanel.appendChild(launchEmpty);
  launcher.appendChild(launchPanel); app.appendChild(launcher);
  APPS.forEach(function (a) {
    var w = windows[a[0]], b = button('mac-launch-app', '', w.name + 'を開く'); b.dataset.app = w.id;
    b.appendChild(picture(w.image)); b.appendChild(node('span', '', w.name)); w.searchButton = b;
    b.addEventListener('click', function () { closeOverlay(false); activate(w.id); w.node.focus({ preventScroll: true }); }); launchGrid.appendChild(b);
  });
  function filterLauncher() {
    var q = launchSearch.value.trim().toLocaleLowerCase(), n = 0;
    APPS.forEach(function (a) { var w = windows[a[0]]; w.searchButton.hidden = !allowed(w) || (w.name + ' ' + w.id).toLocaleLowerCase().indexOf(q) < 0; if (!w.searchButton.hidden) n++; });
    launchEmpty.hidden = !!n;
  }
  launchSearch.addEventListener('input', filterLauncher);
  launchSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var first = launchGrid.querySelector('button:not([hidden])'); if (first) first.click(); }
    if (e.key === 'ArrowDown') { var next = launchGrid.querySelector('button:not([hidden])'); if (next) { e.preventDefault(); next.focus(); } }
  });
  help = node('div', 'mac-help mac-overlay'); help.hidden = true; help.setAttribute('role', 'dialog'); help.setAttribute('aria-modal', 'true'); help.setAttribute('aria-label', 'デスクトップの使い方');
  var helpPanel = node('div', 'mac-help-panel'); helpPanel.appendChild(picture('site')); helpPanel.appendChild(node('h2', '', 'TWO STATE デスクトップ'));
  helpPanel.appendChild(node('p', '', 'Dockはクリックで表示・非表示を切り替え、デスクトップのアイコンはダブルクリックで開きます。ウインドウの上部をドラッグして移動し、右下をドラッグして大きさを変えられます。'));
  var helpList = node('dl', 'mac-shortcuts');
  [['Ctrl / ⌘ K', 'アプリケーションを検索'], ['Alt W', 'ウインドウを閉じる'], ['Alt M', '最小化'], ['Alt Enter', '最大化 / 元に戻す'], ['Alt `', '次のウインドウ'], ['Esc', '一覧やメニューを閉じる']].forEach(function (r) { helpList.appendChild(node('dt', '', r[0])); helpList.appendChild(node('dd', '', r[1])); });
  helpPanel.appendChild(helpList); helpPanel.appendChild(node('p', 'mac-help-note', '「ウインドウ」メニューからタブ表示に切り替えられます。閉じても入力中の内容はこのページに残ります。'));
  var helpClose = button('btn primary', '閉じる'); helpClose.addEventListener('click', closeOverlay); helpPanel.appendChild(helpClose); help.appendChild(helpPanel); app.appendChild(help);
  [launcher, help].forEach(function (n) { n.addEventListener('click', function (e) { if (e.target === n) closeOverlay(); }); });
  announce = node('div', 'mac-sr-only'); announce.setAttribute('role', 'status'); announce.setAttribute('aria-live', 'polite'); app.appendChild(announce);

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
    [connection, loginConnection].forEach(function (n) { n.classList.toggle('is-offline', !navigator.onLine); n.setAttribute('aria-label', navigator.onLine ? 'ネットワーク接続あり' : 'オフライン'); n.title = n.getAttribute('aria-label'); });
  }
  updateClock(); setInterval(updateClock, 30000); window.addEventListener('online', updateClock); window.addEventListener('offline', updateClock);

  function defaultBounds(w) {
    var i = openWindows().length % 5, width = Math.min(1060, area.clientWidth - 56), height = Math.min(690, area.clientHeight - 36);
    w.bounds = { x: (area.clientWidth - width) / 2 + i * 15 - 30, y: 16 + i * 18, width: width, height: height };
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
    icons.style.setProperty('--desktop-rows', Math.max(2, Math.min(5, Math.floor((ah - 24) / (ah < 420 ? 78 : 104)))));
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
      w.node.style.zIndex = selected ? 16 : Math.max(1, w.rank);
      w.tab.classList.toggle('mac-running', w.open); w.tab.classList.toggle('mac-focused', selected);
      w.tab.setAttribute('aria-pressed', selected ? 'true' : 'false');
      w.node.querySelector('.mac-zoom').setAttribute('aria-pressed', w.zoomed ? 'true' : 'false');
    });
    var focused = active && windows[active];
    top.querySelector('.mac-active-app').textContent = focused ? focused.name : 'TWO STATE';
    buildStrips(); layout();
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
      var add = button('mac-new-tab', '+', 'アプリケーションをタブで開く'); add.addEventListener('click', function () { showLauncher(); }); host.strip.appendChild(add);
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
    var w = windows[id]; if (!w || !w.open) return;
    stopAnimation(w); var wasActive = active === id; w.open = false; w.minimized = false;
    w.node.classList.add('is-closing');
    if (wasActive) nextWindow(); else render();
    animate(w, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'translateY(6px) scale(.97)' }], 140, function () { w.node.classList.remove('is-closing'); });
    say(w.name + 'を閉じました');
    if (wasActive) { var focus = active ? windows[active].node : w.tab; focus.focus({ preventScroll: true }); }
  }
  function minimize(id) {
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
  function zoom(id) { var w = windows[id]; if (!w || !w.open) return; stopAnimation(w); if (active !== id) activate(id); w.zoomed = !w.zoomed; render(); }
  function setOverview(on) {
    closeMenu(); if (!openWindows().length) { if (on) showLauncher(); return; }
    overview = on; render(); if (on) say('開いているウインドウを一覧表示しています');
  }
  function showDesktop() {
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
  function installDrag(w, handle, resizing) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || overview || grouped || (!resizing && e.target.closest('button')) || (resizing && w.zoomed)) return;
      e.preventDefault(); stopAnimation(w); if (active !== w.id) activate(w.id);
      var start = point(e);
      if (w.zoomed) {
        var ratio = Math.max(0, Math.min(1, start.x / area.clientWidth));
        w.zoomed = false; w.bounds.x = start.x - w.bounds.width * ratio; w.bounds.y = start.y - 25; clamp(w); render();
      }
      var b = Object.assign({}, w.bounds); handle.setPointerCapture(e.pointerId); w.node.classList.add('is-dragging');
      function move(e) {
        var p = point(e), dx = p.x - start.x, dy = p.y - start.y;
        w.bounds = resizing ? { x: b.x, y: b.y, width: b.width + dx, height: b.height + dy } : { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height };
        clamp(w); layout();
      }
      function done() { w.node.classList.remove('is-dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); handle.removeEventListener('pointercancel', done); handle.removeEventListener('lostpointercapture', done); }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done); handle.addEventListener('lostpointercapture', done);
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
  function selectedText() {
    var n = editingTarget;
    if (n && /^(INPUT|TEXTAREA)$/.test(n.tagName) && n.type !== 'password' && typeof n.selectionStart === 'number') return n.value.slice(n.selectionStart, n.selectionEnd);
    return String(window.getSelection() || '');
  }
  function openMenu(trigger) {
    if (menu === trigger) { closeMenu(true); return; }
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) editingTarget = document.activeElement;
    closeMenu(); menu = trigger; trigger.setAttribute('aria-expanded', 'true');
    var key = trigger.dataset.menu;
    if (key === 'account') { account.hidden = false; var first = account.querySelector('select:not(:disabled), button'); if (first) first.focus(); return; }
    menuHost.replaceChildren(); var w = active && windows[active];
    if (key === 'system') {
      menuItem('このデスクトップについて', function () { showHelp(); }); divider();
      menuItem('アプリケーション…', showLauncher, '⌘ K'); menuItem('デスクトップを表示', showDesktop); divider();
      menuItem('ログアウト…', function () { document.getElementById('logout').click(); });
    } else if (key === 'file') {
      menuItem('アプリケーションを開く…', showLauncher, '⌘ K'); divider();
      menuItem('ウインドウを閉じる', function () { closeWindow(active); }, 'Alt W', !w);
    } else if (key === 'edit') {
      menuItem('選択部分をコピー', function () {
        var text = selectedText(); if (!text) return;
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { say('コピーしました'); }, function () { say('コピーできませんでした。Ctrl / ⌘ C を使ってください'); });
      }, '⌘ C', !selectedText());
      menuItem('すべて選択', function () {
        if (editingTarget && /^(INPUT|TEXTAREA)$/.test(editingTarget.tagName)) { editingTarget.focus(); editingTarget.select(); }
        else if (w) { var range = document.createRange(); range.selectNodeContents(w.view); var s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
      }, '⌘ A', !w && !(editingTarget && /^(INPUT|TEXTAREA)$/.test(editingTarget.tagName)));
    } else if (key === 'view') {
      menuItem('デスクトップを表示', showDesktop); menuItem('アプリケーション一覧', showLauncher); divider();
      menuItem('予備の背景を使う', function () { var on = document.body.classList.toggle('mac-reserve-wallpaper'); prefs('wallpaper', on ? 'reserve' : 'desktop'); }, '', false, document.body.classList.contains('mac-reserve-wallpaper'));
      menuItem('Dockを小さくする', function () { var on = document.body.classList.toggle('mac-small-dock'); prefs('dock', on ? 'small' : 'normal'); layout(); }, '', false, document.body.classList.contains('mac-small-dock'));
      menuItem('動きを減らす', function () { var on = document.body.classList.toggle('mac-reduce-motion'); prefs('motion', on ? 'reduce' : 'full'); }, '', false, document.body.classList.contains('mac-reduce-motion'));
    } else if (key === 'window') {
      menuItem('最小化', function () { minimize(active); }, 'Alt M', !w);
      menuItem('拡大 / 縮小', function () { zoom(active); }, 'Alt ↵', !w);
      menuItem('ウインドウを一覧表示', function () { setOverview(true); }, '', !openWindows().length); divider();
      menuItem('ウインドウをタブにまとめる', function () { grouped = !grouped; prefs('tabs', grouped ? 'yes' : 'no'); if (!active) nextWindow(); render(); }, '', false, grouped);
      if (openWindows().length) divider();
      openWindows().forEach(function (win) { menuItem(win.name + (win.minimized ? '（最小化）' : ''), function () { activate(win.id); }, '', false, active === win.id); });
    } else menuItem('デスクトップの使い方', showHelp);
    menuHost.hidden = false;
    var r = trigger.getBoundingClientRect(), p = app.getBoundingClientRect();
    var left = frame.classList.contains('turned') ? r.top - p.top : r.left - p.left;
    menuHost.style.left = Math.max(6, Math.min(left, app.clientWidth - menuHost.offsetWidth - 6)) + 'px';
    var item = menuHost.querySelector('button:not(:disabled)'); if (item) item.focus();
  }
  top.addEventListener('click', function (e) { var b = e.target.closest('[data-menu]'); if (b) openMenu(b); });
  top.addEventListener('pointerdown', function (e) { if (e.target.closest('[data-menu]')) editingTarget = document.activeElement; });
  document.addEventListener('pointerdown', function (e) { if (menu && !e.target.closest('.mac-dropdown, .mac-account, [data-menu]')) closeMenu(); }, true);

  function showOverlay(n) {
    closeMenu(); closeOverlay(false); returnFocus = document.activeElement; overlay = n; n.hidden = false;
    var input = n.querySelector('input, button'); if (input) input.focus();
  }
  function closeOverlay(restore) {
    if (!overlay) return; overlay.hidden = true; overlay = null;
    if (restore !== false) {
      var target = returnFocus && returnFocus.isConnected && returnFocus.getClientRects().length ? returnFocus : search;
      target.focus({ preventScroll: true });
    }
    returnFocus = null;
  }
  function showLauncher() { if (app.hidden || isBlocked()) return; launchSearch.value = ''; filterLauncher(); showOverlay(launcher); launchSearch.focus(); }
  function showHelp() { if (!app.hidden) showOverlay(help); }

  // Capture clicks only to update the window chrome. The ORIGINAL bubbling
  // listener on #tabs still performs every route, data load and permission check.
  tabs.addEventListener('click', function (e) {
    var t = e.target.closest('.tab[data-view]'); if (!t || t.hidden || silentRouting) return;
    suppressedRoute = ''; present(t.dataset.view);
  }, true);
  function syncPermissions() {
    APPS.forEach(function (a) {
      var w = windows[a[0]]; w.launch.hidden = !allowed(w);
      if (!allowed(w)) { stopAnimation(w); w.open = false; w.minimized = false; if (active === w.id) active = null; }
      var count = w.tab.querySelector('.count'), badge = w.launch.querySelector('.mac-desktop-badge');
      badge.hidden = !count || count.hidden; badge.textContent = count ? count.textContent : '';
    });
    if (overlay === launcher) filterLauncher();
  }
  function syncSession() {
    var now = !app.hidden;
    document.body.classList.toggle('mac-signed-in', now);
    if (now === signedIn) return; signedIn = now;
    if (!now) {
      active = null; overview = false; desktopSaved = null; suppressedRoute = ''; closeOverlay(false); closeMenu();
      APPS.forEach(function (a) { var w = windows[a[0]]; stopAnimation(w); w.open = false; w.minimized = false; w.zoomed = false; w.bounds = null; });
    }
    syncPermissions(); render();
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

  dock.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch' || reduced()) return;
    Array.prototype.forEach.call(dock.querySelectorAll('.tab:not([hidden]), .mac-dock-home'), function (b) {
      var r = b.getBoundingClientRect(), dist = frame.classList.contains('turned') ? Math.abs(e.clientY - r.top - r.height / 2) : Math.abs(e.clientX - r.left - r.width / 2);
      b.style.setProperty('--dock-scale', 1 + .38 * Math.pow(Math.max(0, 1 - dist / 110), 2));
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
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); showLauncher(); return; }
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
  document.body.classList.toggle('mac-small-dock', prefs('dock') === 'small');
  document.body.classList.toggle('mac-reduce-motion', prefs('motion') === 'reduce');
  grouped = prefs('tabs') === 'yes';
  document.body.classList.add('mac-ui'); syncSession(); syncDialog(); syncPermissions(); render();
})();
