// The people's rooms on Cloudflare (docs/npc-rooms-plan.md 3章): fifteen Workers of their own, npc-room-1 … npc-room-15
// (server/cloudflare/npc-room.js: one Durable Object each, no route), then the main Worker bound to them.
//
//   node tools/rooms/deploy.mjs            deploys the fifteen rooms and adds their bindings to wrangler.jsonc
//   node tools/rooms/deploy.mjs --bind     only adds the bindings (the rooms already deployed)
//   node tools/rooms/deploy.mjs --dry      writes the rooms' configs to tools/rooms/out/ and changes nothing
//
// Then deploy the main Worker as always (npm run deploy) with NPC_ROOMS=15 set in its variables. Its migrations (the
// "v1" of the Casino object, which holds every player) are never touched: the bindings only name the rooms' Workers.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const N = 15, OUT = path.join(ROOT, 'tools', 'rooms', 'out');
const args = new Set(process.argv.slice(2));
// a room's Worker: its one object (SQLite), up to two minutes of thinking a call, no workers.dev address
export function roomConfig(k) {
  return {
    name: `npc-room-${k}`, main: path.relative(OUT, path.join(ROOT, 'server', 'cloudflare', 'npc-room.js')),
    compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], workers_dev: false, preview_urls: false,
    durable_objects: { bindings: [{ name: 'ROOM', class_name: 'NpcRoom' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['NpcRoom'] }],
    limits: { cpu_ms: 120000 }, observability: { enabled: true }
  };
}
// the main Worker's bindings to them, added to wrangler.jsonc's durable_objects.bindings beside CASINO (once)
export function bind(text) {
  const want = Array.from({ length: N }, (_, x) => `{ "name": "NPC_ROOM_${x + 1}", "class_name": "NpcRoom", "script_name": "npc-room-${x + 1}" }`);
  const m = text.match(/"bindings":\s*\[\{\s*"name":\s*"CASINO",\s*"class_name":\s*"Casino"\s*\}([^\]]*)\]/);
  if (!m) throw new Error('wrangler.jsonc: the CASINO binding was not found as expected');
  if (m[1].includes('NPC_ROOM_1"')) return text;
  return text.replace(m[0], `"bindings": [{ "name": "CASINO", "class_name": "Casino" },\n      ${want.join(',\n      ')}]`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(OUT, { recursive: true });
  if (!args.has('--bind')) {
    for (let k = 1; k <= N; k++) {
      const file = path.join(OUT, `npc-room-${k}.json`);
      fs.writeFileSync(file, JSON.stringify(roomConfig(k), null, 2));
      if (!args.has('--dry')) { console.log(`deploying npc-room-${k}`); execFileSync('npx', ['wrangler', 'deploy', '-c', file], { cwd: ROOT, stdio: 'inherit' }); }
    }
  }
  if (!args.has('--dry')) {
    const f = path.join(ROOT, 'wrangler.jsonc'), text = fs.readFileSync(f, 'utf8'), next = bind(text);
    if (next !== text) { fs.writeFileSync(f, next); console.log('wrangler.jsonc: NPC_ROOM_1 … NPC_ROOM_15 bound. Set NPC_ROOMS=15 and deploy the main Worker (npm run deploy).'); }
    else console.log('wrangler.jsonc: the rooms are bound already.');
  }
}
