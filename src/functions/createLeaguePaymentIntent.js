// Port of recovered base44/functions/createLeaguePaymentIntent/entry.ts
const { httpError } = require('./errors');
const {
  getStripe,
  getAppId,
  getPublishableKey,
  findOrCreateStripeCustomer,
} = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const leagueId = String(body?.league_id || body?.leagueId || '').trim();
  const memberId = String(body?.member_id || body?.memberId || '').trim();
  if (!leagueId) throw httpError(400, 'league_id is required');
  if (!memberId) throw httpError(400, 'member_id is required');

  const service = ctx.asServiceRole.entities;
  const league = (await service.League.filter({ id: leagueId }))[0];
  if (!league) throw httpError(404, 'League not found');

  const member = (await service.LeagueMember.filter({ id: memberId }))[0];
  if (!member) throw httpError(404, 'Member not found');
  if (member.league_id !== leagueId) throw httpError(400, 'Member does not match league');
  if (
    member.player_id !== user.id &&
    String(member.player_email || '').toLowerCase() !== String(user.email || '').toLowerCase()
  ) {
    throw httpError(403, 'Unauthorized');
  }
  if (member.payment_status === 'paid') throw httpError(400, 'Membership is already paid');

  const amount = league.membership_fee || 0;
  if (amount <= 0) throw httpError(400, 'No payment required for this league');

  const stripe = getStripe();
  const customer = await findOrCreateStripeCustomer(stripe, user.email, user.id);
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customer.id,
    automatic_payment_methods: { enabled: true },
    metadata: {
      app_id: getAppId(),
      league_id: leagueId,
      league_member_id: memberId,
      user_id: user.id,
      flow: 'league_mobile_payment_sheet',
    },
  });

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customer.id },
    { apiVersion: '2023-10-16' },
  );

  await service.LeagueMember.update(memberId, {
    stripe_payment_intent_id: paymentIntent.id,
    payment_status: 'pending',
    payment_amount: amount,
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    payment_flow: 'payment_sheet',
    amount,
    currency: paymentIntent.currency || 'usd',
    customerId: customer.id,
    ephemeralKeySecret: ephemeralKey.secret,
    publishableKey: getPublishableKey(),
    league_id: leagueId,
    member_id: memberId,
    league: {
      id: league.id,
      name: league.name,
      membership_label: league.membership_label || `${league.name} — Membership`,
    },
  };
}

module.exports = { public: false, handler };
