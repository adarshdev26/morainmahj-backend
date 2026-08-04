const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const TOKEN_TTL = '7d';
const BCRYPT_ROUNDS = 12;

// Values written by bcrypt always carry one of these version prefixes. Anything
// else in the password column is treated as a plaintext dev seed.
const BCRYPT_PREFIX = /^\$2[aby]?\$/;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set — refusing to issue or verify tokens');
  }
  return secret;
}

function isSecretConfigured() {
  return Boolean(process.env.JWT_SECRET);
}

// payload is { id, email }; the same shape comes back out of verifyToken.
function generateToken({ id, email }) {
  return jwt.sign({ id: String(id), email }, getSecret(), { expiresIn: TOKEN_TTL });
}

// Throws on an invalid or expired token; callers turn that into a 401.
function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Hashed passwords go through bcrypt; a plaintext dev seed falls back to a
// constant-time comparison so seeding does not weaken real hashes.
async function comparePassword(plaintext, stored) {
  if (!stored) return false;
  if (BCRYPT_PREFIX.test(stored)) {
    return bcrypt.compare(plaintext, stored);
  }
  return timingSafeEqual(plaintext, stored);
}

module.exports = {
  TOKEN_TTL,
  comparePassword,
  generateToken,
  hashPassword,
  isSecretConfigured,
  verifyToken,
};
