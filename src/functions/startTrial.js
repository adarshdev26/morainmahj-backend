// Port of recovered base44/functions/startTrial/entry.ts
// Source: commit 9d00bbf327c81539648da6c922106483c3d42679 (blob supporting individual + organizer)
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { plan, billing_period } = body || {};
  if (!plan) throw httpError(400, 'plan is required');

  const service = ctx.asServiceRole.entities;
  const existingSubs = await service.Subscription.filter({ user_id: user.id });
  const existingSub = existingSubs[0];
  if (existingSub && (existingSub.status === 'trialing' || existingSub.status === 'active')) {
    throw httpError(400, 'You already have an active subscription', {
      subscription: existingSub,
    });
  }

  let orgId = user.data?.organization_id || user.organization_id;
  if (plan !== 'individual' && !orgId) {
    const existingOrgs = await service.Organization.filter({ owner_id: user.id });
    if (existingOrgs[0]) {
      orgId = existingOrgs[0].id;
    } else {
      const org = await service.Organization.create({
        name: `${user.full_name || user.email.split('@')[0]}'s Organization`,
        owner_id: user.id,
        owner_email: user.email,
      });
      orgId = org.id;
    }
  }

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);

  const subData = {
    user_id: user.id,
    user_email: user.email,
    plan,
    billing_period: billing_period || 'monthly',
    status: 'trialing',
    trial_ends_at: trialEnd.toISOString(),
    organization_id: orgId,
  };

  let subscription;
  if (existingSub) {
    subscription = await service.Subscription.update(existingSub.id, subData);
  } else {
    subscription = await service.Subscription.create(subData);
  }

  if (plan !== 'individual') {
    if (user.role === 'admin') {
      console.log(`User ${user.id} is already a super admin — skipping role change`);
    } else {
      await service.User.update(user.id, {
        role: 'organizer_admin',
        organization_id: orgId,
      });
    }
  }

  return { success: true, subscription, organization_id: orgId };
}

module.exports = { public: false, handler };
