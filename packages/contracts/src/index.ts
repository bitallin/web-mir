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
  MAP_RUNTIME_SCHEMA_VERSION,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  isMapPointInside,
  isMapTileWalkable,
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
  MapRuntimeManifest,
  MapTileset,
} from './mapRuntime';
