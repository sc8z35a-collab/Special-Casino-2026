// Shared test setup: a Node server on a random port with a throw-away database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createApp } from '../node/server.js';

export const PASSWORD = 'pass1234';

export async function startServer(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-test-'));
  const app = createApp({
    dataDir, logRequests: false, registrationsPerIp: 0, registerPerMinute: 100000, loginBonus: false,
    limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000] },
    ...overrides
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let seq = 0;

  // { status, ...json body } (the HTTP status wins over a body field of that name)
  async function call(method, url, { token, body, headers = {} } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json();
    return { ...json, status: res.status };
  }

  async function register(name, { password = PASSWORD, avatar = 'bald' } = {}) {
    const r = await call('POST', '/api/register', { body: { name: name || `ユーザー${++seq}`, password, avatar } });
    assert.equal(r.status, 200, JSON.stringify(r));
    return r;
  }

  function setUser(id, fields) {
    const cols = Object.keys(fields);
    app.db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
  }

  async function befriend(a, b) {
    const r1 = await call('POST', '/api/friends/request', { token: a.token, body: { user: b.me.id } });
    assert.equal(r1.status, 200, JSON.stringify(r1));
    const r2 = await call('POST', '/api/friends/respond', { token: b.token, body: { user: a.me.id, accept: true } });
    assert.equal(r2.friendship, 'friends', JSON.stringify(r2));
  }

  // Server-sent events; resolves once connected.
  function openStream(ticket, onEvent) {
    return new Promise((resolve, reject) => {
      const req = http.get(`${base}/api/stream?ticket=${encodeURIComponent(ticket)}`, (res) => {
        if (res.statusCode !== 200) { reject(new Error('status ' + res.statusCode)); res.resume(); return; }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(block);
            const data = /^data: (.+)$/m.exec(block);
            if (ev && data) onEvent(ev[1], JSON.parse(data[1]));
          }
        });
        resolve(req);
      });
      req.on('error', reject);
    });
  }

  // A player's live connection with waitFor(name, predicate).
  async function listen(player) {
    const { ticket } = await call('POST', '/api/stream-ticket', { token: player.token });
    const events = [];
    let wake = null;
    const req = await openStream(ticket, (name, data) => { events.push({ name, data }); if (wake) wake(); });
    function waitFor(name, pred = () => true, ms = 3000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { wake = null; reject(new Error('timeout waiting for ' + name)); }, ms);
        const check = () => {
          const hit = events.find((e) => !e.used && e.name === name && pred(e.data));
          if (hit) { hit.used = true; clearTimeout(t); wake = null; resolve(hit.data); } else wake = check;
        };
        check();
      });
    }
    return { events, waitFor, ticket, close: () => req.destroy() };
  }

  async function stop() {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { app, base, dataDir, call, register, setUser, befriend, openStream, listen, stop };
}
