// Port of recovered base44/functions/raffleCheckout/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { raffle_id, quantity } = body || {};
  if (!raffle_id) throw httpError(400, 'raffle_id required');

  const service = ctx.asServiceRole.entities;
  const raffle = (await service.Raffle.filter({ id: raffle_id }))[0];
  if (!raffle) throw httpError(404, 'Raffle not found');
  if (raffle.status !== 'open') throw httpError(400, 'Raffle is not open');

  const qty = quantity || raffle.bundle_qty || 1;
  const existingTickets = await service.RaffleTicket.filter({ raffle_id });
  const allNumbers = existingTickets.flatMap((t) => t.ticket_numbers || []);
  const startBase = 100000 + Math.floor(Math.random() * 600000);
  const nextNumber = allNumbers.length > 0 ? Math.max(...allNumbers) + 1 : startBase;
  const ticketNumbers = Array.from({ length: qty }, (_, i) => nextNumber + i);

  if (raffle.max_tickets_per_player) {
    const myTickets = existingTickets.filter((t) => t.player_id === user.id);
    const myCount = myTickets.reduce((s, t) => s + (t.quantity || 1), 0);
    if (myCount + qty > raffle.max_tickets_per_player) {
      throw httpError(400, `Max ${raffle.max_tickets_per_player} tickets per player`);
    }
  }

  const isFree = !raffle.ticket_price_cents || raffle.ticket_price_cents === 0;
  const totalCents = raffle.bundle_price_cents
    ? raffle.bundle_price_cents
    : (raffle.ticket_price_cents || 0) * qty;

  if (isFree || totalCents === 0) {
    await service.RaffleTicket.create({
      raffle_id,
      tournament_id: raffle.tournament_id || null,
      league_id: raffle.league_id || null,
      player_id: user.id,
      player_name: user.full_name,
      player_email: user.email,
      ticket_numbers: ticketNumbers,
      quantity: qty,
      amount_paid_cents: 0,
      payment_status: 'free',
      manually_assigned: false,
    });

    await service.Raffle.update(raffle.id, {
      total_tickets_sold: (raffle.total_tickets_sold || 0) + qty,
    });

    return { success: true, ticket_numbers: ticketNumbers };
  }

  const stripe = getStripe();
  const baseUrl = getAppBaseUrl();
  const label =
    raffle.bundle_qty > 1
      ? `${raffle.bundle_qty} Raffle Tickets (#${ticketNumbers[0]}–#${ticketNumbers[ticketNumbers.length - 1]})`
      : `Raffle Ticket #${ticketNumbers[0]}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${raffle.name} — ${label}` },
          unit_amount: totalCents,
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/app/tournament?paid=1`,
    cancel_url: `${baseUrl}/app/tournament`,
    metadata: {
      raffle_id,
      player_id: user.id,
      player_name: user.full_name,
      player_email: user.email,
      ticket_numbers: JSON.stringify(ticketNumbers),
      quantity: String(qty),
      total_cents: String(totalCents),
    },
  });

  return { url: session.url };
}

module.exports = { public: false, handler };
