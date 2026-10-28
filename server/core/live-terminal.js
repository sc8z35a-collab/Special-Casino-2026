// Revoked connections may receive only their final stop/re-authentication signal.
// Private chat, balances, frames and all other events require a live session.
export const terminalEvent = (event, data) => event === 'kick' || event === 'watchend' || (event === 'view' && data?.on === false);
