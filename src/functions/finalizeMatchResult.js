// Port of recovered base44/functions/finalizeMatchResult/entry.ts
const { httpError } = require('./errors');

function orgId(user) {
  return user.data?.organization_id || user.organization_id || '';
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { match_result_id, notes } = body || {};
  if (!match_result_id) throw httpError(400, 'match_result_id is required');

  const service = ctx.asServiceRole.entities;
  const result = await service.MatchResult.get(match_result_id);
  if (!result) throw httpError(404, 'Match result not found');

  const isAdmin = user.role === 'admin';
  const isOrganizer = user.role === 'organizer_admin';
  if (!isAdmin && !isOrganizer) {
    throw httpError(403, 'Only organizers or admins can finalize results');
  }

  let tournament = null;
  try {
    tournament = await service.Tournament.get(result.tournament_id);
  } catch {
    tournament = null;
  }
  if (!tournament) throw httpError(404, 'Tournament not found');

  if (isOrganizer && tournament.organization_id && tournament.organization_id !== orgId(user)) {
    throw httpError(403, 'Forbidden: tournament belongs to another organization');
  }
  if (isOrganizer && tournament.trusted_organizer_enabled !== true) {
    throw httpError(403, 'Trusted organizer finalization is not enabled for this tournament');
  }

  await service.MatchResult.update(match_result_id, {
    status: 'finalized',
    finalized_at: new Date().toISOString(),
    finalized_by_id: user.id,
    finalized_by_name: user.full_name || user.email,
    auto_finalized: false,
    notes: notes || result.notes || '',
  });

  return { ok: true, status: 'finalized' };
}

module.exports = { public: false, handler };
