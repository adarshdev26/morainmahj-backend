const Auth = require('../models/Auth');
const User = require('../models/User');

const UNDEFINED_COLUMN = '42703';
const MIGRATION_HINT =
  'The User table has no "password" column. Run migrations/001_add_user_password.sql, ' +
  'then set a password with: npm run set-password -- <email> <password>';

// The export stores the display name in full_name; the API surfaces it as `name`
// so clients do not need to know that.
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.full_name,
    role: user.role,
    organization_id: user.organization_id,
  };
}

async function login(req, res) {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  try {
    const user = await User.findByEmail(email);

    // Same response whether the email is unknown or the password is wrong, so
    // the endpoint cannot be used to enumerate accounts.
    const passwordOk = user ? await Auth.comparePassword(password, user.password) : false;
    if (!user || !passwordOk) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    if (user.disabled) {
      return res.status(403).json({ success: false, error: 'This account has been disabled' });
    }

    const token = Auth.generateToken({ id: user.id, email: user.email });
    return res.json({ success: true, token, user: toPublicUser(user) });
  } catch (err) {
    if (err.code === UNDEFINED_COLUMN) {
      console.error('[auth] login failed — password column missing:', err.message);
      return res.status(500).json({ success: false, error: MIGRATION_HINT });
    }
    console.error('[auth] login failed:', err);
    return res.status(500).json({ success: false, error: 'Login failed, please try again' });
  }
}

// Reached only through authenticateToken, so req.user is already a verified payload.
async function getMe(req, res) {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(401).json({ success: false, error: 'User no longer exists' });
    }
    if (user.disabled) {
      return res.status(403).json({ success: false, error: 'This account has been disabled' });
    }

    return res.json({ success: true, user: { ...user, name: user.full_name } });
  } catch (err) {
    console.error('[auth] me failed:', err);
    return res.status(500).json({ success: false, error: 'Could not load current user' });
  }
}

// Deliberately excludes role, disabled and password: a user editing their own
// profile must not be able to promote themselves or change their credentials here.
const SELF_EDITABLE_FIELDS = [
  'full_name',
  'phone',
  'city_state',
  'photo_url',
  'profile_complete',
  'opt_in_text_messaging',
  'profile_emoji',
  'age_range',
  'gender',
];

async function updateMe(req, res) {
  const body = req.body || {};
  const payload = {};
  for (const field of SELF_EDITABLE_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }
  // Clients send the display name as `name`; the column is full_name.
  if (body.name !== undefined && payload.full_name === undefined) {
    payload.full_name = body.name;
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ success: false, error: 'No editable profile fields supplied' });
  }

  try {
    const user = await User.update(req.user.id, payload);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User no longer exists' });
    }
    return res.json({ success: true, user: { ...user, name: user.full_name } });
  } catch (err) {
    console.error('[auth] updateMe failed:', err);
    return res.status(500).json({ success: false, error: 'Could not update profile' });
  }
}

// Tokens are stateless and not tracked server-side, so there is nothing to
// revoke here; the client discards its copy.
function logout(req, res) {
  return res.json({ success: true, message: 'Logged out' });
}

module.exports = { getMe, login, logout, toPublicUser, updateMe };
