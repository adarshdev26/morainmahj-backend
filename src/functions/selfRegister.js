// Port of recovered base44/functions/selfRegister/entry.ts (business logic only).
const { httpError } = require('./errors');
const { sendPush, defaultMyTournamentsUrl } = require('./helpers/push');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const tournament_id = body?.tournament_id;
  const bringing_set = body?.bringing_set;
  if (!tournament_id) throw httpError(400, 'tournament_id required');

  const service = ctx.asServiceRole.entities;

  const tournaments = await service.Tournament.filter({ id: tournament_id });
  const tournament = tournaments[0];
  if (!tournament) throw httpError(404, 'Tournament not found');

  const existing = await service.Registration.filter({
    tournament_id,
    player_id: user.id,
  });
  if (existing.length > 0) {
    return { registration: existing[0], already_registered: true };
  }

  const confirmed = await service.Registration.filter({ tournament_id, status: 'confirmed' });
  const pending = await service.Registration.filter({ tournament_id, status: 'pending' });
  const activePlayers = confirmed.length + pending.length;
  const isCapped = tournament.player_cap && activePlayers >= tournament.player_cap;
  const status = isCapped && tournament.waitlist_enabled ? 'waitlisted' : 'pending';

  const reg = await service.Registration.create({
    tournament_id,
    player_id: user.id,
    player_email: user.email,
    player_name: user.full_name || user.email,
    player_phone: user.phone || '',
    player_city_state: user.city_state || '',
    player_photo_url: user.photo_url || '',
    status,
    bringing_set: bringing_set === true,
    payment_status: 'not_required',
    invited_at: new Date().toISOString(),
    waitlist_position: null,
  });

  const requiresPayment = ['all_in', 'app_fee_only'].includes(tournament.payment_model);
  const shouldSendImmediatePush = status === 'waitlisted' || !requiresPayment;
  if (shouldSendImmediatePush) {
    sendPush({
      external_user_ids: [user.email],
      title: status === 'waitlisted' ? 'Added to Waitlist' : 'Registration Confirmed! 🎉',
      message:
        status === 'waitlisted'
          ? `You've been added to the waitlist for ${tournament.name}.`
          : `You're registered for ${tournament.name}! We'll see you there.`,
      url: defaultMyTournamentsUrl(),
    }).catch(() => {});
  }

  return { registration: reg, already_registered: false, status };
}

module.exports = { public: false, handler };
