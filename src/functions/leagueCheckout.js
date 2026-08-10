// Port of recovered base44/functions/leagueCheckout/entry.ts
const { httpError } = require('./errors');
const { getStripe, getAppId } = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { league_id, member_id, success_url, cancel_url } = body || {};
  if (!league_id) throw httpError(400, 'league_id is required');
  if (!member_id) throw httpError(400, 'member_id is required');

  const service = ctx.asServiceRole.entities;
  const league = (await service.League.filter({ id: league_id }))[0];
  if (!league) throw httpError(404, 'League not found');

  const amount = league.membership_fee || 0;
  if (amount <= 0) throw httpError(400, 'No payment required for this league');

  const member = (await service.LeagueMember.filter({ id: member_id }))[0];
  if (!member) throw httpError(404, 'Member not found');
  if (member.league_id !== league_id) throw httpError(400, 'Member does not match league');
  if (
    member.player_id !== user.id &&
    String(member.player_email || '').toLowerCase() !== String(user.email || '').toLowerCase()
  ) {
    throw httpError(403, 'Unauthorized');
  }
  if (member.payment_status === 'paid') throw httpError(400, 'Membership is already paid');

  const description = league.membership_label || `${league.name} — Membership`;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: description },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url,
    cancel_url,
    customer_email: user.email,
    metadata: {
      app_id: getAppId(),
      league_id,
      league_member_id: member_id,
      user_id: user.id,
    },
  });

  await service.LeagueMember.update(member_id, {
    stripe_session_id: session.id,
    payment_status: 'pending',
    payment_amount: amount,
  });

  return { url: session.url, session_id: session.id };
}

module.exports = { public: false, handler };
