-- 0002_admin.sql: the owner flag. admin = 1 marks the person who runs First Pass: they see every user's problem reports
-- (GET /api/bugs?all=1 and the connector's bugs tool, each with the reporter's name) so their Claude Code can fix them.
-- Everyone else (admin = 0, the default) sees only their own reports. Set with `node scripts/add-user.mjs "Name" --admin`.
ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
