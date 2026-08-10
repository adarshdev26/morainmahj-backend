// Port of recovered base44/functions/stripeCheckout/entry.ts
const { httpError } = require('./errors');
const {
  getStripe,
  getAppId,
  tournamentPaymentAmount,
  tournamentPaymentDescription,
} = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { tournament_id, registration_id, success_url, cancel_url } = body || {};
  if (!tournament_id) throw httpError(400, 'tournament_id is required');
  if (!registration_id) throw httpError(400, 'registration_id is required');

  const service = ctx.asServiceRole.entities;
  const tournament = (await service.Tournament.filter({ id: tournament_id }))[0];
  if (!tournament) throw httpError(404, 'Tournament not found');

  const registration = (await service.Registration.filter({ id: registration_id }))[0];
  if (!registration) throw httpError(404, 'Registration not found');
  if (registration.tournament_id !== tournament_id) {
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
  if (amount === 0) throw httpError(400, 'No payment required');

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: tournamentPaymentDescription(tournament) },
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
      tournament_id,
      registration_id,
      user_id: user.id,
    },
  });

  await service.Registration.update(registration_id, {
    stripe_session_id: session.id,
    payment_status: 'pending',
  });

  return { url: session.url, session_id: session.id };
}

module.exports = { public: false, handler };
