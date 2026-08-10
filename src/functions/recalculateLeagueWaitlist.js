// Port of recovered base44/functions/recalculateLeagueWaitlist/entry.ts
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const payload = body || {};
  const isAutomation = !!payload?.event?.type;
  const session_id = payload.session_id || payload.data?.session_id;
  const league_id = payload.league_id || payload.data?.league_id;

  if (!session_id) throw httpError(400, 'session_id required');

  if (!isAutomation) {
    const user = await ctx.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Authentication required');
  }

  const service = ctx.asServiceRole.entities;
  const waitlisted = await service.LeagueRSVP.filter({ session_id, status: 'waitlist' });

  if (!waitlisted.length) {
    return { success: true, reordered: 0 };
  }

  const effectiveLeagueId = league_id || waitlisted[0]?.league_id;
  const members = effectiveLeagueId
    ? await service.LeagueMember.filter({ league_id: effectiveLeagueId, active: true })
    : [];

  const regularEmails = new Set(
    members.filter((m) => m.is_regular).map((m) => m.player_email?.toLowerCase()),
  );

  waitlisted.sort((a, b) => {
    const aRegular = regularEmails.has(a.player_email?.toLowerCase());
    const bRegular = regularEmails.has(b.player_email?.toLowerCase());
    if (aRegular && !bRegular) return -1;
    if (!aRegular && bRegular) return 1;
    const aTime = new Date(a.responded_at || a.created_date).getTime();
    const bTime = new Date(b.responded_at || b.created_date).getTime();
    return aTime - bTime;
  });

  await Promise.all(
    waitlisted.map((rsvp, index) =>
      service.LeagueRSVP.update(rsvp.id, { waitlist_position: index + 1 }),
    ),
  );

  return { success: true, reordered: waitlisted.length };
}

module.exports = { public: false, handler };
