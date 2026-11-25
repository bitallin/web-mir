import { z } from 'zod';

/**
 * Combat wire contract shared by the game server and the browser. The browser
 * submits intent only (which target, which skill); every number in a
 * `combat.event` is produced by the authoritative server.
 */

export const COMBAT_CONTENT_VERSION = 'phase4.1' as const;

export const MONSTER_STATES = ['idle', 'patrol', 'chase', 'attack', 'return', 'dead'] as const;

export const monsterStateKindSchema = z.enum(MONSTER_STATES);
export type MonsterStateKind = z.infer<typeof monsterStateKindSchema>;

/** Numeric encoding used by the Colyseus `MonsterState.state` field. */
export const MONSTER_STATE_CODES: Record<MonsterStateKind, number> = {
  idle: 0,
  patrol: 1,
  chase: 2,
  attack: 3,
  return: 4,
  dead: 5,
};

export const MONSTER_STATE_LABELS: Record<MonsterStateKind, string> = {
  idle: '待机',
  patrol: '巡逻',
  chase: '追击',
  attack: '攻击',
  return: '返回',
  dead: '死亡',
};

export function monsterStateKindFromCode(code: number): MonsterStateKind {
  switch (code) {
    case MONSTER_STATE_CODES.patrol:
      return 'patrol';
    case MONSTER_STATE_CODES.chase:
      return 'chase';
    case MONSTER_STATE_CODES.attack:
      return 'attack';
    case MONSTER_STATE_CODES.return:
      return 'return';
    case MONSTER_STATE_CODES.dead:
      return 'dead';
    default:
      return 'idle';
  }
}

export const combatEntityTypeSchema = z.enum(['player', 'monster']);
export type CombatEntityType = z.infer<typeof combatEntityTypeSchema>;

const skillIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'skill id must be lowercase snake_case');

const targetIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'target id contains unsupported characters');

export const combatBasicAttackSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    commandId: z.uuid(),
    clientSequence: z.number().int().min(0).max(2_147_483_647),
    targetId: targetIdSchema,
  })
  .strict();

export type CombatBasicAttack = z.infer<typeof combatBasicAttackSchema>;

const autoAttackCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

/**
 * Locks one visible target and asks the server to approach and attack it on
 * the authoritative cooldown. The client never supplies a position or a hit.
 */
export const combatEngageSchema = z
  .object({
    ...autoAttackCommandBase,
    targetId: targetIdSchema,
  })
  .strict();

export type CombatEngage = z.infer<typeof combatEngageSchema>;

/** Resumes auto-attack, optionally switching to a new locked target. */
export const combatAutoAttackStartSchema = z
  .object({
    ...autoAttackCommandBase,
    targetId: targetIdSchema.optional(),
  })
  .strict();

export type CombatAutoAttackStart = z.infer<typeof combatAutoAttackStartSchema>;

export const combatAutoAttackStopSchema = z.object(autoAttackCommandBase).strict();

export type CombatAutoAttackStop = z.infer<typeof combatAutoAttackStopSchema>;

export const COMBAT_TARGET_CHANGE_REASONS = [
  'engaged',
  'approaching',
  'attacking',
  'stopped',
  'target_dead',
  'target_lost',
  'target_gone',
  'player_dead',
  'out_of_range',
  'safe_zone',
  'transferred',
] as const;

export const combatTargetChangeReasonSchema = z.enum(COMBAT_TARGET_CHANGE_REASONS);
export type CombatTargetChangeReason = z.infer<typeof combatTargetChangeReasonSchema>;

/**
 * Server-owned auto-attack status. `nextAttackAt` is a server epoch timestamp
 * so the HUD attack bar counts down without the client deciding readiness.
 */
