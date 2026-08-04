const crypto = require('crypto');
const pool = require('../../db');

const TABLE = '"User"';
const DEFAULT_LIMIT = 50;

// Never leaves the server. SELECT * is used so the API keeps returning every
// column the Base44 export carries, so anything secret has to be stripped here.
const SENSITIVE_FIELDS = ['password'];

// Columns a client is allowed to write through update(). Anything else in the
// payload is ignored rather than interpolated into SQL.
const WRITABLE_FIELDS = [
  'email',
  'full_name',
  'password',
  'role',
  'organization_id',
  'phone',
  'city_state',
  'photo_url',
  'profile_complete',
  'disabled',
  'disabled_reason',
  'is_verified',
  'force_password_reset',
  'opt_in_text_messaging',
  'profile_emoji',
  'age_range',
  'gender',
];

function sanitize(row) {
  if (!row) return null;
  const safe = { ...row };
  for (const field of SENSITIVE_FIELDS) delete safe[field];
  return safe;
}

// The export uses 24-character hex ids rather than uuids, so new rows match.
function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

// Includes the password hash, so this is only for authenticating a login and its
// result must never be sent to a client unsanitised.
async function findByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, full_name, role, organization_id, disabled, password
       FROM ${TABLE}
      WHERE lower(email) = lower($1)
      LIMIT 1`,
    [String(email).trim()]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [id]);
  return sanitize(result.rows[0]);
}

async function findAll({ limit = DEFAULT_LIMIT } = {}) {
  const result = await pool.query(`SELECT * FROM ${TABLE} LIMIT $1`, [limit]);
  return result.rows.map(sanitize);
}

// userData.password must already be hashed — see Auth.hashPassword.
async function create(userData) {
  const fields = WRITABLE_FIELDS.filter((field) => userData[field] !== undefined);
  if (fields.length === 0) {
    throw new Error('create() requires at least one writable field');
  }

  const columns = ['id', ...fields, 'created_date', 'updated_date'];
  const values = [userData.id || generateId(), ...fields.map((field) => userData[field])];
  const placeholders = values.map((_, index) => `$${index + 1}`);

  const result = await pool.query(
    `INSERT INTO ${TABLE} (${columns.map((c) => `"${c}"`).join(', ')})
     VALUES (${[...placeholders, 'NOW()', 'NOW()'].join(', ')})
     RETURNING *`,
    values
  );
  return sanitize(result.rows[0]);
}

async function update(id, userData) {
  const fields = WRITABLE_FIELDS.filter((field) => userData[field] !== undefined);
  if (fields.length === 0) {
    throw new Error('update() requires at least one writable field');
  }

  const assignments = fields.map((field, index) => `"${field}" = $${index + 2}`);
  const result = await pool.query(
    `UPDATE ${TABLE}
        SET ${[...assignments, '"updated_date" = NOW()'].join(', ')}
      WHERE id = $1
      RETURNING *`,
    [id, ...fields.map((field) => userData[field])]
  );
  return sanitize(result.rows[0]);
}

async function updatePasswordByEmail(email, hashedPassword) {
  const result = await pool.query(
    `UPDATE ${TABLE}
        SET password = $2, updated_date = NOW()
      WHERE lower(email) = lower($1)
      RETURNING id, email, full_name`,
    [String(email).trim(), hashedPassword]
  );
  return result.rows[0] || null;
}

module.exports = {
  DEFAULT_LIMIT,
  create,
  findAll,
  findByEmail,
  findById,
  sanitize,
  update,
  updatePasswordByEmail,
};
