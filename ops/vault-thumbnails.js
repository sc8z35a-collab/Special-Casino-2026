/* Small static pictures only. Never loads a 3D engine or a model file. */
(function () {
  'use strict';
  function make(source) {
    return new Promise(function (resolve, reject) {
      var image = new Image(), objectURL = typeof source === 'string' ? '' : URL.createObjectURL(source);
      function clean() { if (objectURL) URL.revokeObjectURL(objectURL); }
      image.onerror = function () { clean(); reject(new Error('画像を読み込めませんでした')); };
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas'), result;
          [144, 96, 64].some(function (side) {
            canvas.width = canvas.height = side;
            var ctx = canvas.getContext('2d'), scale = Math.min(side / image.naturalWidth, side / image.naturalHeight);
            ctx.fillStyle = '#edf1f7'; ctx.fillRect(0, 0, side, side);
            var w = image.naturalWidth * scale, h = image.naturalHeight * scale;
            ctx.drawImage(image, (side - w) / 2, (side - h) / 2, w, h);
            result = canvas.toDataURL('image/webp', .5);
            if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/jpeg', .45);
            return result.length <= 16 * 1024;
          });
          clean();
          if (result.length > 24 * 1024) throw new Error('プレビュー画像が大きすぎます');
          resolve(result);
        } catch (e) { clean(); reject(e); }
      };
      image.src = objectURL || source;
    });
  }
  window.VaultThumbnails = { make: make };
})();