export const combatTargetChangedSchema = z
  .object({
    targetId: targetIdSchema.nullable(),
    autoAttack: z.boolean(),
    reason: combatTargetChangeReasonSchema,
    attackIntervalMs: z.number().int().positive(),
    nextAttackAt: z.number().nonnegative(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type CombatTargetChanged = z.infer<typeof combatTargetChangedSchema>;

export const skillCastSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    commandId: z.uuid(),
    clientSequence: z.number().int().min(0).max(2_147_483_647),
    skillId: skillIdSchema,
    /** Self-targeted skills ignore this; enemy skills require a visible monster. */
    targetId: targetIdSchema,
  })
  .strict();

export type SkillCast = z.infer<typeof skillCastSchema>;

export const skillViewSchema = z
  .object({
    id: skillIdSchema,
    name: z.string().min(1).max(32),
    description: z.string().min(1).max(120),
    mpCost: z.number().int().nonnegative(),
    cooldownMs: z.number().int().nonnegative(),
    rangeTiles: z.number().positive(),
    target: z.enum(['enemy', 'self']),
    hotkey: z.string().min(1).max(2),
    cooldownRemainingMs: z.number().int().nonnegative(),
  })
  .strict();

export type SkillView = z.infer<typeof skillViewSchema>;

/**
 * Sent on join and reconnect. It tells the browser which skills its class owns
 * and how long server-side cooldowns have left; the browser never decides
 * whether a skill is ready.
 */
export const combatProfileSchema = z
  .object({
    characterId: z.uuid(),
    classId: z.enum(['warrior', 'mage', 'taoist']),
    level: z.number().int().min(1),
    attack: z.number().int().nonnegative(),
    defense: z.number().int().nonnegative(),
    attackIntervalMs: z.number().int().positive(),
    attackRangeTiles: z.number().positive(),
    /** Server-enforced PvP rule for the room's map (ADR-021). */
    pvpEnabled: z.boolean(),
    /** Time from death to automatic revival at the map's respawn point. */
    reviveMs: z.number().int().nonnegative(),
    hp: z.number().int().nonnegative(),
    maxHp: z.number().int().positive(),
    mp: z.number().int().nonnegative(),
    maxMp: z.number().int().nonnegative(),
    skills: z.array(skillViewSchema).max(8),
  })
  .strict();

export type CombatProfile = z.infer<typeof combatProfileSchema>;

const eventBase = {
  eventId: z.uuid(),
  serverTime: z.number().nonnegative(),
};

const attackEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('attack'),
    sourceId: z.string().min(1).max(64),
    sourceType: combatEntityTypeSchema,
    targetId: z.string().min(1).max(64),
    targetType: combatEntityTypeSchema,
    skillId: skillIdSchema.optional(),
  })
  .strict();

const hitEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('hit'),
    sourceId: z.string().min(1).max(64),
    sourceType: combatEntityTypeSchema,
    targetId: z.string().min(1).max(64),
    targetType: combatEntityTypeSchema,
    damage: z.number().int().positive(),
    critical: z.boolean(),
    targetHp: z.number().int().nonnegative(),
    targetMaxHp: z.number().int().positive(),
  })
  .strict();

const missEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('miss'),
    sourceId: z.string().min(1).max(64),
    sourceType: combatEntityTypeSchema,
    targetId: z.string().min(1).max(64),
    targetType: combatEntityTypeSchema,
  })
  .strict();

const healEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('heal'),
    sourceId: z.string().min(1).max(64),
    targetId: z.string().min(1).max(64),
    amount: z.number().int().positive(),
    targetHp: z.number().int().nonnegative(),
    targetMaxHp: z.number().int().positive(),
  })
  .strict();

const deathEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('death'),
    entityId: z.string().min(1).max(64),
    entityType: combatEntityTypeSchema,
    killerId: z.string().min(1).max(64).optional(),
    /** Present for player deaths: the client renders this revive countdown. */
    reviveInMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const spawnEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('spawn'),
    entityId: z.string().min(1).max(64),
    entityType: z.literal('monster'),
    templateId: z.string().min(1).max(32),
    displayName: z.string().min(1).max(32),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    hp: z.number().int().positive(),
    maxHp: z.number().int().positive(),
  })
  .strict();

const respawnEventSchema = z
  .object({
    ...eventBase,
    kind: z.literal('respawn'),
    entityId: z.string().min(1).max(64),
    entityType: z.literal('player'),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    hp: z.number().int().positive(),
    maxHp: z.number().int().positive(),
    mp: z.number().int().nonnegative(),
    maxMp: z.number().int().nonnegative(),
  })
  .strict();

export const combatEventSchema = z.discriminatedUnion('kind', [
  attackEventSchema,
  hitEventSchema,
  missEventSchema,
  healEventSchema,
  deathEventSchema,
  spawnEventSchema,
  respawnEventSchema,
]);

export type CombatEvent = z.infer<typeof combatEventSchema>;
export type CombatEventKind = CombatEvent['kind'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the domain produces; the room adds `eventId` and `serverTime`. */
export type CombatEventPayload = DistributiveOmit<CombatEvent, 'eventId' | 'serverTime'>;
