// The operator site's ログインログ: the first time each day (Japan time) the
// developer, an operator or a 閲覧者 looks into the site, it asks them to
// press ログイン (a login with the password that day counts as the press),
// and that is written down here — once a day each — for the developer alone
// to read (GET /api/ops/entries). Not the operators' log: nobody else sees it.
import { ApiError } from './errors.js';
import { jst } from './opslog.js';

const JST = 9 * 3600000;
const PAGE = 100;
// the day in Japan, 'YYYY-MM-DD'
export const jstDay = (ms) => new Date(ms + JST).toISOString().slice(0, 10);

// a browser in a few words ('iPhone / Safari'), not the whole user agent
export function agentOf(ua) {
  const s = String(ua || '');
  const os = /iPad/.test(s) ? 'iPad' : /iPhone|iPod/.test(s) ? 'iPhone' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' / ') || '不明';
}

export function createOpsEntry({ q, getUser, see, isOperator, isDeveloper }) {
  const roleOf = (u) => (isDeveloper(u) ? 'developer' : isOperator(u) ? 'operator' : 'viewer');
  const entered = (u, now = Date.now()) => !!q('SELECT 1 AS x FROM ops_entries WHERE user_id = ? AND day = ?').get(u.id, jstDay(now));
  // today's entry (the first one of the day only)
  function record(u, req, how, now = Date.now()) {
    q('INSERT OR IGNORE INTO ops_entries (user_id, role, day, at, how, agent) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, roleOf(u), jstDay(now), now, how, agentOf(req.header('user-agent')).slice(0, 60));
  }
  const dto = (r) => {
    const p = getUser(r.user_id);
    return { id: r.id, at: r.at, jst: jst(r.at), day: r.day, role: r.role, how: r.how, agent: r.agent, user: { id: r.user_id, name: p ? p.name : '?', avatar: p ? p.avatar : '' } };
  };

  return {
    record,
    // for GET /api/ops/me: has this one pressed ログイン today
    state: (u) => ({ entered: entered(u), day: jstDay(Date.now()) }),
    routes: {
      // the day's ログイン button
      'POST /api/ops/enter': (req, u) => {
        see(u);
        record(u, req, 'button');
        return { entered: true, day: jstDay(Date.now()) };
      },
      // the ログインログ: the developer's alone (newest first, `before`: the page after)
      'GET /api/ops/entries': (req, u) => {
        see(u);
        if (!isDeveloper(u)) throw new ApiError(403, 'developer_only', 'ログインログは開発者だけが見られます');
        const before = Number(req.query.get('before')) || 0;
        const rows = before > 0
          ? q('SELECT * FROM ops_entries WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, PAGE + 1)
          : q('SELECT * FROM ops_entries ORDER BY id DESC LIMIT ?').all(PAGE + 1);
        return { entries: rows.slice(0, PAGE).map(dto), more: rows.length > PAGE, today: jstDay(Date.now()) };
      }
    }
  };
}
