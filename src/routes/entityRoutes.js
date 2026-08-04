const express = require('express');
const EntityController = require('../controllers/EntityController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { loadActor } = require('../middleware/actorMiddleware');

const router = express.Router();

router.use(authenticateToken, loadActor);

router.get('/', EntityController.listEntities);

router.post('/:entity/bulk', EntityController.bulkCreate);
router.put('/:entity/bulk', EntityController.bulkUpdate);

router.get('/:entity', EntityController.find);
router.post('/:entity', EntityController.create);

router.get('/:entity/:id', EntityController.findById);
router.put('/:entity/:id', EntityController.update);
router.patch('/:entity/:id', EntityController.update);
router.delete('/:entity/:id', EntityController.remove);

module.exports = router;
