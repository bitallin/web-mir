import type { AccountView, CharacterView, RealmView } from '@web-legend/contracts';
import type { Account, CharacterWithRealm, Realm } from '@web-legend/persistence';

export function toAccountView(account: Account): AccountView {
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt.toISOString(),
  };
}

export function toCharacterView(character: CharacterWithRealm): CharacterView {
  return {
    id: character.id,
    name: character.name,
    classId: character.classId,
    level: character.level,
    exp: character.exp,
    hp: character.hp,
    maxHp: character.maxHp,
    mp: character.mp,
    maxMp: character.maxMp,
    mapId: character.mapId,
    x: character.x,
    y: character.y,
    facing: character.facing,
    realmId: character.realmId,
    realmCode: character.realmCode,
    createdAt: character.createdAt.toISOString(),
  };
}

export function toRealmView(realm: Realm): RealmView {
  return { id: realm.id, code: realm.code, name: realm.name };
}
