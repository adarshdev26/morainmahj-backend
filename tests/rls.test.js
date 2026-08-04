// Verifies the row-level security engine against the policies exported from
// Base44, from the perspective of each role the app uses.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const Rls = require('../src/models/Rls');

const REGISTRATION_COLUMNS = new Set([
  'id',
  'player_id',
  'player_email',
  'organization_id',
  'tournament_id',
  'created_by',
]);

const PLAYER = { id: 'u-player', email: 'player@example.com', role: 'user', organization_id: null };
const ORGANIZER = {
  id: 'u-org',
  email: 'org@example.com',
  role: 'organizer_admin',
  organization_id: 'org-1',
};
const ADMIN = { id: 'u-admin', email: 'admin@example.com', role: 'admin', organization_id: 'org-1' };

function readFor(entity, actor, columns = REGISTRATION_COLUMNS, query = {}) {
  return Rls.readPredicate(entity, { columns, actor, query });
}

test('an admin reads without any row restriction', () => {
  const { sql, values } = readFor('Registration', ADMIN);
  assert.equal(sql, 'TRUE');
  assert.deepEqual(values, [], 'a settled branch binds no parameters');
});

test('a player is confined to their own registrations', () => {
  const { sql, values } = readFor('Registration', PLAYER);

  assert.match(sql, /"player_id" = \$1/);
  assert.match(sql, /"player_email" = \$2/);
  assert.ok(sql.includes(' OR '), 'either identifier may match');
  assert.ok(!sql.includes('TRUE'), 'nothing widens the query back to every row');
  assert.deepEqual(values, [PLAYER.id, PLAYER.email]);
});

test('an organizer_admin is confined to their own organisation', () => {
  const { sql, values } = readFor('Registration', ORGANIZER);
  assert.match(sql, /"organization_id" = \$1/);
  assert.equal(values[0], 'org-1');
});

test('placeholders never leak into SQL and bind values instead', () => {
  const { sql } = readFor('Registration', PLAYER);
  assert.ok(!sql.includes('{{'), 'no unresolved template survives compilation');
  assert.ok(!sql.includes(PLAYER.email), 'the value is bound, not interpolated');
});

test('every parameter emitted is referenced by the SQL', () => {
  // A stray bind value would make Postgres reject the statement outright.
  for (const actor of [PLAYER, ORGANIZER, ADMIN]) {
    const { sql, values } = readFor('Registration', actor);
    for (let i = 1; i <= values.length; i += 1) {
      assert.ok(sql.includes(`$${i}`), `$${i} is referenced for role ${actor.role}`);
    }
    const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(highest, values.length, `no gaps for role ${actor.role}`);
  }
});

test('publicly readable entities compile to no restriction', () => {
  const columns = new Set(['id', 'question', 'answer']);
  for (const entity of ['FAQ', 'Testimonial', 'Tournament', 'CardHand']) {
    assert.equal(readFor(entity, PLAYER, columns).sql, 'TRUE', entity);
  }
});

test('an anonymous caller gets nothing from a policed entity', () => {
  const { sql } = readFor('Registration', null);
  assert.equal(sql, 'FALSE', 'a missing actor cannot resolve {{user.id}} and must not match all');
});

test('an unknown entity fails closed', () => {
  assert.equal(readFor('NotAnEntity', ADMIN).sql, 'FALSE');
});

test('a policy naming an absent column fails closed rather than erroring', () => {
  const { sql } = readFor('Registration', PLAYER, new Set(['id']));
  assert.equal(sql, 'FALSE');
});

test('a share token grants read access only with the matching token', () => {
  const columns = new Set(['id', 'token', 'active', 'shared_by_id', 'organization_id']);

  const withToken = Rls.readPredicate('ShareInvite', {
    columns,
    actor: PLAYER,
    query: { token: 'secret-token' },
  });
  assert.match(withToken.sql, /"token" = \$/);
  assert.ok(withToken.values.includes('secret-token'));

  const withoutToken = Rls.readPredicate('ShareInvite', { columns, actor: PLAYER, query: {} });
  assert.ok(
    !withoutToken.sql.includes('"token"'),
    'no token supplied means the token branch is dropped, not left open'
  );
});

test('writes are judged against the row, per role', () => {
  const own = { player_id: PLAYER.id, organization_id: 'org-1' };
  const other = { player_id: 'someone-else', organization_id: 'org-2' };

  assert.equal(Rls.canWrite('Registration', 'update', { row: own, actor: PLAYER }), true);
  assert.equal(Rls.canWrite('Registration', 'update', { row: other, actor: PLAYER }), false);

  assert.equal(Rls.canWrite('Registration', 'delete', { row: other, actor: ADMIN }), true);

  assert.equal(
    Rls.canWrite('Registration', 'update', { row: own, actor: ORGANIZER }),
    true,
    'same organisation'
  );
  assert.equal(
    Rls.canWrite('Registration', 'update', { row: other, actor: ORGANIZER }),
    false,
    'a different organisation is refused'
  );
});

test('creating a Tournament is allowed by the created_by branch', () => {
  // Entity.scoped stamps created_by from the actor, which is what satisfies this.
  assert.equal(
    Rls.canWrite('Tournament', 'create', {
      row: { name: 'New Cup', created_by: PLAYER.email },
      actor: PLAYER,
    }),
    true
  );
  assert.equal(
    Rls.canWrite('Tournament', 'create', {
      row: { name: 'New Cup', created_by: 'someone.else@example.com' },
      actor: PLAYER,
    }),
    false
  );
});

test('an unknown entity cannot be written at all', () => {
  assert.equal(Rls.canWrite('NotAnEntity', 'create', { row: {}, actor: ADMIN }), false);
});

test('the User entity carries no exported policy and is reported as such', () => {
  assert.equal(Rls.isPoliced('User'), false);
  assert.equal(Rls.isPoliced('Registration'), true);
});
