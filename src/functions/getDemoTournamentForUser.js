// Port of functions/getDemoTournamentForUser/entry.ts
//
// Offers a demo tournament to players who have nothing real yet. Returns
// { tournament: null } once the player has any demo registration or at least one
// confirmed non-demo registration.
const { httpError } = require('./errors');

const DEMO_TOURNAMENT_ID = '6a16c452011ad529c4e829ee';

const DEMO_FALLBACK = {
  name: 'Welcome to Morain Mahj — Demo Tournament',
  date: '2026-08-15',
  location: 'Morain Community Center, Keller TX',
  status: 'registration_open',
  num_rounds: 4,
  is_demo: true,
  description: 'This is a demo tournament to help you explore the Morain Mahj app!',
};

async function handler(ctx) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const service = ctx.asServiceRole.entities;

  const existingDemoRegs = await service.Registration.filter({
    player_id: user.id,
    is_demo: true,
  });
  if (existingDemoRegs.length > 0) return { tournament: null };

  const regsByPid = await service.Registration.filter({
    player_id: user.id,
    status: 'confirmed',
  });
  if (regsByPid.filter((r) => !r.is_demo).length >= 1) return { tournament: null };

  const regsByEmail = await service.Registration.filter({
    player_email: user.email,
    status: 'confirmed',
  });
  if (regsByEmail.filter((r) => !r.is_demo).length >= 1) return { tournament: null };

  let tournament = null;
  try {
    tournament = await service.Tournament.get(DEMO_TOURNAMENT_ID);
  } catch {
    // The known demo id may not exist in this database; fall through.
  }

  if (!tournament) {
    const demoList = await service.Tournament.filter({ is_demo: true });
    tournament = demoList.length > 0 ? demoList[0] : null;
  }

  if (!tournament) {
    tournament = await service.Tournament.create(DEMO_FALLBACK);
  }

  return { tournament };
}

module.exports = { public: false, handler };
