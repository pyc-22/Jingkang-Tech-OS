-- READ ONLY. Run with a read-only database role and capture every result set.
-- Set store_id/from_date/to_date in params for a focused audit; NULL means all stores/all dates.
WITH params AS (
  SELECT CAST(NULL AS uuid) AS store_id,
         CAST(NULL AS date) AS from_date,
         CAST(NULL AS date) AS to_date
),
latest_order AS (
  SELECT DISTINCT ON (link.service_session_id)
         link.service_session_id, order_header.id order_id,
         order_header.order_no, order_header.status order_status,
         order_header.refund_status
  FROM sales_order_service_session link
  JOIN sales_order order_header ON order_header.id = link.order_id
  JOIN params p ON p.store_id IS NULL OR link.store_id = p.store_id
  ORDER BY link.service_session_id, link.created_at DESC, link.id DESC
),
session_state AS (
  SELECT ss.id, ss.store_id, ss.room_id, ss.bed_id, ss.technician_id,
         ss.status, ss.created_at, ss.ended_at,
         latest_order.order_id, latest_order.order_no,
         latest_order.order_status, latest_order.refund_status,
         (ss.status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED',
                        'DISPATCH_CANCELLED','IN_SERVICE')
          OR (ss.status = 'COMPLETED'
              AND CASE WHEN latest_order.order_status = 'CANCELLED' THEN false
                       WHEN latest_order.order_status = 'SETTLED'
                            AND latest_order.refund_status = 'FULL' THEN true
                       WHEN latest_order.order_status = 'SETTLED' THEN false
                       ELSE true END)) AS occupies_bed
  FROM service_session ss
  LEFT JOIN latest_order ON latest_order.service_session_id = ss.id
  JOIN params p ON p.store_id IS NULL OR ss.store_id = p.store_id
)
SELECT 'ROOM_STATE_MISMATCH' issue_code,
       room.id room_id, room.code room_code, room.name room_name,
       event.status event_status,
       CASE
         WHEN EXISTS (SELECT 1 FROM session_state s
                      WHERE s.room_id=room.id AND s.status='IN_SERVICE') THEN 'IN_SERVICE'
         WHEN EXISTS (SELECT 1 FROM session_state s
                      WHERE s.room_id=room.id
                        AND s.status IN ('PENDING_ACCEPTANCE','ACCEPTED',
                                         'REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED')) THEN 'RESERVED'
         WHEN EXISTS (SELECT 1 FROM session_state s
                      WHERE s.room_id=room.id AND s.status='COMPLETED'
                        AND s.occupies_bed) THEN 'PENDING_PAYMENT'
         ELSE COALESCE(event.status,'IDLE')
       END derived_status,
       'KEEP' suggested_action
FROM room
LEFT JOIN LATERAL (
  SELECT status FROM room_status_event
  WHERE room_id=room.id
  ORDER BY occurred_at DESC, id DESC LIMIT 1
) event ON true
JOIN params p ON p.store_id IS NULL OR room.store_id=p.store_id
WHERE room.active
  AND event.status IS DISTINCT FROM CASE
    WHEN EXISTS (SELECT 1 FROM session_state s
                 WHERE s.room_id=room.id AND s.status='IN_SERVICE') THEN 'IN_SERVICE'
    WHEN EXISTS (SELECT 1 FROM session_state s
                 WHERE s.room_id=room.id
                   AND s.status IN ('PENDING_ACCEPTANCE','ACCEPTED',
                                    'REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED')) THEN 'RESERVED'
    WHEN EXISTS (SELECT 1 FROM session_state s
                 WHERE s.room_id=room.id AND s.status='COMPLETED'
                   AND s.occupies_bed) THEN 'PENDING_PAYMENT'
    ELSE COALESCE(event.status,'IDLE')
  END
ORDER BY room.code;

