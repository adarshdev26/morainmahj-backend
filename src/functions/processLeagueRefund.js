// Port of recovered base44/functions/processLeagueRefund/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { applyLeagueRefund } = require('./helpers/leagueRefund');

function orgIdOf(user) {
  return user.data?.organization_id || user.organization_id || '';
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');
  if (user.role !== 'admin' && user.role !== 'organizer_admin') {
    throw httpError(403, 'Forbidden');
  }

  const { member_id, refund_type, amount, reason } = body || {};
  if (!member_id) throw httpError(400, 'member_id required');
  if (!['full', 'partial', 'manual'].includes(refund_type)) {
    throw httpError(400, 'refund_type must be full, partial, or manual');
  }

  const service = ctx.asServiceRole.entities;
  const members = await service.LeagueMember.filter({ id: member_id });
  const member = members[0];
  if (!member) throw httpError(404, 'Member not found');

  if (
    user.role === 'organizer_admin' &&
    member.organization_id &&
    member.organization_id !== orgIdOf(user)
  ) {
    throw httpError(403, 'Forbidden');
  }

  if (member.payment_status === 'refunded') {
    throw httpError(409, 'This member has already been refunded');
  }

  let stripeRefundId = '';
  if (refund_type !== 'manual') {
    const piId = member.stripe_payment_intent_id;
    if (!piId) throw httpError(400, 'No Stripe payment on record for this member');
    const params = { payment_intent: piId };
    if (refund_type === 'partial') {
      if (!amount || Number(amount) <= 0) {
        throw httpError(400, 'amount (cents) required for partial refund');
      }
      params.amount = Math.round(Number(amount));
    }
    try {
      const stripe = getStripe();
      const refund = await stripe.refunds.create(params);
      stripeRefundId = refund.id;
    } catch (e) {
      throw httpError(400, `Stripe refund failed: ${e.message}`);
    }
  }

  const result = await applyLeagueRefund(service, member, {
    type: refund_type,
    amount: refund_type === 'partial' ? Math.round(Number(amount)) : 0,
    reason,
    stripeRefundId,
    issuedBy: { id: user.id, email: user.email },
  });

  return { success: true, ...result };
}

module.exports = { public: false, handler };
