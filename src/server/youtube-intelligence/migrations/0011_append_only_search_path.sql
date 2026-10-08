-- The trigger raises an error using PostgreSQL built-ins only. Pin lookup to
-- pg_catalog so caller-controlled search_path cannot change its behavior.
ALTER FUNCTION public.yi_append_only() SET search_path = pg_catalog;
