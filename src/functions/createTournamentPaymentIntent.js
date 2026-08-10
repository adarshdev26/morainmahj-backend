// Port of recovered base44/functions/createTournamentPaymentIntent/entry.ts
const { httpError } = require('./errors');
const {
  getStripe,
  getAppId,
  getPublishableKey,
  findOrCreateStripeCustomer,
  tournamentPaymentAmount,
} = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const tournamentId = String(body?.tournament_id || body?.tournamentId || '').trim();
  const registrationId = String(body?.registration_id || body?.registrationId || '').trim();
  if (!tournamentId) throw httpError(400, 'tournament_id is required');
  if (!registrationId) throw httpError(400, 'registration_id is required');

  const service = ctx.asServiceRole.entities;
  const tournament = (await service.Tournament.filter({ id: tournamentId }))[0];
  if (!tournament) throw httpError(404, 'Tournament not found');

  const registration = (await service.Registration.filter({ id: registrationId }))[0];
  if (!registration) throw httpError(404, 'Registration not found');
  if (registration.tournament_id !== tournamentId) {
    throw httpError(400, 'Registration does not match tournament');
  }
  if (registration.player_id !== user.id) throw httpError(403, 'Unauthorized');
  if (registration.payment_status === 'paid') {
    throw httpError(400, 'Registration is already paid');
  }
  if (registration.status !== 'pending') {
    throw httpError(400, 'Only pending registrations can be paid');
  }

  const amount = tournamentPaymentAmount(tournament);
  if (amount <= 0) throw httpError(400, 'No payment required for this tournament');

  const stripe = getStripe();
  const customer = await findOrCreateStripeCustomer(stripe, user.email, user.id);
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customer.id,
    automatic_payment_methods: { enabled: true },
    metadata: {
      app_id: getAppId(),
      tournament_id: tournamentId,
      registration_id: registrationId,
      user_id: user.id,
      flow: 'tournament_mobile_payment_sheet',
    },
  });

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customer.id },
    { apiVersion: '2023-10-16' },
  );

  await service.Registration.update(registrationId, {
    stripe_payment_intent_id: paymentIntent.id,
    payment_status: 'pending',
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
    registration_id: registrationId,
    tournament_id: tournamentId,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      date: tournament.date ?? null,
      location: tournament.location ?? null,
    },
  };
}

module.exports = { public: false, handler };
