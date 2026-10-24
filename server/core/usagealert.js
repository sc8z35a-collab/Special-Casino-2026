// The month's server usage reaching the red (over 70% of what the plan
// includes) or nearly all of it (over 90%) is a danger for the money and for
// the game staying up: it is told to Discord once for each step of each month,
// with what is using it and where the sent bytes went, and with the links to
// the operator site and security HOME (server/core/discord.js). The server
// tab shows the same share in colour (green past 10%, blue 30%, purple 50%,
// red 70%; server/core/stats.js).
export const STEPS = [70, 90];

const MB = 1048576;
const size = (n) => (n >= MB ? `${(n / MB).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);

// report() → stats.report(); discord: server/core/discord.js; every: how often to look (ms)
export function createUsageAlert({ q, report, discord, clock = Date.now, every = 60000 }) {
  let at = 0;
  const read = () => {
    try { const r = q("SELECT value FROM meta WHERE key = 'usage_alert'").get(); return r ? JSON.parse(r.value) : {}; } catch { return {}; }
  };
  const write = (v) => q("INSERT INTO meta (key, value) VALUES ('usage_alert', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));
  return {
    // looked at most once in `every`; returns the step told (70 or 90), or null
    check(now = clock()) {
      if (now - at < every) return null;
      at = now;
      const r = report();
      const done = read();
      const was = done.month === r.month ? done.step || 0 : 0;
      const step = STEPS.filter((x) => r.percent > x).pop() || 0;
      if (step <= was) return null;
      write({ month: r.month, step });
      const top = r.shares[0];
      const b = r.breakdown;
      discord.danger(step >= 90 ? '🔴' : '📈', `今月のサーバー使用量が込みの分の${step}%を超えました（いま ${Number(r.percent).toFixed(1)}%）`, [
        top ? `・いちばん多い項目：${top.label}（${Number(top.percent).toFixed(1)}%）` : '',
        ...r.shares.slice(1).map((x) => `・次に多い項目：${x.label}（${Number(x.percent).toFixed(1)}%）`),
        `・今月の通信の内訳：映像通信 ${size(b.video)}・プレイヤーの処理 ${size(b.game)}・音声の合図 ${size(b.voice)}`,
        `・今月の料金の目安：$${Number(r.usd).toFixed(2)}（約${Math.round(r.yen).toLocaleString('en-US')}円）`,
        step >= 90 ? '・使用量が上限に近いため、運営の画面を見る機能は新しく始められません（100%で進行中のものも終わります）' : ''
      ]);
      return step;
    }
  };
}
