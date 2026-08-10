// Port of recovered base44/functions/generateLeagueAssignments/entry.ts
const { httpError } = require('./errors');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function calcTables(n) {
  const rem = n % 4;
  let tablesOf3;
  let tablesOf4;
  if (rem === 0) {
    tablesOf3 = 0;
    tablesOf4 = n / 4;
  } else if (rem === 1) {
    tablesOf3 = 3;
    tablesOf4 = (n - 9) / 4;
  } else if (rem === 2) {
    tablesOf3 = 2;
    tablesOf4 = (n - 6) / 4;
  } else {
    tablesOf3 = 1;
    tablesOf4 = (n - 3) / 4;
  }
  if (
    tablesOf3 < 0 ||
    tablesOf4 < 0 ||
    !Number.isInteger(tablesOf4) ||
    !Number.isInteger(tablesOf3)
  ) {
    return { numTables: 0, tablesOf3: 0, tablesOf4: 0, invalid: true };
  }
  return { numTables: tablesOf3 + tablesOf4, tablesOf3, tablesOf4 };
}

function generateAssignments({ players, numRounds, eastRotation, volunteers }) {
  const { numTables, tablesOf3, tablesOf4 } = calcTables(players.length);
  const rounds = [];
  const setProviderEmails = new Set(volunteers.map((v) => v.player_email));

  const tableSizes = [];
  for (let t = 0; t < numTables; t++) {
    tableSizes.push(t < tablesOf4 ? 4 : 3);
  }

  function seatPlayers(shuffled) {
    const result = [];
    let idx = 0;
    for (let t = 0; t < numTables; t++) {
      const size = tableSizes[t];
      result.push(shuffled.slice(idx, idx + size));
      idx += size;
    }
    return result;
  }

  for (let round = 1; round <= numRounds; round++) {
    const tables = [];

    if (eastRotation === 'stays') {
      let eastPlayers;
      let nonEastPlayers;

      if (round === 1) {
        const shuffled = shuffle([...players]);
        eastPlayers = shuffled.slice(0, numTables);
        nonEastPlayers = shuffled.slice(numTables);
        rounds._eastPlayers = eastPlayers;
        rounds._nonEastPlayers = nonEastPlayers;
      } else {
        eastPlayers = rounds._eastPlayers;
        nonEastPlayers = shuffle([...rounds._nonEastPlayers]);
      }

      let nonEastIdx = 0;
      for (let t = 0; t < numTables; t++) {
        const size = tableSizes[t];
        const east = eastPlayers[t];
        const south = nonEastPlayers[nonEastIdx++];
        const west = nonEastPlayers[nonEastIdx++];
        const north = size === 4 ? nonEastPlayers[nonEastIdx++] : null;

        const seated = [east, south, west, north].filter(Boolean);
        const setProvider = seated.find((p) => setProviderEmails.has(p.player_email));

        tables.push({
          round_number: round,
          table_number: t + 1,
          east_player_email: east?.player_email || null,
          east_player_name: east?.player_name || null,
          south_player_email: south?.player_email || null,
          south_player_name: south?.player_name || null,
          west_player_email: west?.player_email || null,
          west_player_name: west?.player_name || null,
          north_player_email: north?.player_email || null,
          north_player_name: north?.player_name || null,
          set_at_table: !!setProvider,
          set_provider_email: setProvider?.player_email || null,
          set_provider_name: setProvider?.player_name || null,
        });
      }
    } else {
      const shuffled = shuffle([...players]);
      const seated = seatPlayers(shuffled);

      for (let t = 0; t < numTables; t++) {
        const [east, south, west, north] = seated[t];
        const seatedPlayers = [east, south, west, north].filter(Boolean);
        const setProvider = seatedPlayers.find((p) => setProviderEmails.has(p.player_email));

        tables.push({
          round_number: round,
          table_number: t + 1,
          east_player_email: east?.player_email || null,
          east_player_name: east?.player_name || null,
          south_player_email: south?.player_email || null,
          south_player_name: south?.player_name || null,
          west_player_email: west?.player_email || null,
          west_player_name: west?.player_name || null,
          north_player_email: north?.player_email || null,
          north_player_name: north?.player_name || null,
          set_at_table: !!setProvider,
          set_provider_email: setProvider?.player_email || null,
          set_provider_name: setProvider?.player_name || null,
        });
      }
    }

    rounds.push(...tables);
  }

  return rounds;
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (user?.role !== 'admin') throw httpError(403, 'Admin only');

  const { sessionId, publish } = body || {};
  if (!sessionId) throw httpError(400, 'sessionId required');

  const service = ctx.asServiceRole.entities;
  const session = (await service.LeagueSession.filter({ id: sessionId }))[0];
  if (!session) throw httpError(404, 'Session not found');

  const league = (await service.League.filter({ id: session.league_id }))[0];
  if (!league) throw httpError(404, 'League not found');

  if (!league.table_assignments_enabled) {
    throw httpError(400, 'Table assignments not enabled for this league');
  }

  const rsvps = await service.LeagueRSVP.filter({ session_id: sessionId });
  const attending = rsvps.filter((r) => r.status === 'yes');
  const volunteers = rsvps.filter((r) => r.volunteering_set);

  if (attending.length < 3) {
    throw httpError(400, 'Need at least 3 attending players to generate assignments');
  }

  const existing = await service.LeagueTableAssignment.filter({ session_id: sessionId });
  for (const a of existing) {
    await service.LeagueTableAssignment.delete(a.id);
  }

  const numRounds = league.num_rounds || 4;
  const eastRotation = league.east_rotation || 'moves';
  const players = attending.map((r) => ({
    player_email: r.player_email,
    player_name: r.player_name,
  }));

  const tableInfo = calcTables(players.length);
  if (tableInfo.invalid) {
    throw httpError(
      400,
      `Cannot seat ${players.length} players into tables of 3 and 4. Please adjust the number of attending players (e.g., 5 players cannot be evenly seated).`,
    );
  }

  const { tablesOf3, tablesOf4, numTables } = tableInfo;
  const assignments = generateAssignments({
    players,
    numRounds,
    eastRotation,
    volunteers,
  });

  for (const a of assignments) {
    await service.LeagueTableAssignment.create({
      session_id: sessionId,
      league_id: session.league_id,
      ...a,
    });
  }

  await service.LeagueSession.update(sessionId, {
    assignments_generated: true,
    assignments_generated_at: new Date().toISOString(),
    assignments_published: !!publish,
  });

  return {
    success: true,
    players: players.length,
    numTables,
    tablesOf4,
    tablesOf3,
    rounds: numRounds,
    assignments: assignments.length,
    published: !!publish,
  };
}

module.exports = { public: false, handler };
