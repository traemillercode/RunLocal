# Kimbio — Messaging Architecture

Read from the tree at `2de4dfb`, not from memory. Every line below is in the
codebase today.

---

## Shape of the thing

Two records, a flat-file store, and a polling client. No websockets, no
third-party chat SDK, no separate service. Messages live in the same JSON store
as everything else and go through the same `requireSession` chokepoint as every
other endpoint.

That is a deliberate ceiling, not an oversight — see "What this is not" at the
end.

---

## The data model

### `ConversationRecord`

`src/server/types.ts:1128`

```ts
export interface ConversationRecord {
  id: string;
  isGroup: boolean;
  /** Group display name — null for 1:1 threads (shown as the other person's name instead). */
  name: string | null;
  participantIds: string[];
  createdBy: string;
  createdAt: string;
  lastMessageAt: string;
  /** Set once a run has been created from this thread — prevents creating a second one from the same chat. */
  runCreatedId: string | null;
  /**
   * accountId -> ISO timestamp of that person's last-read moment in this
   * thread. A message is "seen" once every other participant's readBy
   * timestamp is >= its createdAt.
   */
  readBy: Record<string, string>;
  /**
   * Group photo — filename under /uploads/public/. Null/absent shows the
   * default group icon. 1:1 threads never set this (they show the other
   * person's profile photo instead).
   */
  photoRef?: string | null;
}
```

Three things worth noticing:

**`participantIds` is the membership record.** There is no separate join table.
That is what makes the authorization one-line everywhere — and it is also the
thing that produced a real bug, below.

**`readBy` is a map of timestamps, not a set of message ids.** "Seen" is derived
by comparing timestamps rather than stored per message, so marking a thread read
is one write regardless of how many messages it contains.

**`runCreatedId`** exists so a thread can become a run once. A group chat
planning a Saturday long run turns into an actual event, and the field stops a
second one being created from the same conversation.

### `MessageRecord`

`src/server/types.ts:1145`

```ts
export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  /** Soft-delete — deleted messages keep their row (so ordering/counts stay stable) but render as removed. */
  deletedAt: string | null;
  /** accountId -> emoji, one reaction per person per message (re-reacting overwrites). */
  reactions: Record<string, string>;
  /**
   * Set when this message carries a photo — filename under /uploads/public/.
   * A message can be image-only (body can be empty) or image + caption.
   */
  mediaRef?: string | null;
  /**
   * Set when the sender edits the message — editing is only allowed within
   * 10 minutes of createdAt (enforced server-side, not just in the UI).
   */
  editedAt?: string | null;
}
```

**Soft delete, not hard.** The row survives so ordering and counts stay stable,
and it renders as removed. The same reasoning as suspension being a status
rather than a deletion: the history is the thing you need when it matters.

**Reactions are a map, not a list.** One per person per message; re-reacting
overwrites, passing null removes. That makes the toggle idempotent and means no
reaction can be double-counted.

---

## The store

`src/server/store.ts`. Two `Map`s, persisted to flat-file JSON with everything
else.

```ts
findOrCreateDirectConversation(a: string, b: string, now: Date): ConversationRecord {
  for (const c of this.conversations.values()) {
    if (!c.isGroup && c.participantIds.length === 2
        && c.participantIds.includes(a) && c.participantIds.includes(b)) return c;
  }
  const rec = { id: newId(), isGroup: false, name: null, participantIds: [a, b], /* … */ };
  this.conversations.set(rec.id, rec);
  return rec;
}
```

**Find-or-create, so opening a DM twice does not make two threads.** A linear
scan, which is correct at this scale and would be the first thing to index if it
ever stopped being.

```ts
addMessage(input, now): MessageRecord {
  const rec = { id: newId(), conversationId: input.conversationId, /* … */ };
  this.messages.set(rec.id, rec);
  this.updateConversation(input.conversationId, { lastMessageAt: rec.createdAt });
  return rec;
}
```

**`lastMessageAt` is denormalised onto the conversation** so the inbox sorts
without touching the message table. It is written in the same call that writes
the message, which is what keeps the two from drifting.

Ordering is explicit and opposite in the two places it matters:

- `getConversationsForAccount` — **newest first**, the natural inbox order
- `getMessages` — **oldest first**, the natural reading order for a thread

