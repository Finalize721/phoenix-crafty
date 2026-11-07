import { createSignal, For } from "solid-js";
const choices = [
  {
    id: "court",
    name: "Phoenix Court",
    subtitle: "THE DEFENSE IS READY",
    line: "Die Verhandlung kann beginnen.",
    caption: "Beweisstück A · Crafty+",
  },
  {
    id: "signal",
    name: "Ghost Signal",
    subtitle: "PRIVATE FREQUENCY / 01",
    line: "Ein Signal. Deine Frequenz.",
    caption: "Terminal bereit · Bluetooth",
  },
  {
    id: "jelly",
    name: "Jellyfish Hotel",
    subtitle: "CHECK IN. FLOAT AWAY.",
    line: "Ein Zimmer zwischen den Wellen.",
    caption: "Rezeption · Crafty+",
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
export const ThemeScene = (props: { ready?: boolean }) => {
  const choice = () => choices.find((c) => c.id === theme())!;
  return (
    <section class="theme-scene" aria-label={choice().name}>
      <div class="scene-kicker">{choice().subtitle}</div>
      <div class="scene-art" aria-hidden="true">
        <div class="court-art">
          <div class="court-window" />
          <div class="court-column left" />
          <div class="court-column right" />
          <div class="court-seal">⚖</div>
          <svg class="attorney" viewBox="0 0 200 180">
            <path
              fill="#162032"
              d="M65 73 43 51 67 53 47 29 78 39 66 13 98 34 105 9 122 31 151 20 140 45 153 62 132 76Z"
            />
            <path fill="#f3c9a0" d="m76 54 48-5 9 37-15 23-33-8-11-24Z" />
            <path fill="#162032" d="m76 54 28-15 25 10-2 19-15-12-20 14Z" />
            <path fill="#fff6db" d="m84 99 33 3 20 40-65-2Z" />
            <path fill="#aa263e" d="m97 109 10 1 7 37-17 14-5-17Z" />
            <path
              fill="#275ab2"
              d="m78 99-32 12-18 69h132l-15-67-26-12 8 41-24 36-30-40Z"
            />
            <path
              fill="#5289df"
              d="m77 99-11 38 15 5-6 12 28 24-15-42Zm42 2 17 34-14 8 8 11-27 24 17-43Z"
            />
            <path
              stroke="#513e38"
              stroke-width="3"
              d="m105 76 13-2m-18 18 13 1"
            />
            <circle cx="111" cy="78" r="2" fill="#172135" />
          </svg>
          <div class="court-bench" />
        </div>
        <div class="signal-art">
          <div class="radar-ring r1" />
          <div class="radar-ring r2" />
          <div class="radar-ring r3" />
          <div class="radar-sweep" />
          <span class="signal-dot" />
          <span class="signal-readout">
            RX / 2.4 GHz
            <br />
            AWAITING CONNECTION
          </span>
        </div>
        <div class="jelly-art">
          <div class="jellyfish j1">
            <i />
            <b />
            <b />
            <b />
          </div>
          <div class="jellyfish j2">
            <i />
            <b />
            <b />
            <b />
          </div>
          <span class="bubble b1" />
          <span class="bubble b2" />
          <span class="bubble b3" />
        </div>
      </div>
      <div class="scene-dialog">
        <span class="dialog-name">{choice().name}</span>
        <p>
          {props.ready
            ? theme() === "court"
              ? "OBJECTION! Zieltemperatur erreicht."
              : "Zieltemperatur erreicht."
            : choice().line}
        </p>
        <small>{choice().caption}</small>
        <span class="dialog-arrow">▼</span>
      </div>
    </section>
  );
};
