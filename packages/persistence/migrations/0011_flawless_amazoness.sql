CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"low_character_id" uuid NOT NULL,
	"high_character_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friendships_pair_order_check" CHECK ("friendships"."low_character_id" < "friendships"."high_character_id"),
	CONSTRAINT "friendships_requested_by_check" CHECK ("friendships"."requested_by_id" = "friendships"."low_character_id" OR "friendships"."requested_by_id" = "friendships"."high_character_id"),
	CONSTRAINT "friendships_responded_at_check" CHECK (("friendships"."status" = 'pending') = ("friendships"."responded_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_low_character_id_characters_id_fk" FOREIGN KEY ("low_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_high_character_id_characters_id_fk" FOREIGN KEY ("high_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_id_characters_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_unique" ON "friendships" USING btree ("low_character_id","high_character_id");--> statement-breakpoint
CREATE INDEX "friendships_low_status_idx" ON "friendships" USING btree ("low_character_id","status");--> statement-breakpoint
CREATE INDEX "friendships_high_status_idx" ON "friendships" USING btree ("high_character_id","status");