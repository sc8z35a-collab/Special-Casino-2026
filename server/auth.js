// Session tokens, recovery codes and user-supplied text validation.
import crypto from 'node:crypto';
import { ApiError } from './http.js';

export function newToken() { return crypto.randomBytes(32).toString('base64url'); }
export function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// 16 symbols of Crockford base32 = 80 random bits, shown as XXXX-XXXX-XXXX-XXXX.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode() {
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += CROCKFORD[bytes[i] & 31];
  return s.match(/.{4}/g).join('-');
}
// Accepts lower case, spaces, missing dashes and the usual look-alikes.
export function normalizeRecoveryCode(code) {
  return String(code || '').normalize('NFKC').toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

const NAME_CHARS = /^[A-Za-z0-9_\-ぁ-ゖァ-ヺー・々〆一-鿿㐀-䶿]+$/u;
// Names that could pass for staff. Short ASCII words only match the whole name.
const RESERVED_EXACT = ['gm', 'root', 'staff'];
const RESERVED_PART = ['admin', 'system', 'moderator', 'official', 'support', 'blockbuster',
  '運営', '管理者', '管理人', 'システム', '公式', 'サポート', 'スタッフ'];

// Usernames: 2-12 characters of Japanese (kana/kanji), ASCII letters, digits, "_", "-", "ー", "・".
export function cleanName(raw) {
  const name = String(raw ?? '').normalize('NFKC').trim();
  const len = Array.from(name).length;
  if (len < 2 || len > 12) throw new ApiError(400, 'name_length', 'ユーザー名は2〜12文字にしてください');
  if (!NAME_CHARS.test(name)) throw new ApiError(400, 'name_chars', 'ユーザー名には日本語・英数字・「_」「-」だけが使えます');
  if (/^[_\-ー・]+$/.test(name)) throw new ApiError(400, 'name_chars', 'ユーザー名に文字か数字を含めてください');
  const key = name.toLowerCase();
  if (RESERVED_EXACT.includes(key) || RESERVED_PART.some((r) => key.includes(r))) {
    throw new ApiError(400, 'name_reserved', 'このユーザー名は使えません');
  }
  return { name, key };
}

// Chat text: NFC, no control characters, at most 3 consecutive line breaks, 1-300 characters.
export function cleanText(raw, max = 300) {
  let text = String(raw ?? '').normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  const chars = Array.from(text);
  if (!chars.length) throw new ApiError(400, 'empty', 'メッセージを入力してください');
  if (chars.length > max) throw new ApiError(400, 'too_long', `メッセージは${max}文字までです`);
  return text;
}
