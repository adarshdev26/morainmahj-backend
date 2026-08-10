// Exercises the generic entity API against a stubbed pool, asserting both the
// SQL it generates and the guards that keep it safe to expose.
const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');
const express = require('express');

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';

const dbPath = require.resolve('../db');

const SCHEMA = {
  Tournament: [
    'id',
    'created_date',
    'updated_date',
    'name',
    'status',
    'date',
    'created_by',
    'created_by_id',
    'organization_id',
  ],
  User: ['id', 'created_date', 'updated_date', 'email', 'full_name', 'role', 'disabled', 'password'],
  Registration: [
    'id',
    'created_date',
    'player_email',
    'player_id',
    'tournament_id',
    'organization_id',
  ],
  // Not every exported table carries the timestamp columns.
  Testimonial: ['id', 'author', 'quote'],
};

const ACTOR_ID = 'actor-1';
const ACTOR_EMAIL = 'player@example.com';

let queries = [];
let nextRows = [];
// Swapped per test to exercise the policies from different roles.
let actorRole = 'admin';
let actorOrg = 'org-1';

const fakePool = {
  query: async (sql, params = []) => {
    if (/information_schema\.columns/.test(sql)) {
      const rows = [];
      for (const [table, columns] of Object.entries(SCHEMA)) {
        for (const column of columns) rows.push({ table_name: table, column_name: column });
      }
      return { rows };
    }
    // The per-request actor lookup is infrastructure, not part of what a test
    // asserts on, so it is served without being recorded.
    if (/FROM "User" WHERE id = \$1/.test(sql) && params[0] === ACTOR_ID) {
      return {
        rows: [
          {
            id: ACTOR_ID,
            email: ACTOR_EMAIL,
            full_name: 'Test Actor',
            role: actorRole,
            organization_id: actorOrg,
            disabled: false,
          },
        ],
        rowCount: 1,
      };
    }
    queries.push({ sql, params });
    const rows = nextRows;
    return { rows, rowCount: rows.length };
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakePool,
};

const Auth = require('../src/models/Auth');
const entityRoutes = require('../src/routes/entityRoutes');

const app = express();
app.use(express.json());
app.use('/api/entities', entityRoutes);

let baseUrl;
let server;
let token;

before(async () => {
  token = Auth.generateToken({ id: ACTOR_ID, email: ACTOR_EMAIL });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(() => {
  queries = [];
  nextRows = [];
  // Most tests assert on SQL shape, so they run as an admin whose policies
  // collapse to TRUE and add no predicate of their own.
  actorRole = 'admin';
  actorOrg = 'org-1';
});

function get(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    ...options,
  });
}

function send(path, method, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('every entity route requires a token', async () => {
  const res = await fetch(`${baseUrl}/api/entities/Tournament`);
  assert.equal(res.status, 401);
});

test('filter turns a query object into parameterised equality clauses', async () => {
  nextRows = [{ id: 'r1', player_email: 'a@b.com' }];
  const res = await get(
    `/api/entities/Registration?q=${encodeURIComponent(JSON.stringify({ player_email: 'a@b.com', tournament_id: 't1' }))}&sort=-created_date&limit=200`
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), nextRows, 'responds with a bare array like the SDK');

  const { sql, params } = queries[0];
  assert.match(sql, /WHERE "player_email" = \$1 AND "tournament_id" = \$2/);
  assert.match(sql, /ORDER BY "created_date" DESC/);
  assert.match(sql, /LIMIT \$3/);
  assert.deepEqual(params, ['a@b.com', 't1', 200]);
});

test('an array value becomes an ANY lookup so id lists work', async () => {
  await get(`/api/entities/Tournament?q=${encodeURIComponent(JSON.stringify({ id: ['a', 'b'] }))}`);
  assert.match(queries[0].sql, /WHERE "id" = ANY\(\$1\)/);
  assert.deepEqual(queries[0].params[0], ['a', 'b']);
});

test('defaults match the legacy platform SDK: 50 rows, newest first', async () => {
  await get('/api/entities/Tournament');
  assert.match(queries[0].sql, /ORDER BY "created_date" DESC/);
  assert.equal(queries[0].params.at(-1), 50);
});

test('the implicit sort falls away for tables without created_date', async () => {
  await get('/api/entities/Testimonial');
  assert.ok(!queries[0].sql.includes('ORDER BY'), 'no sort rather than an error');

  const explicit = await get('/api/entities/Testimonial?sort=-created_date');
  assert.equal(explicit.status, 400, 'but asking for it explicitly is still an error');
});

test('limit is capped and skip becomes an offset', async () => {
  await get('/api/entities/Tournament?limit=999999&skip=25');
  assert.match(queries[0].sql, /OFFSET/);
  assert.equal(queries[0].params[0], 5000, 'clamped to the SDK maximum');
  assert.equal(queries[0].params[1], 25);
});

test('fields projects columns and always keeps id', async () => {
  await get('/api/entities/Tournament?fields=name,status');
  assert.match(queries[0].sql, /SELECT "id", "name", "status" FROM "Tournament"/);
});

test('an unknown entity is a 404, not a SQL error', async () => {
  const res = await get('/api/entities/DoesNotExist');
  assert.equal(res.status, 404);
  assert.equal(queries.length, 0, 'never reaches the database');
});

test('unknown filter, sort and field names are rejected', async () => {
  const cases = [
    `/api/entities/Tournament?q=${encodeURIComponent(JSON.stringify({ nope: 1 }))}`,
    '/api/entities/Tournament?sort=nope',
    '/api/entities/Tournament?fields=nope',
  ];
  for (const path of cases) {
    const res = await get(path);
    assert.equal(res.status, 400, path);
  }
  assert.equal(queries.length, 0, 'nothing reaches the database');
});

test('identifiers cannot be used to inject SQL', async () => {
  const attacks = [
    '/api/entities/Tournament?sort=' + encodeURIComponent('name"; DROP TABLE "User'),
    '/api/entities/Tournament?fields=' + encodeURIComponent('name"; DROP TABLE "User'),
    '/api/entities/' + encodeURIComponent('Tournament"; DROP TABLE "User'),
    '/api/entities/Tournament?q=' +
      encodeURIComponent(JSON.stringify({ 'name" = "x': 'anything' })),
  ];
  for (const path of attacks) {
    const res = await get(path);
    assert.ok(res.status === 400 || res.status === 404, `${path} -> ${res.status}`);
  }
  assert.equal(queries.length, 0, 'no crafted SQL is ever executed');
});

test('a malformed q parameter is a 400', async () => {
  const res = await get('/api/entities/Tournament?q=not-json');
  assert.equal(res.status, 400);
});

test('User rows never carry the password hash', async () => {
  nextRows = [{ id: 'u1', email: 'a@b.com', role: 'user', password: '$2b$10$hash' }];

  const list = await get('/api/entities/User');
  const rows = await list.json();
  assert.equal(rows.length, 1);
  assert.ok(!('password' in rows[0]), 'stripped from collections');

  const single = await get('/api/entities/User/u1');
  assert.ok(!('password' in (await single.json())), 'stripped from single records');
});

test('password, role and disabled cannot be written through the entity API', async () => {
  for (const field of ['password', 'role', 'disabled']) {
    nextRows = [{ id: 'u1', email: 'someone@example.com' }];
    const res = await send('/api/entities/User/u1', 'PUT', { [field]: 'attacker-value' });

    assert.equal(res.status, 400, `${field} must be refused`);
    const writes = queries.filter((q) => /^\s*UPDATE/.test(q.sql));
    assert.equal(writes.length, 0, `${field} must never reach an UPDATE`);
  }
});

test('other User fields remain editable', async () => {
  nextRows = [{ id: 'u1', full_name: 'New Name' }];
  const res = await send('/api/entities/User/u1', 'PUT', {
    full_name: 'New Name',
    role: 'admin',
  });

  assert.equal(res.status, 200);
  const { sql, params } = queries.find((q) => /^\s*UPDATE/.test(q.sql));
  assert.match(sql, /SET "full_name" = \$2, "updated_date" = NOW\(\)/);
  assert.ok(!sql.includes('role'), 'the smuggled role is dropped, not written');
  assert.deepEqual(params, ['u1', 'New Name']);
});

test('create generates an id, stamps the dates and attributes the creator', async () => {
  nextRows = [{ id: 'generated' }];
  const res = await send('/api/entities/Tournament', 'POST', { name: 'New Cup', bogus: 'ignored' });

  assert.equal(res.status, 201);
  const { sql, params } = queries.find((q) => /INSERT INTO/.test(q.sql));
  assert.match(
    sql,
    /INSERT INTO "Tournament" \("id", "name", "created_by", "created_by_id", "created_date", "updated_date"\)/
  );
  assert.match(sql, /VALUES \(\$1, \$2, \$3, \$4, NOW\(\), NOW\(\)\)/);
  assert.match(params[0], /^[0-9a-f]{24}$/, 'a 24-character hex id like the export uses');
  assert.deepEqual(params.slice(1), ['New Cup', ACTOR_EMAIL, ACTOR_ID]);
  assert.ok(!sql.includes('bogus'), 'unknown fields are ignored rather than written');
});

test('a player cannot update a registration belonging to someone else', async () => {
  actorRole = 'user';
  nextRows = [{ id: 'r1', player_id: 'a-different-player', player_email: 'other@example.com' }];

  const res = await send('/api/entities/Registration/r1', 'PUT', { player_name: 'Hijacked' });

  assert.equal(res.status, 403);
  assert.equal(
    queries.filter((q) => /^\s*UPDATE/.test(q.sql)).length,
    0,
    'refused before any write'
  );
});

test('a player can update their own registration', async () => {
  actorRole = 'user';
  nextRows = [{ id: 'r1', player_id: ACTOR_ID, player_email: ACTOR_EMAIL }];

  const res = await send('/api/entities/Registration/r1', 'PUT', { player_email: ACTOR_EMAIL });
  assert.equal(res.status, 200);
  assert.ok(queries.some((q) => /^\s*UPDATE/.test(q.sql)), 'the write goes through');
});

test('a player reading a policed collection is scoped to their own rows', async () => {
  actorRole = 'user';
  nextRows = [];

  await get('/api/entities/Registration');

  const { sql, params } = queries[0];
  assert.match(sql, /"player_id" = \$1/);
  assert.match(sql, /"player_email" = \$2/);
  assert.deepEqual(params.slice(0, 2), [ACTOR_ID, ACTOR_EMAIL]);
});

test('updating or deleting a missing row is a 404', async () => {
  nextRows = [];
  const updated = await send('/api/entities/Tournament/missing', 'PUT', { name: 'x' });
  assert.equal(updated.status, 404);

  const removed = await fetch(`${baseUrl}/api/entities/Tournament/missing`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(removed.status, 404);
});

test('the entity catalogue lists the available tables', async () => {
  const res = await get('/api/entities');
  const { entities } = await res.json();
  assert.deepEqual(entities, ['Registration', 'Testimonial', 'Tournament', 'User']);
});
