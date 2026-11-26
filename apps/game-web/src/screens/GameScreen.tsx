import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHARACTER_CLASS_CATALOG,
  MONSTER_STATE_LABELS,
  SHOP_MAX_QUANTITY,
  SHOP_RANGE_TILES,
  TILE_UNITS,
  type CharacterView,
  type CombatTargetChanged,
  type ItemView,
  type ShopOffer,
  type SkillView,
} from '@web-legend/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { issueGameTicket } from '../api/client';
import { mapBundleFor, mapNameFor } from '../game/mapCatalog';
import {
  describeDelta,
  equipmentDelta,
  itemStatLine,
  qualityOf,
  sortBagItems,
  QUALITY_LABELS,
} from '../lib/inventoryView';
import type { ConnectionStatus } from '../net/worldClient';
import { useWorldSession } from '../session/useWorldSession';
import { Minimap } from './Minimap';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  failed: '连接失败',
};

const COLOR_HEX = ['#9fc4e0', '#e0b087', '#a8d6a1', '#cf9fe0', '#e0d18f', '#8fd0d0'];

function tileOf(player: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.floor(player.x / TILE_UNITS),
    y: Math.floor(player.y / TILE_UNITS),
  };
}

function hpPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
}

function expPercent(exp: number, expToNextLevel: number): number {
  if (expToNextLevel <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((exp / expToNextLevel) * 100)));
}

function describeDeathPenalty(
  rule: { xpLossPermille: number; protectBelowLevel: number } | null,
): string {
  if (rule === null || rule.xpLossPermille === 0) {
    return '无';
  }
  const percent = rule.xpLossPermille / 10;
  const label = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  return `-${label}% 经验 · ${String(rule.protectBelowLevel)} 级前保护`;
}

function describeShopOffer(offer: ShopOffer): string {
  return itemStatLine(offer);
}

function AutoAttackBar({
  autoAttack,
  progress,
}: {
  autoAttack: CombatTargetChanged;
  progress: number;
}): JSX.Element {
  const approaching = autoAttack.reason === 'approaching';
  return (
    <div
      className="auto-attack-bar"
      data-testid="auto-attack-bar"
      data-reason={autoAttack.reason}
      role="progressbar"
      aria-label="自动攻击进度"
      aria-valuenow={approaching ? undefined : progress}
    >
      <span className="auto-attack-fill" style={{ width: `${String(progress)}%` }} />
      <span className="auto-attack-label">
        {approaching ? '正在接近目标…' : '自动攻击中 · Esc 停止'}
      </span>
    </div>
  );
}

export type GameScreenProps = {
  character: CharacterView;
  onExit: () => void;
};

