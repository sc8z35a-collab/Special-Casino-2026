// The operator site's サーバー tab: what the server sees of itself, live.
// Requests answered and bytes sent each second for the last 5 minutes, and
// in all today (UTC) and this month; live connections and their messages;
// how big the database is and what its tables hold; the vault; the plan's
// allowances and this month's estimated bill; and, given a Cloudflare API
// token that can read the account's analytics (CF_ACCOUNT_ID + CF_API_TOKEN),
// Cloudflare's own figures for the month. Every operator sees it.
// The counts live in memory and are saved once a minute (one row), so a
// restart loses at most a minute of them.
import { utcDay } from './rules.js';

const WINDOW = 300;
const SAVE_MS = 60000;
const TABLES_MS = 30 * 60000;
const CF_MS = 60000;
// (an estimate in yen at this rate)
export const YEN_PER_USD = 150;
// what the plans include and what more costs (USD, Cloudflare's price list)
export const PLANS = {
  free: {
    id: 'free', name: 'Workers Free', base: 0, daily: true,
    workers: { requests: 100000, cpuMs: 10 },
    durableObjects: { requests: 100000, rowsRead: 5000000, rowsWritten: 100000, storageGb: 5 }
  },
  paid: {
    id: 'paid', name: 'Workers Paid', base: 5, daily: false,
    workers: { requests: 10e6, requestPrice: 0.30, cpuMs: 30000, cpuMsMonth: 30e6, cpuPrice: 0.02, builds: 6000 },
    durableObjects: { requests: 1e6, requestPrice: 0.15, durationGbs: 400000, durationPrice: 12.5, rowsRead: 25e9, rowReadPrice: 0.001, rowsWritten: 50e6, rowWritePrice: 1, storageGb: 5, storagePrice: 0.20, perObjectGb: 10 }
  }
};
// R2 (the vault's bucket) on either plan
export const R2 = { storageGb: 10, storagePrice: 0.015, classA: 1e6, classAPrice: 4.5, classB: 10e6, classBPrice: 0.36 };
const GB = 1073741824;
// the database's tables (log-like ones by their last row number: no full count)
const COUNTED = ['users', 'friends', 'cars', 'items', 'trees', 'chat_groups', 'reports', 'feedback', 'push_subs', 'pay_orders', 'vault_files', 'vault_folders', 'ops_messages'];
const NUMBERED = ['messages', 'transfers', 'spins', 'ops_log', 'detections'];

const month = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);

// The サーバー tab's colour for how full the month's allowances are: past
// 10% green, 30% blue, 50% purple, 70% red (at or below 10%: none).
export function usageTier(percent) {
  const p = Number(percent) || 0;
  if (p > 70) return 'red';
  if (p > 50) return 'purple';
  if (p > 30) return 'blue';
  if (p > 10) return 'green';
  return '';
}

