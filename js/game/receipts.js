/* Receipt deadlines, shared by the API and chat cards. Time starts when
   something was sent, including time hidden by a block. Claimed balances
   and items never expire. Existing unclaimed cards use their original date. */
(function (BR) {
  'use strict';
  function days(m) {
    if ((m.kind === 'transfer' && m.pending) || m.kind === 'car_sold' || m.kind === 'present') return BR.CONFIG.receiveDays.money;
    if (m.pending && (m.kind === 'gift' || m.kind === 'item')) return BR.CONFIG.receiveDays.item;
    return 0;
  }
  function deadline(m) { var d = days(m); return d ? (m.created_at === undefined ? m.at : m.created_at) + d * 86400000 : 0; }
  BR.receipts = {
    days: days,
    deadline: deadline,
    expired: function (m, now) { var end = deadline(m); return !m.claimed && !m.claimed_at && end > 0 && end <= (now === undefined ? Date.now() : now); }
  };
})(globalThis.BR = globalThis.BR || {});
