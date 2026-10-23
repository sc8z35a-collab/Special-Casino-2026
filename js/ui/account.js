/* Sign-up, log-in and password screens (online). They are real HTML forms in
   an overlay outside the scaled stage, so the text fields keep a normal size
   on phones and password managers can fill them in.

   Sign-up: name (checked live: names are unique) + password -> icon (paid
   icons are chained) -> the recovery code. Log-in: name + password, or the
   recovery code. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$, $$ = U.$$;
  var nfkc = K.nfkc;

  var CARDS = ['register', 'avatar', 'login', 'code-login', 'codecard', 'password'];
  var busy = false;
  var after = null;          // what to do once signed in (start the game, open friends, ...)
  var draft = { name: '', password: '', avatar: BR.CONFIG.defaultAvatar };
  var codeFirst = false;

  var NAME_RE = /^[A-Za-z0-9_\-ぁ-ゖァ-ヺー・々〆一-鿿㐀-䶿]+$/;
  // null = fine, '' = empty, otherwise the problem (the server has the last word)
  function nameProblem(raw) {
    var name = nfkc(raw).trim();
    var len = Array.from(name).length;
    if (!len) return '';
    if (len < 2 || len > 12) return 'ユーザー名は2〜12文字にしてください';
    if (!NAME_RE.test(name)) return 'ユーザー名には日本語・英数字・「_」「-」だけが使えます';
    if (/^[_\-ー・]+$/.test(name)) return 'ユーザー名に文字か数字を含めてください';
    return null;
  }
  function passwordProblem(pw) {
    var n = Array.from(pw || '').length;
    if (n < 4) return 'パスワードは4文字以上にしてください';
    if (n > 64) return 'パスワードは64文字までです';
    return null;
  }

  function overlay() { return $('#welcome'); }
  function isOpen() { return !overlay().hidden; }
  function show(card) {
    CARDS.forEach(function (c) { $('#ov-' + c).hidden = c !== card; });
    overlay().hidden = false;
    K.fitOverlay(overlay());
    var sc = $('#welcome .ov-scroll');
    if (sc) sc.scrollTop = 0;
  }
  function setError(card, text) { var e = $('#ov-' + card + '-error'); if (e) e.textContent = text || ''; }
  function setBusy(on) {
    busy = on;
    $$('#welcome button, #welcome input').forEach(function (b) { b.disabled = on; });
  }
  function close() {
    var a = document.activeElement;
    if (a && a.blur && overlay().contains(a)) a.blur();
    overlay().hidden = true;
    BR.app.relayout();
  }
  function finish() {
    close();
    var f = after;
    after = null;
    if (f) f();
  }

  /* ------------------------------------------------------------ name check --- */
  var check = { seq: 0, timer: 0, name: '', available: null, device: '' };
  function hint(text, kind) {
    var h = $('#ov-name-hint');
    h.textContent = text || '';
    h.className = 'ov-hint' + (kind ? ' ' + kind : '');
  }
  function onNameInput() {
    var raw = $('#ov-name').value;
    var problem = nameProblem(raw);
    clearTimeout(check.timer);
    check.available = null;
    setError('register', '');
    if (problem === '') { hint(''); return; }
    if (problem) { hint(problem, 'bad'); return; }
    var name = nfkc(raw).trim();
    hint('確認中…', '');
    check.timer = setTimeout(function () { lookup(name); }, 350);
  }
  function lookup(name) {
    var seq = ++check.seq;
    return api.nameCheck(name).then(function (r) {
      if (seq !== check.seq) return null;
      check.name = name;
      check.available = r.available;
      check.device = r.device || '';
      if (r.available) hint('このユーザー名は使えます', 'ok');
      else hint(r.problem || 'このユーザー名は使えません', 'bad');
      return r;
    }, function (err) {
      if (seq === check.seq) hint(err.message, 'bad');
      return null;
    });
  }

  /* ------------------------------------------------------------ sign-up --- */
  function onRegister(e) {
    e.preventDefault();
    if (busy) return;
    var raw = $('#ov-name').value, pw = $('#ov-pass').value;
    var problem = nameProblem(raw);
    if (problem !== null) { setError('register', problem || 'ユーザー名を入力してください'); K.sfx('deny'); return; }
    var pp = passwordProblem(pw);
    if (pp) { setError('register', pp); K.sfx('deny'); return; }
    var name = nfkc(raw).trim();
    setBusy(true);
    var known = check.name === name && check.available !== null ? Promise.resolve({ available: check.available, device: check.device }) : lookup(name);
    known.then(function (r) {
      setBusy(false);
      if (!r) { setError('register', 'サーバーに接続できません。少し待ってからもう一度お試しください'); return; }
      if (deviceStop(r.device)) return;
      if (!r.available) { setError('register', 'このユーザー名はすでに使われています'); K.sfx('deny'); return; }
      draft.name = name;
      draft.password = pw;
      K.sfx('click');
      openAvatarStep();
    });
  }

  // This device has made its two accounts (or one on it is banned): no new
  // one. Two made: the 引き継ぎコード of one of them brings it back.
  var DEVICE_FULL = 'この端末で作れるアカウントは2つまでです。前のアカウントの引き継ぎコードでログインしてください';
  function deviceStop(state, message) {
    if (state === 'full') {
      K.sfx('deny');
      open('code-login', message || DEVICE_FULL);
      return true;
    }
    if (state === 'banned') {
      K.sfx('deny');
      show('register');
      setError('register', message || 'この端末のアカウントがBANされているため、新しいアカウントは作れません');
      return true;
    }
    return false;
  }

  function openAvatarStep() {
    $('#ov-avatar-who').textContent = draft.name;
    setError('avatar', '');
    BR.avatars.signupGrid($('#ov-av-grid'), draft.avatar, function (id) {
      draft.avatar = id;
      setError('avatar', '');
    }, function (a) {
      setError('avatar', '「' + a.name + '」は有料アイコンです。登録後にアイコン変更から購入できます。');
    });
    show('avatar');
  }

  function create() {
    if (busy) return;
    setBusy(true);
    setError('avatar', '');
    api.register(draft.name, draft.password, draft.avatar).then(function (r) {
      api.rememberName(r.me.name);
      draft.password = '';
      $('#ov-pass').value = '';
      BR.social.signIn(r.token, r.me);
      K.sfx('purchase');
      showCode(r.recoveryCode, true);
    }, function (err) {
      if (err.code === 'device_limit' || err.code === 'device_banned') {
        deviceStop(err.code === 'device_limit' ? 'full' : 'banned', err.message);
        return;
      }
      if (err.code === 'name_taken' || /^name_/.test(err.code)) {
        show('register');
        setError('register', err.message);
        hint(err.message, 'bad');
      } else {
        setError('avatar', err.message);
      }
      K.sfx('deny');
    }).then(function () { setBusy(false); });
  }

  /* ------------------------------------------------------------ log-in --- */
  function onLogin(e) {
    e.preventDefault();
    if (busy) return;
    var name = nfkc($('#ov-login-name').value).trim(), pw = $('#ov-login-pass').value;
    if (!name) { setError('login', 'ユーザー名を入力してください'); return; }
    if (!pw) { setError('login', 'パスワードを入力してください'); return; }
    setBusy(true);
    setError('login', '');
    api.login(name, pw).then(function (r) {
      $('#ov-login-pass').value = '';
      welcomeBack(r);
    }, function (err) {
      setError('login', err.message);
      K.sfx('deny');
    }).then(function () { setBusy(false); });
  }

  function onCodeLogin(e) {
    e.preventDefault();
    if (busy) return;
    var code = $('#ov-code').value;
    if (nfkc(code).replace(/[^0-9A-Za-z]/g, '').length !== 16) {
      setError('code-login', '引き継ぎコードは16文字です');
      return;
    }
    setBusy(true);
    setError('code-login', '');
    api.loginCode(code).then(function (r) {
      $('#ov-code').value = '';
      welcomeBack(r);
      if (r.me && !r.me.hasPassword) setTimeout(function () { K.toast('プロフィールからパスワードを設定すると、名前とパスワードでログインできます', 4200); }, 2600);
    }, function (err) {
      setError('code-login', err.message);
      K.sfx('deny');
    }).then(function () { setBusy(false); });
  }

  function welcomeBack(r) {
    // banned: logged in, but only to the locked title screen (js/ui/banlock.js)
    if (r.ban) {
      after = null;
      close();
      BR.social.signInBanned(r.token, r.ban);
      return;
    }
    api.rememberName(r.me.name);
    BR.social.signIn(r.token, r.me);
    K.sfx('purchase');
    K.toast(r.me.name + 'さん、おかえりなさい！');
    finish();
    if (BR.juice) setTimeout(function () { BR.juice.reward('#toast', 2); }, 120);
  }

  // XXXX-XXXX-XXXX-XXXX while typing
  function formatCode() {
    var input = $('#ov-code');
    var raw = nfkc(input.value).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16);
    var v = (raw.match(/.{1,4}/g) || []).join('-');
    if (v !== input.value) input.value = v;
  }

  /* ------------------------------------------------------------ recovery code --- */
  function showCode(code, first) {
    codeFirst = first;
    $('#ov-code-title').textContent = first ? '登録が完了しました！' : '新しい引き継ぎコード';
    $('#ov-code-value').textContent = code;
    $('#ov-copy').textContent = 'コードをコピー';
    $('#ov-done').textContent = first ? 'ゲームをはじめる' : '閉じる';
    show('codecard');
  }

  /* ------------------------------------------------------------ password --- */
  function openPassword() {
    var m = BR.social.me();
    if (!m) return;
    var has = !!m.hasPassword;
    $('#ov-pw-title').textContent = has ? 'パスワードの変更' : 'パスワードの設定';
    $('#ov-pw-current-wrap').hidden = !has;
    $('#ov-pw-current').value = '';
    $('#ov-pw-new').value = '';
    $('#ov-pw-name').value = m.name;
    setError('password', '');
    show('password');
  }
  function onPassword(e) {
    e.preventDefault();
    if (busy) return;
    var m = BR.social.me();
    var pw = $('#ov-pw-new').value, pp = passwordProblem(pw);
    if (pp) { setError('password', pp); return; }
    setBusy(true);
    api.password(m && m.hasPassword ? $('#ov-pw-current').value : undefined, pw).then(function (r) {
      BR.social.setMe(r.me);
      K.sfx('purchase');
      close();
      K.toast('パスワードを保存しました');
    }, function (err) {
      setError('password', err.message);
      K.sfx('deny');
    }).then(function () { setBusy(false); });
  }

  /* ------------------------------------------------------------ entry points --- */
  // Runs `next` when signed in; otherwise asks to sign up (or log in) first.
  function require(next, card) {
    if (BR.banlock && BR.banlock.active()) return;
    if (api.hasToken()) { next(); return; }
    after = next;
    open(card || 'register');
  }
  function open(card, notice) {
    setError('register', '');
    setError('login', '');
    setError('code-login', '');
    ['register', 'login', 'code-login'].forEach(function (c) {
      var n = $('#ov-notice-' + c);
      if (!n) return;
      var mine = c === card || (c === 'register' && CARDS.indexOf(card) < 0);
      n.textContent = mine ? notice || '' : '';
      n.hidden = !(mine && notice);
    });
    if (card === 'login' && !$('#ov-login-name').value) $('#ov-login-name').value = api.lastName();
    show(card);
  }

  function bindEye(btn) {
    btn.addEventListener('click', function () {
      var input = $('#' + btn.dataset.eye);
      var showIt = input.type === 'password';
      input.type = showIt ? 'text' : 'password';
      btn.classList.toggle('on', showIt);
      btn.setAttribute('aria-label', showIt ? 'パスワードを隠す' : 'パスワードを表示');
    });
  }

  function init() {
    $('#ov-register').addEventListener('submit', onRegister);
    $('#ov-login').addEventListener('submit', onLogin);
    $('#ov-code-login').addEventListener('submit', onCodeLogin);
    $('#ov-password').addEventListener('submit', onPassword);
    $('#ov-create').addEventListener('click', create);
    $('#ov-name').addEventListener('input', onNameInput);
    $('#ov-code').addEventListener('input', formatCode);
    $$('#welcome [data-eye]').forEach(bindEye);
    $$('#welcome [data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        K.sfx('click');
        var card = b.dataset.go;
        if (card === 'register' && !$('#ov-name').value && api.lastName() === '') hint('');
        open(card);
      });
    });
    $$('#welcome [data-ov-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        K.sfx('click');
        after = null;
        close();
      });
    });
    $('#ov-copy').addEventListener('click', function () {
      var code = $('#ov-code-value').textContent;
      K.copyText(code).then(function () {
        $('#ov-copy').textContent = 'コピーしました！';
      }, function () {
        var r = document.createRange();
        r.selectNodeContents($('#ov-code-value'));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        $('#ov-copy').textContent = '長押しでコピーしてください';
      });
    });
    $('#ov-done').addEventListener('click', function () {
      K.sfx('click');
      if (!codeFirst) { close(); return; }
      // a new player: into the game (the guide shows the way)
      codeFirst = false;
      close();
      finish();
      BR.social.firstRun();
    });
  }

  BR.account = {
    init: init,
    require: require,
    open: open,
    close: close,
    isOpen: isOpen,
    showCode: showCode,
    openPassword: openPassword
  };
})(window.BR = window.BR || {});
