const functions = require('../functions');
const { createContext } = require('../functions/context');

/**
 * Invoke a named action. Ported handlers run; others return 501 with the
 * action name so clients fail clearly until the handler is ported.
 */
async function invoke(req, res) {
  const { actionName } = req;
  if (!actionName) {
    return res.status(500).json({ error: 'Action name missing on request' });
  }

  const fn = functions.get(actionName);
  if (!fn) {
    return res.status(501).json({
      error: `Action "${actionName}" has not been ported to this backend yet`,
      action: actionName,
      ported: functions.names(),
    });
  }

  try {
    const result = await fn.handler(createContext(req), req.body || {}, req);
    return res.json(result === undefined ? { success: true } : result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(`[actions] ${actionName} failed:`, err);
    }
    return res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err.message,
      action: actionName,
      ...(err.body && typeof err.body === 'object' ? err.body : {}),
    });
  }
}

function list(req, res) {
  const { ACTIONS } = require('../routes/actionRegistry');
  res.json({
    actions: ACTIONS.map(({ name, path, public: isPublic }) => ({
      name,
      path: `/api/actions/${path}`,
      public: isPublic,
      ported: functions.has(name),
    })),
    ported: functions.names(),
  });
}

module.exports = { invoke, list };
