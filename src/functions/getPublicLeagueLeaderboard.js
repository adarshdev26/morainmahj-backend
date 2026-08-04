// Port of base44/functions/getPublicLeagueLeaderboard/entry.ts
//
// Public (unauthenticated) league leaderboard by website_slug. Returns season
// standings (with special-hand points), current-session standings, league info,
// member count, and a server-side last-updated timestamp. Gated on the website
// being published OR the leaderboard being explicitly enabled.
const { httpError } = require('./errors');

const SEATS = ['east', 'south', 'west', 'north'];

function isCompleted(session) {
  return session.status === 'completed' || session.finalized_at;
}

// Sums the four seats of each scorecard into a per-player tally.
function tallyScoreCards(cards, tally) {
  for (const card of cards) {
    for (const seat of SEATS) {
      const email = card[`${seat}_player_email`];
      const name = card[`${seat}_player_name`];
      const score = card[`${seat}_score`];
      if (!email) continue;
      if (!tally[email]) tally[email] = { name: name || 'Unknown', email, points: 0, tables: 0 };
      if (score != null) {
        tally[email].points += Number(score);
        tally[email].tables += 1;
      }
    }
  }
  return tally;
}

async function handler(ctx, body, req) {
  const slug = body?.slug || req?.query?.slug;
  if (!slug) throw httpError(400, 'slug required');

  const service = ctx.asServiceRole.entities;

  const leagues = await service.League.filter({ website_slug: slug });
  const league = leagues[0];
  if (!league) throw httpError(404, 'League not found');

  const isPublic =
    (league.website_enabled && league.website_status === 'published') || league.leaderboard_enabled;
  if (!isPublic) throw httpError(404, 'Leaderboard not available');

  const scoring = !!league.scoring_enabled;
  const [sessions, scoreCards, specialHandLogs, members] = await Promise.all([
    service.LeagueSession.filter({ league_id: league.id }),
    scoring ? service.LeagueScoreCard.filter({ league_id: league.id }) : Promise.resolve([]),
    scoring
      ? service.HandLog.filter({ league_id: league.id, hand_status: 'Won' })
      : Promise.resolve([]),
    service.LeagueMember.filter({ league_id: league.id, active: true }),
  ]);

  const sortedSessions = [...sessions].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  let seasonStandings = [];
  let mode = 'attendance';

  if (scoring) {
    mode = 'points';
    // Only finalized sessions count towards the season standings.
    const completedSessionIds = new Set(sortedSessions.filter(isCompleted).map((s) => s.id));
    const tally = tallyScoreCards(
      scoreCards.filter((sc) => completedSessionIds.has(sc.session_id)),
      {}
    );

    // Special-hand points, positive or negative, add to the season totals.
    for (const log of specialHandLogs) {
      if (!log.special_hand_id) continue;
      if (log.session_id && !completedSessionIds.has(log.session_id)) continue;
      const email = log.player_email;
      if (!email) continue;
      if (!tally[email]) {
        tally[email] = { name: log.player_name || email, email, points: 0, tables: 0 };
      }
      tally[email].points += Number(log.points || 0);
    }

    seasonStandings = Object.values(tally).sort(
      (a, b) => b.points - a.points || b.tables - a.tables
    );
  } else {
    const completedIds = sortedSessions.filter(isCompleted).map((s) => s.id);
    const rsvpResults = await Promise.all(
      completedIds.map((sid) => service.LeagueRSVP.filter({ session_id: sid, status: 'yes' }))
    );
    const tally = {};
    for (const r of rsvpResults.flat()) {
      if (!tally[r.player_email]) {
        tally[r.player_email] = { name: r.player_name || 'Unknown', email: r.player_email, sessions: 0 };
      }
      tally[r.player_email].sessions += 1;
    }
    seasonStandings = Object.values(tally).sort((a, b) => b.sessions - a.sessions);
  }

  // Current session is the active one, otherwise the nearest upcoming.
  let currentSession = null;
  let currentStandings = [];
  const active =
    sortedSessions.find((s) => s.status === 'active') ||
    sortedSessions.find((s) => s.status === 'upcoming');

  if (active) {
    currentSession = {
      id: active.id,
      date: active.date,
      start_time: active.start_time,
      status: active.status,
      location: active.location,
    };
    if (scoring) {
      const tally = tallyScoreCards(
        scoreCards.filter((c) => c.session_id === active.id),
        {}
      );
      currentStandings = Object.values(tally).sort((a, b) => b.points - a.points);
    }
  }

  return {
    league: {
      name: league.name,
      location: league.location,
      description: league.website_description || league.description,
      scoring_enabled: scoring,
      website_primary_color: league.website_primary_color,
    },
    mode,
    seasonStandings,
    currentSession,
    currentStandings,
    memberCount: members.length,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = { public: true, handler };
