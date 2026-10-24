# Shared Medusa 2.22.1 host source

This directory is one host source, not a workspace. Run it twice with separate
databases, ports, secrets, installation IDs, and tenant IDs (`atlas`, `boreal`).
The Change Desk plugin is loaded from `packages/medusa-plugin`.

The seed uses Medusa modules and native workflows only. It refuses an existing
fixture namespace, writes no business tables directly, emits a non-secret ID
map under `evidence/medusa-seed-map.<tenant>.json`, and stores generated demo
passwords only in ignored `.local/credentials.<tenant>.json`.

After the first seed, set `CHANGEDESK_ALLOWED_CATEGORY_IDS` and
`CHANGEDESK_ALLOWED_CHANNEL_IDS` from the local map, then restart that host.
Never commit `.env` or `.local`.
