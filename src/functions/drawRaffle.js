// Port of recovered base44/functions/drawRaffle/entry.ts
const { httpError } = require('./errors');
const { sendPush } = require('./helpers/push');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') {
    throw httpError(403, 'Admin authentication required');
  }

  const { raffle_id } = body || {};
  if (!raffle_id) throw httpError(400, 'raffle_id required');

  const service = ctx.asServiceRole.entities;
  const raffle = (await service.Raffle.filter({ id: raffle_id }))[0];
  if (!raffle) throw httpError(404, 'Raffle not found');
  if (raffle.status === 'drawn') throw httpError(400, 'Raffle already drawn');

  const tickets = await service.RaffleTicket.filter({ raffle_id });
  const allNumbers = tickets.flatMap((t) => t.ticket_numbers || []);
  if (allNumbers.length === 0) throw httpError(400, 'No tickets sold');

  const winningNumber = allNumbers[Math.floor(Math.random() * allNumbers.length)];
  const winnerTicket = tickets.find((t) => (t.ticket_numbers || []).includes(winningNumber));
  if (!winnerTicket) throw httpError(500, 'Could not find winning ticket record');

  let prizeName = null;
  let winAmount = null;
  if (raffle.type === 'fifty_fifty') {
    const halfCents = Math.floor((raffle.fifty_fifty_total_cents || 0) / 2);
    winAmount = halfCents;
    prizeName = `$${(halfCents / 100).toFixed(2)}`;
  } else if (raffle.prizes?.length > 0) {
    prizeName = raffle.prizes[0]?.name || null;
  }

  await service.Raffle.update(raffle_id, {
    status: 'drawn',
    winner_ticket_number: winningNumber,
    winner_player_id: winnerTicket.player_id,
    winner_player_name: winnerTicket.player_name,
    winner_prize_name: prizeName,
    drawn_at: new Date().toISOString(),
  });

  const notify_winner = raffle.must_be_present === false;
  if (notify_winner && winnerTicket.player_id) {
    const prizeText = prizeName
      ? raffle.type === 'fifty_fifty'
        ? ` You won ${prizeName}!`
        : ` You won: ${prizeName}!`
      : '';
    try {
      await sendPush({
        external_user_ids: [winnerTicket.player_id],
        title: '🎉 You Won the Raffle!',
        message: `Ticket #${winningNumber} is the winner!${prizeText} Contact the director to claim your prize.`,
      });
    } catch {
      /* ignore push failures */
    }
  }

  return {
    success: true,
    winner_ticket_number: winningNumber,
    winner_player_name: winnerTicket.player_name,
    winner_player_id: winnerTicket.player_id,
    prize_name: prizeName,
    win_amount_cents: winAmount,
  };
}

module.exports = { public: false, handler };
