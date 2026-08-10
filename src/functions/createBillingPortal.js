// Port of recovered base44/functions/createBillingPortal/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body, req) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const service = ctx.asServiceRole.entities;
  const subs = await service.Subscription.filter({ user_id: user.id });
  const sub = subs[0];
  if (!sub?.stripe_customer_id) throw httpError(404, 'No billing account found');

  const { return_url } = body || {};
  const origin = req?.headers?.origin || getAppBaseUrl();
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: return_url || `${origin}/admin/subscription`,
  });

  return { url: portal.url };
}

module.exports = { public: false, handler };
