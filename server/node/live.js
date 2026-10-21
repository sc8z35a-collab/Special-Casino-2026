// Real-time push for the Node host over Server-Sent Events. The browser
// trades its token for a short signed ticket and opens /api/stream?ticket=...,
// which keeps tokens out of URLs and access logs.
import { SECURITY_HEADERS } from './http.js';

const HEARTBEAT = 25 * 1000;
const MAX_BUFFERED = 512 * 1024;

export class Live {
  constructor() {
    this.clients = new Map();   // userId -> Set<res>
    this.onPresence = null;     // (userId, online) => void
    // the operator site's own connections (no game events, not a player
    // online): userId -> Set<res>; onOpsGone(userId) when the last one closes
    this.opsClients = new Map();
    this.onOpsGone = null;
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT);
    this.timer.unref();
  }

  attach(req, res, userId, hello) {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, HEARTBEAT);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    let set = this.clients.get(userId);
    const first = !set;
    if (!set) { set = new Set(); this.clients.set(userId, set); }
    set.add(res);
    this.write(res, 'hello', { ...hello(), online: this.onlineCount() });
    if (first && this.onPresence) this.onPresence(userId, true);
    const done = () => {
      const s = this.clients.get(userId);
      if (!s || !s.delete(res)) return;
      if (!s.size) {
        this.clients.delete(userId);
        if (this.onPresence) this.onPresence(userId, false);
      }
    };
    res.on('close', done);
    res.on('error', done);
  }

  attachOps(req, res, userId) {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, HEARTBEAT);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    let set = this.opsClients.get(userId);
    if (!set) { set = new Set(); this.opsClients.set(userId, set); }
    set.add(res);
    this.write(res, 'hello', { ops: true });
    const done = () => {
      const s = this.opsClients.get(userId);
      if (!s || !s.delete(res)) return;
      if (!s.size) {
        this.opsClients.delete(userId);
        if (this.onOpsGone) this.onOpsGone(userId);
      }
    };
    res.on('close', done);
    res.on('error', done);
  }

  sendOps(userId, event, data) {
    const set = this.opsClients.get(userId);
    if (set) for (const res of set) this.write(res, event, data);
  }

  opsOnline(userId) { return this.opsClients.has(userId); }

  write(res, event, data) {
    if (res.writableLength > MAX_BUFFERED) { res.destroy(); return; }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  send(userId, event, data) {
    const set = this.clients.get(userId);
    if (set) for (const res of set) this.write(res, event, data);
  }

  broadcast(event, data, filter) {
    for (const [userId, set] of this.clients) {
      if (filter && !filter(userId)) continue;
      for (const res of set) this.write(res, event, data);
    }
  }

  isOnline(userId) { return this.clients.has(userId); }
  onlineCount() { return this.clients.size; }

  heartbeat() {
    for (const set of this.clients.values()) for (const res of set) res.write(': ping\n\n');
    for (const set of this.opsClients.values()) for (const res of set) res.write(': ping\n\n');
  }

  close() {
    clearInterval(this.timer);
    for (const set of this.clients.values()) for (const res of set) res.end();
    for (const set of this.opsClients.values()) for (const res of set) res.end();
    this.clients.clear();
    this.opsClients.clear();
  }

  // every connection ends (the emergency stop); the players go offline
  drop() {
    for (const set of [...this.clients.values()]) for (const res of [...set]) res.end();
    for (const set of [...this.opsClients.values()]) for (const res of [...set]) res.end();
  }
}
