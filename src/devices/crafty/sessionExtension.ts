/** Bounded experiment: reapply the supported 300-second setting, never power on. */
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
    message = "Verlängerung beendet. Der Gerätetimer läuft normal weiter."
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
        stop("Keine rechtzeitige Bluetooth-Antwort. Verlängerung gestoppt.");
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
          "Kein Timer-Reset bestätigt. Dieses Gerät unterstützt den Versuch möglicherweise nicht."
        );
        return;
      }
      io.report(
        true,
        "Timer-Reset bestätigt. Verlängerung noch " +
          Math.ceil((deadline - now()) / 1000) +
          " s."
      );
      schedule(run);
    } catch {
      if (generation === run)
        stop("Timer konnte nicht bestätigt werden. Verlängerung gestoppt.");
    } finally {
      clearTimeout(watchdog);
    }
  };
  return {
    start() {
      stop();
      if (!io.eligible()) {
        io.report(
          false,
          "Heizung und Zieltemperatur müssen aktiv sein; Abschaltzeit auf 5 Minuten stellen."
        );
        return;
      }
      deadline = now() + 300_000;
      io.report(true, "Versuch aktiv. Erster Timer-Test in 30 Sekunden.");
      schedule(generation);
    },
    stop,
  };
};
