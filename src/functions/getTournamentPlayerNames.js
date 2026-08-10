// Port of functions/getTournamentPlayerNames/entry.ts
//
// Returns the confirmed player directory for a tournament (id + name + email).
// Uses service role because the Registration policy only exposes the current
// user's row to players, but seated players need their tablemates' names for
// scorecards and seating.
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const tournament_id = body?.tournament_id;
  if (!tournament_id) throw httpError(400, 'tournament_id required');

  const service = ctx.asServiceRole.entities;

  const tournaments = await service.Tournament.filter({ id: tournament_id });
  if (!tournaments?.length) throw httpError(404, 'Tournament not found');

  const allRegs = await service.Registration.filter({
    tournament_id,
    status: 'confirmed',
  });

  const isRegistered = allRegs.some(
    (r) => r.player_id === user.id || r.player_email?.toLowerCase() === user.email?.toLowerCase()
  );
  if (!isRegistered && user.role !== 'admin') {
    throw httpError(403, 'Forbidden: not registered for this tournament');
  }

  const players = allRegs
    .filter((r) => r.player_id)
    .map((r) => ({
      player_id: r.player_id,
      player_name: r.player_name || r.player_email || 'Player',
      player_email: r.player_email,
    }));

  return { players };
}

module.exports = { public: false, handler };
