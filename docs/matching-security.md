# Matching security policy

Join Requests are opt-in, mutual, and private. There is no candidate discovery, messaging, contact disclosure, gender inference, or public matching context.

## JoinRequest rate limit

The API permits **10 Join Requests per authenticated account in a rolling 60-minute window**. A request attempt that passes identity, consent, city, context, and block checks consumes one slot; duplicate attempts are rejected after the limiter check. The 11th eligible attempt returns HTTP `429` with `{"error":"rate_limited"}`. Timestamps are stored in the existing file-backed `db.json` under `joinRequestRate` and loaded on process startup, so a restart does not reset the window. The store prunes timestamps older than the window on every account check and retains at most the active window's timestamps (never more than 10 per account); empty windows are removed. The account ID is the limiter key, preventing cross-account quota sharing.

The production store writes atomically through `db.json.tmp` then rename. Deployments sharing a store directory therefore share the persisted limiter state; concurrent writers must use the store's normal serialized request path.

Matching preferences require the current consent version. `enabled=false` is an explicit opt-out and clears consent version. Gender fields are optional, never inferred, and are not returned by Join Request responses. Personal Runs are owner-only and a request may reference only the target owner's non-deleted run. Requests expire after seven days; both parties must explicitly accept before state becomes `accepted`. Blocks are symmetric and invalidate pending/accepted requests.
