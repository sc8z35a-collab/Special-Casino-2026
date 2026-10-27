/* A LINE card opens the game with a bearer gift in the fragment. It survives
   sign-in, but GET/navigation never changes a balance: an explicit tap does. */
(function (BR) {
  'use strict';
  var K = BR.kit, api = BR.api, pending = '', showing = false, epoch = 0;
  var KEY = 'blockbuster-reels/line-gift';
  function remember(token) { pending = token; try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); } catch (e) {} }
  function capture() {
    var match = /^#line-gift=([A-Za-z0-9_-]{32})$/.exec(location.hash);
    if (match) { remember(match[1]); history.replaceState(null, '', location.pathname + location.search); }
  }
  function check() {
    capture();
    if (!pending || showing || !api.hasToken() || !BR.social.me()) return;
    showing = true; var token = pending, gen = ++epoch;
    api.lineReward(token).then(function (r) {
      if (gen !== epoch) return;
      var title = document.getElementById('line-reward-title'), claim = document.getElementById('line-reward-claim');
      title.textContent = (r.kind === 'casino' ? 'カジノコイン ' : 'ロイヤルコイン ') + BR.util.fmt(r.amount) + '枚';
      document.getElementById('line-reward-status').textContent = r.claimed ? '受け取り済み' : r.expired ? '期限切れ' : '受け取り期限：' + new Date(r.expiresAt).toLocaleString('ja-JP');
      claim.disabled = r.claimed || r.expired;
      claim.onclick = function () {
        claim.disabled = true;
        api.lineRewardClaim(token).then(function (answer) {
          if (gen !== epoch) return;
          BR.social.setMe(answer.me); BR.app.serverBalance(answer.me);
          document.getElementById('line-reward-status').textContent = answer.received ? '受け取りました' : '受け取り済み'; remember('');
        }, function (e) { if (gen !== epoch) return; K.fail(e); claim.disabled = false; });
      };
      if (r.claimed || r.expired) remember('');
      K.showModal('line-reward-modal');
    }, function (e) { if (gen !== epoch) return; showing = false; if (e.status === 404) remember(''); K.fail(e); });
  }
  BR.lineReward = { check: check, reset: function () { epoch++; showing = false; }, init: function () {
    try { pending = sessionStorage.getItem(KEY) || ''; } catch (e) {}
    capture(); K.registerModal('line-reward-modal');
    window.addEventListener('hashchange', function () { showing = false; check(); });
    document.getElementById('line-reward-modal').addEventListener('closed', function () { showing = false; remember(''); });
  } };
})(window.BR = window.BR || {});
