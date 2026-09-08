ALTER TABLE store_print_setting
ALTER COLUMN content_options SET DEFAULT '{
  "showStoreName":true,"showStoreAddress":true,"showStorePhone":true,"showOrderNumbers":true,
  "showRoom":true,"showServiceArea":true,"showProjects":true,"showClockType":true,"showTechnician":true,
  "showDuration":true,"showQuantity":true,"showUnitPrice":true,"showLineAmount":true,
  "showSubtotal":true,"showBeforeDiscount":true,"showDiscount":true,"showReceivable":true,
  "showPayment":true,"showChange":true,"showMember":true,"showMemberPhone":true,"showBalance":true,
  "showCashier":true,"showCreatedAt":true,"showSettledAt":true,"showPrintedAt":true,"showPrintCopies":true,
  "showHeader":true,"showFooter":true
}'::jsonb;

UPDATE store_print_setting
SET content_options = jsonb_set(
  COALESCE(content_options, '{}'::jsonb),
  '{showClockType}',
  'true'::jsonb,
  true
)
WHERE NOT (COALESCE(content_options, '{}'::jsonb) ? 'showClockType');
