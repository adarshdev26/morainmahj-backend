// Port of recovered base44/functions/submitMatchResult/entry.ts
const { httpError } = require('./errors');
const { sendOneSignalPush } = require('./helpers/onesignal');

async function notifyPlayers(externalIds, title, message, url) {
  return sendOneSignalPush({
    external_user_ids: externalIds,
    title,
    message,
    url,
  });
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const {
    tournament_id,
    round_number,
    table_number,
    winner_id,
    winning_hand_category,
    winning_hand_line,
    winning_hand_label,
    win_type,
    notes,
  } = body || {};

  if (!tournament_id || !winner_id || !win_type) {
    throw httpError(400, 'tournament_id, winner_id, and win_type are required');
  }

  const service = ctx.asServiceRole.entities;
  const tournament = await service.Tournament.get(tournament_id);
  if (!tournament) throw httpError(404, 'Tournament not found');

  const assignments = await service.TableAssignment.filter({
    tournament_id,
    round_number: Number(round_number),
    table_number: Number(table_number),
  });
  const assignment = assignments[0];

  if (tournament.approval_workflow_enabled !== false) {
    if (!assignment) throw httpError(404, 'Table assignment not found');
    if (assignment.player1_id !== user.id) {
      throw httpError(403, 'Only the East player can submit match results');
    }
    const existing = await service.MatchResult.filter({
      tournament_id,
      round_number: Number(round_number),
      table_number: Number(table_number),
    });
    if (existing[0]) {
      throw httpError(409, 'A match result has already been submitted for this table', {
        match_result_id: existing[0].id,
      });
    }
  }

  const regs = await service.Registration.filter({ tournament_id });
  const nameFor = (pid) => regs.find((x) => x.player_id === pid)?.player_name || '';
  const emailFor = (pid) => regs.find((x) => x.player_id === pid)?.player_email || '';

  const result = await service.MatchResult.create({
    organization_id: tournament.organization_id || '',
    tournament_id,
    tournament_name: tournament.name || '',
    round_number: Number(round_number),
    table_number: Number(table_number),
    table_assignment_id: assignment?.id || '',
    player1_id: assignment?.player1_id || user.id,
    player2_id: assignment?.player2_id || '',
    player3_id: assignment?.player3_id || '',
    player4_id: assignment?.player4_id || '',
    submitted_by_id: user.id,
    submitted_by_name: nameFor(user.id) || user.full_name || user.email,
    winner_id,
    winner_name: nameFor(winner_id) || '',
    winning_hand_category: winning_hand_category || '',
    winning_hand_line: winning_hand_line || '',
    winning_hand_label: winning_hand_label || '',
    win_type,
    status: 'pending_approval',
    approvals: [],
    disputes: [],
    submitted_at: new Date().toISOString(),
    notes: notes || '',
  });

  const otherIds = [
    assignment?.player1_id,
    assignment?.player2_id,
    assignment?.player3_id,
    assignment?.player4_id,
  ].filter((id) => id && id !== user.id);
  const otherEmails = otherIds.map((id) => emailFor(id)).filter(Boolean);
  await notifyPlayers(
    [...otherIds, ...otherEmails],
    'Match Result Submitted',
    `East submitted a result for Table ${table_number}, Round ${round_number}. Please review and approve.`,
    '/app/scores',
  );

  return { ok: true, match_result_id: result.id };
}

module.exports = { public: false, handler };
