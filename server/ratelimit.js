// Token-bucket rate limiter kept in memory (one server process).
export class Limiter {
  // `perMinute` tokens are refilled per minute, at most `burst` can be stored.
  constructor(perMinute, burst) {
    this.rate = perMinute / 60000;
    this.burst = burst;
    this.buckets = new Map();
  }

  take(key, cost = 1) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.burst, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.rate);
    b.at = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  // Drop buckets that are full again (nothing to remember).
  prune() {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.at) * this.rate >= this.burst) this.buckets.delete(k);
    }
  }
}
