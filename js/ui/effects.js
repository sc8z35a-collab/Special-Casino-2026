/* 演出設定: the dialog behind the 「演出」 button on the slot screen (and the
   profile), two switches and nothing else: 軽量 switches every fancy effect
   off at once (js/core/effects.js: simple), 極軽量 also draws at 30fps with
   fewer particles and a lower resolution (lite). The choice stays on this
   device; only the show changes, never the game. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit;
  var $ = U.$;
  var sfx = K.sfx;

  function render() {
    $('#fx-simple').checked = BR.fx.simple();
    $('#fx-lite').checked = BR.fx.lite();
  }

  function open() {
    render();
    K.showModal('fx-settings');
  }

  function init() {
    K.registerModal('fx-settings');
    $('#btn-fx').addEventListener('click', function () { sfx('click'); open(); });
    $('#fx-simple').addEventListener('change', function (e) {
      sfx('click');
      BR.fx.setSimple(e.target.checked);
      render();
    });
    $('#fx-lite').addEventListener('change', function (e) {
      sfx('click');
      BR.fx.setLite(e.target.checked);
      // (極軽量 is 軽量 and more)
      if (e.target.checked && !BR.fx.simple()) BR.fx.setSimple(true);
      render();
    });
  }

  BR.effects = { init: init, open: open };
})(window.BR = window.BR || {});
