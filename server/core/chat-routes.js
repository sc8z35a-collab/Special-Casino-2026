// Chat routes share the same authorization, filtering and transactions on both hosts.
import { ApiError, posInt } from './errors.js';
import { screen as filterText } from './filter.js';

export function createChatRoutes({ q, tx, live, limit, getUser, dmChannel, isBlocked, areFriends, peter, johnson, official, opsLog, sendText, detected, track, vipLevel, vipBadgeLevel, isOnline, msgDto, insertMessage, touchConversations, touchOwn, sendOwn, unreadTotal, groupChannel, memberIds, myGroup, groupDto, postToGroup, deliverDm, rate, chatAllowed, requireFriend, liveTarget, relayTyping, PAGE, SEND_BYTES, RETRACT_MS }) {
  return {
    /* ----- chat ----- */

    'GET /api/conversations': (req, u) => {
      const rows = q(`SELECT c.other_id AS id, c.unread, c.updated_at, o.name, o.avatar, o.banned, o.npc, o.last_seen, o.vip_until, o.vip_exp, o.vip_trial_until, m.kind, m.body, m.amount, m.currency, m.sender_id, m.retracted_at
                      FROM conversations c JOIN users o ON o.id = c.other_id JOIN message_history m ON m.id = c.last_id
                      WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 100`).all(u.id);
      const groups = q(`SELECT g.* FROM chat_members m JOIN chat_groups g ON g.id = m.group_id
                        WHERE m.user_id = ? ORDER BY g.updated_at DESC LIMIT 50`).all(u.id);
      return {
        conversations: rows.filter((r) => !r.banned).map((r) => ({
          user: { id: r.id, name: r.name, avatar: r.avatar, online: isOnline(r), npc: r.npc || null, lastSeen: r.npc ? null : r.last_seen, vip: vipLevel(r), vipBadge: vipBadgeLevel(r) },
          friend: areFriends(u.id, r.id),
          unread: r.unread,
          at: r.updated_at,
          last: { kind: r.kind, text: r.retracted_at ? '' : r.body, retracted: !!r.retracted_at, amount: r.amount, currency: r.currency, mine: r.sender_id === u.id }
        })),
        groups: groups.map((g) => groupDto(g, u.id)),
        unread: unreadTotal(u.id)
      };
    },

    // a conversation (with=<player>) or a group (group=<id>), newest page
    // first; `before` pages back. Also how far the others have read (既読).
    'GET /api/messages': (req, u) => {
      const withId = req.query.get('with'), groupId = req.query.get('group');
      let channel, extra;
      if (groupId) {
        const g = myGroup(u.id, posInt(groupId, 'グループ'));
        channel = groupChannel(g.id);
        const reads = q('SELECT user_id AS id, read_id AS upto FROM chat_members WHERE group_id = ? AND user_id != ?').all(g.id, u.id);
        extra = { group: groupDto(g, u.id), reads };
      } else if (withId) {
        const other = posInt(withId, 'ユーザーID');
        channel = dmChannel(u.id, other);
        const c = q('SELECT read_id FROM conversations WHERE user_id = ? AND other_id = ?').get(other, u.id);
        extra = { readUpTo: c ? c.read_id : 0 };
      } else {
        throw new ApiError(400, 'bad_chat', '相手かグループを指定してください');
      }
      const beforeRaw = Number(req.query.get('before'));
      const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.MAX_SAFE_INTEGER;
      const rows = q(`SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar FROM message_history m LEFT JOIN users s ON s.id = m.sender_id
                      WHERE m.channel = ? AND m.id < ? AND NOT (m.held = 1 AND m.recipient_id = ?) ORDER BY m.id DESC LIMIT ?`).all(channel, before, u.id, PAGE);
      return { channel, messages: rows.reverse().map(msgDto), hasMore: rows.length === PAGE, ...extra };
    },

    'POST /api/messages': async (req, u) => {
      const body = await req.json(SEND_BYTES);
      const text = sendText(body.text);
      if (body.group !== undefined) {
        const g = myGroup(u.id, posInt(body.group, 'グループ'));
        chatAllowed(u);
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        const f = filterText(text);
        const message = postToGroup(g, u, 'text', f.masked);
        detected(u, f, { group: g.id, place: 'group:' + g.name, original: text, messageId: message.id });
        track(u.id, [['chat', 1]]);
        return { message };
      }
      const to = posInt(body.to, '宛先');
      if (to === u.id) throw new ApiError(400, 'self', '自分にはメッセージを送れません');
      // to the operators (any length: a 報告 or an 意見案 can be long)
      if (official.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return { message: official.fromPlayer(u, text) };
      }
      if (peter.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return peter.chat(u, text);
      }
      if (johnson.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return johnson.chat(u, text);
      }
      liveTarget(to);
      requireFriend(u, to, 'メッセージを送れるように');
      chatAllowed(u);
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      // the filter: the other player gets *** for what it found
      const f = filterText(text);
      // blocked by them: sent as far as the sender can tell, kept back from them
      const held = isBlocked(to, u.id);
      const m = tx(() => {
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'text', body: f.masked, held });
        if (held) touchOwn(u.id, to, row.id);
        else touchConversations(u.id, to, row.id);
        return row;
      });
      detected(u, f, { to, place: 'dm', original: text, messageId: m.id });
      const message = held ? sendOwn(m, u.id) : deliverDm(m, u.id, to);
      track(u.id, [['chat', 1]]);
      return { message };
    },

    // 送信の取り消し (the ⋯ under one's own message): words only, within the
    // hour, as often as one likes; money, cars, items and presents never come
    // back. The operators still see what it said, and the log keeps it.
    'POST /api/messages/retract': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.message, 'メッセージ');
      rate(limit.read, u.id);
      const m = q('SELECT * FROM message_history WHERE id = ?').get(id);
      if (!m || m.sender_id !== u.id) throw new ApiError(404, 'not_found', 'このメッセージは取り消せません');
      if (m.kind !== 'text') throw new ApiError(409, 'not_text', 'お金・車・アイテム・プレゼントの送信は取り消せません');
      if (m.retracted_at) throw new ApiError(409, 'retracted', 'このメッセージはもう取り消しています');
      const now = Date.now();
      if (now - m.created_at > RETRACT_MS) throw new ApiError(409, 'too_late', '送ってから1時間を過ぎたメッセージは取り消せません');
      q('UPDATE messages SET retracted_at = ? WHERE id = ? AND retracted_at = 0').run(now, m.id);
      const group = m.channel.startsWith('group:') ? Number(m.channel.slice(6)) : 0;
      // everyone in the conversation sees it go (not one who blocked the sender: they never had it)
      const ids = group ? memberIds(group) : [u.id, m.held ? 0 : m.recipient_id];
      for (const x of ids) if (x) live.send(x, 'retract', { id: m.id, channel: m.channel, group: group || undefined, at: now });
      const t = group ? null : getUser(m.recipient_id);
      const g = group ? q('SELECT name FROM chat_groups WHERE id = ?').get(group) : null;
      opsLog.add({
        actor: u, action: 'player_retract', target: t, req,
        summary: `${u.name}さんが${group ? `グループ「${g ? g.name : '?'}」の` : `${t ? t.name : '?'}さんへの`}メッセージを取り消した`,
        detail: { messageId: m.id, channel: m.channel, group, text: m.body, sentAt: m.created_at }
      });
      return { id: m.id, retracted: now };
    },

    // Read up to the newest message: the other side (everyone in a group) sees 既読.
    'POST /api/read': async (req, u) => {
      const body = await req.json();
      rate(limit.read, u.id);
      if (body.group !== undefined) {
        const g = myGroup(u.id, posInt(body.group, 'グループ'));
        const before = q('SELECT read_id FROM chat_members WHERE group_id = ? AND user_id = ?').get(g.id, u.id).read_id;
        q('UPDATE chat_members SET unread = 0, read_id = ? WHERE group_id = ? AND user_id = ?').run(g.last_id, g.id, u.id);
        if (g.last_id > before) {
          for (const id of memberIds(g.id)) if (id !== u.id) live.send(id, 'read', { group: g.id, by: u.id, upto: g.last_id });
        }
        return { unread: unreadTotal(u.id) };
      }
      const other = posInt(body.with, 'ユーザーID');
      const c = q('SELECT last_id, read_id FROM conversations WHERE user_id = ? AND other_id = ?').get(u.id, other);
      q('UPDATE conversations SET unread = 0, read_id = last_id WHERE user_id = ? AND other_id = ?').run(u.id, other);
      if (c && c.last_id > c.read_id) live.send(other, 'read', { dm: u.id, upto: c.last_id });
      return { unread: unreadTotal(u.id) };
    },

    // 入力中: the others in the conversation see it for a few seconds
    'POST /api/typing': async (req, u) => {
      relayTyping(u, await req.json());
      return { ok: true };
    },

  };
}
