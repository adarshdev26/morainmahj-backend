const test = require('node:test');
const assert = require('node:assert/strict');
const functions = require('../src/functions');
const { BY_PATH } = require('../src/routes/actionRegistry');

const PHASE2_PORTED = [
  'recalculateLeagueWaitlist',
  'promoteFromWaitlistCourse',
  'generateLeagueAssignments',
  'qrCheckIn',
  'sendBulkEmails',
  'sendLeagueInvites',
  'sendBulkSMS',
  'sendLeagueBulkSMS',
  'sendPushNotification',
  'syncOneSignalIdentity',
];

function mockCtx({ user = null, service = {} } = {}) {
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
    entities: entityProxy(service.scoped || {}),
    asServiceRole: { entities: entityProxy(service.role || {}) },
  };
}

test('phase2 recovered actions are registered in function registry', () => {
  for (const name of PHASE2_PORTED) {
    assert.equal(functions.has(name), true, `${name} should be ported`);
    assert.equal(typeof functions.get(name).handler, 'function');
  }
});

test('recalculateLeagueWaitlist rejects missing session_id', async () => {
  const fn = functions.get('recalculateLeagueWaitlist');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), {}),
    (err) => err.status === 400,
  );
});

test('recalculateLeagueWaitlist requires auth for direct calls', async () => {
  const fn = functions.get('recalculateLeagueWaitlist');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: null }), { session_id: 's1' }),
    (err) => err.status === 401,
  );
});

test('recalculateLeagueWaitlist reorders waitlist with regulars first', async () => {
  const updates = [];
  const fn = functions.get('recalculateLeagueWaitlist');
  const result = await fn.handler(
    mockCtx({
      user: { id: '1', role: 'user' },
      service: {
        role: {
          LeagueRSVP: {
            filter: async () => [
              {
                id: 'r1',
                league_id: 'L1',
                player_email: 'guest@x.com',
                responded_at: '2026-01-01T10:00:00Z',
              },
              {
                id: 'r2',
                league_id: 'L1',
                player_email: 'regular@x.com',
                responded_at: '2026-01-01T12:00:00Z',
              },
            ],
            update: async (id, data) => {
              updates.push({ id, ...data });
              return {};
            },
          },
          LeagueMember: {
            filter: async () => [
              { player_email: 'regular@x.com', is_regular: true, active: true },
            ],
          },
        },
      },
    }),
    { session_id: 's1', league_id: 'L1' },
  );

  assert.equal(result.success, true);
  assert.equal(result.reordered, 2);
  assert.equal(updates[0].id, 'r2');
  assert.equal(updates[0].waitlist_position, 1);
  assert.equal(updates[1].id, 'r1');
  assert.equal(updates[1].waitlist_position, 2);
});

test('promoteFromWaitlistCourse forbids non-admin', async () => {
  const fn = functions.get('promoteFromWaitlistCourse');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { courseId: 'c1' }),
    (err) => err.status === 403,
  );
});

test('generateLeagueAssignments forbids non-admin', async () => {
  const fn = functions.get('generateLeagueAssignments');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { sessionId: 's1' }),
    (err) => err.status === 403,
  );
});

test('qrCheckIn forbids checking in as another user', async () => {
  const fn = functions.get('qrCheckIn');
  await assert.rejects(
    () =>
      fn.handler(mockCtx({ user: { id: '1', role: 'user', email: 'a@x.com' } }), {
        tournamentId: 't1',
        playerEmail: 'b@x.com',
      }),
    (err) => err.status === 403,
  );
});

test('qrCheckIn requires playerEmail', async () => {
  const fn = functions.get('qrCheckIn');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'admin', email: 'a@x.com' } }), {}),
    (err) => err.status === 400,
  );
});

test('sendBulkEmails requires admin', async () => {
  const fn = functions.get('sendBulkEmails');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), {}),
    (err) => err.status === 401,
  );
});

test('sendLeagueInvites requires admin', async () => {
  const fn = functions.get('sendLeagueInvites');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), { sessionId: 's1' }),
    (err) => err.status === 403,
  );
});

test('sendBulkSMS requires admin', async () => {
  const fn = functions.get('sendBulkSMS');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), {}),
    (err) => err.status === 403,
  );
});

test('sendLeagueBulkSMS requires admin', async () => {
  const fn = functions.get('sendLeagueBulkSMS');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), {}),
    (err) => err.status === 401,
  );
});

test('sendPushNotification requires admin and fields', async () => {
  const fn = functions.get('sendPushNotification');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'user' } }), {}),
    (err) => err.status === 403,
  );
  await assert.rejects(
    () => fn.handler(mockCtx({ user: { id: '1', role: 'admin' } }), {}),
    (err) => err.status === 400,
  );
});

test('syncOneSignalIdentity requires auth', async () => {
  const fn = functions.get('syncOneSignalIdentity');
  await assert.rejects(
    () => fn.handler(mockCtx({ user: null }), {}),
    (err) => err.status === 401,
  );
});

test('syncOneSignalIdentity reports not_configured without credentials', async () => {
  const prevApp = process.env.ONESIGNAL_APP_ID;
  const prevKey = process.env.ONESIGNAL_REST_API_KEY;
  delete process.env.ONESIGNAL_APP_ID;
  delete process.env.ONESIGNAL_REST_API_KEY;
  try {
    const fn = functions.get('syncOneSignalIdentity');
    const result = await fn.handler(
      mockCtx({ user: { id: 'u1', email: 'a@x.com' } }),
      { platform: 'web' },
    );
    assert.equal(result.success, false);
    assert.equal(result.reason, 'not_configured');
  } finally {
    if (prevApp !== undefined) process.env.ONESIGNAL_APP_ID = prevApp;
    if (prevKey !== undefined) process.env.ONESIGNAL_REST_API_KEY = prevKey;
  }
});
