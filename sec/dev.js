/* The developer's panels of security HOME: 自動点検, 石碑, セキュア通信の接続, 権限と認証.
   This file is fetched only when the server (GET /api/sec/me) has listed one of these panels for the person; and the routes behind them
   (server/core/sec.js: /api/sec/dev/*) answer no one but the developer, whatever this page does. It only draws what they send,
   through the same secure channel as the rest. Text goes in with textContent only. */
(function () {
  'use strict';
  var H = window.SecHome;
  if (!H) return;
  var el = H.el, api = H.api, card = H.card, tile = H.tile, empty = H.empty, fmt = H.fmt, stamp = H.stamp, ago = H.ago;

  function actions(card2, defs) {
    var box = el('div', 'acts');
    defs.forEach(function (d) { var b = el('button', 'btn' + (d.cls ? ' ' + d.cls : ''), d.text); b.type = 'button'; b.addEventListener('click', function () { d.run(b); }); box.appendChild(b); });
    card2.appendChild(box);
    return box;
  }
  function row(box, cls, parts) {
    var r = el('div', 'row ' + (cls || ''));
    parts.forEach(function (p) { r.appendChild(el('span', p[0], p[1])); });
    box.appendChild(r);
    return r;
  }

  /* ---- 自動点検 ---- */
  var A = {};
  H.register('dev-patrol', {
    reset: function () { A = {}; },
    build: function (root) {
      var grid = el('div', 'grid two');
      var a = card('', '自動点検', '設定・鍵・ログの鎖・権限を、定期的に自動で見回ります'); A.sum = el('div', 'tiles'); a.appendChild(A.sum); A.checks = el('div', 'posture-list'); a.appendChild(A.checks);
      actions(a, [{ text: 'いま点検する', cls: 'primary', run: function (b) { b.disabled = true; api('POST', '/api/sec/dev/patrol/run', {}).then(function (r) { draw(r); H.toast('点検しました'); }, H.fail).then(function () { b.disabled = false; }); } }]);
      var b = card('', '指摘', '見つかった異常（解消すると消えます）'); A.found = el('div', 'rows'); b.appendChild(A.found);
      grid.appendChild(a); grid.appendChild(b); root.appendChild(grid);
    },
    show: function () { load(); },
    tick: function () { load(); }
  });
  var load = H.single(function () {
    var s = H.session();
    return api('GET', '/api/sec/dev/patrol').then(function (r) { if (s === H.session() && A.sum) draw(r); });
  });
  function draw(r) {
    var p = r.patrol;
    A.sum.textContent = ''; A.checks.textContent = ''; A.found.textContent = '';
    if (!p) { A.sum.appendChild(empty('まだ点検していません')); return; }
    var high = p.findings.filter(function (f) { return f.level === 'high'; }).length;
    tile(A.sum, '最後の点検', ago(p.at), '', stamp(p.at));
    tile(A.sum, '所要', p.ms + 'ms', '', p.by ? p.by + 'が実行' : '自動');
    tile(A.sum, '重大な指摘', fmt(high), high ? 'hot' : '');
    tile(A.sum, 'その他の指摘', fmt(p.findings.length - high), p.findings.length - high ? 'warn' : '');
    (p.checks || []).forEach(function (c) {
      var r2 = el('div', 'check ' + (c.ok ? 'ok' : 'bad')); r2.appendChild(el('i', 'dot')); r2.appendChild(el('span', 'name', c.label)); r2.appendChild(el('small', '', c.ok ? '異常なし' : '指摘あり')); A.checks.appendChild(r2);
    });
    if (!p.findings.length) A.found.appendChild(empty('指摘はありません'));
    p.findings.forEach(function (f) { row(A.found, 'lv-' + f.level, [['tag ' + (f.level === 'high' ? 'danger' : 'manual'), f.level === 'high' ? '重大' : '注意'], ['why', f.text], ['score', ago(f.since)]]); });
  }

  /* ---- 石碑 ---- */
  var S = {};
  H.register('dev-stele', {
    reset: function () { S = {}; },
    build: function (root) {
      var grid = el('div', 'grid two');
      var a = card('', '石碑', '運営ログのデータベースの外の控え（書き換えられない）'); S.tiles = el('div', 'tiles'); a.appendChild(S.tiles); S.note = el('p', 'muted fine'); a.appendChild(S.note);
      actions(a, [{ text: 'いま刻んで、すべて見直す', cls: 'primary', run: function (b) { b.disabled = true; api('POST', '/api/sec/dev/stele/run', {}).then(function (r) { drawSteleState(r.stele); H.toast(r.ran.ok ? '見直しました（異常なし）' : '見直しました（異常があります）'); }, H.fail).then(function () { b.disabled = false; }); } }]);
      var b = card('', '見直しで見つかったもの'); S.problems = el('div', 'rows'); b.appendChild(S.problems);
      grid.appendChild(a); grid.appendChild(b); root.appendChild(grid);
    },
    show: function () { loadStele(); },
    tick: function () { loadStele(); }
  });
  var loadStele = H.single(function () {
    var s = H.session();
    return api('GET', '/api/sec/dev/stele').then(function (r) { if (s === H.session() && S.tiles) drawSteleState(r.stele); });
  });
  function drawSteleState(st) {
    S.tiles.textContent = ''; S.problems.textContent = '';
    tile(S.tiles, '保管先', st.on ? 'あり' : 'なし', st.on ? '' : 'hot');
    tile(S.tiles, '刻んだ記録', fmt(st.sealed) + '件', '', fmt(st.segs) + 'まとまり');
    tile(S.tiles, '刻む順番待ち', fmt(st.pending) + '件', st.pending > 200 ? 'warn' : '');
    tile(S.tiles, '最後に刻んだ', st.at ? ago(st.at) : '-', '', st.at ? stamp(st.at) : '');
    var c = st.capacity || {};
    tile(S.tiles, 'データベースの使用', Math.round((c.ratio || 0) * 100) + '%', c.ratio >= 0.9 ? 'hot' : c.ratio >= 0.7 ? 'warn' : '', fmt(c.rows) + '件・約' + Math.round((c.logBytes || 0) / 1048576) + 'MB');
    tile(S.tiles, '全体の見直し', st.deepDone ? ago(st.deepDone) : '-');
    S.note.textContent = st.failSince ? '刻めていません（' + (st.failText || '原因不明') + '）' : st.diverged ? '#' + st.diverged.id + ' が石碑と違います' : '外の控えと、運営ログは一致しています。';
    var probs = (st.check && st.check.problems) || [];
    if (!probs.length) S.problems.appendChild(empty('問題は見つかっていません'));
    probs.slice(0, 20).forEach(function (p) { row(S.problems, 'lv-high', [['tag danger', '指摘'], ['why', p.text]]); });
  }

  /* ---- セキュア通信の接続 ---- */
  var N = {};
  H.register('dev-channels', {
    reset: function () { N = {}; },
    build: function (root) {
      var grid = el('div', 'grid two');
      var a = card('', 'サーバーの身元', 'ページが最初に記録し、毎回これと突き合わせます'); N.id = el('div', 'identity'); a.appendChild(N.id); grid.appendChild(a);
      var b = card('wide', '開いている接続', 'このサーバーの記憶の中にだけあります（鍵は表示しません）'); N.list = el('div', 'rows chans'); b.appendChild(N.list); grid.appendChild(b);
      root.appendChild(grid);
    },
    show: function () { loadChannels(); },
    tick: function () { loadChannels(); }
  });
  var loadChannels = H.single(function () {
    var s = H.session();
    return api('GET', '/api/sec/dev/channels').then(function (r) { if (s === H.session() && N.list) drawChannels(r); });
  });
  var ROLE = { developer: '開発者', operator: '運営者', viewer: '閲覧者' };
  function drawChannels(r) {
    N.id.textContent = '';
    N.id.appendChild(el('span', 'muted', '指紋'));
    N.id.appendChild(el('code', 'fp', r.identity.fp));
    N.id.appendChild(el('small', 'muted', '作成：' + stamp(r.identity.since)));
    N.list.textContent = '';
    if (!r.channels.length) N.list.appendChild(empty('開いている接続はありません'));
    r.channels.forEach(function (c) {
      var x = el('div', 'row chan-row');
      x.appendChild(el('span', 'target', c.user.name));
      x.appendChild(el('span', 'tag manual', ROLE[c.user.role] || c.user.role));
      x.appendChild(el('span', 'why', c.ip + '・' + (c.tls || '暗号化なし') + (c.http ? '・' + c.http : '') + '・' + fmt(c.requests) + '件・' + ago(c.last) + '・あと' + Math.max(1, Math.round(c.left / 60000)) + '分'));
      var b = el('button', 'btn small danger', '終了させる'); b.type = 'button';
      b.addEventListener('click', function () {
        H.dialog({ title: c.user.name + 'の接続を終了させますか？', text: '相手のページは、自動でつなぎ直します。乗っ取りを疑うときは、先にその人のログインを終わらせてください。', ok: '終了させる', danger: true }).then(function (ok) {
          if (ok === null) return;
          api('POST', '/api/sec/dev/channels/close', { id: c.id }).then(function (res) { drawChannels({ channels: res.channels, identity: r.identity }); H.toast('終了させました'); }, H.fail);
        });
      });
      x.appendChild(b);
      N.list.appendChild(x);
    });
  }

  /* ---- 権限と認証 ---- */
  var X = {};
  H.register('dev-access', {
    reset: function () { X = {}; },
    build: function (root) {
      var grid = el('div', 'grid two');
      var a = card('', '運営者', '運営権を持つ人'); X.ops = el('div', 'rows'); a.appendChild(X.ops);
      var b = card('', '閲覧者', '見るだけの人'); X.viewers = el('div', 'rows'); b.appendChild(X.viewers);
      var c = card('wide', 'サインインの守り'); X.facts = el('div', 'posture-list'); c.appendChild(X.facts);
      grid.appendChild(a); grid.appendChild(b); grid.appendChild(c); root.appendChild(grid);
    },
    show: function () { loadAccess(); },
    tick: function () { loadAccess(); }
  });
  var MFA = { 0: '追加認証なし', 1: '追加認証：1段階', 2: '追加認証：2段階', 3: '追加認証：3段階' };
  var loadAccess = H.single(function () {
    var s = H.session();
    return api('GET', '/api/sec/dev/access').then(function (r) {
      if (s !== H.session() || !X.ops) return;
      X.ops.textContent = ''; X.viewers.textContent = ''; X.facts.textContent = '';
      r.operators.forEach(function (o) {
        row(X.ops, '', [['dot ' + (o.site ? 'site' : ''), ''], ['target', o.name], ['tag manual', o.developer ? '開発者' : o.operator ? '運営者' : '権限なし'], ['why', (MFA[o.mfaMode] || '') + (o.reused ? '・名前が別のアカウントに使われています' : '') + '・' + (o.site ? '運営サイト' : ago(o.seenAt))]]);
      });
      if (!r.viewers.length) X.viewers.appendChild(empty('閲覧者はいません'));
      r.viewers.forEach(function (v) { row(X.viewers, '', [['dot ' + (v.site ? 'site' : ''), ''], ['target', v.name], ['why', v.by + 'が' + stamp(v.at) + 'に付与']]); });
      [['毎回のパスキー認証', r.facts.passkey, r.facts.passkey ? '有効' : '無効'], ['開発者コード', r.facts.devCode, r.facts.devCode ? '登録済み' : '未登録'], ['開発者の追加認証', r.facts.devMfa, r.facts.devMfa ? '必須' : '任意']].forEach(function (f) {
        var c = el('div', 'check ' + (f[1] ? 'ok' : 'bad')); c.appendChild(el('i', 'dot')); c.appendChild(el('span', 'name', f[0])); c.appendChild(el('small', '', f[2])); X.facts.appendChild(c);
      });
    });
  });
})();
