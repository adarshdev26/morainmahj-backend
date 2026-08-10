// Port of recovered base44/functions/saveAuctionCard/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { auction_id } = body || {};
  if (!auction_id) throw httpError(400, 'auction_id required');

  const stripe = getStripe();
  const baseUrl = getAppBaseUrl();

  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  let customer;
  if (customers.data.length > 0) {
    customer = customers.data[0];
  } else {
    customer = await stripe.customers.create({
      email: user.email,
      name: user.full_name,
      metadata: { user_id: user.id },
    });
  }

  const paymentMethods = await stripe.paymentMethods.list({
    customer: customer.id,
    type: 'card',
  });
  if (paymentMethods.data.length > 0) {
    const pm = paymentMethods.data[0];
    return {
      already_saved: true,
      card_last4: pm.card.last4,
      card_brand: pm.card.brand,
      stripe_customer_id: customer.id,
    };
  }

  const setupIntent = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customer.id,
    payment_method_types: ['card'],
    success_url: `${baseUrl}/app/tournament-home/${auction_id}?card_saved=1`,
    cancel_url: `${baseUrl}/app/tournament-home/${auction_id}`,
    metadata: {
      user_id: user.id,
      auction_id,
    },
  });

  return { url: setupIntent.url, stripe_customer_id: customer.id };
}

module.exports = { public: false, handler };
