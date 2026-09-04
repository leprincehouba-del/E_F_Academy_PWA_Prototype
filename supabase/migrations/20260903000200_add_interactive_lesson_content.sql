BEGIN;

CREATE TABLE IF NOT EXISTS public.lesson_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.groups(id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  title text NOT NULL,
  vocabulary jsonb NOT NULL DEFAULT '[]'::jsonb,
  reading_text text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_contents_title_length_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT lesson_contents_vocabulary_array_check
    CHECK (jsonb_typeof(vocabulary) = 'array'),
  CONSTRAINT lesson_contents_reading_length_check
    CHECK (reading_text IS NULL OR char_length(reading_text) <= 50000),
  CONSTRAINT lesson_contents_notes_length_check
    CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_contents_group_date_unique
  ON public.lesson_contents (group_id, lesson_date);

CREATE INDEX IF NOT EXISTS lesson_contents_parent_lookup_idx
  ON public.lesson_contents (group_id, lesson_date DESC)
  WHERE is_active = true;

ALTER TABLE public.lesson_contents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lesson_contents FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_lesson_content()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
  v_active boolean;
BEGIN
  SELECT role, is_active
  INTO v_role, v_active
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF COALESCE(v_active, false) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF v_role = 'manager' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.manager_permissions mp
      WHERE mp.user_id = auth.uid()
        AND COALESCE(mp.permissions ->> 'attendance_edit', 'false') = 'true'
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_lesson_content()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_lesson_content()
  TO service_role;

CREATE OR REPLACE FUNCTION public.save_lesson_content(
  p_content_id uuid,
  p_group_id uuid,
  p_lesson_date date,
  p_title text,
  p_vocabulary jsonb,
  p_reading_text text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_content public.lesson_contents%ROWTYPE;
  v_vocabulary jsonb := COALESCE(p_vocabulary, '[]'::jsonb);
  v_reading_text text := NULLIF(btrim(COALESCE(p_reading_text, '')), '');
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  IF NOT public.can_manage_lesson_content() THEN
    RAISE EXCEPTION 'LESSON_CONTENT_PERMISSION_DENIED';
  END IF;

  IF p_group_id IS NULL OR p_lesson_date IS NULL THEN
    RAISE EXCEPTION 'LESSON_GROUP_AND_DATE_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.is_active = true
  ) THEN
    RAISE EXCEPTION 'LESSON_GROUP_NOT_FOUND';
  END IF;

  IF char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'INVALID_LESSON_TITLE';
  END IF;

  IF jsonb_typeof(v_vocabulary) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_LESSON_VOCABULARY';
  END IF;

  IF jsonb_array_length(v_vocabulary) > 300 THEN
    RAISE EXCEPTION 'TOO_MANY_LESSON_VOCABULARY_ITEMS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_vocabulary) item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR char_length(btrim(COALESCE(item ->> 'english', ''))) NOT BETWEEN 1 AND 500
       OR char_length(COALESCE(item ->> 'arabic', '')) > 1000
  ) THEN
    RAISE EXCEPTION 'INVALID_LESSON_VOCABULARY_ITEM';
  END IF;

  IF v_reading_text IS NOT NULL AND char_length(v_reading_text) > 50000 THEN
    RAISE EXCEPTION 'LESSON_READING_TEXT_TOO_LONG';
  END IF;

  IF v_notes IS NOT NULL AND char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'LESSON_NOTES_TOO_LONG';
  END IF;

  IF jsonb_array_length(v_vocabulary) = 0 AND v_reading_text IS NULL THEN
    RAISE EXCEPTION 'LESSON_CONTENT_IS_EMPTY';
  END IF;

  IF p_content_id IS NULL THEN
    INSERT INTO public.lesson_contents (
      group_id,
      lesson_date,
      title,
      vocabulary,
      reading_text,
      notes,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      p_group_id,
      p_lesson_date,
      btrim(p_title),
      v_vocabulary,
      v_reading_text,
      v_notes,
      true,
      auth.uid(),
      auth.uid()
    )
    ON CONFLICT (group_id, lesson_date) DO UPDATE
    SET title = EXCLUDED.title,
        vocabulary = EXCLUDED.vocabulary,
        reading_text = EXCLUDED.reading_text,
        notes = EXCLUDED.notes,
        is_active = true,
        updated_by = auth.uid(),
        updated_at = now()
    RETURNING * INTO v_content;
  ELSE
    UPDATE public.lesson_contents
    SET group_id = p_group_id,
        lesson_date = p_lesson_date,
        title = btrim(p_title),
        vocabulary = v_vocabulary,
        reading_text = v_reading_text,
        notes = v_notes,
        is_active = true,
        updated_by = auth.uid(),
        updated_at = now()
    WHERE id = p_content_id
    RETURNING * INTO v_content;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LESSON_CONTENT_NOT_FOUND';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_content.id,
    'group_id', v_content.group_id,
    'lesson_date', v_content.lesson_date,
    'updated_at', v_content.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_lesson_content(
  uuid, uuid, date, text, jsonb, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lesson_content(
  uuid, uuid, date, text, jsonb, text, text
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_lesson_contents_for_admin(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_manage_lesson_content() THEN
    RAISE EXCEPTION 'LESSON_CONTENT_PERMISSION_DENIED';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(content_row)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lc.id,
      lc.group_id,
      lc.lesson_date,
      lc.title,
      lc.vocabulary,
      lc.reading_text,
      lc.notes,
      lc.created_at,
      lc.updated_at
    FROM public.lesson_contents lc
    WHERE lc.group_id = p_group_id
      AND lc.is_active = true
    ORDER BY lc.lesson_date DESC, lc.updated_at DESC
    LIMIT 40
  ) content_row;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lesson_contents_for_admin(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lesson_contents_for_admin(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_lesson_content_active(
  p_content_id uuid,
  p_is_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_manage_lesson_content() THEN
    RAISE EXCEPTION 'LESSON_CONTENT_PERMISSION_DENIED';
  END IF;

  UPDATE public.lesson_contents
  SET is_active = COALESCE(p_is_active, false),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_content_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LESSON_CONTENT_NOT_FOUND';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_lesson_content_active(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lesson_content_active(uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_parent_lesson_contents(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_phone_tail text;
  v_group_id uuid;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'parent'
      AND up.is_active = true
  ) THEN
    RAISE EXCEPTION 'PARENT_PERMISSION_REQUIRED';
  END IF;

  v_phone_tail := right(
    regexp_replace(
      split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1),
      '\D',
      '',
      'g'
    ),
    10
  );

  IF length(v_phone_tail) < 10 THEN
    RAISE EXCEPTION 'PARENT_PHONE_NOT_AVAILABLE';
  END IF;

  SELECT s.group_id
  INTO v_group_id
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.is_active = true
    AND right(
      regexp_replace(COALESCE(s.parent_phone, ''), '\D', '', 'g'),
      10
    ) = v_phone_tail;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_STUDENT_ACCESS_DENIED';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(content_row)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lc.id,
      lc.lesson_date,
      lc.title,
      lc.vocabulary,
      lc.reading_text,
      lc.notes
    FROM public.lesson_contents lc
    WHERE lc.group_id = v_group_id
      AND lc.is_active = true
      AND lc.lesson_date <= (now() AT TIME ZONE 'Africa/Cairo')::date
    ORDER BY lc.lesson_date DESC, lc.updated_at DESC
    LIMIT 40
  ) content_row;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_parent_lesson_contents(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_lesson_contents(uuid)
  TO authenticated, service_role;

COMMIT;
