// Errors that reach the player as { error: { code, message } }.

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    // (a refusal the player is told about, not a fault: no stack to build)
    const depth = Error.stackTraceLimit;
    if (status < 500) Error.stackTraceLimit = 0;
    super(message);
    Error.stackTraceLimit = depth;
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

// SQL LIMIT accepts negative integers as "all rows" and rejects fractions.
export function pageLimit(value, fallback, max = fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'bad_limit', '表示件数は1以上の整数で指定してください');
  return Math.min(max, n);
}
