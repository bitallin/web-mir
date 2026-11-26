CREATE TABLE "character_quests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"quest_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_quests_progress_non_negative" CHECK ("character_quests"."progress" >= 0),
	CONSTRAINT "character_quests_completed_at_check" CHECK (("character_quests"."status" = 'active') = ("character_quests"."completed_at" IS NULL)),
	CONSTRAINT "character_quests_claimed_at_check" CHECK (("character_quests"."status" = 'claimed') = ("character_quests"."claimed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "character_quests" ADD CONSTRAINT "character_quests_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_quests_character_quest_unique" ON "character_quests" USING btree ("character_id","quest_id");--> statement-breakpoint
CREATE INDEX "character_quests_character_status_idx" ON "character_quests" USING btree ("character_id","status");