import { createSignal } from "solid-js";

const STORAGE_KEY = "keepScreenAwake";

const readPreference = () => {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
};

const [screenAwakePreference, setPreference] = createSignal(readPreference());

export const getScreenAwakePreference = screenAwakePreference;

export const setScreenAwakePreference = (enabled: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // The preference still applies for this session if storage is unavailable.
  }
  setPreference(enabled);
};

export const isScreenWakeLockSupported = () =>
  typeof navigator !== "undefined" && "wakeLock" in navigator;
