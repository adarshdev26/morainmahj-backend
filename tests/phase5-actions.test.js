const test = require('node:test');
const assert = require('node:assert/strict');
const functions = require('../src/functions');
const { BY_PATH, ACTIONS } = require('../src/routes/actionRegistry');

const PHASE5 = [
  'submitMatchResult',
  'respondToMatchResult',
  'finalizeMatchResult',
  'logHand',
  'createLeagueWalkIn',
  'requestLeagueSubstitute',
  'assignLeagueSubstitute',
  'markLeagueMemberPaid',
  'processLeagueRefund',
  'finalizeLeagueSession',
  'getPublicTournamentWebsite',
  'getPublicLeagueWebsite',
  'getPublicCourseWebsite',
  'startTrial',
  'cancelSubscription',
  'verifySubscriptionPayment',
];

const PUBLIC_PHASE5 = new Set([
  'getPublicTournamentWebsite',
  'getPublicLeagueWebsite',
  'getPublicCourseWebsite',
]);

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
              list: async () => [],
              create: async (d) => ({ id: 'x', ...d }),
              update: async (id, d) => ({ id, ...d }),
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

test('phase5: all 16 recovered actions are ported', () => {
  assert.equal(ACTIONS.length, 66);
  for (const name of PHASE5) {
    assert.equal(functions.has(name), true, `${name} should be ported`);
    assert.equal(typeof functions.get(name).handler, 'function');
    const path = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    assert.ok(BY_PATH.get(path), `${path} registered`);
  }
  assert.equal(functions.names().length, 66);
});

test('phase5: public website handlers are marked public', () => {
  for (const name of PUBLIC_PHASE5) {
    assert.equal(functions.get(name).public, true);
  }
});

test('phase5: protected actions require auth (401)', async () => {
  for (const name of PHASE5.filter((n) => !PUBLIC_PHASE5.has(n))) {
    const fn = functions.get(name);
    await assert.rejects(
      () => fn.handler(mockCtx({ user: null }), {}),
      (err) => err.status === 401,
      `${name} should 401 without auth`,
    );
  }
});

test('phase5: public websites validate slug (400)', async () => {
  for (const name of PUBLIC_PHASE5) {
    const fn = functions.get(name);
    await assert.rejects(
      () => fn.handler(mockCtx(), {}),
      (err) => err.status === 400,
      `${name} should 400 without slug`,
    );
  }
});

test('phase5: public websites 404 unknown slug', async () => {
  for (const name of PUBLIC_PHASE5) {
    const fn = functions.get(name);
    await assert.rejects(
      () => fn.handler(mockCtx({ service: {} }), { slug: 'missing-slug' }),
      (err) => err.status === 404,
    );
  }
});

test('phase5: getPublicTournamentWebsite unpublished → 404', async () => {
  const fn = functions.get('getPublicTournamentWebsite');
  await assert.rejects(
    () =>
      fn.handler(
        mockCtx({
          service: {
            Tournament: {
              filter: async () => [
                {
                  id: 't1',
                  website_enabled: false,
                  website_status: 'draft',
                  organization_id: 'o1',
                },
              ],
            },
          },
        }),
        { slug: 'draft-tour' },
      ),
    (err) => err.status === 404,
  );
});

test('phase5: getPublicTournamentWebsite preview unauthorized → 403', async () => {
  const fn = functions.get('getPublicTournamentWebsite');
  await assert.rejects(
    () =>
      fn.handler(
        mockCtx({
          user: { id: 'u1', role: 'user', organization_id: 'other' },
          service: {
            Tournament: {
              filter: async () => [
                {
                  id: 't1',
                  website_enabled: false,
                  website_status: 'draft',
                  organization_id: 'o1',
                },
              ],
            },
          },
        }),
        { slug: 'draft-tour', preview: true },
      ),
    (err) => err.status === 403,
  );
});

test('phase5: getPublicTournamentWebsite published shape', async () => {
  const fn = functions.get('getPublicTournamentWebsite');
  const result = await fn.handler(
    mockCtx({
      service: {
        Tournament: {
          filter: async () => [
            {
              id: 't1',
              website_enabled: true,
              website_status: 'published',
              organization_id: 'o1',
              status: 'draft',
            },
          ],
        },
        Organization: {
          filter: async () => [{ id: 'o1', name: 'Org' }],
        },
        Registration: {
          filter: async () => [
            { status: 'confirmed' },
            { status: 'waitlisted' },
            { status: 'confirmed' },
          ],
        },
      },
    }),
    { slug: 'live-tour' },
  );
  assert.equal(result.tournament.id, 't1');
  assert.equal(result.organization.id, 'o1');
  assert.equal(result.confirmedCount, 2);
  assert.equal(result.waitlistedCount, 1);
  assert.ok(Array.isArray(result.leaderboard));
});

