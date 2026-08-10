// Port of recovered base44/functions/lockInAuctionWinners/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') {
    throw httpError(403, 'Admin authentication required');
  }

  const { auction_id, charge_cards = false } = body || {};
  if (!auction_id) throw httpError(400, 'auction_id required');

  const service = ctx.asServiceRole.entities;
  const items = await service.SilentAuctionItem.filter({ auction_id });
  const winners = items.filter((item) => item.current_bidder_id && !item.winner_player_id);

  await Promise.all(
    winners.map((item) =>
      service.SilentAuctionItem.update(item.id, {
        winner_player_id: item.current_bidder_id,
        winner_player_name: item.current_bidder_name,
        winner_bid_cents: item.current_bid_cents,
        closed_at: new Date().toISOString(),
      }),
    ),
  );

  await service.SilentAuction.update(auction_id, { status: 'revealed' });

  const chargeResults = [];
  if (charge_cards) {
    const stripe = getStripe();
    for (const item of winners) {
      if (!item.current_bidder_email || !item.current_bid_cents) continue;
      try {
        const customers = await stripe.customers.list({
          email: item.current_bidder_email,
          limit: 1,
        });
        if (customers.data.length === 0) {
          chargeResults.push({ item_id: item.id, title: item.title, status: 'no_customer' });
          continue;
        }
        const customer = customers.data[0];
        const paymentMethods = await stripe.paymentMethods.list({
          customer: customer.id,
          type: 'card',
        });
        if (paymentMethods.data.length === 0) {
          chargeResults.push({ item_id: item.id, title: item.title, status: 'no_card' });
          continue;
        }
        const pm = paymentMethods.data[0];
        const pi = await stripe.paymentIntents.create({
          amount: item.current_bid_cents,
          currency: 'usd',
          customer: customer.id,
          payment_method: pm.id,
          confirm: true,
          off_session: true,
          description: `Silent Auction Win: ${item.title}`,
          metadata: {
            auction_id,
            item_id: item.id,
            winner_id: item.current_bidder_id,
          },
        });
        chargeResults.push({
          item_id: item.id,
          title: item.title,
          status: pi.status,
          amount_cents: item.current_bid_cents,
        });
      } catch (err) {
        chargeResults.push({
          item_id: item.id,
          title: item.title,
          status: 'error',
          error: err.message,
        });
      }
    }
  }

  const finalItems = await service.SilentAuctionItem.filter({ auction_id });
  return { items: finalItems, charge_results: chargeResults };
}

module.exports = { public: false, handler };
