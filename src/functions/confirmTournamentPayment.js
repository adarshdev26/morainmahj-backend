// Port of recovered base44/functions/confirmTournamentPayment/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { sendPush } = require('./helpers/push');

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function buildPushMessage(tournament, registration, paymentIntent) {
  const name = tournament?.name || 'your tournament';
  const parts = [`You're confirmed for ${name}.`];
  if (tournament?.date) parts.push(`Date: ${formatDate(tournament.date)}.`);
  if (tournament?.location) parts.push(`Location: ${tournament.location}.`);
  const amount =
    registration?.payment_amount && registration.payment_amount > 0
      ? registration.payment_amount
      : paymentIntent?.amount_received ?? paymentIntent?.amount ?? 0;
  if (amount > 0) parts.push(`Paid: $${(amount / 100).toFixed(2)}.`);
  parts.push('Tap to view tournament details and assignments.');
  return parts.join(' ');
}

async function resolvePushTarget(service, registration) {
  const regPlayerId = registration?.player_id ? String(registration.player_id).trim() : null;
  if (regPlayerId) return regPlayerId;
  const email = String(registration?.player_email || '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  const users = await service.User.filter({ email });
  return users[0]?.id ? String(users[0].id).trim() : null;
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const paymentIntentId = String(body?.payment_intent_id || body?.paymentIntentId || '').trim();
  const registrationId = String(body?.registration_id || body?.registrationId || '').trim();
  if (!paymentIntentId) throw httpError(400, 'payment_intent_id is required');

  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const metaRegistrationId = String(paymentIntent.metadata?.registration_id || '').trim();
  const resolvedRegistrationId = registrationId || metaRegistrationId;
  if (!resolvedRegistrationId) throw httpError(404, 'Registration not found for payment');
  if (metaRegistrationId && registrationId && metaRegistrationId !== registrationId) {
    throw httpError(400, 'Payment does not match registration');
  }

  const service = ctx.asServiceRole.entities;
  let registration = (await service.Registration.filter({ id: resolvedRegistrationId }))[0];
  if (!registration) throw httpError(404, 'Registration not found');
  if (registration.player_id && registration.player_id !== user.id) {
    throw httpError(403, 'Unauthorized');
  }

  const paid = paymentIntent?.status === 'succeeded';
  let registrationRecord = registration;
  let syncedFromStripe = false;
  let pushSent = false;

  if (paid) {
    if (registration.payment_status !== 'paid' || registration.status !== 'confirmed') {
      await service.Registration.update(resolvedRegistrationId, {
        payment_status: 'paid',
        payment_amount:
          paymentIntent.amount_received ?? paymentIntent.amount ?? registration.payment_amount,
        stripe_payment_intent_id: paymentIntent.id ?? registration.stripe_payment_intent_id,
        status: 'confirmed',
        confirmed_at: registration.confirmed_at || new Date().toISOString(),
      });
    }

    const refreshed = await service.Registration.filter({ id: resolvedRegistrationId });
    registrationRecord = refreshed[0] ?? registration;
    syncedFromStripe = true;

    const tournamentId =
      paymentIntent.metadata?.tournament_id || registrationRecord.tournament_id;
    let tournament = null;
    if (tournamentId) {
      tournament = (await service.Tournament.filter({ id: tournamentId }))[0] ?? null;
    }

    if (!registrationRecord.payment_confirmation_push_sent_at) {
      const pushTarget = await resolvePushTarget(service, registrationRecord);
      if (pushTarget) {
        const pushResult = await sendPush({
          external_user_ids: [pushTarget],
          title: 'Payment Confirmed! 🏆',
          message: buildPushMessage(tournament, registrationRecord, paymentIntent),
        });
        pushSent = !!pushResult?.ok;
        await service.Registration.update(
          resolvedRegistrationId,
          pushSent
            ? {
                payment_confirmation_push_sent_at: new Date().toISOString(),
                payment_confirmation_push_failed: false,
              }
            : { payment_confirmation_push_failed: true },
        );
      }
    } else {
      pushSent = true;
    }
  }

  return {
    paid,
    status: paymentIntent.status,
    payment_intent_id: paymentIntent.id,
    registration_id: resolvedRegistrationId,
    tournament_id:
      registrationRecord.tournament_id ?? paymentIntent.metadata?.tournament_id ?? null,
    syncedFromStripe,
    pushSent,
    registration: {
      id: registrationRecord.id,
      status: registrationRecord.status,
      payment_status: registrationRecord.payment_status,
      payment_amount: registrationRecord.payment_amount ?? null,
      stripe_payment_intent_id:
        registrationRecord.stripe_payment_intent_id ?? paymentIntent.id,
    },
  };
}

module.exports = { public: false, handler };
