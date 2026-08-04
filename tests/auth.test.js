// Exercises the auth and user routes against a stubbed pool, so the success
// paths can be verified without a live database.
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const express = require('express');

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';

const PASSWORD = 'correct-horse-battery';
const dbPath = require.resolve('../db');

const users = [];
const fakePool = {
  query: async (sql, params) => {
    if (/lower\(email\)/.test(sql)) {
      const email = String(params[0]).toLowerCase();
      return { rows: users.filter((u) => u.email.toLowerCase() === email) };
    }
    if (/WHERE id = \$1/.test(sql)) {
      return { rows: users.filter((u) => u.id === params[0]) };
    }
    if (/LIMIT \$1/.test(sql)) {
      return { rows: users.slice(0, params[0]) };
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};

// Both models resolve to this same absolute path, so stubbing it here covers them.
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakePool,
};

const Auth = require('../src/models/Auth');
const authRoutes = require('../src/routes/authRoutes');
const userRoutes = require('../src/routes/userRoutes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

let baseUrl;
let server;

before(async () => {
  users.push({
    id: '6a6fc8a29faef1877c71360e',
    email: 'Player@Example.com',
    full_name: 'Test Player',
    role: 'user',
    organization_id: 'org-1',
    disabled: false,
    password: await Auth.hashPassword(PASSWORD),
  });
  users.push({
    id: 'disabled-user-id',
    email: 'blocked@example.com',
    full_name: 'Blocked Player',
    role: 'user',
    organization_id: 'org-1',
    disabled: true,
    password: await Auth.hashPassword(PASSWORD),
  });

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

function login(body) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function tokenFor(email = 'player@example.com') {
  const res = await login({ email, password: PASSWORD });
  return (await res.json()).token;
}

test('rejects a request with no credentials', async () => {
  const res = await login({});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);
});

test('rejects a wrong password', async () => {
  const res = await login({ email: 'player@example.com', password: 'nope' });
  assert.equal(res.status, 401);
});

test('gives an unknown email the same answer as a wrong password', async () => {
  const unknown = await login({ email: 'nobody@example.com', password: 'nope' });
  const wrong = await login({ email: 'player@example.com', password: 'nope' });
  assert.equal(unknown.status, wrong.status);
  assert.deepEqual(await unknown.json(), await wrong.json());
});

test('rejects a disabled account that has the right password', async () => {
  const res = await login({ email: 'blocked@example.com', password: PASSWORD });
  assert.equal(res.status, 403);
});

test('issues a token for valid credentials and never returns the password', async () => {
  const res = await login({ email: 'player@example.com', password: PASSWORD });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.token, 'string');
  assert.deepEqual(body.user, {
    id: '6a6fc8a29faef1877c71360e',
    email: 'Player@Example.com',
    name: 'Test Player',
    role: 'user',
    organization_id: 'org-1',
  });
  assert.ok(!JSON.stringify(body).includes(PASSWORD));
  assert.ok(!('password' in body.user));
});

test('signs a token carrying the user id and email', async () => {
  const decoded = Auth.verifyToken(await tokenFor());
  assert.equal(decoded.id, '6a6fc8a29faef1877c71360e');
  assert.equal(decoded.email, 'Player@Example.com');
  // 7 day expiry, allowing a minute of slack for test runtime.
  assert.ok(Math.abs(decoded.exp - decoded.iat - 7 * 24 * 60 * 60) < 60);
});

test('accepts a plaintext dev seed as well as a bcrypt hash', async () => {
  users.push({
    id: 'plaintext-user',
    email: 'seed@example.com',
    full_name: 'Seed User',
    role: 'user',
    organization_id: null,
    disabled: false,
    password: 'dev-plaintext',
  });

  assert.equal((await login({ email: 'seed@example.com', password: 'dev-plaintext' })).status, 200);
  assert.equal((await login({ email: 'seed@example.com', password: 'wrong' })).status, 401);
});

test('/api/auth/me returns the caller and withholds the password hash', async () => {
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${await tokenFor()}` },
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.user.email, 'Player@Example.com');
  assert.equal(body.user.name, 'Test Player');
  assert.ok(!('password' in body.user), 'password hash must not be exposed');
});

test('/api/auth/me rejects a missing, malformed or invalid token', async () => {
  assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: 'Bearer garbage' } })).status,
    401
  );
  // Token without the "Bearer " scheme.
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: await tokenFor() } })).status,
    401
  );
});

test('/api/auth/logout succeeds with a token and 401s without one', async () => {
  const res = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await tokenFor()}` },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, message: 'Logged out' });

  assert.equal((await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })).status, 401);
});

test('/api/users requires a token and strips password hashes from the list', async () => {
  assert.equal((await fetch(`${baseUrl}/api/users`)).status, 401);

  const res = await fetch(`${baseUrl}/api/users`, {
    headers: { Authorization: `Bearer ${await tokenFor()}` },
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.count, body.data.length);
  assert.ok(body.data.length > 0);
  for (const row of body.data) {
    assert.ok(!('password' in row), `password leaked for ${row.email}`);
  }
  assert.ok(!JSON.stringify(body).includes(PASSWORD));
});

test('/api/users/:id returns a user, 404s an unknown id and requires a token', async () => {
  const token = await tokenFor();
  assert.equal((await fetch(`${baseUrl}/api/users/6a6fc8a29faef1877c71360e`)).status, 401);

  const found = await fetch(`${baseUrl}/api/users/6a6fc8a29faef1877c71360e`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(found.status, 200);
  const user = await found.json();
  assert.equal(user.email, 'Player@Example.com');
  assert.ok(!('password' in user), 'password hash must not be exposed');

  const missing = await fetch(`${baseUrl}/api/users/does-not-exist`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(missing.status, 404);
});

test('reports the missing password column with an actionable message', async () => {
  const original = fakePool.query;
  fakePool.query = async () => {
    throw Object.assign(new Error('column "password" does not exist'), { code: '42703' });
  };

  const res = await login({ email: 'player@example.com', password: PASSWORD });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /migrations\/001_add_user_password\.sql/);

  fakePool.query = original;
});
