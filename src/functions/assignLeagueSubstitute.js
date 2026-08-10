// Port of recovered base44/functions/assignLeagueSubstitute/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');

function orgIdOf(user) {
  return user.data?.organization_id || user.organization_id || '';
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { session_id, league_id, original_player_email, substitute_member_id } = body || {};
  if (!session_id || !league_id || !original_player_email || !substitute_member_id) {
    throw httpError(
      400,
      'session_id, league_id, original_player_email and substitute_member_id are required',
    );
  }

  const role = user.role || user.data?.role;
  if (role !== 'admin' && role !== 'organizer_admin') {
    throw httpError(403, 'Only organizers can assign substitutes');
  }

  const service = ctx.asServiceRole.entities;
  const leagueRows = await service.League.filter({ id: league_id });
  const league = leagueRows[0];
  if (!league) throw httpError(404, 'League not found');
  if (role === 'organizer_admin' && league.organization_id && league.organization_id !== orgIdOf(user)) {
    throw httpError(403, 'Forbidden: league belongs to another organization');
  }
  const orgId = league.organization_id || '';

  const subMembers = await service.LeagueMember.filter({ league_id, is_substitute: true });
  const subMember = subMembers.find((m) => m.id === substitute_member_id);
  if (!subMember) {
    const allMembers = await service.LeagueMember.filter({ league_id });
    const fallback = allMembers.find((m) => m.id === substitute_member_id && m.active !== false);
    if (!fallback) throw httpError(404, 'Substitute member not found');
  }
  const member =
    subMember ||
    (await service.LeagueMember.filter({ league_id })).find((m) => m.id === substitute_member_id);

  const now = new Date().toISOString();
  const existingSubRsvp = await service.LeagueRSVP.filter({
    session_id,
    player_email: member.player_email,
  });

  let subRsvp;
  if (existingSubRsvp.length > 0) {
    subRsvp = await service.LeagueRSVP.update(existingSubRsvp[0].id, {
      status: 'yes',
      responded_at: now,
    });
  } else {
    subRsvp = await service.LeagueRSVP.create({
      session_id,
      league_id,
      organization_id: orgId || member.organization_id || '',
      player_email: member.player_email,
      player_name: member.player_name,
      player_id: member.player_id || '',
      status: 'yes',
      responded_at: now,
    });
  }

  const originalRsvps = await service.LeagueRSVP.filter({
    session_id,
    player_email: original_player_email,
  });
  if (originalRsvps.length > 0) {
    await service.LeagueRSVP.update(originalRsvps[0].id, { sub_requested: false });
  }

  const session = (await service.LeagueSession.filter({ id: session_id }))[0];
  const leagueName = league?.name || 'your league';
  const dateStr = session?.date
    ? new Date(session.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'the next session';
  const timeStr = session?.start_time || league?.start_time || '';
  const locStr = session?.location || league?.location || '';

  if (member.player_email) {
    try {
      await sendEmail(
        member.player_email,
        `You've been assigned as a substitute — ${leagueName}`,
        `You've been assigned to fill in for ${leagueName} on ${dateStr}${
          timeStr ? ' at ' + timeStr : ''
        }${locStr ? ' at ' + locStr : ''}.\n\nSee you there! Reply to this email if you can no longer make it.`,
      );
    } catch {
      /* swallow */
    }
  }

  try {
    const assignments = await service.LeagueTableAssignment.filter({ session_id });
    const origEmail = (original_player_email || '').toLowerCase();
    const seats = [
      { emailKey: 'east_player_email', nameKey: 'east_player_name' },
      { emailKey: 'south_player_email', nameKey: 'south_player_name' },
      { emailKey: 'west_player_email', nameKey: 'west_player_name' },
      { emailKey: 'north_player_email', nameKey: 'north_player_name' },
    ];
    for (const a of assignments || []) {
      const patch = {};
      for (const s of seats) {
        if ((a[s.emailKey] || '').toLowerCase() === origEmail) {
          patch[s.emailKey] = member.player_email;
          patch[s.nameKey] = member.player_name;
        }
      }
      if (Object.keys(patch).length > 0) {
        await service.LeagueTableAssignment.update(a.id, patch);
      }
    }
  } catch (e) {
    console.error('assignLeagueSubstitute: failed to update table assignments:', e?.message || e);
  }

  return { success: true, subRsvp };
}

module.exports = { public: false, handler };
