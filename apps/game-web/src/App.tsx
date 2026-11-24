import type { CharacterClass, CharacterView } from '@web-legend/contracts';
import { useEffect, useState } from 'react';

import { useAuth } from './auth/useAuth';
import { AuthScreen } from './screens/AuthScreen';
import { CharacterScreen } from './screens/CharacterScreen';
import { GameScreen } from './screens/GameScreen';

function Splash() {
  return (
    <div className="entry-shell">
      <div className="entry-atmosphere" aria-hidden="true">
        <div className="entry-glow" />
        <div className="entry-grid" />
      </div>
      <div className="splash">
        <p className="eyebrow">Web Legend</p>
        <p>正在确认登录状态…</p>
      </div>
    </div>
  );
}

export function App() {
  const { state, login, register, logout, createCharacter, clearError } = useAuth();
  const [selected, setSelected] = useState<CharacterView | null>(null);

  useEffect(() => {
    if (state.status !== 'authenticated') {
      setSelected(null);
      return;
    }
    // A character deleted or refreshed elsewhere must not keep a stale world.
    if (selected !== null && !state.characters.some((item) => item.id === selected.id)) {
      setSelected(null);
    }
  }, [state.status, state.characters, selected]);

  if (state.status === 'loading') {
    return <Splash />;
  }

  if (state.status === 'anonymous' || state.account === null) {
    return (
      <AuthScreen
        pending={state.pending}
        error={state.error}
        onLogin={login}
        onRegister={register}
        onClearError={clearError}
      />
    );
  }

  if (selected !== null) {
    return (
      <GameScreen
        character={selected}
        onExit={() => {
          setSelected(null);
        }}
      />
    );
  }

  return (
    <CharacterScreen
      account={state.account}
      characters={state.characters}
      pending={state.pending}
      error={state.error}
      onCreate={(input: { name: string; classId: CharacterClass }) => createCharacter(input)}
      onEnter={setSelected}
      onLogout={logout}
      onClearError={clearError}
    />
  );
}
