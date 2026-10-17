// The game rules and spin engine are the browser files js/core/util.js,
// js/game/config.js and js/game/engine.js, evaluated in a sandbox so the
// server and the client can never disagree on symbols, odds or pays.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './config.js';

const FILES = ['js/core/util.js', 'js/game/config.js', 'js/game/engine.js'];

function load() {
  const sandbox = {
    crypto: globalThis.crypto,          // util.random() uses crypto.getRandomValues
    performance: globalThis.performance,
    console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of FILES) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  const BR = sandbox.BR;
  if (!BR || !BR.CONFIG || !BR.engine) throw new Error('could not load the game rules from js/');
  return BR;
}

const BR = load();

export const RULES = BR.CONFIG;

// JSON round trip turns sandbox-realm objects into plain ones.
function plain(v) { return JSON.parse(JSON.stringify(v)); }

export function spin(bet) { return plain(BR.engine.spin(bet)); }
export function evaluate(line, bet) { return plain(BR.engine.evaluate(line, bet)); }
export function utcDay(date) {
  const d = date || new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}
export function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export function fmt(n) { return BR.util.fmt(n); }
