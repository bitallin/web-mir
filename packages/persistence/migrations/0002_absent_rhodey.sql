CREATE TABLE "asset_commands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"currency_type" text DEFAULT 'gold' NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"reference_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currency_ledger_balance_non_negative" CHECK ("currency_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "item_instances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"template_id" text NOT NULL,
	"character_id" uuid,
	"container" text NOT NULL,
	"slot_index" integer,
	"equip_slot" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_instances_placement_check" CHECK ((
        ("item_instances"."container" = 'inventory' AND "item_instances"."character_id" IS NOT NULL
          AND "item_instances"."slot_index" IS NOT NULL AND "item_instances"."equip_slot" IS NULL)
        OR ("item_instances"."container" = 'equipment' AND "item_instances"."character_id" IS NOT NULL
          AND "item_instances"."equip_slot" IS NOT NULL AND "item_instances"."slot_index" IS NULL)
        OR ("item_instances"."container" = 'ground' AND "item_instances"."character_id" IS NULL
          AND "item_instances"."slot_index" IS NULL AND "item_instances"."equip_slot" IS NULL)
      )),
	CONSTRAINT "item_instances_quantity_check" CHECK ("item_instances"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_non_negative" CHECK ("wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "world_drops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"map_id" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"item_instance_id" uuid NOT NULL,
	"owner_character_id" uuid,
	"owner_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by_character_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_commands" ADD CONSTRAINT "asset_commands_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_ledger" ADD CONSTRAINT "currency_ledger_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_drops" ADD CONSTRAINT "world_drops_item_instance_id_item_instances_id_fk" FOREIGN KEY ("item_instance_id") REFERENCES "public"."item_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_drops" ADD CONSTRAINT "world_drops_owner_character_id_characters_id_fk" FOREIGN KEY ("owner_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_drops" ADD CONSTRAINT "world_drops_claimed_by_character_id_characters_id_fk" FOREIGN KEY ("claimed_by_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_commands_idempotency_unique" ON "asset_commands" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "asset_commands_character_idx" ON "asset_commands" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "currency_ledger_idempotency_unique" ON "currency_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "currency_ledger_character_idx" ON "currency_ledger" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "item_instances_inventory_slot_unique" ON "item_instances" USING btree ("character_id","slot_index") WHERE "item_instances"."container" = 'inventory';--> statement-breakpoint
CREATE UNIQUE INDEX "item_instances_equipment_slot_unique" ON "item_instances" USING btree ("character_id","equip_slot") WHERE "item_instances"."container" = 'equipment';--> statement-breakpoint
CREATE INDEX "item_instances_character_idx" ON "item_instances" USING btree ("character_id","container");--> statement-breakpoint
CREATE INDEX "item_instances_ground_idx" ON "item_instances" USING btree ("template_id") WHERE "item_instances"."container" = 'ground';--> statement-breakpoint
CREATE UNIQUE INDEX "world_drops_item_unique" ON "world_drops" USING btree ("item_instance_id");--> statement-breakpoint
CREATE INDEX "world_drops_open_idx" ON "world_drops" USING btree ("map_id","claimed_at","expires_at");--> statement-breakpoint
CREATE INDEX "world_drops_claimant_idx" ON "world_drops" USING btree ("claimed_by_character_id");