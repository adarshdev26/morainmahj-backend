const express = require('express');
const ResourceController = require('../controllers/ResourceController');
const { authenticateToken, optionalAuthenticateToken } = require('../middleware/authMiddleware');
const { loadActor, loadActorOptional } = require('../middleware/actorMiddleware');

const requireAuth = [authenticateToken, loadActor];
const optionalAuth = [optionalAuthenticateToken, loadActorOptional];

/**
 * Build an Express router for one named resource.
 *
 * By default every op requires a JWT. Resources that are publicly readable in
 * RLS (`read: {}`) can list those ops in `publicOps` so anonymous GETs work
 * for marketing / landing pages while writes stay protected.
 */
function createResourceRouter({ entity, ops, publicOps }) {
  const router = express.Router({ mergeParams: true });
  const allowed = new Set(ops || []);
  const publicSet = new Set(publicOps || []);

  router.use((req, _res, next) => {
    req.resourceEntity = entity;
    next();
  });

  function authFor(op) {
    return publicSet.has(op) ? optionalAuth : requireAuth;
  }

  if (allowed.has('bulkCreate')) {
    router.post('/bulk', ...authFor('bulkCreate'), ResourceController.bulkCreate);
  }
  if (allowed.has('bulkUpdate')) {
    router.put('/bulk', ...authFor('bulkUpdate'), ResourceController.bulkUpdate);
  }

  if (allowed.has('list')) {
    router.get('/', ...authFor('list'), ResourceController.list);
  }
  if (allowed.has('create')) {
    router.post('/', ...authFor('create'), ResourceController.create);
  }

  if (allowed.has('get')) {
    router.get('/:id', ...authFor('get'), ResourceController.getById);
  }
  if (allowed.has('update')) {
    router.patch('/:id', ...authFor('update'), ResourceController.update);
    router.put('/:id', ...authFor('update'), ResourceController.update);
  }
  if (allowed.has('remove')) {
    router.delete('/:id', ...authFor('remove'), ResourceController.remove);
  }

  return router;
}

module.exports = { createResourceRouter };
