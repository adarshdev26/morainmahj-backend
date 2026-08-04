const User = require('../models/User');

// The JWT carries only { id, email }, but the security policies also test the
// caller's role and organisation, so the current row is loaded per request.
// A disabled account is rejected here rather than in each route.
async function loadActor(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }
    if (user.disabled) {
      return res.status(403).json({ error: 'This account has been disabled' });
    }

    req.actor = {
      id: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id,
    };
    return next();
  } catch (err) {
    console.error('[actor] could not load the calling user:', err.message);
    return res.status(500).json({ error: 'Could not resolve the current user' });
  }
}

module.exports = { loadActor };
