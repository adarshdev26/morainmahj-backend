/**
 * Phase 6 — Final migration HTTP verification.
 *
 * GET /api/actions returns each action with a FULL path already prefixed:
 *   { path: "/api/actions/assign-league-substitute", ... }
 *
 * Helpers must NOT prepend /api/actions/ again (that produced
 * /api/actions//api/actions/... 404s in earlier ad-hoc checks).
 *
 * Usage: node scripts/phase6-migration-verify.js
 * Requires backend on BASE_URL (default http://localhost:3000).
 */
const http = require('http');
const https = require('https');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function request(method, urlPath, { body } = {}) {
  const url = new URL(urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? null : JSON.stringify(body);
  const headers = { Accept: 'application/json' };
  if (payload != null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, body: json, text });
        });
      },
    );
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

/** Normalize registry path to a single absolute /api/actions/... URL path. */
function normalizeActionPath(action) {
  const raw = action?.path || action?.name || '';
  if (typeof raw !== 'string' || !raw) {
    throw new Error(`Action missing path/name: ${JSON.stringify(action)}`);
  }
  if (raw.startsWith('/api/actions/')) return raw;
  if (raw.startsWith('api/actions/')) return `/${raw}`;
  // kebab segment only
  const kebab = raw.includes('/')
    ? raw.replace(/^\/+/, '')
    : String(action.name || raw).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  if (kebab.startsWith('api/actions/')) return `/${kebab}`;
  return `/api/actions/${kebab.replace(/^\/+/, '')}`;
}

async function main() {
  const failures = [];
  const log = (msg) => console.log(msg);

  log(`Base URL: ${BASE}`);

  const health = await request('GET', '/api/health');
  log(`GET /api/health → ${health.status}`);
  if (health.status !== 200) failures.push('health not 200');

  const entities = await request('GET', '/api/entities');
  const functions = await request('GET', '/api/functions');
  log(`GET /api/entities → ${entities.status} (expected 404)`);
  log(`GET /api/functions → ${functions.status} (expected 404)`);
  if (entities.status !== 404) failures.push('/api/entities not 404');
  if (functions.status !== 404) failures.push('/api/functions not 404');

  const list = await request('GET', '/api/actions');
  log(`GET /api/actions → ${list.status}`);
  if (list.status !== 200) {
    failures.push('actions list not 200');
    throw new Error('Cannot continue without /api/actions');
  }

  const actions = list.body?.actions || [];
  const ported = actions.filter((a) => a.ported).length;
  const unported = actions.filter((a) => !a.ported).length;
  log(`Registered: ${actions.length}  Implemented(ported): ${ported}  remaining501(list): ${unported}`);

  if (actions.length !== 66) failures.push(`registered=${actions.length} expected 66`);
  if (ported !== 66) failures.push(`ported=${ported} expected 66`);
  if (unported !== 0) failures.push(`unported=${unported}`);

  // Demonstrate path normalization (would have been the double-prefix bug)
  const sample = actions[0];
  const normalized = normalizeActionPath(sample);
  const naiveDouble = `/api/actions/${sample.path}`;
  log(`Sample registry path field: ${sample.path}`);
  log(`Normalized URL path:        ${normalized}`);
  log(`Naive double-prefix would:  ${naiveDouble} (MUST NOT be used)`);
  if (normalized !== sample.path && !sample.path.startsWith('/api/actions/')) {
    // ok if registry ever returns kebab only
  }
  if (naiveDouble.includes('/api/actions//api/actions') || naiveDouble.startsWith('/api/actions//api')) {
    log('Confirmed: naive prepend creates malformed double-prefix URL');
  } else if (sample.path.startsWith('/api/actions/') && naiveDouble === `/api/actions/${sample.path}`) {
    log('Confirmed: registry path already includes /api/actions/ — naive prepend duplicates prefix');
  }

  const histogram = {};
  let count501 = 0;
  const rows = [];

  for (const action of actions) {
    const path = normalizeActionPath(action);
    // Guard: never hit double-prefix
    if (path.includes('/api/actions/api/actions') || path.includes('/api/actions//api')) {
      failures.push(`malformed path for ${action.name}: ${path}`);
      continue;
    }
    const res = await request('POST', path, { body: {} });
    histogram[res.status] = (histogram[res.status] || 0) + 1;
    if (res.status === 501) {
      count501 += 1;
      failures.push(`501 from ${action.name}`);
    }
    const expectedPublic = !!action.public;
    if (expectedPublic) {
      if (res.status !== 400 && res.status !== 404) {
        // empty body → usually 400 validation; some public may 404
        failures.push(`public ${action.name} unexpected ${res.status} (want 400/404)`);
      }
    } else if (res.status !== 401) {
      failures.push(`protected ${action.name} expected 401 got ${res.status}`);
    }
    rows.push(`${action.name}\t${path}\t${res.status}\tpublic=${!!action.public}`);
  }

  log('--- Per-action (unauthenticated POST {}) ---');
  for (const row of rows) log(row);

  log('--- Status histogram ---');
  for (const [code, n] of Object.entries(histogram).sort()) log(`${code}: ${n}`);
  log(`Actual remaining 501 endpoints: ${count501}`);

  // Public website slug checks
  const publicSites = [
    'get-public-tournament-website',
    'get-public-league-website',
    'get-public-course-website',
  ];
  for (const kebab of publicSites) {
    const path = `/api/actions/${kebab}`;
    const missing = await request('POST', path, { body: {} });
    const bad = await request('POST', path, { body: { slug: '__phase6_no_such_slug__' } });
    log(`${kebab} missing slug → ${missing.status} (expect 400)`);
    log(`${kebab} bad slug → ${bad.status} (expect 404)`);
    if (missing.status !== 400) failures.push(`${kebab} missing slug → ${missing.status}`);
    if (bad.status !== 404) failures.push(`${kebab} bad slug → ${bad.status}`);
  }

  log('--- Summary ---');
  if (failures.length) {
    log('FAILURES:');
    for (const f of failures) log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    log('PASS: path normalization OK; 66/66 ported; 0×501; auth/public expectations met');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
