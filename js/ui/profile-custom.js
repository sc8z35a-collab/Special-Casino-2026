/* Profile artwork and interaction customisations. The existing account, VIP,
   avatar and notification APIs remain the source of truth. */
(function (BR) {
  'use strict';
  if (!BR.PROFILE_IMG || !BR.social) return;

  var $ = function (id) { return document.getElementById(id); };
  var profileQueued = false;
  var pushBusy = false;
  var PUSH_ENABLED = 'blockbuster-reels/push-enabled';

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function imageIcon(name) {
    var i = node('i', 'ic pf-art-icon pf-art-' + name);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function tile(label, customAct, art, act) {
    var b = node('button', 'pf-tile pf-icon-tile');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    if (customAct) b.dataset.customAct = customAct;
    if (act) b.dataset.act = act;
    b.appendChild(imageIcon(art));
    b.appendChild(node('span', 'pf-tile-name', label));
    return b;
  }

  /* ------------------------------------------------------------ notifications --- */
  function savedPushState(value) {
    try {
      if (value !== undefined) localStorage.setItem(PUSH_ENABLED, value);
      return localStorage.getItem(PUSH_ENABLED);
    } catch (e) { return null; }
  }
  function notificationsOn() {
    return BR.push && BR.push.permission() === 'granted' && savedPushState() !== '0';
  }
  function keyBytes(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    s += '===='.slice(0, (4 - s.length % 4) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function enableWebPush() {
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted') : new Promise(function (resolve) {
      var request = Notification.requestPermission(resolve);
      if (request && request.then) request.then(resolve);
    });
    return ask.then(function (permission) {
      if (permission !== 'granted') return permission;
      return navigator.serviceWorker.getRegistration().then(function (registration) {
        return registration || navigator.serviceWorker.register('sw.js');
      }).then(function () {
        return navigator.serviceWorker.ready;
      }).then(function (registration) {
        return Promise.all([registration, BR.api.pushKey()]);
      }).then(function (parts) {
        var registration = parts[0], key = parts[1].key;
        return registration.pushManager.getSubscription().then(function (subscription) {
          return subscription || registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
        }).catch(function () {
          return registration.pushManager.getSubscription().then(function (old) {
            return (old ? old.unsubscribe() : Promise.resolve()).then(function () {
              return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
            });
          });
        });
      }).then(function (subscription) {
        return BR.api.pushSubscribe(subscription.toJSON()).then(function () { return 'granted'; });
      });
    });
  }
  function disableWebPush() {
    return navigator.serviceWorker.getRegistration().then(function (registration) {
      return registration ? registration.pushManager.getSubscription() : null;
    }).then(function (subscription) {
      if (!subscription) return null;
      return BR.api.pushUnsubscribe(subscription.endpoint).catch(function () {}).then(function () { return subscription.unsubscribe(); });
    }).catch(function () {});
  }
  function toggleNotifications(button) {
    if (pushBusy || !BR.push) return Promise.resolve();
    if (BR.push.mode() === 'none') return Promise.resolve('none');
    if (BR.push.permission() === 'denied') {
      BR.push.settings();
      return Promise.resolve('denied');
    }
    pushBusy = true;
    if (button) button.disabled = true;
    var enabling = !notificationsOn();
    var app = window.TwoStateApp && typeof window.TwoStateApp.notice === 'function' ? window.TwoStateApp : null;
    var job;
    if (app) {
      try {
        if (enabling) app.askNotify();
        else { app.notifyOff(); savedPushState('0'); }
      } catch (e) { /* an older app */ }
      job = Promise.resolve(enabling ? 'app-requested' : BR.push.permission());
    } else {
      job = enabling ? enableWebPush().then(function (result) {
        if (result === 'granted') savedPushState('1');
        return result;
      }) : disableWebPush().then(function () {
        savedPushState('0');
        return BR.push.permission();
      });
    }
    return job.then(function (result) {
      if (result === 'app-requested') return result;
      var on = notificationsOn();
      if (enabling && on) BR.sfx.play('notify');
      BR.kit.toast(on ? '通知をオンにしました' : enabling ? '通知をオンにできませんでした' : '通知をオフにしました');
      return result;
    }).catch(function (err) {
      BR.kit.fail(err);
      return BR.push.permission();
    }).then(function (result) {
      pushBusy = false;
      if (button) button.disabled = false;
      updatePushButton(button);
      return result;
    });
  }
  function updatePushButton(button) {
    if (!button || !BR.push) return;
    var on = notificationsOn();
    button.classList.toggle('is-on', on);
    button.classList.toggle('is-off', !on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? '通知をオフにする' : '通知をオンにする');
    button.title = on ? '通知をオフにする' : '通知をオンにする';
  }

  /* ------------------------------------------------------------ profile --- */
  function buildLevelBar() {
    if ($('pf-level')) return;
    var bar = node('div', 'pf-level');
    bar.id = 'pf-level';
    var head = node('div', 'pf-level-head');
    head.appendChild(node('b', '', 'レベル'));
    var value = node('span', 'pf-level-value');
    value.id = 'pf-level-value';
    head.appendChild(value);
    var track = node('div', 'pf-level-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'レベル経験値');
    track.id = 'pf-level-track';
    var fill = node('i', 'pf-level-fill');
    fill.id = 'pf-level-fill';
    track.appendChild(fill);
    bar.appendChild(head);
    bar.appendChild(track);
    document.querySelector('.profile-card').insertBefore(bar, document.querySelector('.pf-top'));
  }
  function updateLevel(self) {
    var bar = $('pf-level');
    if (!bar) return;
    var me = BR.social.me();
    var xp = self && me ? (typeof me.xp === 'number' ? me.xp : BR.quests.xp()) : null;
    var info = typeof xp === 'number' && BR.LEVEL ? BR.LEVEL.info(xp) : null;
    bar.hidden = !info;
    if (!info) return;
    var pct = info.need ? Math.max(0, Math.min(100, info.into / info.need * 100)) : 100;
    var levelText = 'Lv.' + info.level + '　' + BR.util.fmt(info.into) + ' / ' + BR.util.fmt(info.need) + ' XP';
    if ($('pf-level-value').textContent !== levelText) $('pf-level-value').textContent = levelText;
    $('pf-level-fill').style.width = pct + '%';
    var track = $('pf-level-track');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(info.need));
    track.setAttribute('aria-valuenow', String(info.into));
    track.setAttribute('aria-valuetext', 'レベル' + info.level + '、' + info.into + ' / ' + info.need + ' XP');
  }
  function ownProfile(actions, secondary) {
    if (actions.querySelector('[data-custom-act="login"]')) return true;
    if (secondary.querySelector('[data-act="logout"]')) return true;
    delete actions.dataset.customSelf;
    return false;
  }
  function rebuildOwnActions(actions, secondary) {
    if (actions.dataset.customSelf === '1') {
      updatePushButton(actions.querySelector('[data-custom-act="push"]'));
      return;
    }
    actions.dataset.customSelf = '1';
    actions.textContent = '';
    secondary.textContent = '';
    actions.classList.add('pf-own-actions');

    var login = tile('ログイン', 'login', 'login');
    login.setAttribute('aria-expanded', 'false');
    login.setAttribute('aria-controls', 'pf-login-options');
    actions.appendChild(login);

    if (BR.push && BR.push.mode() !== 'none') {
      var push = tile('通知', 'push', 'notification');
      push.classList.add('pf-push-toggle');
      updatePushButton(push);
      actions.appendChild(push);
    }
    actions.appendChild(tile('ログアウト', '', 'logout', 'logout'));

    var options = node('div', 'pf-login-options');
    options.id = 'pf-login-options';
    options.hidden = true;
    var me = BR.social.me();
    options.appendChild(tile('コードでログイン', '', 'login', 'codeLogin'));
    options.appendChild(tile('コードを再発行', '', 'recovery', 'recovery'));
    options.appendChild(tile(me && me.hasPassword ? 'パスワード変更' : 'パスワード設定', '', 'password', 'password'));
    secondary.appendChild(options);
    // Google / Discord: the ones the server offers (js/ui/oauth.js)
    if (BR.oauth) BR.oauth.profileTiles(options, function (label, provider, act) { return tile(label, '', provider, act); });
  }
  function enhanceProfile() {
    profileQueued = false;
    var actions = $('pf-actions'), secondary = $('pf-actions2');
    if (!actions || !secondary) return;
    var self = ownProfile(actions, secondary);
    if (!self) {
      actions.classList.remove('pf-own-actions');
      delete actions.dataset.customSelf;
    }
    document.querySelector('.profile-card').classList.toggle('is-own', self);
    updateLevel(self);

    var face = document.querySelector('.pf-face');
    if (self) {
      face.setAttribute('role', 'button');
      face.setAttribute('tabindex', '0');
      face.setAttribute('aria-label', 'アイコンを変更');
      face.title = 'アイコンを変更';
    } else {
      face.removeAttribute('role');
      face.removeAttribute('tabindex');
      face.removeAttribute('aria-label');
      face.removeAttribute('title');
    }
    if (self) rebuildOwnActions(actions, secondary);
    document.querySelectorAll('#profile .pf-tile').forEach(function (button) {
      var label = button.getAttribute('aria-label');
      var name = button.querySelector('.pf-tile-name');
      if (!label && name) label = name.textContent;
      if (label) {
        button.setAttribute('aria-label', label);
        if (!button.title) button.title = label;
      }
    });
  }
  function queueProfile() {
    if (profileQueued) return;
    profileQueued = true;
    Promise.resolve().then(enhanceProfile);
  }
  function openOwnAvatar() {
    var card = document.querySelector('.profile-card');
    if (!card || !card.classList.contains('is-own')) return;
    BR.sfx.play('click');
    BR.kit.closeModal('profile');
    BR.avatars.openPicker();
  }

  /* ------------------------------------------------------------ token exchange --- */
  function updateTokenAmount() {
    var combined = $('tp-combined');
    if (!combined) return;
    var tokens = $('tp-val-a').textContent;
    var dollars = $('tp-val-b').textContent;
    if ($('tp-combined-tokens').textContent !== tokens) $('tp-combined-tokens').textContent = tokens;
    if ($('tp-combined-dollars').textContent !== dollars) $('tp-combined-dollars').textContent = dollars;
    combined.setAttribute('aria-label', 'スピントークン ' + tokens + '、ドル ' + dollars);
  }
  function installTokenSlider() {
    var fields = document.querySelector('.tp-fields');
    if (!fields || $('tp-combined')) return;
    ['tp-input-a', 'tp-input-b', 'tp-minus', 'tp-plus'].forEach(function (id) {
      var control = $(id);
      control.disabled = true;
      control.setAttribute('aria-hidden', 'true');
    });
    var combined = node('div', 'tp-combined');
    combined.id = 'tp-combined';
    combined.setAttribute('aria-live', 'polite');
    var label = node('span', 'tp-combined-label', '交換数量');
    var values = node('div', 'tp-combined-values');
    var tokenSide = node('span', 'tp-combined-side');
    tokenSide.appendChild(node('i', 'ic ic-chip'));
    var tokenValue = node('b', '', '-');
    tokenValue.id = 'tp-combined-tokens';
    tokenSide.appendChild(tokenValue);
    var dollarSide = node('span', 'tp-combined-side');
    dollarSide.appendChild(node('i', 'ic ic-dollar'));
    var dollarValue = node('b', '', '-');
    dollarValue.id = 'tp-combined-dollars';
    dollarSide.appendChild(dollarValue);
    values.appendChild(tokenSide);
    values.appendChild(node('span', 'tp-combined-arrow', '⇄'));
    values.appendChild(dollarSide);
    combined.appendChild(label);
    combined.appendChild(values);
    fields.appendChild(combined);
    $('tp-track').setAttribute('aria-label', '交換数量をスライドして選択');
    updateTokenAmount();
    ['tp-val-a', 'tp-val-b'].forEach(function (id) {
      new MutationObserver(updateTokenAmount).observe($(id), { childList: true, subtree: true, characterData: true });
    });
  }

  function init() {
    Object.keys(BR.PROFILE_IMG).forEach(function (key) {
      document.documentElement.style.setProperty('--profile-' + key, 'url("' + BR.PROFILE_IMG[key] + '")');
    });
    buildLevelBar();
    var stats = document.querySelector('.pf-stats');
    if (stats) {
      stats.classList.add('pf-stats-total-only');
      var label = stats.querySelector('.pf-stat:first-child label');
      if (label) label.textContent = '累計獲得スピンコイン';
      stats.querySelectorAll('.pf-stat:not(:first-child)').forEach(function (stat) { stat.hidden = true; });
    }
    installTokenSlider();

    if (BR.push) {
      var appState = BR.push.appState;
      BR.push.appState = function (state) {
        if (state === 'granted') savedPushState('1');
        appState(state);
        document.querySelectorAll('[data-custom-act="push"]').forEach(updatePushButton);
      };
      BR.social.onMe(function (me) {
        // The regular sign-in sync may run first; preserve an explicit OFF choice.
        if (me && BR.push.mode() === 'web' && savedPushState() === '0') disableWebPush();
      });
    }

    var profile = $('profile');
    new MutationObserver(queueProfile).observe(profile, { childList: true, subtree: true });
    var face = document.querySelector('.pf-face');
    face.addEventListener('click', openOwnAvatar);
    face.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openOwnAvatar();
    });
    profile.addEventListener('click', function (event) {
      var button = event.target.closest('[data-custom-act]');
      if (!button || button.disabled) return;
      event.stopPropagation();
      if (button.dataset.customAct === 'login') {
        BR.sfx.play('click');
        var options = $('pf-login-options');
        options.hidden = !options.hidden;
        button.setAttribute('aria-expanded', String(!options.hidden));
      } else if (button.dataset.customAct === 'push') {
        BR.sfx.play('click');
        toggleNotifications(button);
      }
    });
    enhanceProfile();
  }

  init();
})(window.BR = window.BR || {});
