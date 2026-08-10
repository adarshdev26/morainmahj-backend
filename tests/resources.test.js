const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterFromQuery, resolveFilter } = require('../src/controllers/ResourceController');
const { RESOURCES } = require('../src/routes/resourceRegistry');
const { createResourceRouter } = require('../src/routes/createResourceRouter');

describe('ResourceController query parsing', () => {
  it('maps flat query fields into a filter object', () => {
    assert.deepEqual(filterFromQuery({ status: 'upcoming', tournament_id: 'abc' }), {
      status: 'upcoming',
      tournament_id: 'abc',
    });
  });

  it('ignores reserved pagination keys', () => {
    assert.deepEqual(filterFromQuery({ status: 'upcoming', sort: '-created_date', limit: '50' }), {
      status: 'upcoming',
    });
  });

  it('coerces booleans and comma-separated arrays', () => {
    assert.deepEqual(filterFromQuery({ active: 'true', id: 'a,b,c' }), {
      active: true,
      id: ['a', 'b', 'c'],
    });
  });

  it('prefers flat filters over legacy JSON q', () => {
    assert.deepEqual(
      resolveFilter({ status: 'upcoming', q: JSON.stringify({ status: 'past' }) }),
      { status: 'upcoming' }
    );
  });

  it('falls back to legacy JSON q when no flat filters are present', () => {
    assert.deepEqual(resolveFilter({ q: JSON.stringify({ league_id: 'x' }) }), {
      league_id: 'x',
    });
  });
});

describe('resource registry', () => {
  it('registers unique paths and entities', () => {
    const paths = RESOURCES.map((r) => r.path);
    const entities = RESOURCES.map((r) => r.entity);
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(new Set(entities).size, entities.length);
    assert.ok(paths.includes('tournaments'));
    assert.ok(paths.includes('registrations'));
    assert.ok(paths.includes('leagues'));
    assert.ok(paths.includes('score-cards'));
  });

  it('builds a router for a resource without throwing', () => {
    const router = createResourceRouter({
      path: 'tournaments',
      entity: 'Tournament',
      ops: ['list', 'get', 'create', 'update', 'remove'],
    });
    assert.equal(typeof router, 'function');
  });

  it('marks landing/marketing reads as publicOps', () => {
    const byPath = Object.fromEntries(RESOURCES.map((r) => [r.path, r]));
    assert.deepEqual(byPath.tournaments.publicOps, ['list', 'get']);
    assert.deepEqual(byPath['marketing-pages'].publicOps, ['list']);
    assert.deepEqual(byPath['marketing-sections'].publicOps, ['list']);
    assert.deepEqual(byPath['marketing-features'].publicOps, ['list']);
    assert.deepEqual(byPath.faqs.publicOps, ['list']);
    assert.deepEqual(byPath.testimonials.publicOps, ['list']);
    assert.equal(byPath.registrations.publicOps, undefined);
  });
});
