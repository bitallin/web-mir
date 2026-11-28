CREATE TABLE "guild_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"guild_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_applications" ADD CONSTRAINT "guild_applications_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_applications" ADD CONSTRAINT "guild_applications_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_applications_guild_character_unique" ON "guild_applications" USING btree ("guild_id","character_id");--> statement-breakpoint
CREATE INDEX "guild_applications_guild_idx" ON "guild_applications" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "guild_applications_character_idx" ON "guild_applications" USING btree ("character_id");