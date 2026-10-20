// The chat filter: words that must not reach other players (abuse such as
// 死ね・消えろ・ゴミ used as an insult, and sexual words). Only the words found
// are changed to *** in what the other player gets; the original goes to the
// operator site (server/core/ops.js). Mistakes cost more than misses here:
// every pattern is written to stay away from ordinary words (ゴミ箱, 楽しいしね,
// 動かす, ヒエログリフ, いまんところ …) and server/test/filter.test.js keeps a
// list of everyday sentences that must pass untouched.

// k: matched on the text as written (NFKC, lower case) — for katakana words
// whose hiragana form is an everyday word; h: matched with katakana folded to
// hiragana (シネ and しね alike), so kana in h patterns are written in hiragana
const END = '(?=$|[\\s、。，．,.!！?？・…〜~ーｗwよやぞぜっなねわ「」『』()（）])';
const START = '(?<=^|[\\s、。，．,.!！?？・…〜~「」『』()（）]|お前|おまえ|おめえ|てめえ|てめー|きさま)';
const WHO = '(?:お前|おまえ|おめえ|てめえ|てめー|きさま|貴様|こいつ|あいつ|おまえら|お前ら|おめーら|そいつ)';
// ゴミ in everyday words (ゴミ箱, ゴミ出し, ゴミの日 …): never an insult
const NOT_TRASH = '(?!箱|ばこ|袋|ぶくろ|出し|だし|捨|すて|収集|しゅうしゅう|拾|ひろ|置き|おき|処理|しょり|分別|ぶんべつ|の日|のひ|当番|とうばん|屋敷|やしき|山|やま|だらけ|拾い)';

