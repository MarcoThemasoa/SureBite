-- Run this script in the Supabase SQL Editor to resolve all security warnings

-- 1. Fix "Function Search Path Mutable" for handle_new_user
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- 2. Fix "Function Search Path Mutable" for handle_updated_at
ALTER FUNCTION public.handle_updated_at() SET search_path = public;

-- 3. Fix "Public Can Execute SECURITY DEFINER" & "Signed-In Users Can Execute SECURITY DEFINER" for handle_new_user
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;

-- 4. Fix "Public Can Execute SECURITY DEFINER" & "Signed-In Users Can Execute" for rls_auto_enable
-- (If this function was auto-created by Supabase, it's safer to revoke public execution)
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;

-- Note on "Leaked Password Protection Disabled":
-- To fix this, go to your Supabase Dashboard -> Authentication -> Security,
-- and toggle ON "Leaked password protection".
