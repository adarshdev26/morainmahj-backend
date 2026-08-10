// Port of recovered base44/functions/notifyPrizePayOut/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') throw httpError(403, 'Forbidden');

  const { winnerId } = body || {};
  const service = ctx.asServiceRole.entities;

  const winner = (await service.PrizeWinner.filter({ id: winnerId }))[0];
  if (!winner) throw httpError(404, 'Winner not found');

  const tournament = (await service.Tournament.filter({ id: winner.tournament_id }))[0];

  const categoryLabels = {
    '1st': '1st Place (Overall)',
    '2nd': '2nd Place (Overall)',
    '3rd': '3rd Place (Overall)',
    round_1: 'Round 1 Winner',
    round_2: 'Round 2 Winner',
    round_3: 'Round 3 Winner',
    round_4: 'Round 4 Winner',
  };

  const categoryLabel = categoryLabels[winner.category] || winner.category;
  const tournamentName = tournament?.name || 'the tournament';
  const amount =
    winner.amount?.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) ||
    `$${winner.amount}`;

  await service.PrizeWinner.update(winnerId, {
    paid_out: true,
    paid_out_at: new Date().toISOString(),
  });

  try {
    await sendEmail(
      winner.player_email,
      `Your prize from ${tournamentName} has been paid out!`,
      `
        <p>Hi ${winner.player_name},</p>
        <p>Great news! Your prize from <strong>${tournamentName}</strong> has been paid out.</p>
        <p><strong>Category:</strong> ${categoryLabel}<br/>
        <strong>Amount:</strong> ${amount}</p>
        <p>Congratulations again on your winnings!</p>
        <p>Best regards,<br/>The Tournament Team</p>
      `,
    );
  } catch (err) {
    console.warn('[notifyPrizePayOut] email failed:', err.message);
  }

  return { success: true };
}

module.exports = { public: false, handler };
