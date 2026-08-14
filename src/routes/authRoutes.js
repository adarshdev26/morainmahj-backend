const express = require('express');
const AuthController = require('../controllers/AuthController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', AuthController.login);
router.get('/me', authenticateToken, AuthController.getMe);
router.patch('/me', authenticateToken, AuthController.updateMe);
router.put('/me', authenticateToken, AuthController.updateMe);
router.post('/logout', authenticateToken, AuthController.logout);

module.exports = router;
