// Port of recovered base44/functions/createSubscriptionCheckout/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body, req) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { price_id, plan, billing_period, success_url, cancel_url } = body || {};
  if (!price_id) throw httpError(400, 'price_id is required');

  const service = ctx.asServiceRole.entities;
  const existingSubs = await service.Subscription.filter({ user_id: user.id });
  const existingSub = existingSubs[0];
  let customerId = existingSub?.stripe_customer_id;

  const stripe = getStripe();
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.full_name,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
  }

  const origin = req?.headers?.origin || getAppBaseUrl();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: price_id, quantity: 1 }],
    subscription_data: {
      trial_period_days: existingSub?.status === 'trialing' ? undefined : 14,
      metadata: {
        user_id: user.id,
        user_email: user.email,
        plan,
        billing_period,
      },
    },
    success_url: success_url || `${origin}/admin/subscription?success=1`,
    cancel_url: cancel_url || `${origin}/pricing`,
    metadata: {
      user_id: user.id,
      user_email: user.email,
      plan,
      billing_period,
      subscription_payment: 'true',
      organization_id: existingSub?.organization_id || user.organization_id || '',
    },
  });

  return { url: session.url };
}

module.exports = { public: false, handler };
