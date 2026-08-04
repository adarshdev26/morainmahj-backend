const Entity = require('../models/Entity');

// Responses mirror the Base44 SDK: collections are bare arrays and records are
// bare objects, so the frontend needs no reshaping. Every request is scoped to
// the caller's row-level security policy.
function handle(handler) {
  return async (req, res) => {
    try {
      await handler(req, res, Entity.scoped({ actor: req.actor, query: req.query }));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error(`Entity API error (${req.method} ${req.originalUrl}):`, err.message);
      }
      res.status(status).json({
        error: status >= 500 ? 'Internal server error' : err.message,
      });
    }
  };
}

function parseFilter(raw) {
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

const listEntities = handle(async (req, res) => {
  res.json({ entities: await Entity.listEntities() });
});

const find = handle(async (req, res, entities) => {
  // The SDK sends the filter as `q`; `filter` is accepted as a friendlier alias.
  const rows = await entities.find(req.params.entity, {
    filter: parseFilter(req.query.q || req.query.filter),
    sort: req.query.sort,
    limit: req.query.limit,
    skip: req.query.skip,
    fields: req.query.fields,
  });
  res.json(rows);
});

const findById = handle(async (req, res, entities) => {
  const row = await entities.findById(req.params.entity, req.params.id);
  if (!row) {
    return res.status(404).json({ error: `${req.params.entity} ${req.params.id} not found` });
  }
  res.json(row);
});

const create = handle(async (req, res, entities) => {
  res.status(201).json(await entities.create(req.params.entity, req.body || {}));
});

const update = handle(async (req, res, entities) => {
  res.json(await entities.update(req.params.entity, req.params.id, req.body || {}));
});

const remove = handle(async (req, res, entities) => {
  await entities.remove(req.params.entity, req.params.id);
  res.json({ success: true });
});

const bulkCreate = handle(async (req, res, entities) => {
  res.status(201).json(await entities.bulkCreate(req.params.entity, req.body));
});

const bulkUpdate = handle(async (req, res, entities) => {
  res.json(await entities.bulkUpdate(req.params.entity, req.body));
});

module.exports = { bulkCreate, bulkUpdate, create, find, findById, listEntities, remove, update };
