// Port of base44/functions/logDataAccess/entry.ts
//
// Records an audit entry before sensitive data is returned. Writes through the
// policy-scoped view, as the original did, so the row is attributed to the caller.
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const {
    action,
    entity_type,
    entity_id,
    resource_type,
    status = 'success',
    reason_denied = null,
  } = body || {};

  await ctx.entities.AuditLog.create({
    user_id: user.id,
    user_email: user.email,
    action,
    entity_type,
    entity_id,
    resource_type,
    status,
    reason_denied,
    details: {
      timestamp: new Date().toISOString(),
    },
  });

  return { success: true };
}

module.exports = { public: false, handler };
