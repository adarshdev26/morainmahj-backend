// Port of recovered base44/functions/createLeagueWalkIn/entry.ts
const { httpError } = require('./errors');

function orgIdOf(user) {
  return user.data?.organization_id || user.organization_id || '';
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');
  if (user.role !== 'admin' && user.role !== 'organizer_admin') {
    throw httpError(403, 'Forbidden');
  }

  const { session_id, league_id, player_name, player_email, player_phone } = body || {};
  if (!session_id || !league_id || !player_name || !player_email) {
    throw httpError(400, 'session_id, league_id, player_name, player_email required');
  }

  const service = ctx.asServiceRole.entities;
  const leagues = await service.League.filter({ id: league_id });
  const league = leagues[0];
  if (!league) throw httpError(404, 'League not found');

  if (
    user.role === 'organizer_admin' &&
    league.organization_id &&
    league.organization_id !== orgIdOf(user)
  ) {
    throw httpError(403, 'Forbidden');
  }

  const orgId = league.organization_id || '';
  const existing = await service.LeagueRSVP.filter({ session_id, player_email });
  if (existing[0]) {
    const r = existing[0];
    if (r.status === 'yes') {
      throw httpError(409, "Player already RSVP'd yes for this session", { rsvp: r });
    }
    const now = new Date().toISOString();
    await service.LeagueRSVP.update(r.id, {
      status: 'yes',
      checked_in: true,
      checked_in_at: now,
      waitlist_position: null,
      responded_at: now,
    });
    return { success: true, reactivated: true, rsvp: { ...r, status: 'yes', checked_in: true } };
  }

  let playerId = '';
  try {
    const users = await service.User.filter({ email: player_email });
    playerId = users[0]?.id || '';
  } catch {
    /* best effort */
  }

  const now = new Date().toISOString();
  const rsvp = await service.LeagueRSVP.create({
    organization_id: orgId,
    session_id,
    league_id,
    player_email,
    player_name,
    player_phone: player_phone || '',
    player_id: playerId,
    status: 'yes',
    checked_in: true,
    checked_in_at: now,
    responded_at: now,
  });

  let member = null;
  if (league.payment_model === 'paid' && league.membership_fee) {
    const existingMembers = await service.LeagueMember.filter({ league_id, player_email });
    if (!existingMembers[0]) {
      member = await service.LeagueMember.create({
        organization_id: orgId,
        league_id,
        player_email,
        player_name,
        player_phone: player_phone || '',
        player_id: playerId,
        active: false,
        is_substitute: true,
        payment_status: 'pending',
        payment_amount: league.membership_fee,
      });
    } else {
      member = existingMembers[0];
    }
  }

  return { success: true, rsvp, member };
}

module.exports = { public: false, handler };
