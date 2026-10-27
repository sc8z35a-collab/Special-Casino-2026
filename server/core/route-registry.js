// Route assembly is checked before either host accepts requests. Replacements
// for deliberate wrappers are explicit and retained in the diagnostic report.
export function createRouteRegistry() {
  const target = Object.create(null), owners = new Map(), duplicates = [], replacements = [];
  let source = 'inline';
  function put(key, handler) {
    if (!/^(GET|POST) \/api\//.test(key) || typeof handler !== 'function') throw new Error(`Invalid route: ${source}: ${key}`);
    if (owners.has(key)) { duplicates.push({ key, first: owners.get(key), second: source }); return; }
    owners.set(key, source); target[key] = handler;
  }
  const routes = new Proxy(target, { set(_, key, handler) { put(key, handler); return true; } });
  return {
    routes,
    add(name, entries) {
      source = name;
      try { for (const [key, handler] of Array.isArray(entries) ? entries : Object.entries(entries)) put(key, handler); }
      finally { source = 'inline'; }
      return routes;
    },
    replace(name, key, handler) {
      if (!owners.has(key) || typeof handler !== 'function') throw new Error(`Cannot wrap missing route: ${name}: ${key}`);
      replacements.push({ key, first: owners.get(key), second: name });
      target[key] = handler; owners.set(key, name);
    },
    report() {
      return { routes: [...owners].sort(([a], [b]) => a.localeCompare(b)).map(([key, source]) => ({ key, source })),
        duplicates: duplicates.slice(), replacements: replacements.slice() };
    },
    assertUnique() {
      if (duplicates.length) throw new Error('Duplicate API routes:\n' + duplicates.map(d => `${d.key}: ${d.first} -> ${d.second}`).join('\n'));
    }
  };
}
