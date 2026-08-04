# Supabase Auth deployment checklist

Dashboard changes are intentionally not represented as completed in source control. Before production launch:

- Set Authentication → SMTP to `smtp.gmail.com`, port `587`, STARTTLS.
- Use an environment-managed Gmail username and app password; never commit credentials.
- Set the verified sender name/address.
- Set Authentication → URL Configuration Site URL to the deployed Run Local origin and add every required deployed origin/path to Redirect URLs (including the confirmation and recovery callback URL).
- Publish branded confirmation, recovery, and password-change notification templates.
- Gmail has a practical sending limit of about 500 messages/day; monitor delivery and rate limits.
- If post-reset security notification is required, configure a supported Supabase Auth email hook/provider. Until configured, the app must show the notification as not configured rather than claiming delivery.
