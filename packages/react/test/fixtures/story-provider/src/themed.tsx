import { createContext, memo } from 'react';

interface Theme {
  readonly name: string;
}

/** A theme provided at the top and read below, through a memoised component. */
export const ThemeContext = createContext<Theme | null>(null);

export function Panel() {
  return <ThemeContext.Consumer>{(theme) => <p>{theme?.name}</p>}</ThemeContext.Consumer>;
}

export const Shown = memo(Panel);

export function App({ theme }: { theme: Theme }) {
  return (
    <ThemeContext.Provider value={theme}>
      <Shown />
    </ThemeContext.Provider>
  );
}
