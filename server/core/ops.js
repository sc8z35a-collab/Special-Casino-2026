// The operator site (/ops/): the players with their money, connection,
// 引き継ぎコード, play time, age check and devices, and the bans; the
// conversations with the official bot (Ice Smoker公式ボット: messages written
// from a polite template, money, 返信待ち), the reports (通報: accepted with a
// reward from the bot, or declined), what the chat filter found (検知), the
// 報告 / 意見案 players sent, and the operators' log. Only the accounts named
// in config.operators may use it (they log in with their name and password on
// the site; the session is the game's own). Passwords are never shown: they
// are kept only as one-way hashes, so an operator sets a new one instead.
// Everything an operator does here that reaches anyone is written to the log
// (server/core/opslog.js), with the request it came from.
import { ApiError, posInt } from './errors.js';
import { nameKey, cleanPassword, cleanText, hashPassword } from './auth.js';
import { LEVEL, RULES } from './rules.js';
import { jst } from './opslog.js';

const REWARDS = [600000, 1200000, 2400000];
const MONEY_MAX = 10000000;
const fmt = (n) => Number(n).toLocaleString('en-US');

export function createOps({ q, tx, live, config, getUser, mini, openCode, setRecovery, banMessage, BAN_DAYS, deviceBanOf, dropFromHub, official, opsLog, balance }) {
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
  const flagged = () => {
    const m = new Map();
    for (const r of q('SELECT sender_id, COUNT(*) AS n FROM detections WHERE reviewed_at = 0 GROUP BY sender_id').all()) m.set(r.sender_id, r.n);
    return m;
  };
  function row(u, waiting = null, detections = null) {
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
      npc: !!u.npc,
      // 18歳以上？ (null: not answered)
      age: u.age_ok === null || u.age_ok === undefined ? null : !!u.age_ok,
      ageAt: u.age_at || 0,
      // 返信待ち: their message to the official bot has no answer yet
      waiting: waiting ? waiting.has(u.id) : official.waiting(u.id),
      // 検知: what the chat filter found and nobody looked at yet
      detections: detections ? detections.get(u.id) || 0 : q('SELECT COUNT(*) AS n FROM detections WHERE sender_id = ? AND reviewed_at = 0').get(u.id).n
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
      id: r.id, kind: r.kind, kindName: KIND_NAMES[r.kind] || r.kind, text: r.body, place: r.place, context, status: r.status, reward: r.reward,
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
      need(u);
      if (!opened.has(u.id) || Date.now() - opened.get(u.id) > 30 * 60000) {
        opened.set(u.id, Date.now());
        opsLog.add({ actor: u, action: 'open', summary: `${u.name}が運営サイトを開いた`, req });
      }
      return { name: u.name, operators: config.operators, now: Date.now() };
    },

    // everyone (a name to look for: part of it), the newest players first
    'GET /api/ops/players': (req, u) => {
      need(u);
      const find = nameKey(req.query.get('q') || '');
      const rows = q(`SELECT * FROM users WHERE npc = '' ${find ? 'AND instr(name_key, ?) > 0' : ''} ORDER BY id DESC LIMIT 1000`)
        .all(...(find ? [find] : []));
      const waiting = official.waitingIds(), dets = flagged();
      const list = rows.map((p) => row(p, waiting, dets));
      return {
        players: list,
        total: q("SELECT COUNT(*) AS n FROM users WHERE npc = ''").get().n,
        online: list.filter((p) => p.online).length,
        waiting: waiting.size,
        reports: q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
        detections: q('SELECT COUNT(*) AS n FROM detections WHERE reviewed_at = 0').get().n,
        feedback: q("SELECT COUNT(*) AS n FROM feedback WHERE handled_at = 0 AND kind != ''").get().n,
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
          devices: devicesOf(p),
          reportsAgainst: q('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?').get(p.id).n,
          reportsBy: q('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?').get(p.id).n
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
      const before = banOf(p);
      const shut = [];
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
            shut.push({ id: o.id, name: o.name, device: d.label });
            live.send(o.id, 'kick', { code: 'device_banned', message: 'この端末のほかのアカウントがBANされているため、このアカウントも利用できません' });
          }
        }
      }
      const after = getUser(p.id);
      opsLog.add({
        actor: u, action: 'ban:' + kind, target: p, req,
        summary: `${p.name}さんに「${BAN_NAMES[kind]}」`,
        detail: { kind, before, after: banOf(after), until: after.ban_until ? { ms: after.ban_until, jst: jst(after.ban_until) } : null, message: kind === 'none' ? '' : banMessage(after), sameDeviceAccounts: shut }
      });
      return { player: row(after) };
    },

    // lets the player play past the bans of other accounts on their devices
    // (until the next BAN of one of them)
    'POST /api/ops/device-ok': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      q('UPDATE users SET device_ok_at = ? WHERE id = ?').run(Date.now(), p.id);
      opsLog.add({ actor: u, action: 'device_ok', target: p, req, summary: `${p.name}さんの端末の利用を許可`, detail: { devices: devicesOf(p) } });
      return { player: row(getUser(p.id)) };
    },

    // a new 引き継ぎコード (the old one stops working)
    'POST /api/ops/recovery': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      const old = openCode(p.recovery_enc);
      const code = setRecovery(p.id);
      opsLog.add({ actor: u, action: 'recovery', target: p, req, summary: `${p.name}さんの引き継ぎコードを再発行`, detail: { oldCodeStart: old ? old.slice(0, 4) + '…' : '', newCodeStart: code.slice(0, 4) + '…' } });
      return { code, player: row(getUser(p.id)) };
    },

    // a new password for a player who forgot theirs (check who is asking first)
    'POST /api/ops/password': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
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
        opsLog.add({ actor: u, action: 'bot_read', target: p, req, summary: `${p.name}さんとの公式ボットのチャットを開いた（既読をつけた）`, detail: { readUpTo: upto, waiting: waitingBefore } });
      }
      return { player: row(getUser(p.id)), bot: official.me(), ...c, now: Date.now() };
    },

    // a message from the operators (件名, 〇〇様, the matter, Ice Smoker公式より)
    'POST /api/ops/chat': async (req, u) => {
      need(u);
      const body = await req.json(1024 * 1024);
      const p = target(body.id);
      const subject = cleanText(body.subject, 100);
      const text = cleanText(body.body, 20000);
      const full = `【${subject}】\n\n${p.name}様\n\n${text}\n\nIce Smoker公式より`;
      const message = official.say(p.id, full);
      official.answered(p.id);
      opsLog.add({ actor: u, action: 'bot_message', target: p, req, summary: `${p.name}さんへ公式ボットからメッセージ「${subject}」`, detail: { subject, body: text, sent: full, messageId: message.id } });
      return { message, player: row(getUser(p.id)) };
    },

    // money from the operators ($0〜1000万), with a note if written
    'POST /api/ops/money': async (req, u) => {
      need(u);
      const body = await req.json();
      const p = target(body.id);
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 0 || amount > MONEY_MAX) throw new ApiError(400, 'bad_amount', `金額は $0〜${fmt(MONEY_MAX)} で選んでください`);
      const note = String(body.note ?? '').trim() ? cleanText(body.note, 2000) : '';
      const before = getUser(p.id).dollars;
      const message = amount > 0 ? official.pay(p.id, amount) : null;
      const noteMsg = note ? official.say(p.id, note) : null;
      if (noteMsg) official.answered(p.id);
      opsLog.add({
        actor: u, action: 'money', target: p, req, summary: `${p.name}さんへ公式ボットから $${fmt(amount)} を送金`,
        detail: { amount, note, dollarsBefore: before, dollarsAfter: getUser(p.id).dollars, messageId: message ? message.id : 0 }
      });
      return { message, note: noteMsg, balance: balance(getUser(p.id)), player: row(getUser(p.id)) };
    },

    /* ----- 通報 ----- */

    'GET /api/ops/reports': (req, u) => {
      need(u);
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
          thanks = `ありがとうございます！${shortTime(r.created_at)}にいただいた、${who ? who.name : '対象プレイヤー'}さんの件の通報（${KIND_NAMES[r.kind] || r.kind}：「${excerpt}」）は、無事に運営に届き、受理されました！運営一同、ご協力に心より感謝いたします！\n感謝の気持ちとして $${fmt(reward)} をお送りしました。`;
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
      need(u);
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
      need(u);
      const rows = q(`SELECT f.*, o.name, o.avatar FROM feedback f LEFT JOIN users o ON o.id = f.user_id ORDER BY f.id DESC LIMIT 500`).all();
      return {
        feedback: rows.map((f) => {
          let ratings = {};
          try { ratings = JSON.parse(f.ratings); } catch { /* none */ }
          return { id: f.id, kind: f.kind || 'rating', user: { id: f.user_id, name: f.name, avatar: f.avatar }, text: f.comment, ratings, handledAt: f.handled_at, at: f.created_at };
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

    /* ----- the operators' log ----- */

    'GET /api/ops/log': (req, u) => {
      need(u);
      return { entries: opsLog.list({ before: Number(req.query.get('before')) || 0, find: req.query.get('q') || '' }), now: Date.now() };
    },

    'GET /api/ops/log/verify': (req, u) => {
      need(u);
      return opsLog.verify();
    }
  };

  return { routes, isOperator, mini };
}
