// A minimal observable "world" used by the reference capabilities.
// It stands in for whatever the real runtime touches (files, HTTP, a database) and gives
// tests a state surface that can be observed, fingerprinted and probed after a crash.
export function createWorld(initial = {}) {
  const data = new Map(Object.entries(initial));
  const operations = [];

  return {
    get(key) { return data.get(key); },
    set(key, value) { data.set(key, value); return value; },
    has(key) { return data.has(key); },
    delete(key) { return data.delete(key); },
    keys() { return [...data.keys()].sort(); },
    // Observation surface: `observe('kv:foo')` is what the Invalidation Engine calls.
    observe(stateKey) {
      const [ns, ...rest] = String(stateKey).split(':');
      const key = rest.join(':');
      if (ns === 'kv') return data.get(key);
      if (ns === 'counter') return data.get(`counter:${key}`) ?? 0;
      if (ns === 'mailbox') return operations.filter((o) => o.kind === 'mail').map((o) => o.ref);
      return data.get(stateKey);
    },
    recordOperation(op) { operations.push(op); return op; },
    operations() { return [...operations]; },
    snapshot() { return Object.fromEntries([...data.entries()].sort(([a], [b]) => (a < b ? -1 : 1))); },
  };
}