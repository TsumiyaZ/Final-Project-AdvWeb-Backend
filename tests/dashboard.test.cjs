const { test, after } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');

const { conn } = require('../src/config/dbconnect');
const { getDashboard } = require('../src/controllers/dashboardController');
const originalQuery = conn.query;

after(async () => {
  conn.query = originalQuery;
  await conn.end();
});

const emptySummary = {
  total_orders: '0', total_boxes: '0', pending_orders: '0',
  delivered_orders: '0', cancelled_orders: '0'
};
const summary = {
  total_orders: '3', total_boxes: '3', pending_orders: '1',
  delivered_orders: '1', cancelled_orders: '1'
};
const plan = {
  plan_id: 9, total_orders: 2, total_boxes: 3, rider_count: '1',
  revenue: '195.00', food_cost: '120.10', delivery_cost: '25.20',
  profit: '49.70', last_arrival_time: '12:15:00', all_on_time: 1
};
const orders = [
  { order_id: 1, quantity: 1, customer_name: 'ลูกค้า A', phone: '0800000001', address: 'บ้าน A', latitude: '16.2460000', longitude: '103.2520000' },
  { order_id: 2, quantity: 2, customer_name: 'ลูกค้า B', phone: '0800000002', address: 'บ้าน B', latitude: '16.2470000', longitude: '103.2530000' }
];

function mockQueries(answers) {
  const calls = [];
  conn.query = async (sql, params) => {
    calls.push({ sql, params });
    assert.ok(answers.length, 'Unexpected database query');
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return [answer, []];
  };
  return calls;
}

async function invoke(query = { date: '2026-10-15' }) {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await getDashboard({ query }, response);
  return response;
}

test('rejects malformed, impossible, array and object dates before querying', async () => {
  const calls = mockQueries([]);
  for (const date of ['', '2026-02-30', '2025-02-29', '2026-13-01', '0000-01-01', '2026-1-01', "2026-10-15' OR 1=1", ['2026-10-15'], { x: '2026-10-15' }]) {
    const res = await invoke({ date });
    assert.equal(res.statusCode, 400, JSON.stringify(date));
  }
  assert.equal(calls.length, 0);
});

test('defaults to Bangkok day across the UTC date boundary', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 14, 18, 30) });
  const calls = mockQueries([[emptySummary], []]);
  const res = await invoke({});
  assert.equal(res.body.delivery_date, '2026-10-15');
  assert.deepEqual(calls.map(call => call.params), [['2026-10-15'], ['2026-10-15']]);
});

test('accepts leap day and returns numeric zero counts with no financial snapshot', async () => {
  mockQueries([[emptySummary], []]);
  const res = await invoke({ date: '2028-02-29' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    delivery_date: '2028-02-29', total_orders: 0, total_boxes: 0,
    rider_count: 0, pending_orders: 0, delivered_orders: 0,
    cancelled_orders: 0, plan_matches_orders: false, latest_plan: null
  });
});

test('keeps daily counts separate from the latest plan and normalizes decimal costs', async () => {
  const calls = mockQueries([[summary], [plan], orders, orders.map(order => ({ ...order, latitude: Number(order.latitude), longitude: Number(order.longitude) }))]);
  const res = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total_orders, 3);
  assert.equal(res.body.total_boxes, 3);
  assert.equal(res.body.cancelled_orders, 1);
  assert.equal(res.body.rider_count, 1);
  assert.equal(res.body.latest_plan.plan_id, 9);
  assert.equal(res.body.latest_plan.total_cost, 145.3);
  assert.equal(res.body.latest_plan.profit, 49.7);
  assert.equal(res.body.latest_plan.all_on_time, true);
  assert.equal(res.body.plan_matches_orders, true);
  assert.match(calls[0].sql, /status <> 'cancelled' THEN quantity/);
  assert.match(calls[0].sql, /WHERE order_date = \?/);
  assert.match(calls[1].sql, /COUNT\(DISTINCT rr.rider_id\)/);
  assert.match(calls[1].sql, /ORDER BY p.created_at DESC, p.id DESC\s+LIMIT 1/);
  assert.deepEqual(calls[3].params, [9]);
});

test('marks changed order identities stale even when totals match', async () => {
  mockQueries([[summary], [plan], orders, [{ ...orders[0], order_id: 7 }, orders[1]]]);
  assert.equal((await invoke()).body.plan_matches_orders, false);
});

test('marks changed quantities, customer assignment and location snapshots stale', async () => {
  for (const change of [{ quantity: 2 }, { customer_name: 'ลูกค้าใหม่' }, { phone: '0800000009' }, { address: 'บ้านใหม่' }, { latitude: '16.3' }, { longitude: '103.3' }]) {
    mockQueries([[summary], [plan], orders, [{ ...orders[0], ...change }, orders[1]]]);
    assert.equal((await invoke()).body.plan_matches_orders, false, JSON.stringify(change));
  }
});

test('marks cancelled orders, duplicate stops and stale snapshot totals as stale', async () => {
  const cases = [
    [[summary], [plan], [orders[0]], orders],
    [[summary], [plan], orders, [orders[0], orders[0]]],
    [[summary], [{ ...plan, total_boxes: 4 }], orders, orders],
    [[summary], [{ ...plan, total_orders: 3 }], orders, orders]
  ];
  for (const answers of cases) {
    mockQueries(answers);
    assert.equal((await invoke()).body.plan_matches_orders, false);
  }
});

test('keeps negative plan profit and false on-time prediction', async () => {
  mockQueries([[summary], [{ ...plan, profit: '-12.50', all_on_time: 0 }], orders, orders]);
  const res = await invoke();
  assert.equal(res.body.latest_plan.profit, -12.5);
  assert.equal(res.body.latest_plan.all_on_time, false);
});

test('returns database errors without exposing credentials or query details', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const answers of [[new Error('private database detail')], [[summary], new Error('private database detail')], [[summary], [plan], new Error('private database detail')]]) {
    mockQueries(answers);
    const res = await invoke();
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Database error' });
  }
});

test('registers the dashboard endpoint in Express without changing old routes', async (t) => {
  mockQueries([[emptySummary], []]);
  const { app } = require('../app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard?date=2026-10-15`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).delivery_date, '2026-10-15');
});
