/* The page for whoever is given a link to the vault: look at what is shared, take it, write a short comment.
   Nothing else is possible (the server lets a link do only that). The link's secret is the part after the # of
   this page's address: a browser does not send that part to anyone, and this page sends it only as a header
   (Authorization) to this server, never in an address. Text is only ever put in with textContent. */
(function () {
  'use strict';
  var TOKEN = (location.hash || '').replace(/^#/, ''), COMMENT_MAX = 150;
  var $ = function (id) { return document.getElementById(id); };
  var status = $('status'), box = $('files');

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function say(text, bad) { status.hidden = !text; status.textContent = text || ''; status.className = 'status' + (bad ? ' bad' : ''); }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + 'MB'; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function when(ts) { var d = new Date(ts); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function left(ms) { var m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : m + '分'; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function sha(bytes) { return crypto.subtle.digest('SHA-256', bytes); }

  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.ok) return j;
        var e = j.error || {};
        throw { status: res.status, code: e.code || '', message: e.message || 'できませんでした（' + res.status + '）' };
      });
    });
  }

  // a whole file, piece by piece, each piece and the whole checked by its SHA-256
  function download(f, bar, button) {
    var parts = [], digests = [];
    button.disabled = true;
    function next(n) {
      if (n >= f.chunks) return Promise.resolve();
      return api('/api/vault/pull?f=' + encodeURIComponent(f.id) + '&n=' + n).then(function (r) {
        var bin = atob(r.data), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return sha(bytes).then(function (h) {
          if (hex(h) !== r.sha256) throw { message: '部分 ' + (n + 1) + ' が壊れています（ハッシュが一致しません）。もう一度お試しください' };
          parts[n] = bytes; digests[n] = new Uint8Array(h);
          bar.firstChild.style.width = Math.round((n + 1) / f.chunks * 100) + '%';
        });
      }).then(function () { return next(n + 1); });
    }
    return next(0).then(function () {
      var all = new Uint8Array(32 * f.chunks);
      digests.forEach(function (d, i) { all.set(d, i * 32); });
      return sha(all);
    }).then(function (h) {
      if (f.sha256 && hex(h) !== f.sha256) throw { message: 'ファイル全体のハッシュが一致しません。もう一度お試しください' };
      var url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' })), a = document.createElement('a');
      a.href = url; a.download = f.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      button.textContent = 'ダウンロードしました（ハッシュ一致を確認済み）';
    }).catch(function (err) {
      button.disabled = false; bar.firstChild.style.width = '0';
      button.textContent = 'ダウンロード（やり直し）';
      say((err && err.message) || 'ダウンロードできませんでした', true);
    });
  }

  function notes(list, ul) {
    ul.replaceChildren();
    (list || []).forEach(function (n) {
      var li = el('li', '', n.text);
      li.appendChild(el('small', '', (n.by === 'developer' ? '開発者' : n.by === 'AI' ? 'AI' : 'リンクから') + '・' + when(n.at)));
      ul.appendChild(li);
    });
  }

  function card(f, caps) {
    var c = el('article', 'card');
    c.appendChild(el('h2', '', f.name));
    c.appendChild(el('p', 'meta', mb(f.size) + (f.type ? '・' + f.type : '')));
    if (f.preview) {
      var img = el('img', 'pic'); img.alt = ''; img.hidden = true; c.appendChild(img);
      api('/api/vault/pull?f=' + encodeURIComponent(f.id) + '&preview=1').then(function (r) { if (r.preview) { img.src = r.preview; img.hidden = false; } }).catch(function () {});
    }
    var acts = el('div', 'acts'), bar = el('div', 'bar'), get = el('button', '', 'ダウンロード（' + mb(f.size) + '）');
    bar.appendChild(el('i'));
    get.type = 'button';
    get.addEventListener('click', function () { say(''); download(f, bar, get); });
    acts.appendChild(get); c.appendChild(acts); c.appendChild(bar);
    var ul = el('ul', 'note-list');
    notes(f.notes, ul);
    c.appendChild(ul);
    if (caps.indexOf('note') >= 0) {
      var ta = el('textarea'), count = el('div', 'count', '0 / ' + COMMENT_MAX), send = el('button', 'ghost', 'コメントを書く');
      ta.maxLength = COMMENT_MAX; ta.placeholder = 'コメント（' + COMMENT_MAX + '文字まで）'; ta.setAttribute('aria-label', 'コメント');
      send.type = 'button';
      ta.addEventListener('input', function () { count.textContent = Array.from(ta.value).length + ' / ' + COMMENT_MAX; });
      send.addEventListener('click', function () {
        var text = ta.value.trim();
        if (!text) return;
        send.disabled = true;
        api('/api/vault/ai', { f: f.id, comment: text }).then(function (r) {
          ta.value = ''; count.textContent = '0 / ' + COMMENT_MAX;
          notes(r.notes, ul); say('コメントを書きました');
        }).catch(function (err) { say((err && err.message) || '書けませんでした', true); }).then(function () { send.disabled = false; });
      });
      c.appendChild(ta); c.appendChild(count); c.appendChild(send);
    }
    return c;
  }

  function show(r) {
    var caps = r.caps || [];
    $('until').textContent = '有効期限 ' + when(r.until) + ' まで（あと ' + left(r.until - Date.now()) + '）・見る・ダウンロード' + (caps.indexOf('note') >= 0 ? '・コメント' : '') + 'だけできます';
    box.replaceChildren();
    var files = r.vault ? r.files || [] : [r];
    if (!files.length) { say('いま共有されているファイルはありません'); return; }
    say('');
    files.forEach(function (f) { box.appendChild(card(f, caps)); });
  }

  if (!/^[\w-]{43}$/.test(TOKEN)) { say('このアドレスにはリンクの鍵がありません。共有された URL をそのまま開いてください。', true); return; }
  api('/api/vault/pull').then(show).catch(function (err) { say(err && err.status === 404 ? 'このリンクは無効か、有効期限が切れています。' : (err && err.message) || '読み込めませんでした', true); });
})();
