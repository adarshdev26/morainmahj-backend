const Auth = require('../models/Auth');

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  const separator = header.indexOf(' ');
  if (separator === -1) return null;
  const scheme = header.slice(0, separator);
  const value = header.slice(separator + 1).trim();
  if (scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

function authenticateToken(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: 'Missing or malformed Authorization header' });
  }

  if (!Auth.isSecretConfigured()) {
    return res.status(500).json({ success: false, error: 'Server auth is not configured' });
  }

  try {
    req.user = Auth.verifyToken(token);
    return next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      error: expired ? 'Token expired' : 'Invalid token',
      code: expired ? 'token_expired' : 'token_invalid',
    });
  }
}

/** Same verification as authenticateToken, but missing auth continues as anonymous. */
function optionalAuthenticateToken(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return next();

  if (!Auth.isSecretConfigured()) {
    return res.status(500).json({ success: false, error: 'Server auth is not configured' });
  }

  try {
    req.user = Auth.verifyToken(token);
    return next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      error: expired ? 'Token expired' : 'Invalid token',
      code: expired ? 'token_expired' : 'token_invalid',
    });
  }
}

module.exports = { authenticateToken, optionalAuthenticateToken, readBearerToken };
