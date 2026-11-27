DROP INDEX "character_quests_character_quest_unique";--> statement-breakpoint
ALTER TABLE "character_quests" ADD COLUMN "period_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "character_quests_character_quest_period_unique" ON "character_quests" USING btree ("character_id","quest_id","period_key");