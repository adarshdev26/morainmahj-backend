const { RESOURCES } = require('./resourceRegistry');
const { createResourceRouter } = require('./createResourceRouter');

/** Mount every named resource at /api/{path}. */
function mountNamedResources(app) {
  for (const resource of RESOURCES) {
    app.use(`/api/${resource.path}`, createResourceRouter(resource));
  }

  const paths = RESOURCES.map((r) => r.path).sort();
  console.log(`📦 Named REST resources mounted (${paths.length}): ${paths.join(', ')}`);
}

module.exports = { mountNamedResources };
