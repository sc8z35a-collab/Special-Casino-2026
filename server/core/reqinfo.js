// What a request tells about where it came from, for the operators' log when someone gets a login
// wrong: the connection (the address, the chain it came through, and what the host's edge knows of it:
// country, city, network, the TLS it used), the browser (its headers and, if it sent them, its hints)
// and what the page itself said of the device. Nothing is guessed or looked up from outside, nothing
// is stored apart from the log line, and every value is cut short so a request cannot fill the log.
//
// The page's own report can be made up by whoever sends it: it is kept apart as `reported` (the page's
// say, and no more); what the host and the connection show is not theirs to change.

const cut = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// headers worth keeping (all lower case); the browser's own words about itself, and the edge's
const HEADERS = [
  'user-agent', 'accept-language', 'accept', 'accept-encoding', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
  'sec-ch-ua-model', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version-list', 'sec-ch-prefers-color-scheme', 'sec-fetch-site', 'sec-fetch-mode',
  'sec-fetch-dest', 'sec-fetch-user', 'upgrade-insecure-requests', 'dnt', 'sec-gpc', 'origin', 'referer', 'host', 'via', 'forwarded',
  'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'cf-connecting-ipv6', 'cf-ipcountry', 'cf-ipcity', 'cf-region', 'cf-region-code', 'cf-postal-code', 'cf-timezone',
  'cf-iplatitude', 'cf-iplongitude', 'cf-ray', 'cf-visitor', 'cf-worker', 'x-forwarded-proto', 'x-forwarded-host', 'connection', 'cache-control', 'pragma', 'content-type', 'content-length'
];

// plain values only (strings, numbers, true/false), one level of nesting at most
function flat(o, depth = 0) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (++n > 40) break;
    if (typeof v === 'string') out[cut(k, 40)] = cut(v, 160);
    else if (typeof v === 'number' && Number.isFinite(v)) out[cut(k, 40)] = v;
    else if (typeof v === 'boolean') out[cut(k, 40)] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) out[cut(k, 40)] = flat(v, depth + 1);
  }
  return out;
}

// the connection and the browser, as this request shows them
export function requestProfile(req) {
  const headers = {};
  for (const k of HEADERS) {
    const v = cut(req.header(k), k === 'user-agent' ? 300 : 160);
    if (v) headers[k] = v;
  }
  const out = { ip: cut(req.ip, 64), headers };
  const chain = cut(req.header('x-forwarded-for'), 600).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (chain.length) out.chain = chain;
  const meta = req.meta || {};
  if (meta.cf) out.edge = flat(meta.cf);
  if (meta.socket) out.socket = flat(meta.socket);
  return out;
}

const str = (v, n) => (typeof v === 'string' ? cut(v, n) : undefined);
const int = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 100) / 100)) : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const drop = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || (o[k] && typeof o[k] === 'object' && !Object.keys(o[k]).length)) delete o[k]; return o; };

// What the page reported of the device (ops/deviceinfo.js), cleaned: only the names below, only plain
// values of the right kind and size, and not more than a few thousand characters in all.
export function cleanClient(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const c = raw;
  const sc = c.screen && typeof c.screen === 'object' ? c.screen : {};
  const vp = c.viewport && typeof c.viewport === 'object' ? c.viewport : {};
  const cn = c.conn && typeof c.conn === 'object' ? c.conn : {};
  const pf = c.prefers && typeof c.prefers === 'object' ? c.prefers : {};
  const ud = c.uaData && typeof c.uaData === 'object' ? c.uaData : {};
  const brands = (list) => (Array.isArray(list) ? list.slice(0, 8).map((b) => (b && typeof b === 'object' ? `${cut(b.brand, 40)} ${cut(b.version, 20)}`.trim() : '')).filter(Boolean) : undefined);
  const out = drop({
    page: str(c.page, 12), lang: str(c.lang, 20), langs: Array.isArray(c.langs) ? c.langs.slice(0, 8).map((x) => cut(x, 20)) : undefined,
    tz: str(c.tz, 60), tzOffset: int(c.tzOffset, -1000, 1000),
    screen: drop({ w: int(sc.w, 0, 20000), h: int(sc.h, 0, 20000), aw: int(sc.aw, 0, 20000), ah: int(sc.ah, 0, 20000), depth: int(sc.depth, 0, 64), dpr: num(sc.dpr, 0, 20) }),
    viewport: drop({ w: int(vp.w, 0, 20000), h: int(vp.h, 0, 20000) }),
    touch: int(c.touch, 0, 100), cores: int(c.cores, 0, 1024), memory: num(c.memory, 0, 1024),
    platform: str(c.platform, 60), vendor: str(c.vendor, 60), product: str(c.product, 30),
    webdriver: bool(c.webdriver), cookies: bool(c.cookies), dnt: str(c.dnt, 10), pdf: bool(c.pdf), standalone: bool(c.standalone), online: bool(c.online), plugins: int(c.plugins, 0, 1000),
    conn: drop({ type: str(cn.type, 20), effective: str(cn.effective, 20), down: num(cn.down, 0, 100000), rtt: int(cn.rtt, 0, 100000), save: bool(cn.save) }),
    prefers: drop({ dark: bool(pf.dark), reduceMotion: bool(pf.reduceMotion), contrast: str(pf.contrast, 12), pointer: str(pf.pointer, 12), hover: bool(pf.hover) }),
    uaData: drop({
      brands: brands(ud.brands), mobile: bool(ud.mobile), platform: str(ud.platform, 40), platformVersion: str(ud.platformVersion, 40), model: str(ud.model, 60),
      arch: str(ud.arch, 20), bitness: str(ud.bitness, 10), uaFullVersion: str(ud.uaFullVersion, 40), wow64: bool(ud.wow64), fullVersionList: brands(ud.fullVersionList)
    }),
    gpu: str(c.gpu, 140), fresh: bool(c.fresh),
    // how the form was filled: a person types; a program (or the browser's autofill) sets it at once
    sinceLoad: int(c.sinceLoad, 0, 86400000), keys: int(c.keys, 0, 100000), typing: int(c.typing, 0, 86400000)
  });
  // (not more than a few thousand characters: the longest part goes first)
  while (JSON.stringify(out).length > 3500) {
    const biggest = Object.keys(out).sort((a, b) => JSON.stringify(out[b]).length - JSON.stringify(out[a]).length)[0];
    if (!biggest) break;
    delete out[biggest];
  }
  return out;
}
