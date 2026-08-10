// Enforces the row-level security policies exported from legacy platform.
//
// A policy is a small recursive expression built from four things:
//   {}                                  -> unrestricted (public)
//   { user_condition: { role: 'x' } }    -> a check on the caller, not on the row
//   { 'data.player_id': '{{user.id}}' }  -> a check on a column of the row
//   { $and: [...] } / { $or: [...] }     -> combinators
//
// Reads compile to a SQL predicate so the database filters rows. Writes are
// evaluated in JavaScript against the candidate row. Because `user_condition`
// does not depend on the row, it collapses to TRUE or FALSE at compile time and
// Postgres folds the surrounding expression away.
const POLICIES = require('../config/rls.json');

const ACTIONS = new Set(['create', 'read', 'update', 'delete']);

// legacy platform nested an entity's own fields under `data`; the export flattened them
// into real columns, so that prefix is dropped when resolving a field.
const DATA_PREFIX = /^data\./;

// The User entity carries no policy in the export — legacy platform governed it
// internally. Reads stay open to any authenticated caller, which matches the
// previous behaviour, while writes are handled by Entity's protected-field list
// and the dedicated /api/auth/me route.
const UNPOLICED = new Set(['User']);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function resolveTemplate(value, actor, query) {
  if (typeof value !== 'string') return value;
  const match = /^\{\{([^}]+)\}\}$/.exec(value.trim());
  if (!match) return value;

  switch (match[1].trim()) {
    case 'user.id':
      return actor?.id ?? null;
    case 'user.email':
      return actor?.email ?? null;
    case 'user.data.organization_id':
      return actor?.organization_id ?? null;
    case 'query.token':
      return query?.token ?? null;
    default:
      // An unrecognised placeholder must never widen access.
      throw httpError(500, `Unsupported policy placeholder "${match[1]}"`);
  }
}

function fieldToColumn(field) {
  return field.replace(DATA_PREFIX, '');
}

function isEmpty(node) {
  return !node || (typeof node === 'object' && Object.keys(node).length === 0);
}

/**
 * Reduces a policy against the caller before any SQL is built.
 *
 * Role tests and unresolvable placeholders do not depend on the row, so they
 * settle to a boolean here. Folding them away first matters for more than
 * tidiness: emitting SQL for a branch that is already decided would push bind
 * parameters the final statement never references, which Postgres rejects.
 *
 * @returns {true|false|object} true or false when the outcome is already
 *   decided, otherwise a node of row conditions still to be tested in SQL.
 */
function prune(node, { entity, columns, actor, query }) {
  if (isEmpty(node)) return true;

  const keys = Object.keys(node);
  // Several keys in one object is an implicit AND.
  if (keys.length > 1) {
    return prune({ $and: keys.map((key) => ({ [key]: node[key] })) }, { entity, columns, actor, query });
  }

  const [key] = keys;
  const value = node[key];

  if (key === '$and' || key === '$or') {
    if (!Array.isArray(value) || value.length === 0) return true;

    const isOr = key === '$or';
    const kept = [];
    for (const child of value) {
      const pruned = prune(child, { entity, columns, actor, query });
      // One satisfied branch settles an OR; one failed branch settles an AND.
      if (pruned === isOr) return isOr;
      if (pruned === !isOr) continue;
      kept.push(pruned);
    }
    if (kept.length === 0) return !isOr;
    if (kept.length === 1) return kept[0];
    return { op: isOr ? 'or' : 'and', children: kept };
  }

  if (key === 'user_condition') {
    const required = value?.role;
    if (required === undefined) {
      throw httpError(500, `Unsupported user_condition on ${entity}: ${JSON.stringify(value)}`);
    }
    return actor?.role === required;
  }

  const column = fieldToColumn(key);
  // A policy naming a column this table lacks fails closed.
  if (!columns.has(column)) return false;

  const resolved = resolveTemplate(value, actor, query);
  // An unresolvable placeholder — anonymous caller, missing token — must not
  // match every row, which is what `= NULL` would quietly do.
  if (resolved === null || resolved === undefined) return false;

  return { column, value: resolved };
}

/** Renders a pruned policy, pushing each bound value onto `values`. */
function toSql(pruned, values) {
  if (pruned === true) return 'TRUE';
  if (pruned === false) return 'FALSE';

  if (pruned.op) {
    const joiner = pruned.op === 'and' ? ' AND ' : ' OR ';
    return pruned.children.map((child) => `(${toSql(child, values)})`).join(joiner);
  }

  values.push(pruned.value);
  return `"${pruned.column}" = $${values.length}`;
}

function policyFor(entity, action) {
  if (!ACTIONS.has(action)) throw httpError(500, `Unknown policy action "${action}"`);
  if (UNPOLICED.has(entity)) return {};
  const entityPolicy = POLICIES[entity];
  // No policy at all means the entity was never exposed to clients; fail closed.
  if (!entityPolicy) return null;
  return entityPolicy[action] ?? null;
}

/**
 * Builds the SQL predicate restricting which rows `actor` may read.
 *
 * @returns {{ sql: string, values: unknown[] }} sql is 'TRUE' when unrestricted
 *   and 'FALSE' when the caller may see nothing.
 */
function readPredicate(entity, { columns, actor, query, values = [] } = {}) {
  const policy = policyFor(entity, 'read');
  // `values` is shared with the caller's own WHERE clause so placeholder
  // numbering stays continuous across the whole statement.
  if (policy === null) return { sql: 'FALSE', values };

  const sql = toSql(prune(policy, { entity, columns, actor, query }), values);
  return { sql, values };
}

/**
 * Evaluates a write policy against a concrete row, mirroring compile() but in
 * JavaScript because there is no query to attach a predicate to.
 */
function evaluate(node, { entity, row, actor, query }) {
  if (isEmpty(node)) return true;

  const keys = Object.keys(node);
  if (keys.length > 1) {
    return keys.every((key) => evaluate({ [key]: node[key] }, { entity, row, actor, query }));
  }

  const [key] = keys;
  const value = node[key];

  if (key === '$and') {
    return (value || []).every((child) => evaluate(child, { entity, row, actor, query }));
  }
  if (key === '$or') {
    if (!Array.isArray(value) || value.length === 0) return true;
    return value.some((child) => evaluate(child, { entity, row, actor, query }));
  }
  if (key === 'user_condition') {
    return actor?.role === value?.role;
  }

  const column = fieldToColumn(key);
  const resolved = resolveTemplate(value, actor, query);
  if (resolved === null || resolved === undefined) return false;

  const actual = row?.[column];
  if (actual === undefined || actual === null) return false;
  // Loose comparison keeps numeric ids and their string forms equivalent.
  return String(actual) === String(resolved);
}

function canWrite(entity, action, { row, actor, query } = {}) {
  const policy = policyFor(entity, action);
  if (policy === null) return false;
  return evaluate(policy, { entity, row, actor, query });
}

function isPoliced(entity) {
  return !UNPOLICED.has(entity) && Boolean(POLICIES[entity]);
}

module.exports = { canWrite, isPoliced, policyFor, readPredicate };
