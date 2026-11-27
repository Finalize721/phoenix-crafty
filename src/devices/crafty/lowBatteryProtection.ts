import type { CraftyUpdateOrigin } from "./driver";
import type { LowBatterySettings } from "./lowBatterySettings";

export type LowBatteryErrorReason = "verification" | "warning" | "command" | "confirmation";

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
  refreshLiveState: () => Promise<void>;
  stopSessionExtension: () => void;
  heaterOff: () => Promise<void>;
  /** Request the existing Crafty+ locate signal, not phone vibration. */
  warnDevice: () => Promise<void>;
  reportWarning?: (details: { level: number; threshold: number }) => void;
  reportShutdown?: () => void;
  reportError?: (reason: LowBatteryErrorReason) => void;
}

const validLevel = (level: number) =>
  Number.isInteger(level) && level >= 0 && level <= 100;

/** One action per threshold per heating session; a changed threshold rearms
 * from the current level. A live read during a known session may detect a
 * crossing missed by notifications. Initial/reconnect readings are baselines.
 * Reaching the setpoint once latches readiness until the heater turns off.
 */
export const createLowBatteryProtection = (io: LowBatteryProtectionIo) => {
  let lastReadingId = -1;
  let previousLevel: number | undefined;
  let threshold: number | undefined;
  let active = false;
  let ready = false;
  let handled = false;
  let pending = false;
  let attempts = 0;
  let busy = false;
  let disposed = false;
  let generation = 0;

  const reset = () => {
    generation++;
    ready = false;
    handled = false;
    pending = false;
    attempts = 0;
  };
  const stillCurrent = (token: number, limit: number) =>
    !disposed && token === generation && io.isLoaded() &&
    io.isCraftyPlus() && io.isHeaterActive() &&
    io.getSettings().threshold === limit;
  const reportError = (reason: LowBatteryErrorReason) => {
    try { io.reportError?.(reason); } catch { /* UI reporting is best effort. */ }
  };

  const execute = async (token: number, limit: number) => {
    busy = true;
    pending = false;
    attempts++;
    try {
      try {
        await io.refreshLiveState();
      } catch {
        if (stillCurrent(token, limit)) {
          // A new reading may retry verification, but never loop indefinitely.
          pending = attempts < 3;
          reportError("verification");
        }
        return;
      }
      if (!stillCurrent(token, limit)) return;
      const battery = io.getBattery();
      const settings = io.getSettings();
      if (!validLevel(battery.level) || battery.level > limit) return;
      if (!settings.warningEnabled && !settings.shutdownEnabled) return;
      ready ||= io.isSetpointReached();
      if (!ready) {
        pending = true;
        return;
      }

      // Consume only a verified crossing, never an unsuccessful fresh read.
      handled = true;
      if (settings.warningEnabled) {
        try {
          await io.warnDevice();
          if (!disposed) io.reportWarning?.({ level: battery.level, threshold: limit });
        } catch {
          if (!disposed) reportError("warning");
        }
      }

      // The locate request is independent of shutdown. Never switch on the
      // heater or act on a different session after an asynchronous request.
      if (!stillCurrent(token, limit) || !io.getSettings().shutdownEnabled) return;
      try { io.stopSessionExtension(); } catch { /* still shut down */ }
      try {
        await io.heaterOff();
      } catch {
        if (!disposed) reportError("command");
        return;
      }
      try {
        await io.refreshLiveState();
      } catch {
        if (!disposed) reportError("confirmation");
        return;
      }
      if (disposed || token !== generation) return;
      if (io.isHeaterActive()) reportError("confirmation");
      else io.reportShutdown?.();
    } finally {
      busy = false;
    }
  };

  const update = () => {
    if (disposed) return;
    const battery = io.getBattery();
    const settings = io.getSettings();
    const heaterActive = io.isLoaded() && io.isCraftyPlus() && io.isHeaterActive();
    const newReading = battery.readingId !== lastReadingId;
    lastReadingId = battery.readingId;

    if (!heaterActive) {
      if (active) {
        // Preserve the generation for confirmation of our own heater-off.
        ready = false;
        handled = false;
        pending = false;
        attempts = 0;
      }
      active = false;
      threshold = settings.threshold;
      previousLevel = validLevel(battery.level) ? battery.level : undefined;
      return;
    }

    if (!active) {
      reset();
      active = true;
      threshold = settings.threshold;
      previousLevel = validLevel(battery.level) ? battery.level : undefined;
      ready = io.isSetpointReached();
      return;
    }

    const becameReady = !ready && io.isSetpointReached();
    ready ||= becameReady;
    if (threshold !== settings.threshold) {
      generation++;
      threshold = settings.threshold;
      handled = false;
      pending = false;
      attempts = 0;
      // Changing a setting alone must not trigger the heater command.
      previousLevel = validLevel(battery.level) ? battery.level : undefined;
      return;
    }
    const enabled = settings.warningEnabled || settings.shutdownEnabled;
    if (!enabled) pending = false;
    if (newReading && validLevel(battery.level)) {
      if (battery.level > settings.threshold) {
        pending = false;
        if (!handled) attempts = 0;
      }
      if (enabled && !handled && !busy && previousLevel !== undefined &&
          previousLevel > settings.threshold && battery.level <= settings.threshold) {
        pending = true;
        attempts = 0;
      }
      previousLevel = battery.level;
    }
    if (enabled && pending && !handled && !busy && ready &&
        attempts < 3 && (newReading || becameReady)) {
      void execute(generation, settings.threshold);
    }
  };

  return {
    update,
    dispose() {
      disposed = true;
      pending = false;
      generation++;
    },
  };
};
