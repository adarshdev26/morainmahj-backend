const crypto = require('crypto');
const pool = require('../../db');
const Rls = require('./Rls');

// Matches the previous SDK's own defaults so pages paginate exactly as they did
// against the hosted API.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 5000;
// Server-side code aggregating whole tables legitimately exceeds the limit the
// SDK imposes on clients; the ported functions ask for up to 8000 rows.
const SERVICE_MAX_LIMIT = 50000;
const DEFAULT_SORT = '-created_date';

// Tables that exist but are not part of the app's data model.
const HIDDEN_TABLES = new Set(['test_table']);

// Stripped from every response, per entity.
const SENSITIVE_FIELDS = { User: ['password'] };

// Maintained by the database, never writable through the API.
const READONLY_FIELDS = new Set(['id', 'created_date', 'updated_date']);

// Privilege- and credential-bearing columns. The generic entity API authenticates
// callers but does not yet distinguish an admin from a player, so these stay
// unwritable here and are changed only through purpose-built endpoints.
const PROTECTED_FIELDS = { User: new Set(['password', 'role', 'disabled']) };

let schemaPromise = null;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Column names come from information_schema and are validated against it before
// ever reaching SQL, which is what makes the quoted identifiers below safe.
function loadSchema() {
  if (!schemaPromise) {
    schemaPromise = pool
      .query(
        `SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          ORDER BY c.table_name, c.ordinal_position`
      )
      .then(({ rows }) => {
        const tables = new Map();
        for (const row of rows) {
          if (HIDDEN_TABLES.has(row.table_name)) continue;
          if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
          tables.get(row.table_name).add(row.column_name);
        }
        return tables;
      })
      .catch((err) => {
        schemaPromise = null;
        throw err;
      });
  }
  return schemaPromise;
}

async function resolve(entity) {
  const tables = await loadSchema();
  if (!tables.has(entity)) {
    throw httpError(404, `Unknown entity "${entity}"`);
  }
  return { table: entity, columns: tables.get(entity) };
}

async function listEntities() {
  const tables = await loadSchema();
  return [...tables.keys()].sort();
}

function sanitize(entity, row) {
  if (!row) return null;
  const hidden = SENSITIVE_FIELDS[entity];
  if (!hidden) return row;
  const safe = { ...row };
  for (const field of hidden) delete safe[field];
  return safe;
}

// Matches the 24-character hex ids used throughout the legacy platform export.
function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function clampLimit(limit, max = MAX_LIMIT) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, max);
}

// legacy platform sort syntax: "field" or "+field" ascending, "-field" descending.
function buildOrderBy(sort, columns, entity) {
  const requested = sort || DEFAULT_SORT;
  const descending = requested.startsWith('-');
  const field = /^[+-]/.test(requested) ? requested.slice(1) : requested;

  if (!columns.has(field)) {
    // Not every table carries created_date, so the implicit default just falls away.
    if (!sort) return '';
    throw httpError(400, `Cannot sort ${entity} by unknown field "${field}"`);
  }
  return ` ORDER BY "${field}" ${descending ? 'DESC' : 'ASC'} NULLS LAST`;
}

// Comma-separated projection; id always comes back so clients can key rows.
function buildSelection(fields, columns, entity) {
  if (!fields) return '*';
  const requested = (Array.isArray(fields) ? fields : String(fields).split(','))
    .map((field) => field.trim())
    .filter(Boolean);

  for (const field of requested) {
    if (!columns.has(field)) {
      throw httpError(400, `Cannot select unknown field "${field}" on ${entity}`);
    }
  }
  if (requested.length === 0) return '*';
  if (!requested.includes('id') && columns.has('id')) requested.unshift('id');
  return requested.map((field) => `"${field}"`).join(', ');
}

