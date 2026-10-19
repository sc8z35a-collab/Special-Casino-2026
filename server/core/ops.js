// The operator site (/ops/): the players with their money, connection,
// 引き継ぎコード, play time and devices, and the bans. Only the accounts named
// in config.operators may use it (they log in with their name and password on
// the site; the session is the game's own). Passwords are never shown: they
// are kept only as one-way hashes, so an operator sets a new one instead.
import { ApiError, posInt } from './errors.js';
import { nameKey, cleanPassword, hashPassword } from './auth.js';
import { LEVEL, RULES } from './rules.js';

export function createOps({ q, tx, live, config, getUser, mini, openCode, setRecovery, banMessage, BAN_DAYS, deviceBanOf, dropFromHub }) {
  const operators = new Set(config.operators.map(nameKey));
  const isOperator = (u) => !!u && operators.has(u.name_key);
  function need(u) {
    if (!isOperator(u)) throw new ApiError(403, 'not_operator', 'この画面は運営者だけが使えます');
  }
  const worth = (u) => u.dollars + u.tokens * RULES.tokenPrice;
  function banOf(u) {
    if (!u.banned) return null;
    if (u.ban_until && u.ban_until <= Date.now()) return null;
    return { kind: u.ban_kind || 'perma', until: u.ban_until || 0, at: u.ban_at || 0, message: banMessage(u) };
  }
  function row(u) {
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      online: live.isOnline(u.id),
      tokens: u.tokens,
      dollars: u.dollars,
      coins: u.coins,
      worth: worth(u),
      code: openCode(u.recovery_enc),
      hasPassword: !!u.password_hash,
      ban: banOf(u),
      deviceBlocked: !u.banned && !!deviceBanOf(u),
      lastSeen: u.last_seen,
      createdAt: u.created_at,
      playMs: u.play_ms,
      operator: isOperator(u),
      npc: !!u.npc
    };
  }
  // the other accounts seen on each of a player's devices
  function devicesOf(u) {
    return q('SELECT device, first_at, last_at FROM devices WHERE user_id = ? ORDER BY last_at DESC').all(u.id).map((d) => {
      const others = q(`SELECT o.id, o.name, o.banned, o.ban_kind, o.ban_until FROM devices e JOIN users o ON o.id = e.user_id
                        WHERE e.device = ? AND e.user_id != ? ORDER BY o.id`).all(d.device, u.id);
      const [kind, value] = d.device.split(':');
      return {
        kind: kind === 'id' ? 'id' : 'fp',
        label: kind === 'id' ? '端末ID ' + value.slice(0, 8) : '端末の特徴 ' + value.slice(0, 8) + (value.includes('@') ? '（' + value.split('@')[1] + '）' : ''),
        firstAt: d.first_at,
        lastAt: d.last_at,
        others: others.map((o) => ({ id: o.id, name: o.name, ban: o.banned && (!o.ban_until || o.ban_until > Date.now()) ? o.ban_kind || 'perma' : '' }))
      };
    });
  }
  function target(id) {
    const u = getUser(posInt(id, 'プレイヤー'));
    if (!u || u.npc) throw new ApiError(404, 'not_found', 'プレイヤーが見つかりません');
    return u;
  }

  const routes = {
    'GET /api/ops/me': (req, u) => {
      need(u);
      return { name: u.name, operators: config.operators, now: Date.now() };
    },

    // everyone (a name to look for: part of it), the newest players first
    'GET /api/ops/players': (req, u) => {
      need(u);
      const find = nameKey(req.query.get('q') || '');
      const rows = q(`SELECT * FROM users WHERE npc = '' ${find ? 'AND instr(name_key, ?) > 0' : ''} ORDER BY id DESC LIMIT 1000`)
        .all(...(find ? [find] : []));
      const list = rows.map(row);
      return {
        players: list,
        total: q("SELECT COUNT(*) AS n FROM users WHERE npc = ''").get().n,
        online: list.filter((p) => p.online).length,
        now: Date.now()
      };
    },

    'GET /api/ops/player': (req, u) => {
      need(u);
      const p = target(req.query.get('id'));
      const m = q('SELECT hub_id FROM hub_members WHERE user_id = ?').get(p.id);
      return {
        player: {
          ...row(p),
          level: LEVEL.of(p.xp),
          xp: p.xp,
          spins: p.spins,
          totalBet: p.total_bet,
          totalWon: p.total_won,
          biggestWin: p.biggest_win,
          dayStreak: p.day_streak,
          dayBest: p.day_best,
          loginDays: p.login_days,
          createdIp: p.created_ip,
          friends: q('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').get(p.id).n,
          hub: m ? m.hub_id : 0,
          deviceOkAt: p.device_ok_at,
          devices: devicesOf(p)
        },
        now: Date.now()
      };
    },

    // kind: 'suspend' (TWO STATE へのアクセス禁止, a week), 'ban' (30 days),
    // 'perma' (until lifted) or 'none' (lift it). A BAN or a 永久BAN also shuts
    // out the other accounts on the player's devices.
    'POST /api/ops/ban': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      const kind = String(body.kind || '');
      if (kind !== 'none' && !(kind in BAN_DAYS)) throw new ApiError(400, 'bad_kind', '処分の種類が正しくありません');
      if (p.id === u.id || isOperator(p)) throw new ApiError(400, 'operator', '運営者のアカウントには使えません');
      const now = Date.now();
      if (kind === 'none') {
        q("UPDATE users SET banned = 0, ban_kind = '', ban_until = 0 WHERE id = ?").run(p.id);
      } else {
        tx(() => {
          q('UPDATE users SET banned = 1, ban_kind = ?, ban_until = ?, ban_at = ? WHERE id = ?').run(kind, BAN_DAYS[kind] ? now + BAN_DAYS[kind] * 86400000 : 0, now, p.id);
          q('DELETE FROM sessions WHERE user_id = ?').run(p.id);
        });
        const after = getUser(p.id);
        live.send(p.id, 'kick', { code: 'banned', message: banMessage(after) });
        dropFromHub(p.id);
        if (kind !== 'suspend') {
          for (const d of devicesOf(after)) for (const o of d.others) {
            live.send(o.id, 'kick', { code: 'device_banned', message: 'この端末のほかのアカウントがBANされているため、このアカウントも利用できません' });
          }
        }
      }
      return { player: row(getUser(p.id)) };
    },

    // lets the player play past the bans of other accounts on their devices
    // (until the next BAN of one of them)
    'POST /api/ops/device-ok': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      q('UPDATE users SET device_ok_at = ? WHERE id = ?').run(Date.now(), p.id);
      return { player: row(getUser(p.id)) };
    },

    // a new 引き継ぎコード (the old one stops working)
    'POST /api/ops/recovery': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      const code = setRecovery(p.id);
      return { code, player: row(getUser(p.id)) };
    },

    // a new password for a player who forgot theirs (check who is asking first)
    'POST /api/ops/password': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      const pw = cleanPassword(body.password);
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), p.id);
      return { player: row(getUser(p.id)) };
    }
  };

  return { routes, isOperator, mini };
}
