// Port of recovered base44/functions/generateShareToken/entry.ts
const crypto = require('crypto');
const { httpError } = require('./errors');

function generateToken(length = 16) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  const array = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { context_type, context_id } = body || {};
  if (!context_type || !context_id) {
    throw httpError(400, 'context_type and context_id are required');
  }

  let entity;
  let contextName;
  let sharingAllowed;

  // Original used scoped entities for event lookup + ShareInvite create.
  if (context_type === 'tournament') {
    const items = await ctx.entities.Tournament.filter({ id: context_id });
    entity = items[0];
    contextName = entity?.name;
    sharingAllowed = entity?.player_sharing_enabled !== false;
  } else if (context_type === 'league') {
    const items = await ctx.entities.League.filter({ id: context_id });
    entity = items[0];
    contextName = entity?.name;
    sharingAllowed = entity?.player_sharing_enabled !== false;
  } else if (context_type === 'course') {
    const items = await ctx.entities.Course.filter({ id: context_id });
    entity = items[0];
    contextName = entity?.name;
    sharingAllowed = entity?.player_sharing_enabled !== false;
  } else {
    throw httpError(400, 'Invalid context_type');
  }

  if (!entity) throw httpError(404, 'Event not found');
  if (!sharingAllowed) {
    throw httpError(403, 'Player sharing is not enabled for this event');
  }

  const existing = await ctx.entities.ShareInvite.filter({
    context_type,
    context_id,
    shared_by_id: user.id,
    active: true,
  });

  if (existing.length > 0) {
    return { token: existing[0].token, share_invite_id: existing[0].id };
  }

  const token = generateToken(16);
  const invite = await ctx.entities.ShareInvite.create({
    token,
    context_type,
    context_id,
    context_name: contextName,
    shared_by_id: user.id,
    shared_by_name: user.full_name,
    shared_by_email: user.email,
    times_used: 0,
    active: true,
  });

  return { token, share_invite_id: invite.id };
}

module.exports = { public: false, handler };
