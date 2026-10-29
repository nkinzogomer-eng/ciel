// Minimal, dependency-free test harness. Portable to Deno/Node. Results are plain JSON so any
// surface (Base44 console, CLI, CI) can render them.
import { canonicalize } from '../core/fingerprint.ts';

const suites = [];

export function suite(name, define) {
  const tests = [];
  define((title, run) => tests.push({ title, run }));
  suites.push({ name, tests });
}

function fail(message) { throw new Error(message); }

export const assert = {
  ok(cond, msg = 'expected truthy') { if (!cond) fail(msg); },
  equal(a, b, msg) { if (a !== b) fail(msg || `expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`); },
  deepEqual(a, b, msg) { if (canonicalize(a) !== canonicalize(b)) fail(msg || `expected deep equality:\n${canonicalize(a)}\n${canonicalize(b)}`); },
  throws(fn, code, msg) {
    try { fn(); } catch (e) {
      if (code && e.code !== code) fail(msg || `expected error code ${code}, got ${e.code} (${e.message})`);
      return e;
    }
    fail(msg || `expected function to throw${code ? ` ${code}` : ''}`);
  },
  async rejects(fn, code, msg) {
    try { await fn(); } catch (e) {
      if (code && e.code !== code) fail(msg || `expected error code ${code}, got ${e.code} (${e.message})`);
      return e;
    }
    fail(msg || `expected promise to reject${code ? ` with ${code}` : ''}`);
  },
};

export async function runAll() {
  const started = Date.now();
  const out = [];
  let passed = 0, failed = 0;
  for (const s of suites) {
    const results = [];
    for (const t of s.tests) {
      const t0 = Date.now();
      try { await t.run(); results.push({ title: t.title, ok: true, ms: Date.now() - t0 }); passed += 1; }
      catch (e) { results.push({ title: t.title, ok: false, ms: Date.now() - t0, error: e.message }); failed += 1; }
    }
    out.push({ name: s.name, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, tests: results });
  }
  return { total: passed + failed, passed, failed, duration_ms: Date.now() - started, suites: out };
}