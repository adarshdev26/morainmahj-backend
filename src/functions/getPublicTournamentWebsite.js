// Port of recovered base44/functions/getPublicTournamentWebsite/entry.ts
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
  const tournaments = await service.Tournament.filter({ website_slug: slug });
  const tournament = tournaments[0];
  if (!tournament) throw httpError(404, 'Tournament not found');

  if (preview) {
    const user = await ctx.auth.me().catch(() => null);
    const isSuperAdmin = user?.role === 'admin';
    const isOrgOrganizer =
      user?.role === 'organizer_admin' && orgIdOf(user) === tournament.organization_id;
    if (!isSuperAdmin && !isOrgOrganizer) {
      throw httpError(403, 'Unauthorized to preview this website');
    }
  } else if (!tournament.website_enabled || tournament.website_status !== 'published') {
    throw httpError(404, 'This tournament website is not publicly available yet.');
  }

  let organization = null;
  if (tournament.organization_id) {
    const orgs = await service.Organization.filter({ id: tournament.organization_id });
    organization = orgs[0] || null;
  }

  const registrations = await service.Registration.filter({ tournament_id: tournament.id });
  const confirmedCount = registrations.filter((r) => r.status === 'confirmed').length;
  const waitlistedCount = registrations.filter((r) => r.status === 'waitlisted').length;

  let leaderboard = [];
  if (tournament.status === 'completed' || tournament.status === 'active') {
    const scoreCards = await service.ScoreCard.filter({ tournament_id: tournament.id });
    const tally = {};
    scoreCards.forEach((sc) => {
      const key = sc.player_email || sc.player_id;
      if (!key) return;
      const rawScores = sc.scores || [];
      const total = Array.isArray(rawScores)
        ? rawScores.reduce((sum, s) => sum + (typeof s === 'number' ? s : 0), 0)
        : 0;
      if (!tally[key]) tally[key] = { name: sc.player_name || 'Unknown', total: 0 };
      tally[key].total += total;
    });
    leaderboard = Object.values(tally)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }

  return {
    tournament,
    organization,
    confirmedCount,
    waitlistedCount,
    leaderboard,
  };
}

module.exports = { public: true, handler };
