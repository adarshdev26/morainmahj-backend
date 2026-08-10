// The ported functions signal HTTP status the same way the rest of the backend
// does, by attaching `status` to the error the runner catches.
// Optional `body` fields are merged into the JSON error response (e.g. match_result_id).
function httpError(status, message, body = undefined) {
  return Object.assign(new Error(message), { status, body });
}

module.exports = { httpError };
