// Port of recovered base44/functions/deleteLeagueCascade/entry.ts
const { httpError } = require('./errors');

async function deleteAllMatching(entity, query) {
  const records = await entity.filter(query, '-created_date', 500);
  if (!records || records.length === 0) return 0;
  await Promise.all(records.map((r) => entity.delete(r.id)));
  return records.length;
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');
  if (user.role !== 'admin') throw httpError(403, 'Forbidden — admin only');

  const { league_id } = body || {};
  if (!league_id) throw httpError(400, 'Missing league_id');

  const db = ctx.asServiceRole.entities;

  try {
    await db.League.delete(league_id);
  } catch (e) {
    if (!String(e?.message || e).includes('not found')) throw e;
  }

  const results = await Promise.allSettled([
    deleteAllMatching(db.LeagueSession, { league_id }),
    deleteAllMatching(db.LeagueRSVP, { league_id }),
    deleteAllMatching(db.LeagueRoundTimer, { league_id }),
    deleteAllMatching(db.LeagueTableAssignment, { league_id }),
    deleteAllMatching(db.LeagueMember, { league_id }),
  ]);

  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));

  const deleted = results
    .filter((r) => r.status === 'fulfilled')
    .reduce((sum, r) => sum + r.value, 0);

  if (errors.length > 0) {
    console.warn('League deleted with cleanup errors:', errors);
  }

  return {
    success: true,
    league_id,
    records_deleted: deleted,
    cleanup_errors: errors,
  };
}

module.exports = { public: false, handler };
