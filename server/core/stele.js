// 石碑 — the operators' log, carved where the database cannot reach.
//
// The log already refuses to be changed (triggers), joins every row to the one before it (hashes) and keeps its newest hash
// outside the table (the anchor). This is the rest: copies of every row in a place of their own, so that losing or damaging the
// database does not lose the log, and a changed row cannot hide.
//
//   - Sealing: the rows not yet carved go, a thousand at most (or a few MB), into one segment: a file that is written once and
//     never again (the host's `stele` store: files here that can only be created; an R2 bucket on Cloudflare, which a bucket
//     lock can make impossible to delete). Each segment names the one before it (so none can be taken out of the middle),
//     is signed with a key of the server's, and is read back and compared before the log counts it as carved.
//   - Looking: now and then (incrementally beyond the verified anchor, plus a few random older segments) every segment is read and its hashes, its signature,
//     its place in the line and its rows against the database's are checked. A row that differs, a segment that is gone or
//     changed, a line that was cut at the end: all are found, written to the operators' log (so to Discord / LINE) and shown.
//   - Getting back: if the database has fewer rows than were carved (it was reset, restored to an earlier time, damaged), the
//     missing ones are put back from the segments, if they join the rows that are there. The log never goes back in time.
//   - Telling: once a day the newest carved row's hash goes to Discord / LINE (a witness that does not depend on this server).
//   - Watching the room: the size of the database against what the host allows, and of the log inside it.
// Without a store (a host that has none) the rest still runs where it can and the patrol says there is no copy.
import { sha256, keyFrom } from './auth.js';
import { rowHash, GENESIS_HASH } from './opslog.js';
import crypto from 'node:crypto';

export const PREFIX = 'oplog/';
const KEY_RE = /^oplog\/(\d{10})-(\d{10})\.json$/;
const SEG_ROWS = 1000, SEG_BYTES = 4 * 1048576;
const META = 'stele';
const SEG_GENESIS = sha256('TWO STATE ops log stele');
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const DB_LIMIT = 10 * 1024 ** 3;   // a Durable Object's SQLite database
const SAMPLE_BUDGET = 3;
const DEEP_BUDGET = 20;            // segments read in full in one look
const COLS = ['id', 'at', 'actor_id', 'actor_name', 'action', 'target_id', 'target_name', 'summary', 'detail', 'prev_hash', 'hash'];

const pad = (n) => String(n).padStart(10, '0');
export const keyOf = (a, b) => `${PREFIX}${pad(a)}-${pad(b)}.json`;
const toArr = (r) => COLS.map((c) => r[c]);
const toRow = (a) => Object.fromEntries(COLS.map((c, i) => [c, a[i]]));
const dayOf = (ms) => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

