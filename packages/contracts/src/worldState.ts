import { schema, t } from '@colyseus/schema';

import { DEFAULT_TICK_HZ, PLAYER_SPEED_UNITS_PER_SECOND } from './realtime';

/**
 * Public room state. Shared verbatim by the game server and the browser client
 * so the wire encoding and the TypeScript view of it cannot drift.
 *
 * Private data (accounts, inventory, GM flags) must never be placed here.
 * Positions are authoritative integer sub-tile units; clients only render them.
 */
export const PlayerState = schema(
  {
    playerId: t.string(),
    displayName: t.string(),
    classId: t.string().default('warrior'),
    level: t.uint16().default(1),
    x: t.number().default(0),
    y: t.number().default(0),
    facing: t.uint8().default(0),
    moving: t.boolean().default(false),
    connected: t.boolean().default(true),
    alive: t.boolean().default(true),
    colorIndex: t.uint8().default(0),
    hp: t.number().default(0),
    maxHp: t.number().default(1),
    mp: t.number().default(0),
    maxMp: t.number().default(0),
  },
  'PlayerState',
);

export type PlayerStateInstance = InstanceType<typeof PlayerState>;

/**
 * Public monster state for one fixed map spawn. `monsterId` is the spawn id
 * from the compiled map and stays stable across respawns, so the client can
 * keep a corpse slot and the server can reuse the same AOI cell identity.
 */
export const MonsterState = schema(
  {
    monsterId: t.string(),
    templateId: t.string(),
    displayName: t.string(),
    level: t.uint16().default(1),
    x: t.number().default(0),
    y: t.number().default(0),
    facing: t.uint8().default(0),
    moving: t.boolean().default(false),
    hp: t.number().default(0),
    maxHp: t.number().default(1),
    /** Encoded by `MONSTER_STATE_CODES` in `contracts/combat`. */
    state: t.uint8().default(0),
  },
  'MonsterState',
);

export type MonsterStateInstance = InstanceType<typeof MonsterState>;

/**
 * Public ground drop. The item instance behind it already has a unique owner
 * row in PostgreSQL; this collection only mirrors the visible subset for AOI
 * rendering. Quantity and display data are server-decided.
 */
export const LootState = schema(
  {
    dropId: t.string(),
    itemId: t.string(),
    templateId: t.string(),
    displayName: t.string(),
    quantity: t.uint16().default(1),
    x: t.number().default(0),
    y: t.number().default(0),
    /** Character id allowed to claim first; empty string means free for all. */
    ownerId: t.string().default(''),
    /** Epoch milliseconds; the room removes the drop when it passes. */
    expiresAt: t.number().default(0),
  },
  'LootState',
);

export type LootStateInstance = InstanceType<typeof LootState>;

export const WorldState = schema(
  {
    mapId: t.string().default(''),
    instanceId: t.string().default(''),
    serverTick: t.number().default(0),
    playerCount: t.uint8().default(0),
    tickHz: t.number().default(DEFAULT_TICK_HZ),
    speedUnitsPerSecond: t.number().default(PLAYER_SPEED_UNITS_PER_SECOND),
    // `.view()` makes the collection filterable: each client receives only the
    // PlayerState instances its AOI StateView was given (ADR-018).
    players: t.map(PlayerState).view(),
    // Monsters share the same AOI cells and view filtering (ADR-019).
    monsters: t.map(MonsterState).view(),
    // Ground drops are public but filtered by the same AOI (ADR-020).
    loot: t.map(LootState).view(),
  },
  'WorldState',
);

export type WorldStateInstance = InstanceType<typeof WorldState>;
