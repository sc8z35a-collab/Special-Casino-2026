// The automatic filter (自動フィルタリングシステム) for what players send as
// messages: only text. The game sends a chat message as a small JSON object
// with text and where it goes; a request to one of these routes that carries
// anything else (another kind of body, bytes that are not text, fields the
// game never sends, a value that is not text, a file hidden in the text: a
// data: URL, a long run of base64, control bytes) is stopped by the host
// before the server proper sees it (server/cloudflare/worker.js, the Node
// server). The server only gets a note of it, never the content: the 緊急
// log entry with all that is known, and the sender's chat stops until an
// operator lets it go again (server/core/api.js: filtered()).

// the routes, and the fields the game sends to each
export const CHAT_ROUTES = {
  'POST /api/messages': ['text', 'to', 'group'],
  'POST /api/home/chat': ['text', 'room'],
  'POST /api/hub/say': ['text', 'to'],
  'POST /api/official/feedback': ['text', 'kind'],
  'POST /api/report': ['text', 'user', 'kind', 'place'],
  'POST /api/report/message': ['text', 'message', 'kind']
};
const IDS = new Set(['to', 'group', 'room', 'user', 'message']);
const WORDS = new Set(['kind', 'place']);
export const REASONS = {
  not_json: 'テキスト以外の形式で送られた',
  binary: '文字ではないデータ（ファイルなど）が入っていた',
  bad_json: '形が壊れたデータだった',
  extra_field: 'ゲームが送らない項目（添付など）が入っていた',
  not_text: '文字ではない値が入っていた',
  control: '目に見えない制御文字（ファイルの中身など）が入っていた',
  data_url: 'ファイル（data: URL）が埋め込まれていた',
  base64: 'ファイル（base64 の長い文字列）が埋め込まれていた',
  too_big: '大きすぎるデータだった'
};
const MAX = 256 * 1024;
// invisible control characters: a file's bytes read as text are full of them
// (tab, line breaks and the two old page breaks some apps copy are text; a
// stray one is cleaned away by the server as before)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F]/g;
const CONTROL_MAX = 8;
const DATA_URL = /data:[\w.+-]+\/[\w.+-]+(?:;[\w=.+-]+)*;base64,[A-Za-z0-9+/]{40,}/i;
const B64_RUN = /[A-Za-z0-9+/]{400,}={0,2}/g;
// a long run of letters is a file only when it looks like one: upper and
// lower case and digits mixed, and 20 different characters or more (wwwww or
// a row of keys mashed is not)
const looksLikeFile = (run) => new Set(run).size >= 20 && /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run);

// A request to a chat route: null when it is only text, else { reason, keys }.
export function inspect(contentType, bytes) {
  if (!/^application\/json\b/i.test(String(contentType || ''))) return { reason: 'not_json', keys: [] };
  if (bytes.length > MAX) return { reason: 'too_big', keys: [] };
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { reason: 'binary', keys: [] }; }
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { return { reason: 'bad_json', keys: [] }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { reason: 'bad_json', keys: [] };
  return null;
}

// The fields of a parsed body against what the game sends to `route`.
export function inspectBody(route, body) {
  const allowed = CHAT_ROUTES[route];
  const keys = Object.keys(body).slice(0, 30);
  if (keys.some((k) => !allowed.includes(k))) return { reason: 'extra_field', keys };
  for (const k of keys) {
    const v = body[k];
    if (k === 'text') {
      if (typeof v !== 'string') return { reason: 'not_text', keys };
      const ctl = v.match(CONTROL);
      if (ctl && (ctl.length >= CONTROL_MAX || ctl.includes('\u0000'))) return { reason: 'control', keys };
      if (DATA_URL.test(v)) return { reason: 'data_url', keys };
      for (const run of v.match(B64_RUN) || []) if (looksLikeFile(run)) return { reason: 'base64', keys };
    } else if (IDS.has(k)) {
      if (!(typeof v === 'number' || (typeof v === 'string' && /^\d{1,15}$/.test(v)))) return { reason: 'not_text', keys };
    } else if (WORDS.has(k)) {
      if (typeof v !== 'string' || v.length > 40) return { reason: 'not_text', keys };
    }
  }
  return null;
}

// Everything at once: the request's route, content type and bytes. Returns
// null (let it through) or the note for the server: { route, reason, keys,
// size, sha256 } (sha256: the bytes' hash, so the same thing can be told
// again without keeping it).
export async function screenChat(route, contentType, bytes) {
  if (!CHAT_ROUTES[route]) return null;
  let found = inspect(contentType, bytes);
  if (!found) found = inspectBody(route, JSON.parse(new TextDecoder().decode(bytes) || '{}'));
  if (!found) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
  return { route, reason: found.reason, keys: found.keys, size: bytes.length, contentType: String(contentType || '').slice(0, 100), sha256 };
}

// what the sender's game is told
export const BLOCKED = {
  code: 'filtered',
  message: 'テキスト以外のものは送れません。自動フィルタリングシステムが送信を止め、運営に知らせました。運営が確認するまでチャットは使えません。'
};
