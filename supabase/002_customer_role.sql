-- Repairs only the role check in the existing booking function.
-- Profiles, roles, bookings, function settings, and grants are preserved.
DO $fix$
DECLARE
  definition text := pg_get_functiondef('public.basement_book(bigint,uuid)'::regprocedure);
  old_check text := 'id = v_target and role = ''member''';
  new_check text := 'id = v_target and role = ''customer''';
BEGIN
  IF strpos(definition, old_check) > 0 THEN
    IF length(definition) - length(replace(definition, old_check, '')) <> length(old_check) THEN
      RAISE EXCEPTION 'Unexpected booking function: role check is not unique.';
    END IF;
    EXECUTE replace(definition, old_check, new_check);
  ELSIF strpos(definition, new_check) = 0 THEN
    RAISE EXCEPTION 'Unexpected booking function: role check was not found.';
  END IF;
END $fix$;
