import { z } from 'zod';

export const CHARACTER_CLASSES = ['warrior', 'mage', 'taoist'] as const;

export const characterClassSchema = z.enum(CHARACTER_CLASSES);
export type CharacterClass = z.infer<typeof characterClassSchema>;

export type CharacterClassDefinition = {
  id: CharacterClass;
  name: string;
  description: string;
  baseMaxHp: number;
  baseMaxMp: number;
  baseAttack: number;
  baseDefense: number;
};

export const CHARACTER_CLASS_CATALOG: Record<CharacterClass, CharacterClassDefinition> = {
  warrior: {
    id: 'warrior',
    name: '战士',
    description: '近身高韧性，生命值最高，适合正面承伤。',
    baseMaxHp: 120,
    baseMaxMp: 30,
    baseAttack: 12,
    baseDefense: 8,
  },
  mage: {
    id: 'mage',
    name: '法师',
    description: '远程法术输出，法力值最高，防御较弱。',
    baseMaxHp: 80,
    baseMaxMp: 80,
    baseAttack: 8,
    baseDefense: 4,
  },
  taoist: {
    id: 'taoist',
    name: '道士',
    description: '持续伤害与辅助，属性均衡。',
    baseMaxHp: 95,
    baseMaxMp: 60,
    baseAttack: 9,
    baseDefense: 5,
  },
};

/**
 * Case-insensitive uniqueness key. NFKC folds full-width characters so
 * "ＡＢＣ" and "ABC" cannot both exist in one realm.
 */
export function normalizeCharacterName(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

export const characterNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(
    z
      .string()
      .min(2)
      .max(12)
      .regex(/^[\p{L}\p{N}_]+$/u, '角色名只能包含字母、数字、汉字和下划线'),
  );

export const realmViewSchema = z
  .object({
    id: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export type RealmView = z.infer<typeof realmViewSchema>;

export const realmsResponseSchema = z.object({ realms: z.array(realmViewSchema).max(64) }).strict();

export type RealmsResponse = z.infer<typeof realmsResponseSchema>;

export const characterViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(12),
    classId: characterClassSchema,
    level: z.number().int().min(1),
    exp: z.number().int().min(0),
    hp: z.number().int().min(0),
    maxHp: z.number().int().positive(),
    mp: z.number().int().min(0),
    maxMp: z.number().int().nonnegative(),
    mapId: z.string().min(1),
    /** Authoritative position in integer sub-tile units. */
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    facing: z.number().int().min(0).max(7),
    realmId: z.uuid(),
    realmCode: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type CharacterView = z.infer<typeof characterViewSchema>;

export const createCharacterRequestSchema = z
  .object({
    name: characterNameSchema,
    classId: characterClassSchema,
    realmId: z.uuid().optional(),
  })
  .strict();

export type CreateCharacterRequest = z.infer<typeof createCharacterRequestSchema>;

export const charactersResponseSchema = z
  .object({ characters: z.array(characterViewSchema).max(16) })
  .strict();

export type CharactersResponse = z.infer<typeof charactersResponseSchema>;

export const characterResponseSchema = z.object({ character: characterViewSchema }).strict();

export type CharacterResponse = z.infer<typeof characterResponseSchema>;

/** Tickets are consumed by the first WebSocket join that presents them. */
export const GAME_TICKET_TTL_SECONDS = 60 as const;

export const gameTicketRequestSchema = z.object({ characterId: z.uuid() }).strict();

export type GameTicketRequest = z.infer<typeof gameTicketRequestSchema>;

export const gameTicketResponseSchema = z
  .object({
    ticket: z.string().min(32).max(512),
    expiresAt: z.iso.datetime(),
    character: characterViewSchema,
  })
  .strict();

export type GameTicketResponse = z.infer<typeof gameTicketResponseSchema>;
