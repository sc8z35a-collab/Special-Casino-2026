// Keeping the game server awake while it is played. Left alone for about 10
// seconds, the Durable Object goes to sleep (hibernation) and the next action
// wakes it again, slower: its code starts over and its memory is empty. While
// someone is connected and did something in the last 10 minutes, a tick every
// 8 seconds keeps it up. Never more than `month` ticks a month: that stays
// inside the plan's included requests, and the time it is up is one object's
// at most, inside the included duration (so it never costs extra).
export const AWAKE = { every: 8000, idle: 10 * 60000, month: 250000 };

// the month the ticks are counted in (UTC)
export const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);

// When the alarm should ring next: at the housekeeping, or sooner to stay awake.
export function nextAlarm({ now, housekeepAt, sockets, activeAt, ticks }, A = AWAKE) {
  const awake = sockets > 0 && activeAt > 0 && now - activeAt < A.idle && ticks < A.month;
  return awake ? Math.min(housekeepAt, now + A.every) : housekeepAt;
}
