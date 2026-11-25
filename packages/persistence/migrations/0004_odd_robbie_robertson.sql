CREATE TYPE "public"."admin_audit_result" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."admin_command_status" AS ENUM('pending', 'dispatched', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."admin_command_type" AS ENUM('kick', 'ban', 'mute');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'ops_admin', 'game_master', 'content_designer', 'release_approver', 'analyst', 'readonly_auditor');--> statement-breakpoint
CREATE TYPE "public"."admin_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."content_section" AS ENUM('classes', 'skills', 'monsters', 'items', 'lootTables');--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" text NOT NULL,
	"actor_admin_id" uuid,
	"actor_username" text NOT NULL,
	"actor_role" "admin_role" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"result" "admin_audit_result" NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"username" text NOT NULL,
	"username_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"status" "admin_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_normalized_unique" UNIQUE("username_normalized")
);
--> statement-breakpoint
CREATE TABLE "content_activations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"realm_id" uuid NOT NULL,
	"content_release_id" uuid NOT NULL,
	"activated_by" uuid,
	"activated_by_username" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section" "content_section" NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_by_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_drafts_section_unique" UNIQUE("section")
);
--> statement-breakpoint
CREATE TABLE "content_releases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version" text NOT NULL,
	"schema_version" integer NOT NULL,
	"checksum" text NOT NULL,
	"payload" jsonb NOT NULL,
	"change_summary" jsonb NOT NULL,
	"created_by" uuid,
	"created_by_username" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_releases_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"command_id" uuid NOT NULL,
	"type" "admin_command_type" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_admin_id" uuid,
	"actor_username" text NOT NULL,
	"audit_log_id" uuid,
	"status" "admin_command_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "realm_active_content" (
	"realm_id" uuid PRIMARY KEY NOT NULL,
	"content_release_id" uuid NOT NULL,
	"activated_by" uuid,
	"activated_by_username" text NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_activations" ADD CONSTRAINT "content_activations_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_activations" ADD CONSTRAINT "content_activations_content_release_id_content_releases_id_fk" FOREIGN KEY ("content_release_id") REFERENCES "public"."content_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_activations" ADD CONSTRAINT "content_activations_activated_by_admin_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_releases" ADD CONSTRAINT "content_releases_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_audit_log_id_admin_audit_logs_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."admin_audit_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_active_content" ADD CONSTRAINT "realm_active_content_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_active_content" ADD CONSTRAINT "realm_active_content_content_release_id_content_releases_id_fk" FOREIGN KEY ("content_release_id") REFERENCES "public"."content_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_active_content" ADD CONSTRAINT "realm_active_content_activated_by_admin_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_actor_idx" ON "admin_audit_logs" USING btree ("actor_username","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_action_idx" ON "admin_audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "content_activations_realm_idx" ON "content_activations" USING btree ("realm_id","created_at");--> statement-breakpoint
CREATE INDEX "content_releases_created_idx" ON "content_releases" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_command_unique" ON "outbox_events" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_events_target_idx" ON "outbox_events" USING btree ("target_type","target_id","created_at");