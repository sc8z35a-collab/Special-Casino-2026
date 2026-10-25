/* Uses the operator site's existing authenticated transport and navigation. */
(function () {
  'use strict';
  window.OpsDiaryProfile = function (ctx) {
    var request = ctx.request, el = ctx.el, state = ctx.state, $ = function (s) { return document.querySelector(s); };
    var epoch = 0, rows = [], more = false, busy = false, imageData = '', selected = 0, commentBefore = 0, mode = 0;
    function button(label, run, danger) { var b = el('button', 'btn small' + (danger ? ' danger' : ''), label); b.type = 'button'; b.addEventListener('click', run); return b; }
    function status(text) { $('#diary-error').textContent = text || ''; }
    // the ! on the profile tab: no extra login set up (for staff), or a password too easy
    var weak = '';
    function badge() { $('#count-profile').hidden = !(weak || (!mode && !state.viewer)); $('#count-profile').textContent = '!'; }
    function markMfa(value) {
      mode = value || 0;
      document.body.classList.toggle('mfa-unset', !mode && !state.viewer);
      badge();
      $('#profile-auth-status').textContent = mode ? mode + '段階認証を設定済み' : '！ 追加認証が未設定です';
      $('#profile-auth-status').classList.toggle('auth-warning', !mode);
    }
    // a password too easy for staff (the login says so): the profile says why, and where to change it
    var WEAK = { short: '12文字より短い', digits: '数字だけ', repeat: '同じ文字が多い' };
    function markPassword(value) {
      weak = value || '';
      $('#profile-password-status').textContent = weak ? '！ パスワードが弱いです（' + (WEAK[weak] || '簡単すぎる') + '）。ゲームの設定から、12文字以上で数字だけではないものに変えてください' : '';
      $('#profile-password-status').classList.toggle('auth-warning', !!weak);
      badge();
    }
    function reset() {
      epoch++; rows = []; busy = false; imageData = ''; selected = 0; commentBefore = 0;
      $('#ops-diary-list').replaceChildren(); $('#ops-diary-comments').replaceChildren();
      $('#ops-diary-form').reset(); $('#diary-preview').removeAttribute('src'); $('#diary-preview').hidden = true;
      $('#profile-mfa-form').reset(); $('#profile-setup').hidden = true; $('#profile-secret').textContent = ''; $('#profile-recovery').textContent = ''; $('#profile-uri').removeAttribute('href');
      $('#profile-name').textContent = ''; $('#profile-avatar').replaceChildren();
      document.body.classList.remove('mfa-unset'); $('#count-profile').hidden = true; weak = ''; $('#profile-password-status').textContent = '';
    }
    function loadDiary(older) {
      if (!state.developer || busy) return; busy = true; var gen = epoch;
      var last = older && rows.length ? rows[rows.length - 1].id : 0;
      request('GET', '/api/ops/diary' + (last ? '?before=' + last : '')).then(function (r) {
        if (gen !== epoch) return; busy = false; rows = older ? rows.concat(r.posts) : r.posts; more = r.more; renderDiary();
      }, function (e) { if (gen !== epoch) return; busy = false; status(e.message); });
    }
    function renderDiary() {
      var list = $('#ops-diary-list'); list.replaceChildren();
      rows.forEach(function (p) {
        var card = el('article', 'ops-diary-post'); card.appendChild(el('h3', '', p.title));
        card.appendChild(el('small', 'muted', new Date(p.at).toLocaleString('ja-JP') + (p.hidden ? ' · 一時非表示' : ' · 公開中')));
        card.appendChild(el('p', 'diary-text', p.text));
        if (p.hasImage) {
          var preview = el('div'); var showImage = button('添付画像を表示', function () {
            showImage.disabled = true; var gen = epoch;
            request('GET', '/api/ops/diary/image?post=' + p.id).then(function (r) { if (gen !== epoch || !preview.isConnected) return; var img = el('img', 'ops-diary-image'); img.src = r.image; img.alt = p.title; preview.replaceChildren(img); }, ctx.fail);
          }); preview.appendChild(showImage); card.appendChild(preview);
        }
        card.appendChild(el('p', 'muted', 'いいね ' + p.likes + ' · ブックマーク ' + p.bookmarks + ' · コメント ' + p.comments + (p.reward ? ' · 報酬 $' + p.reward.toLocaleString('ja-JP') + '（受取 ' + p.claims + '人・期限 ' + new Date(p.expiresAt).toLocaleString('ja-JP') + '）' : '')));
        var actions = el('div', 'diary-admin-actions');
        actions.appendChild(button('コメントを読む', function () { selected = p.id; commentBefore = 0; $('#diary-comments-title').textContent = p.title + 'のコメント'; loadComments(false); }));
        actions.appendChild(button(p.hidden ? '再公開' : '一時非表示', function () { request('POST', '/api/ops/diary/visibility', { post: p.id, hidden: !p.hidden }).then(function () { loadDiary(false); }, ctx.fail); }));
        actions.appendChild(button('完全削除', function () {
          if (!window.confirm('「' + p.title + '」を画像・コメント・ブックマークとともに完全削除します。元に戻せません。受取済みのお金は回収されません。')) return;
          request('POST', '/api/ops/diary/delete', { post: p.id, confirm: true }).then(function () { if (selected === p.id) { selected = 0; $('#ops-diary-comments').replaceChildren(); } loadDiary(false); }, ctx.fail);
        }, true)); card.appendChild(actions); list.appendChild(card);
      });
      if (!rows.length) list.appendChild(el('p', 'muted', 'まだ投稿はありません'));
      $('#ops-diary-more').hidden = !more;
    }
    function loadComments(older) {
      if (!selected || !state.developer) return;
      var gen = epoch, id = selected;
      request('GET', '/api/ops/diary/comments?post=' + id + (older && commentBefore ? '&before=' + commentBefore : '')).then(function (r) {
        if (gen !== epoch || id !== selected) return;
        var box = $('#ops-diary-comments'); if (!older) box.replaceChildren();
        r.comments.forEach(function (c) {
          var row = el('article', 'ops-diary-comment'), who = button(c.from.name, function () { ctx.setView('players'); ctx.openDetail(c.from.id); });
          who.prepend(ctx.face(c.from)); who.setAttribute('aria-label', c.from.name + 'のプレイヤー詳細を開く'); row.appendChild(who);
          row.appendChild(el('small', 'muted', new Date(c.at).toLocaleString('ja-JP'))); row.appendChild(el('p', 'diary-text', c.text));
          if (c.words.length) { var raw = el('details'); raw.appendChild(el('summary', 'auth-warning', 'フィルタリング: ' + c.words.join('・'))); raw.appendChild(el('p', 'diary-text', c.original)); row.appendChild(raw); }
          box.appendChild(row);
        });
        if (!older && !r.comments.length) box.appendChild(el('p', 'muted', 'コメントはありません'));
        if (r.comments.length) commentBefore = r.comments[r.comments.length - 1].id;
        $('#diary-comments-more').hidden = !r.more;
      }, ctx.fail);
    }
    function profile() {
      if (state.viewer) return; var gen = epoch;
      request('GET', '/api/ops/profile').then(function (p) { if (gen !== epoch) return; $('#profile-name').textContent = p.name; $('#profile-avatar').replaceChildren(ctx.face(p)); markMfa(p.mfa.mode); }, ctx.fail);
    }
    function credentials() { return { password: $('#profile-password').value, otp: $('#profile-otp').value.trim(), phrase: $('#profile-phrase').value, recovery: $('#profile-backup').value.trim() }; }
    function clearCredentials() { ['#profile-password','#profile-otp','#profile-phrase','#profile-backup','#profile-new-phrase','#profile-setup-otp'].forEach(function (id) { $(id).value = ''; }); }
    function authAction(path, body, then) {
      var gen = epoch; $('#profile-auth-error').textContent = '';
      var controls = Array.from($('#profile-mfa-form').querySelectorAll('button')); controls.forEach(function (b) { b.disabled = true; });
      request('POST', path, body).then(function (r) { if (gen === epoch) then(r); }, function (e) { if (gen === epoch) $('#profile-auth-error').textContent = e.message; }).then(function () { controls.forEach(function (b) { b.disabled = false; }); });
    }
    $('#diary-reward').appendChild(el('option', '', '添付しない')); $('#diary-reward').firstChild.value = '0';
    for (var amount = 10000; amount <= 250000; amount += 10000) { var op = el('option', '', amount / 1000 + 'k ドル'); op.value = amount; $('#diary-reward').appendChild(op); }
    $('#diary-file').addEventListener('change', function () {
      var file = this.files[0]; imageData = ''; $('#diary-preview').hidden = true;
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { status('15MB以下のPNG・JPEG・WebPを選んでください'); this.value = ''; return; }
      var url = URL.createObjectURL(file), img = new Image(), gen = epoch;
      img.onload = function () {
        URL.revokeObjectURL(url); if (gen !== epoch) return;
        var scale = Math.min(1, 1280 / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale)); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        var quality = .85, data; do { data = canvas.toDataURL('image/webp', quality); quality -= .15; } while (data.length > 690000 && quality > .2);
        if (data.length > 690000) { status('画像が大きすぎます。小さい画像を選んでください'); return; }
        imageData = data; $('#diary-preview').src = data; $('#diary-preview').hidden = false; status('');
      }; img.onerror = function () { URL.revokeObjectURL(url); status('画像を読み込めません'); }; img.src = url;
    });
    $('#ops-diary-form').addEventListener('submit', function (e) {
      e.preventDefault(); var gen = epoch, submit = $('#diary-publish'); submit.disabled = true; status('');
      request('POST', '/api/ops/diary', { title: $('#diary-title').value, text: $('#diary-text').value, image: imageData, reward: Number($('#diary-reward').value) }).then(function () {
        if (gen !== epoch) return; $('#ops-diary-form').reset(); imageData = ''; $('#diary-preview').hidden = true; $('#diary-preview').removeAttribute('src'); status('投稿を公開しました'); loadDiary(false);
      }, function (e) { if (gen === epoch) status(e.message); }).then(function () { submit.disabled = false; });
    });
    $('#ops-diary-refresh').addEventListener('click', function () { loadDiary(false); loadComments(false); });
    $('#ops-diary-more').addEventListener('click', function () { loadDiary(true); });
    $('#diary-comments-more').addEventListener('click', function () { loadComments(true); });
    $('#profile-mfa-form').addEventListener('submit', function (e) {
      e.preventDefault(); var b = credentials(); b.mode = Number($('#profile-mode').value); b.otp = $('#profile-setup-otp').value.trim(); b.newPhrase = $('#profile-new-phrase').value;
      authAction('/api/ops/profile/mfa/enable', b, function (r) { markMfa(r.mfa.mode); $('#profile-setup').hidden = true; $('#profile-secret').textContent = ''; $('#profile-uri').removeAttribute('href'); $('#profile-recovery').textContent = '復旧コード（一度だけ表示・安全な場所に保存）\n' + r.recovery.join('\n'); clearCredentials(); ctx.toast('追加認証を設定しました。他の端末は再ログインが必要です'); });
    });
    $('#profile-begin').addEventListener('click', function () {
      authAction('/api/ops/profile/mfa/begin', credentials(), function (r) { $('#profile-recovery').textContent = ''; $('#profile-secret').textContent = r.secret; $('#profile-uri').href = r.uri; $('#profile-setup').hidden = false; $('#profile-setup-otp').value = ''; $('#profile-auth-error').textContent = '認証アプリに鍵を登録して、アプリの新しい6桁コードを入力してください。登録は10分以内です'; });
    });
    $('#profile-disable').addEventListener('click', function () {
      if (!mode || !window.confirm('追加認証を解除しますか？')) return;
      authAction('/api/ops/profile/mfa/disable', credentials(), function (r) { markMfa(r.mfa.mode); clearCredentials(); $('#profile-setup').hidden = true; $('#profile-secret').textContent = ''; $('#profile-recovery').textContent = ''; $('#profile-uri').removeAttribute('href'); ctx.toast('追加認証を解除しました'); });
    });
    $('#profile-mode').addEventListener('change', function () { $('#profile-new-phrase-field').hidden = this.value !== '3'; });
    return { reset: reset, start: function (me) { markMfa(me.mfa ? me.mfa.mode : 0); markPassword(me.weakPassword); }, view: function (v) { if (v === 'diary') loadDiary(false); if (v === 'profile') profile(); }, refresh: function () { if (state.view === 'diary') { loadDiary(false); loadComments(false); } } };
  };
})();
