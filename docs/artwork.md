# Supplied UI artwork

VIP0 / 1 / 2 / 3 / 3.1 / 4 use the supplied badges in `img/vip/`.
The home menu, quests and money tree, and the friends, messages and jobs tabs
use the supplied pictures in `img/ui/lowpoly/`. Those three tabs have no visible
text; their accessible names and notification badges are retained.

The supplied 7, star, gold and BAR replace the reel pictures. The former gun
is now the coin, and the former diamond is the watch. Internal symbol ids,
odds, payouts and saved progress are preserved. Quests and hub labels use the
new names. Old 3D turn sheets are not loaded for these six pictures; win effects
keep the supplied artwork. The statue's existing 3D turn remains.

The home exit icon, SHOP, SPIN and common landscape background are replaced.
The static title displays the entire supplied picture. Its full-screen start
button follows the existing account flow; Enter and Space also start it.
App installation, terms and legal links remain independently usable.

Run `python3 tools/art/import_supplied.py /path/to/attachments` to rebuild.
The script preserves transparency, removes empty margins and exports assets
at up to 3x display resolution. The background and title retain their original
resolution. Compression candidates are compared at display size. The selected
23 WebPs total 472,608 bytes against 5,020,279 source bytes (90.6% smaller).
New image paths avoid stale cached artwork.

Validation: 31 existing app, VIP, quest and hub tests passed; the actual HTML
and UI scripts passed DOM checks for image paths, badge mapping, tab navigation,
notifications, chat return and title/account/ban/splash/keyboard behavior. The
actual reel canvas and win effects rendered all six new symbols successfully.
The single-file exporter embeds the new images and static title. Full-browser
layout validation was unavailable because the browser binary download failed.
