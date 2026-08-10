// Port of recovered base44/functions/qrCheckIn/entry.ts
const { httpError } = require('./errors');
const { sendPush } = require('./helpers/push');

async function handler(ctx, body) {
  const { sessionId, leagueId, playerEmail, tournamentId } = body || {};

  if (!playerEmail) throw httpError(400, 'Missing playerEmail');
  if (!tournamentId && (!sessionId || !leagueId)) {
    throw httpError(
      400,
      'Missing event context: provide tournamentId, or sessionId + leagueId',
    );
  }

  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  if (user.role !== 'admin' && user.email.toLowerCase() !== playerEmail.toLowerCase()) {
    throw httpError(403, 'Forbidden: you can only check in with your own email');
  }

  const service = ctx.asServiceRole.entities;

  if (tournamentId) {
    const tournaments = await service.Tournament.filter({ id: tournamentId });
    if (!tournaments?.length) throw httpError(404, 'Tournament not found');

    const tournament = tournaments[0];
    if (tournament.status !== 'active') {
      throw httpError(400, 'Check-in is only available while the tournament is active');
    }

    const registrations = await service.Registration.filter({
      tournament_id: tournamentId,
      player_email: playerEmail,
    });
    if (!registrations?.length) throw httpError(404, 'Registration not found');

    const reg = registrations[0];
    if (reg.status !== 'confirmed') {
      throw httpError(400, 'Only confirmed registrations can check in');
    }

    const updatePayload = {
      checked_in: true,
      checked_in_at: new Date().toISOString(),
    };
    if (user.id && (!reg.player_id || reg.player_id !== user.id)) {
      updatePayload.player_id = user.id;
      if (!reg.player_name) {
        updatePayload.player_name = user.full_name || user.email;
      }
    }
    await service.Registration.update(reg.id, updatePayload);

    try {
      const playerId = updatePayload.player_id || reg.player_id;
      if (playerId) {
        const allAssignments = await service.TableAssignment.filter({
          tournament_id: tournamentId,
          round_number: 1,
        });

        const seatLabels = ['East', 'South', 'West', 'North'];
        let tableInfo = null;
        for (const a of allAssignments) {
          const seats = [a.player1_id, a.player2_id, a.player3_id, a.player4_id];
          const seatIdx = seats.indexOf(playerId);
          if (seatIdx !== -1) {
            tableInfo = { table: a.table_number, seat: seatLabels[seatIdx] };
            break;
          }
        }

        const tournamentName = tournament.name || 'Tournament';
        const tournamentDate = tournament.date
          ? new Date(tournament.date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
          : '';

        let notifBody = tableInfo
          ? `You're at Table ${tableInfo.table}, Seat ${tableInfo.seat}. Good luck today!`
          : `Welcome! Head to the director's table for your seating assignment.`;
        if (tournamentDate) notifBody = `${tournamentDate} · ${notifBody}`;

        await sendPush({
          external_user_ids: [playerId],
          title: `✓ Checked In — ${tournamentName}`,
          message: notifBody,
        });
      }
    } catch {
      // Notification failure must never block check-in success
    }

    return {
      success: true,
      type: 'tournament',
      playerName: reg.player_name,
      tournamentId,
      checkedInAt: new Date().toISOString(),
    };
  }

  if (leagueId) {
    const sessions = await service.LeagueSession.filter({
      id: sessionId,
      league_id: leagueId,
    });
    if (!sessions?.length) {
      throw httpError(403, 'Invalid session: session does not belong to this league');
    }

    const rsvps = await service.LeagueRSVP.filter({
      session_id: sessionId,
      league_id: leagueId,
      player_email: playerEmail,
    });
    if (!rsvps?.length) throw httpError(404, 'RSVP not found');

    const rsvp = rsvps[0];
    await service.LeagueRSVP.update(rsvp.id, {
      status: 'yes',
      responded_at: new Date().toISOString(),
    });

    return {
      success: true,
      type: 'league',
      playerName: rsvp.player_name,
      sessionId,
      leagueId,
      checkedInAt: new Date().toISOString(),
    };
  }

  throw httpError(400, 'Invalid request');
}

module.exports = { public: false, handler };
