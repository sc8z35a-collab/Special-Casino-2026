/* One Three.js core shared by every game renderer and the operator vault. */
(function (BR) {
  'use strict';
  var pending;
  BR.three = function () {
    if (window.BR3D) return Promise.resolve(window.BR3D);
    if (!pending) pending = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = BR.util.codeUrl('js/vendor/three-bundle.js');
      s.onload = function () { if (window.BR3D) resolve(window.BR3D); else { pending = null; reject(new Error('three_missing')); } };
      s.onerror = function () { pending = null; s.remove(); reject(new Error('three_load')); }; document.head.appendChild(s);
    });
    return pending;
  };
})(window.BR = window.BR || {});
