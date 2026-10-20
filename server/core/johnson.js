// ジョンソン, a friend NPC: always online, kind, never wants anything back.
// Every RULES.johnson.every (2 days) he sends 10〜20万円 to help the player
// grow the 金の生る木 (the first time when the player first comes by), and
// once ever, when the player's money (tokens counted at their price) falls
// under RULES.johnson.rescueBelow, he sends RULES.johnson.rescue with a few
// words. He answers what is written to him. Money is in $ (he says 円), and
// it comes as a transfer in his chat so the game shows it like money from a
// friend (it arrives with the player's tap).
import { RULES } from './rules.js';
import { newRecoveryCode, sha256 } from './auth.js';

const J = RULES.johnson;

export const NAME = 'ジョンソン';
const FIRST_LINE = 'はじめまして、ジョンソンだ。お前の金の生る木を応援させてくれ。これから2日に一度、木を育てる資金を送るよ。まずはこれを使ってくれ。';
const GIFT_LINES = [
  'よう、元気か？金の生る木の調子はどうだ。少ないけど、木を育てる足しにしてくれ。',
  '2日ぶりだな。お前の木がどこまで育つか楽しみにしてるんだ。今回の分を送っておくぞ。',
  '木を育てるのは根気だ。焦らずいこうぜ。これは俺からの差し入れだ。',
  'いい木に育てよ。困ったことがあったら、いつでも話してくれ。',
  '今日もがんばってるな。これで金の生る木にお金をあげてやってくれ。'
];
const RESCUE_LINE = 'おい、ほとんどすっからかんじゃないか。これを使え、返さなくていい。ただし、こんなことは一度きりだからな。大事に使えよ。';
// what he says back: the first rule that matches the player's words
const REPLIES = [
  [/ありがと|感謝|サンキュ|助か|thank/i, ['いいってことよ。友達だろ？', 'どういたしまして。木が育ったら見せてくれよな。']],
  [/木|育|収穫|成長|オークション|競り/, [
    '木はお金をあげるほど、毎秒の稼ぎが増えていくんだ。収穫の時期は長いほど倍率が高いぞ。',
    '1週間待てば収穫は1.6倍だ。待てるなら、それがいちばん得だな。',
    'オークションでは熱くなりすぎるなよ。平均より高くなったら、離脱するのも立派な作戦だ。'
  ]],
  [/貸|借|ちょうだい|ください|下さい|くれ|ほしい|欲しい/, ['金の貸し借りはしない主義なんだ。そのかわり、2日に一度は木の資金を送るよ。', '借金ならマイクソンだが…利息には気をつけろよ。']],
  [/こんにちは|こんばんは|おはよう|やあ|よろしく|はじめまして|hello|\bhi\b/i, ['よう！元気そうでなによりだ。', 'やあ。今日もいい日になるといいな。']]
];
const ANY_REPLIES = ['なるほどな。俺はいつでもお前の味方だぜ。', 'そうか！また何でも話してくれ。', 'ははは、いいね。木の調子もたまに教えてくれよ。'];

function randInt(lo, hi) {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return lo + (r[0] % (hi - lo + 1));
}
const pick = (a) => a[randInt(0, a.length - 1)];

