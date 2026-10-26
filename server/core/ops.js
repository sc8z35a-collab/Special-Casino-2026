// The operator site (/ops/): the players with their money, connection,
// 引き継ぎコード, play time, age check and devices, and the bans; the
// conversations with the official bot (Ice Smoker公式: messages written
// from a polite template, money, 返信待ち), the reports (通報: accepted with a
// reward from the bot, or declined), what the chat filter found (検知), the
// 報告 / 意見案 players sent (an adopted 意見案 earns $100,000 from the bot),
// and the operators' log. The operators: the developer (config.developer,
// TAKU) and the accounts named in config.operators, plus those given operator
// rights on the site and less those whose rights were taken away, both with
// the developer code (server/core/devcode.js); one whose rights go is logged
// out everywhere at once. They log in with their name and password on the
// site (the session is the game's own). Passwords are never shown: they are
// kept only as one-way hashes, so an operator sets a new one.
// Everything an operator does here that reaches anyone is written to the log
// (server/core/opslog.js), with the request it came from.
// プレイヤーアーカイブ: a player under a 永久BAN, or whose account the
// developer deleted, leaves the list for the archive, and 90 days later their
// data goes, but not what was said: conversations and logs are kept for good
// (server/core/purge.js). A 永久BAN can be lifted (the player
// comes back to the list); a deleted account never comes back, not even by
// the developer. Only the developer sees the button that deletes one, and it
// asks for the developer code; the accounts on the same device go with it.
// A player whose chat the automatic filter stopped (server/core/attach.js)
// carries a badge until an operator lets it go again.
// 閲覧者 (viewers): players the developer — and only the developer, with the
// developer code, as for every right — lets look at the operator site and
// security HOME, read-only and nothing more: no players' list, no archive,
// no vault, no chats (the operators' and Ice Smoker公式's), no backups, no
// payments, and no action of any kind. Their site session is a 'view' one
// that the API lets through only to an allowlist of reads (server/core/api.js:
// VIEW_ONLY), and what they read leaves out the requests' addresses and the
// log's details. Taken away, their site sessions end at once (the site
// checks every 2 seconds and logs out).
import { ApiError, posInt } from './errors.js';
import { nameKey, cleanPassword, cleanText, hashPassword } from './auth.js';
import { LEVEL, RULES, VIP, RELEASE } from './rules.js';
import { jst } from './opslog.js';
import { createDevCode } from './devcode.js';
import { purgePlayer, KEPT_ROWS } from './purge.js';
import { hashOf } from './hash.js';

export const ARCHIVE_DAYS = 90;
export const DELETED = 'このアカウントは削除されました';

const REWARDS = [600000, 1200000, 2400000];
// an adopted 意見案: spin tokens
const IDEA_REWARD = RULES.idea.reward;
const MONEY_MAX = 10000000;
// 送信の取り消し of the bot's words: within the hour (RULES.retract)
const RETRACT_MS = RULES.retract.minutes * 60000;
const fmt = (n) => Number(n).toLocaleString('en-US');
// how often the operator site and security HOME refresh: one setting for
// everyone, chosen by the developer only (極めて高い … 極めて遅い)
export const SPEEDS = ['max', 'high', 'normal', 'slow', 'slowest'];
const SPEED_NAMES = { max: '極めて高い', high: '高い', normal: '通常', slow: '遅い', slowest: '極めて遅い' };

