// Port of recovered base44/functions/notifyTournamentRegistration/entry.ts
const { httpError } = require('./errors');
const {
  fetchOneSignalUserByExternalId,
  sendOneSignalPushWithFallback,
} = require('./helpers/onesignal');

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

function tournamentPaidAmount(registration, tournament) {
  if (registration?.payment_amount && registration.payment_amount > 0) {
    return registration.payment_amount;
  }
  if (tournament?.payment_model === 'all_in') {
    return (tournament.entry_fee || 0) + (tournament.app_fee || 0);
  }
  if (tournament?.payment_model === 'app_fee_only') return tournament.app_fee || 0;
  return 0;
}

function buildMessage(tournament, registration) {
  const name = tournament?.name || 'your tournament';
  const parts = [`You're confirmed for ${name}.`];
  if (tournament?.date) parts.push(`Date: ${formatDate(tournament.date)}.`);
  if (tournament?.location) parts.push(`Location: ${tournament.location}.`);
  const amount = tournamentPaidAmount(registration, tournament);
  if (amount > 0 && registration?.payment_status === 'paid') {
    parts.push(`Paid: $${(amount / 100).toFixed(2)}.`);
  }
  parts.push('Tap to view tournament details and assignments.');
  return parts.join(' ');
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const registrationId = String(body?.registration_id || body?.registrationId || '').trim();
  if (!registrationId) throw httpError(400, 'registration_id is required');

  const service = ctx.asServiceRole.entities;
  const registration = (await service.Registration.filter({ id: registrationId }))[0];
  if (!registration) throw httpError(404, 'Registration not found');

  const userEmail = String(user.email || '')
    .trim()
    .toLowerCase();
  const regEmail = String(registration.player_email || '')
    .trim()
    .toLowerCase();
  const owns =
    registration.player_id === user.id || (userEmail && regEmail && userEmail === regEmail);
  if (!owns) throw httpError(403, 'Unauthorized');
  if (registration.status !== 'confirmed') {
    throw httpError(400, 'Registration is not confirmed');
  }

  const tournamentId = registration.tournament_id;
  const tournament = tournamentId
    ? (await service.Tournament.filter({ id: tournamentId }))[0] ?? null
    : null;

  const targetExternalId = registration.player_id
    ? String(registration.player_id).trim()
    : String(user.id || '').trim();
  if (!targetExternalId) return { pushSent: false, reason: 'no_target_id' };

  const title =
    registration.payment_status === 'paid'
      ? 'Payment Confirmed! 🏆'
      : 'Registration Confirmed! 🏆';
  const playerEmail = String(registration.player_email || user.email || '')
    .trim()
    .toLowerCase();
  const onesignalUser = await fetchOneSignalUserByExternalId(targetExternalId);

  const pushResult = await sendOneSignalPushWithFallback({
    external_user_ids: [targetExternalId, playerEmail].filter(Boolean),
    onesignal_ids: onesignalUser.onesignalId ? [onesignalUser.onesignalId] : [],
    subscription_ids: onesignalUser.pushSubscriptionIds ?? [],
    title,
    message: buildMessage(tournament, registration),
    data: {
      type: 'tournament_registration_confirmed',
      registration_id: registrationId,
      tournament_id: tournamentId || '',
    },
  });

  await service.Registration.update(
    registrationId,
    pushResult.ok
      ? {
          payment_confirmation_push_sent_at: new Date().toISOString(),
          payment_confirmation_push_failed: false,
        }
      : { payment_confirmation_push_failed: true },
  );

  return {
    pushSent: !!pushResult.ok,
    reason: pushResult.ok ? 'sent' : pushResult.error || pushResult.reason,
  };
}

module.exports = { public: false, handler };
