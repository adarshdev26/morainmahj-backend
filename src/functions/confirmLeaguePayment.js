// Port of recovered base44/functions/confirmLeaguePayment/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { sendEmail } = require('./helpers/email');
const { sendPush } = require('./helpers/push');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function activateLeagueMember(service, memberId, paymentIntent) {
  const member = (await service.LeagueMember.filter({ id: memberId }))[0];
  if (!member) return { activated: false, reason: 'not_found' };
  if (member.payment_status === 'paid') {
    return { activated: false, reason: 'already_paid', member };
  }

  const amount = paymentIntent.amount_received ?? paymentIntent.amount ?? member.payment_amount;
  const paymentIntentId = paymentIntent.id ?? member.stripe_payment_intent_id;

  await service.LeagueMember.update(memberId, {
    payment_status: 'paid',
    payment_amount: amount,
    stripe_payment_intent_id: paymentIntentId,
    active: true,
    paid_at: new Date().toISOString(),
  });

  const league = (await service.League.filter({ id: member.league_id }))[0];
  if (!league) return { activated: true, member, league: null };

  const subject = league.join_email_subject || `Welcome to ${league.name}!`;
  let emailBody =
    league.join_email_body ||
    `
<div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #faf9f7;">
  <h1 style="font-size: 26px; font-weight: bold; color: #1e293b; margin-bottom: 4px;">${league.name}</h1>
  <p style="color: #64748b; font-size: 14px; margin-top: 0;">Welcome to the league!</p>
  <p style="font-size: 15px; color: #334155;">Hi {{player_name}}, your membership payment has been received and you've been added to <strong>{{league_name}}</strong>. You'll receive an email before each session with your RSVP link.</p>
  <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">Questions? Reply to this email to reach the organizer.</p>
</div>
  `.trim();

  emailBody = emailBody
    .replace(/{{player_name}}/g, member.player_name)
    .replace(/{{league_name}}/g, league.name);

  try {
    await sendEmail(
      member.player_email,
      subject
        .replace(/{{league_name}}/g, league.name)
        .replace(/{{player_name}}/g, member.player_name),
      emailBody,
    );
  } catch (err) {
    console.warn('[confirmLeaguePayment] welcome email failed:', err.message);
  }

  if (member.player_id) {
    try {
      await sendPush({
        external_user_ids: [member.player_id],
        title: 'Payment Confirmed! 🎉',
        message: `You're now a member of ${league.name}. You'll receive session invites before each play date.`,
        url: `${getAppBaseUrl()}/app/leagues`,
      });
    } catch (pushErr) {
      console.warn('[confirmLeaguePayment] Push failed:', pushErr?.message || pushErr);
    }
  }

  return { activated: true, member, league };
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const paymentIntentId = String(body?.payment_intent_id || body?.paymentIntentId || '').trim();
  const memberId = String(body?.member_id || body?.memberId || '').trim();
  if (!paymentIntentId) throw httpError(400, 'payment_intent_id is required');

  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const metaMemberId = String(paymentIntent.metadata?.league_member_id || '').trim();
  const resolvedMemberId = memberId || metaMemberId;
  if (!resolvedMemberId) throw httpError(404, 'Member not found for payment');
  if (metaMemberId && memberId && metaMemberId !== memberId) {
    throw httpError(400, 'Payment does not match member');
  }

  const service = ctx.asServiceRole.entities;
  const member = (await service.LeagueMember.filter({ id: resolvedMemberId }))[0];
  if (!member) throw httpError(404, 'Member not found');
  if (member.player_id && member.player_id !== user.id) throw httpError(403, 'Unauthorized');

  const paid = paymentIntent?.status === 'succeeded';
  let pushSent = false;
  if (paid) {
    const result = await activateLeagueMember(service, resolvedMemberId, paymentIntent);
    pushSent = !!result.activated;
  }

  return {
    paid,
    status: paymentIntent.status,
    payment_intent_id: paymentIntent.id,
    member_id: resolvedMemberId,
    league_id: member.league_id,
    pushSent,
  };
}

module.exports = { public: false, handler };
