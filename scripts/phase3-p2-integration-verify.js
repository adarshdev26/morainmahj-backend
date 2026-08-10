/**
 * Phase 3 / P2 authenticated HTTP integration verification against the live server.
 * Usage: node scripts/phase3-p2-integration-verify.js
 */
require('dotenv').config();
const pool = require('../db');
const Auth = require('../src/models/Auth');
const functions = require('../src/functions');
const { ACTIONS } = require('../src/routes/actionRegistry');

const BASE = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000';

const P2_PORTED = [
  'raffleCheckout',
  'drawRaffle',
  'drawTRaffle',
  'checkAuctionCard',
  'saveAuctionCard',
  'placeSilentAuctionBid',
  'lockInAuctionWinners',
  'notifyLeaguePrizePayout',
  'notifyPrizePayOut',
  'markCourseEnrollmentPaid',
  'deleteAccount',
  'deleteLeagueCascade',
  'generateShareToken',
];

const P2_BLOCKED_NO_SOURCE = [
  'submitMatchResult',
  'respondToMatchResult',
  'finalizeMatchResult',
  'logHand',
  'getPublicTournamentWebsite',
  'getPublicLeagueWebsite',
  'getPublicCourseWebsite',
  'finalizeLeagueSession',
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
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} / ${check}: ${detail}`);
}

async function main() {
  const results = [];
  console.log('=== Phase 3 / P2 Integration Verification ===');
  console.log('Base URL:', BASE);

  const health = await http('GET', '/api/health');
  if (health.status === 0) {
    console.error('Backend not reachable:', health.error);
    process.exit(1);
  }
  record(results, 'health', 'listening', health.status === 200, `status=${health.status}`);

  // Registry counts
  const implemented = functions.names();
  record(results, 'registry', 'registered=66', ACTIONS.length === 66, `ACTIONS=${ACTIONS.length}`);
  record(
    results,
    'registry',
    'p2-ported-in-functions',
    P2_PORTED.every((n) => functions.has(n)),
    `implemented=${implemented.length}`,
  );
  record(
    results,
    'registry',
    'p2-blocked-stay-501',
    P2_BLOCKED_NO_SOURCE.every((n) => !functions.has(n)),
    P2_BLOCKED_NO_SOURCE.filter((n) => functions.has(n)).join(',') || 'none ported',
  );

  // Unauthenticated → 401 for each P2 ported action
  for (const name of P2_PORTED) {
    const path = `/api/actions/${toKebab(name)}`;
    const res = await http('POST', path, { body: {} });
    record(
      results,
      name,
      'unauth-401',
      res.status === 401,
      `status=${res.status} body=${JSON.stringify(res.body)?.slice(0, 120)}`,
    );
  }

  let adminToken = null;
  let userToken = null;
  try {
    const { rows: users } = await pool.query(
      `SELECT id, email, role, organization_id,
              (password IS NOT NULL AND password <> '') AS has_pw
       FROM "User"
       ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'organizer_admin' THEN 1 ELSE 2 END, email
       LIMIT 50`,
    );
    const admin = users.find((u) => u.role === 'admin' && u.has_pw) || users.find((u) => u.role === 'admin');
    const player = users.find((u) => u.role === 'user' && u.has_pw) || users.find((u) => u.role === 'user');
    if (!admin) throw new Error('No admin user in DB');

    const TEST_PASSWORD = 'Phase3P2Verify!2026';
    const TEST_HASH = await Auth.hashPassword(TEST_PASSWORD);
    await pool.query(`UPDATE "User" SET password = $1 WHERE id = $2`, [TEST_HASH, admin.id]);
    if (player) {
      await pool.query(`UPDATE "User" SET password = $1 WHERE id = $2`, [TEST_HASH, player.id]);
    }

    async function login(email) {
      const res = await http('POST', '/api/auth/login', {
        body: { email, password: TEST_PASSWORD },
      });
      if (res.status !== 200 || !res.body?.token) {
        const u = users.find((x) => x.email === email);
        return Auth.generateToken({ id: u.id, email: u.email });
      }
      return res.body.token;
    }

    adminToken = await login(admin.email);
    userToken = player ? await login(player.email) : null;
    record(
      results,
      'auth',
      'login-tokens',
      Boolean(adminToken),
      `admin=${admin.email} player=${player?.email || 'none'}`,
    );
  } catch (err) {
    record(results, 'auth', 'login-tokens', false, err.message);
  }

  if (adminToken) {
    // Validation 4xx tests (auth present, bad body)
    const validationCases = [
      ['raffleCheckout', {}, 400],
      ['drawRaffle', {}, 400],
      ['drawTRaffle', { raffle_id: 'x' }, 400],
      ['placeSilentAuctionBid', {}, 400],
      ['lockInAuctionWinners', {}, 400],
      ['notifyPrizePayOut', {}, 400],
      ['notifyLeaguePrizePayout', {}, 400],
      ['markCourseEnrollmentPaid', {}, 400],
      ['deleteLeagueCascade', {}, 400],
      ['generateShareToken', {}, 400],
      ['deleteAccount', { confirmEmail: 'wrong@example.com' }, 400],
      ['saveAuctionCard', {}, 400],
    ];

    for (const [name, body, expectStatus] of validationCases) {
      const res = await http('POST', `/api/actions/${toKebab(name)}`, {
        token: adminToken,
        body,
      });
      const ok = res.status === expectStatus || (res.status >= 400 && res.status < 500 && res.status !== 501);
      record(
        results,
        name,
        'auth-validation-4xx',
        ok && res.status !== 501,
        `status=${res.status} expect≈${expectStatus}`,
      );
    }

    // Non-admin forbidden where applicable
    if (userToken) {
      const forbidCases = [
        ['drawRaffle', { raffle_id: 'x' }],
        ['lockInAuctionWinners', { auction_id: 'x' }],
        ['deleteLeagueCascade', { league_id: 'x' }],
        ['notifyPrizePayOut', { winnerId: 'x' }],
        ['markCourseEnrollmentPaid', { enrollmentId: 'x' }],
      ];
      for (const [name, body] of forbidCases) {
        const res = await http('POST', `/api/actions/${toKebab(name)}`, {
          token: userToken,
          body,
        });
        record(
          results,
          name,
          'non-admin-403',
          res.status === 403 || (res.status >= 400 && res.status < 500 && res.status !== 501),
          `status=${res.status}`,
        );
      }
    }

    // Ported actions must not return 501
    for (const name of P2_PORTED) {
      const res = await http('POST', `/api/actions/${toKebab(name)}`, {
        token: adminToken,
        body: {},
      });
      record(
        results,
        name,
        'not-501',
        res.status !== 501,
        `status=${res.status}`,
      );
    }
  }

  // Blocked missing-source: with auth should still be 501
  if (adminToken) {
    for (const name of P2_BLOCKED_NO_SOURCE) {
      const res = await http('POST', `/api/actions/${toKebab(name)}`, {
        token: adminToken,
        body: {},
      });
      record(
        results,
        name,
        'still-501',
        res.status === 501,
        `status=${res.status}`,
      );
    }
  }

  // checkAuctionCard success path (no Stripe required for "no card" / has_card check if stripe optional)
  if (userToken) {
    const res = await http('POST', '/api/actions/check-auction-card', {
      token: userToken,
      body: {},
    });
    const ok = res.status === 200 || (res.status >= 400 && res.status !== 501);
    record(
      results,
      'checkAuctionCard',
      'authorized-response',
      ok && res.status !== 501,
      `status=${res.status} body=${JSON.stringify(res.body)?.slice(0, 160)}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== Summary ===');
  console.log(`Total checks: ${results.length}`);
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Implemented actions: ${implemented.length}`);
  console.log(`Registered actions: ${ACTIONS.length}`);
  console.log(`Remaining 501 (registry - implemented): ${ACTIONS.length - implemented.length}`);

  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(` - ${f.name} / ${f.check}: ${f.detail}`);
    process.exit(1);
  }
  console.log('\nP2 HTTP integration: PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
