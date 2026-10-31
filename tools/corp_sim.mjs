// 企業: the companies run on by themselves for years, as the server would (server/core/corp-model.js), to see how
// they go — each fiscal year's sales, profits, staff, money and debt, the dividends and the book share price, and
// the business ties at the end. Nothing is stored.
//   node tools/corp_sim.mjs [--years N] [--seed N] [--player $ a day of the players' money spread over the trades]
import { boot, closeDay, chance, fairValue, outstanding, trade, PROFILES, ties, tieOf } from '../server/core/corp-model.js';
import { CORP } from '../server/core/rules.js';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : def; };
// --invest $: the players' money a day buying new RIRU STUDIO shares at its book price
const years = arg('years', 5), seed = arg('seed', 7), player = arg('player', 0), invest = arg('invest', 0);
const key = Buffer.alloc(32, seed), ch = chance(key);
const launch = CORP.dayOf(Date.UTC(2026, 10, 2));
const { world: w } = boot(key, launch, { prices: { riru: 12000, ice: 30000 } });
const B = (n) => (n / 1e9).toFixed(2).padStart(8);
const rows = [];
for (let d = launch; d < launch + years * 365; d++) {
  // (the players' money, if asked: a car, the Shop, VIP and the バイト every day)
  const flows = player ? {
    carowner: { car: { 'nissan-gt-r': [1, CORP.dayOf(0) + 34000000] } }, jinx: { shop: { omamori: [10, 800000] } },
    daizin: { vip: player * 0.1 }, dtrade: { trade: player * 0.01 }, job: player * 0.2
  } : {};
  if (invest) {
    const s = w.co.riru, price = Math.max(1, Math.round(fairValue(s, PROFILES.get('riru'), w) / outstanding(s)));
    trade(w, 'riru', 'buy', Math.max(1, Math.round(invest / price)), price, d * 86400 + 43200);
  }
  const out = closeDay(w, d, flows, ch);
  for (const r of out.periods) if (r.kind === 'y') rows.push(r);
}
for (const p of CORP.companies) {
  console.log(`\n${p.full}（${p.kind}）`);
  for (const r of rows.filter((x) => x.company === p.id)) {
    console.log(`  ${r.label}  売上高${B(r.pl.sales)}B  粗利${B(r.pl.gross)}B  営業利益${B(r.pl.op)}B  経常${B(r.pl.ord)}B  純利益${B(r.pl.net)}B  社員${String(r.staff).padStart(6)}  現金${B(r.bs.cash)}B  借入${B(r.debt)}B  EPS ${Math.round(r.eps)}`);
  }
  const s = w.co[p.id];
  console.log(`  今: 理論株価 $${Math.round(fairValue(s, p, w) / outstanding(s))}  1株配当 $${s.div.dps}  利益剰余金${B(s.bal.retained)}B`);
}
console.log('\nビジネス友好度');
for (const t of ties()) console.log(`  ${PROFILES.get(t.a).name} × ${PROFILES.get(t.b).name}: ${t.start} → ${tieOf(w, t.a, t.b)}`);
