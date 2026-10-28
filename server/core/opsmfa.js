// RFC 6238, SHA-1 / six digits / 30 seconds. Secrets use the host key;
// phrases and recovery codes are one-way hashes. Only staff can enroll.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { keyFrom, sealText, openText, hashPassword, verifyPassword, sha256 } from './auth.js';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += ABC[(value >>> bits) & 31]; } }
  if (bits) out += ABC[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of s) { const n = ABC.indexOf(c); if (n < 0) throw Error('Invalid secret'); value = (value << 5) | n; bits += 5; if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); } }
  return Buffer.from(out);
}
export function totp(secret, step, digits = 6) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(b).digest(), offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
function matchStep(secret, code, last = -1, at = Date.now()) {
  if (!/^\d{6}$/.test(String(code || '')) || !secret) return -1;
  const now = Math.floor(at / 30000);
  for (const step of [now, now - 1, now + 1]) {
    if (step > last && crypto.timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(String(code)))) return step;
  }
  return -1;
}
// the pages open to a developer who has not set an extra login up yet (REQUIRE_DEV_MFA): the setting up itself
const SETUP = /^\/api\/ops\/(?:profile(?:\/|$)|me$|enter$)/;

export function createOpsMfa({ q, tx, secret, ops, opsLog, isDeveloper = () => false, requireDevMfa = false, revokeStreams = () => {}, clock = Date.now }) {
  const key = keyFrom(secret, 'ops-mfa');
  const row = id => q('SELECT * FROM ops_mfa WHERE user_id = ?').get(id);
  const status = u => { const r = row(u.id); return { mode: r?.mode || 0, recoveryLeft: r ? JSON.parse(r.recovery).length : 0 }; };
  const bad = () => new ApiError(403, 'mfa_invalid', '認証コード・確認フレーズまたは復旧コードが正しくありません。使用済みコードは再利用できません');
  async function verify(u, body) {
    const r = row(u.id);
    if (!r?.mode) return 0;
    if (!body.otp && !body.recovery) throw new ApiError(403, 'mfa_required', r.mode === 3 ? '認証コードと専用確認フレーズを入力してください' : '認証アプリの6桁コードを入力してください', { mode: r.mode });
    if (r.mode === 3 && (typeof body.phrase !== 'string' || !await verifyPassword(body.phrase, r.phrase_hash))) throw bad();
    const backups = JSON.parse(r.recovery), recoveryText = typeof body.recovery === 'string' ? body.recovery.trim().toUpperCase() : '';
    const recovery = recoveryText ? sha256(recoveryText) : '';
    const step = recovery ? -1 : matchStep(openText(key, r.secret), body.otp, r.last_step, clock());
    if (recovery ? !backups.includes(recovery) : step < 0) throw bad();
    // A second request must not consume the same code while password hashing awaits.
    const changed = recovery
      ? q('UPDATE ops_mfa SET recovery = ? WHERE user_id = ? AND version = ? AND recovery = ?').run(JSON.stringify(backups.filter(h => h !== recovery)), u.id, r.version, r.recovery)
      : q('UPDATE ops_mfa SET last_step = ? WHERE user_id = ? AND version = ? AND last_step < ?').run(step, u.id, r.version, step);
    if (!changed.changes) throw bad();
    return r.version;
  }
  async function credentials(u, body) {
    if (typeof body.password !== 'string' || !await verifyPassword(body.password, u.password_hash)) throw new ApiError(403, 'bad_password', '現在のパスワードが違います');
    await verify(u, body);
  }
  const guard = (u, req = null) => {
    if (!ops.isOperator(u)) return;
    const r = row(u.id);
    if (r?.mode && u.opsMfaVersion !== r.version) throw new ApiError(403, 'mfa_required', '運営サイトへ追加認証付きでログインし直してください', { mode: r.mode });
    // the developer's account can do everything: with REQUIRE_DEV_MFA it is not used before an extra login is set up
    if (requireDevMfa && !r?.mode && isDeveloper(u) && !(req && SETUP.test(req.path))) {
      throw new ApiError(403, 'mfa_setup_required', '開発者のアカウントは、追加認証（認証アプリ）を設定してから運営サイトを使えます。プロフィールから設定してください');
    }
  };
  return { status, verify, guard, version: id => row(id)?.version || 0, routes: {
    'GET /api/ops/profile': (req, u) => { ops.need(u); return { id: u.id, name: u.name, avatar: u.avatar, mfa: status(u) }; },
    'POST /api/ops/profile/mfa/begin': async (req, u) => {
      ops.need(u); const b = await req.json(4096); await credentials(u, b);
      req.revalidate?.(); ops.need(u);
      const seed = base32(crypto.randomBytes(20)), until = clock() + 10 * 60000;
      q(`INSERT INTO ops_mfa (user_id, pending_secret, pending_until) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET pending_secret = excluded.pending_secret, pending_until = excluded.pending_until`).run(u.id, sealText(key, seed), until);
      return { secret: seed, uri: `otpauth://totp/${encodeURIComponent('Two State:' + u.name)}?secret=${seed}&issuer=Two%20State&algorithm=SHA1&digits=6&period=30`, until };
    },
    'POST /api/ops/profile/mfa/enable': async (req, u) => {
      ops.need(u); const b = await req.json(4096), r = row(u.id);
      if (![2, 3].includes(b.mode) || !r?.pending_secret || r.pending_until <= clock()) throw new ApiError(400, 'setup_expired', '認証アプリの登録を最初からやり直してください');
      if (typeof b.password !== 'string' || !await verifyPassword(b.password, u.password_hash)) throw new ApiError(403, 'bad_password', '現在のパスワードが違います');
      const step = matchStep(openText(key, r.pending_secret), b.otp, -1, clock());
      if (step < 0) throw bad();
      if (b.mode === 3 && (typeof b.newPhrase !== 'string' || Array.from(b.newPhrase).length < 12 || Array.from(b.newPhrase).length > 64 || b.newPhrase === b.password)) throw new ApiError(400, 'bad_phrase', 'パスワードと異なる12〜64文字の専用確認フレーズを入力してください');
      const phraseHash = b.mode === 3 ? await hashPassword(b.newPhrase) : '';
      req.revalidate?.(); ops.need(u);
      const recovery = Array.from({ length: 10 }, () => crypto.randomBytes(10).toString('hex').toUpperCase());
      const version = r.version + 1;
      tx(() => {
        const updated = q(`UPDATE ops_mfa SET mode = ?, secret = ?, phrase_hash = ?, recovery = ?, last_step = ?, version = ?, pending_secret = '', pending_until = 0
          WHERE user_id = ? AND pending_secret = ? AND version = ? AND pending_until > ?`).run(b.mode, r.pending_secret, phraseHash, JSON.stringify(recovery.map(sha256)), step, version, u.id, r.pending_secret, r.version, clock());
        if (!updated.changes) throw new ApiError(409, 'setup_changed', '登録状態が変わりました。最初からやり直してください');
        q('UPDATE sessions SET ops_mfa_version = ? WHERE token_hash = ?').run(version, u.tokenHash);
        opsLog.add({ actor: u, action: 'ops_mfa_enable', req, summary: `${u.name}が${b.mode}段階認証を設定` });
      });
      revokeStreams(u.id);
      return { mfa: status(u), recovery };
    },
    'POST /api/ops/profile/mfa/disable': async (req, u) => {
      ops.need(u); const b = await req.json(4096); await credentials(u, b);
      req.revalidate?.(); ops.need(u);
      tx(() => {
        q("UPDATE ops_mfa SET mode = 0, secret = '', phrase_hash = '', recovery = '[]', pending_secret = '', pending_until = 0, version = version + 1 WHERE user_id = ?").run(u.id);
        opsLog.add({ actor: u, action: 'ops_mfa_disable', req, summary: `${u.name}が追加認証を解除` });
      });
      revokeStreams(u.id);
      return { mfa: status(u) };
    }
  } };
}
