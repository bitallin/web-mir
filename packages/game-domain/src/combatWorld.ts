import {
  FACING,
  TILE_UNITS,
  type CharacterClass,
  type CombatEventPayload,
  type CommandRejectionCode,
  type MapMonsterSpawn,
  type MonsterStateKind,
  type TilePoint,
} from '@web-legend/contracts';

import {
  BASIC_ATTACK_MODIFIER,
  combatStatsAsOffense,
  distanceInTiles,
  rollAttack,
  type AttackModifier,
  type DefenseStats,
  type Rng,
} from './combat';
import {
  MONSTER_CATALOG,
  SKILL_CATALOG,
  skillsForClass,
  type MonsterDefinition,
  type SkillDefinition,
} from './content';
import { combatStatsFor, type CombatStats } from './stats';

export type CombatGrid = {
  width: number;
  height: number;
  isWalkable: (x: number, y: number) => boolean;
};

export type Pathfinder = (
  grid: CombatGrid,
  from: TilePoint,
  to: TilePoint,
) => readonly TilePoint[] | null;

export type UnitPoint = { x: number; y: number };

export type CombatPlayerInput = {
  id: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
  hp: number;
  mp: number;
  x: number;
  y: number;
};

export type CombatPlayerSnapshot = {
  id: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  alive: boolean;
};

export type CombatMonsterSnapshot = {
  id: string;
  templateId: string;
  displayName: string;
  level: number;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  state: MonsterStateKind;
  moving: boolean;
};

export type CombatRejection = {
  code: CommandRejectionCode;
  /** Optional player-facing override; defaults come from contracts. */
  message?: string;
  retryAfterMs?: number;
};

export type CombatCommandResult = {
  accepted: boolean;
  events: CombatEventPayload[];
  rejection?: CombatRejection;
};

export type CombatProfileData = {
  classId: CharacterClass;
  level: number;
  attack: number;
  defense: number;
  attackIntervalMs: number;
  attackRangeTiles: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  skills: {
    id: string;
    name: string;
    description: string;
    mpCost: number;
    cooldownMs: number;
    rangeTiles: number;
    target: 'enemy' | 'self';
    hotkey: string;
    cooldownRemainingMs: number;
  }[];
};

export type CombatWorldOptions = {
  spawns: readonly MapMonsterSpawn[];
  grid: CombatGrid;
  pathfinder: Pathfinder;
  rng: Rng;
  playerRespawnTile: TilePoint;
  /** Test override; defaults to each monster definition's respawn time. */
  monsterRespawnMs?: number;
  playerRespawnMs?: number;
  skills?: Readonly<Record<string, SkillDefinition>>;
  monsters?: Readonly<Record<string, MonsterDefinition>>;
};

type PlayerRuntime = CombatPlayerSnapshot & {
  stats: CombatStats;
  nextBasicAttackAt: number;
  cooldowns: Map<string, number>;
  reviveAt: number;
  /** Disconnected players keep their state but are not new monster targets. */
  targetable: boolean;
};

type MonsterRuntime = {
  id: string;
  definition: MonsterDefinition;
  spawnTile: TilePoint;
  spawnPosition: UnitPoint;
  x: number;
  y: number;
  facing: number;
  hp: number;
  state: MonsterStateKind;
  moving: boolean;
  targetId: string | null;
  waypoints: UnitPoint[];
  moveCredit: number;
  nextAttackAt: number;
  nextThinkAt: number;
  nextRepathAt: number;
  respawnAt: number;
};

const DEFAULT_PLAYER_RESPAWN_MS = 3_000;
const MONSTER_REPATH_INTERVAL_MS = 400;
const MONSTER_IDLE_THINK_MIN_MS = 1_800;
const MONSTER_IDLE_THINK_VARIANCE_MS = 2_200;
const MONSTER_PATROL_CHANCE = 0.6;

function tileCenter(tile: TilePoint): UnitPoint {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

function tileOfUnits(position: UnitPoint): TilePoint {
  return {
    x: Math.floor(position.x / TILE_UNITS),
    y: Math.floor(position.y / TILE_UNITS),
  };
}

function isTileCenter(position: UnitPoint, tile: TilePoint): boolean {
  const center = tileCenter(tile);
  return position.x === center.x && position.y === center.y;
}

function facingForDelta(from: UnitPoint, to: UnitPoint): number {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? FACING.east : FACING.west;
  }
  return deltaY >= 0 ? FACING.south : FACING.north;
}

