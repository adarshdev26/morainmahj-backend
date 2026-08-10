const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { loadActor } = require('../middleware/actorMiddleware');

const router = express.Router();

function notPorted(feature) {
  return (req, res) => {
    res.status(501).json({
      error: `${feature} has not been ported to this backend yet`,
      feature,
    });
  };
}

router.use(authenticateToken, loadActor);

router.post('/upload-file', notPorted('File upload'));
router.post('/upload-private-file', notPorted('Private file upload'));
router.post('/create-file-signed-url', notPorted('Signed file URLs'));
router.post('/send-email', notPorted('Outbound email'));

module.exports = router;
