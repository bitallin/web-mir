CREATE TABLE "guild_members" (
	"guild_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_members_guild_id_character_id_pk" PRIMARY KEY("guild_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"realm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_members_character_unique" ON "guild_members" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_members_single_leader" ON "guild_members" USING btree ("guild_id") WHERE "guild_members"."role" = 'leader';--> statement-breakpoint
CREATE INDEX "guild_members_guild_idx" ON "guild_members" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guilds_realm_name_unique" ON "guilds" USING btree ("realm_id","name_normalized");