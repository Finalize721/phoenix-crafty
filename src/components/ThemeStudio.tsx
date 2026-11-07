import { createSignal, For } from "solid-js";
const choices = [
  {
    id: "court",
    name: "Phoenix Court",
  },
  {
    id: "signal",
    name: "Ghost Signal",
  },
  {
    id: "jelly",
    name: "Jellyfish Hotel",
  },
];
const stored = () => {
  try {
    return localStorage.getItem("crafty-theme") || "court";
  } catch {
    return "court";
  }
};
const [theme, setTheme] = createSignal(
  choices.find((c) => c.id === stored())?.id || "court"
);
export const ThemeStudio = () => {
  const select = (id: string) => {
    setTheme(id);
    document.documentElement.dataset.skin = id;
    try {
      localStorage.setItem("crafty-theme", id);
    } catch {}
  };
  document.documentElement.dataset.skin = theme();
  return (
    <div class="theme-studio">
      <label for="theme-select">ATMOSPHÄRE</label>
      <select
        id="theme-select"
        aria-label="Design auswählen"
        value={theme()}
        onChange={(e) => select(e.currentTarget.value)}
      >
        <For each={choices}>
          {(c) => <option value={c.id}>{c.name}</option>}
        </For>
      </select>
      <a
        href="https://github.com/Finalize721/phoenix-crafty"
        target="_blank"
        rel="noopener"
      >
        Quellcode ↗
      </a>
    </div>
  );
};
