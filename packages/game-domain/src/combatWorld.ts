import {
  FACING,
  TILE_UNITS,
  type CharacterClass,
  type CombatEventPayload,
  type CommandRejectionCode,
  type ContentBundle,
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
  DEFAULT_CONTENT_BUNDLE,
  skillsForClass,
  type DamageEffect,
  type DotEffect,
  type MonsterDefinition,
  type SkillDefinition,
} from './content';
import { monsterStatsAtPhase } from './monsterPhase';
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
  /**
   * Equipment-adjusted stats loaded from the asset snapshot. When omitted the
   * class/level baseline is used. The Room never computes them itself.
   */
  stats?: CombatStats;
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
  /** Remaining absorb points of the player's shield; 0 when unshielded. */
  shield: number;
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
  boss: boolean;
  enraged: boolean;
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
  pvpEnabled: boolean;
  reviveMs: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  shield: number;
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
  /** Player-versus-player is allowed only on maps whose compiled rule is open. */
  pvpEnabled?: boolean;
  /** Test override; defaults to each monster definition's respawn time. */
  monsterRespawnMs?: number;
  playerRespawnMs?: number;
  /** Fixed content release for this Room (ADR-022); defaults to the baseline. */
  content?: ContentBundle;
  skills?: Readonly<Record<string, SkillDefinition>>;
  monsters?: Readonly<Record<string, MonsterDefinition>>;
};

type ActiveDot = {
  skillId: string;
  sourceId: string;
  damagePerTick: number;
  tickIntervalMs: number;
  nextTickAt: number;
  expiresAt: number;
};

type ShieldRuntime = {
  amount: number;
  expiresAt: number;
};

type PlayerRuntime = Omit<CombatPlayerSnapshot, 'shield'> & {
  stats: CombatStats;
  nextBasicAttackAt: number;
  cooldowns: Map<string, number>;
  reviveAt: number;
  /** Fractional-second carry for integer-per-second mana regeneration. */
  regenCarryMs: number;
  /** Disconnected players keep their state but are not new monster targets. */
  targetable: boolean;
  shield: ShieldRuntime | null;
  /** Damage-over-time effects, keyed by skill so a recast refreshes them. */
  dots: Map<string, ActiveDot>;
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
  dots: Map<string, ActiveDot>;
  /** Attack committed at cast time; it lands at `impactAt` on this point. */
  windup: MonsterWindup | null;
  /** Set once when HP first crosses the content enrage threshold. */
  enraged: boolean;
  /** First player to damage this monster; rewards go here (ADR-041). */
  claimedBy: string | null;
  /** Simulation time of the latest damage that refreshed the claim. */
  claimAt: number;
};

type MonsterWindup = {
  targetId: string;
  impactAt: number;
  x: number;
  y: number;
  radiusTiles: number;
};

