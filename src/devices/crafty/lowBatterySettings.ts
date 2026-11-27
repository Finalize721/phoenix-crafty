import { createSignal } from "solid-js";

const STORAGE_KEY = "craftyLowBatteryProtection";

export const LOW_BATTERY_MIN_THRESHOLD = 1;
export const LOW_BATTERY_MAX_THRESHOLD = 99;
export const LOW_BATTERY_DEFAULT_THRESHOLD = 15;

export interface LowBatterySettings {
  threshold: number;
  warningEnabled: boolean;
  shutdownEnabled: boolean;
}

export const DEFAULT_LOW_BATTERY_SETTINGS: LowBatterySettings = {
  threshold: LOW_BATTERY_DEFAULT_THRESHOLD,
  warningEnabled: false,
  shutdownEnabled: false,
};

export const isValidLowBatteryThreshold = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= LOW_BATTERY_MIN_THRESHOLD &&
  value <= LOW_BATTERY_MAX_THRESHOLD;

const parseSettings = (raw: string | null): LowBatterySettings => {
  if (!raw) return { ...DEFAULT_LOW_BATTERY_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<LowBatterySettings> & { deviceWarning?: boolean };
    return {
      threshold: isValidLowBatteryThreshold(parsed.threshold)
        ? parsed.threshold
        : DEFAULT_LOW_BATTERY_SETTINGS.threshold,
      // Do not silently convert an old phone-vibration opt-in to a hardware command.
      warningEnabled: parsed.deviceWarning === true && parsed.warningEnabled === true,
      shutdownEnabled: parsed.shutdownEnabled === true,
    };
  } catch {
    return { ...DEFAULT_LOW_BATTERY_SETTINGS };
  }
};

const readSettings = () => {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_LOW_BATTERY_SETTINGS };
  }
};

const [settings, setSettings] = createSignal<LowBatterySettings>(
  readSettings()
);

export const getLowBatterySettings = settings;

const persist = (next: LowBatterySettings) => {
  setSettings(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, deviceWarning: true }));
  } catch {
    // Keep the preference for this session if storage is unavailable.
  }
};

export const setLowBatteryThreshold = (threshold: number) => {
  if (!isValidLowBatteryThreshold(threshold)) return false;
  persist({ ...settings(), threshold });
  return true;
};

export const setLowBatteryWarningEnabled = (enabled: boolean) => {
  persist({ ...settings(), warningEnabled: enabled });
};

export const setLowBatteryShutdownEnabled = (enabled: boolean) => {
  persist({ ...settings(), shutdownEnabled: enabled });
};
