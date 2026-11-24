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
    x: t.number().default(0),
    y: t.number().default(0),
    facing: t.uint8().default(0),
    moving: t.boolean().default(false),
    connected: t.boolean().default(true),
    colorIndex: t.uint8().default(0),
    hp: t.number().default(0),
    maxHp: t.number().default(1),
    mp: t.number().default(0),
    maxMp: t.number().default(0),
  },
  'PlayerState',
);

export type PlayerStateInstance = InstanceType<typeof PlayerState>;

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
  },
  'WorldState',
);

export type WorldStateInstance = InstanceType<typeof WorldState>;
