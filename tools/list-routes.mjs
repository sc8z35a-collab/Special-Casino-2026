// Disposable database: listing routes never opens the production database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/node/server.js';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-routes-'));
const app = createApp({ dataDir, logRequests: false });
try { console.log(JSON.stringify(app.api.routeReport(), null, 2)); }
finally { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
