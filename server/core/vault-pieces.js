// Generation zero keeps every existing R2 address. A restarted upload uses
// its own prefix so late writes/deletes can never touch the replacement.
export const piecePrefix = file => `vault/${file.id}/${file.storage_generation ? `g${file.storage_generation}/` : ''}`;
export const pieceKey = (file, n) => piecePrefix(file) + n;
