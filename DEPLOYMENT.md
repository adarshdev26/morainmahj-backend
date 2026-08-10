# Deploying morainmahj to AWS EC2

One EC2 instance runs everything: Postgres, the Express API under PM2, and Nginx
serving the React build. Nginx answers `/` with the compiled frontend and
forwards `/api/*` to Express on `127.0.0.1:3000`.

```
            ┌─────────────────────── EC2 (Ubuntu 24.04) ───────────────────────┐
 browser ──▶│ Nginx :443/:80                                                   │
 mobile  ──▶│   /        → /var/www/morainmahj-frontend  (vite build output)    │
            │   /api/*   → 127.0.0.1:3000  (PM2 → server.js)                    │
            │                                    └──▶ Postgres on localhost:5432│
            └──────────────────────────────────────────────────────────────────┘
```

Everything below assumes Ubuntu 24.04 LTS. Commands prefixed `local$` run on your
Windows machine; `ec2$` run over SSH on the instance.

---

## Before you start: two things that will bite you

**1. The backend's `src/` tree was never committed.** The GitHub Actions workflow
deploys whatever is on `main`, and until the commit that accompanies this file,
`main` contained only the old single-file `server.js`. Push before you deploy or
you will ship a backend with no routes, no auth middleware, and no functions.

**2. Only 8 of 108 legacy platform server functions are ported.** The frontend calls 59 by
name and 51 of those have no implementation, so they answer 501 from
`/api/functions/:name` with the list of names that do exist. Deploying now gets you a live site with working login,
entity CRUD, and public leaderboards; checkout, invites, bulk email/SMS, push
notifications, league assignment, raffles, and silent auctions will fail until
those functions are ported. See [Known gaps](#known-gaps) for the full list.

Deploying first is still worth it — it gives you a real environment to port
against — but do not point users at it yet.

---

## Step 1 — Verify locally first

Get a green run on your machine before touching AWS. Failures here are much
cheaper to diagnose.

```powershell
local$ cd e:\aws\morainmahj-backend
local$ npm install
local$ npm test
local$ npm start
```

In another terminal:

```powershell
local$ curl http://localhost:3000/api/health
```

You want `{"status":"Server is running","database":"Connected",...}`. If the
database line errors, fix `.env` before continuing — the same values move to the
server later.

Then the frontend, pointed at that local API:

```powershell
local$ cd e:\aws\morain-mahj
local$ npm run dev
```

Log in through the UI. Confirm the dashboard loads and the browser devtools
Network tab shows calls to `localhost:5173/api/...` returning 200. This proves
the `API client` shim and your JWT auth work end to end.

Those calls are same-origin because the frontend `.env` leaves `VITE_API_URL`
empty and the dev server proxies `/api` to port 3000 (`VITE_DEV_API_PROXY`).
That mirrors the Nginx setup below, so you should see no `OPTIONS` preflight
requests locally either — if you do, an absolute `VITE_API_URL` is still set.

---

## Step 2 — Launch the EC2 instance

In the AWS console, EC2 → Instances → **Launch instances**:

| Setting | Value |
| --- | --- |
| Name | `morainmahj-prod` |
| AMI | Ubuntu Server 24.04 LTS (64-bit x86) |
| Instance type | `t3.small` |
| Key pair | Create new, RSA, `.pem`. Download and keep it safe. |
| Storage | 30 GB gp3 |

`t3.small` (2 GB RAM) rather than `t3.micro`: Postgres, Node, and Nginx on one
1 GB box will start OOM-killing Postgres under load.

Create a security group with three inbound rules:

| Type | Port | Source | Why |
| --- | --- | --- | --- |
| SSH | 22 | My IP | Admin access. Never `0.0.0.0/0`. |
| HTTP | 80 | `0.0.0.0/0` | Site traffic + certbot's HTTP-01 challenge. |
| HTTPS | 443 | `0.0.0.0/0` | Site traffic. |

Do **not** open 5432 or 3000. Postgres and Express are reached over localhost
only. Then allocate an **Elastic IP** (EC2 → Elastic IPs → Allocate → Associate
with the instance) so a reboot doesn't change your public IP and break DNS.

Connect:

```powershell
local$ icacls morainmahj.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
local$ ssh -i morainmahj.pem ubuntu@<ELASTIC_IP>
```

That `icacls` line is required on Windows — OpenSSH refuses a key file that other
users can read.

---

## Step 3 — Install Node, Nginx, PM2, and Postgres

```bash
ec2$ sudo apt update && sudo apt upgrade -y

# Node 20 LTS. The distro's nodejs package is too old for Express 5.
ec2$ curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
ec2$ sudo apt install -y nodejs

ec2$ sudo apt install -y nginx postgresql postgresql-contrib git
ec2$ sudo npm install -g pm2

ec2$ node -v && nginx -v && psql --version && pm2 -v
```

Create the directories the PM2 and Nginx configs expect:

```bash
ec2$ sudo mkdir -p /var/www /var/log/morainmahj
ec2$ sudo chown -R ubuntu:ubuntu /var/www /var/log/morainmahj
```

Make PM2 survive reboots:

```bash
ec2$ pm2 startup systemd
# Run the sudo command it prints, then continue.
```

---

## Step 4 — Move Postgres onto this instance

Your database currently lives on the old server at `32.199.183.126`. Dump it
there and restore here.

On the old server (or from your machine, if you can reach it):

```bash
old$ pg_dump -h 32.199.183.126 -U <old_user> -d morainmahj_db \
      --no-owner --no-privileges -Fc -f morainmahj.dump
```

`-Fc` is the compressed custom format, which restores faster and lets you filter
tables if a single one fails. `--no-owner --no-privileges` avoids errors about
roles that will not exist on the new box.

Copy it over:

```powershell
local$ scp -i morainmahj.pem morainmahj.dump ubuntu@<ELASTIC_IP>:~/
```

Create the role and database, then restore:

```bash
ec2$ sudo -u postgres psql
postgres=# CREATE USER morainmahj WITH PASSWORD 'a-long-random-password';
postgres=# CREATE DATABASE morainmahj_db OWNER morainmahj;
postgres=# \q

ec2$ sudo -u postgres pg_restore -d morainmahj_db --no-owner --role=morainmahj ~/morainmahj.dump
```

A few `pg_restore` warnings about extensions or comments are normal. Errors
mentioning missing tables are not — stop and read them.

Verify the data actually arrived, rather than assuming:

```bash
ec2$ psql -h localhost -U morainmahj -d morainmahj_db -c \
  'SELECT (SELECT COUNT(*) FROM "User") AS users, (SELECT COUNT(*) FROM "Tournament") AS tournaments, (SELECT COUNT(*) FROM "League") AS leagues;'
```

Compare those counts against the old server before moving on. Once you are
satisfied, delete the dump — it contains every user record:

```bash
ec2$ shred -u ~/morainmahj.dump
```

---

## Step 5 — Deploy the backend

Push your local work first, if you haven't:

```powershell
local$ cd e:\aws\morainmahj-backend
local$ git push origin main
```

Clone and configure on the server:

```bash
ec2$ cd /var/www
ec2$ git clone https://github.com/adarshdev26/morainmahj-backend.git
ec2$ cd morainmahj-backend
ec2$ npm ci --omit=dev
ec2$ cp .env.example .env
ec2$ nano .env
```

Fill in `.env`:

```ini
PORT=3000
NODE_ENV=production
HOST=127.0.0.1

DB_HOST=localhost
DB_PORT=5432
DB_USER=morainmahj
DB_PASSWORD=a-long-random-password
DB_NAME=morainmahj_db

JWT_SECRET=<paste the generated value>

CORS_ORIGINS=https://morainmahj.com,https://www.morainmahj.com,capacitor://localhost,http://localhost
```

Generate the JWT secret on the server and paste it in:

```bash
ec2$ node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use a **different** secret than your local one. Changing it later logs every user
out, so set it once and back it up somewhere safe.

The `CORS_ORIGINS` entries matter for mobile: iOS Capacitor requests originate
from `capacitor://localhost` and Android from `http://localhost`. Omit them and
every mobile request fails preflight even though the website works.

Lock down the env file, apply migrations, and start:

```bash
ec2$ chmod 600 .env
ec2$ npm run migrate
ec2$ pm2 start ecosystem.config.js --env production
ec2$ pm2 save
ec2$ pm2 logs morainmahj-api --lines 30
ec2$ curl http://127.0.0.1:3000/api/health
```

---

## Step 6 — Configure Nginx

```bash
ec2$ cd /var/www/morainmahj-backend
ec2$ sudo cp deploy/nginx/morainmahj.conf /etc/nginx/sites-available/morainmahj
ec2$ sudo nano /etc/nginx/sites-available/morainmahj   # set server_name to your domain
ec2$ sudo ln -s /etc/nginx/sites-available/morainmahj /etc/nginx/sites-enabled/
ec2$ sudo rm -f /etc/nginx/sites-enabled/default
ec2$ sudo nginx -t && sudo systemctl reload nginx
```

Removing the `default` site is necessary — otherwise it keeps answering on port
80 and you will get the Nginx welcome page instead of your app.

Confirm the proxy works from outside:

```powershell
local$ curl http://<ELASTIC_IP>/api/health
```

---

## Step 7 — Build and deploy the frontend

Build locally. `vite build` on this dependency set (three.js, pdfjs-dist,
recharts) needs more memory than a small instance has to spare, and a build that
gets OOM-killed leaves a partial `dist/` that Nginx will happily serve.

Point the build at your production domain first. Create
`e:\aws\morain-mahj\.env.production`:

```ini
VITE_API_URL=https://morainmahj.com
REACT_APP_API_URL=https://morainmahj.com
VITE_AUTH_ROOT_REDIRECT=true
```

Use the full origin rather than leaving it blank. The website would work either
way, but the Capacitor builds resolve a relative URL against the device itself,
so mobile would break. One build output then serves web and mobile both.

These values are inlined at build time. Changing the API URL always means
rebuild plus redeploy, never just a server restart.

```powershell
local$ cd e:\aws\morain-mahj
local$ npm run build
local$ tar -czf frontend-dist.tar.gz dist
local$ scp -i morainmahj.pem frontend-dist.tar.gz ubuntu@<ELASTIC_IP>:~/
```

Install it:

```bash
ec2$ chmod +x /var/www/morainmahj-backend/deploy/install-frontend.sh
ec2$ /var/www/morainmahj-backend/deploy/install-frontend.sh ~/frontend-dist.tar.gz
```

The script stages the extract, swaps directories with `mv`, and keeps the
previous build at `/var/www/morainmahj-frontend.old`, so Nginx never serves a
half-written directory and rollback is one `mv`.

Visit `http://<ELASTIC_IP>` — the React app should load and you should be able to
log in.

---

## Step 8 — Point DNS at the instance, then issue the certificate

Add two DNS A records at your registrar, both to the Elastic IP:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `<ELASTIC_IP>` |
| A | `www` | `<ELASTIC_IP>` |

Wait for propagation before running certbot; the HTTP-01 challenge needs the
domain to already resolve here, and failed attempts count against Let's Encrypt
rate limits.

```bash
ec2$ dig +short morainmahj.com     # must print your Elastic IP
ec2$ sudo apt install -y certbot python3-certbot-nginx
ec2$ sudo certbot --nginx -d morainmahj.com -d www.morainmahj.com
```

Choose the redirect-HTTP-to-HTTPS option. Certbot edits the site file in place,
adding the `listen 443 ssl` block, the certificate paths, and the port-80
redirect. This is why the checked-in config ships HTTP-only — a hand-written TLS
block referencing a certificate that does not exist yet makes Nginx fail to
reload and the challenge fail with it.

Renewal is installed automatically as a systemd timer. Verify it:

```bash
ec2$ sudo certbot renew --dry-run
ec2$ systemctl list-timers | grep certbot
```

Now that HTTPS is live, rebuild the frontend if you had been testing against the
bare IP, and redeploy per step 7.

---

## Step 9 — Turn on automatic deploys

`.github/workflows/deploy.yml` SSHes in on every push to `main` and runs
`~/deploy.sh`. Install that script:

```bash
ec2$ cp /var/www/morainmahj-backend/deploy/deploy.sh ~/deploy.sh
ec2$ chmod +x ~/deploy.sh
ec2$ ~/deploy.sh          # dry run against the current commit
```

It pulls `main`, runs `npm ci --omit=dev`, reloads PM2, then polls
`/api/health`. If health checks keep failing it resets to the previous commit,
reinstalls, and restarts — so a bad push degrades to a rollback rather than an
outage. It also aborts if the server's working tree is dirty, which is usually
someone's un-pushed hotfix.

Migrations are deliberately not automatic. Set `RUN_MIGRATIONS=1` when you want
them, or run `npm run migrate` by hand after reviewing the SQL.

In the GitHub repo, Settings → Secrets and variables → Actions, set:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | Your Elastic IP |
| `SSH_USER` | `ubuntu` |
| `SSH_PRIVATE_KEY` | Full contents of `morainmahj.pem`, including BEGIN/END lines |

Frontend deploys stay manual (step 7), since the build happens on your machine.

---

## Verification checklist

```bash
ec2$ pm2 status                      # morainmahj-api online, restarts not climbing
ec2$ sudo systemctl status nginx     # active (running)
ec2$ sudo systemctl status postgresql
```

```powershell
local$ curl https://morainmahj.com/api/health          # database: Connected
local$ curl https://morainmahj.com/                    # React index.html
local$ curl -I http://morainmahj.com/                  # 301 to https
local$ curl -i https://morainmahj.com/api/entities/Tournament   # 401 without a token
```

That last one should be `401`, not `500` — it proves auth middleware is active
rather than erroring. Then in a browser: log in, load the dashboard, hard-refresh
on a nested route like `/admin/players` to confirm the SPA fallback works, and
check that a public leaderboard renders without a session.

---

## Known gaps

These are unrelated to deployment; they are unfinished migration work.

**51 server functions the frontend calls but the backend does not implement.**
Ported so far: `getDemoTournamentForUser`, `getLeagueRoster`,
`getPlayerRepository`, `getPublicLeaderboard`, `getPublicLeagueLeaderboard`,
`getRaffleAllocations`, `getTournamentPlayerNames`, `logDataAccess`.

Missing, grouped by the feature that breaks:

| Area | Functions |
| --- | --- |
| Payments / Stripe | `stripeCheckout`, `leagueCheckout`, `courseCheckout`, `raffleCheckout`, `confirmRegistration`, `confirmLeaguePayment`, `verifyTournamentPayment`, `verifySubscriptionPayment`, `createSubscriptionCheckout`, `createBillingPortal`, `cancelSubscription`, `startTrial`, `processLeagueRefund`, `markLeagueMemberPaid`, `markCourseEnrollmentPaid` |
| Notifications | `sendBulkEmails`, `sendBulkSMS`, `sendLeagueBulkSMS`, `sendLeagueInvites`, `sendPushNotification`, `syncOneSignalIdentity`, `notifyTournamentRegistration`, `notifyCourseEnrollment`, `notifyLeaguePrizePayout`, `notifyPrizePayOut` |
| Leagues | `generateLeagueAssignments`, `finalizeLeagueSession`, `assignLeagueSubstitute`, `requestLeagueSubstitute`, `recalculateLeagueWaitlist`, `createLeagueWalkIn`, `deleteLeagueCascade`, `leagueJoin`, `promoteFromWaitlistCourse` |
| Auctions / raffles | `checkAuctionCard`, `saveAuctionCard`, `placeSilentAuctionBid`, `lockInAuctionWinners`, `drawRaffle`, `drawTRaffle` |
| Matches / play | `submitMatchResult`, `respondToMatchResult`, `finalizeMatchResult`, `logHand`, `qrCheckIn` |
| Public pages | `getPublicTournamentWebsite`, `getPublicLeagueWebsite`, `getPublicCourseWebsite` |
| Onboarding | `invitePlayer`, `selfRegister`, `generateShareToken` |

The originals are at `backend function modules`. To port one,
add `src/functions/<name>.js` exporting `async (ctx, body) => result` and
register it in `src/functions/index.js`; set `fn.public = true` only for
endpoints legacy platform also served unauthenticated.

**Three platform features are stubbed** in `morain-mahj/src/api/API client`
and reject with `NotPortedError`: file uploads (needs S3 plus presigned URLs),
outbound email (needs SES or similar), and realtime `subscribe()` (currently a
no-op, so screens load data but never live-update). Self-service registration,
password reset, and email verification are also stubbed — set passwords with
`npm run set-password` until they exist.

**Stripe webhooks** (`stripeWebhook`, `raffleWebhook`, `subscriptionWebhook`)
will need a raw-body route that bypasses `express.json()` for signature
verification, plus their own Nginx `location` block if you want them exempt from
the API's CORS allowlist.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| 502 Bad Gateway on `/api/*` | Express is down or not on 3000. `pm2 logs morainmahj-api --lines 50`. |
| Nginx welcome page instead of the app | `sites-enabled/default` still linked. Remove it and reload. |
| API works, site 404s on refresh | SPA fallback missing, or the build isn't at `/var/www/morainmahj-frontend`. |
| `database: "Connected"` fails | Wrong `.env` credentials, or Postgres not running. Test with `psql -h localhost -U morainmahj -d morainmahj_db`. |
| All logins return 500 | `JWT_SECRET` empty. `server.js` warns about this at boot. |
| Mobile app can't reach the API | `capacitor://localhost` and `http://localhost` missing from `CORS_ORIGINS`; or the app was built with the wrong `VITE_API_URL`. |
| Everyone logged out after a deploy | `JWT_SECRET` changed. Restore the previous value. |
| Assets 404 after a frontend deploy | A cached `index.html` referencing old hashes. The Nginx config sets `no-store` on it; hard-refresh once. |

Rollbacks:

```bash
ec2$ cd /var/www/morainmahj-backend && git reset --hard <previous-sha> && npm ci --omit=dev && pm2 reload morainmahj-api
ec2$ sudo rm -rf /var/www/morainmahj-frontend && sudo mv /var/www/morainmahj-frontend.old /var/www/morainmahj-frontend && sudo systemctl reload nginx
```
