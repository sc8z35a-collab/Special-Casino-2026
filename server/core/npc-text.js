// The people's words (server/core/npc-model.js): what they say in the 会議室, the reports their departments write,
// the reason a decision was made, the line in their head (心の声) and a word between two of them — made from patterns
// and the numbers of the moment (no generative AI here; the few lines it writes are server/core/npc-ai.js's).
import { NPC, CORP } from './rules.js';
import { T, E, FL, NT, ageOf } from './npc-pop.js';

const m = (n) => NPC.money(n);
const pick = (r, list) => list[r ? r.int(list.length) : 0];

// a word in a meeting, by the role and the stance
export function remark(W, o, p, role, stance, ctx, r) {
  if (stance === 'stop') return pick(r, [
    `ストップ係として、この案は止めます。${ctx.afford ? 'リスクが会社の体力に見合いません。' : '今の手元資金では実行できません。'}`,
    `待ってください。手元資金は固定費の${ctx.runway.toFixed(1)}か月分です。承認できません。`,
    '規定により差し止めます。条件を見直して再提出してください。'
  ]);
  if (role === '経理部長') return stance === 'for' ? pick(r, [`費用${m(p.cost)}は手元資金の範囲で賄えます。`, `資金繰りに問題はありません（固定費の${ctx.runway.toFixed(1)}か月分）。`])
    : stance === 'against' ? pick(r, [`費用${m(p.cost)}は今期の予算を超えます。反対です。`, '数字の裏付けが弱い。経理としては賛成できません。']) : '費用は許容範囲ですが、効果の測定方法を決めておくべきです。';
  if (role === 'CEO') return stance === 'for' ? pick(r, ['方向性は正しい。進めよう。', '市民の財布は限られている。先に動いた者が勝つ。', 'やろう。ただし3か月で結果を見る。'])
    : stance === 'against' ? pick(r, ['今やるべきことではない。', '数字が足りない。出直してほしい。']) : '判断を社長に任せる。';
  if (role === '社長') return stance === 'for' ? pick(r, ['現場の声とも合っている。賛成だ。', '実行部隊は用意できる。']) : stance === 'against' ? pick(r, ['現場がついてこない。反対だ。', 'タイミングが悪い。']) : '条件付きで様子を見たい。';
  if (stance === 'for') return pick(r, [`${p.title}は必要です。お客様の動きがそれを示しています。`, '提案部署として責任を持って進めます。', 'このままでは他社に市民を取られます。']);
  if (stance === 'against') return pick(r, ['効果が見えません。', '人手が足りない中で無理があります。', 'お客様の反応が読めない。慎重にすべきです。']);
  return pick(r, ['どちらとも言えません。', '詳細を詰めてから判断したい。']);
}

export function accounts(o, mth, runway, warn) {
  if (!mth) return `${o.name} 経理部：月次の数字はまだありません。手元資金は固定費の${runway.toFixed(1)}か月分です。`;
  const pl = mth.pl;
  return `${o.name} 経理部より。${mth.label}は売上高${m(pl.sales)}、営業利益${m(pl.op)}、純利益${m(pl.net)}でした。手元資金は固定費の${runway.toFixed(1)}か月分です。` +
    (warn.length ? `注意点：${warn.join('、')}。` : '特に問題はありません。');
}

export function analysis(W, o, rows, threats, ventures) {
  const top = rows.slice(0, 3).map((x) => `${x.name}（${(x.share * 100).toFixed(1)}%）`).join('、');
  const t = threats.length ? `前月から伸びたのは${threats.map((x) => `${x.name}（${x.move > 0 ? '+' : ''}${(x.move * 100).toFixed(2)}pt）`).join('、')}。` : '大きく伸びた会社はありません。';
  const v = ventures.length ? `他社の新事業：${ventures.slice(0, 3).map((x) => `${x.company}「${x.name}」顧客${x.customers}人`).join('、')}。` : '';
  return `市民の支出に占める各社の割合は、${top}の順です。${t}${v}${o.id === 'magita' ? '当社は車と車用品の需要の変化に注意が必要です。' : '求人の動きに注意が必要です。'}`;
}

export function lab(l, day) {
  const spec = NPC.labThemes.find((t) => t.id === l.theme);
  const name = spec ? spec.name : l.theme;
  if (l.done) return `${l.name}：「${name}」は${l.ok ? '成功裏に完了' : '目標未達で終了'}。`;
  const left = l.due ? Math.max(0, l.due - day) : 0;
  return `${l.name}：「${name}」の研究中（${l.size}人）。完了予定まであと${left}日。`;
}

export function venture(o, v, row, action, lost) {
  const act = { keep: '現状維持', grow: '事業を拡大', shrink: '規模を縮小', close: '撤退を決定' }[action] || '現状維持';
  return `${v.name}（${o.name}）月次：売上${m(row.rev)}、費用${m(row.cost)}、顧客${row.customers}人、担当${row.staff}人、品質${row.quality}点。累計損益${m(lost)}。判断：${act}。`;
}
export function ventureThought(o, v, row, action) {
  if (action === 'grow') return `顧客が増えている。人を増やして一気に広げたい。`;
  if (action === 'shrink') return `赤字が続いている。いったん規模を落として、本当に必要とする人に絞る。`;
  if (action === 'close') return `ここで撤退するのが会社のためだ。悔しいが、学んだことは次に生かす。`;
  return row.customers ? `${row.customers}人のお客様がいる。まだ伸ばせる。` : 'まだ知られていない。口コミが広がるのを待つ。';
}

