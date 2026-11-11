import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

function makeKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  const events = new Map();
  return {
    values, events,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value, options = {}) {
      values.set(key, value);
      if (options.metadata) events.set(key, options.metadata);
    },
    async list({ prefix }) {
      const keys = [...events.entries()].filter(([key]) => key.startsWith(prefix))
        .map(([name, metadata]) => ({ name, metadata }));
      return { keys, list_complete: true, cursor: '' };
    }
  };
}

test('admin usage report requires its own bearer secret', async () => {
  const response = await worker.fetch(
    new Request('https://worker.test/admin/usage'),
    { USAGE_ADMIN_TOKEN: 'test-admin-token', USAGE_KV: makeKv() }
  );
  assert.equal(response.status, 401);
});

test('monthly report aggregates daily calls, tokens, estimated cost and budget warning', async () => {
  const kv = makeKv();
  await kv.put('usage:event:2026-11:2026-11-11:a', '', { metadata: {
    date: '2026-11-11', status: 'success', usage_available: true,
    input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500,
    total_tokens: 1500, estimated_cost_usd: 0.00104
  }});
  await kv.put('usage:event:2026-11:2026-11-11:b', '', { metadata: {
    date: '2026-11-11', status: 'upstream_error', usage_available: false,
    input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
    total_tokens: 0, estimated_cost_usd: 0
  }});
  const response = await worker.fetch(
    new Request('https://worker.test/admin/usage?month=2026-11', {
      headers: { Authorization: 'Bearer test-admin-token' }
    }),
    { USAGE_ADMIN_TOKEN: 'test-admin-token', USAGE_KV: kv, MONTHLY_BUDGET_USD: '0.001', BUDGET_WARNING_RATIO: '0.8' }
  );
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.daily[0].api_calls, 2);
  assert.equal(report.daily[0].successful_calls, 1);
  assert.equal(report.daily[0].failed_calls, 1);
  assert.equal(report.totals.input_tokens, 1000);
  assert.equal(report.totals.output_tokens, 500);
  assert.equal(report.totals.total_tokens, 1500);
  assert.equal(report.budget.status, 'budget_reached');
  assert.equal(report.budget.enforcement, 'report_only');
  assert.match(report.cost_note, /not an invoice/i);
});

test('existing six-per-IP daily limit blocks before calling OpenAI', async () => {
  const kv = makeKv();
  const today = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('192.0.2.8'));
  const ipHash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  kv.values.set(`daily:${today}:${ipHash}`, '6');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('should not call upstream'); };
  try {
    const response = await worker.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: { Origin: 'https://jerryp86.github.io', 'CF-Connecting-IP': '192.0.2.8', 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test' })
    }), { OPENAI_API_KEY: 'test-only', USAGE_KV: kv });
    assert.equal(response.status, 429);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
