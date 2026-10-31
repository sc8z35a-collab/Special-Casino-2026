/* Item tabs reuse the original controls and keep their DOM IDs unique. */
(function () {
  'use strict';
  window.createVaultTabs = function () {
    var nav = document.getElementById('vault-work-tabs'), panes = document.getElementById('vault-work-panes'), list = document.getElementById('vault-main');
    var entries = Object.create(null), tabs = Object.create(null), active = 'list', serial = 0;

    function draw() {
      var keys = ['list'].concat(Object.keys(entries));
      Object.keys(tabs).forEach(function (key) { if (key !== 'list' && !entries[key]) { tabs[key].cell.remove(); delete tabs[key]; } });
      keys.forEach(function (key, i) {
        var title = key === 'list' ? '一覧' : entries[key].title, pane = key === 'list' ? list : entries[key].pane;
        var tab = tabs[key];
        if (!tab) {
          var cell = document.createElement('span'); cell.className = 'vault-work-tab';
          var b = document.createElement('button'); b.type = 'button'; b.dataset.key = key; b.setAttribute('role', 'tab');
          b.id = pane.id + '-tab'; b.setAttribute('aria-controls', pane.id); pane.setAttribute('aria-labelledby', b.id); cell.appendChild(b);
          var x = null;
          if (key !== 'list') {
            x = document.createElement('button'); x.type = 'button'; x.dataset.key = key; x.textContent = '×'; x.className = 'vault-work-close'; cell.appendChild(x);
          }
          tab = tabs[key] = { cell: cell, button: b, close: x, title: null, selected: null };
        }
        if (tab.title !== title) { tab.title = title; tab.button.textContent = title; if (tab.close) tab.close.setAttribute('aria-label', title + 'を閉じる'); }
        var selected = key === active;
        if (tab.selected !== selected) { tab.selected = selected; tab.button.setAttribute('aria-selected', selected ? 'true' : 'false'); tab.button.tabIndex = selected ? 0 : -1; }
        if (nav.children[i] !== tab.cell) nav.insertBefore(tab.cell, nav.children[i] || null);
      });
    }
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-key]'); if (!b) return;
      if (b.classList.contains('vault-work-close')) close(b.dataset.key); else select(b.dataset.key);
    });
    nav.addEventListener('keydown', function (e) {
      var b = e.target.closest('[role="tab"]');
      if (!b || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault(); var keys = ['list'].concat(Object.keys(entries)), i = keys.indexOf(b.dataset.key);
      select(keys[(i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length]); tabs[active].button.focus();
    });
    function select(key) {
      if (key !== 'list' && !entries[key]) key = 'list';
      if (active !== key && entries[active] && entries[active].hide) entries[active].hide();
      active = key; list.hidden = key !== 'list';
      Object.keys(entries).forEach(function (k) { entries[k].pane.hidden = k !== key; });
      if (entries[key] && entries[key].show) entries[key].show(entries[key].pane);
      draw();
    }
    function open(key, title, options) {
      if (!entries[key]) {
        var pane = document.createElement('section'); pane.id = 'vault-work-pane-' + (++serial); pane.className = 'vault-work-pane'; pane.setAttribute('role', 'tabpanel'); panes.appendChild(pane);
        entries[key] = Object.assign({ pane: pane, title: title }, options);
      }
      entries[key].title = title; select(key); return entries[key].pane;
    }
    function remove(key) {
      var entry = entries[key]; if (!entry) return;
      delete entries[key]; entry.pane.remove(); if (entry.close) entry.close();
    }
    function close(key) {
      if (!entries[key]) return;
      if (active === key) select('list'); remove(key); draw();
    }
    return {
      open: open, close: close, refresh: function () { select(active); },
      render: function (key) { if (active === key && entries[key] && entries[key].show) entries[key].show(entries[key].pane); },
      reset: function () { select('list'); Object.keys(entries).forEach(remove); draw(); },
      has: function (key) { return !!entries[key]; },
      current: function () { return active; }
    };
  };
})();
