/* One transport policy for both the browser and the server. */
(function (root) {
  'use strict';
  var HTTP_ONLY = /^\/api\/(?:login|register|logout|recovery|password|ban$|oauth\/|pk\/|ops\/login|ops\/profile\/|ops\/ext\/|sec\/|pay\/|discord\/|line\/|admin$|internal\/|stream|ops\/live-ticket|vault\/(?:piece|chunk))/;
  root.BR = root.BR || {};
  root.BR.overSocket = function (method, path) {
    if (method !== 'GET' && method !== 'POST') return false;
    if (method === 'POST' && path.startsWith('/api/vault/')) return false;
    return path.startsWith('/api/') && !HTTP_ONLY.test(path);
  };
})(typeof window === 'object' ? window : globalThis);
