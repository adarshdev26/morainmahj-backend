// Port of recovered base44/functions/getPublicLeagueWebsite/entry.ts
const { httpError } = require('./errors');

function orgIdOf(user) {
  return user?.data?.organization_id || user?.organization_id || '';
}

async function handler(ctx, body, req) {
  const slug = body?.slug || req?.query?.slug;
  const preview =
    body?.preview === true ||
    body?.preview === 'true' ||
    req?.query?.preview === 'true';

  if (!slug) throw httpError(400, 'Slug is required');

  const service = ctx.asServiceRole.entities;
  const leagues = await service.League.filter({ website_slug: slug });
  const league = leagues[0];
  if (!league) throw httpError(404, 'League not found');

  if (preview) {
    const user = await ctx.auth.me().catch(() => null);
    const isSuperAdmin = user?.role === 'admin';
    const isOrgOrganizer =
      user?.role === 'organizer_admin' && orgIdOf(user) === league.organization_id;
    if (!isSuperAdmin && !isOrgOrganizer) {
      throw httpError(403, 'Unauthorized to preview this website');
    }
  } else if (!league.website_enabled || league.website_status !== 'published') {
    throw httpError(404, 'This league website is not publicly available yet.');
  }

  let organization = null;
  if (league.organization_id) {
    const orgs = await service.Organization.filter({ id: league.organization_id });
    organization = orgs[0] || null;
  }

  const sessions = await service.LeagueSession.filter({ league_id: league.id });
  const sortedSessions = sessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const completedSessions = sortedSessions.filter((s) => s.status === 'completed');
  const sessionIds = completedSessions.map((s) => s.id);

  let leaderboard = [];
  let leaderboardMode = 'attendance';

  if (league.scoring_enabled) {
    leaderboardMode = 'points';
    const scoreCards = await service.LeagueScoreCard.filter({ league_id: league.id });
    const SEATS = ['east', 'south', 'west', 'north'];
    const tally = {};
    scoreCards.forEach((sc) => {
      SEATS.forEach((seat) => {
        const email = sc[`${seat}_player_email`];
        const name = sc[`${seat}_player_name`];
        const score = sc[`${seat}_score`];
        if (!email) return;
        if (!tally[email]) tally[email] = { name: name || 'Unknown', points: 0, tables: 0 };
        if (score != null) {
          tally[email].points += score;
          tally[email].tables += 1;
        }
      });
    });
    leaderboard = Object.values(tally)
      .sort((a, b) => b.points - a.points || b.tables - a.tables)
      .slice(0, 25);
  } else if (sessionIds.length > 0) {
    const rsvpResults = await Promise.all(
      sessionIds.map((sid) => service.LeagueRSVP.filter({ session_id: sid, status: 'yes' })),
    );
    const allRsvps = rsvpResults.flat();
    const tally = {};
    allRsvps.forEach((r) => {
      const key = r.player_email;
      if (!tally[key]) tally[key] = { name: r.player_name || 'Unknown', sessions: 0 };
      tally[key].sessions += 1;
    });
    leaderboard = Object.values(tally)
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10);
  }

  const members = await service.LeagueMember.filter({ league_id: league.id, active: true });

  return {
    league,
    organization,
    sessions: sortedSessions,
    leaderboard,
    leaderboardMode,
    memberCount: members.length,
  };
}

module.exports = { public: true, handler };
