export { API_PREFIX, MIN_SUPPORTED_PROTOCOL, PROTOCOL_VERSION, SERVICE_NAMES } from './protocol';
export type { ServiceName } from './protocol';

export {
  healthResponseSchema,
  readinessCheckSchema,
  readinessResponseSchema,
  serviceNameSchema,
} from './health';
export type {
  HealthResponse,
  HealthServiceName,
  ReadinessCheck,
  ReadinessResponse,
} from './health';

export { apiErrorCodeSchema, apiErrorSchema } from './errors';
export type { ApiError, ApiErrorCode } from './errors';

export {
  accountViewSchema,
  authResponseSchema,
  loginRequestSchema,
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  registerRequestSchema,
  USERNAME_PATTERN,
  usernameSchema,
} from './auth';
export type { AccountView, AuthResponse, LoginRequest, RegisterRequest } from './auth';

export {
  CHARACTER_CLASSES,
  CHARACTER_CLASS_CATALOG,
  characterClassSchema,
  characterNameSchema,
  charactersResponseSchema,
  characterResponseSchema,
  characterViewSchema,
  createCharacterRequestSchema,
  GAME_TICKET_TTL_SECONDS,
  gameTicketRequestSchema,
  gameTicketResponseSchema,
  normalizeCharacterName,
  realmViewSchema,
  realmsResponseSchema,
} from './character';
export type {
  CharacterClass,
  CharacterClassDefinition,
  CharacterResponse,
  CharactersResponse,
  CharacterView,
  CreateCharacterRequest,
  GameTicketRequest,
  GameTicketResponse,
  RealmView,
  RealmsResponse,
} from './character';

export { tilePointSchema } from './map';
export type { TilePoint } from './map';

export {
  COMBAT_CONTENT_VERSION,
  MONSTER_STATE_CODES,
  MONSTER_STATE_LABELS,
  MONSTER_STATES,
  combatBasicAttackSchema,
  combatEntityTypeSchema,
  combatEventSchema,
  combatProfileSchema,
  monsterStateKindFromCode,
  monsterStateKindSchema,
  skillCastSchema,
  skillViewSchema,
} from './combat';
export type {
  CombatBasicAttack,
  CombatEntityType,
  CombatEvent,
  CombatEventKind,
  CombatEventPayload,
  CombatProfile,
  MonsterStateKind,
  SkillCast,
  SkillView,
} from './combat';

export {
  CHAT_MESSAGE_MAX_LENGTH,
  CLIENT_MESSAGES,
  COMMAND_REJECTION_CODES,
  COMMAND_REJECTION_MESSAGES,
  DEFAULT_PATCH_RATE_MS,
  DEFAULT_TICK_HZ,
  FACING,
  PLAYER_SPEED_UNITS_PER_SECOND,
  SERVER_MESSAGES,
  TILE_UNITS,
  chatMessageSchema,
  chatSendSchema,
  commandAckSchema,
  commandRejectedSchema,
  commandRejectionCodeSchema,
  moveToCommandSchema,
  sessionTransferSchema,
  systemNoticeSchema,
  worldJoinOptionsSchema,
} from './realtime';
export type {
  ChatMessage,
  ChatSend,
  CommandAck,
  CommandRejected,
  CommandRejectionCode,
  Facing,
  MoveToCommand,
  SessionTransfer,
  SystemNotice,
  WorldJoinOptions,
} from './realtime';

export {
  assetCharacterSchema,
  assetManifestSchema,
  assetMapEntrySchema,
  assetTileSchema,
  assetTilesetSchema,
} from './assets';
export type { AssetCharacter, AssetManifest, AssetTile, AssetTileset } from './assets';

export {
  ECONOMY_CONTENT_VERSION,
  EQUIPMENT_SLOTS,
  INVENTORY_CAPACITY,
  ITEM_KINDS,
  LOOT_EXPIRY_MS,
  LOOT_OWNER_WINDOW_MS,
  PICKUP_RANGE_TILES,
  assetCommandKindSchema,
  assetResultSchema,
  characterProgressSchema,
  equipmentSlotSchema,
  equipmentViewSchema,
  inventoryEquipSchema,
  inventorySnapshotSchema,
  inventoryUnequipSchema,
  inventoryUseSchema,
  itemKindSchema,
  itemViewSchema,
  itemsBySlot,
  levelUpSchema,
  lootClaimedSchema,
  lootPickupSchema,
} from './economy';
export type {
  AssetCommandKind,
  AssetResult,
  CharacterProgress,
  EquipmentSlot,
  EquipmentView,
  InventoryEquip,
  InventorySnapshot,
  InventoryUnequip,
  InventoryUse,
  ItemKind,
  ItemView,
  LevelUp,
  LootClaimed,
  LootPickup,
} from './economy';

export {
  MAP_RUNTIME_SCHEMA_VERSION,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  isMapPointInside,
  isMapTileWalkable,
  isPvpEnabled,
  mapIdFromRoomName,
  mapIdSchema,
  mapMonsterSpawnSchema,
  mapNpcPointSchema,
  mapPortalSchema,
  mapRuntimeManifestSchema,
  worldRoomNameFor,
} from './mapRuntime';
export type {
  MapMonsterSpawn,
  MapNpcPoint,
  MapPortal,
  MapPvpMode,
  MapRuntimeManifest,
  MapTileset,
} from './mapRuntime';
