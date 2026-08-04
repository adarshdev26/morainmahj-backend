// Applies every .sql file in migrations/ in filename order.
// Usage: npm run migrate
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const pool = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migrations found.');
    return;
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await pool.query(sql);
    console.log('done');
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(`\nMigration failed: ${err.message}`);
    await pool.end();
    process.exit(1);
  });
