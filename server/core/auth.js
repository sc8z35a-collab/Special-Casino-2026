// Session tokens, passwords, recovery codes, stream tickets and validation of
// what players type. Runs on Node and on Cloudflare Workers (nodejs_compat).
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';

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

// A short text sealed with `key` (32 bytes, AES-256-GCM): the operators can
// read players' 引き継ぎコード back, a copy of the database alone cannot.
export function sealText(key, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}
export function openText(key, sealed) {
  try {
    const b = Buffer.from(String(sealed || ''), 'base64url');
    if (b.length < 29) return '';
    const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}
export function keyFrom(secret, purpose) { return crypto.createHash('sha256').update(`${secret}:${purpose}`).digest(); }

/* ------------------------------------------------------------ names --- */

const NAME_CHARS = /^[A-Za-z0-9_\-ぁ-ゖァ-ヺー・々〆一-鿿㐀-䶿]+$/u;
// Names that could pass for staff. Short ASCII words only match the whole name.
const RESERVED_EXACT = ['gm', 'root', 'staff'];
const RESERVED_PART = ['admin', 'system', 'moderator', 'official', 'support', 'blockbuster',
  '運営', '管理者', '管理人', 'システム', '公式', 'サポート', 'スタッフ'];

// The key that makes two names "the same": width, case and compatibility forms folded.
export function nameKey(raw) { return String(raw ?? '').normalize('NFKC').trim().toLowerCase(); }

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

/* ------------------------------------------------------------ text --- */

// Chat text: NFC, no control characters, at most 3 consecutive line breaks, 1-300 characters.
export function cleanText(raw, max = 300) {
  const text = String(raw ?? '').normalize('NFC')
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

/* ------------------------------------------------------------ passwords --- */

// PBKDF2-SHA256 through WebCrypto (100 000 rounds is the Workers maximum).
const ROUNDS = 100000;

export function cleanPassword(raw) {
  const pw = String(raw ?? '');
  const len = Array.from(pw).length;
  if (len < 4) throw new ApiError(400, 'password_short', 'パスワードは4文字以上にしてください');
  if (len > 64) throw new ApiError(400, 'password_long', 'パスワードは64文字までです');
  return pw;
}

async function derive(pw, salt, rounds) {
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  return Buffer.from(bits);
}

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await derive(pw, salt, ROUNDS);
  return `pbkdf2$${ROUNDS}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(pw, stored) {
  const m = /^pbkdf2\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(String(stored || ''));
  if (!m) return false;
  const want = Buffer.from(m[3], 'base64url');
  const got = await derive(String(pw ?? ''), Buffer.from(m[2], 'base64url'), Number(m[1]));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ------------------------------------------------------------ stream tickets --- */

// Short-lived, signed: opening the live stream needs no stored state, which
// suits a Durable Object that may sleep between two requests.
export function signTicket(secret, userId, ttlMs = 60000) {
  const body = `${userId}.${Date.now() + ttlMs}`;
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyTicket(secret, ticket) {
  const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(String(ticket || ''));
  if (!m || Number(m[2]) < Date.now()) return null;
  const want = crypto.createHmac('sha256', secret).update(`${m[1]}.${m[2]}`).digest();
  const got = Buffer.from(m[3], 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? Number(m[1]) : null;
}
