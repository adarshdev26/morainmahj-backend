const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { loadActor } = require('../middleware/actorMiddleware');

const router = express.Router();

router.post('/invite', authenticateToken, loadActor, (req, res) => {
  res.status(501).json({
    error: 'User invitations have not been ported to this backend yet',
    feature: 'inviteUser',
  });
});

module.exports = router;