const RULES = [
  // ----- abuse
  { h: '死ね(?![るばなずまけそたてへ])', word: '死ね' },
  { h: START + '(?:しね|氏ね)' + END, word: 'しね' },
  { h: '消えろ|' + START + 'きえろ' + END, word: '消えろ' },
  { h: '失せろ|' + START + 'うせろ' + END, word: '失せろ' },
  { h: 'くたばれ', word: 'くたばれ' },
  { h: '黙れ|' + START + 'だまれ' + END, word: '黙れ' },
  { h: 'ぶっ殺|ぶっころ|ぶち殺|殺すぞ|ころすぞ|殺してやる|ころしてやる', word: '殺す' },
  // ゴミ only as an insult: said of someone, or with the words that make it one
  { h: '(?<=' + WHO + '(?:は|って|まじ|まじで|ほんと|ほんとに|本当に|も)?)ごみ' + NOT_TRASH, word: 'ゴミ' },
  { h: 'ごみ(?:野郎|やろう|やろー|くず|屑|かす|人間|ぷれいやー|以下|乙|が[!！]|め[!！]|すぎ|過ぎ)', word: 'ゴミ' },
  { h: '(?:この|その|あの)ごみ(?:め|野郎|やろう|やろー)|(?:この|その)ごみが[!！]', word: 'ゴミ' },
  { h: 'ごみ(?:だな|だろ|かよ|じゃん|だわ)' + END, word: 'ゴミ' },
  { h: '^\\s*ごみ\\s*[!！]*\\s*$', word: 'ゴミ' },
  { k: '(?<![ァ-ヶー])カス(?![ァ-ヶーてたとみりれめけはかが])', word: 'カス' },
  { k: '(?<![ァ-ヶー])クズ(?![ァ-ヶーもれすし])|(?<![一-龥])屑(?![一-龥])', word: 'クズ' },
  { k: '(?<![ァ-ヶー])ブス(?![ァ-ヶーッっと])', word: 'ブス' },
  { h: '(?<=^|[\\s、。，．,.!！?？・…〜~「」『』()（）]|まじ|まじで|ほんと|超|ちょう|くそ|お前|おまえ)(?:きもい|きめえ|きめぇ|きしょい)', word: 'キモい' },
  { h: 'くそ(?:野郎|やろう|やろー|がき|じじい|じじぃ|ばばあ|ばばぁ)|くそが[!！]|くそが$', word: 'クソ' },
  { h: 'きちがい|基地外|気違い', word: 'きちがい' },
  { k: '(?<![ァ-ヶー])ガイジ(?![ァ-ヶー])|池沼|知恵遅れ', word: '差別語' },
  { h: '低能|ばかやろう|ばかやろー|馬鹿野郎|あほんだら', word: '暴言' },
  { k: '\\bkys\\b|kill\\s*your\\s*self|\\bgo\\s+die\\b', word: 'kill yourself' },
  { k: '\\bf+u+c+k+(?:ing|er|ed|s)?\\b|\\bshit+(?:ty)?\\b|\\bbitch(?:es)?\\b|\\bcunt\\b|\\bbastard\\b|\\bmotherfucker\\b', word: '英語の暴言' },
  // ----- sexual words
  { h: 'せっくす|(?<![a-z])sex(?![a-z])|せっくる|えっちし(?:よう|たい|て)|えっちな(?:こと|事|動画|画像)', word: 'セックス' },
  { h: 'ちんこ(?!う)|ちんぽ|ちんちん(?!電車)|ぺにす|陰茎', word: '性器' },
  { k: '(?<![ァ-ヶー])マンコ(?![ァ-ヶー])', word: '性器' },
  { h: 'おまんこ|' + START + 'まんこ' + END + '|ゔぁぎな|ばぎな|膣|陰部|くりとりす', word: '性器' },
  { h: 'おっぱい|乳首|ちくび|ぱいぱん|ふぇら(?!ー|ぁ|り)|手まん|中出し|顔射|射精|おなにー|自慰|勃起|童貞|淫乱|やりまん|やりちん|びっち(?!り)|れいぷ|強姦|痴漢|乱交|av女優|えろ動画|えろ画像', word: '性的な言葉' },
  { k: '(?<![ァ-ヶー])エロ(?![ァ-ヶー])', word: 'エロ' },
  { h: '(?<![ぁ-ゖ])(?:えろい|えろすぎ|えろかった)', word: 'エロ' },
  { k: '\\bporn\\w*|\\bpussy\\b|\\bwhore\\b|\\bslut\\b|\\bnudes\\b|\\bboobs?\\b|\\bpenis\\b|\\bvagina\\b', word: '性的な言葉(英語)' }
].map((r) => ({ word: r.word, re: new RegExp(r.k || r.h, 'gu'), on: r.k ? 'k' : 'h' }));

const kataToHira = (c) => {
  const n = c.charCodeAt(0);
  return n >= 0x30a1 && n <= 0x30f6 ? String.fromCharCode(n - 0x60) : c;
};

// The text twice (as written and with katakana folded), each character
// knowing where it came from in the original.
function prepare(text) {
  let k = '', h = '';
  const at = [];
  let i = 0;
  for (const ch of text) {
    const n = ch.normalize('NFKC').toLowerCase();
    for (const c of n) {
      k += c;
      h += kataToHira(c);
      for (let j = 0; j < c.length; j++) at.push(i);
    }
    i += ch.length;
  }
  at.push(i);
  return { k, h, at };
}

// { masked, words, hits: [[start, end] in the original] } — masked === text when nothing was found
export function screen(text) {
  const s = String(text || '');
  if (!s) return { masked: s, words: [], hits: [] };
  const p = prepare(s);
  const spans = [];
  const words = new Set();
  for (const r of RULES) {
    const src = r.on === 'k' ? p.k : p.h;
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(src))) {
      if (!m[0].length) { r.re.lastIndex++; continue; }
      spans.push([p.at[m.index], p.at[m.index + m[0].length]]);
      words.add(r.word);
    }
  }
  if (!spans.length) return { masked: s, words: [], hits: [] };
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push(sp.slice());
  }
  let out = '', from = 0;
  for (const [a, b] of merged) { out += s.slice(from, a) + '***'; from = b; }
  out += s.slice(from);
  return { masked: out, words: [...words], hits: merged };
}

