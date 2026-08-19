BEGIN;

ALTER TABLE public.groups
DROP CONSTRAINT IF EXISTS groups_stage_grade_check;

ALTER TABLE public.groups
ADD CONSTRAINT groups_stage_grade_check
CHECK (
  (
    stage = 'primary'
    AND grade = ANY (
      ARRAY[
        'kg'::text,
        'primary_foundation_a'::text,
        'primary_foundation_b'::text,
        'primary_foundation_c'::text,
        'primary_1'::text,
        'primary_2'::text,
        'primary_3'::text,
        'primary_4'::text,
        'primary_5'::text,
        'primary_6'::text
      ]
    )
  )
  OR
  (
    stage = 'prep'
    AND grade = ANY (
      ARRAY[
        'prep_1'::text,
        'prep_2'::text,
        'prep_3'::text
      ]
    )
  )
  OR
  (
    stage = 'secondary'
    AND grade = ANY (
      ARRAY[
        'secondary_1'::text,
        'secondary_2'::text,
        'secondary_3'::text
      ]
    )
  )
);

COMMIT;