-- Adds credential storage for POST /api/auth/login.
--
-- The Base44 export contains no passwords (it authenticated via OAuth), so every
-- existing row starts with password IS NULL and cannot log in until a password is
-- set via `npm run set-password -- <email> <password>`.
--
-- The display name is not added here: the export already stores it in full_name,
-- and the API returns it as `user.name`.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password TEXT;

-- Login looks accounts up case-insensitively, so index the same expression.
CREATE INDEX IF NOT EXISTS user_email_lower_idx ON "User" (lower(email));