-- Active/unsettled sessions without a valid active bed.
WITH params AS (
  SELECT CAST(NULL AS uuid) AS store_id
),
latest_order AS (
  SELECT DISTINCT ON (link.service_session_id)
         link.service_session_id, order_header.status order_status,
         order_header.refund_status
  FROM sales_order_service_session link
  JOIN sales_order order_header ON order_header.id=link.order_id
  ORDER BY link.service_session_id, link.created_at DESC, link.id DESC
)
SELECT 'BED_ASSIGNMENT_MISMATCH' issue_code,
       session.id service_session_id, session.store_id, session.room_id,
       room.code room_code, session.bed_id,
       bed.room_id bed_room_id, bed.active bed_active,
       CASE WHEN session.bed_id IS NULL THEN 'ASSIGN_BED' ELSE 'KEEP' END suggested_action
FROM service_session session
JOIN room ON room.id=session.room_id
LEFT JOIN room_bed bed ON bed.id=session.bed_id
LEFT JOIN latest_order ON latest_order.service_session_id=session.id
JOIN params p ON p.store_id IS NULL OR session.store_id=p.store_id
WHERE (session.status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED',
                          'DISPATCH_CANCELLED','IN_SERVICE')
       OR (session.status='COMPLETED'
           AND CASE WHEN latest_order.order_status='CANCELLED' THEN false
                    WHEN latest_order.order_status='SETTLED'
                         AND latest_order.refund_status='FULL' THEN true
                    WHEN latest_order.order_status='SETTLED' THEN false
                    ELSE true END))
  AND (session.bed_id IS NULL OR bed.room_id<>session.room_id OR NOT bed.active)
ORDER BY room.code, session.created_at;

-- Duplicate occupying sessions on one bed.
WITH params AS (
  SELECT CAST(NULL AS uuid) AS store_id
),
latest_order AS (
  SELECT DISTINCT ON (link.service_session_id)
         link.service_session_id, order_header.status order_status,
         order_header.refund_status
  FROM sales_order_service_session link
  JOIN sales_order order_header ON order_header.id=link.order_id
  ORDER BY link.service_session_id, link.created_at DESC, link.id DESC
)
SELECT 'DUPLICATE_BED_OCCUPANCY' issue_code, session.store_id,
       session.room_id, session.bed_id, room.code room_code,
       count(*) occupying_session_count,
       string_agg(session.id::text, ',' ORDER BY session.created_at) service_session_ids,
       'KEEP' suggested_action
FROM service_session session
JOIN room ON room.id=session.room_id
LEFT JOIN latest_order ON latest_order.service_session_id=session.id
JOIN params p ON p.store_id IS NULL OR session.store_id=p.store_id
WHERE session.bed_id IS NOT NULL
  AND (session.status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED',
                          'DISPATCH_CANCELLED','IN_SERVICE')
       OR (session.status='COMPLETED'
           AND CASE WHEN latest_order.order_status='CANCELLED' THEN false
                    WHEN latest_order.order_status='SETTLED'
                         AND latest_order.refund_status='FULL' THEN true
                    WHEN latest_order.order_status='SETTLED' THEN false
                    ELSE true END))
GROUP BY session.store_id, session.room_id, session.bed_id, room.code
HAVING count(*) > 1
ORDER BY room.code, session.bed_id;

-- Completed services, including normal pending services and confirmed replacement candidates.
WITH params AS (
  SELECT CAST(NULL AS uuid) AS store_id
),
latest_order AS (
  SELECT DISTINCT ON (link.service_session_id)
         link.service_session_id, order_header.id order_id,
         order_header.order_no, order_header.status order_status,
         order_header.refund_status
  FROM sales_order_service_session link
  JOIN sales_order order_header ON order_header.id=link.order_id
  ORDER BY link.service_session_id, link.created_at DESC, link.id DESC
)
SELECT 'ORDER_LINK_MISMATCH' issue_code,
       session.id service_session_id, session.store_id, session.room_id,
       room.code room_code, latest_order.order_id, latest_order.order_no,
       latest_order.order_status, latest_order.refund_status,
       CASE WHEN latest_order.order_id IS NULL THEN 'KEEP'
            WHEN latest_order.order_status='CANCELLED' THEN 'LINK_ORDER'
            ELSE 'KEEP' END suggested_action
FROM service_session session
JOIN room ON room.id=session.room_id
LEFT JOIN latest_order ON latest_order.service_session_id=session.id
JOIN params p ON p.store_id IS NULL OR session.store_id=p.store_id
WHERE session.status='COMPLETED'
ORDER BY room.code, session.ended_at;

