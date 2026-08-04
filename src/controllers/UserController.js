const User = require('../models/User');

async function getAllUsers(req, res) {
  try {
    const users = await User.findAll({ limit: User.DEFAULT_LIMIT });
    return res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    console.error('[users] list failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getUserById(req, res) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    return res.json(user);
  } catch (err) {
    console.error('[users] fetch failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getAllUsers, getUserById };
