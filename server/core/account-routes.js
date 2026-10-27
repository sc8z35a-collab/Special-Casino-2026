// Account endpoints share the existing session, recovery, device and audit services.
import { ApiError } from './errors.js';
import { cleanName, cleanPassword, hashPassword, verifyPassword, replaceCredentials, sealText, sha256, normalizeRecoveryCode } from './auth.js';
export function createAccountRoutes({ q, tx, config, limit, rate, nameProblem, deviceRoom, signUp, gameLogin,
  getUser, liftExpired, banState, opsLog, seenOn, createSession, live, CODE_KEY, meDto, setRecovery, DELETED }) {
  return [
    // (device: whether this device may make an account, before the name and icon are picked)
    ['GET /api/name-check', (req) => {
      rate(limit.nameCheck, req.ip);
      const problem = nameProblem(req.query.get('name'));
      return { available: !problem, problem, device: deviceRoom(req) };
    }],

    ['POST /api/register', async (req) => {
      if (config.registration !== 'open') throw new ApiError(403, 'closed', '現在、新規登録は受け付けていません');
      rate(limit.register, req.ip, '登録の試行が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const { name, key } = cleanName(body.name);
      const password = cleanPassword(body.password);
      return signUp(req, { name, key, avatar: body.avatar, password });
    }],

    // name + password, or the recovery code
    ['POST /api/login', async (req) => {
      rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      let u;
      if (body.code !== undefined) {
        const code = normalizeRecoveryCode(body.code);
        if (code.length !== 16) throw new ApiError(400, 'bad_code', '引き継ぎコードは16文字です');
        u = q('SELECT * FROM users WHERE recovery_hash = ?').get(sha256(code));
        if (!u) throw new ApiError(404, 'bad_code', '引き継ぎコードが正しくありません');
      } else {
        u = await gameLogin.verify(body.name, body.password);
        if (u instanceof Error) throw u;
      }
      if (body.code !== undefined) gameLogin.clear(u.name_key);
      const fresh = getUser(u.id);
      if (!fresh || fresh.password_hash !== u.password_hash || fresh.recovery_hash !== u.recovery_hash || fresh.name_key !== u.name_key)
        throw new ApiError(401, 'auth', 'ログイン情報が変更されました。もう一度ログインしてください');
      u = fresh;
      // a deleted account never comes back
      if (u.ban_kind === 'deleted') throw new ApiError(403, 'deleted', DELETED);
      // banned (or another account on this device is): logged in all the same,
      // for the title screen that stays locked until the ban ends (GET /api/ban);
      // nothing else accepts the login meanwhile
      u = liftExpired(u);
      const ban = banState(u);
      opsLog.add({ actor: u, action: 'player_login', req, summary: `${u.name}さんがログイン（${body.code !== undefined ? '引き継ぎコード' : 'パスワード'}${ban ? '・処分中' : ''}）`, detail: { by: body.code !== undefined ? 'code' : 'password', banned: !!ban } });
      if (ban) return { token: createSession(u.id), ban };
      seenOn(u.id, req);
      return { token: createSession(u.id), me: meDto(u) };
    }],

    // Still banned? The question of a banned player's title screen: their
    // login answers it (and nothing else) while the ban lasts.
    ['GET /api/ban', (req) => {
      const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.header('authorization') || ''));
      const s = m ? q('SELECT user_id, ended FROM sessions WHERE token_hash = ?').get(sha256(m[1])) : null;
      if (!s || s.ended) throw new ApiError(401, 'auth', 'ログインの有効期限が切れました');
      rate(limit.general, s.user_id);
      const u = getUser(s.user_id);
      if (!u) throw new ApiError(401, 'auth', 'アカウントが見つかりません');
      return { ban: banState(liftExpired(u)) };
    }],

    ['POST /api/logout', (req, u) => {
      q('DELETE FROM sessions WHERE token_hash = ?').run(u.tokenHash);
      return { ok: true };
    }],

    ['POST /api/recovery', (req, u) => {
      const code = setRecovery(u.id);
      opsLog.add({ actor: u, action: 'player_recovery', req, summary: `${u.name}さんが引き継ぎコードを再発行` });
      return { recoveryCode: code };
    }],

    ['POST /api/password', async (req, u) => {
      rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const password = cleanPassword(body.password);
      if (u.password_hash && !(await verifyPassword(body.current, u.password_hash))) {
        throw new ApiError(403, 'bad_password', '今のパスワードが違います');
      }
      const hash = await hashPassword(password);
      const credentials = tx(() => {
        // Verification/hashing yield: another change may have revoked this request meanwhile.
        const cur = getUser(u.id);
        if (cur.password_hash !== u.password_hash || !q('SELECT 1 FROM sessions WHERE token_hash = ?').get(u.tokenHash))
          throw new ApiError(401, 'auth', 'ログインの有効期限が切れました');
        const recoveryCode = replaceCredentials(q, u.id, hash, code => sealText(CODE_KEY, code));
        return { token: createSession(u.id), recoveryCode };
      });
      live.dropUser?.(u.id);
      opsLog.add({ actor: u, action: 'player_password', req, summary: `${u.name}さんがパスワードを${u.password_hash ? '変更' : '設定'}` });
      return { ...credentials, me: meDto(getUser(u.id)) };
    }],

  ];
}
