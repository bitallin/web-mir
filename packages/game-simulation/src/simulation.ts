import {
  FACING,
  PLAYER_SPEED_UNITS_PER_SECOND,
  TILE_UNITS,
  facingFromDelta,
  type Facing,
  type TilePoint,
} from '@web-legend/contracts';

import { isStandable, isStepAllowed, type MovementGrid } from './grid';

export type UnitPoint = {
  x: number;
  y: number;
};

export type SimulationPlayer = {
  id: string;
  displayName: string;
  colorIndex: number;
  /** Authoritative integer sub-tile position. */
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  speedUnitsPerSecond: number;
  waypoints: UnitPoint[];
  moveCredit: number;
};

export type AddPlayerInput = {
  id: string;
  displayName: string;
  spawn: TilePoint;
  colorIndex: number;
  speedUnitsPerSecond?: number;
  /** Restores an exact persisted position; must stand on a walkable tile. */
  position?: UnitPoint;
  facing?: Facing;
};

export function tileCenter(point: TilePoint): UnitPoint {
  return {
    x: point.x * TILE_UNITS + TILE_UNITS / 2,
    y: point.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

export function tileOfUnits(position: UnitPoint): TilePoint {
  return {
    x: Math.floor(position.x / TILE_UNITS),
    y: Math.floor(position.y / TILE_UNITS),
  };
}

/**
 * Authoritative in-memory world simulation for one map instance. It performs
 * no IO: the room advances it from a fixed-step timer and persists nothing.
 */
export class WorldSimulation {
  private readonly players = new Map<string, SimulationPlayer>();

  constructor(private readonly grid: MovementGrid) {}

  addPlayer(input: AddPlayerInput): SimulationPlayer {
    if (this.players.has(input.id)) {
      throw new Error(`player "${input.id}" is already in the simulation`);
    }
    if (!isStandable(this.grid, input.spawn)) {
      throw new RangeError(`spawn tile (${input.spawn.x}, ${input.spawn.y}) is not walkable`);
    }

    let position = tileCenter(input.spawn);
    if (input.position !== undefined) {
      if (
        !Number.isSafeInteger(input.position.x) ||
        !Number.isSafeInteger(input.position.y) ||
        input.position.x < 0 ||
        input.position.y < 0
      ) {
        throw new RangeError('restored position must be non-negative integer unit coordinates');
      }
      const restoredTile = tileOfUnits(input.position);
      if (!isStandable(this.grid, restoredTile)) {
        throw new RangeError(
          `restored position tile (${restoredTile.x}, ${restoredTile.y}) is not walkable`,
        );
      }
      position = { x: input.position.x, y: input.position.y };
    }

    const player: SimulationPlayer = {
      id: input.id,
      displayName: input.displayName,
      colorIndex: input.colorIndex,
      x: position.x,
      y: position.y,
      facing: input.facing ?? FACING.south,
      moving: false,
      speedUnitsPerSecond: input.speedUnitsPerSecond ?? PLAYER_SPEED_UNITS_PER_SECOND,
      waypoints: [],
      moveCredit: 0,
    };

    this.players.set(player.id, player);
    return player;
  }

  removePlayer(id: string): boolean {
    return this.players.delete(id);
  }

  getPlayer(id: string): SimulationPlayer | undefined {
    return this.players.get(id);
  }

  /** Server-side teleport used by combat respawn; the destination must be walkable. */
  setPosition(id: string, position: UnitPoint): void {
    const player = this.players.get(id);
    if (player === undefined) {
      throw new RangeError(`player "${id}" is not in the simulation`);
    }
    if (
      !Number.isSafeInteger(position.x) ||
      !Number.isSafeInteger(position.y) ||
      position.x < 0 ||
      position.y < 0
    ) {
      throw new RangeError('teleport position must be non-negative integer unit coordinates');
    }
    if (!isStandable(this.grid, tileOfUnits(position))) {
      throw new RangeError('teleport destination must be walkable');
    }
    player.x = position.x;
    player.y = position.y;
    player.waypoints = [];
    player.moving = false;
    player.moveCredit = 0;
  }

  listPlayers(): SimulationPlayer[] {
    return [...this.players.values()];
  }

  /**
   * Replaces the current path. A path is a list of tile centers produced by the
   * server's pathfinder. The player walks straight to the next tile center,
   * even from a mid-tile offset: with eight-direction movement the segment is
   * legal by construction, and inserting the current tile center would make
   * every repath (auto-attack, repeated clicks) a visible backwards hitch. An
   * empty path means "stop", finishing the current step at its tile center.
   */
  setPath(id: string, path: readonly TilePoint[]): void {
    const player = this.players.get(id);
    if (player === undefined) {
      throw new RangeError(`player "${id}" is not in the simulation`);
    }
    for (const node of path) {
      if (!isStandable(this.grid, node)) {
        throw new RangeError(`path node (${node.x}, ${node.y}) is not walkable`);
      }
    }

    const currentTile = tileOfUnits(player);
    let previousTile = currentTile;
    for (const node of path) {
      if (!isStepAllowed(this.grid, previousTile, node)) {
        throw new RangeError(
          `path step (${previousTile.x}, ${previousTile.y}) -> (${node.x}, ${node.y}) must be adjacent and must not cut a blocked corner`,
        );
      }
      previousTile = node;
    }

    const waypoints: UnitPoint[] = [];
    if (path.length === 0) {
      const center = tileCenter(currentTile);
      if (center.x !== player.x || center.y !== player.y) {
        waypoints.push(center);
      }
    } else {
      for (const node of path) {
        waypoints.push(tileCenter(node));
      }
    }

    player.waypoints = waypoints.filter((point) => point.x !== player.x || point.y !== player.y);
    player.moving = player.waypoints.length > 0;
  }

  clearPath(id: string): void {
    const player = this.players.get(id);
    if (player === undefined) {
      return;
    }
    player.waypoints = [];
    player.moving = false;
  }

  /** Advances every player by one fixed step. Returns the ids that moved. */
  step(stepMs: number): string[] {
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      throw new RangeError('stepMs must be a positive finite number');
    }

    const moved: string[] = [];

    for (const player of this.players.values()) {
      player.moveCredit += player.speedUnitsPerSecond * stepMs;
      let remaining = Math.floor(player.moveCredit / 1_000);
      player.moveCredit -= remaining * 1_000;

      const wasMoving = player.waypoints.length > 0;
      let movedThisStep = false;

      while (remaining > 0) {
        const target = player.waypoints[0];
        if (target === undefined) {
          break;
        }

        const deltaX = target.x - player.x;
        const deltaY = target.y - player.y;

        if (deltaX === 0 && deltaY === 0) {
          player.waypoints.shift();
          continue;
        }

        player.facing = facingFromDelta(deltaX, deltaY);

        // Distance is Euclidean so a diagonal tile costs √2 tiles of travel
        // and the character keeps a constant speed in every direction.
        const distance = Math.round(Math.hypot(deltaX, deltaY));
        if (distance <= remaining) {
          player.x = target.x;
          player.y = target.y;
          remaining -= distance;
          player.waypoints.shift();
          movedThisStep = true;
        } else {
          const ratio = remaining / distance;
          player.x += Math.round(deltaX * ratio);
          player.y += Math.round(deltaY * ratio);
          remaining = 0;
          movedThisStep = true;
        }
      }

      player.moving = player.waypoints.length > 0;
      if (wasMoving || movedThisStep) {
        moved.push(player.id);
      }
    }

    return moved;
  }
}