-- Participant/session lifecycle discrepancies.
SELECT 'TECHNICIAN_STATE_MISMATCH' issue_code,
       participant.id participant_id, participant.store_id,
       participant.service_session_id, session.status session_status,
       participant.status participant_status, participant.technician_id,
       CASE WHEN participant.status IN ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')
                  AND session.status IN ('COMPLETED','CANCELLED','VOIDED')
            THEN 'VOID' ELSE 'KEEP' END suggested_action
FROM service_session_participant participant
JOIN service_session session ON session.id=participant.service_session_id
WHERE participant.status IN ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')
  AND session.status IN ('COMPLETED','CANCELLED','VOIDED')
   OR participant.status='COMPLETED' AND session.status<>'COMPLETED'
ORDER BY participant.created_at;

-- Configured bed count versus active bed rows. Review zz-wanda/777 separately.
SELECT 'BED_CONFIG_MISMATCH' issue_code,
       room.id room_id, room.store_id, room.code room_code, room.name room_name,
       room.bed_count configured_bed_count,
       count(bed.id) FILTER (WHERE bed.active) active_bed_count,
       'KEEP' suggested_action
FROM room
LEFT JOIN room_bed bed ON bed.room_id=room.id
WHERE room.active
GROUP BY room.id, room.store_id, room.code, room.name, room.bed_count
HAVING room.bed_count <> count(bed.id) FILTER (WHERE bed.active)
ORDER BY room.code;

-- Payment and refund rows that lost their actual member card.
SELECT 'PAYMENT_WALLET_MISSING' issue_code,
       payment.id payment_id, payment.store_id, payment.order_id,
       order_header.order_no, payment.payment_method, payment.amount_cents,
       'LINK_ORDER' suggested_action
FROM payment_record payment
JOIN sales_order order_header ON order_header.id=payment.order_id
WHERE payment.payment_method='MEMBER_BALANCE' AND payment.wallet_id IS NULL
UNION ALL
SELECT 'REFUND_WALLET_MISSING', refund_payment.id, refund_payment.store_id,
       refund.order_id, order_header.order_no, refund_payment.payment_method,
       refund_payment.amount_cents, 'LINK_ORDER'
FROM refund_payment_record refund_payment
JOIN sales_refund refund ON refund.id=refund_payment.refund_id
JOIN sales_order order_header ON order_header.id=refund.order_id
WHERE refund_payment.payment_method='MEMBER_BALANCE'
  AND refund_payment.wallet_id IS NULL;

-- Wallet balance versus the complete posted transaction ledger.
SELECT 'WALLET_BALANCE_MISMATCH' issue_code,
       wallet.id wallet_id, wallet.member_id, wallet.opened_store_id,
       wallet.balance_cents,
       coalesce(sum(transaction_row.amount_cents),0) ledger_balance_cents,
       wallet.balance_cents-coalesce(sum(transaction_row.amount_cents),0) difference_cents,
       'KEEP' suggested_action
FROM member_wallet wallet
LEFT JOIN wallet_transaction transaction_row ON transaction_row.wallet_id=wallet.id
GROUP BY wallet.id, wallet.member_id, wallet.opened_store_id, wallet.balance_cents
HAVING wallet.balance_cents<>coalesce(sum(transaction_row.amount_cents),0)
ORDER BY wallet.id;

-- Consumption rows whose amount/order does not match the settlement contract.
SELECT 'CONSUMPTION_ORDER_MISMATCH' issue_code,
       transaction_row.id wallet_transaction_id, transaction_row.store_id,
       transaction_row.member_id, transaction_row.note order_id_text,
       transaction_row.amount_cents, 'LINK_ORDER' suggested_action
FROM wallet_transaction transaction_row
LEFT JOIN sales_order order_header
  ON order_header.id=CASE WHEN transaction_row.note ~* '^[0-9a-f-]{36}$'
                          THEN transaction_row.note::uuid END
 AND order_header.store_id=transaction_row.store_id
WHERE transaction_row.transaction_type='CONSUMPTION'
  AND (transaction_row.amount_cents>=0 OR order_header.id IS NULL
       OR order_header.status<>'SETTLED');
