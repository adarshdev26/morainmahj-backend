const Stripe = require('stripe');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error('Stripe not configured');
    err.status = 500;
    throw err;
  }
  return new Stripe(key);
}

/** App id stored in Stripe metadata (replaces legacy BASE44_APP_ID). */
function getAppId() {
  return process.env.APP_ID || '';
}

function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || '';
}

async function findOrCreateStripeCustomer(stripe, email, userId, { name } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
  if (existing.data[0]) return existing.data[0];

  return stripe.customers.create({
    email: normalizedEmail,
    ...(name ? { name } : {}),
    metadata: {
      user_id: userId,
      app_id: getAppId(),
    },
  });
}

function tournamentPaymentAmount(tournament) {
  if (tournament.payment_model === 'all_in') {
    return (tournament.entry_fee || 0) + (tournament.app_fee || 0);
  }
  if (tournament.payment_model === 'app_fee_only') {
    return tournament.app_fee || 0;
  }
  return 0;
}

function tournamentPaymentDescription(tournament) {
  if (tournament.payment_model === 'all_in') {
    return `${tournament.name} - Entry Fee + App Fee`;
  }
  if (tournament.payment_model === 'app_fee_only') {
    return `${tournament.name} - App Processing Fee`;
  }
  return tournament.name || 'Tournament payment';
}

module.exports = {
  getStripe,
  getAppId,
  getPublishableKey,
  findOrCreateStripeCustomer,
  tournamentPaymentAmount,
  tournamentPaymentDescription,
};
