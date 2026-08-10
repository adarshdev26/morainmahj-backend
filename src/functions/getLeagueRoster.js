// Port of functions/getLeagueRoster/entry.ts
//
// Returns the public roster (names + regular status only — no email/phone) for a
// league, gated so only admins, the league's organizer, or an existing active
// member of that league can view it. This keeps organization isolation while
// letting members see who else is in their league — something the LeagueMember
// read policy (own-record-only) cannot express.
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const league_id = body?.league_id;
  if (!league_id) throw httpError(400, 'league_id required');

  const service = ctx.asServiceRole.entities;

  const leagueRows = await service.League.filter({ id: league_id });
  const league = leagueRows[0];
  if (!league) throw httpError(404, 'League not found');

  const isAdmin = user.role === 'admin';
  const isOrgOrganizer =
    user.role === 'organizer_admin' &&
    league.organization_id === (user.data?.organization_id || '');

  // Non-admins must be an active (non-waitlisted) member of this league.
  if (!isAdmin && !isOrgOrganizer) {
    const myMemberships = await service.LeagueMember.filter({
      league_id,
      player_email: user.email,
    });
    const isMember = (myMemberships || []).some(
      (m) => m.active !== false && m.waitlist_position == null
    );
    if (!isMember) {
      throw httpError(403, 'Forbidden: you are not a member of this league');
    }
  }

  const members = await service.LeagueMember.filter({ league_id, active: true });

  const roster = (members || [])
    .filter((m) => m.waitlist_position == null)
    .map((m) => ({
      player_name: m.player_name,
      is_regular: !!m.is_regular,
    }));

  return { roster };
}

module.exports = { public: false, handler };
