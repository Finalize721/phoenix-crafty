import type { CraftyUpdateOrigin } from "./driver";
import type { LowBatterySettings } from "./lowBatterySettings";

export type LowBatteryErrorReason = "verification" | "command" | "confirmation";

export interface LowBatteryProtectionIo {
  isLoaded: () => boolean;
  isCraftyPlus: () => boolean;
  getSettings: () => LowBatterySettings;
  getBattery: () => {
    level: number;
    readingId: number;
    origin: CraftyUpdateOrigin | undefined;
  };
  isHeaterActive: () => boolean;
  isSetpointReached: () => boolean;
  /** Fresh GATT reads of battery, project register and status register 2 */
  refreshLiveState: () => Promise<void>;
  stopSessionExtension: () => void;
  heaterOff: () => Promise<void>;
  vibrate?: () => void;
  reportWarning?: (details: { level: number; threshold: number }) => void;
  reportShutdown?: () => void;
  reportError?: (reason: LowBatteryErrorReason) => void;
}

const vibratePhone = () => {
  try {
    navigator.vibrate?.([200, 150, 200, 150, 200]);
  } catch {
    // Vibration is optional; automatic shutdown must still work.
  }
};

/**
 * Watches battery readings during a heating session. It only acts on a
 * downward threshold crossing reported by a BLE notification, never on the
 * initial snapshot, a reconnect snapshot, a setting change or a duplicate
 * reading.
 */
export const createLowBatteryProtection = (io: LowBatteryProtectionIo) => {
  let lastReadingId = -1;
  let previousLevel: number | undefined;
  let wasHeaterActive = false;
  let lastSetpointReached = false;
  let sessionHandled = false;
  let pending = false;
  let busy = false;
  let disposed = false;
  let sessionId = 0;

  const finishSession = () => {
    wasHeaterActive = false;
    lastSetpointReached = false;
    sessionHandled = false;
    pending = false;
  };

  const execute = async (actionSessionId: number) => {
    if (busy || disposed) return;
    busy = true;
    try {
      try {
        await io.refreshLiveState();
      } catch {
        // A failed fresh read is a failed verification: never shut down then.
        if (!disposed) io.reportError?.("verification");
        return;
      }
      if (disposed || actionSessionId !== sessionId) return;

      const settings = io.getSettings();
      const battery = io.getBattery();
      if (!io.isLoaded() || !io.isCraftyPlus()) return;
      if (!io.isHeaterActive()) return;
      if (!io.isSetpointReached()) {
        // Still heating up. Wait for the setpoint notification.
        pending = true;
        lastSetpointReached = false;
        return;
      }
      if (battery.level > settings.threshold) return;
      if (!settings.warningEnabled && !settings.shutdownEnabled) return;

      if (settings.warningEnabled) {
        try {
          (io.vibrate ?? vibratePhone)();
        } catch {
          // Unsupported vibration must not prevent automatic shutdown.
        }
        try {
          io.reportWarning?.({
            level: battery.level,
            threshold: settings.threshold,
          });
        } catch {
          // The visual warning is best-effort; shutdown still runs.
        }
      }

      if (settings.shutdownEnabled) {
        try {
          io.stopSessionExtension();
        } catch {
          // Stopping the extension is best-effort; shutdown still runs.
        }
        try {
          await io.heaterOff();
        } catch {
          if (!disposed) io.reportError?.("command");
          return;
        }
        try {
          await io.refreshLiveState();
        } catch {
          if (!disposed) io.reportError?.("confirmation");
          return;
        }
        if (disposed || actionSessionId !== sessionId) return;
        if (io.isHeaterActive()) {
          io.reportError?.("confirmation");
        } else {
          io.reportShutdown?.();
        }
      }
    } finally {
      busy = false;
    }
  };

  const update = (thresholdOverride?: number) => {
    if (disposed) return;
    const battery = io.getBattery();
    const reached = io.isSetpointReached();
    const heaterActive = io.isHeaterActive();

    if (!io.isLoaded() || !io.isCraftyPlus()) {
      finishSession();
      lastReadingId = battery.readingId;
      previousLevel = battery.level;
      lastSetpointReached = reached;
      return;
    }

    if (!heaterActive) {
      if (wasHeaterActive) finishSession();
      if (battery.readingId !== lastReadingId) {
        lastReadingId = battery.readingId;
        previousLevel = battery.level;
      }
      lastSetpointReached = reached;
      return;
    }

    if (!wasHeaterActive) {
      // New heating session: remember the current level as the baseline, so
      // a restart below the threshold does not look like a crossing.
      wasHeaterActive = true;
      sessionId++;
      sessionHandled = false;
      pending = false;
      lastReadingId = battery.readingId;
      previousLevel = battery.level;
      lastSetpointReached = reached;
      return;
    }

    let run = false;
    if (battery.readingId !== lastReadingId) {
      lastReadingId = battery.readingId;
      const threshold = thresholdOverride ?? io.getSettings().threshold;
      if (
        battery.origin === "notification" &&
        previousLevel !== undefined &&
        !sessionHandled &&
        previousLevel > threshold &&
        battery.level <= threshold
      ) {
        sessionHandled = true;
        if (reached) run = true;
        else pending = true;
      }
      previousLevel = battery.level;
    }

    if (pending && reached && !lastSetpointReached) {
      pending = false;
      run = true;
    }
    lastSetpointReached = reached;

    if (run && !busy) {
      void execute(sessionId);
    }
  };

  return {
    update,
    dispose() {
      disposed = true;
      pending = false;
    },
  };
};
