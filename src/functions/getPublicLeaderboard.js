// Port of base44/functions/getPublicLeaderboard/entry.ts
//
// Returns tournament info, scorecards, and a player_id -> name map for public
// (unauthenticated) leaderboard display on big screens.
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const tournament_id = body?.tournament_id;
  if (!tournament_id) throw httpError(400, 'tournament_id required');

  const service = ctx.asServiceRole.entities;

  const tournaments = await service.Tournament.filter({ id: tournament_id });
  const tournament = tournaments?.[0];
  if (!tournament) throw httpError(404, 'Tournament not found');

  const [scorecards, registrations] = await Promise.all([
    service.ScoreCard.filter({ tournament_id }),
    service.Registration.filter({ tournament_id, status: 'confirmed' }),
  ]);

  const nameMap = {};
  for (const r of registrations) {
    if (r.player_id) {
      nameMap[r.player_id] = r.player_name || r.player_email || 'Player';
    }
  }

  return { tournament, scorecards, nameMap };
}

module.exports = { public: true, handler };
