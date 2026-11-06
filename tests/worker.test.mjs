import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../worker/src/index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;

test('Worker rejects unapproved origins before any upstream call', async () => {
  let upstreamCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { upstreamCalls++; throw new Error('unexpected upstream request'); };
  try {
    const response = await worker.fetch(new Request('https://worker.test/', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: '{}' }), {});
    assert.equal(response.status, 403);
    assert.equal(upstreamCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('Worker preserves the six per-IP daily deep-reading limit', async () => {
  let upstreamCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { upstreamCalls++; throw new Error('quota must block upstream'); };
  try {
    const env = { OPENAI_API_KEY: 'test-only', USAGE_KV: { get: async () => '6' } };
    const request = new Request('https://worker.test/', {
      method: 'POST', headers: { Origin: 'https://jerryp86.github.io', 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test question' })
    });
    const response = await worker.fetch(request, env);
    const payload = await response.json();
    assert.equal(response.status, 429);
    assert.match(payload.error, /每日 6 次/);
    assert.equal(upstreamCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
