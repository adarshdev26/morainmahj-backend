// Registry of the Base44 server functions that have been ported.
//
// Each module exports `async (ctx, body) => result`, where ctx is built by
// ./context.js and result is serialised as the response body. Throw an error
// carrying a `status` to return a non-200.
//
// The originals live in ../../morain-mahj/base44/functions/<name>/entry.ts; the
// ports keep their structure and permission checks so they can be compared
// side by side. Anything absent from this map is reported as not yet ported.
const registry = {
  getDemoTournamentForUser: require('./getDemoTournamentForUser'),
  getLeagueRoster: require('./getLeagueRoster'),
  getPlayerRepository: require('./getPlayerRepository'),
  getPublicLeaderboard: require('./getPublicLeaderboard'),
  getPublicLeagueLeaderboard: require('./getPublicLeagueLeaderboard'),
  getRaffleAllocations: require('./getRaffleAllocations'),
  getTournamentPlayerNames: require('./getTournamentPlayerNames'),
  logDataAccess: require('./logDataAccess'),
};

function has(name) {
  return Object.prototype.hasOwnProperty.call(registry, name);
}

function get(name) {
  return has(name) ? registry[name] : null;
}

function names() {
  return Object.keys(registry).sort();
}

module.exports = { get, has, names };
