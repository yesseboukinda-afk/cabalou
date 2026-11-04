ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON public.users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id ON public.users(auth_user_id);

DO $$
DECLARE
  auth_id UUID;
  auth_email TEXT;
  cabalou_user_id BIGINT;
  matching_users INTEGER;
BEGIN
  SELECT id, email
    INTO auth_id, auth_email
    FROM auth.users
    WHERE lower(email) = lower('admintest@cabalou.com')
    LIMIT 1;

  IF auth_id IS NULL THEN
    RAISE EXCEPTION 'Supabase Auth user admintest@cabalou.com was not found.';
  END IF;

  SELECT COUNT(*)
    INTO matching_users
    FROM public.users
    WHERE auth_user_id = auth_id::TEXT
       OR lower(username) IN ('admin', lower(auth_email))
       OR lower(email) = lower(auth_email);

  IF matching_users > 1 THEN
    RAISE EXCEPTION 'Several Cabalou profiles match this Auth account or username Admin; resolve the duplicates before linking.';
  ELSIF matching_users = 1 THEN
    SELECT id
      INTO cabalou_user_id
      FROM public.users
      WHERE auth_user_id = auth_id::TEXT
         OR lower(username) IN ('admin', lower(auth_email))
         OR lower(email) = lower(auth_email);

    UPDATE public.users
      SET username = 'Admin',
          email = auth_email,
          display_name = 'Admin',
          role = 'admin',
          auth_user_id = auth_id::TEXT,
          active = 1
      WHERE id = cabalou_user_id;
  ELSE
    INSERT INTO public.users
      (username, email, display_name, role, salt, password_hash, auth_user_id, active, created_at)
    VALUES
      ('Admin', auth_email, 'Admin', 'admin', decode(repeat('00', 16), 'hex'),
       decode(repeat('00', 32), 'hex'), auth_id::TEXT, 1,
       to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'));
  END IF;
END
$$;
