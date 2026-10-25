/* The calendar app of the operator site (opened from the date in the bar). A month at a time, in Japan's time: the days of the week,
   today, the national holidays (worked out here from the law's rules, with the substitute days and the days between two holidays,
   and the three moved days of 2020 and 2021), the Japanese era, and a note of your own for a day. A note stays in this browser
   only (it is never sent anywhere). Text is only ever put in with textContent. */
var OpsCalendar = (function () {
  'use strict';
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var shown = null, picked = null, root = null;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function key(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  // today in Japan, whatever this computer's own zone is
  function today() {
    var t = new Date(Date.now() + 9 * 3600000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function dow(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  // the nth Monday of a month
  function monday(y, m, n) { var first = dow(y, m, 1); return 1 + ((8 - first) % 7) + (n - 1) * 7; }
  function equinox(y, spring) {
    var base = spring ? 20.8431 : 23.2488;
    return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  var cache = {};
  function holidays(y) {
    if (cache[y]) return cache[y];
    var h = {}, set = function (m, d, name) { h[key(y, m, d)] = name; };
    if (y >= 1949) set(1, 1, '元日');
    if (y >= 2000) set(1, monday(y, 1, 2), '成人の日'); else if (y >= 1949) set(1, 15, '成人の日');
    if (y >= 1967) set(2, 11, '建国記念の日');
    if (y >= 2020) set(2, 23, '天皇誕生日');
    if (y >= 1949 && y <= 2099) set(3, equinox(y, true), '春分の日');
    if (y >= 2007) set(4, 29, '昭和の日'); else if (y >= 1989) set(4, 29, 'みどりの日'); else if (y >= 1949) set(4, 29, '天皇誕生日');
    if (y >= 1949) set(5, 3, '憲法記念日');
    if (y >= 2007) set(5, 4, 'みどりの日');
    if (y >= 1949) set(5, 5, 'こどもの日');
    // 2020 and 2021: the days moved for the Olympic games
    if (y === 2020) { set(7, 23, '海の日'); set(7, 24, 'スポーツの日'); set(8, 10, '山の日'); }
    else if (y === 2021) { set(7, 22, '海の日'); set(7, 23, 'スポーツの日'); set(8, 8, '山の日'); }
    else {
      if (y >= 2003) set(7, monday(y, 7, 3), '海の日'); else if (y >= 1996) set(7, 20, '海の日');
      if (y >= 2016) set(8, 11, '山の日');
      if (y >= 2020) set(10, monday(y, 10, 2), 'スポーツの日'); else if (y >= 2000) set(10, monday(y, 10, 2), '体育の日'); else if (y >= 1966) set(10, 10, '体育の日');
    }
    if (y >= 2003) set(9, monday(y, 9, 3), '敬老の日'); else if (y >= 1966) set(9, 15, '敬老の日');
    if (y >= 1948 && y <= 2099) set(9, equinox(y, false), '秋分の日');
    if (y >= 1948) set(11, 3, '文化の日');
    if (y >= 1948) set(11, 23, '勤労感謝の日');
    // a day between two holidays is a holiday (not a Sunday)
    for (var m = 1; m <= 12; m++) {
      for (var d = 2; d < dim(y, m); d++) {
        if (h[key(y, m, d)] || dow(y, m, d) === 0) continue;
        if (h[key(y, m, d - 1)] && h[key(y, m, d + 1)]) h[key(y, m, d)] = '国民の休日';
      }
    }
    // a holiday on a Sunday: the next day that is not a holiday is one too (from 2007)
    if (y >= 2007) {
      Object.keys(h).sort().forEach(function (k) {
        var p = k.split('-').map(Number);
        if (dow(p[0], p[1], p[2]) !== 0 || h[k] === '振替休日') return;
        var m2 = p[1], d2 = p[2] + 1;
        while (h[key(y, m2, d2)]) d2++;
        if (d2 <= dim(y, m2)) h[key(y, m2, d2)] = '振替休日';
      });
    }
    cache[y] = h;
    return h;
  }
  function era(y, m, d) {
    var n = y * 10000 + m * 100 + d;
    if (n >= 20190501) return '令和' + (y - 2018 === 1 ? '元' : y - 2018) + '年';
    if (n >= 19890108) return '平成' + (y - 1988 === 1 ? '元' : y - 1988) + '年';
    return '昭和' + (y - 1925) + '年';
  }
  function noteKey(k) { return 'two-state-ops/calendar/' + k; }
  function getNote(k) { try { return localStorage.getItem(noteKey(k)) || ''; } catch (e) { return ''; } }
  function setNote(k, t) { try { if (t) localStorage.setItem(noteKey(k), t); else localStorage.removeItem(noteKey(k)); } catch (e) { /* notes are a convenience */ } }

  function draw() {
    var t = today(), y = shown.y, m = shown.m, hol = holidays(y);
    root.replaceChildren();
    var bar = el('div', 'bar cal-bar');
    var prev = el('button', 'btn small cal-nav', '‹'), next = el('button', 'btn small cal-nav', '›'), now = el('button', 'btn small', '今日');
    prev.type = next.type = now.type = 'button';
    prev.setAttribute('aria-label', '前の月'); next.setAttribute('aria-label', '次の月');
    prev.addEventListener('click', function () { shown = m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 }; draw(); });
    next.addEventListener('click', function () { shown = m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 }; draw(); });
    now.addEventListener('click', function () { shown = { y: t.y, m: t.m }; picked = key(t.y, t.m, t.d); draw(); });
    var title = el('h2', 'cal-title'), yearSel = el('select'), monthSel = el('select');
    yearSel.setAttribute('aria-label', '年'); monthSel.setAttribute('aria-label', '月');
    for (var yy = 1990; yy <= 2099; yy++) { var oy = el('option', '', yy + '年'); oy.value = yy; yearSel.appendChild(oy); }
    for (var mm = 1; mm <= 12; mm++) { var om = el('option', '', mm + '月'); om.value = mm; monthSel.appendChild(om); }
    yearSel.value = y; monthSel.value = m;
    yearSel.addEventListener('change', function () { shown = { y: Number(yearSel.value), m: m }; draw(); });
    monthSel.addEventListener('change', function () { shown = { y: y, m: Number(monthSel.value) }; draw(); });
    title.appendChild(yearSel); title.appendChild(monthSel);
    bar.appendChild(prev); bar.appendChild(title); bar.appendChild(next); bar.appendChild(now);
    root.appendChild(bar);

    var grid = el('div', 'cal-grid'); grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', y + '年' + m + '月');
    WEEK.forEach(function (w, i) { var c = el('div', 'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), w); c.setAttribute('role', 'columnheader'); grid.appendChild(c); });
    var first = dow(y, m, 1), days = dim(y, m), prevDays = dim(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
    for (var i = 0; i < 42; i++) {
      var dn = i - first + 1, yy2 = y, mm2 = m, out = false;
      if (dn < 1) { dn = prevDays + dn; mm2 = m === 1 ? 12 : m - 1; yy2 = m === 1 ? y - 1 : y; out = true; }
      else if (dn > days) { dn = dn - days; mm2 = m === 12 ? 1 : m + 1; yy2 = m === 12 ? y + 1 : y; out = true; }
      var k = key(yy2, mm2, dn), w = dow(yy2, mm2, dn), name = holidays(yy2)[k];
      var cell = el('button', 'cal-day' + (out ? ' out' : '') + (w === 0 || name ? ' sun' : w === 6 ? ' sat' : '') + (k === key(t.y, t.m, t.d) ? ' today' : '') + (k === picked ? ' picked' : '') + (getNote(k) ? ' noted' : ''));
      cell.type = 'button'; cell.setAttribute('role', 'gridcell'); cell.dataset.day = k;
      cell.setAttribute('aria-label', yy2 + '年' + mm2 + '月' + dn + '日' + WEEK[w] + '曜日' + (name ? '・' + name : '') + (getNote(k) ? '・メモあり' : ''));
      cell.appendChild(el('b', '', String(dn)));
      if (name) cell.appendChild(el('span', 'cal-holiday', name));
      cell.addEventListener('click', function (e) { picked = e.currentTarget.dataset.day; draw(); });
      grid.appendChild(cell);
    }
    root.appendChild(grid);

    var side = el('div', 'card cal-side');
    var p = (picked || key(t.y, t.m, t.d)).split('-').map(Number), pk = key(p[0], p[1], p[2]), pn = holidays(p[0])[pk];
    side.appendChild(el('h3', '', p[0] + '年' + p[1] + '月' + p[2] + '日（' + WEEK[dow(p[0], p[1], p[2])] + '）'));
    side.appendChild(el('p', 'muted', era(p[0], p[1], p[2]) + (pn ? '・' + pn : '')));
    var diff = Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(t.y, t.m - 1, t.d)) / 86400000);
    side.appendChild(el('p', 'muted', diff === 0 ? '今日です' : diff > 0 ? '今日から ' + diff + ' 日後' : '今日から ' + (-diff) + ' 日前'));
    var note = el('textarea'); note.rows = 3; note.maxLength = 300; note.placeholder = 'この日のメモ（この端末だけに残ります）'; note.setAttribute('aria-label', 'この日のメモ');
    note.value = getNote(pk);
    note.addEventListener('change', function () { setNote(pk, note.value.trim()); draw(); });
    side.appendChild(note);
    root.appendChild(side);
  }
  return {
    holidays: holidays, era: era,
    show: function (view) {
      root = view;
      var t = today();
      if (!shown) { shown = { y: t.y, m: t.m }; picked = key(t.y, t.m, t.d); }
      draw();
    }
  };
})();
