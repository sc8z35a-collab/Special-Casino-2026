# Quest tickets, level details and player transfers

Level ticket drops are independent server-side draws. Each newly reached level
has a 10% chance to grant one 5-hour reset ticket. Reaching levels 5, 10, 15, etc.
also has a separate 30% chance to grant one daily reset ticket. Multi-level XP
gains draw once for each eligible level; existing levels, reads and repeated
claims never redraw. Existing inventories and VIP pack grants are preserved.

The home profile and quest header show the current level and exact XP remaining
to reach the next one. The quest header also shows current-level XP / required XP.
Numbers update immediately on level-up, and logout clears previous player details.
The quest progress bar's moving gleam is removed; progress still fills normally.

Every quest uses the same displayed-dollar reward thresholds, including PRO/ULTRA
multipliers when awarded:

| Tier | Dollar reward |
| --- | ---: |
| green | 1–19,999 |
| blue | 20,000–39,999 |
| purple | 40,000–69,999 |
| orange | 70,000–99,999 |
| gold | 100,000–299,999 |
| red | 300,000–699,999 |
| red-gold | 700,000–999,999 |
| aqua-purple | 1,000,000–1,999,999 |
| dark | 2,000,000 and above |

The nine supplied polygon textures are quest-row backgrounds, including emergency
quests. A dark shade keeps text readable. PRO/ULTRA labels and reward/claim controls
remain present. Transparent padding is trimmed and all textures retain their
960 px width and original aspect ratios. The nine files total 115,956 bytes,
compared with 1,751,098 supplied bytes (93.4% reduction). Regenerate them with
`python3 tools/art/import_quest_tiers.py <attachment-directory>`.

Direct player-to-player message transfers are limited to a combined $5,000,000
per sender per Japan calendar day (00:00–24:00 JST). Spin tokens count at the shared
catalog dollar conversion. All recipients share that sender's allowance. Sending
reserves it immediately, including pending and held receipts. Claiming, expiry or
deleting message history does not restore it. A durable daily counter is checked
and saved in the same transaction as the debit/message. Existing same-day messages
seed the first counter, and counters are included in backups. No explanatory cap
label is added to player UI; exceeding it returns a short failure message.

Validation: 233 server/application tests pass, including exhaustive ticket draw
boundaries, independent daily-only wins, multi-level gains, no rerolls, mixed
currency and recipient totals, claims/deletion, failures/concurrency, existing
message backfill, and exact JST midnight rollover. Real HTML/UI modules plus a
test server verify level/XP changes, account reset, displayed-dollar rarity,
all nine texture routes/CSS, emergency quests, PRO/ULTRA artwork and dollar tiers,
and removal of the quest bar gleam.
