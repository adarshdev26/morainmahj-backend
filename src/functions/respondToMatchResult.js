// Port of recovered base44/functions/respondToMatchResult/entry.ts
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { match_result_id, action, reason } = body || {};
  if (!match_result_id || !action) {
    throw httpError(400, 'match_result_id and action are required');
  }
  if (action !== 'approve' && action !== 'dispute') {
    throw httpError(400, 'action must be approve or dispute');
  }

  const service = ctx.asServiceRole.entities;
  const result = await service.MatchResult.get(match_result_id);
  if (!result) throw httpError(404, 'Match result not found');

  const playerIds = [result.player1_id, result.player2_id, result.player3_id, result.player4_id].filter(
    Boolean,
  );
  if (!playerIds.includes(user.id)) {
    throw httpError(403, 'You are not a participant at this table');
  }
  if (result.status !== 'pending_approval') {
    throw httpError(409, 'This match result is no longer pending approval');
  }

  const regs = await service.Registration.filter({ tournament_id: result.tournament_id });
  const nameFor = (pid) => regs.find((r) => r.player_id === pid)?.player_name || '';

  if (action === 'dispute') {
    const disputes = Array.isArray(result.disputes) ? [...result.disputes] : [];
    if (!disputes.some((d) => d.player_id === user.id)) {
      disputes.push({
        player_id: user.id,
        player_name: nameFor(user.id) || user.full_name || user.email,
        reason: reason || '',
        reported_at: new Date().toISOString(),
      });
    }
    await service.MatchResult.update(match_result_id, { status: 'disputed', disputes });
    return { ok: true, status: 'disputed' };
  }

  const approvals = Array.isArray(result.approvals) ? [...result.approvals] : [];
  if (!approvals.some((ap) => ap.player_id === user.id)) {
    approvals.push({
      player_id: user.id,
      player_name: nameFor(user.id) || user.full_name || user.email,
      approved_at: new Date().toISOString(),
    });
  }

  const nonEast = playerIds.filter((id) => id !== result.submitted_by_id);
  const approvedIds = approvals.map((ap) => ap.player_id);
  const allApproved = nonEast.length > 0 && nonEast.every((id) => approvedIds.includes(id));

  if (allApproved) {
    await service.MatchResult.update(match_result_id, {
      approvals,
      status: 'approved',
      approved_at: new Date().toISOString(),
    });
    return { ok: true, status: 'approved' };
  }

  await service.MatchResult.update(match_result_id, { approvals });
  return { ok: true, status: 'pending_approval', approvals_count: approvals.length };
}

module.exports = { public: false, handler };