---

## The endpoints

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/conversations` | Inbox list |
| `POST` | `/api/conversations` | Create 1:1 (`accountId`) or group (`name` + `participantIds`) |
| `GET` | `/api/conversations/:id/messages` | Thread + marks it read |
| `POST` | `/api/conversations/:id/messages` | Send |
| `GET` | `/api/conversations/:id/typing` | Poll who is typing |
| `POST` | `/api/conversations/:id/typing` | Signal that you are |
| `GET` | `/api/conversations/:id/members` | Group roster |
| `POST` | `/api/conversations/:id/leave` | Leave a group |
| `POST` | `/api/conversations/:id/photo` | Group photo |
| `POST` | `/api/conversations/:id/create-run` | Turn the thread into an event |
| `PUT` | `/api/messages/:id/reaction` | Set/clear your reaction |
| `PATCH` | `/api/messages/:id` | Edit, within 10 minutes |
| `DELETE` | `/api/messages/:id` | Soft-delete, sender only, no time limit |

### Authorization, and the shape of it

Every conversation route resolves the same two lines:

```ts
const convo = db.getConversation(id);
if (!convo || !convo.participantIds.includes(sess.accountId))
  return err(res, { status: 404, error: "not_found" }), true;
```

**404, not 403.** A non-participant cannot distinguish "this thread exists and
you are not in it" from "no such thread" — the same silence rule the block
system uses.

Creating a 1:1 is stricter, and the comment in the source records why:

```ts
if (target === sess.accountId)
  return err(res, { status: 400, error: "invalid_target", message: "You can't message yourself." }), true;

/*
 * BLOCK CHECKED AT THE CAPABILITY, not only at the connection row.
 *
 * This gated on `pair.status === "accepted"` alone. That happens to be safe
 * today because blockConnection marks the row "removed" — but it is safe by
 * ACCIDENT: the check is asking "are you connected", and the question that
 * matters is "may you reach her". If blocking ever moves from severing the row
 * to hiding it — which is the direction the safety architecture chose, because
 * severing is visible to him — this line silently starts letting a blocked
 * person message her.
 *
 * A hidden connection must grant nothing. That is the suspension bug one layer
 * down: a flag that changes what you see and not what you can do.
 */
if (db.isBlocked(sess.accountId, target))
  return err(res, { status: 403, error: "not_connected", message: "You can only message accepted connections." }), true;
const pair = db.getConnectionPair(sess.accountId, target);
if (!pair || pair.status !== "accepted")
  return err(res, { status: 403, error: "not_connected", message: "You can only message accepted connections." }), true;
```

**Messaging requires an accepted connection.** There is no "message anyone"
path, which is the strongest single control in the messaging surface — an
unsolicited-DM feature is the thing most often abused in local social products.

Groups require every invited participant to be an accepted connection **of the
creator**, and a minimum of two others. There is no upper cap, which is a gap
rather than a decision.

### The bug this model produced

The send path originally authorized on `participantIds.includes(sender)` alone —
membership granted when the conversation was created and never revisited. So
blocking severed the connection, removed the blocked person from every list, and
**left them able to keep messaging in a thread that already existed.**

The fix, at the send path:

```ts
if (!convo.isGroup) {
  const otherParticipant = convo.participantIds.find((id) => id !== sess.accountId);
  // Identical to a conversation that is not there — he learns nothing.
  if (otherParticipant && db.isBlocked(sess.accountId, otherParticipant))
    return err(res, { status: 404, error: "not_found" }), true;
}
```

**Group conversations are deliberately exempt.** A club thread is not a private
channel to one person, and removing someone because one member blocked them is a
different decision with different consequences. The consequence — her posts in a
club thread remain visible to him — is a stated trade, not an oversight.

The general lesson, which recurs across this codebase: **membership and
connection are proxies, and proxies drift.** Every capability gate should ask
about permission, not about relationship state.

---

## Presence and typing

`src/server/store.ts:1734`

```ts
setTyping(conversationId: string, accountId: string, now: Date, ttlMs = 5000): void {
  let m = this.typing.get(conversationId);
  if (!m) { m = new Map(); this.typing.set(conversationId, m); }
  m.set(accountId, now.getTime() + ttlMs);
}
```

**In-memory only, with a 5-second TTL, and never persisted.** Typing state is
worthless a second after it is true, so writing it to disk would be pure cost.
An expired signal disappears on read rather than needing a sweeper.

The client polls `/api/conversations/:id/typing` every 2–3 seconds and posts on a
debounce. `otherOnline` on the conversation summary is described in its own
comment as *"approximate presence — polling-accurate, not instant push"*, which
is the honest framing: it is a poll interval, not a socket.

---

## Read receipts

Marking a thread read happens as a side effect of fetching it:

```ts
const updatedConvo = db.updateConversation(convo.id, {
  readBy: { ...convo.readBy, [sess.accountId]: now.toISOString() },
});
```

**One write per thread open, not per message.** "Seen" is then derived on the
client by comparing each message's `createdAt` against every *other*
participant's `readBy` timestamp — which is why the field is a map of times
rather than a set of ids.

---

## Client shapes

`src/lib/api.ts:1229`

```ts
export interface ConversationSummary {
  id: string;
  isGroup: boolean;
  name: string;
  participantIds: string[];
  otherProfile: RunnerProfileView | null;
  /** Approximate presence for the other person in a 1:1 — polling-accurate, not instant push. */
  otherOnline?: boolean;
  lastMessage: { body: string | null; senderId: string; createdAt: string } | null;
  lastMessageAt: string;
  runCreatedId: string | null;
  readBy: Record<string, string>;
  photoUrl?: string | null;
}

