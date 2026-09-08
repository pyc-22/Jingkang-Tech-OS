UPDATE store_print_setting
SET content_options = jsonb_set(
  COALESCE(content_options, '{}'::jsonb),
  '{showClockType}',
  'true'::jsonb,
  true
)
WHERE NOT (COALESCE(content_options, '{}'::jsonb) ? 'showClockType');
