// Port of recovered base44/functions/notifyLeaguePrizePayout/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');
const { sendPush } = require('./helpers/push');

async function sendPrizeNotifications(service, prize, league) {
  const leagueName = league?.name || 'the league';
  const amount = prize.amount
    ? (prize.amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '$0';

  try {
    await sendEmail(
      prize.player_email,
      `Your prize from ${leagueName} has been paid out!`,
      `
        <p>Hi ${prize.player_name},</p>
        <p>Great news! Your prize from <strong>${leagueName}</strong> has been paid out.</p>
        <p><strong>Amount:</strong> ${amount}</p>
        <p>Congratulations on your winnings! Please allow 3-5 business days for the funds to appear in your account.</p>
        <p>Best regards,<br/>The League Team</p>
      `,
    );
  } catch (err) {
    console.error('League prize email failed:', err.message);
  }

  let playerId = null;
  try {
    const members = await service.LeagueMember.filter({
      league_id: prize.league_id,
      player_email: prize.player_email,
    });
    if (members[0]?.player_id) playerId = members[0].player_id;
  } catch (err) {
    console.error('LeagueMember lookup failed:', err.message);
  }

  if (!playerId) {
    return { pushSent: false, emailSent: true };
  }

  const pushResult = await sendPush({
    external_user_ids: [playerId],
    title: 'Prize Paid Out! 💰',
    message: `Your prize of ${amount} from ${leagueName} has been paid out. Congratulations!`,
  });

  return { pushSent: !!pushResult?.ok, emailSent: true, pushResult };
}

async function handler(ctx, body) {
  const payload = body || {};
  const service = ctx.asServiceRole.entities;

  // Case 1: Entity automation payload
  if (payload.data) {
    const prize = payload.data;
    const oldData = payload.old_data;
    if (prize.paid_out !== true) return { skipped: 'not paid out' };
    if (oldData?.paid_out === true) return { skipped: 'was already paid out' };

    let league = null;
    if (prize.league_id) {
      league = (await service.League.filter({ id: prize.league_id }))[0] || null;
    }
    const result = await sendPrizeNotifications(service, prize, league);
    return { success: true, source: 'automation', ...result };
  }

  // Case 2: Direct admin call
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') throw httpError(403, 'Forbidden');

  const { prizeId } = payload;
  if (!prizeId) throw httpError(400, 'prizeId required');

  const prize = (await service.LeaguePrize.filter({ id: prizeId }))[0];
  if (!prize) throw httpError(404, 'Prize not found');

  await service.LeaguePrize.update(prizeId, {
    paid_out: true,
    paid_out_at: new Date().toISOString(),
  });

  let league = null;
  if (prize.league_id) {
    league = (await service.League.filter({ id: prize.league_id }))[0] || null;
  }

  const result = await sendPrizeNotifications(service, { ...prize, paid_out: true }, league);
  return { success: true, source: 'direct', ...result };
}

module.exports = { public: false, handler };
