// Port of recovered base44/functions/confirmRegistration/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function promoteWaitlist(service, tournament_id) {
  const tournament = (await service.Tournament.filter({ id: tournament_id }))[0];
  if (!tournament?.waitlist_enabled) return;

  const waitlisted = await service.Registration.filter({
    tournament_id,
    status: 'waitlisted',
  });
  if (waitlisted.length === 0) return;

  waitlisted.sort((a, b) => (a.waitlist_position || 999) - (b.waitlist_position || 999));
  const next = waitlisted[0];

  await service.Registration.update(next.id, {
    status: 'pending',
    waitlist_position: null,
  });

  const requiresPayment = ['all_in', 'app_fee_only'].includes(tournament.payment_model);
  const appUrl = getAppBaseUrl();
  const ctaText = requiresPayment ? 'Complete Payment & Confirm Spot' : 'Confirm My Spot';
  const bodyText = requiresPayment
    ? `A spot has opened up in <strong>${tournament.name}</strong> and you've been moved off the waitlist! Please log in and complete your payment to secure your spot — it won't be held indefinitely.`
    : `A spot has opened up in <strong>${tournament.name}</strong> and you've been moved off the waitlist! Please log in to confirm your attendance.`;

  try {
    await sendEmail(
      next.player_email,
      `🎉 You're off the waitlist for ${tournament.name}!`,
      `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f7f4;font-family:Georgia,serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f4;padding:40px 20px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5ddd0;">
          <tr><td style="background:#1e2d4a;padding:32px;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:20px;letter-spacing:4px;color:#f2ede6;">Morain Mahj</div>
            <div style="color:#c9a96e;font-size:11px;letter-spacing:3px;margin-top:4px;">You're Off the Waitlist!</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="font-size:15px;color:#374151;">Hi <strong>${next.player_name}</strong>,</p>
            <p style="font-size:15px;color:#374151;line-height:1.7;">${bodyText}</p>
            <p style="font-size:14px;color:#6b7280;"><strong>Tournament:</strong> ${tournament.name}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
              <tr><td align="center" style="background:#1e2d4a;border-radius:8px;">
                <a href="${appUrl}/app/invites" style="display:block;color:#f2ede6;text-decoration:none;padding:14px 24px;font-size:13px;letter-spacing:2px;text-transform:uppercase;">${ctaText} →</a>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
    </body></html>`,
    );
  } catch (err) {
    console.warn('[confirmRegistration] waitlist email failed:', err.message);
  }
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const registration_id = body?.registration_id;
  const action = body?.action;
  if (!registration_id) throw httpError(400, 'registration_id required');

  const service = ctx.asServiceRole.entities;
  const regs = await service.Registration.filter({ id: registration_id });
  const reg = regs[0];
  if (!reg) throw httpError(404, 'Registration not found');

  const isOwner = reg.player_id === user.id || reg.player_email === user.email;
  if (!isOwner) throw httpError(403, 'Forbidden');

  if (!reg.player_id || reg.player_id !== user.id) {
    await service.Registration.update(registration_id, {
      player_id: user.id,
      player_name: reg.player_name || user.full_name || user.email,
    });
  }

  const tournament = (await service.Tournament.filter({ id: reg.tournament_id }))[0];

  if (action === 'confirm') {
    const requiresPayment = ['all_in', 'app_fee_only'].includes(tournament?.payment_model);
    if (requiresPayment) {
      throw httpError(400, 'Payment is required to confirm this registration');
    }

    await service.Registration.update(registration_id, {
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      payment_status: 'not_required',
    });

    const existing = await service.Player.filter({
      tournament_id: reg.tournament_id,
      email: reg.player_email,
    });
    if (existing.length === 0) {
      await service.Player.create({
        tournament_id: reg.tournament_id,
        name: reg.player_name,
        email: reg.player_email,
        phone: reg.player_phone,
        flight: reg.flight,
      });
    }

    return { success: true, status: 'confirmed' };
  }

  if (action === 'decline') {
    await service.Registration.update(registration_id, { status: 'declined' });
    await promoteWaitlist(service, reg.tournament_id);
    return { success: true, status: 'declined' };
  }

  if (action === 'cancel') {
    await service.Registration.update(registration_id, { status: 'cancelled' });
    await promoteWaitlist(service, reg.tournament_id);
    return { success: true, status: 'cancelled' };
  }

  throw httpError(400, 'Invalid action');
}

module.exports = { public: false, handler };
