const express = require('express');
const { ACTIONS } = require('./actionRegistry');
const ActionController = require('../controllers/ActionController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { loadActor } = require('../middleware/actorMiddleware');
const functions = require('../functions');

/** Mount POST /api/actions/<kebab-name> for every registered action. */
function mountNamedActions(app) {
  const router = express.Router();

  router.get('/', ActionController.list);

  for (const action of ACTIONS) {
    const middlewares = [];
    if (!action.public) {
      middlewares.push(authenticateToken, loadActor);
    } else {
      // Public actions may still benefit from an optional actor when a token is sent.
      middlewares.push((req, res, next) => {
        const header = req.headers.authorization;
        if (!header) return next();
        return authenticateToken(req, res, (err) =>
          err ? next() : loadActor(req, res, next),
        );
      });
    }

    router.post(`/${action.path}`, ...middlewares, (req, res, next) => {
      req.actionName = action.name;
      // Prefer registry public flag; also honour handler.public if ported.
      const fn = functions.get(action.name);
      if (fn && fn.public && !req.user) {
        // already allowed through
      }
      return ActionController.invoke(req, res, next);
    });
  }

  app.use('/api/actions', router);

  const paths = ACTIONS.map((a) => a.path).sort();
  console.log(`⚡ Named REST actions mounted (${paths.length}): ${paths.slice(0, 8).join(', ')}…`);
}

module.exports = { mountNamedActions };
