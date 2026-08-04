// Sets a bcrypt-hashed password for an existing user.
// Usage: npm run set-password -- someone@example.com 'their-password'
require('dotenv').config();
const pool = require('../db');
const Auth = require('../src/models/Auth');
const User = require('../src/models/User');

const MIN_LENGTH = 8;

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    throw new Error('Usage: npm run set-password -- <email> <password>');
  }
  if (password.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters`);
  }

  const hash = await Auth.hashPassword(password);
  const user = await User.updatePasswordByEmail(email, hash);

  if (!user) {
    throw new Error(`No user found with email ${email}`);
  }

  console.log(`Password set for ${user.email} (${user.full_name || 'no name'}, id ${user.id})`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    if (err.code === '42703') {
      console.error('The "password" column does not exist yet. Run: npm run migrate');
    } else {
      console.error(err.message);
    }
    await pool.end();
    process.exit(1);
  });
