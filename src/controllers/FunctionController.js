const functions = require('../functions');
const { createContext } = require('../functions/context');

// Mirrors the previous SDK's functions.invoke: the client POSTs a JSON payload and
// receives the function's return value as the response body.
async function invoke(req, res) {
  const { name } = req.params;
  const fn = functions.get(name);

  if (!fn) {
    return res.status(501).json({
      error: `Server function "${name}" has not been ported to this backend yet`,
      ported: functions.names(),
    });
  }

  // Public functions run without a token; everything else needs req.actor, which
  // requireFunctionAuth has already established.
  try {
    const result = await fn.handler(createContext(req), req.body || {}, req);
    return res.json(result === undefined ? { success: true } : result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(`[functions] ${name} failed:`, err);
    }
    return res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err.message,
    });
  }
}

function list(req, res) {
  res.json({ ported: functions.names() });
}

module.exports = { invoke, list };