// the reason a big decision was made (or not), in a few lines
export function reason(W, x) {
  const P = W.P, i = x.i, car = x.car ? (globalThis.BR.CONFIG.cars.find((c) => c.id === x.car) || {}).name : '';
  if (x.kind === 'car') return `${car}を買った。${x.loan ? `テネシスで${m(x.loan)}のローンを組んだ。` : '現金で払った。'}${x.tradeIn ? `前の車は${m(x.tradeIn)}で下取りに出した。` : ''}先読み${x.futures}通りの結果、1年後も暮らしは成り立つと判断した。`;
  if (x.kind === 'car-no') return `${car}は見送った。先読み${x.futures}通りでは、${x.loan ? 'ローンの返済が' : '貯金の減り方が'}重すぎると判断した。`;
  return '';
}

// the line in someone's head now (心の声): from what weighs on them most
export function voice(W, i, day) {
  const P = W.P, age = ageOf(P, i, day), mood = P.emo[i * 5 + E.mood];
  if (P.home[i] === 4) return '今夜はどこで寝よう。仕事さえ見つかれば…';
  if (P.home[i] === 3) return '世話になりっぱなしだ。早く部屋を借り直したい。';
  if (P.flags[i] & FL.striking) return 'ここで引いたら来年も同じだ。ストは続ける。';
  if (P.flags[i] & FL.mayor) return '公約はまだ半分。区の財布と相談だ。';
  if (P.flags[i] & FL.candidate) return '投票まであと少し。一人でも多くと話したい。';
  if (P.grief[i] > 150) return 'あの人がいないのにまだ慣れない。';
  if (P.debt[i] > 0 && P.dkind[i] === 2) return '返済日が近い。利息だけでも払わないと。';
  if (P.job[i] === NPC.job.none && age < 65) return '求人サイトをもう一度見てみよう。';
  let theme = 0, most = 0;
  for (let k = 0; k < 8; k++) if (P.disc[i * 8 + k] > most) { most = P.disc[i * 8 + k]; theme = k; }
  if (most > 170) return ['税金、また上がる気がする。', '年金、これで足りるのかな。', '最近なんでも高い。', '給料がもう少し上がればなあ。', 'お金持ちばかり得してないか。', 'MAGITAの値上げ、ひどくない？', 'Dtradeの手数料が高すぎる。', '区長の公約、まだ1つも守られてない気がする。'][theme];
  if (P.spun[i] && mood > 190) return '今日はツイてる。もう少しだけ回そうか。';
  if (P.car[i] && P.tr[i * NT + T.car] > 200) return '次はもっと速いのがほしい。';
  if (P.tr[i * NT + T.game] > 200) return '新作の評判、気になるな。';
  if (age >= 65) return '孫の顔を見に行こうかな。';
  if (mood > 190) return 'いい一日だ。';
  if (mood < 90) return '少し疲れた。';
  return '今日もいつも通り。';
}

// a word between two people (the 街ライブ's feed of the town's talk)
const SAY = {
  0: ['税金、また上がるらしいよ', '消費税の話、聞いた？'],
  1: ['年金の保険料、また上がるの？', '年金って本当にもらえるのかな'],
  2: ['最近、物が高くない？', 'ジンクスの特売、行った？'],
  3: ['ボーナス少なかったな', '給料上がらないね'],
  4: ['あの人、また新車買ったって', 'お金持ちはいいよね'],
  5: ['MAGITAの値上げ、ひどいよね', '車、今は買い時じゃないかも'],
  6: ['カジノの手数料、高すぎない？', 'Dtradeの株、どう思う？'],
  7: ['区長、何してるんだろう', '次の区長選、誰に入れる？']
};
export function line(W, c, r) {
  const a = W.card(c.i, Math.floor(c.m / 1440)), b = W.card(c.j, Math.floor(c.m / 1440));
  const s = SAY[c.theme] || SAY[2];
  return { at: c.m * 60000, a: a.name, b: b.name, text: `${a.name.split(' ')[0]}：${s[r ? r.int(s.length) : 0]}`, district: W.P.ldist[c.i] };
}

// a piece of news from a person's event (a big win, a car, a death of someone known …), or null
export function eventNews(W, e, day) {
  const c = (i) => W.card(i, day);
  switch (e.kind) {
    case 'bigwin': return e.mult >= 1000 ? { kind: 'casino', district: W.P.ldist[e.i], text: `カジノで大当たり：${c(e.i).name}さんが${e.mult}倍（${m(e.n)}）` } : null;
    case 'death': return e.famous ? { kind: 'death', district: W.P.dist[e.i], text: `${e.name}氏（${e.age}歳・${e.job}）が亡くなりました` } : null;
    case 'elected': return null;
    case 'street': return null;
    default: return null;
  }
}
