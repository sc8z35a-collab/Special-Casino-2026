// Staff rights are given to a NAME: the developer's (config.developer), the
// operators in config.operators, and the ones the developer made on the site
// (ops_access, by name). A name that comes free — its account deleted, renamed,
// lost to a restore — must not hand those rights to whoever registers it next.
//
// So the first account that uses a staff name's rights is bound to it (its id
// and the day it was made), and from then on only that account has them. A
// different account under the same name has none (and the operators' log says
// so, once an hour); the name is not given out again while the binding stands.
// The developer's own grant on the site binds the account it names; the admin
// commands `staff-pin` and `staff-unpin` do it from the command line.

const TTL_MS = 5000;
const TELL_MS = 3600000;

export function createStaffPins({ q, clock = Date.now, onMismatch = () => {} }) {
  let rows = null, loadedAt = 0;
  const all = () => {
    if (!rows || clock() - loadedAt > TTL_MS) {
      rows = new Map(q('SELECT * FROM staff_pins').all().map((r) => [r.name_key, r]));
      loadedAt = clock();
    }
    return rows;
  };
  const drop = () => { rows = null; };
  const told = new Map();

  const pins = {
    // 'ok': this account is the one bound to its name; 'new': none is yet; 'other': another account is
    peek(u) {
      const pin = all().get(u.name_key);
      if (!pin) return 'new';
      if (pin.user_id !== u.id) return 'other';
      // (a row that does not carry its day of birth — a short list entry — is known by its id)
      return u.created_at === undefined || pin.born === u.created_at ? 'ok' : 'other';
    },
    // may this account use the rights its name carries? (a name seen for the first time is bound to it)
    holds(u) {
      const state = pins.peek(u);
      if (state === 'new') { pins.bind(u, 'first use'); return true; }
      if (state === 'ok') return true;
      const now = clock();
      if (now - (told.get(u.name_key) || 0) > TELL_MS) {
        told.set(u.name_key, now);
        try { onMismatch(u, all().get(u.name_key)); } catch { /* the answer does not wait for the log */ }
      }
      return false;
    },
    bind(u, by) {
      q(`INSERT INTO staff_pins (name_key, user_id, born, at, by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name_key) DO UPDATE SET user_id = excluded.user_id, born = excluded.born, at = excluded.at, by = excluded.by`)
        .run(u.name_key, u.id, u.created_at, clock(), by);
      drop();
    },
    forget(nameKey) {
      const n = Number(q('DELETE FROM staff_pins WHERE name_key = ?').run(nameKey).changes);
      drop();
      return n > 0;
    },
    // is the name bound (to an account that may be gone): not to be registered again
    taken: (nameKey) => all().has(nameKey),
    list: () => [...all().values()]
  };
  return pins;
}
