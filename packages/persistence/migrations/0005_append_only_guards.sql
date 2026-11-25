-- Audit, immutable releases and activation history are append-only (ADR-022).
-- The application has no update/delete path; these triggers make the database
-- refuse one as well.
CREATE OR REPLACE FUNCTION web_legend_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "admin_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION web_legend_reject_mutation();

CREATE TRIGGER content_releases_append_only
  BEFORE UPDATE OR DELETE ON "content_releases"
  FOR EACH ROW EXECUTE FUNCTION web_legend_reject_mutation();

CREATE TRIGGER content_activations_append_only
  BEFORE UPDATE OR DELETE ON "content_activations"
  FOR EACH ROW EXECUTE FUNCTION web_legend_reject_mutation();
