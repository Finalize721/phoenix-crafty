import * as Popover from "@kobalte/core/popover";
import PaletteIcon from "lucide-solid/icons/palette";
import { createSignal, For, Show } from "solid-js";
import { m } from "../paraglide/messages";

const palettes = [
  {
    id: "court",
    name: "Phoenix Court",
    accent: "#245fc6",
    base: "#eef3fc",
  },
  {
    id: "signal",
    name: "Ghost Signal",
    accent: "#126c54",
    base: "#eaf4ef",
  },
  {
    id: "jelly",
    name: "Jellyfish Hotel",
    accent: "#8051ab",
    base: "#f5eef9",
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

const readColor = (key: string) => {
  try {
    const stored = localStorage.getItem(key);
    return stored && /^#[\da-f]{6}$/i.test(stored) ? stored : undefined;
  } catch {
    return;
  }
};

const defaultAccent = (id: PaletteId) =>
  palettes.find((palette) => palette.id === id)?.accent ?? palettes[0].accent;

const defaultBase = (id: PaletteId) =>
  palettes.find((palette) => palette.id === id)?.base ?? palettes[0].base;

const [palette, setPalette] = createSignal(readPalette());
const [customAccent, setCustomAccent] = createSignal(
  readColor("crafty-accent")
);
const [customBase, setCustomBase] = createSignal(
  readColor("crafty-base-color")
);

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

const applyBaseColor = (color: string) => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const root = document.documentElement;
  root.dataset.customBase = "true";
  root.style.setProperty("--custom-base", color);
  root.style.setProperty(
    "--custom-base-foreground",
    luminance > 0.179 ? "#111827" : "#ffffff"
  );
  root.style.setProperty(
    "--custom-surface-tint",
    luminance > 0.179 ? "#ffffff" : "#000000"
  );
};

const clearBaseColor = () => {
  const root = document.documentElement;
  delete root.dataset.customBase;
  for (const property of [
    "--custom-base",
    "--custom-base-foreground",
    "--custom-surface-tint",
  ]) {
    root.style.removeProperty(property);
  }
};

export const ColorPalette = () => {
  const selectPalette = (id: string) => {
    if (!isPaletteId(id)) return;
    setPalette(id);
    setCustomBase(undefined);
    document.documentElement.dataset.skin = id;
    clearBaseColor();
    try {
      localStorage.setItem("crafty-theme", id);
      localStorage.removeItem("crafty-base-color");
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

  const selectBaseColor = (color: string) => {
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    setCustomBase(color);
    applyBaseColor(color);
    try {
      localStorage.setItem("crafty-base-color", color);
    } catch {
      // The selected color still applies for this session.
    }
  };

  const resetColors = () => {
    setCustomBase(undefined);
    setCustomAccent(undefined);
    clearBaseColor();
    clearAccent();
    try {
      localStorage.removeItem("crafty-base-color");
      localStorage.removeItem("crafty-accent");
    } catch {
      // The preset colors still apply for this session.
    }
  };

  return (
    <div class="color-palette">
      <Popover.Root placement="bottom-start" gutter={8}>
        <Popover.Trigger
          class="palette-trigger"
          aria-label="Atmosphäre anpassen"
          title="Atmosphäre anpassen"
        >
          <PaletteIcon class="size-5" aria-hidden="true" />
          <span class="sr-only">Atmosphäre anpassen</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="palette-popover">
            <div class="palette-heading">
              <strong>Atmosphäre</strong>
              <span>
                <Show
                  when={customBase()}
                  fallback={
                    palettes.find((choice) => choice.id === palette())?.name
                  }
                >
                  Custom ·{" "}
                  {palettes.find((choice) => choice.id === palette())?.name}
                </Show>
              </span>
            </div>
            <label class="palette-field">
              <span>{m.settings_colorPalette()}</span>
              <select
                aria-label={m.settings_colorPalette()}
                value={palette()}
                onChange={(event) => selectPalette(event.currentTarget.value)}
              >
                <For each={palettes}>
                  {(choice) => <option value={choice.id}>{choice.name}</option>}
                </For>
              </select>
            </label>
            <label class="palette-field">
              <span>Grundfarbe</span>
              <input
                type="color"
                aria-label="Grundfarbe"
                value={customBase() ?? defaultBase(palette())}
                onInput={(event) => selectBaseColor(event.currentTarget.value)}
              />
            </label>
            <label class="palette-field">
              <span>{m.settings_accentColor()}</span>
              <input
                type="color"
                aria-label={m.settings_accentColor()}
                value={accent()}
                onInput={(event) => selectAccent(event.currentTarget.value)}
              />
            </label>
            <button class="palette-reset" type="button" onClick={resetColors}>
              Preset-Farben wiederherstellen
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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

if (typeof document !== "undefined") {
  document.documentElement.dataset.skin = palette();
  const savedBase = customBase();
  const savedAccent = customAccent();
  if (savedBase) applyBaseColor(savedBase);
  if (savedAccent) applyAccent(savedAccent);
}
