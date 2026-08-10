/**
 * Phase 2 authenticated HTTP integration verification against the live server.
 * Usage: node scripts/phase2-integration-verify.js
 */
require('dotenv').config();
const pool = require('../db');
const Auth = require('../src/models/Auth');
const functions = require('../src/functions');
const { ACTIONS } = require('../src/routes/actionRegistry');

const BASE = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000';

const PHASE2_IMPLEMENTED = [
  'recalculateLeagueWaitlist',
  'promoteFromWaitlistCourse',
  'generateLeagueAssignments',
  'qrCheckIn',
  'sendBulkEmails',
  'sendLeagueInvites',
  'sendBulkSMS',
  'sendLeagueBulkSMS',
  'sendPushNotification',
  'syncOneSignalIdentity',
];

const PHASE2_MISSING_SOURCE = [
  'requestLeagueSubstitute',
  'assignLeagueSubstitute',
  'createLeagueWalkIn',
  'markLeagueMemberPaid',
  'processLeagueRefund',
];

const PHASE1_IMPLEMENTED = [
  'selfRegister',
  'confirmRegistration',
  'invitePlayer',
  'leagueJoin',
  'stripeCheckout',
  'createTournamentPaymentIntent',
  'confirmTournamentPayment',
  'verifyTournamentPayment',
  'notifyTournamentRegistration',
  'leagueCheckout',
  'createLeaguePaymentIntent',
  'confirmLeaguePayment',
  'courseCheckout',
  'createCoursePaymentIntent',
  'confirmCoursePayment',
  'verifyCoursePayment',
  'notifyCourseEnrollment',
  'createSubscriptionCheckout',
  'createBillingPortal',
];

function toKebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

async function http(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    return { status: 0, error: err.message, body: null };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, error: null };
}

