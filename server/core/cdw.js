// CDW 1.0 (custom desktop window): the small windows an operator puts on the operator site's desktop (server/core/ops.js's
// people, ops/cdw.js's page). What each person may have, and where each one sits, is decided and kept HERE, not in the page:
//
//   - the catalog the page is given is cut to the caller's role on the server (a 閲覧者 is never told that the diary or the
//     operators' chat exist as windows; an operator never hears of the developer's);
//   - a layout is accepted only if every window in it is one the caller may have *now*, none is twice, none lies over another,
//     and every size is within its limits; one that is not is refused (403 for a window not theirs, with a line in the security
//     log, 400 for the rest) and nothing of it is kept;
//   - a layout read back is cut to what the caller may have now (their rights taken away, the window goes at once);
//   - the data a window shows comes from the routes that already exist, each of which asks the same of the caller (server/core/ops.js:
//     see / need, the developer's own checks): `probe` names one of them for each window, and the tests call it as each kind of person
//     and require the answer to be the one this list says, so this list cannot drift from what the routes do.
// Nothing here reads any data of the windows; it only says who may have which and where it stands.
import { ApiError } from './errors.js';

export const GRID = { cell: 24, maxCols: 160, maxRows: 90, maxItems: 12 };
const RANK = { viewer: 1, operator: 2, developer: 3 };

// role: the least a person must be ('viewer': a 閲覧者 or above; 'operator': an operator or the developer; 'developer': the developer alone)
// w, h: the size it opens at, in cells; min / max: its limits; probe: a route that serves what it shows, for the tests ('' : it shows nothing of the server's)
export const WIDGETS = [
  { id: 'server', name: 'サーバー使用量', role: 'viewer', w: 20, h: 13, min: [14, 9], max: [60, 40], probe: 'GET /api/ops/server' },
  { id: 'reports', name: '通報', role: 'viewer', w: 16, h: 12, min: [12, 8], max: [60, 50], probe: 'GET /api/ops/reports' },
  { id: 'detections', name: '検知', role: 'viewer', w: 16, h: 12, min: [12, 8], max: [60, 50], probe: 'GET /api/ops/detections' },
  { id: 'feedback', name: '報告・意見案の受信', role: 'viewer', w: 16, h: 12, min: [12, 8], max: [60, 50], probe: 'GET /api/ops/feedback' },
  { id: 'log', name: '直近のログ', role: 'viewer', w: 22, h: 11, min: [14, 8], max: [70, 40], probe: 'GET /api/ops/log' },
  { id: 'security', name: 'セキュリティー', role: 'viewer', w: 16, h: 12, min: [12, 9], max: [60, 50], probe: 'GET /api/ops/security' },
  { id: 'team', name: '運営チャット', role: 'operator', w: 18, h: 15, min: [14, 10], max: [60, 60], probe: 'GET /api/ops/team' },
  { id: 'vault', name: '保管庫', role: 'operator', w: 18, h: 13, min: [14, 9], max: [60, 50], probe: 'GET /api/vault/spaces' },
  { id: 'profile', name: '自分のプロフィール', role: 'operator', w: 14, h: 9, min: [12, 8], max: [30, 20], probe: '' },
  { id: 'diary', name: '開発者日記', role: 'developer', w: 18, h: 14, min: [14, 10], max: [60, 50], probe: 'GET /api/ops/diary' }
];
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

// the apps of the DEV APP (the developer's own; only the outside of them for now: what is there to open is told by the server so that nobody
// else is told anything about them)
export const DEV_APPS = [
  { id: 'memo', name: 'メモ帳', icon: 'devapp-memo' },
  { id: 'study', name: '勉強', icon: 'devapp-study' },
  { id: 'security', name: 'セキュリティー', icon: 'devapp-security' },
  { id: 'adam', name: 'アダム', icon: 'devapp-adam' }
];

