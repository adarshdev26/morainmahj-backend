// Port of recovered base44/functions/drawTRaffle/entry.ts
const { httpError } = require('./errors');
const { sendPush } = require('./helpers/push');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') {
    throw httpError(403, 'Admin authentication required');
  }

  const { raffle_id, winners } = body || {};
  if (!raffle_id || !Array.isArray(winners)) {
    throw httpError(400, 'raffle_id and winners array required');
  }

  const service = ctx.asServiceRole.entities;
  const raffle = (await service.Raffle.filter({ id: raffle_id }))[0];

  for (const { item_id, winner_player_name } of winners) {
    await service.RafflePrizeItem.update(item_id, {
      winner_player_name,
      drawn_at: new Date().toISOString(),
    });
  }

  await service.Raffle.update(raffle_id, { status: 'drawn' });

  const notify_winners = raffle?.must_be_present === false;
  if (notify_winners) {
    for (const { winner_player_id, prize_label } of winners) {
      if (!winner_player_id) continue;
      const prizeText = prize_label ? ` You won: ${prize_label}!` : '';
      try {
        await sendPush({
          external_user_ids: [winner_player_id],
          title: '🎉 You Won!',
          message: `${raffle?.name || 'Raffle'} winner announced!${prizeText} Contact the director to claim your prize.`,
        });
      } catch {
        /* ignore */
      }
    }
  }

  return { success: true };
}

module.exports = { public: false, handler };
