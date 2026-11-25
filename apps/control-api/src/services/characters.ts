import {
  CHARACTER_CLASS_CATALOG,
  TILE_UNITS,
  normalizeCharacterName,
  type CreateCharacterRequest,
} from '@web-legend/contracts';
import { STARTER_TOWN_MAP } from '@web-legend/contracts/maps';
import { STARTER_KIT } from '@web-legend/game-domain';
import {
  findCharacterForAccount,
  findRealmById,
  insertCharacterWithItems,
  isUniqueViolation,
  listActiveRealms,
  listCharactersByAccount,
  type CharacterWithRealm,
  type Database,
  type Realm,
} from '@web-legend/persistence';

import { AppError } from '../http/errors';

export const MAX_CHARACTERS_PER_ACCOUNT = 8;

/**
 * Character creation and ownership checks. Realm and class come from server
 * data; the client supplies only a name, class id and optional realm id.
 */
export class CharacterService {
  constructor(private readonly db: Database) {}

  async list(accountId: string): Promise<CharacterWithRealm[]> {
    return listCharactersByAccount(this.db, accountId);
  }

  async listRealms(): Promise<Realm[]> {
    return listActiveRealms(this.db);
  }

  async create(accountId: string, input: CreateCharacterRequest): Promise<CharacterWithRealm> {
    const realm = await this.resolveRealm(input.realmId);
    const existing = await listCharactersByAccount(this.db, accountId);
    if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) {
      throw new AppError(
        409,
        'CHARACTER_LIMIT_REACHED',
        `每个账号最多创建 ${String(MAX_CHARACTERS_PER_ACCOUNT)} 个角色`,
      );
    }

    const definition = CHARACTER_CLASS_CATALOG[input.classId];
    const spawn = STARTER_TOWN_MAP.spawnPoints[0];
    if (spawn === undefined) {
      throw new Error('starter town has no spawn point');
    }

    try {
      const character = await insertCharacterWithItems(
        this.db,
        {
          accountId,
          realmId: realm.id,
          name: input.name,
          nameNormalized: normalizeCharacterName(input.name),
          classId: definition.id,
          level: 1,
          exp: 0,
          hp: definition.baseMaxHp,
          maxHp: definition.baseMaxHp,
          mp: definition.baseMaxMp,
          maxMp: definition.baseMaxMp,
          mapId: STARTER_TOWN_MAP.mapId,
          x: spawn.x * TILE_UNITS + TILE_UNITS / 2,
          y: spawn.y * TILE_UNITS + TILE_UNITS / 2,
          facing: 2,
        },
        STARTER_KIT[definition.id],
      );
      return { ...character, realmCode: realm.code };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'CHARACTER_NAME_TAKEN', '该区服中已存在同名角色');
      }
      throw error;
    }
  }

  async get(accountId: string, characterId: string): Promise<CharacterWithRealm> {
    const character = await findCharacterForAccount(this.db, characterId, accountId);
    if (character === undefined) {
      throw new AppError(404, 'NOT_FOUND', '角色不存在');
    }
    return character;
  }

  private async resolveRealm(realmId: string | undefined): Promise<Realm> {
    if (realmId !== undefined) {
      const realm = await findRealmById(this.db, realmId);
      if (realm === undefined || realm.status !== 'active') {
        throw new AppError(404, 'REALM_NOT_FOUND', '区服不存在或未开放');
      }
      return realm;
    }

    const [realm] = await listActiveRealms(this.db);
    if (realm === undefined) {
      throw new AppError(404, 'REALM_NOT_FOUND', '当前没有可用区服');
    }
    return realm;
  }
}
