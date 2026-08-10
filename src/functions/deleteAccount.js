// Port of recovered base44/functions/deleteAccount/entry.ts
const { httpError } = require('./errors');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { confirmEmail } = body || {};
  if (!confirmEmail || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw httpError(
      400,
      'Email confirmation does not match. Please type your email address exactly.',
    );
  }

  const service = ctx.asServiceRole.entities;

  const registrations = await service.Registration.filter({ player_id: user.id });
  for (const reg of registrations) {
    await service.Registration.update(reg.id, {
      player_name: 'Deleted User',
      player_email: `deleted_${user.id}@deleted.invalid`,
      player_phone: '',
      player_city_state: '',
      player_photo_url: '',
    });
  }

  const leagueMembers = await service.LeagueMember.filter({ player_id: user.id });
  for (const m of leagueMembers) {
    await service.LeagueMember.update(m.id, {
      player_name: 'Deleted User',
      player_email: `deleted_${user.id}@deleted.invalid`,
      player_phone: '',
      active: false,
    });
  }

  const rsvps = await service.LeagueRSVP.filter({ player_id: user.id });
  for (const r of rsvps) {
    await service.LeagueRSVP.update(r.id, {
      player_name: 'Deleted User',
      player_email: `deleted_${user.id}@deleted.invalid`,
    });
  }

  const enrollments = await service.CourseEnrollment.filter({ player_id: user.id });
  for (const e of enrollments) {
    await service.CourseEnrollment.update(e.id, {
      player_name: 'Deleted User',
      player_email: `deleted_${user.id}@deleted.invalid`,
      player_phone: '',
    });
  }

  await service.User.delete(user.id);

  return { success: true };
}

module.exports = { public: false, handler };
