ALTER TABLE store_print_setting ADD COLUMN content_options JSONB NOT NULL DEFAULT '{
  "showStoreName":true,"showStoreAddress":true,"showStorePhone":true,"showOrderNumbers":true,
  "showRoom":true,"showServiceArea":true,"showProjects":true,"showTechnician":true,
  "showDuration":true,"showQuantity":true,"showUnitPrice":true,"showLineAmount":true,
  "showSubtotal":true,"showBeforeDiscount":true,"showDiscount":true,"showReceivable":true,
  "showPayment":true,"showChange":true,"showMember":true,"showMemberPhone":true,"showBalance":true,
  "showCashier":true,"showCreatedAt":true,"showSettledAt":true,"showPrintedAt":true,"showPrintCopies":true,
  "showHeader":true,"showFooter":true
}'::jsonb;

UPDATE store_print_setting
SET content_options = jsonb_build_object(
  'showStoreName', TRUE, 'showStoreAddress', show_store_address, 'showStorePhone', show_store_phone,
  'showOrderNumbers', show_order_no, 'showRoom', show_room, 'showServiceArea', TRUE, 'showProjects', TRUE,
  'showTechnician', show_technician, 'showDuration', TRUE, 'showQuantity', TRUE, 'showUnitPrice', TRUE,
  'showLineAmount', TRUE, 'showSubtotal', TRUE, 'showBeforeDiscount', TRUE, 'showDiscount', TRUE,
  'showReceivable', TRUE, 'showPayment', show_payment, 'showChange', TRUE, 'showMember', show_member,
  'showMemberPhone', TRUE, 'showBalance', show_balance, 'showCashier', TRUE, 'showCreatedAt', TRUE,
  'showSettledAt', TRUE, 'showPrintedAt', TRUE, 'showPrintCopies', TRUE, 'showHeader', TRUE, 'showFooter', TRUE
);
