# Group submission contract

Group submissions are accepted only from verified, non-suspended runners and are always pending until an admin decision. The server requires `name`, a supported `groupType` (`community` or `rrca-chartered`), valid optional HTTP(S) links, both uploaded photo references (`coverPhoto` and `logoPhoto`), and `membershipMode` (`open` or `request`).

Legacy fixtures or callers that omit the new photo/membership fields are not silently upgraded: they receive explicit validation errors. Update those payloads at the boundary. This compatibility policy keeps the stricter submission validation in force.

Selecting `rrca-chartered` is only a submission category/request. Approval creates a published group and grants the submitter the Group Leader role, but never sets the RRCA badge; badge verification remains an explicit admin action.

Public group DTOs contain only published group presentation data and safe leader display fields. They do not expose contact emails, phone numbers, moderation notes, audit data, or private membership data. Groups are content subjects and cannot author forum posts.
