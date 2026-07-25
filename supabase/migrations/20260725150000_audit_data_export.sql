-- ============================================================================
-- audit_log: allow a 'data_export' log type
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
--
-- Exporting the contact list pulls personal data out of the system, and the build
-- plan wanted it recorded in the audit log. The existing CHECK on log_type had no
-- suitable value: 'api_call' is an action, not a log type. Rather than filing
-- exports under 'record_change' (which they are not), add a dedicated value.
--
-- Rows written by the export use log_type='data_export', action='api_call',
-- source='export', as the plan specified.
-- ============================================================================

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_log_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_log_type_check
  CHECK (log_type IN (
    'inbound_form',
    'record_change',
    'subscription_change',
    'permission_change',
    'user_change',
    'data_export'
  ));
