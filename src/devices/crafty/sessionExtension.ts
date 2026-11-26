import { m } from "../../paraglide/messages";

/** Bounded experiment: reapply the supported 300-second setting, never power on. */
export const SESSION_EXTENSION_DURATIONS = [15, 30, 45, 60] as const;
export type SessionExtensionDuration =
  (typeof SESSION_EXTENSION_DURATIONS)[number];

export const createSessionExtension = (io: {
  eligible: () => boolean;
  readRemaining: () => Promise<number | null>;
  reapply: () => Promise<void>;
  report: (active: boolean, message: string) => void;
  now?: () => number;
}) => {
  const now = io.now ?? Date.now;
  let generation = 0;
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (
    message = m.crafty_extensionEnded()
  ) => {
    generation++;
    clearTimeout(timer);
    io.report(false, message);
  };
  const schedule = (run: number) => {
    timer = setTimeout(() => void tick(run), 30_000);
  };
  const valid = (run: number) =>
    generation === run && now() < deadline && io.eligible();
  const tick = async (run: number) => {
    if (generation !== run) return;
    if (!valid(run)) {
      stop();
      return;
    }
    // Never queue another attempt while a prior Bluetooth operation is pending.
    const watchdog = setTimeout(() => {
      if (generation === run)
        stop(m.crafty_extensionTimedOut());
    }, 8_000);
    try {
      const before = await io.readRemaining();
      if (!valid(run)) {
        if (generation === run) stop();
        return;
      }
      if (before === null || before <= 0 || before > 300)
        throw new Error("timer");
      await io.reapply();
      if (!valid(run)) {
        if (generation === run) stop();
        return;
      }
      const after = await io.readRemaining();
      if (!valid(run)) {
        if (generation === run) stop();
        return;
      }
      if (after === null || after < 290 || after > 300 || after <= before + 3) {
        stop(
          m.crafty_extensionResetUnconfirmed()
        );
        return;
      }
      io.report(
        true,
        m.crafty_extensionResetConfirmed({
          seconds: Math.ceil((deadline - now()) / 1000),
        })
      );
      schedule(run);
    } catch {
      if (generation === run)
        stop(m.crafty_extensionReadFailed());
    } finally {
      clearTimeout(watchdog);
    }
  };
  return {
    start(durationMinutes: SessionExtensionDuration = 15) {
      stop();
      if (!io.eligible()) {
        io.report(
          false,
          m.crafty_extensionRequirements()
        );
        return;
      }
      deadline = now() + durationMinutes * 60_000;
      io.report(
        true,
        m.crafty_extensionStarted({ minutes: durationMinutes })
      );
      schedule(generation);
    },
    stop,
  };
};
