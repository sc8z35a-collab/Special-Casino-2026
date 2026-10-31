// The few lines of the country written by Cloudflare Workers AI (server/core/npc.js): a new mayor's first speech,
// a new business's announcement, the thoughts of the people the town talks about, a word in 街の声. Within 90% of
// what the plan includes a day (10,000 Neurons a day: what is used is counted by the tokens sent and written, at the
// model's own rates), never more; without the binding (the Node server) or past the day's share, the patterns of
// server/core/npc-text.js write them instead.
const MODEL = '@cf/google/gemma-3-12b-it';
// Neurons per million tokens in and out (Workers AI's price list for the model; a guess on the safe side)
const RATES = { in: 31371, out: 50560 };
const TOKENS = (s) => Math.ceil(String(s).length * 1.3);
const DAY = 86400000;

export function createAi({ binding = null, q, clock = Date.now, daily = 10000, share = 0.9, model = MODEL }) {
  const cap = Math.floor(daily * share);
  const dayOf = (ms) => Math.floor((ms + 9 * 3600000) / DAY);
  function used(now = clock()) {
    const from = (dayOf(now) * DAY) - 9 * 3600000;
    const r = q('SELECT COALESCE(SUM(neurons), 0) AS n, COUNT(*) AS c FROM npc_ai WHERE at >= ?').get(from);
    return { neurons: r.n, calls: r.c, cap };
  }
  // one job: the prompt, the model's answer kept (or nothing, when there is no room or no binding)
  async function write(job, now = clock()) {
    if (!binding) return null;
    const room = cap - used(now).neurons;
    const prompt = promptOf(job);
    if (!prompt) return null;
    const guess = (TOKENS(prompt.system + prompt.user) * RATES.in + 200 * RATES.out) / 1e6;
    if (room < guess) return null;
    let text = '';
    try {
      const out = await binding.run(model, { messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], max_tokens: prompt.max || 160 });
      text = String((out && (out.response || out.result || '')) || '').trim().slice(0, 400);
    } catch (e) {
      console.error('npc ai failed', e && e.message);
      return null;
    }
    if (!text) return null;
    const neurons = (TOKENS(prompt.system + prompt.user) * RATES.in + TOKENS(text) * RATES.out) / 1e6;
    q('INSERT INTO npc_ai (at, kind, ref, text, neurons) VALUES (?, ?, ?, ?, ?)').run(now, job.kind, String(job.ref || ''), text, Math.round(neurons * 100) / 100);
    return text;
  }
  return {
    on: !!binding,
    cap,
    used,
    // the jobs waiting, as many as the day's share allows (the newest first: the speech of today over yesterday's)
    async run(jobs, now = clock()) {
      let n = 0;
      for (const job of jobs.slice(-12).reverse()) {
        if (used(now).neurons >= cap) break;
        if (await write(job, now)) n++;
      }
      return n;
    },
    text(kind, ref) {
      const r = q('SELECT text FROM npc_ai WHERE kind = ? AND ref = ? ORDER BY id DESC LIMIT 1').get(kind, String(ref));
      return r ? r.text : null;
    }
  };
}

// what the model is asked (in Japanese: the town's own words, short, plain, no names of real people or companies)
function promptOf(job) {
  const system = 'あなたは架空の国「ヴェルノア共和国」の住民の言葉を書く係です。実在の人物・企業・地名は出さず、差別や暴力の表現は使いません。日本語で、短く、自然な話し言葉で書いてください。';
  switch (job.kind) {
    case 'speech': return { system, user: `${job.district}の新しい区長「${job.name}」の就任あいさつを2〜3文で。公約：${job.platform}。`, max: 160 };
    case 'venture': return { system, user: `${job.company}が始めた新事業「${job.name}」の市民向けの短い告知文を2文で。`, max: 120 };
    case 'voice': return { system, user: `${job.age}歳・${job.job}の${job.name}さんの、今の心の声を1文で。状況：${job.mood}。`, max: 80 };
    case 'street': return { system, user: `${job.district}に住む${job.age}歳の住民の、${job.topic}についての短いつぶやきを1文で。`, max: 80 };
    case 'meeting': return { system, user: `${job.company}の会議「${job.title}」の議事録の要約を3文で。結論：${job.result}。`, max: 160 };
    default: return null;
  }
}
