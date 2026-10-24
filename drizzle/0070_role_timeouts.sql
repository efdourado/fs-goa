-- The app's own role stops any statement after 15s and any transaction left idle for 30s, so a slow query or a
-- request that died mid-transaction can't hold a connection or its locks. Set on the role, not per connection:
-- Neon's pooler doesn't pass session settings through. A migration that needs longer starts with
-- `SET LOCAL statement_timeout = 0`.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', current_user, current_database(), '15s');
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L', current_user, current_database(), '30s');
END $$;
