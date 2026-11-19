import { createSignal, For } from "solid-js";
import { m } from "../paraglide/messages";

const palettes = [
  {
    id: "court",
    name: "Phoenix Court",
    accent: "#245fc6",
  },
  {
    id: "signal",
    name: "Ghost Signal",
    accent: "#126c54",
  },
  {
    id: "jelly",
    name: "Jellyfish Hotel",
    accent: "#8051ab",
  },
] as const;

type PaletteId = (typeof palettes)[number]["id"];

const isPaletteId = (id: string): id is PaletteId =>
  palettes.some((palette) => palette.id === id);

const readPalette = (): PaletteId => {
  try {
    const stored = localStorage.getItem("crafty-theme");
    return stored && isPaletteId(stored) ? stored : "court";
  } catch {
    return "court";
  }
};

const readAccent = () => {
  try {
    const stored = localStorage.getItem("crafty-accent");
    return stored && /^#[\da-f]{6}$/i.test(stored) ? stored : undefined;
  } catch {
    return;
  }
};

const defaultAccent = (id: PaletteId) =>
  palettes.find((palette) => palette.id === id)?.accent ?? palettes[0].accent;

const [palette, setPalette] = createSignal(readPalette());
const [customAccent, setCustomAccent] = createSignal(readAccent());

const accent = () => customAccent() ?? defaultAccent(palette());

const applyAccent = (color: string) => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const style = document.documentElement.style;

  style.setProperty("--primary", color);
  style.setProperty(
    "--primary-foreground",
    luminance > 0.179 ? "#111827" : "#ffffff"
  );
  style.setProperty("--primary-soft", `${color}1f`);
  style.setProperty("--ring", color);
  style.setProperty("--glow", `${color}55`);
};

const clearAccent = () => {
  const style = document.documentElement.style;
  for (const property of [
    "--primary",
    "--primary-foreground",
    "--primary-soft",
    "--ring",
    "--glow",
  ]) {
    style.removeProperty(property);
  }
};

export const ColorPalette = () => {
  const selectPalette = (id: string) => {
    const selected = palettes.find((choice) => choice.id === id);
    if (!selected) return;

    setPalette(selected.id);
    setCustomAccent(undefined);
    document.documentElement.dataset.skin = selected.id;
    clearAccent();
    try {
      localStorage.setItem("crafty-theme", selected.id);
      localStorage.removeItem("crafty-accent");
    } catch {
      // The selected palette still applies for this session.
    }
  };

  const selectAccent = (color: string) => {
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    setCustomAccent(color);
    applyAccent(color);
    try {
      localStorage.setItem("crafty-accent", color);
    } catch {
      // The selected color still applies for this session.
    }
  };

  document.documentElement.dataset.skin = palette();
  const savedAccent = customAccent();
  if (savedAccent) applyAccent(savedAccent);

  return (
    <div class="color-palette">
      <label for="palette-select">{m.settings_colorPalette()}</label>
      <select
        id="palette-select"
        aria-label={m.settings_colorPalette()}
        value={palette()}
        onChange={(event) => selectPalette(event.currentTarget.value)}
      >
        <For each={palettes}>
          {(choice) => <option value={choice.id}>{choice.name}</option>}
        </For>
      </select>
      <label class="sr-only" for="accent-color">
        {m.settings_accentColor()}
      </label>
      <input
        id="accent-color"
        type="color"
        aria-label={m.settings_accentColor()}
        title={m.settings_accentColor()}
        value={accent()}
        onInput={(event) => selectAccent(event.currentTarget.value)}
      />
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
