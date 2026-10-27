(function (BR) {
  'use strict';
  var K = BR.kit, api = BR.api, el = K.el, root, saved = false, busy = false, reload = false, generation = 0;
  var posts = [], more = false, drafts = {}, opened = {}, images = {};
  function active() { return root && !root.hidden && api.hasToken(); }
  function button(text, run) { var b = el('button', 'mini-btn', text); b.type = 'button'; b.addEventListener('click', run); return b; }
  function error(e) { K.fail(e); }
  function myComments(id, box, before) {
    var gen = generation;
    api.diaryComments(id, before).then(function (r) {
      if (gen !== generation || !box.isConnected) return;
      if (!before) box.replaceChildren();
      r.comments.forEach(function (c) { var row = el('p', 'diary-own-comment'); row.appendChild(el('small', '', new Date(c.at).toLocaleString('ja-JP'))); row.appendChild(el('span', '', c.text)); box.appendChild(row); });
      if (r.more) { var older = button('以前の自分のコメント', function () { older.remove(); myComments(id, box, r.comments[r.comments.length - 1].id); }); box.appendChild(older); }
    }, error);
  }
  function render() {
    var list = document.getElementById('diary-list'); list.replaceChildren();
    posts.forEach(function (p) {
      var card = el('details', 'diary-entry'); card.open = !!opened[p.id];
      var head = el('summary'); head.appendChild(el('b', '', p.title)); head.appendChild(el('small', '', new Date(p.at).toLocaleString('ja-JP'))); card.appendChild(head);
      card.appendChild(el('p', 'diary-body', p.text));
      var image = el('img', 'diary-image'); image.alt = p.title; image.loading = 'lazy';
      if (p.hasImage) { card.appendChild(image); if (images[p.id]) image.src = images[p.id]; }
      var actions = el('div', 'diary-actions');
      var like = button((p.liked ? '♥ ' : '♡ ') + 'いいね ' + p.likes, function () {
        like.disabled = true; api.diaryReact(p.id, 'liked', !p.liked).then(function () { p.likes += p.liked ? -1 : 1; p.liked = !p.liked; like.textContent = (p.liked ? '♥ ' : '♡ ') + 'いいね ' + p.likes; like.setAttribute('aria-pressed', p.liked); }, error).then(function () { like.disabled = false; });
      }); like.setAttribute('aria-pressed', p.liked); actions.appendChild(like);
      var bookmark = button(p.bookmarked ? 'ブックマーク済み' : 'ブックマーク', function () {
        bookmark.disabled = true; api.diaryReact(p.id, 'bookmarked', !p.bookmarked).then(function () { p.bookmarked = !p.bookmarked; bookmark.textContent = p.bookmarked ? 'ブックマーク済み' : 'ブックマーク'; bookmark.setAttribute('aria-pressed', p.bookmarked); if (saved && !p.bookmarked) load(false); }, error).then(function () { bookmark.disabled = false; });
      }); bookmark.setAttribute('aria-pressed', p.bookmarked); actions.appendChild(bookmark); card.appendChild(actions);
      if (p.reward) {
        var gift = el('div', 'diary-reward'); gift.appendChild(el('span', '', '$' + BR.util.fmt(p.reward) + ' · 期限 ' + new Date(p.expiresAt).toLocaleString('ja-JP')));
        var claim = button(p.claimed ? '受け取り済み' : p.claimable ? '報酬を受け取る' : '期限切れ', function () {
          claim.disabled = true; api.diaryClaim(p.id).then(function (r) { if (r.me) { BR.social.setMe(r.me); BR.app.serverBalance(r.me); } p.claimed = true; claim.textContent = '受け取り済み'; }, function (e) { error(e); load(false); });
        }); claim.disabled = !p.claimable; gift.appendChild(claim); card.appendChild(gift);
      }
      card.appendChild(el('p', 'diary-privacy', 'コメントは自分と開発者だけが確認できます。他のプレイヤーや運営者には公開されません。'));
      var form = el('form', 'diary-comment-form'), input = el('textarea'); input.rows = 3; input.maxLength = 2000; input.required = true; input.placeholder = '開発者へのコメント（2000文字以内）'; input.setAttribute('aria-label', '開発者へのコメント'); input.value = drafts[p.id] || '';
      input.addEventListener('input', function () { drafts[p.id] = input.value; }); form.appendChild(input);
      var submit = el('button', 'mini-btn', 'コメントを送る'); submit.type = 'submit'; form.appendChild(submit);
      var status = el('p', 'diary-status'); status.setAttribute('role', 'status'); form.appendChild(status);
      var comments = el('div', 'diary-own-comments');
      form.addEventListener('submit', function (e) {
        e.preventDefault(); if (!input.value.trim()) return; submit.disabled = true; var gen = generation;
        api.diaryComment(p.id, input.value).then(function () { if (gen !== generation) return; input.value = ''; drafts[p.id] = ''; status.textContent = '開発者へ送信しました'; myComments(p.id, comments); }, error).then(function () { submit.disabled = false; });
      }); card.appendChild(form); card.appendChild(comments);
      function read() {
        if (!card.open) return; api.diaryRead(p.id).catch(function () {}); myComments(p.id, comments);
        if (p.hasImage && !images[p.id]) { var gen = generation; api.diaryImage(p.id).then(function (r) { if (gen !== generation || !image.isConnected) return; images[p.id] = r.image; image.src = r.image; }, error); }
      }
      card.addEventListener('toggle', function () { opened[p.id] = card.open; read(); }); list.appendChild(card);
      // Open details dispatch toggle after being attached; closed posts fetch no image.
    });
    if (!posts.length) list.appendChild(el('p', '', saved ? 'ブックマークした投稿はありません' : 'まだ投稿はありません'));
    document.getElementById('diary-more').hidden = !more;
  }
  function load(older) {
    if (!active()) return;
    if (busy) { if (!older) reload = true; return; } busy = true;
    var gen = generation, last = older && posts.length ? posts[posts.length - 1].id : 0;
    api.diary(saved, last).then(function (r) {
      if (gen !== generation) return; busy = false;
      if (reload) { reload = false; load(false); return; }
      posts = older ? posts.concat(r.posts) : r.posts; more = r.more; render();
    }, function (e) { if (gen !== generation) return; busy = false; document.getElementById('diary-list').textContent = e.message; });
  }
  function open() {
    if (!api.online || !api.hasToken()) { error({ message: 'オンラインでログインしてから利用してください' }); return; }
    generation++; busy = false; reload = false; posts = []; drafts = {}; opened = {}; images = {}; saved = false;
    document.getElementById('diary-saved').setAttribute('aria-pressed', 'false'); document.getElementById('diary-list').textContent = '読み込み中…'; K.showModal('developer-diary'); load(false);
  }
  BR.diary = { open: open, init: function () {
    root = document.getElementById('developer-diary'); K.registerModal('developer-diary');
    document.getElementById('diary-saved').addEventListener('click', function () { saved = !saved; this.setAttribute('aria-pressed', saved); load(false); });
    document.getElementById('diary-refresh').addEventListener('click', function () { load(false); });
    document.getElementById('diary-more').addEventListener('click', function () { load(true); });
    BR.live.on('diary', function () { if (active()) load(false); });
    BR.live.on('status', function (on) { if (on && active()) load(false); });
    // Reconcile missed events on foreground/reconnect. Do not replace text while typing.
    setInterval(function () { if (active() && !document.hidden && !BR.live.isConnected() && !root.contains(document.activeElement)) load(false); }, 20000);
  } };
})(window.BR = window.BR || {});
