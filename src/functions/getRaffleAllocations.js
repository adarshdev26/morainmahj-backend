// Port of base44/functions/getRaffleAllocations/entry.ts
//
// Admin-only: allocation data reveals who holds which tickets.
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') {
    throw httpError(403, 'Admin authentication required');
  }

  const raffle_id = body?.raffle_id;
  if (!raffle_id) throw httpError(400, 'raffle_id required');

  const allocations = await ctx.asServiceRole.entities.RaffleAllocation.filter({ raffle_id });
  return { allocations };
}

module.exports = { public: false, handler };