export function createCdw({ q, ops, isDeveloper, opsLog, clock = Date.now }) {
  const roleOf = (u) => (isDeveloper(u) ? 'developer' : ops.isOperator(u) ? 'operator' : ops.isViewer(u) ? 'viewer' : '');
  const may = (role, w) => !!role && RANK[role] >= RANK[w.role];
  const catalog = (role) => WIDGETS.filter((w) => may(role, w)).map((w) => ({ id: w.id, name: w.name, w: w.w, h: w.h, min: w.min, max: w.max }));
  const num = (v) => (Number.isSafeInteger(v) ? v : NaN);

  // the layout as it may be kept: { v: 1, items: [{ id, x, y, w, h }] }; throws what is wrong with it
  function check(role, layout) {
    if (!layout || typeof layout !== 'object' || layout.v !== 1 || !Array.isArray(layout.items)) throw new ApiError(400, 'bad_layout', '配置の形が正しくありません');
    if (layout.items.length > GRID.maxItems) throw new ApiError(400, 'too_many', `窓は ${GRID.maxItems} 個までです`);
    const seen = new Set(), out = [];
    for (const it of layout.items) {
      const w = it && typeof it.id === 'string' ? BY_ID.get(it.id) : null;
      // a window that is not there for this person: not "unknown", not "refused" in words that say it exists
      if (!w || !may(role, w)) throw Object.assign(new ApiError(403, 'not_allowed', 'この窓は置けません'), { cdwDenied: it && typeof it.id === 'string' ? it.id.slice(0, 40) : '?' });
      if (seen.has(w.id)) throw new ApiError(400, 'twice', '同じ窓は1つまでです');
      seen.add(w.id);
      const x = num(it.x), y = num(it.y), ww = num(it.w), hh = num(it.h);
      if (![x, y, ww, hh].every((n) => n === n)) throw new ApiError(400, 'bad_layout', '場所か大きさが正しくありません');
      if (x < 0 || y < 0 || ww < w.min[0] || hh < w.min[1] || ww > w.max[0] || hh > w.max[1] || x + ww > GRID.maxCols || y + hh > GRID.maxRows) throw new ApiError(400, 'bad_size', '窓の場所か大きさが範囲の外です');
      out.push({ id: w.id, x, y, w: ww, h: hh });
    }
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) throw new ApiError(400, 'overlap', '窓どうしが重なっています');
      }
    }
    return { v: 1, items: out };
  }
  // what is kept, cut to what this person may have now (a stored layout that no longer holds is dropped window by window)
  function stored(u, role) {
    const row = q('SELECT layout FROM ops_cdw WHERE user_id = ?').get(u.id);
    let layout = { v: 1, items: [] };
    try { layout = JSON.parse(row.layout); } catch { /* none, or damaged: an empty desktop */ }
    const items = (Array.isArray(layout.items) ? layout.items : []).filter((it) => it && BY_ID.has(it.id) && may(role, BY_ID.get(it.id)));
    try { return check(role, { v: 1, items }); } catch { return { v: 1, items: [] }; }
  }

  const routes = {
    'GET /api/ops/cdw': (req, u) => {
      ops.see(u);
      const role = roleOf(u);
      return { role, grid: GRID, catalog: catalog(role), layout: stored(u, role) };
    },
    'POST /api/ops/cdw': async (req, u) => {
      ops.see(u);
      const role = roleOf(u);
      const body = await req.json(16 * 1024);
      let layout;
      try { layout = check(role, body.layout); } catch (e) {
        // a window that is not theirs asked for (the page never offers one: this is a hand-made request)
        if (e.cdwDenied) opsLog.add({ actor: u, action: 'sec_cdw_denied', req, summary: `${u.name}が、置けない窓（${e.cdwDenied}）を置こうとしました`, detail: { window: e.cdwDenied, role } });
        throw e;
      }
      q('INSERT INTO ops_cdw (user_id, layout, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at')
        .run(u.id, JSON.stringify(layout), clock());
      return { layout };
    },
    // the DEV APP: the developer's alone. Anyone else gets what a route that does not exist gets.
    'GET /api/ops/devapp': (req, u) => {
      ops.need(u);
      if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      return { apps: DEV_APPS.map((a) => ({ ...a, state: 'soon' })) };
    }
  };
  return { routes, catalog, roleOf };
}
