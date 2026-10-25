// The 石碑's place on this machine (server/core/stele.js): a folder of files that are created once and never written again
// (each is made whole under another name, flushed to the disk, and only then given its own name with a link that fails if the name
// is taken; and its permissions are read-only). An earlier file with another content under the same name is a refusal, not an overwrite.
// The operators' log's rows also go, one line each, to a file that is only added to (ops-log.jsonl), the moment they are written,
// and a row that could not be written to the database goes there too (`spill`).
import fs from 'node:fs';
import path from 'node:path';

export function fileStele(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = (key) => path.join(dir, path.basename(String(key)));
  return {
    async put(key, bytes) {
      const file = fileOf(key);
      const data = Buffer.from(bytes);
      const tmp = `${file}.part-${process.pid}-${Date.now()}`;
      const fd = fs.openSync(tmp, 'wx', 0o444);
      try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try {
        fs.linkSync(tmp, file);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Buffer.compare(fs.readFileSync(file), data) !== 0) throw new Error('その名前の控えがすでにあり、内容が違います（上書きはしません）');
      } finally { fs.rmSync(tmp, { force: true }); }
      try { const d = fs.openSync(dir, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* a folder cannot be flushed everywhere */ }
    },
    async get(key) {
      try { return new Uint8Array(fs.readFileSync(fileOf(key))); } catch { return null; }
    },
    async list(prefix) {
      return fs.readdirSync(dir).filter((f) => /^\d{10}-\d{10}\.json$/.test(f)).sort().map((f) => `${prefix}${f}`);
    }
  };
}

// every row of the log, the moment it is written, one JSON line, only ever added to; `spill`: the same for a row the database refused
export function logMirror(file) {
  const add = (row, tag = '') => {
    const fd = fs.openSync(file, 'a', 0o640);
    try { fs.writeSync(fd, JSON.stringify(tag ? { spill: true, row } : row) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  return { put: (row) => add(row), spill: (row) => add(row, 'spill') };
}
