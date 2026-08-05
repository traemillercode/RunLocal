# Admin access (supported configuration)

The admin UI is the existing `/admin` route in the SPA. It is not linked from public navigation; opening that route directly is supported and does not grant access.

## Supported server-controlled access

1. **Owner/super-admin path (recommended):** sign in through the normal Run Local account flow using the server-configured owner email (`RUN_LOCAL_OWNER_EMAIL`; default `traemiller.email@gmail.com`). The server derives `isOwner` from the authenticated account email and authorizes the existing owner control-center operations. The browser does not choose a role.
2. **Key-admin path:** set `RUN_LOCAL_ADMIN_KEY` on the server. Open `/admin`, enter the key once, and the server issues an HttpOnly admin session cookie. The key is never persisted or returned to the client. `RUN_LOCAL_ADMIN_EMAIL` is the non-secret audit identity (default `admin@runlocal.app`).
3. **City-admin path:** a server-authorized account with role `city_admin` and one `adminCityId` can use only scoped city-admin routes. Cross-city and global-only operations are denied server-side.

Every sensitive admin read or mutation requires a reason of 5–500 characters and is audited server-side. Health may expose only the boolean `adminConfigured`; it never exposes keys.

## Why an owner may not see the control center

The owner path requires a successful normal signed-in session and an email matching `RUN_LOCAL_OWNER_EMAIL` (case-insensitive). A guest, an unlinked Supabase identity, a different email, or a deleted account cannot use it. The key path requires `RUN_LOCAL_ADMIN_KEY` to be configured on the running server; otherwise the UI explicitly reports that admin access is unconfigured.

There is intentionally no private URL, hardcoded password, client-side bypass, or admin secret in the frontend. Do not add one to troubleshoot access.
