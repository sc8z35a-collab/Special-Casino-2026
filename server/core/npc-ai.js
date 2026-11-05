// What Cloudflare Workers AI writes and chooses for the country (server/core/npc.js): only for the 300 who think with
// it (NPC.elite, server/core/npc-elite.js) — their choices, アルファ's 10 at their meeting, a new mayor's first speech
// and a company CEO's AI advice (they are among the 300); the citizens never. What it may spend a day: Cloudflare's
// free Neurons of the day (they start again at 00:00 UTC, and so is the day counted here) and NPC.elite's yen a month
// beyond them (a thirtieth a day) — counted by the tokens sent and written at each model's own rates (NPC.elite.rates),
// never more. Without the binding (the Node server) or past the day's money, the patterns of server/core/npc-text.js
// write instead.
import { NPC } from './rules.js';

const EL = NPC.elite;
const TOKENS = (s) => Math.ceil(String(s).length * 1.3);
const DAY = 86400000;
// what a call costs in Neurons (a model the price list does not have: the dearest it does, to be safe)
const DEAREST = Object.values(EL.rates).reduce((a, r) => [Math.max(a[0], r[0]), Math.max(a[1], r[1])], [0, 0]);
export function neuronsOf(model, inTokens, outTokens) {
  const r = EL.rates[model] || DEAREST;
  return (inTokens * r[0] + outTokens * r[1]) / 1e6;
}
// the day's Neurons: the free part (a little short of it) and the yen beyond, a thirtieth of the month's a day
export function dailyCap(free = EL.free, yen = EL.yen) {
  return Math.floor(free * 0.98 + Math.max(0, yen) / EL.usd / EL.price * 1000 / 30);
}
// the model's words without its thinking aloud (<think>…</think>)
const plain = (t) => String(t || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

export function createAi({ binding = null, q, clock = Date.now, daily = EL.free, yen = EL.yen, model = EL.model }) {
  const cap = dailyCap(daily, yen);
  const dayStart = (ms) => Math.floor(ms / DAY) * DAY;
  function used(now = clock()) {
    const r = q('SELECT COALESCE(SUM(neurons), 0) AS n, COUNT(*) AS c FROM npc_ai WHERE at >= ?').get(dayStart(now));
    return { neurons: r.n, calls: r.c, cap };
  }
  // one call of `use` (a model) as far as `room` allows: its answer kept (or null: no room, no binding, nothing said)
  async function ask(use, kind, ref, system, user, max = 160, now = clock(), room = cap - used(now).neurons) {
    if (!binding) return null;
    if (room < neuronsOf(use, TOKENS(system + user), max)) return null;
    let text = '';
    try {
      const out = await binding.run(use, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: max });
      text = plain(out && (out.response || out.result || '')).slice(0, 4000);
    } catch (e) {
      console.error('npc ai failed', e && e.message);
      return null;
    }
    if (!text) return null;
    const neurons = neuronsOf(use, TOKENS(system + user), TOKENS(text));
    q('INSERT INTO npc_ai (at, kind, ref, text, neurons) VALUES (?, ?, ?, ?, ?)').run(now, kind, String(ref || ''), text.slice(0, 600), Math.round(neurons * 100) / 100);
    return text;
  }
  return {
    on: !!binding,
    cap,
    used,
    ask,
    // (アルファ's 10 at their meeting: npc.js alphaTalk — the stronger model)
    say: (kind, ref, system, user, max = 160, now = clock()) => ask(EL.topModel, kind, ref, system, user, max, now),
    // the jobs waiting (a new mayor's speech, a CEO's advice), as many as the day's money allows, the newest first
    async run(jobs, now = clock()) {
      let n = 0;
      for (const job of jobs.slice(-12).reverse()) {
        const p = promptOf(job);
        if (!p) continue;
        if (await ask(model, job.kind, job.ref, p.system, p.user, p.max, now)) n++;
      }
      return n;
    },
    text(kind, ref) {
      const r = q('SELECT text FROM npc_ai WHERE kind = ? AND ref = ? ORDER BY id DESC LIMIT 1').get(kind, String(ref));
      return r ? r.text : null;
    }
  };
}

// what the model is asked for a mayor or a CEO of the 300 (in Japanese: the town's own words, short, plain, no names of
// real people or companies)
function promptOf(job) {
  const system = 'あなたは架空の国「ヴェルノア共和国」の住民の言葉を書く係です。実在の人物・企業・地名は出さず、差別や暴力の表現は使いません。日本語で、短く、自然な話し言葉で書いてください。/no_think';
  switch (job.kind) {
    case 'speech': return { system, user: `${job.district}の新しい区長「${job.name}」の就任あいさつを2〜3文で。公約：${job.platform}。`, max: 160 };
    case 'voice': return { system, user: `${job.age}歳・${job.job}の${job.name}さんの、今の心の声を1文で。状況：${job.mood}。`, max: 80 };
    // (a CEO of the 300 weighing their company's choices: one of them, by its number — server/core/npc-org.js askAdvice)
    case 'decide': return {
      system: 'あなたは架空の国「ヴェルノア共和国」の企業のCEOです。実在の企業や人物は扱いません。会社の状況と議題の候補を読み、会社の長期的な成長と国の経済の循環のために今いちばん良い議題を1つ選び、その番号だけを半角数字で答えてください。説明は不要です。/no_think',
      user: `会社：${job.company}\n状況：${job.state}\n候補：\n${(job.options || []).map((t, k) => `${k + 1}. ${t}`).join('\n')}`, max: 8 };
    default: return null;
  }
}
