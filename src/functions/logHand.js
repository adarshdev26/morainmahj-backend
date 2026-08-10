// Port of recovered base44/functions/logHand/entry.ts
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const {
    card_year,
    category,
    position,
    side = 'none',
    status,
    win_type,
    special_hand_id,
    tournament_id,
    tournament_name,
    league_id,
    league_name,
    session_id,
    round,
    table,
    notes,
    organization_id,
  } = body || {};

  if (!card_year || !status) {
    throw httpError(400, 'card_year and status are required');
  }
  if (!['Won', 'Attempted'].includes(status)) {
    throw httpError(400, 'status must be Won or Attempted');
  }

  const service = ctx.asServiceRole.entities;
  let points = 0;
  let concealed = false;
  let resolvedCategory = category || '';
  let resolvedLine = position ? Number(position) : undefined;
  let resolvedSide = side || 'none';
  let specialHandName;

  if (special_hand_id) {
    const specialHand = await service.SpecialHand.get(special_hand_id);
    if (!specialHand) throw httpError(400, 'Special hand not found');
    points = status === 'Won' ? Number(specialHand.point_value || 0) : 0;
    concealed = !!specialHand.concealed;
    specialHandName = specialHand.name;
    if (specialHand.category && specialHand.category !== 'Custom') {
      resolvedCategory = specialHand.category;
    }
  } else {
    if (!category || !position) {
      throw httpError(400, 'category and position are required for NMJL hands');
    }
    const cardHand = await service.CardHand.filter({
      card_year: Number(card_year),
      category,
      position: Number(position),
      side: side || 'none',
    });
    if (!cardHand || cardHand.length === 0) {
      throw httpError(
        400,
        `Card hand not found for ${card_year} > ${category} > Position ${position}${
          side && side !== 'none' ? ' ' + side : ''
        }`,
      );
    }
    const hand = cardHand[0];
    points = status === 'Won' ? Number(hand.points || 0) : 0;
    concealed = hand.concealed_exposed === 'C';
  }

  if (status === 'Won') {
    if (!win_type || !['Self Drawn', 'Thrown', 'Jokerless'].includes(win_type)) {
      throw httpError(400, 'win_type is required for Won hands');
    }
  }

  const dupFilter = {
    player_id: user.id,
    card_year: Number(card_year),
    hand_status: status,
  };
  if (round) dupFilter.round = Number(round);
  if (table) dupFilter.table = String(table);
  if (special_hand_id) {
    dupFilter.special_hand_id = special_hand_id;
  } else {
    dupFilter.category = resolvedCategory;
    dupFilter.line = Number(resolvedLine);
    dupFilter.side = resolvedSide;
  }

  const existing = await service.HandLog.filter(dupFilter, '-created_date', 5);
  if (existing && existing.length > 0) {
    throw httpError(409, 'You already logged this hand in this round/table.', {
      existing_id: existing[0].id,
    });
  }

  const payload = {
    player_id: user.id,
    player_name: user.full_name || '',
    player_email: user.email || '',
    organization_id: organization_id || user.data?.organization_id || user.organization_id || '',
    tournament_id: tournament_id || '',
    tournament_name: tournament_name || '',
    league_id: league_id || '',
    league_name: league_name || '',
    session_id: session_id || '',
    card_year: Number(card_year),
    category: resolvedCategory || undefined,
    line: resolvedLine,
    side: special_hand_id ? undefined : resolvedSide,
    hand_status: status,
    win_type: status === 'Won' ? win_type : undefined,
    points,
    concealed,
    special_hand_id: special_hand_id || undefined,
    special_hand_name: specialHandName,
    round: round ? Number(round) : undefined,
    table: table ? String(table) : undefined,
    logged_by: user.id,
    notes: notes || undefined,
  };

  // Original used scoped entities for create
  const created = await ctx.entities.HandLog.create(payload);
  return { success: true, hand_log: created, points, concealed };
}

module.exports = { public: false, handler };