// ctx: { q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel }
export function createJohnson(ctx) {
  const { q, tx, getUser, live } = ctx;
  let johnsonId = 0;

  // His account: created once, found again after a restore.
  function id() {
    const cached = johnsonId && getUser(johnsonId);
    if (cached && cached.npc === 'johnson') return johnsonId;
    let row = q("SELECT id FROM users WHERE npc = 'johnson' LIMIT 1").get();
    if (!row) {
      const now = Date.now();
      q(`INSERT INTO users (name, name_key, recovery_hash, avatar, tokens, dollars, coins, npc, created_at, last_seen)
         VALUES (?, ?, ?, 'johnson', 0, 0, 0, 'johnson', ?, ?)`)
        .run(NAME, 'npc:johnson', sha256(newRecoveryCode() + ':johnson'), now, now);
      row = q("SELECT id FROM users WHERE npc = 'johnson' LIMIT 1").get();
    }
    johnsonId = row.id;
    return johnsonId;
  }
  function me() { const j = getUser(id()); return { id: j.id, name: j.name, avatar: j.avatar, npc: 'johnson' }; }

  function stateOf(userId) {
    return q("SELECT * FROM npc_friends WHERE user_id = ? AND npc = 'johnson'").get(userId)
      || { user_id: userId, gift_at: 0, gifts: 0, given: 0, rescued_at: 0 };
  }
  function save(s) {
    q(`INSERT INTO npc_friends (user_id, npc, gift_at, gifts, given, rescued_at) VALUES (?, 'johnson', ?, ?, ?, ?)
       ON CONFLICT(user_id, npc) DO UPDATE SET gift_at = excluded.gift_at, gifts = excluded.gifts, given = excluded.given, rescued_at = excluded.rescued_at`)
      .run(s.user_id, s.gift_at, s.gifts, s.given, s.rescued_at);
  }

  // A line from him in his conversation with the player (unread for them).
  function say(userId, text) {
    const jid = id();
    const row = ctx.insertMessage({ channel: ctx.dmChannel(userId, jid), sender: getUser(jid), recipient: userId, kind: 'text', body: text });
    ctx.touchConversations(userId, jid, row.id, userId);
    return row;
  }
  // Money from him: a card in his chat like a friend's transfer, and it
  // arrives when the player taps it (POST /api/messages/claim).
  function send(userId, amount) {
    const jid = id();
    const row = ctx.insertMessage({ channel: ctx.dmChannel(userId, jid), sender: getUser(jid), recipient: userId, kind: 'transfer', amount, currency: 'dollars', pending: true });
    ctx.touchConversations(userId, jid, row.id, userId);
    return row;
  }
  function deliver(userId, row) {
    const dto = ctx.msgDto(row);
    live.send(userId, 'msg', { ...dto, unread: ctx.unreadTotal(userId) });
    return dto;
  }

  // The player came by or spent money: his gift when two days have passed,
  // and his one rescue when the money is nearly gone.
  function check(userId) {
    const u = getUser(userId);
    if (!u || u.npc || u.banned) return [];
    const now = Date.now();
    const rows = tx(() => {
      const cur = getUser(userId);
      const s = stateOf(userId);
      const out = [];
      if (!s.rescued_at && cur.dollars + cur.tokens * RULES.tokenPrice < J.rescueBelow) {
        out.push(say(userId, RESCUE_LINE), send(userId, J.rescue));
        s.rescued_at = now;
        s.given += J.rescue;
      }
      if (now - s.gift_at >= J.every) {
        const amount = Math.round(randInt(J.gift[0], J.gift[1]) / 1000) * 1000;
        out.push(say(userId, s.gifts ? pick(GIFT_LINES) : FIRST_LINE), send(userId, amount));
        s.gift_at = now;
        s.gifts += 1;
        s.given += amount;
      }
      if (out.length) save(s);
      return out;
    });
    if (!rows.length) return [];
    return rows.map((row) => deliver(userId, row));
  }

  // The player wrote to him: kept like any chat, and he answers.
  function chat(u, text) {
    const jid = id();
    const mine = tx(() => {
      const row = ctx.insertMessage({ channel: ctx.dmChannel(u.id, jid), sender: u, recipient: jid, kind: 'text', body: text });
      ctx.touchConversations(u.id, jid, row.id, 0);
      return row;
    });
    const dto = ctx.msgDto(mine);
    live.send(u.id, 'msg', dto);
    const s = String(text || '').normalize('NFKC');
    const rule = REPLIES.find(([re]) => re.test(s));
    const reply = tx(() => say(u.id, pick(rule ? rule[1] : ANY_REPLIES)));
    return { message: dto, reply: deliver(u.id, reply) };
  }

  function state(userId) {
    const s = stateOf(userId);
    return { johnson: { ...me(), online: true }, next: s.gift_at ? s.gift_at + J.every : 0, gifts: s.gifts, given: s.given, rescued: !!s.rescued_at, now: Date.now() };
  }

  return { id, me, is: (userId) => userId === id(), check, chat, state };
}