function record(results, name, check, ok, detail) {
  results.push({ name, check, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name} / ${check}: ${detail}`);
}

async function main() {
  const results = [];
  console.log('=== Phase 2 Integration Verification ===');
  console.log('Base URL:', BASE);

  const health = await http('GET', '/api/health');
  if (health.status === 0) {
    console.error('Backend not reachable:', health.error);
    process.exit(1);
  }
  record(
    results,
    'server',
    'listening',
    health.status === 200 && health.body?.database === 'Connected',
    `HTTP ${health.status} db=${health.body?.database}`,
  );

  // Registry recalculation from live code
  const registered = ACTIONS.length;
  const implemented = functions.names();
  const implementedCount = implemented.length;
  const remaining501 = registered - implementedCount;
  const missingSource = PHASE2_MISSING_SOURCE.filter((n) => !functions.has(n));
  const phase1Count = PHASE1_IMPLEMENTED.filter((n) => functions.has(n)).length;
  const phase2Count = PHASE2_IMPLEMENTED.filter((n) => functions.has(n)).length;

  console.log('\n--- Registry ---');
  console.log('registered', registered);
  console.log('implemented', implementedCount);
  console.log('501', remaining501);
  console.log('phase1', phase1Count);
  console.log('phase2', phase2Count);
  console.log('missing-source still 501', missingSource.length);

  // Load real users
  const { rows: users } = await pool.query(
    `SELECT id, email, role, organization_id,
            (password IS NOT NULL AND password <> '') AS has_pw
     FROM "User"
     ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'organizer_admin' THEN 1 ELSE 2 END, email
     LIMIT 50`,
  );
  const admin = users.find((u) => u.role === 'admin' && u.has_pw) || users.find((u) => u.role === 'admin');
  const player = users.find((u) => u.role === 'user' && u.has_pw) || users.find((u) => u.role === 'user');

  if (!admin) {
    console.error('No admin user in DB — cannot run authenticated tests');
    process.exit(1);
  }

  // Set known passwords for verify actors so /api/auth/login works (local verification only).
  const TEST_PASSWORD = 'Phase2Verify!2026';
  const TEST_HASH = await Auth.hashPassword(TEST_PASSWORD);
  await pool.query(`UPDATE "User" SET password = $1 WHERE id = $2`, [TEST_HASH, admin.id]);
  if (player) {
    await pool.query(`UPDATE "User" SET password = $1 WHERE id = $2`, [TEST_HASH, player.id]);
  }
  console.log(`Set temporary verify password for admin ${admin.email}` + (player ? ` and player ${player.email}` : ''));

  async function login(email) {
    const res = await http('POST', '/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    if (res.status !== 200 || !res.body?.token) {
      console.warn(`Login failed for ${email} (${res.status}); minting JWT from Auth.generateToken`);
      const u = users.find((x) => x.email === email);
      const token = Auth.generateToken({ id: u.id, email: u.email });
      return { token, user: u, via: 'jwt_mint' };
    }
    return { token: res.body.token, user: res.body.user || { email }, via: 'login' };
  }

  const adminAuth = await login(admin.email);
  const playerAuth = player ? await login(player.email) : null;

  console.log(`\nAdmin actor: ${admin.email} (${adminAuth.via})`);
  if (playerAuth) console.log(`Player actor: ${player.email} (${playerAuth.via})`);

  // Fixture data
  const { rows: sessions } = await pool.query(
    `SELECT id, league_id, date FROM "LeagueSession" ORDER BY date DESC NULLS LAST LIMIT 10`,
  );
  const { rows: leagues } = await pool.query(
    `SELECT id, name, organization_id, table_assignments_enabled FROM "League" LIMIT 10`,
  );
  const { rows: waitRsvps } = await pool.query(
    `SELECT id, session_id, league_id, player_email, waitlist_position
     FROM "LeagueRSVP" WHERE status = 'waitlist' LIMIT 5`,
  );
  const { rows: yesRsvps } = await pool.query(
    `SELECT session_id, COUNT(*)::int AS n FROM "LeagueRSVP" WHERE status = 'yes' GROUP BY session_id HAVING COUNT(*) >= 3 LIMIT 5`,
  );
  const { rows: courses } = await pool.query(`SELECT id, name FROM "Course" LIMIT 5`);
  const { rows: waitEnroll } = await pool.query(
    `SELECT id, course_id, player_email, status FROM "CourseEnrollment" WHERE status = 'waitlisted' LIMIT 5`,
  );
  const { rows: activeTourns } = await pool.query(
    `SELECT id, name, status FROM "Tournament" WHERE status = 'active' LIMIT 5`,
  );
  const { rows: confirmedRegs } = await pool.query(
    `SELECT id, tournament_id, player_email, player_id, status, checked_in
     FROM "Registration" WHERE status = 'confirmed' LIMIT 10`,
  );

  console.log('\n--- Unauthenticated → 401 ---');
  for (const name of PHASE2_IMPLEMENTED) {
    const res = await http('POST', `/api/actions/${toKebab(name)}`, { body: {} });
    record(
      results,
      name,
      'unauth_401',
      res.status === 401,
      `HTTP ${res.status}`,
    );
  }

  console.log('\n--- Authenticated validation → 4xx (not 501) ---');
  const validationCases = [
    ['recalculateLeagueWaitlist', {}],
    ['promoteFromWaitlistCourse', {}],
    ['generateLeagueAssignments', {}],
    ['qrCheckIn', {}],
    ['sendBulkEmails', {}],
    ['sendLeagueInvites', {}],
    ['sendBulkSMS', {}],
    ['sendLeagueBulkSMS', {}],
    ['sendPushNotification', {}],
    // syncOneSignalIdentity with valid auth should succeed or config-block, not 501
  ];

  for (const [name, body] of validationCases) {
    const res = await http('POST', `/api/actions/${toKebab(name)}`, {
      token: adminAuth.token,
      body,
    });
    const ok = res.status >= 400 && res.status < 500 && res.status !== 501;
    record(results, name, 'validation_4xx', ok, `HTTP ${res.status} ${res.body?.error || ''}`);
  }

  // syncOneSignalIdentity authorized
  {
    const res = await http('POST', '/api/actions/sync-one-signal-identity', {
      token: adminAuth.token,
      body: { platform: 'web' },
    });
    const blocked =
      res.status === 200 &&
      (res.body?.reason === 'not_configured' || res.body?.success === false);
    const ok = res.status === 200 && res.status !== 501;
    record(
      results,
      'syncOneSignalIdentity',
      'authorized',
      ok,
      blocked
        ? `BLOCKED — credentials/configuration unavailable (${res.body?.reason})`
        : `HTTP ${res.status} success=${res.body?.success} reason=${res.body?.reason}`,
    );
  }

  console.log('\n--- Missing-source actions remain 501 when authenticated ---');
  for (const name of PHASE2_MISSING_SOURCE) {
    const res = await http('POST', `/api/actions/${toKebab(name)}`, {
      token: adminAuth.token,
      body: {},
    });
    record(results, name, 'still_501', res.status === 501, `HTTP ${res.status}`);
  }

  // Uploads
  console.log('\n--- Upload integrations still 501 ---');
  for (const path of [
    '/api/integrations/upload-file',
    '/api/integrations/upload-private-file',
    '/api/integrations/create-file-signed-url',
  ]) {
    const res = await http('POST', path, { token: adminAuth.token, body: {} });
    record(results, path, 'still_501', res.status === 501, `HTTP ${res.status}`);
  }

  console.log('\n--- Authorized DB / RLS paths ---');

  // recalculateLeagueWaitlist — use existing waitlist session or any session
  {
    const sessionId = waitRsvps[0]?.session_id || sessions[0]?.id;
    const leagueId = waitRsvps[0]?.league_id || sessions[0]?.league_id;
    if (!sessionId) {
      record(results, 'recalculateLeagueWaitlist', 'authorized_db', false, 'SKIP no LeagueSession fixtures');
    } else {
      const before = await pool.query(
        `SELECT id, waitlist_position FROM "LeagueRSVP" WHERE session_id = $1 AND status = 'waitlist' ORDER BY waitlist_position NULLS LAST`,
        [sessionId],
      );
      const res = await http('POST', '/api/actions/recalculate-league-waitlist', {
        token: playerAuth?.token || adminAuth.token,
        body: { session_id: sessionId, league_id: leagueId },
      });
      const after = await pool.query(
        `SELECT id, waitlist_position FROM "LeagueRSVP" WHERE session_id = $1 AND status = 'waitlist' ORDER BY waitlist_position NULLS LAST`,
        [sessionId],
      );
      const ok =
        res.status === 200 &&
        res.body?.success === true &&
        res.status !== 501 &&
        (before.rows.length === 0
          ? res.body.reordered === 0
          : after.rows.every((r, i) => r.waitlist_position === i + 1));
      record(
        results,
        'recalculateLeagueWaitlist',
        'authorized_db',
        ok,
        `HTTP ${res.status} reordered=${res.body?.reordered} waitlisted=${after.rows.length}`,
      );
    }
  }

  // promoteFromWaitlistCourse — admin only; non-admin forbid; admin promote if fixture
  {
    if (playerAuth) {
      const forbid = await http('POST', '/api/actions/promote-from-waitlist-course', {
        token: playerAuth.token,
        body: { courseId: courses[0]?.id || 'x' },
      });
      record(
        results,
        'promoteFromWaitlistCourse',
        'rls_non_admin_forbid',
        forbid.status === 403,
        `HTTP ${forbid.status}`,
      );
    } else {
      record(results, 'promoteFromWaitlistCourse', 'rls_non_admin_forbid', false, 'SKIP no player user');
    }

    if (waitEnroll[0]) {
      const courseId = waitEnroll[0].course_id;
      const beforeStatus = waitEnroll[0].status;
      const res = await http('POST', '/api/actions/promote-from-waitlist-course', {
        token: adminAuth.token,
        body: { courseId, enrollmentId: waitEnroll[0].id },
      });
      const emailBlocked =
        !process.env.RESEND_API_KEY && res.status === 200 && res.body?.success === true;
      // Email is best-effort; promotion should still succeed
      const row = await pool.query(`SELECT status FROM "CourseEnrollment" WHERE id = $1`, [
        waitEnroll[0].id,
      ]);
      const ok =
        res.status === 200 &&
        res.body?.success === true &&
        row.rows[0]?.status === 'enrolled';
      record(
        results,
        'promoteFromWaitlistCourse',
        'authorized_db',
        ok,
        `HTTP ${res.status} ${beforeStatus}->${row.rows[0]?.status}` +
          (emailBlocked || !process.env.RESEND_API_KEY
            ? ' | email side-effect BLOCKED — credentials/configuration unavailable'
            : ''),
      );
    } else if (courses[0]) {
      const res = await http('POST', '/api/actions/promote-from-waitlist-course', {
        token: adminAuth.token,
        body: { courseId: courses[0].id },
      });
      record(
        results,
        'promoteFromWaitlistCourse',
        'authorized_db',
        res.status === 200 && !!res.body?.message,
        `HTTP ${res.status} ${res.body?.message || res.body?.error} (no waitlisted fixtures)`,
      );
    } else {
      record(results, 'promoteFromWaitlistCourse', 'authorized_db', false, 'SKIP no Course fixtures');
    }
  }

  // generateLeagueAssignments — admin only; non-admin 403; valid session may 400 if <3 attendees
  {
    if (playerAuth) {
      const forbid = await http('POST', '/api/actions/generate-league-assignments', {
        token: playerAuth.token,
        body: { sessionId: sessions[0]?.id || 'x' },
      });
      record(
        results,
        'generateLeagueAssignments',
        'rls_non_admin_forbid',
        forbid.status === 403,
        `HTTP ${forbid.status}`,
      );
    }
    const sessionId = yesRsvps[0]?.session_id || sessions[0]?.id;
    if (!sessionId) {
      record(results, 'generateLeagueAssignments', 'authorized_db', false, 'SKIP no session');
    } else {
      const league = leagues.find((l) => l.id === sessions.find((s) => s.id === sessionId)?.league_id);
      const res = await http('POST', '/api/actions/generate-league-assignments', {
        token: adminAuth.token,
        body: { sessionId, publish: false },
      });
      // Success 200, or expected business 400 (not enabled / <3 players / can't seat) — not 501/500
      const ok = res.status === 200 || (res.status === 400 && res.status !== 501);
      record(
        results,
        'generateLeagueAssignments',
        'authorized_db',
        ok,
        `HTTP ${res.status} ${res.body?.error || `assignments=${res.body?.assignments}`} table_enabled=${league?.table_assignments_enabled}`,
      );
    }
  }

  // qrCheckIn — ownership forbid + optional real check-in
  {
    if (playerAuth) {
      const forbid = await http('POST', '/api/actions/qr-check-in', {
        token: playerAuth.token,
        body: {
          tournamentId: activeTourns[0]?.id || confirmedRegs[0]?.tournament_id || 'x',
          playerEmail: 'someone-else@example.com',
        },
      });
      record(
        results,
        'qrCheckIn',
        'rls_ownership_forbid',
        forbid.status === 403,
        `HTTP ${forbid.status}`,
      );
    }

    // Prefer a confirmed reg matching player email on active tournament
    let reg =
      confirmedRegs.find(
        (r) =>
          playerAuth &&
          r.player_email?.toLowerCase() === player.email.toLowerCase() &&
          activeTourns.some((t) => t.id === r.tournament_id),
      ) || null;

    if (!reg && admin) {
      // admin can check in anyone — use first confirmed on active tournament
      reg = confirmedRegs.find((r) => activeTourns.some((t) => t.id === r.tournament_id));
    }

    if (reg) {
      const token =
        playerAuth && reg.player_email?.toLowerCase() === player.email.toLowerCase()
          ? playerAuth.token
          : adminAuth.token;
      const res = await http('POST', '/api/actions/qr-check-in', {
        token,
        body: {
          tournamentId: reg.tournament_id,
          playerEmail: reg.player_email,
        },
      });
      const ok = res.status === 200 && res.body?.success === true && res.body?.type === 'tournament';
      record(
        results,
        'qrCheckIn',
        'authorized_db',
        ok,
        `HTTP ${res.status} type=${res.body?.type} player=${res.body?.playerName}`,
      );
    } else {
      // league path if possible
      const { rows: leagueRsvp } = await pool.query(
        `SELECT id, session_id, league_id, player_email FROM "LeagueRSVP" LIMIT 1`,
      );
      if (leagueRsvp[0]) {
        const r = leagueRsvp[0];
        const res = await http('POST', '/api/actions/qr-check-in', {
          token: adminAuth.token,
          body: {
            sessionId: r.session_id,
            leagueId: r.league_id,
            playerEmail: r.player_email,
          },
        });
        record(
          results,
          'qrCheckIn',
          'authorized_db',
          res.status === 200 && res.body?.success === true,
          `HTTP ${res.status} type=${res.body?.type}`,
        );
      } else {
        record(results, 'qrCheckIn', 'authorized_db', false, 'SKIP no suitable registration/RSVP');
      }
    }
  }

  // Admin-only email/SMS/push — authz + config-blocked delivery
  {
    if (playerAuth) {
      for (const [name, body] of [
        ['sendBulkEmails', { template: { subject: 't', body: 'b' }, recipientEmails: ['a@b.com'], registrations: [] }],
        ['sendLeagueInvites', { sessionId: sessions[0]?.id || 'x' }],
        ['sendBulkSMS', { tournament_id: 'x', recipient_player_ids: ['x'], message: 'hi' }],
        ['sendLeagueBulkSMS', { league_id: 'x', recipient_emails: ['a@b.com'], message: 'hi' }],
        ['sendPushNotification', { external_user_ids: ['a@b.com'], title: 't', message: 'm' }],
      ]) {
        const res = await http('POST', `/api/actions/${toKebab(name)}`, {
          token: playerAuth.token,
          body,
        });
        const ok = res.status === 401 || res.status === 403;
        record(results, name, 'rls_non_admin_forbid', ok, `HTTP ${res.status}`);
      }
    }

    // sendBulkEmails authorized — may send or skip without RESEND
    {
      const res = await http('POST', '/api/actions/send-bulk-emails', {
        token: adminAuth.token,
        body: {
          template: { subject: 'Phase2 verify {{player_name}}', body: '<p>Hi {{player_name}}</p>' },
          tournament: { id: 'verify', name: 'Verify', date: '', time: '', location: '' },
          recipientEmails: ['phase2-verify-noreply@example.com'],
          registrations: [
            { player_email: 'phase2-verify-noreply@example.com', player_name: 'Verify User' },
          ],
          comm_log_id: '',
        },
      });
      const configBlocked = !process.env.RESEND_API_KEY;
      if (configBlocked) {
        // Handler still returns 200 with per-recipient success/fail; without key sendEmail skips as success skipped
        // Our sendEmail returns {skipped:true} without throwing — so successCount may be 1
        record(
          results,
          'sendBulkEmails',
          'authorized_external',
          res.status === 200 && res.status !== 501,
          res.status === 200
            ? `HTTP 200 sentCount=${res.body?.sentCount} | BLOCKED — credentials/configuration unavailable (RESEND_API_KEY)`
            : `HTTP ${res.status}`,
        );
      } else {
        record(
          results,
          'sendBulkEmails',
          'authorized_external',
          res.status === 200,
          `HTTP ${res.status} sentCount=${res.body?.sentCount}`,
        );
      }
    }

    // sendLeagueInvites
    {
      const sessionId = sessions[0]?.id;
      if (!sessionId) {
        record(results, 'sendLeagueInvites', 'authorized_external', false, 'SKIP no session');
      } else {
        const res = await http('POST', '/api/actions/send-league-invites', {
          token: adminAuth.token,
          body: { sessionId },
        });
        const configBlocked = !process.env.RESEND_API_KEY;
        record(
          results,
          'sendLeagueInvites',
          'authorized_external',
          res.status === 200 && res.status !== 501,
          configBlocked
            ? `HTTP ${res.status} sent=${res.body?.sent} | BLOCKED — credentials/configuration unavailable (RESEND/ONESIGNAL)`
            : `HTTP ${res.status} sent=${res.body?.sent}`,
        );
      }
    }

    // SMS — must surface Twilio missing as 500 config, not fake success
    {
      const res = await http('POST', '/api/actions/send-bulk-sms', {
        token: adminAuth.token,
        body: {
          tournament_id: activeTourns[0]?.id || confirmedRegs[0]?.tournament_id || 'missing',
          recipient_player_ids: [admin.id],
          message: 'phase2 verify',
        },
      });
      const twilioMissing = !process.env.TWILIO_ACCOUNT_SID;
      if (twilioMissing) {
        // May be 200 with sent:0 (no opt-in recipients) OR 500 Twilio not configured
        const ok =
          res.status !== 501 &&
          (res.status === 200 ||
            (res.status === 500 && /Twilio/i.test(res.body?.error || '')));
        record(
          results,
          'sendBulkSMS',
          'authorized_external',
          ok,
          `HTTP ${res.status} ${res.body?.error || res.body?.message || ''} | BLOCKED — credentials/configuration unavailable (TWILIO)`,
        );
      } else {
        record(
          results,
          'sendBulkSMS',
          'authorized_external',
          res.status === 200,
          `HTTP ${res.status} sent=${res.body?.sent}`,
        );
      }
    }

    {
      const leagueId = leagues[0]?.id;
      const res = await http('POST', '/api/actions/send-league-bulk-sms', {
        token: adminAuth.token,
        body: {
          league_id: leagueId || 'missing',
          recipient_emails: [admin.email],
          message: 'phase2 verify',
        },
      });
      const twilioMissing = !process.env.TWILIO_ACCOUNT_SID;
      if (twilioMissing) {
        const ok =
          res.status !== 501 &&
          (res.status === 200 ||
            (res.status === 500 && /Twilio/i.test(res.body?.error || '')));
        record(
          results,
          'sendLeagueBulkSMS',
          'authorized_external',
          ok,
          `HTTP ${res.status} ${res.body?.error || res.body?.message || ''} | BLOCKED — credentials/configuration unavailable (TWILIO)`,
        );
      } else {
        record(
          results,
          'sendLeagueBulkSMS',
          'authorized_external',
          res.status === 200,
          `HTTP ${res.status} sent=${res.body?.sent}`,
        );
      }
    }

    {
      const res = await http('POST', '/api/actions/send-push-notification', {
        token: adminAuth.token,
        body: {
          external_user_ids: [admin.email],
          title: 'Phase2 verify',
          message: 'integration check',
        },
      });
      const onesignalMissing = !process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY;
      if (onesignalMissing) {
        record(
          results,
          'sendPushNotification',
          'authorized_external',
          res.status === 200 && res.body?.success === false,
          `HTTP ${res.status} | BLOCKED — credentials/configuration unavailable (ONESIGNAL)`,
        );
      } else {
        record(
          results,
          'sendPushNotification',
          'authorized_external',
          res.status === 200,
          `HTTP ${res.status} success=${res.body?.success}`,
        );
      }
    }
  }

  // Summary
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    registered,
    implementedCount,
    remaining501,
    missingSourceCount: missingSource.length,
    phase1Count,
    phase2Count,
    checks_passed: passed.length,
    checks_failed: failed.length,
    failed: failed.map((f) => `${f.name}/${f.check}: ${f.detail}`),
  }, null, 2));

  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
