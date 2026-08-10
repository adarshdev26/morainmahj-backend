// Port of recovered base44/functions/cancelSubscription/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');

async function handler(ctx) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  if (user.role !== 'organizer_admin') {
    throw httpError(403, 'Only organizers can cancel their subscription');
  }

  const service = ctx.asServiceRole.entities;
  const subs = await service.Subscription.filter({ user_id: user.id });
  const sub = subs[0];
  if (!sub) throw httpError(404, 'No subscription found');

  if (sub.status === 'cancelled') {
    throw httpError(400, 'Subscription is already cancelled');
  }

  const now = new Date().toISOString();

  if (sub.status === 'trialing' || !sub.stripe_subscription_id) {
    await service.Subscription.update(sub.id, {
      status: 'cancelled',
      cancelled_at: now,
    });
    return { success: true, message: 'Subscription cancelled' };
  }

  const stripe = getStripe();
  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  await service.Subscription.update(sub.id, {
    cancelled_at: now,
  });

  return {
    success: true,
    message: 'Subscription will be cancelled at the end of the current billing period',
  };
}

module.exports = { public: false, handler };
