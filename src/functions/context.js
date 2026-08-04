// Builds the object the ported Base44 functions receive.
//
// The exported functions were written against the Base44 SDK, using
// `base44.auth.me()`, `base44.entities.X` (policy-scoped) and
// `base44.asServiceRole.entities.X` (unrestricted). Reproducing that shape here
// means each port keeps the original's structure, including its permission
// checks, instead of being rewritten from scratch.
const Entity = require('../models/Entity');
const User = require('../models/User');

// Turns Entity's positional API into the SDK's per-entity handler objects.
function entityProxy(build) {
  const cache = new Map();
  return new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string' || name === 'then' || name.startsWith('_')) return undefined;
        if (!cache.has(name)) cache.set(name, build(name));
        return cache.get(name);
      },
    }
  );
}

function serviceRoleEntities() {
  const maxLimit = Entity.SERVICE_MAX_LIMIT;
  return entityProxy((entity) => ({
    list: (sort, limit, skip, fields) =>
      Entity.find(entity, { sort, limit, skip, fields, maxLimit }),
    filter: (query, sort, limit, skip, fields) =>
      Entity.find(entity, { filter: query, sort, limit, skip, fields, maxLimit }),
    get: (id) => Entity.findById(entity, id),
    create: (data) => Entity.create(entity, data),
    update: (id, data) => Entity.update(entity, id, data),
    delete: (id) => Entity.remove(entity, id),
    bulkCreate: (rows) => Entity.bulkCreate(entity, rows),
    bulkUpdate: (rows) => Entity.bulkUpdate(entity, rows),
  }));
}

function scopedEntities(context) {
  const scoped = Entity.scoped(context);
  return entityProxy((entity) => ({
    list: (sort, limit, skip, fields) => scoped.find(entity, { sort, limit, skip, fields }),
    filter: (query, sort, limit, skip, fields) =>
      scoped.find(entity, { filter: query, sort, limit, skip, fields }),
    get: (id) => scoped.findById(entity, id),
    create: (data) => scoped.create(entity, data),
    update: (id, data) => scoped.update(entity, id, data),
    delete: (id) => scoped.remove(entity, id),
    bulkCreate: (rows) => scoped.bulkCreate(entity, rows),
    bulkUpdate: (rows) => scoped.bulkUpdate(entity, rows),
  }));
}

/**
 * @param req an Express request; req.actor is set by loadActor and absent for
 *   the functions that are published without authentication.
 */
function createContext(req) {
  const actor = req.actor || null;
  const context = actor ? { actor, query: req.query } : null;

  return {
    // Base44 resolved the caller's full record here, including custom fields
    // that the exports address as `user.data.*`. The flattened columns are
    // exposed both directly and under `data` so either style keeps working.
    // Returns null for an anonymous caller, which the ports check for.
    auth: {
      me: async () => {
        if (!actor) return null;
        const user = await User.findById(actor.id);
        if (!user) return null;
        return { ...user, name: user.full_name, data: user };
      },
    },
    // Unavailable anonymously: a policy-scoped view needs someone to scope to.
    get entities() {
      if (!context) {
        throw Object.assign(new Error('This function requires authentication'), { status: 401 });
      }
      return scopedEntities(context);
    },
    asServiceRole: { entities: serviceRoleEntities() },
    actor,
  };
}

module.exports = { createContext };
