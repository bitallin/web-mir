import {
  CHARACTER_CLASSES,
  CHARACTER_CLASS_CATALOG,
  characterNameSchema,
  type AccountView,
  type CharacterClass,
  type CharacterView,
} from '@web-legend/contracts';
import { useState, type FormEvent } from 'react';

export type CharacterScreenProps = {
  account: AccountView;
  characters: CharacterView[];
  pending: boolean;
  error: string | null;
  onCreate: (input: { name: string; classId: CharacterClass }) => Promise<CharacterView | null>;
  onEnter: (character: CharacterView) => void;
  onLogout: () => Promise<void>;
  onClearError: () => void;
};

export function CharacterScreen({
  account,
  characters,
  pending,
  error,
  onCreate,
  onEnter,
  onLogout,
  onClearError,
}: CharacterScreenProps) {
  const [name, setName] = useState('');
  const [classId, setClassId] = useState<CharacterClass>('warrior');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLocalError(null);

    const parsed = characterNameSchema.safeParse(name);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? '请输入有效的角色名');
      return;
    }

    void onCreate({ name: parsed.data, classId }).then((character) => {
      if (character !== null) {
        setName('');
      }
    });
  };

  return (
    <div className="entry-shell">
      <div className="entry-atmosphere" aria-hidden="true">
        <div className="entry-glow" />
        <div className="entry-grid" />
      </div>

      <main className="character-shell">
        <header className="character-header">
          <div>
            <p className="eyebrow">角色选择</p>
            <h1>Web Legend</h1>
            <p className="character-account" data-testid="account-name">
              {account.username}
            </p>
          </div>
          <button
            type="button"
            className="ghost-button"
            data-testid="logout"
            onClick={() => {
              void onLogout();
            }}
            disabled={pending}
          >
            退出登录
          </button>
        </header>

        <section className="character-list" aria-label="我的角色">
          <div className="section-heading">
            <h2>我的角色</h2>
            <span>{characters.length} / 8</span>
          </div>

          {characters.length === 0 ? (
            <p className="character-empty">还没有角色。选择职业并命名，创建你的第一段传奇。</p>
          ) : (
            <ul>
              {characters.map((character) => (
                <li
                  key={character.id}
                  className="character-card"
                  data-testid="character-card"
                  data-character-id={character.id}
                  data-character-name={character.name}
                >
                  <div className="character-emblem" aria-hidden="true">
                    {CHARACTER_CLASS_CATALOG[character.classId].name.slice(0, 1)}
                  </div>
                  <div className="character-identity">
                    <strong>{character.name}</strong>
                    <span>
                      {CHARACTER_CLASS_CATALOG[character.classId].name} · Lv.{character.level}
                    </span>
                    <small>
                      {character.realmCode} · 坐标 {Math.floor(character.x / 1000)},
                      {Math.floor(character.y / 1000)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="enter-button"
                    data-testid="enter-world"
                    onClick={() => {
                      onEnter(character);
                    }}
                  >
                    进入世界
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="character-create" aria-label="创建角色">
          <div className="section-heading">
            <h2>创建角色</h2>
          </div>

          <form onSubmit={submit}>
            <div className="class-options">
              {CHARACTER_CLASSES.map((id) => {
                const definition = CHARACTER_CLASS_CATALOG[id];
                return (
                  <button
                    type="button"
                    key={id}
                    data-testid={`class-${id}`}
                    className={`class-option ${classId === id ? 'selected' : ''}`}
                    onClick={() => {
                      setClassId(id);
                      setLocalError(null);
                      onClearError();
                    }}
                    disabled={pending}
                  >
                    <strong>{definition.name}</strong>
                    <span>{definition.description}</span>
                    <small>
                      HP {definition.baseMaxHp} · MP {definition.baseMaxMp}
                    </small>
                  </button>
                );
              })}
            </div>

            <div className="create-row">
              <label>
                <span>角色名</span>
                <input
                  data-testid="character-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setLocalError(null);
                    onClearError();
                  }}
                  placeholder="2–12 位汉字、字母、数字或下划线"
                  maxLength={12}
                  disabled={pending}
                />
              </label>
              <button
                type="submit"
                className="entry-submit"
                data-testid="character-create"
                disabled={pending}
              >
                {pending ? '创建中…' : '创建角色'}
              </button>
            </div>

            {localError !== null || error !== null ? (
              <p className="entry-error" data-testid="character-error" role="alert">
                {localError ?? error}
              </p>
            ) : null}
          </form>
        </section>
      </main>
    </div>
  );
}
