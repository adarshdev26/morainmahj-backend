/** Public app origin for emails, push deep links, Stripe return URLs. */
function getAppBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    process.env.APP_URL ||
    'https://morainmahj.com'
  ).replace(/\/$/, '');
}

module.exports = { getAppBaseUrl };