// host: { name, dbBytes() -> number | null, sockets() -> number | null, extra() -> {} | null }
export function createStats({ db, q, config, host = {}, defer = null }) {
  const startedAt = Date.now();
  const ring = Array.from({ length: WINDOW }, () => ({ s: 0, r: 0, b: 0, i: 0, o: 0, v: 0 }));
  // bytes are also split by what they are for, for the サーバー tab's breakdown:
  // game = ordinary play and the operator site, video = the operator screen
  // view and the in-game 観戦 stream, voice = call/home-chat signalling
  const blank = (k) => ({ key: k, requests: 0, bytes: 0, wsIn: 0, wsOut: 0, r2a: 0, r2b: 0, catGame: 0, catVideo: 0, catVoice: 0 });
  const CAT_FIELD = { game: 'catGame', video: 'catVideo', voice: 'catVoice' };
  let day = blank(utcDay()), mon = blank(month()), since = startedAt, savedAt = Date.now(), dirty = false;
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'stats'").get();
    const v = row ? JSON.parse(row.value) : null;
    if (v) {
      if (v.day && v.day.key === day.key) day = { ...day, ...v.day };
      if (v.month && v.month.key === mon.key) mon = { ...mon, ...v.month };
      since = Number(v.since) || startedAt;
    }
  } catch { /* count from zero */ }

  function slot() {
    const sec = Math.floor(Date.now() / 1000);
    const x = ring[sec % WINDOW];
    if (x.s !== sec) { x.s = sec; x.r = 0; x.b = 0; x.i = 0; x.o = 0; x.v = 0; }
    return x;
  }
  function roll() {
    if (day.key !== utcDay()) day = blank(utcDay());
    if (mon.key !== month()) mon = blank(month());
  }
  function add(field, n) {
    roll();
    day[field] += n;
    mon[field] += n;
    dirty = true;
    if (Date.now() - savedAt > SAVE_MS) save();
  }
  function save() {
    if (!dirty) return;
    try {
      db.prepare("INSERT INTO meta (key, value) VALUES ('stats', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ day, month: mon, since }));
      dirty = false;
      savedAt = Date.now();
    } catch { /* again next time */ }
  }

  // the last WINDOW seconds, oldest first: [second, requests, bytes, ws in, ws out]
  function history() {
    const now = Math.floor(Date.now() / 1000), out = [];
    for (let s = now - WINDOW + 1; s <= now; s++) {
      const x = ring[((s % WINDOW) + WINDOW) % WINDOW];
      out.push(x.s === s ? [s, x.r, x.b, x.i, x.o, x.v] : [s, 0, 0, 0, 0, 0]);
    }
    return out;
  }
  function recent(h, secs) {
    const part = h.slice(-secs);
    return { requests: part.reduce((n, x) => n + x[1], 0), bytes: part.reduce((n, x) => n + x[2], 0), wsIn: part.reduce((n, x) => n + x[3], 0), wsOut: part.reduce((n, x) => n + x[4], 0), video: part.reduce((n, x) => n + (x[5] || 0), 0), seconds: secs };
  }

  let tables = null;
  function tableRows() {
    if (tables && Date.now() - tables.at < TABLES_MS) return tables;
    const rows = [];
    for (const t of COUNTED) {
      try { rows.push({ name: t, rows: q(`SELECT COUNT(*) AS n FROM ${t}`).get().n }); } catch { /* not here */ }
    }
    for (const t of NUMBERED) {
      try { rows.push({ name: t, rows: q(`SELECT COALESCE(MAX(rowid), 0) AS n FROM ${t}`).get().n, numbered: true }); } catch { /* not here */ }
    }
    tables = { at: Date.now(), rows };
    return tables;
  }

  // this month's bill, roughly (what the server counted since it began counting)
  function estimate(planId, dbBytes, bucketBytes) {
    const P = PLANS[planId];
    const lines = [];
    const over = (used, incl) => Math.max(0, used - incl);
    lines.push({ key: 'base', label: `${P.name}（月額）`, cost: P.base });
    if (planId === 'paid') {
      const W = P.workers, D = P.durableObjects;
      lines.push({ key: 'requests', label: 'Workers のリクエスト', used: mon.requests, included: W.requests, unit: '回', cost: over(mon.requests, W.requests) / 1e6 * W.requestPrice });
      // (incoming live messages are billed 20 to 1; four alarms a day)
      const doReq = mon.requests + Math.ceil(mon.wsIn / 20) + 4 * new Date().getUTCDate();
      lines.push({ key: 'do', label: 'データベース（Durable Objects）のリクエスト', used: doReq, included: D.requests, unit: '回', cost: over(doReq, D.requests) / 1e6 * D.requestPrice });
      if (dbBytes !== null) lines.push({ key: 'storage', label: 'データベースの保存量', used: dbBytes / GB, included: D.storageGb, unit: 'GB', cost: over(dbBytes / GB, D.storageGb) * D.storagePrice });
    }
    lines.push({ key: 'r2', label: 'R2（保管庫）の保存量', used: bucketBytes / GB, included: R2.storageGb, unit: 'GB', cost: over(bucketBytes / GB, R2.storageGb) * R2.storagePrice });
    lines.push({ key: 'r2a', label: 'R2 の書き込み・一覧（Class A）', used: mon.r2a, included: R2.classA, unit: '回', cost: over(mon.r2a, R2.classA) / 1e6 * R2.classAPrice });
    lines.push({ key: 'r2b', label: 'R2 の読み取り（Class B）', used: mon.r2b, included: R2.classB, unit: '回', cost: over(mon.r2b, R2.classB) / 1e6 * R2.classBPrice });
    const total = lines.reduce((s, l) => s + l.cost, 0);
    // how full the month's included allowances are: the peak share across the
    // metered resources (the サーバー tab turns this into a colour — green past
    // 10%, blue 30%, purple 50%, red 70%). The base monthly fee has no
    // allowance, so it is left out of the share.
    const shares = lines
      .filter((l) => l.included > 0 && l.used !== undefined)
      .map((l) => ({ key: l.key, label: l.label, used: l.used, included: l.included, unit: l.unit, percent: +(l.used / l.included * 100).toFixed(1) }))
      .sort((a, b) => b.percent - a.percent);
    const peak = shares[0] || null;
    const usagePercent = peak ? peak.percent : 0;
    return { lines, total, yen: Math.round(total * YEN_PER_USD), rate: YEN_PER_USD, usagePercent, usageTier: usageTier(usagePercent), usagePeak: peak, usageShares: shares };
  }

  let cf = { at: 0, data: null, busy: null };
  async function graphql(query, variables) {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.cfApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || (out.errors && out.errors.length)) {
      const why = out && out.errors && out.errors[0] ? out.errors[0].message : `HTTP ${res.status}`;
      throw new Error(why);
    }
    return out.data.viewer.accounts[0] || {};
  }
  async function fetchCloudflare() {
    const end = new Date().toISOString();
    const start = `${month()}-01T00:00:00Z`;
    const vars = { account: config.cfAccountId, start, end };
    const part = (p) => p.then((data) => ({ data }), (e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
    const [workers, r2, objects] = await Promise.all([
      part(graphql(`query ($account: string, $script: string, $start: string, $end: string) {
        viewer { accounts(filter: {accountTag: $account}) {
          workersInvocationsAdaptive(limit: 100, filter: {scriptName: $script, datetime_geq: $start, datetime_leq: $end}) {
            sum { requests errors subrequests }
            quantiles { cpuTimeP50 cpuTimeP99 }
            dimensions { scriptName }
          } } } }`, { ...vars, script: config.cfScript }).then((a) => {
        const rows = a.workersInvocationsAdaptive || [];
        const sum = (k) => rows.reduce((n, x) => n + (x.sum[k] || 0), 0);
        return { requests: sum('requests'), errors: sum('errors'), subrequests: sum('subrequests'), cpuP50: rows[0] ? rows[0].quantiles.cpuTimeP50 : null, cpuP99: rows[0] ? rows[0].quantiles.cpuTimeP99 : null };
      })),
      part(graphql(`query ($account: string, $bucket: string, $start: string, $end: string) {
        viewer { accounts(filter: {accountTag: $account}) {
          storage: r2StorageAdaptiveGroups(limit: 1, filter: {bucketName: $bucket, datetime_geq: $start, datetime_leq: $end}, orderBy: [datetime_DESC]) {
            max { objectCount payloadSize metadataSize }
            dimensions { datetime }
          }
          operations: r2OperationsAdaptiveGroups(limit: 100, filter: {bucketName: $bucket, datetime_geq: $start, datetime_leq: $end}) {
            sum { requests }
            dimensions { actionType }
          } } } }`, { ...vars, bucket: config.cfBucket }).then((a) => {
        const s = (a.storage || [])[0];
        const ops = { classA: 0, classB: 0, free: 0 };
        for (const o of a.operations || []) {
          const t = o.dimensions.actionType || '';
          if (/^(Get|Head)/.test(t)) ops.classB += o.sum.requests;
          else if (/^(Delete|Abort)/.test(t)) ops.free += o.sum.requests;
          else ops.classA += o.sum.requests;
        }
        return { objects: s ? s.max.objectCount : 0, bytes: s ? s.max.payloadSize + s.max.metadataSize : 0, ...ops };
      })),
      part(graphql(`query ($account: string, $start: string, $end: string) {
        viewer { accounts(filter: {accountTag: $account}) {
          durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: {datetime_geq: $start, datetime_leq: $end}) {
            sum { requests }
          } } } }`, vars).then((a) => ({ requests: (a.durableObjectsInvocationsAdaptiveGroups || []).reduce((n, x) => n + (x.sum.requests || 0), 0) })))
    ]);
    return { from: start, to: end, workers, r2, durableObjects: objects };
  }
  function cloudflare() {
    if (!config.cfAccountId || !config.cfApiToken) return { configured: false };
    if (Date.now() - cf.at > CF_MS && !cf.busy) {
      cf.busy = fetchCloudflare().then((data) => { cf = { at: Date.now(), data, busy: null }; }, (e) => {
        cf = { at: Date.now(), data: { error: String((e && e.message) || e).slice(0, 200) }, busy: null };
      });
      if (defer) defer(cf.busy);
    }
    return { configured: true, at: cf.at, ...(cf.data || { loading: true }) };
  }

  return {
    // one API request answered; the bytes of an answer (from the host, once written)
    request() { slot().r++; add('requests', 1); },
    sent(bytes, cat = 'game') { slot().b += bytes; add('bytes', bytes); add(CAT_FIELD[cat] || 'catGame', bytes); },
    // bytes pushed over a live connection, by what they are for (a 観戦 /
    // screen-view frame is 'video'): they count towards the month's bytes too
    pushed(bytes, cat = 'game') {
      const x = slot();
      x.b += bytes;
      if (cat === 'video') x.v += bytes;
      add('bytes', bytes);
      add(CAT_FIELD[cat] || 'catGame', bytes);
    },
    wsIn() { slot().i++; add('wsIn', 1); },
    wsOut(n = 1) { slot().o += n; add('wsOut', n); },
    r2(kind) { add(kind === 'b' ? 'r2b' : 'r2a', 1); },
    flush: save,
    // what the month's usage is made of, for a Discord warning: the share, the three biggest items,
    // where the sent bytes went and the estimated bill (cheap: no Cloudflare call)
    report(bucketBytes = 0) {
      roll();
      const planId = PLANS[config.plan] ? config.plan : 'free';
      const e = estimate(planId, host.dbBytes ? host.dbBytes() : null, bucketBytes);
      return {
        month: mon.key, percent: e.usagePercent, tier: e.usageTier, shares: e.usageShares.slice(0, 3),
        breakdown: { game: mon.catGame, video: mon.catVideo, voice: mon.catVoice }, usd: e.total, yen: e.yen
      };
    },
    // the month's share and its colour alone — cheap (no Cloudflare call), for
    // the tab bar's poll so the サーバー button shows its colour from every tab
    usage(bucketBytes = 0) {
      roll();
      const planId = PLANS[config.plan] ? config.plan : 'free';
      const e = estimate(planId, host.dbBytes ? host.dbBytes() : null, bucketBytes);
      return { percent: e.usagePercent, tier: e.usageTier };
    },
    // the サーバー tab's figures
    snapshot({ online, operatorsOnline, vault }) {
      roll();
      const h = history();
      const dbBytes = host.dbBytes ? host.dbBytes() : null;
      const planId = PLANS[config.plan] ? config.plan : 'free';
      return {
        now: Date.now(), startedAt, countingSince: since, host: host.name || 'node',
        plan: { ...PLANS[planId], r2: R2, rate: YEN_PER_USD },
        live: { online, operatorsOnline, sockets: host.sockets ? host.sockets() : null },
        rate: { last10: recent(h, 10), last60: recent(h, 60), history: h },
        today: day, month: mon,
        // where the month's sent bytes went: play + operator site, the screen
        // view / 観戦 stream, and call signalling
        breakdown: {
          month: { game: mon.catGame, video: mon.catVideo, voice: mon.catVoice, total: mon.bytes },
          today: { game: day.catGame, video: day.catVideo, voice: day.catVoice, total: day.bytes }
        },
        database: { bytes: dbBytes, ...tableRows() },
        vault,
        estimate: estimate(planId, dbBytes, vault && vault.store === 'bucket' ? vault.used : 0),
        cloudflare: cloudflare(),
        machine: host.extra ? host.extra() : null
      };
    }
  };
}