export interface MessageView {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
  reactions: Record<string, string>;
  mediaUrl?: string | null;
  editedAt?: string | null;
}
```

Note the projection: the record carries `photoRef` / `mediaRef` (a filename), the
view carries `photoUrl` / `mediaUrl` (a path). The client never sees a storage
key, and the server never has to trust one coming back.

Client functions:

```ts
getConversations(): Promise<ApiResult<{ conversations: ConversationSummary[] }>>
createDirectConversation(accountId: string)
createGroupConversation(name: string, participantIds: string[])
getMessages(conversationId: string):
  Promise<ApiResult<{ conversation: ConversationSummary; messages: MessageView[]; typingNames?: string[] }>>
sendMessage(conversationId: string, body: string, photoDataUrl?: string | null)
getTyping(conversationId) / sendTyping(conversationId)
getConversationMembers(conversationId) / leaveConversation(conversationId)
renameConversation(conversationId, name) / uploadGroupChatPhoto(conversationId, dataUrl)
createRunFromConversation(conversationId, …)
```

`getMessages` returns the conversation **and** the messages **and** typing names
in one response — one round trip to open a thread rather than three.

---

## Edit and delete

```ts
// PATCH /api/messages/:id
if (ageMs > 10 * 60 * 1000)
  return err(res, { status: 403, error: "edit_window_expired", message: "…" }), true;
```

**Ten minutes, enforced server-side.** The comment on the type is explicit that
this is *"not just in the UI"* — an edit window that only exists in the client is
not a window.

Delete is **sender-only with no time limit**, and soft. You can always remove
something you said; you cannot rewrite it after ten minutes.

---

## What this is not, and what that costs

**No websockets.** Delivery is poll-driven, so a message arrives within a poll
interval rather than instantly. At four beta users on one club this is
invisible; at scale it is the first thing to change.

**No push notifications.** In-app notifications exist (`account_alerts`,
`messages`), but nothing reaches a closed phone.

**No pagination.** `getMessages` returns the whole thread. Fine for months of a
small club, and a known ceiling.

**No group size cap.** Groups require ≥2 other participants and every one must be
an accepted connection of the creator. Nothing stops a 200-person group, and
nothing needs to yet.

**Flat-file store.** Every message is in one JSON file with everything else.
This is the same ceiling the rest of the product has, and it moves together with
the rest of the product or not at all.

---

## Open, from the safety work

**Group threads are exempt from block filtering**, by decision. Her posts in a
club thread remain visible to someone she has blocked. The reasoning: a club is
not a private channel, membership survives a block, and she can leave the group —
unlike the city forum, which is filtered precisely because there is no exit.

The block-time panel tells her this at the moment she blocks someone, rather than
leaving her to discover it. That was the resolution, and it is the only part of
the messaging surface where a known leak is accepted on purpose.
