/**
 * Port of recovered base44/shared/leagueRefund.ts
 * `service` is ctx.asServiceRole.entities
 */
const { emailLayout, escapeHtml } = require('./emailLayout');
const { sendEmail } = require('./email');
const { sendOneSignalPush } = require('./onesignal');
const { getAppBaseUrl } = require('./appUrl');

async function applyLeagueRefund(service, member, opts) {
  const { type, amount, reason, stripeRefundId, issuedBy } = opts;
  const now = new Date().toISOString();
  const refundedAmount = type === 'full' ? member.payment_amount || 0 : Number(amount) || 0;

  const update = {
    payment_status: 'refunded',
    refunded_amount: refundedAmount,
    refunded_at: now,
    refund_type: type,
    refund_reason: reason || '',
    stripe_refund_id: stripeRefundId || member.stripe_refund_id || '',
  };
  if (type === 'full') update.active = false;

  await service.LeagueMember.update(member.id, update);

  try {
    await service.AuditLog.create({
      organization_id: member.organization_id || '',
      user_id: issuedBy?.id || 'stripe-webhook',
      user_email: issuedBy?.email || 'stripe-webhook',
      action: 'refund',
      entity_type: 'LeagueMember',
      entity_id: member.id,
      status: 'success',
      details: {
        type,
        amount: refundedAmount,
        reason: reason || '',
        stripe_refund_id: stripeRefundId || '',
      },
    });
  } catch (e) {
    console.error('applyLeagueRefund: audit log failed:', e?.message || e);
  }

  const leagues = await service.League.filter({ id: member.league_id });
  const league = leagues[0];
  const leagueName = league?.name || 'the league';

  try {
    const amountStr = `$${(refundedAmount / 100).toFixed(2)}`;
    const appUrl = getAppBaseUrl();
    await sendEmail(
      member.player_email,
      `Refund Confirmation — ${leagueName}`,
      emailLayout({
        eyebrow: 'Refund Confirmation',
        title: 'Your Refund Has Been Processed',
        subtitle: escapeHtml(leagueName),
        greeting: `Hi <strong>${escapeHtml(member.player_name || 'there')}</strong>,`,
        paragraphs: [
          `A <strong>${escapeHtml(type)}</strong> refund of <strong>${escapeHtml(amountStr)}</strong> has been processed for your ${escapeHtml(leagueName)} membership.`,
          ...(reason ? [`Reason: ${escapeHtml(reason)}`] : []),
          'If you have questions, please contact the organizer.',
        ],
        detailsTitle: 'Refund Details',
        details: [
          { icon: '🏛', label: 'League', value: escapeHtml(leagueName) },
          { icon: '💵', label: 'Amount', value: `<strong>${escapeHtml(amountStr)}</strong>` },
          { icon: '🔖', label: 'Type', value: escapeHtml(type) },
        ],
        cta: { label: 'View My Leagues', url: `${appUrl}/app/leagues` },
        footerNote: `You are receiving this because a refund was processed for your ${escapeHtml(leagueName)} membership.`,
      }),
    );
  } catch (e) {
    console.error('applyLeagueRefund: email failed:', e?.message || e);
  }

  if (member.player_id) {
    try {
      await sendOneSignalPush({
        external_user_ids: [member.player_id],
        title: 'Refund Processed',
        message: `Your ${leagueName} membership refund has been processed.`,
        data: { type: 'league_refund', league_id: member.league_id },
      });
    } catch (e) {
      console.error('applyLeagueRefund: push failed:', e?.message || e);
    }
  }

  return { memberId: member.id, refundedAmount, type };
}

module.exports = { applyLeagueRefund };
