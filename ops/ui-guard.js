/* Shared operator/security UI behavior. This affects browser interactions only;
   authentication and authorization continue to be enforced by the server. */
(function () {
  'use strict';
  function editable(target) {
    return target && target.closest && target.closest('input, textarea, [contenteditable="true"]');
  }
  function shareURL(target) {
    var input = target && target.closest && target.closest('#dialog:not([hidden]) input[data-vault-share-url="1"]');
    return input && input.readOnly;
  }
  document.addEventListener('selectstart', function (e) {
    if (!editable(e.target)) e.preventDefault();
  });
  ['copy', 'cut'].forEach(function (type) {
    document.addEventListener(type, function (e) { if (type === 'copy' && shareURL(e.target)) return; e.preventDefault(); e.stopImmediatePropagation(); }, true);
  });
  document.addEventListener('keydown', function (e) {
    if (window.parent !== window && e.altKey && e.code === 'Space') {
      e.preventDefault();
      window.parent.postMessage({ type: 'ops:desktop-shortcut', action: 'menu' }, location.origin);
      return;
    }
    var key = e.key.toLowerCase();
    if (shareURL(e.target) && (((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'a')) || (e.ctrlKey && e.key === 'Insert'))) return;
    if (((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'x' || (key === 'a' && !editable(e.target)))) || (e.ctrlKey && e.key === 'Insert') || (e.shiftKey && e.key === 'Delete')) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  // Only the existing vault item menu may handle a secondary click.
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (!e.target.closest('#view-vault .vitem')) e.stopImmediatePropagation();
  }, true);
})();