// Every filter value is a plain equality match, which is all the frontend uses.
function buildWhere(filter, columns, entity, values) {
  const clauses = [];
  for (const [field, value] of Object.entries(filter || {})) {
    if (!columns.has(field)) {
      throw httpError(400, `Cannot filter ${entity} by unknown field "${field}"`);
    }
    if (value === null) {
      clauses.push(`"${field}" IS NULL`);
    } else if (Array.isArray(value)) {
      values.push(value);
      clauses.push(`"${field}" = ANY($${values.length})`);
    } else {
      values.push(value);
      clauses.push(`"${field}" = $${values.length}`);
    }
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

// `context` is omitted for service-role access and supplied as { actor, query }
// when the caller must be restricted to the rows their policy allows.
async function find(entity, { filter, sort, limit, skip, fields, maxLimit } = {}, context) {
  const { table, columns } = await resolve(entity);
  const values = [];

  let sql = `SELECT ${buildSelection(fields, columns, entity)} FROM "${table}"`;
  let where = buildWhere(filter, columns, entity, values);

  if (context) {
    const { sql: predicate } = Rls.readPredicate(entity, {
      columns,
      actor: context.actor,
      query: context.query,
      values,
    });
    if (predicate !== 'TRUE') {
      where = where ? `${where} AND (${predicate})` : ` WHERE (${predicate})`;
    }
  }

  sql += where;
  sql += buildOrderBy(sort, columns, entity);

  values.push(clampLimit(limit, maxLimit));
  sql += ` LIMIT $${values.length}`;

  const offset = Number.parseInt(skip, 10);
  if (Number.isFinite(offset) && offset > 0) {
    values.push(offset);
    sql += ` OFFSET $${values.length}`;
  }

  const { rows } = await pool.query(sql, values);
  return rows.map((row) => sanitize(entity, row));
}

async function findById(entity, id) {
  const { table } = await resolve(entity);
  const { rows } = await pool.query(`SELECT * FROM "${table}" WHERE id = $1 LIMIT 1`, [id]);
  return sanitize(entity, rows[0]);
}

function writableFields(entity, payload, columns) {
  const protected_ = PROTECTED_FIELDS[entity];
  return Object.keys(payload || {}).filter(
    (field) =>
      columns.has(field) && !READONLY_FIELDS.has(field) && !(protected_ && protected_.has(field))
  );
}

// legacy platform stamped the creating user onto every row, and several policies read
// those columns back (`created_by: {{user.email}}`), so they are filled here
// when a caller is known and did not supply them.
function withCreatorStamp(payload, columns, actor) {
  if (!actor) return payload;
  const stamped = { ...payload };
  if (columns.has('created_by') && stamped.created_by === undefined) {
    stamped.created_by = actor.email;
  }
  if (columns.has('created_by_id') && stamped.created_by_id === undefined) {
    stamped.created_by_id = actor.id;
  }
  return stamped;
}

async function create(entity, payload) {
  const { table, columns } = await resolve(entity);
  const fields = writableFields(entity, payload, columns);

  const columnNames = ['id', ...fields];
  const values = [payload.id || generateId(), ...fields.map((f) => payload[f])];
  const placeholders = values.map((_, index) => `$${index + 1}`);

  for (const stamp of ['created_date', 'updated_date']) {
    if (columns.has(stamp) && !fields.includes(stamp)) {
      columnNames.push(stamp);
      placeholders.push('NOW()');
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO "${table}" (${columnNames.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return sanitize(entity, rows[0]);
}

async function update(entity, id, payload) {
  const { table, columns } = await resolve(entity);
  const fields = writableFields(entity, payload, columns);
  if (fields.length === 0) {
    throw httpError(400, `No writable fields supplied for ${entity}`);
  }

  const assignments = fields.map((field, index) => `"${field}" = $${index + 2}`);
  if (columns.has('updated_date')) assignments.push('"updated_date" = NOW()');

  const { rows } = await pool.query(
    `UPDATE "${table}" SET ${assignments.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...fields.map((field) => payload[field])]
  );
  if (rows.length === 0) throw httpError(404, `${entity} ${id} not found`);
  return sanitize(entity, rows[0]);
}

async function remove(entity, id) {
  const { table } = await resolve(entity);
  const { rowCount } = await pool.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
  if (rowCount === 0) throw httpError(404, `${entity} ${id} not found`);
  return true;
}

async function bulkCreate(entity, payloads) {
  if (!Array.isArray(payloads)) {
    throw httpError(400, 'bulkCreate expects an array');
  }
  const created = [];
  for (const payload of payloads) {
    created.push(await create(entity, payload));
  }
  return created;
}

async function bulkUpdate(entity, updates) {
  if (!Array.isArray(updates)) {
    throw httpError(400, 'bulkUpdate expects an array');
  }
  const updated = [];
  for (const item of updates) {
    const { id, ...rest } = item || {};
    if (!id) throw httpError(400, 'bulkUpdate entries require an id');
    updated.push(await update(entity, id, rest));
  }
  return updated;
}

// Every write first loads the row it targets with service-role access, so a
// caller cannot use the difference between 403 and 404 to discover whether a
// record they may not see exists.
async function authorizeWrite(entity, action, { id, payload, context }) {
  const { columns } = await resolve(entity);
  let row = payload;

  if (id !== undefined) {
    row = await findById(entity, id);
    if (!row) throw httpError(404, `${entity} ${id} not found`);
  }

  const allowed = Rls.canWrite(entity, action, {
    row,
    actor: context.actor,
    query: context.query,
  });
  if (!allowed) {
    throw httpError(403, `Not allowed to ${action} this ${entity}`);
  }
  return { columns, row };
}

/**
 * Entity access restricted to what `context.actor` is permitted to see and
 * change — the equivalent of `scoped entities`. The bare functions exported
 * alongside this are the service-role path, equivalent to
 * `serviceRole.entities`.
 */
function scoped(context) {
  if (!context || !context.actor) {
    throw httpError(500, 'scoped() requires an actor');
  }

  return {
    find: (entity, options) => find(entity, options, context),

    async findById(entity, id) {
      const [row] = await find(entity, { filter: { id }, limit: 1 }, context);
      return row || null;
    },

    async create(entity, payload) {
      const { columns } = await resolve(entity);
      const stamped = withCreatorStamp(payload || {}, columns, context.actor);
      await authorizeWrite(entity, 'create', { payload: stamped, context });
      return create(entity, stamped);
    },

    async update(entity, id, payload) {
      await authorizeWrite(entity, 'update', { id, context });
      return update(entity, id, payload);
    },

    async remove(entity, id) {
      await authorizeWrite(entity, 'delete', { id, context });
      return remove(entity, id);
    },

    async bulkCreate(entity, payloads) {
      if (!Array.isArray(payloads)) throw httpError(400, 'bulkCreate expects an array');
      const created = [];
      for (const payload of payloads) created.push(await this.create(entity, payload));
      return created;
    },

    async bulkUpdate(entity, updates) {
      if (!Array.isArray(updates)) throw httpError(400, 'bulkUpdate expects an array');
      const updated = [];
      for (const item of updates) {
        const { id, ...rest } = item || {};
        if (!id) throw httpError(400, 'bulkUpdate entries require an id');
        updated.push(await this.update(entity, id, rest));
      }
      return updated;
    },
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SERVICE_MAX_LIMIT,
  bulkCreate,
  bulkUpdate,
  create,
  find,
  findById,
  listEntities,
  remove,
  scoped,
  update,
};
