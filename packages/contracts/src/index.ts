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

export {
  isTileInsideMap,
  isTileWalkable,
  MAP_SCHEMA_VERSION,
  MAP_TILE_FLOOR,
  MAP_TILE_GRASS,
  MAP_TILE_WALL,
  mapManifestSchema,
  tileCharAt,
  tilePointSchema,
} from './map';
export type { MapManifest, TilePoint } from './map';

export {
  CLIENT_MESSAGES,
  COMMAND_REJECTION_CODES,
  COMMAND_REJECTION_MESSAGES,
  DEFAULT_PATCH_RATE_MS,
  DEFAULT_TICK_HZ,
  FACING,
  PLAYER_SPEED_UNITS_PER_SECOND,
  SERVER_MESSAGES,
  TILE_UNITS,
  WORLD_ROOM_NAME,
  commandAckSchema,
  commandRejectedSchema,
  commandRejectionCodeSchema,
  moveToCommandSchema,
  systemNoticeSchema,
  worldJoinOptionsSchema,
} from './realtime';
export type {
  CommandAck,
  CommandRejected,
  CommandRejectionCode,
  Facing,
  MoveToCommand,
  SystemNotice,
  WorldJoinOptions,
} from './realtime';