export function GameScreen({ character, onExit }: GameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [bagOpen, setBagOpen] = useState(false);
  const [bagSorted, setBagSorted] = useState(false);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [combatInfoOpen, setCombatInfoOpen] = useState(true);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<'buy' | 'sell'>('buy');
  const requestTicket = useCallback(async () => {
    const response = await issueGameTicket(character.id);
    return response.ticket;
  }, [character.id]);
  const {
    state,
    rejoin,
    sendChat,
    castSkill,
    selectTarget,
    attack,
    stopAutoAttack,
    pickup,
    equip,
    unequip,
    consumeItem,
    shopBuy,
    shopSell,
    toggleSfx,
  } = useWorldSession(containerRef, {
    character,
    requestTicket,
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 200);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const classDefinition = CHARACTER_CLASS_CATALOG[character.classId];
  const self = state.players.find((player) => player.playerId === state.selfId);
  const selfName = self?.displayName;
  const mapName = mapNameFor(state.mapId);
  const targetMonster =
    state.selectedTargetId === null
      ? undefined
      : state.monsters.find((monster) => monster.monsterId === state.selectedTargetId);
  const targetPlayer =
    state.selectedTargetId === null
      ? undefined
      : state.players.find((player) => player.playerId === state.selectedTargetId);
  const profileSkills = state.combatProfile?.skills;
  const skills = useMemo(() => profileSkills ?? [], [profileSkills]);
  const isDead = self?.alive === false;
  const inventory = state.inventory;
  const equipment = inventory?.equipment;
  const items = inventory?.items ?? [];
  const level = inventory?.level ?? state.combatProfile?.level ?? character.level;
  const exp = inventory?.exp ?? character.exp;
  const expToNextLevel = inventory?.expToNextLevel ?? 0;
  const gold = inventory?.gold ?? 0;
  const displayedItems = bagSorted ? sortBagItems(items) : items;

  const equippedFor = (item: ItemView): ItemView | null => {
    if (item.equipSlot === 'weapon') {
      return equipment?.weapon ?? null;
    }
    if (item.equipSlot === 'armor') {
      return equipment?.armor ?? null;
    }
    return null;
  };

  const comparisonFor = (item: ItemView): string => {
    if (item.equipSlot === undefined) {
      return '';
    }
    const equipped = equippedFor(item);
    if (equipped?.itemId === item.itemId) {
      return '';
    }
    const delta = describeDelta(equipmentDelta(equipped, item));
    if (equipped === null) {
      return delta === '' ? '' : `装备后 ${delta}`;
    }
    return delta === '' ? '较当前 属性相同' : `较当前 ${delta}`;
  };
  const mapBundle = useMemo(() => mapBundleFor(state.mapId), [state.mapId]);
  const pvpEnabled = state.combatProfile?.pvpEnabled ?? mapBundle.manifest.pvpMode === 'open';
  const shopCatalog = state.shopCatalog;
  const nearbyMerchant = useMemo(() => {
    if (shopCatalog === null || self === undefined) {
      return null;
    }
    const px = self.x / TILE_UNITS;
    const py = self.y / TILE_UNITS;
    return (
      shopCatalog.merchants.find(
        (merchant) => Math.hypot(px - merchant.tile.x, py - merchant.tile.y) <= SHOP_RANGE_TILES,
      ) ?? null
    );
  }, [shopCatalog, self]);
  const sellPriceByTemplate = useMemo(
    () =>
      new Map((shopCatalog?.sellPrices ?? []).map((entry) => [entry.templateId, entry.sellPrice])),
    [shopCatalog],
  );
  const reviveSeconds =
    state.reviveAt === null ? null : Math.max(0, Math.ceil((state.reviveAt - now) / 1_000));
  const deathPenaltyLabel = describeDeathPenalty(state.combatProfile?.deathPenalty ?? null);
  const autoAttack = state.autoAttack?.autoAttack === true ? state.autoAttack : null;
  const autoTargetId = autoAttack?.targetId ?? null;
  const autoRemainingMs = autoAttack === null ? 0 : Math.max(0, autoAttack.nextAttackAt - now);
  const autoProgress =
    autoAttack === null || autoAttack.reason === 'approaching'
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((autoAttack.attackIntervalMs - autoRemainingMs) / autoAttack.attackIntervalMs) * 100,
            ),
          ),
        );
  const attackingTargetIsShown = (targetId: string | undefined): boolean =>
    targetId !== undefined && autoTargetId === targetId;

  const triggerSkill = useCallback(
    (skill: SkillView) => {
      const targetId = skill.target === 'self' ? state.selfId : state.selectedTargetId;
      if (targetId === null) {
        return;
      }
      castSkill(skill.id, targetId);
    },
    [castSkill, state.selectedTargetId, state.selfId],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const targetElement = event.target;
      if (
        targetElement instanceof HTMLInputElement ||
        targetElement instanceof HTMLTextAreaElement ||
        targetElement instanceof HTMLButtonElement
      ) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        stopAutoAttack();
        return;
      }
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setBagOpen((open) => !open);
        return;
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setCharacterOpen((open) => !open);
        return;
      }
      const skill = skills.find((candidate) => candidate.hotkey === event.key);
      if (skill === undefined) {
        return;
      }
      event.preventDefault();
      triggerSkill(skill);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [skills, triggerSkill, stopAutoAttack]);

  const attackEntity = useCallback(
    (entityId: string) => {
      selectTarget(entityId);
      attack(entityId);
    },
    [attack, selectTarget],
  );

  const submitChat = useCallback(() => {
    const draft = chatDraft;
    if (draft.trim().length === 0) {
      return;
    }
    if (sendChat(draft)) {
      setChatDraft('');
    }
  }, [chatDraft, sendChat]);

  useEffect(() => {
    if (nearbyMerchant === null) {
      setShopOpen(false);
    }
  }, [nearbyMerchant]);

  useEffect(() => {
    const request = state.shopRequest;
    if (request === null || nearbyMerchant === null || nearbyMerchant.id !== request.npcId) {
      return;
    }
    setShopTab('buy');
    setShopOpen(true);
  }, [state.shopRequest, nearbyMerchant]);

  const buyOffer = useCallback(
    (offer: ShopOffer, quantity: number) => {
      if (nearbyMerchant !== null) {
        shopBuy(nearbyMerchant.id, offer.templateId, quantity);
      }
    },
    [nearbyMerchant, shopBuy],
  );

  return (
    <div className="shell">
      <div className="canvas-layer" ref={containerRef} aria-hidden="true" />

      <header className="hud hud-top">
        <div className="brand">
          <p className="eyebrow">浏览器原生 · 实时多人</p>
          <h1>Web Legend</h1>
          <p className="phase">
            {character.name} · {classDefinition.name} Lv.{level}
          </p>
          <p className="vitals" data-testid="vitals">
            HP {self?.hp ?? character.hp}/{self?.maxHp ?? character.maxHp}
            <span>
              法力 {self?.mp ?? character.mp}/{self?.maxMp ?? character.maxMp}
            </span>
            {state.shield !== null ? (
              <span className="shield-chip" data-testid="self-shield">
                护盾 {state.shield.amount}
              </span>
            ) : null}
          </p>
          <p
            className="pvp-badge"
            data-testid="pvp-mode"
            data-pvp={pvpEnabled ? 'open' : 'safe'}
            data-map-id={state.mapId}
          >
            {pvpEnabled ? '野外 · 可自由 PK' : '主城安全区 · 禁止 PK'}
          </p>
          <div
            className="exp-row"
            data-testid="exp-bar"
            data-exp={exp}
            data-exp-next={expToNextLevel}
          >
            <div className="exp-track" aria-hidden="true">
              <span style={{ width: `${String(expPercent(exp, expToNextLevel))}%` }} />
            </div>
            <span className="exp-label">
              经验 {exp}/{expToNextLevel}
            </span>
            <span className="gold-label" data-testid="gold">
              金币 {gold}
            </span>
            <button
              type="button"
              className="bag-toggle"
              data-testid="inventory-toggle"
              aria-expanded={bagOpen}
              onClick={() => {
                const next = !bagOpen;
                setBagOpen(next);
                if (next) {
                  // The centered merchant panel covers the bag's controls.
                  setShopOpen(false);
                }
              }}
            >
              背包 B
            </button>
            <button
              type="button"
              className="bag-toggle"
              data-testid="character-toggle"
              aria-expanded={characterOpen}
              onClick={() => {
                setCharacterOpen((open) => !open);
              }}
            >
              角色 C
            </button>
            {nearbyMerchant !== null ? (
              <button
                type="button"
                className="bag-toggle shop-toggle"
                data-testid="shop-toggle"
                aria-expanded={shopOpen}
                onClick={() => {
                  const next = !shopOpen;
                  setShopTab('buy');
                  setShopOpen(next);
                  if (next) {
                    setBagOpen(false);
                  }
                }}
              >
                杂货商
              </button>
            ) : null}
            <button
              type="button"
              className="bag-toggle"
              data-testid="sfx-toggle"
              data-muted={state.sfxMuted ? 'true' : 'false'}
              aria-pressed={!state.sfxMuted}
              onClick={toggleSfx}
            >
              音效 {state.sfxMuted ? '关' : '开'}
            </button>
          </div>
        </div>

        <section className={`connection connection-${state.status}`} aria-live="polite">
          <div className="connection-heading">
            <span className="connection-label">世界连接</span>
            <span
              className="connection-value"
              data-testid="connection-status"
              data-status={state.status}
            >
              {STATUS_LABEL[state.status]}
            </span>
          </div>
          <p className="connection-detail">
            {state.detail}
            {selfName !== undefined ? ` · ${selfName}` : ''}
          </p>
          <div className="connection-meta">
            <span data-testid="latency">{state.latencyMs ?? '—'} ms</span>
            <span data-testid="room-id">{state.roomId ?? '—'}</span>
            <span data-testid="map-name" data-map-id={state.mapId}>
              {mapName}
            </span>
            {(state.status === 'failed' || state.status === 'disconnected') && (
              <button type="button" className="rejoin" onClick={rejoin}>
                重新加入
              </button>
            )}
            <button type="button" className="rejoin" data-testid="exit-world" onClick={onExit}>
              返回角色
            </button>
          </div>
        </section>
      </header>

      <div className="hud hud-right">
        <aside className="players-panel" aria-label="在线玩家">
          <Minimap
            mapId={state.mapId}
            selfId={state.selfId}
            players={state.players}
            monsters={state.monsters}
            loot={state.loot}
          />
          <div className="panel-heading">
            <h2>附近玩家</h2>
            <span>
              <span data-testid="player-count">{state.players.length}</span>
              {state.roomPlayerCount > state.players.length
                ? ` / ${String(state.roomPlayerCount)}`
                : ''}
            </span>
          </div>
          <ul>
            {state.players.map((player) => {
              const tile = tileOf(player);
              const isSelf = player.playerId === state.selfId;
              return (
                <li
                  key={player.playerId}
                  data-testid="player-row"
                  data-player-id={player.playerId}
                  data-name={player.displayName}
                  data-self={isSelf ? 'true' : 'false'}
                  data-tile-x={tile.x}
                  data-tile-y={tile.y}
                  data-connected={player.connected ? 'true' : 'false'}
                  data-moving={player.moving ? 'true' : 'false'}
                  data-alive={player.alive ? 'true' : 'false'}
                  data-hp={player.hp}
                  data-max-hp={player.maxHp}
                >
                  <span
                    className="swatch"
                    style={{
                      background: COLOR_HEX[player.colorIndex % COLOR_HEX.length] ?? COLOR_HEX[0],
                    }}
                  />
                  <span className="player-name">
                    {player.displayName}
                    {isSelf ? <em>你</em> : null}
                  </span>
                  <span className="player-coords">
                    {player.hp}/{player.maxHp}
                  </span>
                  <span className={`player-state ${player.alive ? '' : 'offline'}`}>
                    {!player.alive ? '倒下' : player.connected ? '在线' : '断线'}
                  </span>
                  {!isSelf && player.alive ? (
                    <button
                      type="button"
                      className="player-attack"
                      data-testid="player-attack"
                      data-player-id={player.playerId}
                      onClick={() => {
                        attackEntity(player.playerId);
                      }}
                    >
                      攻击
                    </button>
                  ) : null}
                </li>
              );
            })}
            {state.players.length === 0 ? <li className="empty">附近没有其他玩家</li> : null}
          </ul>
        </aside>

        <aside
          className={`combat-panel${combatInfoOpen ? '' : ' collapsed'}`}
          aria-label="战斗"
          data-testid="combat-info"
        >
          <div className="panel-heading combat-panel-heading">
            <h2>战斗信息</h2>
            <button
              type="button"
              className="combat-info-toggle"
              data-testid="combat-info-toggle"
              aria-expanded={combatInfoOpen}
              onClick={() => {
                setCombatInfoOpen((open) => !open);
              }}
            >
              {combatInfoOpen ? '收起' : '展开'}
            </button>
          </div>
          <section className="target-panel" data-testid="target-panel">
            <div className="panel-heading">
              <h2>当前目标</h2>
              <span data-testid="monster-count">附近怪物 {state.monsters.length}</span>
            </div>
            {targetMonster === undefined && targetPlayer === undefined ? (
              <p className="target-empty">点击附近的怪物或其他玩家发起攻击</p>
            ) : targetMonster !== undefined ? (
              <>
                <div className="target-heading">
                  <strong data-testid="target-name">{targetMonster.displayName}</strong>
                  <span>Lv.{targetMonster.level}</span>
                  <span data-testid="target-kind" data-kind="monster">
                    怪物
                  </span>
                  <span data-testid="target-state">
                    {MONSTER_STATE_LABELS[targetMonster.state] ?? ''}
                  </span>
                </div>
                <div className="hp-track">
                  <span
                    className="hp-fill"
                    style={{
                      width: `${String(hpPercent(targetMonster.hp, targetMonster.maxHp))}%`,
                    }}
                  />
                </div>
                <div className="target-footer">
                  <p className="target-hp" data-testid="target-hp">
                    {targetMonster.hp}/{targetMonster.maxHp}
                  </p>
                  {attackingTargetIsShown(targetMonster.monsterId) ? (
                    <button
                      type="button"
                      className="target-attack stopping"
                      data-testid="target-stop"
                      onClick={() => {
                        stopAutoAttack();
                      }}
                    >
                      停止攻击
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="target-attack"
                      data-testid="target-attack"
                      onClick={() => {
                        attackEntity(targetMonster.monsterId);
                      }}
                    >
                      攻击
                    </button>
                  )}
                </div>
                {attackingTargetIsShown(targetMonster.monsterId) && autoAttack !== null ? (
                  <AutoAttackBar autoAttack={autoAttack} progress={autoProgress} />
                ) : null}
              </>
            ) : targetPlayer !== undefined ? (
              <>
                <div className="target-heading">
                  <strong data-testid="target-name">{targetPlayer.displayName}</strong>
                  <span>Lv.{targetPlayer.level}</span>
                  <span data-testid="target-kind" data-kind="player">
                    玩家
                  </span>
                  <span data-testid="target-state">
                    {!targetPlayer.alive ? '倒下' : targetPlayer.connected ? '在线' : '断线'}
                  </span>
                </div>
                <div className="hp-track">
                  <span
                    className="hp-fill"
                    style={{ width: `${String(hpPercent(targetPlayer.hp, targetPlayer.maxHp))}%` }}
                  />
                </div>
                <div className="target-footer">
                  <p className="target-hp" data-testid="target-hp">
                    {targetPlayer.hp}/{targetPlayer.maxHp}
                  </p>
                  {attackingTargetIsShown(targetPlayer.playerId) ? (
                    <button
                      type="button"
                      className="target-attack stopping"
                      data-testid="target-stop"
                      onClick={() => {
                        stopAutoAttack();
                      }}
                    >
                      停止攻击
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="target-attack"
                      data-testid="target-attack"
                      disabled={!pvpEnabled || !targetPlayer.alive}
                      title={pvpEnabled ? '攻击玩家' : '安全区内禁止攻击玩家'}
                      onClick={() => {
                        attackEntity(targetPlayer.playerId);
                      }}
                    >
                      {pvpEnabled ? '攻击玩家' : '安全区'}
                    </button>
                  )}
                </div>
                {attackingTargetIsShown(targetPlayer.playerId) && autoAttack !== null ? (
                  <AutoAttackBar autoAttack={autoAttack} progress={autoProgress} />
                ) : null}
              </>
            ) : null}
          </section>

          <section className="monster-list-panel" aria-label="附近怪物">
            <ul data-testid="monster-list">
              {state.monsters.map((monster) => (
                <li key={monster.monsterId}>
                  <button
                    type="button"
                    className={`monster-row${monster.monsterId === state.selectedTargetId ? ' selected' : ''}`}
                    data-testid="monster-row"
                    data-monster-id={monster.monsterId}
                    data-hp={monster.hp}
                    data-max-hp={monster.maxHp}
                    data-state={monster.state}
                    onClick={() => {
                      selectTarget(monster.monsterId);
                      attack(monster.monsterId);
                    }}
                  >
                    <span>{monster.displayName}</span>
                    <span>
                      {monster.hp}/{monster.maxHp}
                    </span>
                    <span>{MONSTER_STATE_LABELS[monster.state] ?? monster.state}</span>
                  </button>
                </li>
              ))}
              {state.monsters.length === 0 ? <li className="empty">附近没有怪物</li> : null}
            </ul>
          </section>

          <section className="loot-panel" aria-label="地面掉落">
            <div className="panel-heading">
              <h2>附近掉落</h2>
              <span data-testid="loot-count">{state.loot.length}</span>
            </div>
            <ul data-testid="loot-list">
              {state.loot.map((drop) => (
                <li key={drop.dropId}>
                  <button
                    type="button"
                    className="loot-row"
                    data-testid="loot-row"
                    data-drop-id={drop.dropId}
                    data-template-id={drop.templateId}
                    data-owner-id={drop.ownerId}
                    onClick={() => {
                      pickup(drop.dropId);
                    }}
                  >
                    <span>{drop.displayName}</span>
                    <span>×{drop.quantity}</span>
                    <span className="loot-action">拾取</span>
                  </button>
                </li>
              ))}
              {state.loot.length === 0 ? <li className="empty">击败怪物后会掉落物品</li> : null}
            </ul>
          </section>

          <section className="combat-log-panel" aria-label="战斗日志">
            <div className="panel-heading">
              <h2>战斗记录</h2>
            </div>
            <ul data-testid="combat-log">
              {state.combatLog.length === 0 ? <li className="empty">尚未发生战斗</li> : null}
              {state.combatLog.map((entry) => (
                <li key={entry.id} data-testid="combat-log-entry" data-tone={entry.tone}>
                  {entry.text}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <aside className="hud skill-dock" aria-label="技能">
        <section className="skill-bar">
          <div className="panel-heading">
            <h2>技能</h2>
            <span>点击怪物攻击 · 快捷键</span>
          </div>
          <div className="skill-list">
            {skills.map((skill, index) => {
              const remaining = Math.max(0, (state.skillCooldowns[skill.id] ?? 0) - now);
              const needsTarget = skill.target === 'enemy' && state.selectedTargetId === null;
              const noMana = (self?.mp ?? 0) < skill.mpCost;
              const disabled = remaining > 0 || needsTarget || noMana || isDead;
              return (
                <button
                  key={skill.id}
                  type="button"
                  className={`skill-button${remaining > 0 ? ' cooling' : ''}`}
                  data-testid={`skill-${String(index + 1)}`}
                  data-skill-id={skill.id}
                  data-cooldown-ms={Math.ceil(remaining)}
                  disabled={disabled}
                  title={skill.description}
                  onClick={() => {
                    triggerSkill(skill);
                  }}
                >
                  <span className="skill-key">{skill.hotkey}</span>
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-cost">{skill.mpCost} MP</span>
                  {remaining > 0 ? (
                    <span className="skill-cooldown">{Math.ceil(remaining / 1_000)}s</span>
                  ) : null}
                </button>
              );
            })}
            {skills.length === 0 ? <p className="target-empty">正在同步技能…</p> : null}
          </div>
        </section>
      </aside>

      <aside className="hud chat-panel" aria-label="同图聊天">
        <div className="panel-heading">
          <h2>地图频道</h2>
          <span>{mapName}</span>
        </div>
        {state.systemMessages.length > 0 ? (
          <ul className="system-log" data-testid="system-log">
            {state.systemMessages.slice(-8).map((entry) => (
              <li key={entry.id} data-testid="system-message" data-kind={entry.kind}>
                <span className="system-tag">系统</span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <ul data-testid="chat-log">
          {state.messages.length === 0 ? (
            <li className="empty">同地图的玩家都能看到这里的消息</li>
          ) : null}
          {state.messages.map((message) => (
            <li
              key={message.messageId}
              data-testid="chat-message"
              data-player-id={message.playerId}
            >
              <span className="chat-author">{message.displayName}</span>
              <span className="chat-text">{message.message}</span>
            </li>
          ))}
        </ul>
        <form
          className="chat-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitChat();
          }}
        >
          <input
            type="text"
            data-testid="chat-input"
            placeholder="说点什么…"
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            value={chatDraft}
            onChange={(event) => {
              setChatDraft(event.target.value);
            }}
          />
          <button type="submit" data-testid="chat-send">
            发送
          </button>
        </form>
      </aside>

      {shopOpen && nearbyMerchant !== null && shopCatalog !== null ? (
        <aside className="hud shop-panel" data-testid="shop-panel" aria-label="杂货商">
          <div className="panel-heading">
            <h2>{nearbyMerchant.name}</h2>
            <span data-testid="shop-gold">金币 {gold}</span>
            <button
              type="button"
              className="panel-close"
              onClick={() => {
                setShopOpen(false);
              }}
            >
              关闭
            </button>
          </div>

          <div className="shop-tabs">
            <button
              type="button"
              data-testid="shop-tab-buy"
              aria-pressed={shopTab === 'buy'}
              onClick={() => {
                setShopTab('buy');
              }}
            >
              购买
            </button>
            <button
              type="button"
              data-testid="shop-tab-sell"
              aria-pressed={shopTab === 'sell'}
              onClick={() => {
                setShopTab('sell');
              }}
            >
              出售
            </button>
          </div>

          {shopTab === 'buy' ? (
            <ul className="shop-list" data-testid="shop-offers">
              {shopCatalog.offers.map((offer) => {
                // Never offer a quantity the content or protocol will reject.
                const bulkQuantity = Math.min(5, offer.maxStack, SHOP_MAX_QUANTITY);
                return (
                  <li
                    key={offer.templateId}
                    className="shop-offer"
                    data-testid="shop-offer"
                    data-template-id={offer.templateId}
                    data-price={offer.buyPrice}
                  >
                    <div className="shop-offer-main">
                      <strong>{offer.name}</strong>
                      <span className="shop-offer-meta">{describeShopOffer(offer)}</span>
                      <span className="shop-offer-level">
                        Lv.{offer.levelRequirement}
                        {offer.levelRequirement > level ? ' · 等级不足' : ''}
                      </span>
                    </div>
                    <span className="shop-price">{offer.buyPrice} 金币</span>
                    <button
                      type="button"
                      data-testid="shop-buy"
                      disabled={gold < offer.buyPrice}
                      onClick={() => {
                        buyOffer(offer, 1);
                      }}
                    >
                      买 1
                    </button>
                    {offer.stackable && bulkQuantity > 1 ? (
                      <button
                        type="button"
                        data-testid="shop-buy-five"
                        disabled={gold < offer.buyPrice * bulkQuantity}
                        onClick={() => {
                          buyOffer(offer, bulkQuantity);
                        }}
                      >
                        {`买 ${String(bulkQuantity)}`}
                      </button>
                    ) : null}
                  </li>
                );
              })}
              {shopCatalog.offers.length === 0 ? (
                <li className="empty">商人暂时没有可出售的商品</li>
              ) : null}
            </ul>
          ) : (
            <ul className="shop-list" data-testid="shop-sell-items">
              {items
                .filter((item) => sellPriceByTemplate.has(item.templateId))
                .map((item) => {
                  const unitPrice = sellPriceByTemplate.get(item.templateId) ?? 0;
                  const bulkQuantity = Math.min(item.quantity, SHOP_MAX_QUANTITY);
                  return (
                    <li
                      key={item.itemId}
                      className="shop-offer"
                      data-testid="shop-sell-item"
                      data-item-id={item.itemId}
                      data-price={unitPrice}
                    >
                      <div className="shop-offer-main">
                        <strong>{item.name}</strong>
                        <span className="shop-offer-meta">持有 {item.quantity}</span>
                      </div>
                      <span className="shop-price">{unitPrice} 金币/个</span>
                      <button
                        type="button"
                        data-testid="shop-sell"
                        onClick={() => {
                          shopSell(nearbyMerchant.id, item.itemId, 1);
                        }}
                      >
                        卖 1
                      </button>
                      {item.quantity > 1 ? (
                        <button
                          type="button"
                          data-testid="shop-sell-all"
                          onClick={() => {
                            shopSell(nearbyMerchant.id, item.itemId, bulkQuantity);
                          }}
                        >
                          {bulkQuantity === item.quantity ? '全部' : `卖 ${String(bulkQuantity)}`}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              {items.every((item) => !sellPriceByTemplate.has(item.templateId)) ? (
                <li className="empty">背包里没有商人愿意收购的物品</li>
              ) : null}
            </ul>
          )}
          <p className="shop-hint">交易由服务器结算：金币与背包同时更新，刷新或重登不会丢失。</p>
        </aside>
      ) : null}

      {bagOpen && inventory !== null ? (
        <aside className="hud bag-panel" data-testid="inventory-panel" aria-label="背包与装备">
          <div className="panel-heading">
            <h2>背包与装备</h2>
            <span>
              {items.length}/{inventory.capacity}
            </span>
            <button
              type="button"
              className="panel-sort"
              data-testid="bag-sort"
              aria-pressed={bagSorted}
              onClick={() => {
                setBagSorted((sorted) => !sorted);
              }}
            >
              {bagSorted ? '恢复顺序' : '整理'}
            </button>
            <button
              type="button"
              className="panel-close"
              onClick={() => {
                setBagOpen(false);
              }}
            >
              关闭
            </button>
          </div>

          <div className="equipment-grid">
            <div
              className="equipment-slot"
              data-testid="equipment-weapon"
              data-item-id={equipment?.weapon?.itemId ?? ''}
              data-template-id={equipment?.weapon?.templateId ?? ''}
            >
              <span className="slot-label">武器</span>
              {equipment?.weapon !== null && equipment?.weapon !== undefined ? (
                <div className="slot-body">
                  <strong>{equipment.weapon.name}</strong>
                  <span>{itemStatLine(equipment.weapon)}</span>
                  <button
                    type="button"
                    data-testid="unequip-weapon"
                    onClick={() => {
                      unequip('weapon');
                    }}
                  >
                    卸下
                  </button>
                </div>
              ) : (
                <em>空</em>
              )}
            </div>
            <div
              className="equipment-slot"
              data-testid="equipment-armor"
              data-item-id={equipment?.armor?.itemId ?? ''}
              data-template-id={equipment?.armor?.templateId ?? ''}
            >
              <span className="slot-label">护甲</span>
              {equipment?.armor !== null && equipment?.armor !== undefined ? (
                <div className="slot-body">
                  <strong>{equipment.armor.name}</strong>
                  <span>{itemStatLine(equipment.armor)}</span>
                  <button
                    type="button"
                    data-testid="unequip-armor"
                    onClick={() => {
                      unequip('armor');
                    }}
                  >
                    卸下
                  </button>
                </div>
              ) : (
                <em>空</em>
              )}
            </div>
          </div>

          <p className="bag-stats" data-testid="bag-stats">
            攻击 {inventory.attack} · 防御 {inventory.defense} · 金币 {inventory.gold}
          </p>

          <ul className="bag-grid" data-testid="inventory-items">
            {displayedItems.map((item) => (
              <li
                key={item.itemId}
                className={`bag-item bag-item-${qualityOf(item)}`}
                data-testid="inventory-item"
                data-item-id={item.itemId}
                data-template-id={item.templateId}
                data-quantity={item.quantity}
                data-kind={item.kind}
                data-quality={qualityOf(item)}
              >
                <span className="bag-item-name">
                  {item.name}
                  {qualityOf(item) === 'rare' ? (
                    <em className="bag-item-quality">{QUALITY_LABELS.rare}</em>
                  ) : null}
                </span>
                <span className="bag-item-qty">×{item.quantity}</span>
                <span className="bag-item-meta">{itemStatLine(item)}</span>
                {comparisonFor(item) !== '' ? (
                  <span
                    className="bag-item-compare"
                    data-testid="equipment-comparison"
                    data-comparison={comparisonFor(item)}
                  >
                    {comparisonFor(item)}
                  </span>
                ) : null}
                {item.kind === 'weapon' || item.kind === 'armor' ? (
                  <button
                    type="button"
                    data-testid="equip-item"
                    onClick={() => {
                      equip(item.itemId);
                    }}
                  >
                    装备
                  </button>
                ) : null}
                {item.kind === 'consumable' ? (
                  <button
                    type="button"
                    data-testid="use-item"
                    onClick={() => {
                      consumeItem(item.itemId);
                    }}
                  >
                    使用
                  </button>
                ) : null}
              </li>
            ))}
            {items.length === 0 ? <li className="empty">背包是空的</li> : null}
          </ul>
          <p className="bag-hint">装备与使用由服务器事务确认；金币与经验在击杀结算后写入数据库。</p>
        </aside>
      ) : null}

      {characterOpen ? (
        <aside className="hud character-panel" data-testid="character-panel" aria-label="角色面板">
          <div className="panel-heading">
            <h2>角色面板</h2>
            <button
              type="button"
              className="panel-close"
              onClick={() => {
                setCharacterOpen(false);
              }}
            >
              关闭
            </button>
          </div>
          <dl>
            <div>
              <dt>角色</dt>
              <dd>
                {character.name} · {classDefinition.name}
              </dd>
            </div>
            <div>
              <dt>等级</dt>
              <dd data-testid="character-level">{level}</dd>
            </div>
            <div>
              <dt>经验</dt>
              <dd>
                {exp}/{expToNextLevel}
              </dd>
            </div>
            <div>
              <dt>死亡代价</dt>
              <dd data-testid="death-penalty">{deathPenaltyLabel}</dd>
            </div>
            <div>
              <dt>金币</dt>
              <dd>{gold}</dd>
            </div>
            <div>
              <dt>生命</dt>
              <dd>
                {self?.hp ?? inventory?.hp ?? 0}/{self?.maxHp ?? inventory?.maxHp ?? 0}
              </dd>
            </div>
            <div>
              <dt>法力</dt>
              <dd>
                {self?.mp ?? inventory?.mp ?? 0}/{self?.maxMp ?? inventory?.maxMp ?? 0}
              </dd>
            </div>
            <div>
              <dt>护盾</dt>
              <dd data-testid="character-shield">{state.shield?.amount ?? 0}</dd>
            </div>
            <div>
              <dt>攻击 / 防御</dt>
              <dd>
                {inventory?.attack ?? state.combatProfile?.attack ?? 0} /{' '}
                {inventory?.defense ?? state.combatProfile?.defense ?? 0}
              </dd>
            </div>
            <div>
              <dt>武器 / 护甲</dt>
              <dd>
                {equipment?.weapon?.name ?? '空'} / {equipment?.armor?.name ?? '空'}
              </dd>
            </div>
            <div>
              <dt>地图</dt>
              <dd>
                {mapName}（{pvpEnabled ? '可 PK' : '安全区'}）
              </dd>
            </div>
            <div>
              <dt>复活</dt>
              <dd data-testid="revive-countdown">
                {reviveSeconds === null ? '—' : `${String(reviveSeconds)} 秒`}
              </dd>
            </div>
          </dl>
          <p className="bag-hint">
            移动、攻击与死亡复活都由服务端结算；安全区规则随地图编译产物固定。
          </p>
        </aside>
      ) : null}

      {state.levelUpNotice !== null ? (
        <div className="level-up-banner" data-testid="level-up-banner" role="status">
          <strong>升级！</strong> Lv.{state.levelUpNotice.level} · 生命 {state.levelUpNotice.maxHp}{' '}
          · 攻击 {state.levelUpNotice.attack}
        </div>
      ) : null}

      {isDead ? (
        <div
          className="death-banner"
          data-testid="player-dead"
          data-revive-in={reviveSeconds ?? ''}
          role="status"
        >
          你已倒下
          {reviveSeconds === null
            ? '，正在等待复活…'
            : `，${String(reviveSeconds)} 秒后在地图复活点复活`}
        </div>
      ) : null}

      <footer className="hud hud-bottom">
        <p>点击怪物锁定并自动攻击（Esc 停止） · 点击地面移动 · 技能与 PK 由服务端结算</p>
        <p data-testid="command-count">指令 {state.commandCount}</p>
        <p>tick {state.serverTick}</p>
        <p>协议 v1 · 服务端 20Hz 权威战斗 · {pvpEnabled ? '野外 PK' : '安全区'}</p>
      </footer>

      {state.status === 'connecting' ||
      state.status === 'reconnecting' ||
      state.status === 'failed' ? (
        <div
          className="connection-overlay"
          data-testid="connection-overlay"
          data-status={state.status}
          role="status"
        >
          <div className="connection-overlay-card">
            <p className="eyebrow">{state.status === 'failed' ? '连接中断' : '正在连接世界'}</p>
            <strong>{state.detail}</strong>
            {state.status === 'failed' ? (
              <button
                type="button"
                className="rejoin"
                data-testid="overlay-rejoin"
                onClick={rejoin}
              >
                重新加入
              </button>
            ) : (
              <span className="connection-spinner" aria-hidden="true" />
            )}
          </div>
        </div>
      ) : null}

      {state.kicked !== null ? (
        <div
          className="connection-overlay"
          data-testid="kicked-overlay"
          data-kind={state.kicked.kind}
          role="alert"
        >
          <div className="connection-overlay-card">
            <p className="eyebrow">
              {state.kicked.kind === 'banned' ? '账号已封禁' : '连接已被断开'}
            </p>
            <strong>{state.kicked.reason}</strong>
            {state.kicked.kind === 'kicked' ? (
              <button type="button" className="rejoin" data-testid="kicked-rejoin" onClick={rejoin}>
                重新加入
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.notices.length > 0 ? (
        <div className="notice-stack" aria-live="polite">
          {state.notices.map((notice, index) => (
            <div
              key={notice.id}
              className={`notice notice-${notice.kind}`}
              data-testid={index === state.notices.length - 1 ? 'last-notice' : 'notice-toast'}
              role="status"
            >
              {notice.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
