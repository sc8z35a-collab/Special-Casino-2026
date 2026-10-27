/* 演出設定: the dialog behind the 「演出」 button on the slot screen (and the
   profile): シンプル演出 switches every fancy effect off at once, and each
   one has its own switch below (js/core/effects.js keeps the choice on this
   device). Only the show changes, never the game. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit;
  var $ = U.$;
  var el = K.el, sfx = K.sfx;

  function render() {
    var F = BR.fx;
    $('#fx-simple').checked = F.simple();
    $('#fx-lite').checked = F.lite();
    var box = $('#fx-groups');
    box.textContent = '';
    F.groups.forEach(function (g) {
      var sec = el('section', 'fx-group');
      sec.appendChild(el('h3', '', g.name));
      g.items.forEach(function (it) {
        var row = el('label', 'fx-row');
        var name = el('span', 'fx-name', it[1]);
        name.appendChild(el('small', '', it[2]));
        row.appendChild(name);
        var input = el('input');
        input.type = 'checkbox';
        input.dataset.fx = it[0];
        input.checked = F.on(it[0]);
        row.appendChild(input);
        row.appendChild(el('i', 'fx-switch'));
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
  }

  function open() {
    render();
    K.showModal('fx-settings');
  }

  function init() {
    K.registerModal('fx-settings');
    K.dragScroll($('#fx-groups'));
    $('#btn-fx').addEventListener('click', function () { sfx('click'); open(); });
    $('#fx-simple').addEventListener('change', function (e) {
      sfx('click');
      BR.fx.setSimple(e.target.checked);
      render();
    });
    $('#fx-lite').addEventListener('change', function (e) {
      sfx('click');
      BR.fx.setLite(e.target.checked);
      render();
    });
    $('#fx-groups').addEventListener('change', function (e) {
      var id = e.target.dataset && e.target.dataset.fx;
      if (!id) return;
      sfx('click');
      BR.fx.set(id, e.target.checked);
      render();
    });

  }

  BR.effects = { init: init, open: open };
})(window.BR = window.BR || {});