function buildWaypoints(start: UnitPoint, path: readonly TilePoint[]): UnitPoint[] {
  const waypoints: UnitPoint[] = [];
  const currentTile = tileOfUnits(start);
  if (!isTileCenter(start, currentTile)) {
    waypoints.push(tileCenter(currentTile));
  }
  for (const node of path) {
    waypoints.push(tileCenter(node));
  }
  return waypoints.filter((point) => point.x !== start.x || point.y !== start.y);
}

/**
 * IO-free authoritative combat world for one map instance. It owns player
 * HP/MP, cooldowns, monster FSM state and respawn timers; the room advances it
 * from the fixed tick and mirrors the result into Colyseus state and
 * PostgreSQL checkpoints. All randomness and pathfinding are injected so a
 * seeded test replays exactly (ADR-019).
 */
export class CombatWorld {
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly monsters = new Map<string, MonsterRuntime>();
  private readonly grid: CombatGrid;
  private readonly pathfinder: Pathfinder;
  private readonly rng: Rng;
  private readonly playerRespawnPosition: UnitPoint;
  private readonly monsterRespawnMs: number | undefined;
  private readonly playerRespawnMs: number;
  private readonly skills: Readonly<Record<string, SkillDefinition>>;
  private readonly monstersById: Readonly<Record<string, MonsterDefinition>>;
  private now = 0;

  constructor(options: CombatWorldOptions) {
    this.grid = options.grid;
    this.pathfinder = options.pathfinder;
    this.rng = options.rng;
    this.skills = options.skills ?? SKILL_CATALOG;
    this.monstersById = options.monsters ?? MONSTER_CATALOG;
    this.monsterRespawnMs = options.monsterRespawnMs;
    this.playerRespawnMs = options.playerRespawnMs ?? DEFAULT_PLAYER_RESPAWN_MS;
    this.playerRespawnPosition = tileCenter(options.playerRespawnTile);

    if (!this.isWalkable(options.playerRespawnTile)) {
      throw new RangeError('player respawn tile must be walkable');
    }

    const seen = new Set<string>();
    for (const spawn of options.spawns) {
      if (seen.has(spawn.id)) {
        throw new RangeError(`duplicate monster spawn id "${spawn.id}"`);
      }
      seen.add(spawn.id);
      if (!this.isWalkable(spawn.tile)) {
        throw new RangeError(`monster spawn "${spawn.id}" is not walkable`);
      }
      const definition = this.monstersById[spawn.monsterId];
      if (definition === undefined) {
        throw new RangeError(
          `monster spawn "${spawn.id}" references unknown monster "${spawn.monsterId}"`,
        );
      }
      const position = tileCenter(spawn.tile);
      this.monsters.set(spawn.id, {
        id: spawn.id,
        definition,
        spawnTile: { ...spawn.tile },
        spawnPosition: position,
        x: position.x,
        y: position.y,
        facing: FACING.south,
        hp: definition.maxHp,
        state: 'idle',
        moving: false,
        targetId: null,
        waypoints: [],
        moveCredit: 0,
        nextAttackAt: 0,
        nextThinkAt: 0,
        nextRepathAt: 0,
        respawnAt: 0,
      });
    }
  }

  get elapsedMs(): number {
    return this.now;
  }

  addPlayer(input: CombatPlayerInput): void {
    if (this.players.has(input.id)) {
      throw new Error(`player "${input.id}" is already in combat`);
    }
    if (
      !Number.isSafeInteger(input.x) ||
      !Number.isSafeInteger(input.y) ||
      input.x < 0 ||
      input.y < 0
    ) {
      throw new RangeError('player position must be non-negative integer unit coordinates');
    }
    const stats = combatStatsFor(input.classId, input.level);
    const hp = Math.min(Math.max(input.hp, 0), stats.maxHp);
    const mp = Math.min(Math.max(input.mp, 0), stats.maxMp);
    this.players.set(input.id, {
      id: input.id,
      displayName: input.displayName,
      classId: input.classId,
      level: input.level,
      x: input.x,
      y: input.y,
      hp,
      maxHp: stats.maxHp,
      mp,
      maxMp: stats.maxMp,
      attack: stats.attack,
      defense: stats.defense,
      alive: hp > 0,
      stats,
      nextBasicAttackAt: 0,
      cooldowns: new Map(),
      reviveAt: hp > 0 ? 0 : this.now + this.playerRespawnMs,
      targetable: true,
    });
  }

