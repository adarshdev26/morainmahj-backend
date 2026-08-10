const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
require('dotenv').config();
const pool = require('./db');
const authRoutes = require('./src/routes/authRoutes');
const integrationRoutes = require('./src/routes/integrationRoutes');
const userInviteRoutes = require('./src/routes/userInviteRoutes');
const { mountNamedResources } = require('./src/routes/mountNamedResources');
const { mountNamedActions } = require('./src/routes/mountNamedActions');

const app = express();

// Comma-separated allowlist, e.g. "http://localhost:3000,https://morainmahj.com".
// Left unset, every origin is allowed, which keeps the public landing page and
// local frontends (:3000, :5173) working without configuration.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Nginx terminates TLS and proxies to this process, so req.ip and req.protocol
// must come from X-Forwarded-* rather than the loopback socket.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Root route — landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/users', userInviteRoutes);
// Named REST only: /api/{resource} and /api/actions/{kebab-name}.
mountNamedResources(app);
mountNamedActions(app);

// Alias so clients that were written against /api/login keep working.
app.post('/api/login', (req, res, next) => {
  req.url = '/login';
  authRoutes(req, res, next);
});

// Test database connection
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'Server is running',
      database: 'Connected',
      timestamp: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({
      status: 'Error',
      message: err.message
    });
  }
});

// Get database stats (aggregate counts only — no row data)
app.get('/api/stats', async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM "User"');
    const tournaments = await pool.query('SELECT COUNT(*) FROM "Tournament"');
    const leagues = await pool.query('SELECT COUNT(*) FROM "League"');
    const registrations = await pool.query('SELECT COUNT(*) FROM "Registration"');

    res.json({
      users: parseInt(users.rows[0].count),
      tournaments: parseInt(tournaments.rows[0].count),
      leagues: parseInt(leagues.rows[0].count),
      registrations: parseInt(registrations.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: err.message
  });
});

// Start server
const PORT = process.env.PORT || 3000;
// On EC2 set HOST=127.0.0.1 so only Nginx can reach the API and port 3000 stays
// unreachable from the internet regardless of the security group.
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
  console.log(`📊 Database: ${process.env.DB_NAME}`);
  console.log(`🌍 API Health: http://localhost:${PORT}/api/health`);
  if (!process.env.JWT_SECRET) {
    console.error('❌ JWT_SECRET is not set — /api/auth/login will return 500 until it is.');
  }
});
