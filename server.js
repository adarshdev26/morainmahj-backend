const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to Morainmahj API',
    version: '1.0.0',
    endpoints: [
      '/api/health',
      '/api/users',
      '/api/tournaments',
      '/api/leagues',
      '/api/registrations',
      '/api/stats'
    ]
  });
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

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "User" LIMIT 50');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM "User" WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all tournaments
app.get('/api/tournaments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "Tournament" LIMIT 50');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all leagues
app.get('/api/leagues', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "League" LIMIT 50');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all registrations
app.get('/api/registrations', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "Registration" LIMIT 50');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get database stats
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
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.DB_NAME}`);
  console.log(`🌍 API Health: http://localhost:${PORT}/api/health`);
});