export function createStele({ q, opsLog, store = null, secret, clock = Date.now, notice = null, reschedule = null, dbBytes = null, dbLimit = DB_LIMIT, sampleIndex = n => crypto.randomInt(n) }) {
  const key = keyFrom(secret, 'stele');
  const load = () => { try { const r = q('SELECT value FROM meta WHERE key = ?').get(META); return r ? JSON.parse(r.value) : {}; } catch { return {}; } };
  const save = (s) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META, JSON.stringify(s));
  const say = (mark, text) => { if (notice) { try { notice.say(mark, text); } catch { /* a notice that fails changes nothing */ } } };
  let queue = Promise.resolve();
  const exclusive = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  // ---- a segment: written once, named by the rows it holds, joined to the one before, signed
  function encode(rows, prev) {
    const arr = rows.map(toArr);
    const first = rows[0].id, last = rows[rows.length - 1].id, head = rows[rows.length - 1].hash;
    const hash = sha256(JSON.stringify([1, first, last, prev, head, arr]));
    const sig = crypto.createHmac('sha256', key).update(hash).digest('hex');
    return { seg: { v: 1, first, last, prev, head, hash, sig, rows: arr }, bytes: new TextEncoder().encode(JSON.stringify({ v: 1, first, last, prev, head, hash, sig, rows: arr })) };
  }
  // → { ok, seg, sigOk, reason }: the segment's own arithmetic, with nothing outside it
  function parse(bytes) {
    let seg;
    try { seg = JSON.parse(new TextDecoder().decode(bytes)); } catch { return { ok: false, reason: '読めません（壊れています）' }; }
    if (!seg || seg.v !== 1 || !Array.isArray(seg.rows) || !seg.rows.length || !Number.isSafeInteger(seg.first) || !Number.isSafeInteger(seg.last)) return { ok: false, reason: '形が正しくありません' };
    if (seg.rows.length !== seg.last - seg.first + 1) return { ok: false, reason: '行の数が範囲と合いません' };
    let before = null;
    for (let i = 0; i < seg.rows.length; i++) {
      const a = seg.rows[i];
      if (!Array.isArray(a) || a.length !== COLS.length) return { ok: false, reason: `${i + 1}行目の形が正しくありません` };
      const r = toRow(a);
      if (r.id !== seg.first + i) return { ok: false, reason: `${seg.first + i}番がありません` };
      if (rowHash(r) !== r.hash) return { ok: false, reason: `#${r.id} の内容がハッシュと合いません` };
      if (before && r.prev_hash !== before) return { ok: false, reason: `#${r.id} がひとつ前とつながっていません` };
      before = r.hash;
    }
    if (seg.head !== before) return { ok: false, reason: '先頭のハッシュが最後の行と違います' };
    if (sha256(JSON.stringify([1, seg.first, seg.last, seg.prev, seg.head, seg.rows])) !== seg.hash) return { ok: false, reason: '控え全体のハッシュが合いません' };
    const want = crypto.createHmac('sha256', key).update(seg.hash).digest('hex');
    const sigOk = typeof seg.sig === 'string' && /^[a-f0-9]{64}$/.test(seg.sig) && crypto.timingSafeEqual(Buffer.from(seg.sig), Buffer.from(want));
    return { ok: true, seg, sigOk };
  }

  async function remote() {
    const out = [];
    for (const k of (await store.list(PREFIX)).sort()) { const m = KEY_RE.exec(k); if (m) out.push({ key: k, first: Number(m[1]), last: Number(m[2]) }); }
    return out;
  }

  // ---- sealing
  function seal() {
    return exclusive(async () => {
      if (!store) return { skipped: 'no-store' };
      const s = load();
      try {
        // what was carved is still what the database has
        if (s.sealed > 0) {
          const r = q('SELECT hash FROM ops_log WHERE id = ?').get(s.sealed);
          if (!r || r.hash !== s.headRow) {
            if (!s.diverged) say('🗿', `運営ログの #${s.sealed} が、石碑に刻んだものと違います（書き換えか、データベースの巻き戻し）`);
            s.diverged = { at: clock(), id: s.sealed };
            save(s);
            return { diverged: true };
          }
        }
        const rows = [];
        let bytes = 0;
        for (const r of q('SELECT * FROM ops_log WHERE id > ? ORDER BY id LIMIT ?').all(s.sealed || 0, SEG_ROWS)) {
          bytes += r.detail.length + r.summary.length + 200;
          if (rows.length && bytes > SEG_BYTES) break;
          rows.push(r);
        }
        if (!rows.length) return { sealed: 0 };
        if (rows[0].id !== (s.sealed || 0) + 1 || rows[0].prev_hash !== (s.sealed > 0 ? s.headRow : GENESIS_HASH)) {
          s.diverged = { at: clock(), id: rows[0].id };
          save(s);
          return { diverged: true };
        }
        const { seg, bytes: body } = encode(rows, s.sealed > 0 ? s.head : SEG_GENESIS);
        const name = keyOf(seg.first, seg.last);
        await store.put(name, body);
        // read back: what the store holds is what was written (and it is the segment it should be)
        const back = await store.get(name);
        if (!back || !same(back, body)) throw new Error('書いたものを読み返すと、違っていました');
        const p = parse(back);
        if (!p.ok || !p.sigOk || p.seg.hash !== seg.hash) throw new Error('読み返した控えが正しくありません');
        const t = load();
        Object.assign(t, { sealed: seg.last, head: seg.hash, headRow: seg.head, segs: (t.segs || 0) + 1, at: clock(), failSince: 0, failText: '', diverged: null });
        save(t);
        return { sealed: rows.length, last: seg.last };
      } catch (e) {
        const t = load();
        if (!t.failSince) t.failSince = clock();
        t.failText = String((e && e.message) || e).slice(0, 200);
        save(t);
        return { failed: true, error: t.failText };
      }
    });
  }

  // ---- looking
  function check({ deep = false } = {}) {
    return exclusive(async () => {
      if (!store) return { ok: true, skipped: true, problems: [] };
      const s = load();
      const problems = [];
      let segs;
      try { segs = await remote(); } catch (e) { return finish(s, [{ id: 'store', text: `石碑の保管先を読めません（${String((e && e.message) || e).slice(0, 80)}）` }], 0, 0); }
      let expect = 1;
      for (const g of segs) {
        if (g.first > expect) problems.push({ id: `gap:${expect}`, text: `#${expect}〜#${g.first - 1} の控えがありません（消されたか、書けていません）` });
        else if (g.first < expect) problems.push({ id: `overlap:${g.first}`, text: `#${g.first} の控えが重なっています` });
        expect = Math.max(expect, g.last + 1);
      }
      const remoteLast = segs.length ? segs[segs.length - 1].last : 0;
      if ((s.sealed || 0) > remoteLast) problems.push({ id: 'cut', text: `#${s.sealed} まで刻んだはずが、石碑には #${remoteLast} までしかありません（後ろが消されています）` });
      // The explicit deep check remains available for incident investigation. Scheduled
      // checks resume from a persisted verified anchor and sample old immutable files.
      let from, to, selected;
      const anchor = s.verified;
      if (deep) {
        from = Math.min(s.deepFrom || 0, Math.max(0, segs.length - 1));
        to = Math.min(segs.length, from + DEEP_BUDGET);
        selected = new Set(Array.from({ length: to - Math.max(0, from - 1) }, (_, i) => i + Math.max(0, from - 1)));
      } else {
        const ai = anchor ? segs.findIndex(g => g.last === anchor.last && g.key === anchor.key) : -1;
        if (anchor && ai < 0) problems.push({ id: 'anchor', text: '検証済みの石碑アンカーがありません' });
        from = ai + 1; to = Math.min(segs.length, from + DEEP_BUDGET);
        selected = new Set(Array.from({ length: to - Math.max(0, ai) }, (_, i) => i + Math.max(0, ai)));
        // Partial Fisher-Yates by sparse remapping: fixed cost even with millions of files.
        const swaps = new Map();
        for (let n = Math.max(0, ai), k = 0; n > 0 && k < SAMPLE_BUDGET; n--, k++) {
          const pick = sampleIndex(n), index = swaps.get(pick) ?? pick;
          swaps.set(pick, swaps.get(n - 1) ?? n - 1);
          selected.add(index);
          if (index > 0) selected.add(index - 1); // verify the sampled join too
        }
      }
      const window = [...selected].sort((a, b) => a - b).map(i => segs[i]);
      let before = null, checkpoint = null;
      const dbMax = (q('SELECT MAX(id) AS m FROM ops_log').get() || {}).m || 0;
      for (const g of window) {
        let bytes;
        try { bytes = await store.get(g.key); } catch { bytes = null; }
        if (!bytes) { problems.push({ id: `read:${g.first}`, text: `控え #${g.first}〜#${g.last} を読めません` }); before = null; continue; }
        const p = parse(bytes);
        if (!p.ok) { problems.push({ id: `bad:${g.first}`, text: `控え #${g.first}〜#${g.last} が壊れています（${p.reason}）` }); before = null; continue; }
        if (p.seg.first !== g.first || p.seg.last !== g.last) problems.push({ id: `name:${g.first}`, text: `控えの名前と中身の範囲が違います（#${g.first}）` });
        if (!p.sigOk) problems.push({ id: `sig:${g.first}`, text: `控え #${g.first}〜#${g.last} の署名が合いません（作り直されたか、鍵が替わっています）` });
        if (before && g.first === before.last + 1 && p.seg.prev !== before.hash) problems.push({ id: `join:${g.first}`, text: `控え #${g.first} が、ひとつ前の控えとつながっていません` });
        if (!before && g.first === 1 && p.seg.prev !== SEG_GENESIS) problems.push({ id: 'join:1', text: '最初の控えの始まりが正しくありません' });
        if (!deep && anchor && g.key === anchor.key && p.seg.hash !== anchor.hash)
          problems.push({ id: 'anchor-hash', text: '検証済みアンカーの内容が変わっています' });
        if (!deep && to > from && g.key === segs[to - 1].key) checkpoint = { key: g.key, last: g.last, hash: p.seg.hash };
        // against the database
        // (every field of every row, not only its hash: a row whose text was changed under its old hash is a different row)
        const mine = new Map(q('SELECT * FROM ops_log WHERE id BETWEEN ? AND ?').all(p.seg.first, Math.min(p.seg.last, dbMax || 0)).map((r) => [r.id, JSON.stringify(toArr(r))]));
        for (const a of p.seg.rows) {
          if (a[0] > dbMax) break;
          if (mine.get(a[0]) !== JSON.stringify(a)) { problems.push({ id: `differs:${a[0]}`, text: `運営ログの #${a[0]} が、石碑の控えと違います（書き換えられた疑い）` }); break; }
        }
        before = p.seg;
      }
      if (dbMax < remoteLast) problems.push({ id: 'behind', text: `運営ログが #${dbMax} までしかありません（石碑には #${remoteLast} まであります）` });
      if (deep) {
        s.deepProblems = mergeProblems(from > 0 ? s.deepProblems : [], problems);
        if (to >= segs.length) { s.deepFrom = 0; if (!s.deepProblems.length) s.deepDone = clock(); } else s.deepFrom = to;
      }
      if (!deep && !problems.length && checkpoint) s.verified = checkpoint;
      return finish(s, problems, segs.length, remoteLast, deep && to >= segs.length);
    });
    function mergeProblems(a = [], b = []) { return [...new Map([...a, ...b].map(p => [p.id, p])).values()].slice(0, 20); }
    function finish(s, problems, segs, remoteLast, complete = false) {
      const t = load();
      if (!deep && s.verified) t.verified = s.verified;
      if (deep) {
        t.deepFrom = s.deepFrom || 0; t.deepProblems = s.deepProblems || problems;
        if (s.deepDone) t.deepDone = s.deepDone;
        problems = mergeProblems(t.deepProblems, problems);
      }
      // A clean sample/batch cannot clear damage found outside that window.
      // Only a complete clean deep cycle can dismiss previously raised findings.
      if (!(deep && complete && !problems.length)) problems = mergeProblems(t.check?.problems, problems);
      t.check = { at: clock(), ok: problems.length === 0, problems: problems.slice(0, 20), segs, remoteLast };
      save(t);
      return { ok: problems.length === 0, problems, segs, remoteLast };
    }
  }

  // ---- getting back
  function recover({ force = false } = {}) {
    return exclusive(async () => {
      if (!store) return { restored: 0, skipped: 'no-store' };
      const dbLast = q('SELECT id, hash FROM ops_log ORDER BY id DESC LIMIT 1').get() || { id: 0, hash: GENESIS_HASH };
      let segs;
      try { segs = await remote(); } catch { return { restored: 0, failed: true }; }
      const remoteLast = segs.length ? segs[segs.length - 1].last : 0;
      if (remoteLast <= dbLast.id) return { restored: 0 };
      const rows = [];
      let unsigned = false, prevSeg = null;
      for (const g of segs) {
        if (g.last <= dbLast.id) continue;
        let bytes;
        try { bytes = await store.get(g.key); } catch { bytes = null; }
        const p = bytes ? parse(bytes) : { ok: false, reason: '読めません' };
        if (!p.ok) return { restored: 0, blocked: `控え #${g.first}〜#${g.last} が使えません（${p.reason}）` };
        if (!p.sigOk) unsigned = true;
        if (prevSeg && p.seg.prev !== prevSeg.hash) return { restored: 0, blocked: `控え #${g.first} が、ひとつ前の控えとつながっていません` };
        for (const a of p.seg.rows) if (a[0] > dbLast.id) rows.push(toRow(a));
        prevSeg = p.seg;
      }
      if (!rows.length || rows[0].id !== dbLast.id + 1 || rows[0].prev_hash !== dbLast.hash) {
        return { restored: 0, blocked: `データベースの #${dbLast.id} から続く控えがありません（別の記録になっています）` };
      }
      if (unsigned && !force) return { restored: 0, blocked: '控えの署名が合いません（サーバーの鍵が替わっている可能性があります。開発者が内容を確かめて、署名を信じる復元を選んでください）' };
      const r = opsLog.keep(rows, { why: '石碑からの復元' });
      const t = load();
      const lastSeg = prevSeg;
      Object.assign(t, { sealed: lastSeg.last, head: lastSeg.hash, headRow: lastSeg.head, segs: segs.length, at: clock(), diverged: null });
      save(t);
      opsLog.add({ actorName: 'システム', action: 'log_restore', summary: `運営ログ #${rows[0].id}〜#${rows[rows.length - 1].id}（${r.added}件）を、石碑の控えから戻しました${unsigned ? '（署名は確かめられていません）' : ''}`, detail: { from: rows[0].id, to: rows[rows.length - 1].id, added: r.added, kept: r.kept, unsigned } });
      say('🗿', `運営ログ #${rows[0].id}〜#${rows[rows.length - 1].id} を石碑の控えから戻しました`);
      return { restored: r.added, kept: r.kept, unsigned };
    });
  }

  // ---- the room
  function capacity() {
    // (from the log's running account: counting every row on each look held the whole game up)
    const rows = opsLog.size();
    const bytes = dbBytes ? dbBytes() : 0;
    return { rows: rows.rows, logBytes: rows.bytes, dbBytes: bytes, limit: dbLimit, ratio: dbLimit && bytes ? bytes / dbLimit : 0 };
  }

  // ---- what is told, and what the patrol hears
  function status() {
    const s = load();
    const pending = (q('SELECT MAX(id) AS m FROM ops_log').get() || {}).m - (s.sealed || 0) || 0;
    return {
      on: !!store, sealed: s.sealed || 0, segs: s.segs || 0, pending: Math.max(0, pending), head: s.headRow || '', at: s.at || 0, failSince: s.failSince || 0, failText: s.failText || '',
      diverged: s.diverged || null, check: s.check || null, deepDone: s.deepDone || 0, witnessDay: s.witnessDay || '', capacity: capacity()
    };
  }
  function findings() {
    const st = status(), out = [];
    if (!st.on) out.push({ id: 'stele-none', level: 'low', text: '運営ログの外の控え（石碑）の保管先がありません。データベースが壊れると、ログも失われます' });
    if (st.diverged) out.push({ id: `stele-diverged:${st.diverged.id}`, level: 'high', text: `運営ログの #${st.diverged.id} が、石碑に刻んだものと違います（書き換えか、データベースの巻き戻し）` });
    if (st.failSince && clock() - st.failSince > 30 * MIN) out.push({ id: 'stele-fail', level: 'high', text: `運営ログを石碑に刻めていません（${st.failText || '原因不明'}）。いまのままでは、最新の記録が外に残りません` });
    for (const p of ((st.check && st.check.problems) || []).slice(0, 5)) out.push({ id: `stele:${p.id}`, level: 'high', text: p.text });
    const c = st.capacity;
    if (c.ratio >= 0.9) out.push({ id: 'stele-room-90', level: 'high', text: `データベースが ${Math.round(c.ratio * 100)}% 埋まっています（上限 ${Math.round(c.limit / 1024 ** 3)}GB）。運営ログは消せないので、容量の増やし方を決める必要があります` });
    else if (c.ratio >= 0.7) out.push({ id: 'stele-room-70', level: 'low', text: `データベースが ${Math.round(c.ratio * 100)}% 埋まっています（運営ログ ${c.rows}件・約${Math.round(c.logBytes / 1048576)}MB）` });
    return out;
  }

  // everything, in order: carve what is waiting, look, get back what is missing, tell the day's witness
  async function tick({ deep = null } = {}) {
    const out = { sealed: 0 };
    if (!store) return { ...out, skipped: 'no-store', capacity: capacity() };
    for (let i = 0; i < 6; i++) {
      const r = await seal();
      out.sealed += r.sealed || 0;
      if (!r.sealed) { if (r.failed) out.failed = r.error; if (r.diverged) out.diverged = true; break; }
    }
    const rec = await recover();
    if (rec.restored || rec.blocked) out.recover = rec;
    if (rec.restored) await seal();
    const s = load();
    const due = deep === true;
    out.check = await check({ deep: due });
    const t = load();
    if (t.sealed > 0 && t.witnessDay !== dayOf(clock())) {
      t.witnessDay = dayOf(clock());
      save(t);
      say('🗿', `ログの石碑 ${t.witnessDay}：#${t.sealed} まで刻みました（${t.segs}か所）・先頭 ${String(t.headRow).slice(0, 16)}…・${out.check.ok ? '異常なし' : '要確認：' + out.check.problems.length + '件'}`);
    }
    if (t.failSince && clock() - t.failSince > 30 * MIN && clock() - (t.failTold || 0) > 6 * HOUR) {
      const u = load(); u.failTold = clock(); save(u);
      say('⚠️', `運営ログを石碑に刻めていません：${t.failText || '原因不明'}（${Math.round((clock() - t.failSince) / MIN)}分前から）`);
    }
    const cap = capacity();
    const level = cap.ratio >= 0.9 ? 90 : cap.ratio >= 0.7 ? 70 : 0;
    const w = load();
    if (level && (w.roomTold || 0) !== level) { w.roomTold = level; save(w); say('📦', `データベースが ${Math.round(cap.ratio * 100)}% 埋まっています（運営ログ ${cap.rows}件）`); }
    else if (!level && w.roomTold) { w.roomTold = 0; save(w); }
    out.capacity = cap;
    return out;
  }

  // a row was added: carve it soon (and wake the housekeeping soon, on a host that sleeps between requests)
  let timer = null, woke = 0;
  function touch() {
    if (!store) return;
    if (!timer) {
      timer = setTimeout(() => { timer = null; seal().catch(() => {}); }, 15000);
      if (timer.unref) timer.unref();
    }
    if (reschedule && clock() - woke > 2 * MIN) { woke = clock(); try { reschedule(clock() + 2 * MIN); } catch { /* the housekeeping comes later all the same */ } }
  }

  // the log's rows, after `after`, as they are (for the developer's copy: server/node/admin-cli.js, the operator site's 「書き出す」)
  function archive({ after = 0, limit = 1000 } = {}) {
    const rows = q('SELECT * FROM ops_log WHERE id > ? ORDER BY id LIMIT ?').all(Math.max(0, Number(after) || 0), Math.min(2000, Math.max(1, Number(limit) || 1000)));
    const head = q('SELECT id, hash FROM ops_log ORDER BY id DESC LIMIT 1').get() || { id: 0, hash: GENESIS_HASH };
    return { rows: rows.map(toArr), cols: COLS, last: rows.length ? rows[rows.length - 1].id : after, head, more: rows.length > 0 && rows[rows.length - 1].id < head.id };
  }

  return { seal, check, recover, tick, touch, status, findings, archive, capacity, parse, remote, keyOf };
}
