const test = require('node:test');
const assert = require('node:assert/strict');
const functions = require('../src/functions');
const { BY_PATH, ACTIONS } = require('../src/routes/actionRegistry');

const P2_PORTED = [
  'raffleCheckout',
  'drawRaffle',
  'drawTRaffle',
  'checkAuctionCard',
  'saveAuctionCard',
  'placeSilentAuctionBid',
  'lockInAuctionWinners',
  'notifyLeaguePrizePayout',
  'notifyPrizePayOut',
  'markCourseEnrollmentPaid',
  'deleteAccount',
  'deleteLeagueCascade',
  'generateShareToken',
];

function mockCtx({ user = null, service = {}, scoped = {} } = {}) {
  const entityProxy = (map) =>
    new Proxy(
      {},
      {
        get(_t, name) {
          if (typeof name !== 'string') return undefined;
          return (
            map[name] || {
              filter: async () => [],
              get: async () => null,
              create: async (d) => ({ id: 'x', ...d }),
              update: async () => ({}),
              delete: async () => ({}),
            }
          );
        },
      },
    );

  return {
    auth: { me: async () => user },
    entities: entityProxy(scoped),
    asServiceRole: { entities: entityProxy(service) },
  };
}

test('phase3 P2 recovered actions are in function registry', () => {
  for (const name of P2_PORTED) {
    assert.equal(functions.has(name), true, `${name} should be ported`);
  }
});

test('registry counts are consistent', () => {
  assert.equal(ACTIONS.length, 66);
  assert.ok(functions.has('getRaffleAllocations'));
  assert.ok(functions.names().length >= 50);
});

test('drawRaffle requires admin', async () => {
  const fn = functions.get('drawRaffle');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { raffle_id: 'r1' }),
    (err) => err.status === 403,
  );
});

test('raffleCheckout requires auth and raffle_id', async () => {
  const fn = functions.get('raffleCheckout');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: null }), {}),
    (err) => err.status === 401,
  );
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('placeSilentAuctionBid validates fields', async () => {
  const fn = functions.get('placeSilentAuctionBid');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('lockInAuctionWinners requires admin', async () => {
  const fn = functions.get('lockInAuctionWinners');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { auction_id: 'a1' }),
    (err) => err.status === 403,
  );
});

test('deleteAccount requires email confirmation', async () => {
  const fn = functions.get('deleteAccount');
  await assert.rejects(
    () =>
      fn.handler(mockCtx({ user: { id: '1', email: 'a@x.com' } }), {
        confirmEmail: 'wrong@x.com',
      }),
    (err) => err.status === 400,
  );
});

test('deleteLeagueCascade requires admin', async () => {
  const fn = functions.get('deleteLeagueCascade');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { league_id: 'L1' }),
    (err) => err.status === 403,
  );
});

test('generateShareToken validates context', async () => {
  const fn = functions.get('generateShareToken');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('notifyPrizePayOut requires admin', async () => {
  const fn = functions.get('notifyPrizePayOut');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { winnerId: 'w1' }),
    (err) => err.status === 403,
  );
});

test('markCourseEnrollmentPaid requires admin', async () => {
  const fn = functions.get('markCourseEnrollmentPaid');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { enrollmentId: 'e1' }),
    (err) => err.status === 403,
  );
});

test('drawTRaffle validates winners array', async () => {
  const fn = functions.get('drawTRaffle');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'admin' } }), { raffle_id: 'r1' }),
    (err) => err.status === 400,
  );
});
