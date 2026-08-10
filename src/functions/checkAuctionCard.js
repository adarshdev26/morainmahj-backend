// Port of recovered base44/functions/checkAuctionCard/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const stripe = getStripe();
  const appUrl = getAppBaseUrl();

  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  let customer;
  if (customers.data.length === 0) {
    customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    });

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      mode: 'setup',
      setup_intent_data: { metadata: { user_id: user.id } },
      success_url: `${appUrl}/app?card_added=true`,
      cancel_url: `${appUrl}/app?card_cancelled=true`,
    });

    return {
      has_card: false,
      stripe_customer_id: customer.id,
      stripe_url: session.url,
    };
  }

  customer = customers.data[0];
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customer.id,
    type: 'card',
  });

  if (paymentMethods.data.length === 0) {
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      mode: 'setup',
      setup_intent_data: { metadata: { user_id: user.id } },
      success_url: `${appUrl}/app?card_added=true`,
      cancel_url: `${appUrl}/app?card_cancelled=true`,
    });

    return {
      has_card: false,
      stripe_customer_id: customer.id,
      stripe_url: session.url,
    };
  }

  const pm = paymentMethods.data[0];
  return {
    has_card: true,
    card_last4: pm.card.last4,
    card_brand: pm.card.brand,
    stripe_customer_id: customer.id,
    payment_method_id: pm.id,
  };
}

module.exports = { public: false, handler };