export function createOps({ q, tx, live, config, getUser, mini, openCode, setRecovery, banMessage, BAN_DAYS, deviceBanOf, deviceBans, dropFromHub, official, opsLog, balance,
  banState, tellBanned, liftBan, DEVICE_BANNED, isDeveloper, devCode = createDevCode({ q, opsLog }), seen = new Map(), pins }) {
  const operators = new Set(config.operators.map(nameKey));
  const accessRow = (key) => q('SELECT * FROM ops_access WHERE name_key = ?').get(key);
  // the refresh speed the developer chose (通常 until then)
  function speedNow() {
    const r = q("SELECT value FROM meta WHERE key = 'ops_speed'").get();
    return r && SPEEDS.includes(r.value) ? r.value : 'normal';
  }
  // the tabs' numbers the players' list does not carry on its own: the archive's, and (the developer's) the operators asking for more room in
  // the shared vaults
  const archivedCount = () => q("SELECT COUNT(*) AS n FROM users WHERE npc = '' AND archived_at > 0 AND purged_at = 0").get().n;
  const vaultRequestsOpen = () => q("SELECT COUNT(*) AS n FROM vault_requests WHERE status = 'open'").get().n;
  // an operator: the developer always; otherwise as given or taken away on
  // the site, or as named in config.operators
  // (`access`: ops_access by name_key, looked up once for a whole list)
  function isOperator(u, access = null) {
    if (!u || u.npc) return false;
    if (isDeveloper(u)) return true;
    const r = access ? access.get(u.name_key) : accessRow(u.name_key);
    // (the name carries the rights; only the account bound to the name may use them: server/core/staffpin.js)
    return (r ? r.granted === 1 : operators.has(u.name_key)) && pins.holds(u);
  }
  // 閲覧者: one the developer let look (never an operator: they see all anyway)
  const viewerRow = (id) => q('SELECT * FROM ops_viewers WHERE user_id = ?').get(id);
  function isViewer(u) {
    if (!u || u.npc || isOperator(u)) return false;
    const r = viewerRow(u.id);
    return !!r && r.granted === 1;
  }
  // an operator, or a viewer (the reads they may do)
  function see(u) {
    if (isViewer(u)) return u;
    need(u);
    return u;
  }
  function viewerList() {
    return q('SELECT v.*, u.name, u.avatar FROM ops_viewers v JOIN users u ON u.id = v.user_id WHERE v.granted = 1 ORDER BY v.at DESC').all()
      .map((v) => ({ id: v.user_id, name: v.name, avatar: v.avatar, at: v.at, by: (getUser(v.by_id) || { name: '?' }).name, online: live.isOnline(v.user_id), site: Date.now() - (seen.get(v.user_id) || 0) < 40000 }));
  }
  // the log as a viewer reads it: what happened, by whom, to whom (no request, no details)
  const viewerEntry = (e) => ({ id: e.id, at: e.at, jst: e.jst, actor: e.actor, action: e.action, kind: e.kind, target: e.target, summary: e.summary, prevHash: e.prevHash, hash: e.hash });
  // (`seen`: when each operator last used the site, for who is on it now)
  function need(u) {
    if (isOperator(u)) { seen.set(u.id, Date.now()); return; }
    const r = u && accessRow(u.name_key);
    if (r && !r.granted) throw new ApiError(403, 'not_operator', '運営権が剥奪されたため、運営サイトは使えません');
    throw new ApiError(403, 'not_operator', 'この画面は運営者だけが使えます');
  }
  // the operators, and the accounts whose rights were taken away
  function operatorList() {
    const keys = new Set([...operators, ...q('SELECT name_key FROM ops_access').all().map((r) => r.name_key)]);
    return [...keys].map((key) => {
      const p = q('SELECT * FROM users WHERE name_key = ?').get(key);
      const r = accessRow(key);
      const by = r && getUser(r.by_id);
      const developer = !!p && isDeveloper(p);
      const named = r ? r.granted === 1 : operators.has(key);
      // (the name is in use by another account than the one its rights were bound to)
      const reused = !!p && named && !developer && pins.peek(p) === 'other';
      // on the site now (seen in the last 40 seconds), and when last online anywhere
      const site = p ? seen.get(p.id) || 0 : 0;
      return {
        key, name: p ? p.name : key, id: p ? p.id : 0, avatar: p ? p.avatar : '', registered: !!p, online: p ? live.isOnline(p.id) : false,
        site: Date.now() - site < 40000, seenAt: p ? Math.max(site, p.last_seen) : 0,
        developer, operator: developer || (named && !reused), reused, fromSettings: operators.has(key),
        mfaMode: p ? q('SELECT mode FROM ops_mfa WHERE user_id = ?').get(p.id)?.mode || 0 : 0,
        changed: r ? { granted: r.granted === 1, at: r.at, by: by ? by.name : '' } : null
      };
    }).sort((a, b) => (b.developer - a.developer) || (b.operator - a.operator) || a.name.localeCompare(b.name));
  }
  const worth = (u) => u.dollars + u.tokens * RULES.tokenPrice;
  function banOf(u) {
    if (!u.banned) return null;
    if (u.ban_until && u.ban_until <= Date.now()) return null;
    return { kind: u.ban_kind || 'perma', until: u.ban_until || 0, at: u.ban_at || 0, message: banMessage(u) };
  }
  const flagged = () => {
    const m = new Map();
    for (const r of q('SELECT sender_id, COUNT(*) AS n FROM detections WHERE reviewed_at = 0 GROUP BY sender_id').all()) m.set(r.sender_id, r.n);
    return m;
  };
  // the 引き継ぎコード, opened once for each sealed value (a list opens hundreds)
  const codes = new Map();
  function codeOf(sealed) {
    if (!sealed) return '';
    let c = codes.get(sealed);
    if (c === undefined) {
      if (codes.size >= 5000) codes.clear();
      c = openCode(sealed);
      codes.set(sealed, c);
    }
    return c;
  }
  // What the players' list of each operator page showed last, as a short hash of every row: the next request with `since` is answered with the
  // rows whose hash is not the same, and the ids that are no more. Each page has a list of its own (its token is `<page>.<n>`: two tabs of one
  // login do not take the other's answers from each other), and a login's pages are the only ones that may use theirs. The newest at the end.
  const listsSent = new Map();
  const LISTS_MAX = 64;
  function playersSince(u, find, since, list) {
    const key = u.tokenHash || `u${u.id}`;
    const now = new Map(list.map((p) => [p.id, hashOf(JSON.stringify(p))]));
    const [given, count] = String(since || '').split('.');
    const had = listsSent.get(given);
    // a page of this login that is known here, and the answer it holds the last one given to it (for this search)
    const mine = !!had && had.key === key;
    const sid = mine ? given : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const n = mine ? had.n + 1 : 1;
    const token = `${sid}.${n}`;
    const current = mine && had.find === find && String(had.n) === count;
    const before = current ? had.hashes : null;
    listsSent.delete(sid);
    listsSent.set(sid, { key, n, find, hashes: now });
    while (listsSent.size > LISTS_MAX) listsSent.delete(listsSent.keys().next().value);
    if (!before) return { full: true, token, players: list };
    return {
      delta: true, token,
      players: list.filter((p) => before.get(p.id) !== now.get(p.id)),
      gone: [...before.keys()].filter((id) => !now.has(id))
    };
  }
  // what a whole list needs for every row, looked up once and not once a player
  const listFacts = () => ({
    access: new Map(q('SELECT * FROM ops_access').all().map((r) => [r.name_key, r])), devBans: deviceBans(),
    viewers: new Set(q('SELECT user_id FROM ops_viewers WHERE granted = 1').all().map((r) => r.user_id))
  });
  function row(u, waiting = null, detections = null, facts = null) {
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      online: live.isOnline(u.id),
      tokens: u.tokens,
      dollars: u.dollars,
      coins: u.coins,
      worth: worth(u),
      code: codeOf(u.recovery_enc),
      hasPassword: !!u.password_hash,
      ban: banOf(u),
      deviceBlocked: !u.banned && (facts ? !isDeveloper(u) && (facts.devBans.get(u.id) || 0) > u.device_ok_at : !!deviceBanOf(u)),
      lastSeen: u.last_seen,
      createdAt: u.created_at,
      playMs: u.play_ms,
      operator: isOperator(u, facts && facts.access),
      viewer: facts ? !!facts.viewers.has(u.id) : isViewer(u),
      developer: isDeveloper(u),
      npc: !!u.npc,
      // VIP: its level while it is on (null: off), until when, its EXP
      vip: VIP.current(u.vip_until, u.vip_exp, u.vip_trial_until || 0, Date.now()),
      vipUntil: u.vip_until || 0,
      vipExp: u.vip_exp || 0,
      // 18歳以上？ (null: not answered)
      age: u.age_ok === null || u.age_ok === undefined ? null : !!u.age_ok,
      ageAt: u.age_at || 0,
      // 返信待ち: their message to the official bot has no answer yet
      waiting: waiting ? waiting.has(u.id) : official.waiting(u.id),
      // 検知: what the chat filter found and nobody looked at yet
      detections: detections ? detections.get(u.id) || 0 : q('SELECT COUNT(*) AS n FROM detections WHERE sender_id = ? AND reviewed_at = 0').get(u.id).n,
      // in the プレイヤーアーカイブ: why ('perma' or 'deleted'), since when, and when all of it goes
      archive: u.archived_at ? { reason: u.archive_reason, at: u.archived_at, purgeAt: u.purge_at, with: u.archive_with || 0 } : null,
      deleted: u.ban_kind === 'deleted',
      // the chat stopped by the automatic filter: since when, and why
      chatBan: u.chat_ban ? { at: u.chat_ban, why: u.chat_ban_why } : null
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
  // a player who can still be acted on (not a deleted account)
  function alive(id) {
    const u = target(id);
    if (u.ban_kind === 'deleted') throw new ApiError(409, 'deleted', `${u.name}さんのアカウントは削除されています（取り消せません）`);
    return u;
  }
  // the accounts sharing a device (its id) with a player: they go with it
  // (never the developer's, an operator's, or one already deleted)
  function sameDevice(u) {
    return q(`SELECT DISTINCT o.* FROM devices d JOIN devices e ON e.device = d.device AND e.user_id != d.user_id JOIN users o ON o.id = e.user_id
              WHERE d.user_id = ? AND substr(d.device, 1, 3) = 'id:' AND o.npc = '' AND o.ban_kind != 'deleted' ORDER BY o.id`).all(u.id)
      .filter((o) => !isDeveloper(o) && !isOperator(o));
  }
  const archived = (u, reason, now, withId = 0) => q('UPDATE users SET archived_at = ?, archive_reason = ?, purge_at = ?, archive_with = ? WHERE id = ?')
    .run(now, reason, now + ARCHIVE_DAYS * 86400000, withId, u.id);
  const brief = (u) => (u ? { id: u.id, name: u.name, avatar: u.avatar } : null);
  const BAN_NAMES = { suspend: 'アクセス禁止（1週間）', ban: 'BAN（1か月）', perma: '永久BAN', none: '処分の解除' };
  const KIND_NAMES = Object.fromEntries(RULES.reportKinds.map((k) => [k.id, k.name]));
  const shortTime = (ms) => jst(ms).slice(0, 16);

  // opening the site is noted now and then (once in 30 minutes per operator)
  const opened = new Map();

  function reportDto(r) {
    let context = {};
    try { context = JSON.parse(r.context); } catch { /* left empty */ }
    return {
      id: r.id, kind: r.kind, kindName: KIND_NAMES[r.kind] || r.kind, text: r.body, place: r.place, messageId: r.message_id || 0, context, status: r.status, reward: r.reward,
      reporter: brief(getUser(r.reporter_id)), target: brief(getUser(r.target_id)), handledBy: brief(getUser(r.handled_by)), handledAt: r.handled_at, at: r.created_at
    };
  }
  function detectionDto(d) {
    let words = [];
    try { words = JSON.parse(d.words); } catch { /* none */ }
    return {
      id: d.id, sender: brief(getUser(d.sender_id)), recipient: brief(getUser(d.recipient_id)), group: d.group_id, place: d.place,
      original: d.original, masked: d.masked, words, messageId: d.message_id, reviewedAt: d.reviewed_at, at: d.created_at
    };
  }

  const routes = {
    'GET /api/ops/me': (req, u) => {
      see(u);
      const viewer = !isOperator(u);
      if (!opened.has(u.id) || Date.now() - opened.get(u.id) > 30 * 60000) {
        opened.set(u.id, Date.now());
        opsLog.add({ actor: u, action: 'open', summary: `${u.name}が運営サイトを開いた${viewer ? '（閲覧者）' : ''}`, req });
      }
      if (viewer) return { name: u.name, viewer: true, developer: false, weakPassword: u.pwWeak || '', speed: speedNow(), now: Date.now() };
      return { name: u.name, operators: config.operators, developer: isDeveloper(u), viewer: false, devCodeSet: devCode.isSet(), weakPassword: u.pwWeak || '', speed: speedNow(), now: Date.now() };
    },

    // the refresh speed of the operator site and security HOME (the developer only)
    'POST /api/ops/speed': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '更新頻度は開発者だけが変えられます');
      const body = await req.json();
      const v = String(body.speed || '');
      if (!SPEEDS.includes(v)) throw new ApiError(400, 'bad_speed', '更新頻度を選んでください');
      const was = speedNow();
      if (v !== was) {
        q("INSERT INTO meta (key, value) VALUES ('ops_speed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
        opsLog.add({ actor: u, action: 'ops_speed', req, summary: `${u.name}が運営サイトの更新頻度を「${SPEED_NAMES[was]}」から「${SPEED_NAMES[v]}」に変更`, detail: { from: was, to: v } });
      }
      return { speed: v };
    },

    // still allowed in (the site asks every 2 seconds for a viewer: rights
    // taken away, it logs out at once)
    'GET /api/ops/alive': (req, u) => {
      see(u);
      return { ok: true, viewer: !isOperator(u), now: Date.now() };
    },

    // what waits in each tab (a viewer has no players' list to bring them)
    'GET /api/ops/counts': (req, u) => {
      see(u);
      return {
        reports: q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
        detections: q('SELECT COUNT(*) AS n FROM detections WHERE reviewed_at = 0').get().n,
        feedback: q("SELECT COUNT(*) AS n FROM feedback WHERE handled_at = 0 AND kind != ''").get().n,
        speed: speedNow()
      };
    },

    // everyone but the archive (a name to look for: part of it), the newest players first.
    // `since`: the page says what it was given the last time (empty the first time) and is answered with what changed since —
    // `{ delta: true, token, players: [the new and the changed], gone: [ids] }` — instead of the whole list again (a list of hundreds,
    // every few seconds, for as long as the site stays open); a token this server does not hold (it was restarted, another search,
    // another page) gets the whole list and a new token (`full: true`). Without `since` it answers as it always did.
    // `lean=1`: only the list and its own figures (the tabs' numbers come with the page's poll: GET /api/ops/tick).
    'GET /api/ops/players': (req, u) => {
      need(u);
      const find = nameKey(req.query.get('q') || '');
      const rows = q(`SELECT * FROM users WHERE npc = '' AND archived_at = 0 ${find ? 'AND instr(name_key, ?) > 0' : ''} ORDER BY id DESC LIMIT 1000`)
        .all(...(find ? [find] : []));
      const waiting = official.waitingIds(), dets = flagged(), facts = listFacts();
      const list = rows.map((p) => row(p, waiting, dets, facts));
      const since = req.query.get('since');
      const sync = since === null ? null : playersSince(u, find, since, list);
      const out = {
        ...(sync || { players: list }),
        // (everyone, whatever was looked for: the list is all of them when it is short and nothing was looked for)
        total: !find && rows.length < 1000 ? rows.length : q("SELECT COUNT(*) AS n FROM users WHERE npc = '' AND archived_at = 0").get().n,
        online: list.filter((p) => p.online).length,
        waiting: waiting.size,
        now: Date.now()
      };
      if (req.query.get('lean') === '1') return out;
      return {
        ...out,
        archived: archivedCount(),
        reports: q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
        detections: q('SELECT COUNT(*) AS n FROM detections WHERE reviewed_at = 0').get().n,
        feedback: q("SELECT COUNT(*) AS n FROM feedback WHERE handled_at = 0 AND kind != ''").get().n,
        // (the developer: operators asking for more room in their shared vaults)
        vaultRequests: isDeveloper(u) ? vaultRequestsOpen() : 0,
        // (the developer's choice reaches every operator's site)
        speed: speedNow()
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
          devices: devicesOf(p),
          reportsAgainst: q('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?').get(p.id).n,
          reportsBy: q('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?').get(p.id).n,
          // the release their game last said it runs (RELEASE: the newest), on what, and when
          client: { release: p.client_release, build: p.client_build, agent: p.client_agent, at: p.client_at, newest: RELEASE }
        },
        now: Date.now()
      };
    },

    // kind: 'suspend' (TWO STATE へのアクセス禁止, a week), 'ban' (30 days),
    // 'perma' (until lifted) or 'none' (lift it). A BAN or a 永久BAN also shuts
    // out the other accounts on the player's devices. The player's game goes
    // back to the title screen at once and stays there (js/ui/banlock.js); the
    // official bot tells them when, and again when it is lifted.
    'POST /api/ops/ban': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = alive(body.id);
      const kind = String(body.kind || '');
      if (kind !== 'none' && !(kind in BAN_DAYS)) throw new ApiError(400, 'bad_kind', '処分の種類が正しくありません');
      if (isDeveloper(p)) throw new ApiError(400, 'operator', '開発者のアカウントは処分できません');
      if (p.id === u.id || isOperator(p)) throw new ApiError(400, 'operator', '運営者のアカウントには使えません');
      const now = Date.now();
      const before = banOf(p);
      const shut = [];
      if (kind === 'none') {
        if (before) liftBan(p, 'lifted');
        else q("UPDATE users SET banned = 0, ban_kind = '', ban_until = 0 WHERE id = ?").run(p.id);
        // (back from the archive)
        q("UPDATE users SET archived_at = 0, archive_reason = '', purge_at = 0, archive_with = 0 WHERE id = ? AND archive_reason = 'perma'").run(p.id);
      } else {
        q('UPDATE users SET banned = 1, ban_kind = ?, ban_until = ?, ban_at = ? WHERE id = ?').run(kind, BAN_DAYS[kind] ? now + BAN_DAYS[kind] * 86400000 : 0, now, p.id);
        // 永久BAN: to the archive (90 days); a shorter one takes it out of there
        if (kind === 'perma') archived(p, 'perma', now);
        else q("UPDATE users SET archived_at = 0, archive_reason = '', purge_at = 0, archive_with = 0 WHERE id = ? AND archive_reason = 'perma'").run(p.id);
        const after = getUser(p.id);
        live.send(p.id, 'kick', { code: 'banned', message: banMessage(after), ban: banState(after) });
        dropFromHub(p.id);
        tellBanned(after);
        if (kind !== 'suspend') {
          for (const d of devicesOf(after)) for (const o of d.others) {
            shut.push({ id: o.id, name: o.name, device: d.label });
            live.send(o.id, 'kick', { code: 'device_banned', message: DEVICE_BANNED, ban: { code: 'device_banned', message: DEVICE_BANNED } });
          }
        }
      }
      const after = getUser(p.id);
      opsLog.add({
        actor: u, action: 'ban:' + kind, target: p, req,
        summary: `${p.name}さんに「${BAN_NAMES[kind]}」${kind === 'perma' ? `（プレイヤーアーカイブへ・${ARCHIVE_DAYS}日後にデータを削除・会話とログは保存）` : before && before.kind === 'perma' ? '（プレイヤーアーカイブから戻した）' : ''}`,
        detail: {
          kind, before, after: banOf(after), until: after.ban_until ? { ms: after.ban_until, jst: jst(after.ban_until) } : null, message: kind === 'none' ? '' : banMessage(after), sameDeviceAccounts: shut,
          archive: after.archived_at ? { at: after.archived_at, purgeAt: after.purge_at, purgeJst: jst(after.purge_at) } : null
        }
      });
      return { player: row(after) };
    },

    /* ----- プレイヤーアーカイブ ----- */

    'GET /api/ops/archive': (req, u) => {
      need(u);
      const rows = q("SELECT * FROM users WHERE npc = '' AND archived_at > 0 AND purged_at = 0 ORDER BY archived_at DESC LIMIT 1000").all();
      return { players: rows.map((p) => ({ ...row(p), withName: p.archive_with ? (getUser(p.archive_with) || { name: '?' }).name : '' })), days: ARCHIVE_DAYS, now: Date.now() };
    },

    // the developer only: who would go (the player and the accounts on the same device)
    'GET /api/ops/delete-account': (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      const p = alive(req.query.get('id'));
      return { player: row(p), sameDevice: sameDevice(p).map((o) => row(o)), days: ARCHIVE_DAYS };
    },

    // The developer deletes an account, with the developer code: it can never
    // come back. The player and the accounts on the same device are logged
    // out at once and go to the archive; 90 days later their data goes.
    'POST /api/ops/delete-account': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      const body = await req.json();
      const p = alive(body.id);
      if (isDeveloper(p) || isOperator(p)) throw new ApiError(400, 'operator', '運営者のアカウントは削除できません（先に運営権を剥奪してください）');
      await devCode.check(body.code, req, u);
      const subs = sameDevice(p);
      const now = Date.now();
      const all = [p, ...subs];
      tx(() => {
        for (const x of all) {
          q("UPDATE users SET banned = 1, ban_kind = 'deleted', ban_until = 0, ban_at = ? WHERE id = ?").run(now, x.id);
          archived(x, 'deleted', now, x.id === p.id ? 0 : p.id);
          q('DELETE FROM sessions WHERE user_id = ?').run(x.id);
        }
      });
      for (const x of all) {
        live.send(x.id, 'kick', { code: 'deleted', message: DELETED, ban: { code: 'banned', kind: 'deleted', message: DELETED } });
        dropFromHub(x.id);
      }
      opsLog.add({
        actor: u, action: 'account_delete', target: p, req,
        summary: `${p.name}さんのアカウントを削除（開発者コードで・取り消し不可${subs.length ? `・同じ端末の ${subs.map((x) => x.name).join('、')} さんも` : ''}・${ARCHIVE_DAYS}日後にデータを削除・会話とログは保存）`,
        detail: { player: { id: p.id, name: p.name }, sameDevice: subs.map((x) => ({ id: x.id, name: x.name })), purgeAt: { ms: now + ARCHIVE_DAYS * 86400000, jst: jst(now + ARCHIVE_DAYS * 86400000) } }
      });
      return { deleted: all.map((x) => ({ id: x.id, name: x.name })), player: row(getUser(p.id)) };
    },

    // lets the player play past the bans of other accounts on their devices
    // (until the next BAN of one of them)
    'POST /api/ops/device-ok': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = alive(body.id);
      q('UPDATE users SET device_ok_at = ? WHERE id = ?').run(Date.now(), p.id);
      opsLog.add({ actor: u, action: 'device_ok', target: p, req, summary: `${p.name}さんの端末の利用を許可`, detail: { devices: devicesOf(p) } });
      return { player: row(getUser(p.id)) };
    },

    // a new 引き継ぎコード (the old one stops working)
    'POST /api/ops/recovery': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = alive(body.id);
      const old = openCode(p.recovery_enc);
      const code = setRecovery(p.id);
      opsLog.add({ actor: u, action: 'recovery', target: p, req, summary: `${p.name}さんの引き継ぎコードを再発行`, detail: { oldCodeStart: old ? old.slice(0, 4) + '…' : '', newCodeStart: code.slice(0, 4) + '…' } });
      return { code, player: row(getUser(p.id)) };
    },

    // a new password for a player who forgot theirs (check who is asking first)
    'POST /api/ops/password': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = alive(body.id);
      const pw = cleanPassword(body.password);
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), p.id);
      opsLog.add({ actor: u, action: 'password', target: p, req, summary: `${p.name}さんのパスワードを再設定`, detail: { hadPassword: !!p.password_hash, length: pw.length } });
      return { player: row(getUser(p.id)) };
    },

    /* ----- the official bot's conversations ----- */

    // a player's conversation with the bot; looking at it marks their messages read (既読)
    'GET /api/ops/chat': (req, u) => {
      need(u);
      const p = target(req.query.get('id'));
      const waitingBefore = official.waiting(p.id);
      const upto = official.markRead(p.id);
      const c = official.conversation(p.id);
      if (upto && c.messages.some((m) => m.from && m.from.id === p.id)) {
        opsLog.add({ actor: u, action: 'bot_read', target: p, req, summary: `${p.name}さんとの公式チャットを開いた（既読をつけた）`, detail: { readUpTo: upto, waiting: waitingBefore } });
      }
      return { player: row(getUser(p.id)), bot: official.me(), ...c, now: Date.now() };
    },

    // a message from the operators (件名, 〇〇様, the matter, Ice Smoker公式より)
    'POST /api/ops/chat': async (req, u) => {
      need(u);
      const body = await req.json(1024 * 1024);
      const p = alive(body.id);
      const subject = cleanText(body.subject, 100);
      const text = cleanText(body.body, 20000);
      const full = `【${subject}】\n\n${p.name}様\n\n${text}\n\nIce Smoker公式より`;
      const message = official.say(p.id, full);
      official.answered(p.id);
      opsLog.add({ actor: u, action: 'bot_message', target: p, req, summary: `${p.name}さんへ公式からメッセージ「${subject}」`, detail: { subject, body: text, sent: full, messageId: message.id } });
      return { message, player: row(getUser(p.id)) };
    },

    // 送信の取り消し of the bot's words, within the hour (money never comes back);
    // the player's chat loses it, the site and the log keep what it said
    'POST /api/ops/chat/retract': async (req, u) => {
      need(u);
      const body = await req.json();
      const m = q('SELECT * FROM messages WHERE id = ?').get(posInt(body.message, 'メッセージ'));
      if (!m || m.sender_id !== official.id()) throw new ApiError(404, 'not_found', 'このメッセージは取り消せません');
      if (m.kind !== 'text') throw new ApiError(409, 'not_text', '送金は取り消せません');
      if (m.retracted_at) throw new ApiError(409, 'retracted', 'このメッセージはもう取り消しています');
      const now = Date.now();
      if (now - m.created_at > RETRACT_MS) throw new ApiError(409, 'too_late', '送ってから1時間を過ぎたメッセージは取り消せません');
      q('UPDATE messages SET retracted_at = ? WHERE id = ? AND retracted_at = 0').run(now, m.id);
      live.send(m.recipient_id, 'retract', { id: m.id, channel: m.channel, at: now });
      const p = getUser(m.recipient_id);
      opsLog.add({ actor: u, action: 'bot_retract', target: p, req, summary: `${p ? p.name : '?'}さんへの公式メッセージを取り消した`, detail: { messageId: m.id, text: m.body, sentAt: m.created_at } });
      return { id: m.id, retracted: now };
    },

    // money from the operators ($0〜1000万), with a note if written
    'POST /api/ops/money': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = alive(body.id);
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 0 || amount > MONEY_MAX) throw new ApiError(400, 'bad_amount', `金額は $0〜${fmt(MONEY_MAX)} で選んでください`);
      const note = String(body.note ?? '').trim() ? cleanText(body.note, 2000) : '';
      const message = amount > 0 ? official.pay(p.id, amount) : null;
      const noteMsg = note ? official.say(p.id, note) : null;
      if (noteMsg) official.answered(p.id);
      opsLog.add({
        actor: u, action: 'money', target: p, req, summary: `${p.name}さんへ公式から $${fmt(amount)} を送金（タップで受け取り）`,
        detail: { amount, note, dollars: getUser(p.id).dollars, pending: amount > 0, messageId: message ? message.id : 0 }
      });
      return { message, note: noteMsg, balance: balance(getUser(p.id)), player: row(getUser(p.id)) };
    },

    // the chat the automatic filter stopped: an operator lets it go again
    'POST /api/ops/chat-ban': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = alive(body.id);
      if (!p.chat_ban) return { player: row(p) };
      q("UPDATE users SET chat_ban = 0, chat_ban_why = '' WHERE id = ?").run(p.id);
      live.send(p.id, 'chatban', { on: false });
      opsLog.add({
        actor: u, action: 'chat_unban', target: p, req, summary: `${p.name}さんのチャット停止を解除（自動フィルタリングシステム：${p.chat_ban_why || '理由不明'}）`,
        detail: { since: p.chat_ban, why: p.chat_ban_why }
      });
      return { player: row(getUser(p.id)) };
    },

    /* ----- 通報 ----- */

    'GET /api/ops/reports': (req, u) => {
      see(u);
      const status = req.query.get('status') === 'done' ? "status != 'open'" : "status = 'open'";
      return { reports: q(`SELECT * FROM reports WHERE ${status} ORDER BY id DESC LIMIT 300`).all().map(reportDto), now: Date.now() };
    },

    // accept (with the bot's thanks and a reward of 60万 / 120万 / 240万) or decline
    'POST /api/ops/report': async (req, u) => {
      need(u);
      const body = await req.json();
      const r = q('SELECT * FROM reports WHERE id = ?').get(posInt(body.id, '通報'));
      if (!r) throw new ApiError(404, 'not_found', 'この通報は見つかりません');
      if (r.status !== 'open') throw new ApiError(409, 'done', 'この通報はもう処理されています');
      const reporter = getUser(r.reporter_id), who = getUser(r.target_id);
      const now = Date.now();
      if (body.action === 'accept') {
        const reward = Number(body.reward);
        if (!REWARDS.includes(reward)) throw new ApiError(400, 'bad_reward', '送る金額を選んでください');
        q("UPDATE reports SET status = 'accepted', reward = ?, handled_by = ?, handled_at = ? WHERE id = ?").run(reward, u.id, now, r.id);
        let thanks = '';
        if (reporter && !reporter.npc) {
          official.pay(reporter.id, reward);
          const excerpt = Array.from(r.body).length > 60 ? Array.from(r.body).slice(0, 60).join('') + '…' : r.body;
          thanks = `ありがとうございます！${shortTime(r.created_at)}にいただいた、${who ? who.name : '対象プレイヤー'}さんの件の通報（${KIND_NAMES[r.kind] || r.kind}：「${excerpt}」）は受理されました！運営一同、ご協力に心より感謝いたします！\nお礼として $${fmt(reward)} をお送りしました。`;
          official.say(reporter.id, thanks);
        }
        opsLog.add({
          actor: u, action: 'report_accept', target: reporter, req,
          summary: `通報 #${r.id}（${who ? who.name : '?'}さんについて・${KIND_NAMES[r.kind] || r.kind}）を受理し、${reporter ? reporter.name : '?'}さんへ $${fmt(reward)} と感謝のメッセージ`,
          detail: { report: reportDto(q('SELECT * FROM reports WHERE id = ?').get(r.id)), reward, message: thanks }
        });
      } else if (body.action === 'reject') {
        q("UPDATE reports SET status = 'rejected', handled_by = ?, handled_at = ? WHERE id = ?").run(u.id, now, r.id);
        opsLog.add({ actor: u, action: 'report_reject', target: reporter, req, summary: `通報 #${r.id}（${who ? who.name : '?'}さんについて）を受理しなかった`, detail: { report: reportDto(q('SELECT * FROM reports WHERE id = ?').get(r.id)) } });
      } else {
        throw new ApiError(400, 'bad_action', '処理を選んでください');
      }
      return { report: reportDto(q('SELECT * FROM reports WHERE id = ?').get(r.id)) };
    },

    /* ----- what the chat filter found ----- */

    'GET /api/ops/detections': (req, u) => {
      see(u);
      const who = Number(req.query.get('id')) || 0;
      const all = req.query.get('all') === '1';
      const rows = q(`SELECT * FROM detections WHERE (? = 0 OR sender_id = ?) AND (? = 1 OR reviewed_at = 0) ORDER BY id DESC LIMIT 300`).all(who, who, all ? 1 : 0);
      return { detections: rows.map(detectionDto), now: Date.now() };
    },

    // looked at: the 検知 mark goes (one, or all of a player's)
    'POST /api/ops/detections/review': async (req, u) => {
      need(u);
      const body = await req.json();
      const now = Date.now();
      let n = 0, p = null;
      if (body.player) {
        p = target(body.player);
        n = q('UPDATE detections SET reviewed_at = ? WHERE sender_id = ? AND reviewed_at = 0').run(now, p.id).changes;
      } else {
        const d = q('SELECT * FROM detections WHERE id = ?').get(posInt(body.id, '検知'));
        if (!d) throw new ApiError(404, 'not_found', 'この検知は見つかりません');
        p = getUser(d.sender_id);
        n = q('UPDATE detections SET reviewed_at = ? WHERE id = ? AND reviewed_at = 0').run(now, d.id).changes;
      }
      opsLog.add({ actor: u, action: 'detections_reviewed', target: p, req, summary: `${p ? p.name : '?'}さんの検知 ${n}件を確認済みにした`, detail: { count: n, ids: body.id ? [body.id] : 'all' } });
      return { reviewed: n };
    },

    /* ----- 報告 / 意見案 (and the old feedback with stars) ----- */

    'GET /api/ops/feedback': (req, u) => {
      see(u);
      const rows = q(`SELECT f.*, o.name, o.avatar FROM feedback f LEFT JOIN users o ON o.id = f.user_id ORDER BY f.id DESC LIMIT 500`).all();
      return {
        feedback: rows.map((f) => {
          let ratings = {};
          try { ratings = JSON.parse(f.ratings); } catch { /* none */ }
          return { id: f.id, kind: f.kind || 'rating', user: { id: f.user_id, name: f.name, avatar: f.avatar }, text: f.comment, ratings, handledAt: f.handled_at, adoptedAt: f.adopted_at, at: f.created_at };
        }),
        now: Date.now()
      };
    },

    'POST /api/ops/feedback/handled': async (req, u) => {
      need(u);
      const body = await req.json();
      const f = q('SELECT * FROM feedback WHERE id = ?').get(posInt(body.id, 'フィードバック'));
      if (!f) throw new ApiError(404, 'not_found', 'このフィードバックは見つかりません');
      q('UPDATE feedback SET handled_at = ? WHERE id = ?').run(Date.now(), f.id);
      const p = getUser(f.user_id);
      opsLog.add({ actor: u, action: 'feedback_handled', target: p, req, summary: `${p ? p.name : '?'}さんの${f.kind === 'bug' ? '報告' : f.kind === 'idea' ? '意見案' : 'フィードバック'} #${f.id} を対応済みにした`, detail: { id: f.id, kind: f.kind, text: f.comment } });
      return { ok: true };
    },

    // a 意見案 taken up: spin tokens from Ice Smoker公式 with its thanks (once; it is handled then too)
    'POST /api/ops/feedback/adopt': async (req, u) => {
      need(u);
      const body = await req.json();
      const f = q('SELECT * FROM feedback WHERE id = ?').get(posInt(body.id, '意見案'));
      if (!f || f.kind !== 'idea') throw new ApiError(404, 'not_found', 'この意見案は見つかりません');
      const now = Date.now();
      // (two operators at once: one of them adopts it)
      const r = q('UPDATE feedback SET adopted_at = ?, adopted_by = ?, handled_at = CASE WHEN handled_at = 0 THEN ? ELSE handled_at END WHERE id = ? AND adopted_at = 0')
        .run(now, u.id, now, f.id);
      if (!Number(r.changes)) throw new ApiError(409, 'done', 'この意見案はもう採用されています');
      const p = getUser(f.user_id);
      const before = p ? p.tokens : 0;
      let thanks = '';
      if (p && !p.npc) {
        official.pay(p.id, IDEA_REWARD, 'tokens');
        const excerpt = Array.from(f.comment).length > 60 ? Array.from(f.comment).slice(0, 60).join('') + '…' : f.comment;
        thanks = `ありがとうございます！${shortTime(f.created_at)}にいただいた意見案（「${excerpt}」）を採用させていただきました！\n感謝の気持ちとして ${fmt(IDEA_REWARD)} スピントークンをお送りしました。`;
        official.say(p.id, thanks);
      }
      opsLog.add({
        actor: u, action: 'idea_adopt', target: p, req,
        summary: `${p ? p.name : '?'}さんの意見案 #${f.id} を採用し、${fmt(IDEA_REWARD)} スピントークンと感謝のメッセージ`,
        detail: { id: f.id, text: f.comment, reward: IDEA_REWARD, currency: 'tokens', message: thanks, tokensBefore: before, tokensAfter: p ? getUser(p.id).tokens : 0 }
      });
      return { ok: true, reward: IDEA_REWARD };
    },

    /* ----- the operators: rights given and taken away with the developer code ----- */

    'GET /api/ops/operators': (req, u) => {
      see(u);
      if (!isOperator(u)) return { operators: operatorList().map(({ key, changed, fromSettings, ...o }) => o), viewers: viewerList(), now: Date.now() };
      return { operators: operatorList(), viewers: viewerList(), devCodeSet: devCode.isSet(), now: Date.now() };
    },

    // 'grant': a player becomes an operator. 'revoke': an operator's rights
    // go; they are logged out everywhere at once (the game says why) and the
    // site no longer lets them in. Both need the developer code; the
    // developer's own rights never go.
    'POST /api/ops/operator': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '権限を変えられるのは開発者だけです');
      const body = await req.json();
      const action = body.action === 'grant' || body.action === 'revoke' ? body.action : '';
      if (!action) throw new ApiError(400, 'bad_action', '処理を選んでください');
      const key = nameKey(String(body.name ?? ''));
      const p = key ? q('SELECT * FROM users WHERE name_key = ?').get(key) || null : null;
      if (!p || p.npc) throw new ApiError(404, 'not_found', 'その名前のプレイヤーはいません');
      if (isDeveloper(p)) throw new ApiError(400, 'developer', '開発者の運営権は変えられません');
      await devCode.check(body.code, req, u);
      if (action === 'grant') {
        if (isOperator(p)) throw new ApiError(409, 'done', `${p.name}さんはもう運営者です`);
        tx(() => {
          q('INSERT INTO ops_access (name_key, granted, at, by_id) VALUES (?, 1, ?, ?) ON CONFLICT(name_key) DO UPDATE SET granted = 1, at = excluded.at, by_id = excluded.by_id')
            .run(key, Date.now(), u.id);
          // (the developer's own word, with the code: the rights are this account's)
          pins.bind(p, 'granted');
          // (an operator sees everything: no longer a viewer; their look-only sessions end)
          q('UPDATE ops_viewers SET granted = 0, at = ?, by_id = ? WHERE user_id = ? AND granted = 1').run(Date.now(), u.id, p.id);
          q("UPDATE sessions SET ended = ? WHERE user_id = ? AND scope = 'view'").run('運営者になったため、運営サイトにもう一度ログインしてください', p.id);
        });
        opsLog.add({ actor: u, action: 'ops_grant', target: p, req, summary: `${p.name}さんに運営権を付与（開発者コードで）`, detail: { name: key } });
      } else {
        if (!isOperator(p)) throw new ApiError(409, 'done', `${p.name}さんは運営者ではありません`);
        const why = '運営権が剥奪されたため、ログアウトされました（ゲームには再ログインで入れます）';
        let ended = 0;
        tx(() => {
          q('INSERT INTO ops_access (name_key, granted, at, by_id) VALUES (?, 0, ?, ?) ON CONFLICT(name_key) DO UPDATE SET granted = 0, at = excluded.at, by_id = excluded.by_id')
            .run(key, Date.now(), u.id);
          ended = Number(q('UPDATE sessions SET ended = ? WHERE user_id = ?').run(why, p.id).changes);
        });
        live.send(p.id, 'kick', { code: 'ended', message: why });
        opsLog.add({ actor: u, action: 'ops_revoke', target: p, req, summary: `${p.name}さんの運営権を剥奪（開発者コードで・すべての端末からログアウト）`, detail: { name: key, sessionsEnded: ended } });
      }
      return { operators: operatorList() };
    },

    // 閲覧者: 'grant' lets a player look at the operator site (and security
    // HOME); 'revoke' takes it away and ends their site sessions at once (the
    // game goes on). The developer only, with the developer code.
    'POST /api/ops/viewer': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '権限を変えられるのは開発者だけです');
      const body = await req.json();
      const action = body.action === 'grant' || body.action === 'revoke' ? body.action : '';
      if (!action) throw new ApiError(400, 'bad_action', '処理を選んでください');
      const key = nameKey(String(body.name ?? ''));
      const p = key ? q('SELECT * FROM users WHERE name_key = ?').get(key) || null : null;
      if (!p || p.npc || p.ban_kind === 'deleted') throw new ApiError(404, 'not_found', 'その名前のプレイヤーはいません');
      if (isOperator(p)) throw new ApiError(400, 'operator', `${p.name}さんは運営者です（運営者はもともとすべて見られます）`);
      await devCode.check(body.code, req, u);
      const now = Date.now();
      if (action === 'grant') {
        if (isViewer(p)) throw new ApiError(409, 'done', `${p.name}さんはもう閲覧者です`);
        q('INSERT INTO ops_viewers (user_id, granted, at, by_id) VALUES (?, 1, ?, ?) ON CONFLICT(user_id) DO UPDATE SET granted = 1, at = excluded.at, by_id = excluded.by_id').run(p.id, now, u.id);
        opsLog.add({ actor: u, action: 'viewer_grant', target: p, req, summary: `${p.name}さんに閲覧者の権限を付与（開発者コードで）`, detail: { user: p.id } });
      } else {
        if (!isViewer(p)) throw new ApiError(409, 'done', `${p.name}さんは閲覧者ではありません`);
        let ended = 0;
        tx(() => {
          q('UPDATE ops_viewers SET granted = 0, at = ?, by_id = ? WHERE user_id = ?').run(now, u.id, p.id);
          ended = Number(q("UPDATE sessions SET ended = ? WHERE user_id = ? AND scope = 'view'").run('閲覧者の権限がなくなったため、ログアウトされました', p.id).changes);
        });
        live.send(p.id, 'viewer', { on: false });
        opsLog.add({ actor: u, action: 'viewer_revoke', target: p, req, summary: `${p.name}さんの閲覧者の権限を剥奪（開発者コードで・運営サイトとsecurity HOMEからすぐにログアウト）`, detail: { user: p.id, sessionsEnded: ended } });
      }
      if (action === 'grant') live.send(p.id, 'viewer', { on: true });
      return { operators: operatorList(), viewers: viewerList() };
    },

    // the developer code: registered once by the developer's account (never
    // written anywhere else), changed with the old one
    'POST /api/ops/dev-code': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '開発者コードは開発者のアカウントだけが登録できます');
      const body = await req.json();
      await devCode.register(body.code, body.old, req, u);
      return { ok: true, devCodeSet: true };
    },

    /* ----- the operators' log ----- */

    // kind: player / operator / security / vault / emergency ('' all)
    'GET /api/ops/log': (req, u) => {
      see(u);
      const before = Number(req.query.get('before')) || 0;
      // slim=1: the lines only (a list); each one's detail comes when it is opened (/api/ops/log/entries)
      const slim = req.query.get('slim') === '1';
      const entries = opsLog.list({ before, find: req.query.get('q') || '', kind: req.query.get('kind') || '', slim });
      return {
        entries: isOperator(u) || slim ? entries : entries.map(viewerEntry), viewer: !isOperator(u),
        counts: before ? null : opsLog.counts(), now: Date.now()
      };
    },

    // some lines in full (≤ 100, by number): what a list leaves out, for the lines that are opened
    'GET /api/ops/log/entries': (req, u) => {
      see(u);
      const entries = opsLog.many(String(req.query.get('ids') || '').split(',').slice(0, 100));
      return { entries: isOperator(u) ? entries : entries.map(viewerEntry) };
    },

    'GET /api/ops/log/verify': async (req, u) => {
      see(u);
      return opsLog.verify();
    }
  };

  // 90 days in the archive: their data goes, what was said stays (from the housekeeping)
  function purgeDue(now = Date.now()) {
    for (const p of q("SELECT * FROM users WHERE npc = '' AND purge_at > 0 AND purge_at <= ? LIMIT 50").all(now)) {
      const gone = purgePlayer(q, tx, p.id, now);
      opsLog.add({
        actorName: 'システム', action: 'account_purge', target: p,
        summary: `${p.name}さんのデータを削除（${p.archive_reason === 'deleted' ? 'アカウント削除' : '永久BAN'}でプレイヤーアーカイブに入って${ARCHIVE_DAYS}日・会話と記録は無期限で保存）`,
        detail: { player: { id: p.id, name: p.name }, reason: p.archive_reason, archivedAt: p.archived_at, rows: gone, kept: KEPT_ROWS }
      });
    }
  }

  return { routes, isOperator, isViewer, need, see, operatorList, viewerList, mini, speedNow, purgeDue, archivedCount, vaultRequestsOpen };
}