test('phase5: submitMatchResult validates required fields', async () => {
  const fn = functions.get('submitMatchResult');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: respondToMatchResult validates', async () => {
  const fn = functions.get('respondToMatchResult');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: finalizeMatchResult validates', async () => {
  const fn = functions.get('finalizeMatchResult');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'admin' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: logHand validates', async () => {
  const fn = functions.get('logHand');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: createLeagueWalkIn validates', async () => {
  const fn = functions.get('createLeagueWalkIn');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'organizer_admin' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: requestLeagueSubstitute validates', async () => {
  const fn = functions.get('requestLeagueSubstitute');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: assignLeagueSubstitute requires organizer', async () => {
  const fn = functions.get('assignLeagueSubstitute');
  await assert.rejects(
    () =>
      fn.handler(mockCtx({ user: { id: 'u1', role: 'user' } }), {
        session_id: 's1',
        league_id: 'l1',
        original_player_email: 'a@x.com',
        substitute_member_id: 'm1',
      }),
    (err) => err.status === 403,
  );
});

test('phase5: markLeagueMemberPaid requires admin/organizer', async () => {
  const fn = functions.get('markLeagueMemberPaid');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user' } }), { member_id: 'm1' }),
    (err) => err.status === 403,
  );
});

test('phase5: processLeagueRefund validates refund_type', async () => {
  const fn = functions.get('processLeagueRefund');
  await assert.rejects(
    () =>
      fn.handler(mockCtx({ user: { id: 'u1', role: 'admin' } }), {
        member_id: 'm1',
        refund_type: 'nope',
      }),
    (err) => err.status === 400,
  );
});

test('phase5: finalizeLeagueSession requires sessionId + admin', async () => {
  const fn = functions.get('finalizeLeagueSession');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user' } }), { sessionId: 's1' }),
    (err) => err.status === 403,
  );
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'admin' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: startTrial validates plan', async () => {
  const fn = functions.get('startTrial');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', email: 'a@x.com', role: 'user' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: startTrial creates trial (individual)', async () => {
  const created = [];
  const fn = functions.get('startTrial');
  const result = await fn.handler(
    mockCtx({
      user: { id: 'u1', email: 'a@x.com', role: 'user', full_name: 'Ann' },
      service: {
        Subscription: {
          filter: async () => [],
          create: async (d) => {
            created.push(d);
            return { id: 'sub1', ...d };
          },
        },
      },
    }),
    { plan: 'individual', billing_period: 'monthly' },
  );
  assert.equal(result.success, true);
  assert.equal(result.subscription.status, 'trialing');
  assert.equal(created[0].plan, 'individual');
  assert.ok(created[0].trial_ends_at);
});

test('phase5: cancelSubscription only organizer_admin', async () => {
  const fn = functions.get('cancelSubscription');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'user' } }), {}),
    (err) => err.status === 403,
  );
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', role: 'admin' } }), {}),
    (err) => err.status === 403,
  );
});

test('phase5: cancelSubscription trial cancels locally', async () => {
  let updated;
  const fn = functions.get('cancelSubscription');
  const result = await fn.handler(
    mockCtx({
      user: { id: 'u1', role: 'organizer_admin', email: 'a@x.com' },
      service: {
        Subscription: {
          filter: async () => [{ id: 's1', status: 'trialing', user_id: 'u1' }],
          update: async (id, d) => {
            updated = { id, ...d };
            return updated;
          },
        },
      },
    }),
    {},
  );
  assert.equal(result.success, true);
  assert.equal(updated.status, 'cancelled');
  assert.ok(updated.cancelled_at);
});

test('phase5: verifySubscriptionPayment validates session_id', async () => {
  const fn = functions.get('verifySubscriptionPayment');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: 'u1', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('phase5: processLeagueRefund already refunded → 409', async () => {
  const fn = functions.get('processLeagueRefund');
  await assert.rejects(
    () =>
      fn.handler(
        mockCtx({
          user: { id: 'u1', role: 'admin', email: 'admin@x.com' },
          service: {
            LeagueMember: {
              filter: async () => [{ id: 'm1', payment_status: 'refunded', organization_id: 'o1' }],
            },
          },
        }),
        { member_id: 'm1', refund_type: 'manual' },
      ),
    (err) => err.status === 409,
  );
});

test('phase5: finalizeLeagueSession requires assignments_generated', async () => {
  const fn = functions.get('finalizeLeagueSession');
  await assert.rejects(
    () =>
      fn.handler(
        mockCtx({
          user: { id: 'u1', role: 'admin' },
          service: {
            LeagueSession: {
              filter: async () => [
                {
                  id: 's1',
                  league_id: 'l1',
                  status: 'open',
                  assignments_generated: false,
                  date: '2026-08-01',
                },
              ],
            },
            League: {
              filter: async () => [{ id: 'l1', name: 'L', organization_id: 'o1' }],
            },
          },
        }),
        { sessionId: 's1' },
      ),
    (err) => err.status === 400 && /assignments/i.test(err.message),
  );
});
