// A short hash of a text (53 bits, fast, not for secrets): to tell whether something is the same as it was — a row of a list, a part of the
// operator site's poll — without keeping or sending the thing itself.
export function hashOf(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 4294967296 + (h1 >>> 0)).toString(36);
}

// What an answer is, as a rev: what changes with every look (`skip`: the time by default) is not part of it.
export const revOf = (part, skip = ['now']) => hashOf(JSON.stringify(part, (k, v) => (skip.includes(k) ? undefined : v)));
// An answer the page asks for again and again: `{ same: true, rev }` when it has the `have` it was given.
export const partOf = (part, have, rev = revOf(part)) => (have === rev ? { same: true, rev } : { ...part, rev });
// …and one of several parts, of which the page holds some (`held`: { part: rev }): a part it holds as it is is left out and named in `kept`;
// `revs` names the rev of each part that came and is worth holding again (a small one is just sent, every time).
const HOLD_MIN = 48;
export function heldOf(answer, held) {
  const out = { revs: {}, kept: [] };
  for (const [k, v] of Object.entries(answer)) {
    if (k === 'now') { out.now = v; continue; }
    const text = JSON.stringify(v);
    if (text === undefined || text.length < HOLD_MIN) { out[k] = v; continue; }
    const rev = revOf(v);
    if (held[k] === rev) out.kept.push(k);
    else { out[k] = v; out.revs[k] = rev; }
  }
  return out;
}
// the parts a page says it holds, as it sends them in a query (held=part.rev,part.rev…)
export function heldFrom(text) {
  const out = {};
  for (const x of String(text || '').split(',').slice(0, 40)) {
    const m = /^([A-Za-z][A-Za-z0-9_]{0,39})\.([0-9a-z]{1,16})$/.exec(x);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
