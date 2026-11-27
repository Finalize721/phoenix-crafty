import * as Popover from "@kobalte/core/popover";
import PaletteIcon from "lucide-solid/icons/palette";
import { createSignal, For, Show } from "solid-js";
import { m } from "../paraglide/messages";
import { useDarkMode } from "../provider/DarkModeProvider";

const palettes = [
  {
    id: "court",
    name: "Phoenix Court",
    accent: "#245fc6",
    base: "#eef3fc",
    darkBase: "#0b1426",
    darkAccent: "#86b4ff",
  },
  {
    id: "signal",
    name: "Ghost Signal",
    accent: "#126c54",
    base: "#eaf4ef",
    darkBase: "#071b18",
    darkAccent: "#74e8bd",
  },
  {
    id: "jelly",
    name: "Jellyfish Hotel",
    accent: "#8051ab",
    base: "#f5eef9",
    darkBase: "#191329",
    darkAccent: "#dfb3fc",
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

const selectedPalette = () =>
  palettes.find((entry) => entry.id === palette()) ?? palettes[0];

const rgb = (hex: string) =>
  [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

const hexColor = (channels: number[]) =>
  "#" + channels.map((channel) =>
    Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, "0")
  ).join("");

// The existing dark-mode CSS mixes custom base colors with black (35%).
// Derive a matching source color when editing a dark preset for the first time.
const darkBaseSource = (color: string) =>
  hexColor(rgb(color).map((channel) => channel / 0.35));

const [palette, setPalette] = createSignal(readPalette());
const [customAccent, setCustomAccent] = createSignal(
  readColor("crafty-accent")
);
const [customBase, setCustomBase] = createSignal(
  readColor("crafty-base-color")
);

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

const ColorEditor = (props: {
  label: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
  onChange: (color: string) => void;
  darkPreview?: string;
}) => {
  const channels = [
    { label: () => m.settings_colorRed(), color: "#ef4444" },
    { label: () => m.settings_colorGreen(), color: "#22c55e" },
    { label: () => m.settings_colorBlue(), color: "#3b82f6" },
  ];
  const changeChannel = (index: number, value: number) => {
    const next = rgb(props.value);
    next[index] = value;
    const hex = hexColor(next);
    if (hex !== props.value.toLowerCase()) props.onChange(hex);
  };

  return (
    <div>
      <div class="palette-field">
        <span>{props.label}</span>
        <button
          type="button"
          class="flex h-10 shrink-0 items-center gap-2 rounded-lg border bg-card px-2 font-mono text-xs"
          aria-label={props.label}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          <span class="size-6 rounded border border-border" style={{ background: props.value }} />
          {props.value.toUpperCase()}
        </button>
      </div>
      <Show when={props.expanded}>
        <div class="flex flex-col gap-2 pb-3" role="group" aria-label={props.label}>
          <For each={channels}>
            {(channel, index) => (
              <label class="flex flex-col gap-1">
                <span class="flex justify-between text-xs">
                  <span>{channel.label()}</span>
                  <span class="tabular-nums">{rgb(props.value)[index()]}</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="255"
                  step="1"
                  value={rgb(props.value)[index()]}
                  aria-label={channel.label()}
                  class="h-7 w-full"
                  style={{ "accent-color": channel.color }}
                  onInput={(event) => changeChannel(index(), Number(event.currentTarget.value))}
                />
              </label>
            )}
          </For>
          <label class="flex items-center justify-between gap-2 text-xs">
            {m.settings_colorHex()}
            <input
              type="text"
              value={props.value}
              maxlength={7}
              spellcheck={false}
              class="w-24 rounded-md border bg-background px-2 py-1 font-mono"
              onChange={(event) => {
                const value = event.currentTarget.value.trim().toLowerCase();
                if (/^#[\da-f]{6}$/.test(value) && value !== props.value.toLowerCase()) props.onChange(value);
                else event.currentTarget.value = props.value;
              }}
            />
          </label>
          <Show when={props.darkPreview}>
            <div class="flex items-center gap-2">
              <span class="size-8 shrink-0 rounded border" style={{ background: props.darkPreview }} />
              <p class="text-xs text-muted-foreground">{m.settings_darkBaseColorHint()}</p>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export const ColorPalette = () => {
  const { isDarkMode } = useDarkMode();
  const [editing, setEditing] = createSignal<"base" | "accent">();
  const base = () => customBase() ?? (isDarkMode()
    ? darkBaseSource(selectedPalette().darkBase)
    : selectedPalette().base);
  const basePreview = () => isDarkMode()
    ? hexColor(rgb(base()).map((channel) => channel * 0.35))
    : undefined;
  const accent = () => customAccent() ?? (isDarkMode()
    ? selectedPalette().darkAccent
    : selectedPalette().accent);
  const toggleEditor = (field: "base" | "accent") =>
    setEditing((current) => current === field ? undefined : field);

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
    <div class="shrink-0">
      <Popover.Root placement="bottom-end" gutter={8} onOpenChange={(open) => { if (!open) setEditing(undefined); }}>
        <Popover.Trigger
          class="palette-trigger"
          aria-label={m.settings_customizeAppearance()}
          title={m.settings_customizeAppearance()}
        >
          <PaletteIcon class="size-5" aria-hidden="true" />
          <span class="sr-only">{m.settings_customizeAppearance()}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="palette-popover">
            <div class="palette-heading">
              <strong>{m.settings_appearance()}</strong>
              <span>
                {customBase()
                  ? m.settings_customPalette({
                      name: palettes.find((choice) => choice.id === palette())!.name,
                    })
                  : palettes.find((choice) => choice.id === palette())?.name}
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
            <ColorEditor
              label={m.settings_baseColor()}
              value={base()}
              expanded={editing() === "base"}
              onToggle={() => toggleEditor("base")}
              onChange={selectBaseColor}
              darkPreview={basePreview()}
            />
            <ColorEditor
              label={m.settings_accentColor()}
              value={accent()}
              expanded={editing() === "accent"}
              onToggle={() => toggleEditor("accent")}
              onChange={selectAccent}
            />
            <button class="palette-reset" type="button" onClick={resetColors}>
              {m.settings_resetPalette()}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
