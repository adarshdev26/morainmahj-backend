const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, BY_PATH } = require('../src/routes/actionRegistry');

test('action registry has unique kebab paths', () => {
  const paths = ACTIONS.map((a) => a.path);
  assert.equal(new Set(paths).size, paths.length);
});

test('ported public leaderboard action is registered as public', () => {
  const action = BY_PATH.get('get-public-leaderboard');
  assert.ok(action);
  assert.equal(action.name, 'getPublicLeaderboard');
  assert.equal(action.public, true);
});

test('protected action requires auth by default', () => {
  const action = BY_PATH.get('get-demo-tournament-for-user');
  assert.ok(action);
  assert.equal(action.public, false);
});