  removePlayer(playerId: string): boolean {
    return this.players.delete(playerId);
  }

  setPlayerTargetable(playerId: string, targetable: boolean): void {
    const player = this.players.get(playerId);
    if (player !== undefined) {
      player.targetable = targetable;
    }
  }

  getPlayer(playerId: string): CombatPlayerSnapshot | undefined {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return undefined;
    }
    return {
      id: player.id,
      displayName: player.displayName,
      classId: player.classId,
      level: player.level,
      x: player.x,
      y: player.y,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
      attack: player.attack,
      defense: player.defense,
      alive: player.alive,
    };
  }

  listPlayers(): CombatPlayerSnapshot[] {
    return [...this.players.keys()].flatMap((id) => {
      const player = this.getPlayer(id);
      return player === undefined ? [] : [player];
    });
  }

  getMonster(monsterId: string): CombatMonsterSnapshot | undefined {
    const monster = this.monsters.get(monsterId);
    if (monster === undefined) {
      return undefined;
    }
    return this.monsterSnapshot(monster);
  }

  listMonsters(): CombatMonsterSnapshot[] {
    return [...this.monsters.values()].map((monster) => this.monsterSnapshot(monster));
  }

  getProfile(playerId: string): CombatProfileData | undefined {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return undefined;
    }
    return {
      classId: player.classId,
      level: player.level,
      attack: player.attack,
      defense: player.defense,
      attackIntervalMs: player.stats.attackIntervalMs,
      attackRangeTiles: player.stats.attackRangeTiles,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
      skills: skillsForClass(player.classId)
        .filter((skill) => skill.levelRequirement <= player.level)
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          mpCost: skill.mpCost,
          cooldownMs: skill.cooldownMs,
          rangeTiles: skill.rangeTiles,
          target: skill.target,
          hotkey: skill.hotkey,
          cooldownRemainingMs: Math.max(0, (player.cooldowns.get(skill.id) ?? 0) - this.now),
        })),
    };
  }

  basicAttack(playerId: string, targetId: string): CombatCommandResult {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return reject('INVALID_SESSION');
    }
    if (!player.alive) {
      return reject('PLAYER_DEAD');
    }

    const monster = this.monsters.get(targetId);
    if (monster === undefined) {
      return reject('INVALID_TARGET');
    }
    if (monster.state === 'dead') {
      return reject('TARGET_DEAD');
    }
    if (this.now < player.nextBasicAttackAt) {
      return reject('COOLDOWN', undefined, player.nextBasicAttackAt - this.now);
    }
    if (distanceInTiles(player, monster) > player.stats.attackRangeTiles) {
      return reject('OUT_OF_RANGE');
    }

    player.nextBasicAttackAt = this.now + player.stats.attackIntervalMs;
    const events: CombatEventPayload[] = [
      {
        kind: 'attack',
        sourceId: player.id,
        sourceType: 'player',
        targetId: monster.id,
        targetType: 'monster',
      },
    ];
    this.resolveAttack(player, monster, BASIC_ATTACK_MODIFIER, events);
    return { accepted: true, events };
  }

  castSkill(playerId: string, skillId: string, targetId: string): CombatCommandResult {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return reject('INVALID_SESSION');
    }
    if (!player.alive) {
      return reject('PLAYER_DEAD');
    }

    const skill = this.skills[skillId];
    if (
      skill === undefined ||
      skill.classId !== player.classId ||
      skill.levelRequirement > player.level
    ) {
      return reject('INVALID_TARGET', '该技能不可用');
    }

    const readyAt = player.cooldowns.get(skill.id) ?? 0;
    if (this.now < readyAt) {
      return reject('COOLDOWN', undefined, readyAt - this.now);
    }
    if (player.mp < skill.mpCost) {
      return reject('INSUFFICIENT_RESOURCE');
    }

    const events: CombatEventPayload[] = [];
    if (skill.effect.kind === 'heal') {
      player.mp -= skill.mpCost;
      player.cooldowns.set(skill.id, this.now + skill.cooldownMs);
      events.push({
        kind: 'attack',
        sourceId: player.id,
        sourceType: 'player',
        targetId: player.id,
        targetType: 'player',
        skillId: skill.id,
      });
      const amount = skill.effect.baseHeal + skill.effect.healPerLevel * (player.level - 1);
      const healed = Math.min(amount, player.maxHp - player.hp);
      if (healed > 0) {
        player.hp += healed;
        events.push({
          kind: 'heal',
          sourceId: player.id,
          targetId: player.id,
          amount: healed,
          targetHp: player.hp,
          targetMaxHp: player.maxHp,
        });
      }
      return { accepted: true, events };
    }

    const monster = this.monsters.get(targetId);
    if (monster === undefined) {
      return reject('INVALID_TARGET');
    }
    if (monster.state === 'dead') {
      return reject('TARGET_DEAD');
    }
    if (distanceInTiles(player, monster) > skill.rangeTiles) {
      return reject('OUT_OF_RANGE');
    }

    player.mp -= skill.mpCost;
    player.cooldowns.set(skill.id, this.now + skill.cooldownMs);
    events.push({
      kind: 'attack',
      sourceId: player.id,
      sourceType: 'player',
      targetId: monster.id,
      targetType: 'monster',
      skillId: skill.id,
    });
    this.resolveAttack(
      player,
      monster,
      {
        multiplier: skill.effect.multiplier,
        flatDamage: skill.effect.flatDamage,
        canCrit: skill.effect.canCrit,
      },
      events,
    );
    return { accepted: true, events };
  }

  /**
   * Advances time, applies the authoritative player positions from the movement
   * simulation, runs monster FSM/respawn and returns public events.
   */
  step(stepMs: number, playerPositions: ReadonlyMap<string, UnitPoint>): CombatEventPayload[] {
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      throw new RangeError('stepMs must be a positive finite number');
    }
    this.now += stepMs;

    for (const [playerId, position] of playerPositions) {
      const player = this.players.get(playerId);
      if (player === undefined) {
        continue;
      }
      player.x = position.x;
      player.y = position.y;
    }

    const events: CombatEventPayload[] = [];
    this.revivePlayers(events);
    for (const monster of this.monsters.values()) {
      this.updateMonster(monster, stepMs, events);
    }
    return events;
  }

  private revivePlayers(events: CombatEventPayload[]): void {
    for (const player of this.players.values()) {
      if (player.alive || this.now < player.reviveAt) {
        continue;
      }
      player.x = this.playerRespawnPosition.x;
      player.y = this.playerRespawnPosition.y;
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      player.alive = true;
      player.reviveAt = 0;
      events.push({
        kind: 'respawn',
        entityId: player.id,
        entityType: 'player',
        x: player.x,
        y: player.y,
        hp: player.hp,
        maxHp: player.maxHp,
        mp: player.mp,
        maxMp: player.maxMp,
      });
    }
  }

  private updateMonster(
    monster: MonsterRuntime,
    stepMs: number,
    events: CombatEventPayload[],
  ): void {
    if (monster.state === 'dead') {
      if (this.now < monster.respawnAt) {
        return;
      }
      monster.hp = monster.definition.maxHp;
      monster.x = monster.spawnPosition.x;
      monster.y = monster.spawnPosition.y;
      monster.facing = FACING.south;
      monster.state = 'idle';
      monster.moving = false;
      monster.targetId = null;
      monster.waypoints = [];
      monster.moveCredit = 0;
      monster.nextAttackAt = this.now;
      monster.nextThinkAt = this.now;
      monster.nextRepathAt = 0;
      monster.respawnAt = 0;
      events.push({
        kind: 'spawn',
        entityId: monster.id,
        entityType: 'monster',
        templateId: monster.definition.id,
        displayName: monster.definition.name,
        x: monster.x,
        y: monster.y,
        hp: monster.hp,
        maxHp: monster.definition.maxHp,
      });
      return;
    }

    const target = this.selectTarget(monster);
    const targetInRange =
      target !== null && distanceInTiles(monster, target) <= monster.definition.attackRangeTiles;

    if (target !== null) {
      monster.targetId = target.id;
      if (targetInRange) {
        monster.state = 'attack';
        monster.waypoints = [];
        monster.moving = false;
        if (this.now >= monster.nextAttackAt) {
          this.monsterAttack(monster, target, events);
        }
      } else {
        monster.state = 'chase';
        this.ensurePath(monster, tileOfUnits(target));
      }
    } else {
      monster.targetId = null;
      if (monster.state === 'chase' || monster.state === 'attack') {
        monster.state = 'return';
        monster.nextRepathAt = 0;
      }
      if (monster.state === 'return') {
        if (monster.waypoints.length === 0 && this.isAtSpawn(monster)) {
          monster.state = 'idle';
          monster.nextThinkAt = this.now;
        } else {
          this.ensurePath(monster, monster.spawnTile);
        }
      } else if (monster.state === 'idle') {
        this.updateIdle(monster);
      } else if (monster.state === 'patrol' && monster.waypoints.length === 0) {
        monster.state = 'idle';
        monster.nextThinkAt = this.now;
      }
    }

    this.advanceMonster(monster, stepMs);
  }

  private selectTarget(monster: MonsterRuntime): PlayerRuntime | null {
    let best: PlayerRuntime | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const player of this.players.values()) {
      if (!player.alive || !player.targetable) {
        continue;
      }
      const distance = distanceInTiles(monster, player);
      if (distance > monster.definition.aggroTiles) {
        continue;
      }
      if (distanceTilesFromSpawn(monster) > monster.definition.leashTiles) {
        continue;
      }
      if (distance < bestDistance) {
        best = player;
        bestDistance = distance;
      }
    }
    return best;
  }

  private updateIdle(monster: MonsterRuntime): void {
    if (this.now < monster.nextThinkAt) {
      return;
    }
    monster.nextThinkAt =
      this.now +
      MONSTER_IDLE_THINK_MIN_MS +
      Math.floor(this.rng() * MONSTER_IDLE_THINK_VARIANCE_MS);
    if (this.rng() >= MONSTER_PATROL_CHANCE) {
      return;
    }

    const radius = monster.definition.patrolRadiusTiles;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const offsetX = Math.round((this.rng() * 2 - 1) * radius);
      const offsetY = Math.round((this.rng() * 2 - 1) * radius);
      const tile = {
        x: monster.spawnTile.x + offsetX,
        y: monster.spawnTile.y + offsetY,
      };
      if (!this.isWalkable(tile)) {
        continue;
      }
      const path = this.pathfinder(this.grid, tileOfUnits(monster), tile);
      if (path === null || path.length === 0) {
        continue;
      }
      monster.waypoints = buildWaypoints(monster, path);
      monster.nextRepathAt = this.now + MONSTER_REPATH_INTERVAL_MS;
      monster.state = 'patrol';
      return;
    }
  }

  private ensurePath(monster: MonsterRuntime, targetTile: TilePoint): void {
    if (this.now < monster.nextRepathAt) {
      return;
    }
    const path = this.pathfinder(this.grid, tileOfUnits(monster), targetTile);
    monster.nextRepathAt = this.now + MONSTER_REPATH_INTERVAL_MS;
    if (path === null) {
      monster.state = 'return';
      return;
    }
    monster.waypoints = buildWaypoints(monster, path);
  }

  private advanceMonster(monster: MonsterRuntime, stepMs: number): void {
    monster.moveCredit += monster.definition.moveSpeedUnitsPerSecond * stepMs;
    let remaining = Math.floor(monster.moveCredit / 1_000);
    monster.moveCredit -= remaining * 1_000;

    while (remaining > 0) {
      const target = monster.waypoints[0];
      if (target === undefined) {
        break;
      }
      const deltaX = target.x - monster.x;
      const deltaY = target.y - monster.y;
      if (deltaX === 0 && deltaY === 0) {
        monster.waypoints.shift();
        continue;
      }
      monster.facing = facingForDelta(monster, target);
      const distance = Math.abs(deltaX) + Math.abs(deltaY);
      if (distance <= remaining) {
        monster.x = target.x;
        monster.y = target.y;
        remaining -= distance;
        monster.waypoints.shift();
      } else {
        monster.x += Math.sign(deltaX) * remaining;
        monster.y += Math.sign(deltaY) * remaining;
        remaining = 0;
      }
    }
    monster.moving = monster.waypoints.length > 0;
  }

  private monsterAttack(
    monster: MonsterRuntime,
    player: PlayerRuntime,
    events: CombatEventPayload[],
  ): void {
    monster.nextAttackAt = this.now + monster.definition.attackIntervalMs;
    monster.facing = facingForDelta(monster, player);
    events.push({
      kind: 'attack',
      sourceId: monster.id,
      sourceType: 'monster',
      targetId: player.id,
      targetType: 'player',
    });

    const roll = rollAttack(
      {
        attack: monster.definition.attack,
        hitChance: monster.definition.hitChance,
        critChance: monster.definition.critChance,
        critMultiplier: monster.definition.critMultiplier,
      },
      { defense: player.stats.defense },
      this.rng,
    );

    if (!roll.hit) {
      events.push({
        kind: 'miss',
        sourceId: monster.id,
        sourceType: 'monster',
        targetId: player.id,
        targetType: 'player',
      });
      return;
    }

    player.hp = Math.max(0, player.hp - roll.damage);
    events.push({
      kind: 'hit',
      sourceId: monster.id,
      sourceType: 'monster',
      targetId: player.id,
      targetType: 'player',
      damage: roll.damage,
      critical: roll.critical,
      targetHp: player.hp,
      targetMaxHp: player.maxHp,
    });

    if (player.hp === 0) {
      player.alive = false;
      player.reviveAt = this.now + this.playerRespawnMs;
      events.push({
        kind: 'death',
        entityId: player.id,
        entityType: 'player',
        killerId: monster.id,
      });
    }
  }

  private resolveAttack(
    player: PlayerRuntime,
    monster: MonsterRuntime,
    modifier: AttackModifier,
    events: CombatEventPayload[],
  ): void {
    const roll = rollAttack(
      combatStatsAsOffense(player.stats),
      { defense: monster.definition.defense } satisfies DefenseStats,
      this.rng,
      modifier,
    );

    if (!roll.hit) {
      events.push({
        kind: 'miss',
        sourceId: player.id,
        sourceType: 'player',
        targetId: monster.id,
        targetType: 'monster',
      });
      return;
    }

    monster.hp = Math.max(0, monster.hp - roll.damage);
    events.push({
      kind: 'hit',
      sourceId: player.id,
      sourceType: 'player',
      targetId: monster.id,
      targetType: 'monster',
      damage: roll.damage,
      critical: roll.critical,
      targetHp: monster.hp,
      targetMaxHp: monster.definition.maxHp,
    });

    if (monster.hp === 0) {
      monster.state = 'dead';
      monster.moving = false;
      monster.targetId = null;
      monster.waypoints = [];
      monster.respawnAt = this.now + (this.monsterRespawnMs ?? monster.definition.respawnMs);
      events.push({
        kind: 'death',
        entityId: monster.id,
        entityType: 'monster',
        killerId: player.id,
      });
    }
  }

  private monsterSnapshot(monster: MonsterRuntime): CombatMonsterSnapshot {
    return {
      id: monster.id,
      templateId: monster.definition.id,
      displayName: monster.definition.name,
      level: monster.definition.level,
      x: monster.x,
      y: monster.y,
      facing: monster.facing,
      hp: monster.hp,
      maxHp: monster.definition.maxHp,
      state: monster.state,
      moving: monster.moving,
    };
  }

  private isAtSpawn(monster: MonsterRuntime): boolean {
    const tile = tileOfUnits(monster);
    return tile.x === monster.spawnTile.x && tile.y === monster.spawnTile.y;
  }

  private isWalkable(tile: TilePoint): boolean {
    return (
      Number.isInteger(tile.x) &&
      Number.isInteger(tile.y) &&
      tile.x >= 0 &&
      tile.y >= 0 &&
      tile.x < this.grid.width &&
      tile.y < this.grid.height &&
      this.grid.isWalkable(tile.x, tile.y)
    );
  }
}

function distanceTilesFromSpawn(monster: MonsterRuntime): number {
  return distanceInTiles(monster, monster.spawnPosition);
}

function reject(
  code: CommandRejectionCode,
  message?: string,
  retryAfterMs?: number,
): CombatCommandResult {
  const rejection: CombatRejection = { code };
  if (message !== undefined) {
    rejection.message = message;
  }
  if (retryAfterMs !== undefined) {
    rejection.retryAfterMs = Math.ceil(retryAfterMs);
  }
  return { accepted: false, events: [], rejection };
}
