// Port of recovered base44/functions/placeSilentAuctionBid/entry.ts
const { httpError } = require('./errors');
const { sendPush } = require('./helpers/push');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { item_id, amount_cents } = body || {};
  if (!item_id || !amount_cents) {
    throw httpError(400, 'item_id and amount_cents required');
  }

  const service = ctx.asServiceRole.entities;
  const item = (await service.SilentAuctionItem.filter({ id: item_id }))[0];
  if (!item) throw httpError(404, 'Item not found');

  const auction = (await service.SilentAuction.filter({ id: item.auction_id }))[0];
  if (!auction || auction.status !== 'open') {
    throw httpError(400, 'Auction is not open for bidding');
  }

  const minBid =
    (item.current_bid_cents || item.starting_bid_cents || 0) + (item.bid_increment_cents || 500);
  const effectiveMin = item.current_bid_cents > 0 ? minBid : item.starting_bid_cents || 0;
  if (amount_cents < effectiveMin) {
    throw httpError(400, `Minimum bid is $${(effectiveMin / 100).toFixed(2)}`);
  }

  if (item.current_bidder_id === user.id) {
    throw httpError(400, 'You are already the highest bidder');
  }

  await service.SilentAuctionBid.create({
    auction_id: item.auction_id,
    item_id: item.id,
    player_id: user.id,
    player_name: user.full_name,
    player_email: user.email,
    amount_cents,
  });

  await service.SilentAuctionItem.update(item.id, {
    current_bid_cents: amount_cents,
    current_bidder_id: user.id,
    current_bidder_name: user.full_name,
    current_bidder_email: user.email,
  });

  const appUrl = getAppBaseUrl();
  sendPush({
    external_user_ids: [user.email],
    title: 'Bid Placed! 🏆',
    message: `Your bid of $${(amount_cents / 100).toFixed(2)} on "${item.title}" has been placed successfully.`,
    url: `${appUrl}/app`,
  }).catch(() => {});

  const allBids = await service.SilentAuctionBid.filter({ item_id: item.id });
  const uniqueBidders = allBids
    .filter((bid) => bid.player_email !== user.email)
    .map((bid) => bid.player_email)
    .filter((email, idx, arr) => arr.indexOf(email) === idx);

  if (uniqueBidders.length > 0) {
    sendPush({
      external_user_ids: uniqueBidders,
      title: '📣 New bid placed!',
      message: `A new bid of $${(amount_cents / 100).toFixed(2)} was placed on "${item.title}". Check it out!`,
      url: `${appUrl}/app`,
    }).catch(() => {});
  }

  return { success: true, new_bid_cents: amount_cents };
}

module.exports = { public: false, handler };
