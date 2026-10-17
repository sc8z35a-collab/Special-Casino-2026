// Errors that reach the player as { error: { code, message } }.

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Positive safe integer from user input, or an ApiError.
export function posInt(v, what) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'bad_amount', `${what}は1以上の整数で指定してください`);
  return n;
}
