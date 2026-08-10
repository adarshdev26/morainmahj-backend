// Port of functions/getPlayerRepository/entry.ts
//
// Builds the admin player directory: every player enriched with the tournaments,
// leagues and courses they have taken part in. An organizer_admin is confined to
// their own organisation regardless of what they ask for.
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');
  if (user.role !== 'admin' && user.role !== 'organizer_admin') {
    throw httpError(403, 'Forbidden');
  }

  let organizationId = body?.organization_id;
  if (user.role === 'organizer_admin') {
    organizationId = (user.data && user.data.organization_id) || organizationId;
  }
  const scope = organizationId ? { organization_id: organizationId } : {};

  const service = ctx.asServiceRole.entities;
  const [players, registrations, leagueMembers, courseEnrollments, tournaments, leagues, courses] =
    await Promise.all([
      service.Player.filter(scope, '-created_date', 3000),
      service.Registration.filter(scope, '-created_date', 8000),
      service.LeagueMember.filter(scope, '-created_date', 8000),
      service.CourseEnrollment.filter(scope, '-created_date', 8000),
      service.Tournament.filter(scope, '-created_date', 1000),
      service.League.filter(scope, '-created_date', 1000),
      service.Course.filter(scope, '-created_date', 1000),
    ]);

  const tournName = Object.fromEntries(tournaments.map((t) => [t.id, t.name]));
  const leagueName = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
  const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));

  const partMap = {};
  const ensure = (email) => {
    const e = (email || '').toLowerCase().trim();
    if (!e) return null;
    if (!partMap[e]) {
      partMap[e] = {
        tournaments: new Map(),
        leagues: new Map(),
        courses: new Map(),
        lastActive: null,
      };
    }
    return e;
  };
  const touch = (e, d) => {
    if (d && (!partMap[e].lastActive || d > partMap[e].lastActive)) partMap[e].lastActive = d;
  };

  for (const r of registrations) {
    const e = ensure(r.player_email);
    if (!e || !r.tournament_id) continue;
    partMap[e].tournaments.set(r.tournament_id, {
      id: r.tournament_id,
      name: tournName[r.tournament_id] || 'Tournament',
    });
    touch(e, r.created_date || r.confirmed_at);
  }
  for (const m of leagueMembers) {
    const e = ensure(m.player_email);
    if (!e || !m.league_id) continue;
    partMap[e].leagues.set(m.league_id, {
      id: m.league_id,
      name: leagueName[m.league_id] || 'League',
    });
    touch(e, m.created_date);
  }
  for (const en of courseEnrollments) {
    const e = ensure(en.player_email);
    if (!e || !en.course_id) continue;
    partMap[e].courses.set(en.course_id, {
      id: en.course_id,
      name: courseName[en.course_id] || 'Course',
    });
    touch(e, en.created_date || en.enrolled_at);
  }

  const enriched = players.map((p) => {
    const e = (p.email || '').toLowerCase().trim();
    const part = partMap[e];
    const playerTournaments = part ? [...part.tournaments.values()] : [];
    const playerLeagues = part ? [...part.leagues.values()] : [];
    const playerCourses = part ? [...part.courses.values()] : [];
    const structured = [p.city, p.state, p.country].filter(Boolean).join(', ');
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      city_state: p.city_state,
      city: p.city,
      state: p.state,
      country: p.country,
      region: p.city_state || structured || null,
      photo_url: p.photo_url,
      organization_id: p.organization_id,
      created_date: p.created_date,
      lastActive: part ? part.lastActive : null,
      tournaments: playerTournaments,
      leagues: playerLeagues,
      courses: playerCourses,
      tournamentCount: playerTournaments.length,
      leagueCount: playerLeagues.length,
      courseCount: playerCourses.length,
    };
  });

  return {
    players: enriched,
    totals: {
      players: enriched.length,
      tournaments: tournaments.length,
      leagues: leagues.length,
      courses: courses.length,
    },
  };
}

module.exports = { public: false, handler };
