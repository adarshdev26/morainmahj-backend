// Port of recovered base44/functions/verifySubscriptionPayment/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { session_id } = body || {};
  if (!session_id) throw httpError(400, 'session_id is required');

  let stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    throw httpError(500, 'Stripe not configured');
  }

  const session = await stripe.checkout.sessions.retrieve(session_id);
  if (session.payment_status !== 'paid') {
    return { activated: false, reason: 'Payment not completed' };
  }

  if (session.metadata?.subscription_payment !== 'true') {
    return { activated: false, reason: 'Not a subscription payment' };
  }

  const subUserId = session.metadata?.user_id || user.id;
  const subUserEmail = session.metadata?.user_email || user.email;
  const subPlan = session.metadata?.plan || 'starter';
  const subBillingPeriod = session.metadata?.billing_period || 'monthly';
  let subOrgId = session.metadata?.organization_id || '';

  const service = ctx.asServiceRole.entities;

  if (!subOrgId) {
    const existingOrgs = await service.Organization.filter({ owner_id: subUserId });
    if (existingOrgs[0]) {
      subOrgId = existingOrgs[0].id;
    } else {
      const org = await service.Organization.create({
        name: `${subUserEmail || 'New'}'s Organization`,
        owner_id: subUserId,
        owner_email: subUserEmail || '',
      });
      subOrgId = org.id;
    }
  }

  const existingSubs = await service.Subscription.filter({ user_id: subUserId });
  const existingSub = existingSubs[0];
  const subData = {
    user_id: subUserId,
    user_email: subUserEmail,
    plan: subPlan,
    billing_period: subBillingPeriod,
    status: 'active',
    stripe_customer_id: session.customer,
    stripe_session_id: session.id,
    organization_id: subOrgId,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(
      Date.now() + (subBillingPeriod === 'annual' ? 365 : 30) * 86400000,
    ).toISOString(),
  };
  if (existingSub) {
    await service.Subscription.update(existingSub.id, subData);
  } else {
    await service.Subscription.create(subData);
  }

  const userRows = await service.User.filter({ id: subUserId });
  const existingUser = userRows[0];
  if (existingUser?.role === 'admin') {
    console.log(`User ${subUserId} is already a super admin — skipping role downgrade`);
  } else {
    await service.User.update(subUserId, {
      role: 'organizer_admin',
      organization_id: subOrgId,
    });
  }

  console.log(
    `Subscription payment verified for user ${subUserId}, plan ${subPlan}, org ${subOrgId}`,
  );
  return { activated: true, plan: subPlan, organization_id: subOrgId };
}

module.exports = { public: false, handler };
