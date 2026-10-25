// An answer that is not JSON (a script, a file): a route returns one of these and
// the hosts send it as it is (server/node/http.js sendRaw, server/cloudflare/casino.js).
export class Raw {
  constructor(body, { status = 200, type = 'application/octet-stream', headers = {} } = {}) {
    this.body = body;
    this.status = status;
    this.type = type;
    this.headers = headers;
  }
}
