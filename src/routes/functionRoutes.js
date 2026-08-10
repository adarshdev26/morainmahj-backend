const express = require('express');
const FunctionController = require('../controllers/FunctionController');
const functions = require('../functions');
const { authenticateToken } = require('../middleware/authMiddleware');
const { loadActor } = require('../middleware/actorMiddleware');

const router = express.Router();

// A handful of functions back public pages (big-screen leaderboards, published
// league websites) and were served unauthenticated by legacy platform too. Everything
// else requires a token before it runs.
function requireFunctionAuth(req, res, next) {
  const fn = functions.get(req.params.name);
  if (fn && fn.public) return next();
  return authenticateToken(req, res, (err) => (err ? next(err) : loadActor(req, res, next)));
}

router.get('/', FunctionController.list);
router.post('/:name', requireFunctionAuth, FunctionController.invoke);

module.exports = router;
