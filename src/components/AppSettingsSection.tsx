import { createSignal, For } from "solid-js";
import { m } from "../paraglide/messages";
import {
  EFFECTS_LEVELS,
  type EffectsLevel,
  useEffects,
} from "../provider/EffectsProvider";
import { useToast } from "../provider/ToastProvider";
import {
  getHistoryRetentionDays,
  MAX_HISTORY_RETENTION_DAYS,
  setHistoryRetentionDays,
} from "../utils/historyRetention";
import {
  getNotifyPreference,
  getSoundPreference,
  isNotificationSupported,
  setNotifyPreference,
  setSoundPreference,
} from "../utils/notify";
import { SettingRow, SettingSwitch, SettingsSection } from "./Settings";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const effectsLabels: Record<EffectsLevel, () => string> = {
  off: () => m.settings_effectsOff(),
  subtle: () => m.settings_effectsSubtle(),
  strong: () => m.settings_effectsStrong(),
};

/** Browser-side preferences that apply to every device */
export const AppSettingsSection = () => {
  const showToast = useToast();
  const effects = useEffects();
  const [notify, setNotify] = createSignal(getNotifyPreference());
  const [sound, setSound] = createSignal(getSoundPreference());
  const [retentionInput, setRetentionInput] = createSignal(
    String(getHistoryRetentionDays())
  );

  const toggleNotify = async (enabled: boolean) => {
    const effective = await setNotifyPreference(enabled);
    setNotify(effective);
    if (enabled && !effective) {
      showToast({ message: m.settings_notifyBlocked() });
    }
  };

  const updateRetentionInput = (value: string) => {
    setRetentionInput(value);
    if (!/^\d+$/.test(value)) return;
    setHistoryRetentionDays(Number(value));
  };

  const restoreRetentionInput = () => {
    const days = Number(retentionInput());
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > MAX_HISTORY_RETENTION_DAYS
    ) {
      setRetentionInput(String(getHistoryRetentionDays()));
    }
  };

  return (
    <SettingsSection title={m.settings_sectionApp()}>
      <div class="flex flex-col gap-2.5 px-4 py-3.5">
        <div class="flex flex-col gap-0.5">
          <span id="effects-label" class="font-medium text-sm">
            {m.settings_effects()}
          </span>
          <span class="text-muted-foreground text-xs">
            {m.settings_effectsHint()}
          </span>
        </div>
        <ToggleGroup
          aria-labelledby="effects-label"
          value={effects.level()}
          onChange={(level) => level && effects.setLevel(level as EffectsLevel)}
        >
          <For each={EFFECTS_LEVELS}>
            {(level) => (
              <ToggleGroupItem value={level}>
                {effectsLabels[level]()}
              </ToggleGroupItem>
            )}
          </For>
        </ToggleGroup>
      </div>
      <SettingSwitch
        label={m.settings_notifyReached()}
        description={
          isNotificationSupported()
            ? m.settings_notifyReachedHint()
            : m.settings_notifyUnsupported()
        }
        checked={notify()}
        disabled={!isNotificationSupported()}
        onChange={toggleNotify}
      />
      <SettingSwitch
        label={m.settings_sound()}
        description={m.settings_soundHint()}
        checked={sound()}
        onChange={(enabled) => {
          setSoundPreference(enabled);
          setSound(enabled);
        }}
      />
      <SettingRow
        label={m.settings_historyRetention()}
        description={m.settings_historyRetentionHint({
          max: MAX_HISTORY_RETENTION_DAYS,
        })}
      >
        <div class="flex shrink-0 items-center gap-2">
          <input
            type="number"
            min="1"
            max={MAX_HISTORY_RETENTION_DAYS}
            step="1"
            class="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
            aria-label={m.settings_historyRetention()}
            value={retentionInput()}
            onInput={(event) => updateRetentionInput(event.currentTarget.value)}
            onBlur={restoreRetentionInput}
          />
          <span class="text-muted-foreground text-sm">{m.settings_days()}</span>
        </div>
      </SettingRow>
    </SettingsSection>
  );
};
