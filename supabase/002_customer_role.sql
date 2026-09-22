-- Keeps the booking function aligned with the real user_role enum.
-- The enum value for a gym member is "customer".
CREATE OR REPLACE FUNCTION public.basement_book(
  p_slot_id bigint,
  p_member_id uuid DEFAULT NULL::uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_target uuid;
  v_slot public.basement_slots%rowtype;
  v_count integer;
  v_id bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Απαιτείται σύνδεση.'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;
  v_target := coalesce(p_member_id, v_actor);
  IF v_target <> v_actor AND coalesce(v_role,'') NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Δεν επιτρέπεται κράτηση για άλλο μέλος.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_target AND role = 'customer') THEN
    RAISE EXCEPTION 'Δεν βρέθηκε ενεργό μέλος.';
  END IF;
  SELECT * INTO v_slot FROM public.basement_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT found OR NOT v_slot.enabled OR v_slot.starts_at <= now() THEN
    RAISE EXCEPTION 'Η ώρα δεν είναι διαθέσιμη.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.basement_bookings WHERE slot_id = p_slot_id AND member_id = v_target AND status = 'booked') THEN
    RAISE EXCEPTION 'Το μέλος έχει ήδη κράτηση σε αυτή την ώρα.';
  END IF;
  SELECT count(*) INTO v_count FROM public.basement_bookings WHERE slot_id = p_slot_id AND status = 'booked';
  IF v_count >= v_slot.capacity THEN RAISE EXCEPTION 'Οι θέσεις εξαντλήθηκαν.'; END IF;
  INSERT INTO public.basement_bookings(slot_id, member_id) VALUES (p_slot_id, v_target) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.basement_book(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.basement_book(bigint, uuid) TO authenticated;
