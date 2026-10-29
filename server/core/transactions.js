// Both hosts join nested transactions. Publish effects only after the outer
// commit, and never commit partial work when a nested failure was caught.
export function createTransactions(db) {
  let pending = null;
  function effect(fn) {
    try { return fn(); } catch (e) { console.error('post-commit effect failed', e); }
  }
  function afterCommit(fn) {
    if (pending) pending.effects.push(fn);
    else return effect(fn);
  }
  function run(fn) {
    if (pending) {
      try { return fn(); } catch (e) {
        if (!pending.failed) { pending.failed = true; pending.error = e; }
        throw e;
      }
    }
    const current = { effects: [], failed: false, error: null };
    pending = current;
    let result;
    try {
      result = db.tx(() => {
        const value = fn();
        if (current.failed) throw current.error;
        return value;
      });
    } finally {
      pending = null;
    }
    for (const fn of current.effects) effect(fn);
    return result;
  }
  return { run, afterCommit };
}
