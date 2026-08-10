// Port of recovered base44/functions/verifyTournamentPayment/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const sessionId = String(body?.session_id || body?.sessionId || '').trim();
  const registrationId = String(body?.registration_id || body?.registrationId || '').trim();
  if (!sessionId) throw httpError(400, 'session_id is required');

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metaRegistrationId = String(session.metadata?.registration_id || '').trim();
  const resolvedRegistrationId = registrationId || metaRegistrationId;
  if (!resolvedRegistrationId) throw httpError(404, 'Registration not found for session');
  if (metaRegistrationId && metaRegistrationId !== resolvedRegistrationId) {
    throw httpError(400, 'Session does not match registration');
  }

  const service = ctx.asServiceRole.entities;
  const registration = (await service.Registration.filter({ id: resolvedRegistrationId }))[0];
  if (!registration) throw httpError(404, 'Registration not found');
  if (registration.player_id !== user.id) throw httpError(403, 'Unauthorized');

  const paidInStripe = session?.payment_status === 'paid';
  let syncedFromStripe = false;

  if (paidInStripe && (registration.payment_status !== 'paid' || registration.status !== 'confirmed')) {
    await service.Registration.update(resolvedRegistrationId, {
      payment_status: 'paid',
      payment_amount: session.amount_total ?? registration.payment_amount,
      stripe_payment_intent_id: session.payment_intent ?? registration.stripe_payment_intent_id,
      status: 'confirmed',
      confirmed_at: registration.confirmed_at || new Date().toISOString(),
    });
    syncedFromStripe = true;
  }

  const registrationRecord =
    (await service.Registration.filter({ id: resolvedRegistrationId }))[0] ?? registration;

  return {
    paid:
      paidInStripe ||
      registrationRecord.payment_status === 'paid' ||
      registrationRecord.status === 'confirmed',
    status: session.payment_status,
    session_id: session.id,
    registration_id: resolvedRegistrationId,
    tournament_id:
      registrationRecord.tournament_id ?? session.metadata?.tournament_id ?? null,
    syncedFromStripe,
    registration: {
      id: registrationRecord.id,
      status: registrationRecord.status,
      payment_status: registrationRecord.payment_status,
      payment_amount: registrationRecord.payment_amount ?? null,
      stripe_session_id: registrationRecord.stripe_session_id ?? session.id,
    },
  };
}

module.exports = { public: false, handler };