const DEFAULT_PLAYER_RESPAWN_MS = 3_000;
/** A claim survives this long without any damage before another hit can claim. */
const MONSTER_CLAIM_TIMEOUT_MS = 10_000;
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
  private readonly pvpEnabled: boolean;
  private readonly content: ContentBundle;
  private readonly skills: Readonly<Record<string, SkillDefinition>>;
  private readonly monstersById: Readonly<Record<string, MonsterDefinition>>;
  private now = 0;

  constructor(options: CombatWorldOptions) {
    this.grid = options.grid;
    this.pathfinder = options.pathfinder;
    this.rng = options.rng;
    this.content = options.content ?? DEFAULT_CONTENT_BUNDLE;
    this.skills = options.skills ?? this.content.skills;
    this.monstersById = options.monsters ?? this.content.monsters;
    this.monsterRespawnMs = options.monsterRespawnMs;
    this.playerRespawnMs = options.playerRespawnMs ?? DEFAULT_PLAYER_RESPAWN_MS;
    this.pvpEnabled = options.pvpEnabled ?? false;
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
        dots: new Map(),
        windup: null,
        enraged: false,
        claimedBy: null,
        claimAt: 0,
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
    const stats = input.stats ?? combatStatsFor(input.classId, input.level, this.content);
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
      regenCarryMs: 0,
      targetable: true,
      shield: null,
      dots: new Map(),
    });
  }

  removePlayer(playerId: string): boolean {
    // A claim belongs to a player present in this room; leaving or transferring
    // releases it so the next hitter can claim the monster (ADR-041).
    for (const monster of this.monsters.values()) {
      if (monster.claimedBy === playerId) {
        monster.claimedBy = null;
        monster.claimAt = 0;
      }
    }
    return this.players.delete(playerId);
  }

  /**
   * First damage claims the monster; later damage refreshes the claim timer
   * without changing the owner, so the last hit never steals the rewards.
   */
  private claimMonster(monster: MonsterRuntime, playerId: string): void {
    if (monster.claimedBy === null || this.now - monster.claimAt > MONSTER_CLAIM_TIMEOUT_MS) {
      monster.claimedBy = playerId;
    }
    monster.claimAt = this.now;
  }

  setPlayerTargetable(playerId: string, targetable: boolean): void {
    const player = this.players.get(playerId);
    if (player !== undefined) {
      player.targetable = targetable;
    }
  }

  /**
   * Applies a committed level or equipment change. `refill` is used for level
   * ups (classic full restore); otherwise current vitals are clamped to the
   * new maximum without healing or hurting the player.
   */
  updatePlayerProgress(
    playerId: string,
    input: { level: number; stats: CombatStats; refill?: boolean },
  ): boolean {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return false;
    }
    player.level = input.level;
    player.stats = input.stats;
    player.maxHp = input.stats.maxHp;
    player.maxMp = input.stats.maxMp;
    player.attack = input.stats.attack;
    player.defense = input.stats.defense;
    if (input.refill === true) {
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      player.alive = true;
      player.reviveAt = 0;
    } else {
      player.hp = Math.min(player.hp, player.maxHp);
      player.mp = Math.min(player.mp, player.maxMp);
    }
    return true;
  }

  /** Applies committed consumable results; HP/MP stay server-authoritative. */
  setPlayerVitals(playerId: string, vitals: { hp: number; mp: number }): boolean {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return false;
    }
    const previousMp = player.mp;
    player.hp = Math.min(Math.max(Math.floor(vitals.hp), 0), player.maxHp);
    player.mp = Math.min(Math.max(Math.floor(vitals.mp), 0), player.maxMp);
    // An HP-only consumable must not discard the partial mana-regen second.
    if (player.mp !== previousMp) {
      player.regenCarryMs = 0;
    }
    player.alive = player.hp > 0;
    if (!player.alive) {
      player.reviveAt = this.now + this.playerRespawnMs;
      player.dots.clear();
      player.shield = null;
    }
    return true;
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
      shield: player.shield?.amount ?? 0,
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
      pvpEnabled: this.pvpEnabled,
      reviveMs: this.playerRespawnMs,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
      shield: player.shield?.amount ?? 0,
      skills: skillsForClass(player.classId, this.skills)
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
    if (monster !== undefined) {
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

    const target = this.players.get(targetId);
    if (target === undefined) {
      return reject('INVALID_TARGET');
    }
    // Safe-zone rejection comes before cooldown/range so a town click always
    // reports the map rule rather than a confusing cooldown error.
    if (!this.pvpEnabled) {
      return reject('SAFE_ZONE');
    }
    if (target.id === player.id) {
      return reject('INVALID_TARGET', '不能攻击自己');
    }
    if (!target.alive) {
      return reject('TARGET_DEAD');
    }
    if (!target.targetable) {
      return reject('INVALID_TARGET', '目标当前不可攻击');
    }
    if (this.now < player.nextBasicAttackAt) {
      return reject('COOLDOWN', undefined, player.nextBasicAttackAt - this.now);
    }
    if (distanceInTiles(player, target) > player.stats.attackRangeTiles) {
      return reject('OUT_OF_RANGE');
    }

    player.nextBasicAttackAt = this.now + player.stats.attackIntervalMs;
    const events: CombatEventPayload[] = [
      {
        kind: 'attack',
        sourceId: player.id,
        sourceType: 'player',
        targetId: target.id,
        targetType: 'player',
      },
    ];
    this.resolvePlayerAttack(player, target, BASIC_ATTACK_MODIFIER, events);
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
      this.spendSkill(player, skill);
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

    if (skill.effect.kind === 'shield') {
      this.spendSkill(player, skill);
      const amount = skill.effect.baseAmount + skill.effect.amountPerLevel * (player.level - 1);
      player.shield = { amount, expiresAt: this.now + skill.effect.durationMs };
      events.push({
        kind: 'attack',
        sourceId: player.id,
        sourceType: 'player',
        targetId: player.id,
        targetType: 'player',
        skillId: skill.id,
      });
      events.push({
        kind: 'shield',
        sourceId: player.id,
        targetId: player.id,
        amount,
        expiresInMs: skill.effect.durationMs,
      });
      return { accepted: true, events };
    }

    const monster = this.monsters.get(targetId);
    if (monster !== undefined) {
      if (monster.state === 'dead') {
        return reject('TARGET_DEAD');
      }
      if (distanceInTiles(player, monster) > skill.rangeTiles) {
        return reject('OUT_OF_RANGE');
      }

      this.spendSkill(player, skill);
      events.push({
        kind: 'attack',
        sourceId: player.id,
        sourceType: 'player',
        targetId: monster.id,
        targetType: 'monster',
        skillId: skill.id,
      });
      if (skill.effect.kind === 'dot') {
        this.applyDot(monster.dots, player, skill.id, skill.effect, monster.definition.defense);
      } else {
        this.resolveAttack(player, monster, attackModifier(skill.effect), events, skill.id);
      }
      return { accepted: true, events };
    }

    const target = this.players.get(targetId);
    if (target === undefined) {
      return reject('INVALID_TARGET');
    }
    if (!this.pvpEnabled) {
      return reject('SAFE_ZONE');
    }
    if (target.id === player.id) {
      return reject('INVALID_TARGET', '不能攻击自己');
    }
    if (!target.alive) {
      return reject('TARGET_DEAD');
    }
    if (!target.targetable) {
      return reject('INVALID_TARGET', '目标当前不可攻击');
    }
    if (distanceInTiles(player, target) > skill.rangeTiles) {
      return reject('OUT_OF_RANGE');
    }

    this.spendSkill(player, skill);
    events.push({
      kind: 'attack',
      sourceId: player.id,
      sourceType: 'player',
      targetId: target.id,
      targetType: 'player',
      skillId: skill.id,
    });
    if (skill.effect.kind === 'dot') {
      this.applyDot(target.dots, player, skill.id, skill.effect, target.stats.defense);
    } else {
      this.resolvePlayerAttack(player, target, attackModifier(skill.effect), events, skill.id);
    }
    return { accepted: true, events };
  }

  private spendSkill(player: PlayerRuntime, skill: SkillDefinition): void {
    player.mp -= skill.mpCost;
    player.cooldowns.set(skill.id, this.now + skill.cooldownMs);
  }

  private applyDot(
    dots: Map<string, ActiveDot>,
    source: PlayerRuntime,
    skillId: string,
    effect: DotEffect,
    targetDefense: number,
  ): void {
    dots.set(skillId, {
      skillId,
      sourceId: source.id,
      damagePerTick: dotTickDamage(source.attack, effect, targetDefense),
      tickIntervalMs: effect.tickIntervalMs,
      nextTickAt: this.now + effect.tickIntervalMs,
      expiresAt: this.now + effect.durationMs,
    });
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
    this.regenerateMana(stepMs);
    this.expireShields(events);
    this.applyDots(events);
    for (const monster of this.monsters.values()) {
      this.updateMonster(monster, stepMs, events);
    }
    return events;
  }

  /**
   * Integer-per-second mana regeneration. The tick is the only clock: no
   * client timestamps and no IO, so two identical steps always produce the
   * same MP on the server.
   */
  private regenerateMana(stepMs: number): void {
    for (const player of this.players.values()) {
      if (!player.alive || player.mp >= player.maxMp || player.stats.mpRegenPerSecond <= 0) {
        player.regenCarryMs = 0;
        continue;
      }
      player.regenCarryMs += stepMs;
      const gained = Math.floor(player.regenCarryMs / 1_000) * player.stats.mpRegenPerSecond;
      if (gained <= 0) {
        continue;
      }
      player.regenCarryMs %= 1_000;
      player.mp = Math.min(player.maxMp, player.mp + gained);
      if (player.mp >= player.maxMp) {
        player.regenCarryMs = 0;
      }
    }
  }

  private expireShields(events: CombatEventPayload[]): void {
    for (const player of this.players.values()) {
      if (player.shield === null || this.now < player.shield.expiresAt) {
        continue;
      }
      player.shield = null;
      events.push({
        kind: 'shield',
        sourceId: player.id,
        targetId: player.id,
        amount: 0,
        expiresInMs: 0,
      });
    }
  }

  /**
   * Damage-over-time ticks are authoritative and deterministic: the damage is
   * fixed at cast time and no RNG is drawn, so adding a DoT cannot change the
   * outcome of subsequent attacks in a seeded replay (ADR-028).
   */
  private applyDots(events: CombatEventPayload[]): void {
    for (const monster of this.monsters.values()) {
      if (monster.state === 'dead' || monster.dots.size === 0) {
        continue;
      }
      for (const [skillId, dot] of monster.dots) {
        while (this.now >= dot.nextTickAt && dot.nextTickAt <= dot.expiresAt) {
          dot.nextTickAt += dot.tickIntervalMs;
          this.claimMonster(monster, dot.sourceId);
          monster.hp = Math.max(0, monster.hp - dot.damagePerTick);
          events.push({
            kind: 'hit',
            sourceId: dot.sourceId,
            sourceType: 'player',
            targetId: monster.id,
            targetType: 'monster',
            damage: dot.damagePerTick,
            critical: false,
            targetHp: monster.hp,
            targetMaxHp: monster.definition.maxHp,
            skillId: dot.skillId,
            periodic: true,
          });
          if (monster.hp === 0) {
            this.killMonster(monster, dot.sourceId, events);
            break;
          }
          this.maybeEnrage(monster, events);
        }
        if (monster.hp === 0) {
          break;
        }
        if (this.now > dot.expiresAt) {
          monster.dots.delete(skillId);
        }
      }
    }

    for (const player of this.players.values()) {
      if (!player.alive || player.dots.size === 0) {
        continue;
      }
      for (const [skillId, dot] of player.dots) {
        while (this.now >= dot.nextTickAt && dot.nextTickAt <= dot.expiresAt) {
          dot.nextTickAt += dot.tickIntervalMs;
          const { hpDamage, absorbed } = this.absorbPlayerDamage(player, dot.damagePerTick, events);
          player.hp = Math.max(0, player.hp - hpDamage);
          events.push({
            kind: 'hit',
            sourceId: dot.sourceId,
            sourceType: 'player',
            targetId: player.id,
            targetType: 'player',
            damage: dot.damagePerTick,
            critical: false,
            targetHp: player.hp,
            targetMaxHp: player.maxHp,
            skillId: dot.skillId,
            periodic: true,
            ...(absorbed > 0 ? { absorbed } : {}),
          });
          if (player.hp === 0) {
            this.killPlayer(player, dot.sourceId, events);
            break;
          }
        }
        if (!player.alive) {
          break;
        }
        if (this.now > dot.expiresAt) {
          player.dots.delete(skillId);
        }
      }
    }
  }

  private absorbPlayerDamage(
    player: PlayerRuntime,
    damage: number,
    events: CombatEventPayload[],
  ): { hpDamage: number; absorbed: number } {
    if (player.shield === null) {
      return { hpDamage: damage, absorbed: 0 };
    }
    const absorbed = Math.min(player.shield.amount, damage);
    player.shield.amount -= absorbed;
    if (player.shield.amount <= 0) {
      player.shield = null;
      events.push({
        kind: 'shield',
        sourceId: player.id,
        targetId: player.id,
        amount: 0,
        expiresInMs: 0,
      });
    }
    return { hpDamage: damage - absorbed, absorbed };
  }

  private killPlayer(
    player: PlayerRuntime,
    killerId: string | undefined,
    events: CombatEventPayload[],
  ): void {
    player.alive = false;
    player.reviveAt = this.now + this.playerRespawnMs;
    player.dots.clear();
    if (player.shield !== null) {
      player.shield = null;
      events.push({
        kind: 'shield',
        sourceId: player.id,
        targetId: player.id,
        amount: 0,
        expiresInMs: 0,
      });
    }
    events.push({
      kind: 'death',
      entityId: player.id,
      entityType: 'player',
      ...(killerId === undefined ? {} : { killerId }),
      reviveInMs: this.playerRespawnMs,
    });
  }

  /**
   * Switches to the content enrage phase exactly once per life, the first time
   * damage leaves the monster at or below the threshold. The event carries the
   * authoritative HP that triggered it so clients cannot derive it themselves.
   */
  private maybeEnrage(monster: MonsterRuntime, events: CombatEventPayload[]): void {
    const enrage = monster.definition.enrage;
    if (enrage === undefined || monster.enraged || monster.hp === 0) {
      return;
    }
    const threshold = Math.max(
      1,
      Math.ceil((monster.definition.maxHp * enrage.atHpPermille) / 1_000),
    );
    if (monster.hp > threshold) {
      return;
    }
    monster.enraged = true;
    events.push({
      kind: 'enrage',
      entityId: monster.id,
      entityType: 'monster',
      hp: monster.hp,
      maxHp: monster.definition.maxHp,
    });
  }

  private monsterAttackPower(monster: MonsterRuntime): number {
    return monsterStatsAtPhase(monster.definition, monster.enraged).attack;
  }

  private monsterAttackInterval(monster: MonsterRuntime): number {
    return monsterStatsAtPhase(monster.definition, monster.enraged).attackIntervalMs;
  }

  private monsterMoveSpeed(monster: MonsterRuntime): number {
    return monsterStatsAtPhase(monster.definition, monster.enraged).moveSpeedUnitsPerSecond;
  }

  private monsterWindupRadius(monster: MonsterRuntime): number {
    return monsterStatsAtPhase(monster.definition, monster.enraged).windupRadiusTiles;
  }

  private killMonster(
    monster: MonsterRuntime,
    killerId: string,
    events: CombatEventPayload[],
  ): void {
    monster.state = 'dead';
    monster.moving = false;
    monster.targetId = null;
    monster.waypoints = [];
    monster.dots.clear();
    monster.windup = null;
    monster.enraged = false;
    monster.respawnAt = this.now + (this.monsterRespawnMs ?? monster.definition.respawnMs);
    const ownerId = monster.claimedBy ?? killerId;
    monster.claimedBy = null;
    monster.claimAt = 0;
    events.push({
      kind: 'death',
      entityId: monster.id,
      entityType: 'monster',
      killerId,
      ownerId,
    });
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
      player.dots.clear();
      player.shield = null;
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
      monster.dots.clear();
      monster.windup = null;
      monster.enraged = false;
      monster.claimedBy = null;
      monster.claimAt = 0;
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

    // A committed attack freezes the monster until it lands; the target's
    // movement during the wind-up decides whether the hit connects.
    if (monster.windup !== null) {
      monster.moving = false;
      if (this.now >= monster.windup.impactAt) {
        this.resolveWindup(monster, events);
      }
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
          if ((monster.definition.windupMs ?? 0) > 0) {
            this.beginWindup(monster, target, events);
          } else {
            this.monsterAttack(monster, target, events);
          }
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
    monster.moveCredit += this.monsterMoveSpeed(monster) * stepMs;
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

  /**
   * Commits an attack to a telegraphed point. No RNG is drawn here: the hit
   * roll happens at impact so a player who steps out of the radius is missed
   * deterministically, not by luck.
   */
  private beginWindup(
    monster: MonsterRuntime,
    player: PlayerRuntime,
    events: CombatEventPayload[],
  ): void {
    const windupMs = monster.definition.windupMs ?? 0;
    const radiusTiles = this.monsterWindupRadius(monster);
    monster.facing = facingForDelta(monster, player);
    monster.moving = false;
    monster.waypoints = [];
    monster.windup = {
      targetId: player.id,
      impactAt: this.now + windupMs,
      x: player.x,
      y: player.y,
      radiusTiles,
    };
    events.push({
      kind: 'telegraph',
      sourceId: monster.id,
      sourceType: 'monster',
      targetId: player.id,
      targetType: 'player',
      x: player.x,
      y: player.y,
      radiusTiles,
      impactInMs: windupMs,
    });
  }

  private resolveWindup(monster: MonsterRuntime, events: CombatEventPayload[]): void {
    const windup = monster.windup;
    monster.windup = null;
    if (windup === null) {
      return;
    }
    const target = this.players.get(windup.targetId);
    if (target === undefined || !target.alive || !target.targetable) {
      monster.nextAttackAt = this.now + this.monsterAttackInterval(monster);
      return;
    }
    const distanceTiles = Math.hypot(target.x - windup.x, target.y - windup.y) / TILE_UNITS;
    if (distanceTiles > windup.radiusTiles) {
      monster.nextAttackAt = this.now + this.monsterAttackInterval(monster);
      events.push({
        kind: 'miss',
        sourceId: monster.id,
        sourceType: 'monster',
        targetId: target.id,
        targetType: 'player',
      });
      return;
    }
    this.monsterAttack(monster, target, events);
  }

  private monsterAttack(
    monster: MonsterRuntime,
    player: PlayerRuntime,
    events: CombatEventPayload[],
  ): void {
    monster.nextAttackAt = this.now + this.monsterAttackInterval(monster);
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
        attack: this.monsterAttackPower(monster),
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

    const { hpDamage, absorbed } = this.absorbPlayerDamage(player, roll.damage, events);
    player.hp = Math.max(0, player.hp - hpDamage);
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
      ...(absorbed > 0 ? { absorbed } : {}),
    });

    if (player.hp === 0) {
      this.killPlayer(player, monster.id, events);
    }
  }

  private resolveAttack(
    player: PlayerRuntime,
    monster: MonsterRuntime,
    modifier: AttackModifier,
    events: CombatEventPayload[],
    skillId?: string,
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
        ...(skillId === undefined ? {} : { skillId }),
      });
      return;
    }

    this.claimMonster(monster, player.id);
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
      ...(skillId === undefined ? {} : { skillId }),
    });

    if (monster.hp === 0) {
      this.killMonster(monster, player.id, events);
    } else {
      this.maybeEnrage(monster, events);
    }
  }

  private resolvePlayerAttack(
    attacker: PlayerRuntime,
    target: PlayerRuntime,
    modifier: AttackModifier,
    events: CombatEventPayload[],
    skillId?: string,
  ): void {
    const roll = rollAttack(
      combatStatsAsOffense(attacker.stats),
      { defense: target.stats.defense },
      this.rng,
      modifier,
    );

    if (!roll.hit) {
      events.push({
        kind: 'miss',
        sourceId: attacker.id,
        sourceType: 'player',
        targetId: target.id,
        targetType: 'player',
        ...(skillId === undefined ? {} : { skillId }),
      });
      return;
    }

    const { hpDamage, absorbed } = this.absorbPlayerDamage(target, roll.damage, events);
    target.hp = Math.max(0, target.hp - hpDamage);
    events.push({
      kind: 'hit',
      sourceId: attacker.id,
      sourceType: 'player',
      targetId: target.id,
      targetType: 'player',
      damage: roll.damage,
      critical: roll.critical,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
      ...(skillId === undefined ? {} : { skillId }),
      ...(absorbed > 0 ? { absorbed } : {}),
    });

    if (target.hp === 0) {
      this.killPlayer(target, attacker.id, events);
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
      boss: monster.definition.boss === true,
      enraged: monster.enraged,
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

function attackModifier(effect: DamageEffect): AttackModifier {
  return {
    multiplier: effect.multiplier,
    flatDamage: effect.flatDamage,
    canCrit: effect.canCrit,
  };
}

function dotTickDamage(attack: number, effect: DotEffect, targetDefense: number): number {
  return Math.max(
    1,
    Math.round(attack * effect.multiplier + effect.flatDamage - targetDefense * 0.5),
  );
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
