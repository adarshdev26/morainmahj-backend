const Entity = require('../models/Entity');

// Query keys reserved for pagination / projection — everything else is a filter
// field on the entity (flat REST style: ?status=upcoming&tournament_id=…).
const RESERVED_QUERY = new Set(['sort', 'limit', 'skip', 'fields', 'q', 'filter']);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Authenticated callers use Entity.scoped. Anonymous public-read callers still
 * go through RLS with a null actor (empty read policies → unrestricted;
 * private entities → FALSE).
 */
function entitiesFor(req) {
  if (req.actor) {
    return Entity.scoped({ actor: req.actor, query: req.query });
  }

  const context = { actor: null, query: req.query };
  const authRequired = () => {
    throw httpError(401, 'Authentication required');
  };

  return {
    find: (entity, options) => Entity.find(entity, options, context),
    findById: async (entity, id) => {
      const [row] = await Entity.find(entity, { filter: { id }, limit: 1 }, context);
      return row || null;
    },
    create: authRequired,
    update: authRequired,
    remove: authRequired,
    bulkCreate: authRequired,
    bulkUpdate: authRequired,
  };
}

function handle(handler) {
  return async (req, res) => {
    try {
      await handler(req, res, entitiesFor(req));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error(`Resource API error (${req.method} ${req.originalUrl}):`, err.message);
      }
      res.status(status).json({
        error: status >= 500 ? 'Internal server error' : err.message,
      });
    }
  };
}

function coerceValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  return raw;
}

// Express may give a string, an array (repeated keys), or we accept comma lists
// so clients can send ?id=a,b,c for the same ANY() filter Entity.buildWhere supports.
function normalizeFilterValue(value) {
  if (Array.isArray(value)) {
    return value.map(coerceValue);
  }
  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').map((part) => coerceValue(part.trim())).filter((part) => part !== '');
  }
  return coerceValue(value);
}

function filterFromQuery(query) {
  const filter = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (RESERVED_QUERY.has(key)) continue;
    if (value === undefined) continue;
    filter[key] = normalizeFilterValue(value);
  }
  return filter;
}

// Prefer flat query params; still accept legacy `q` / `filter` JSON during dual-run
// so smoke tests can compare old and new endpoints easily.
function resolveFilter(query) {
  const flat = filterFromQuery(query);
  if (Object.keys(flat).length > 0) return flat;

  const raw = query.q || query.filter;
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('filter must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw Object.assign(new Error(`Invalid filter: ${err.message}`), { status: 400 });
  }
}

function entityName(req) {
  const name = req.resourceEntity;
  if (!name) throw Object.assign(new Error('Resource entity is not configured'), { status: 500 });
  return name;
}

const list = handle(async (req, res, entities) => {
  const rows = await entities.find(entityName(req), {
    filter: resolveFilter(req.query),
    sort: req.query.sort,
    limit: req.query.limit,
    skip: req.query.skip,
    fields: req.query.fields,
  });
  res.json(rows);
});

const getById = handle(async (req, res, entities) => {
  const row = await entities.findById(entityName(req), req.params.id);
  if (!row) {
    return res.status(404).json({ error: `${entityName(req)} ${req.params.id} not found` });
  }
  res.json(row);
});

const create = handle(async (req, res, entities) => {
  res.status(201).json(await entities.create(entityName(req), req.body || {}));
});

const update = handle(async (req, res, entities) => {
  res.json(await entities.update(entityName(req), req.params.id, req.body || {}));
});

const remove = handle(async (req, res, entities) => {
  await entities.remove(entityName(req), req.params.id);
  res.json({ success: true });
});

const bulkCreate = handle(async (req, res, entities) => {
  res.status(201).json(await entities.bulkCreate(entityName(req), req.body));
});

const bulkUpdate = handle(async (req, res, entities) => {
  res.json(await entities.bulkUpdate(entityName(req), req.body));
});

module.exports = {
  bulkCreate,
  bulkUpdate,
  create,
  filterFromQuery,
  getById,
  list,
  remove,
  resolveFilter,
  update,
};
