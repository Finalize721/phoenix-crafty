import { describe, expect, it, vi } from "vitest";
import type { CraftyUpdateOrigin } from "./driver";
import { createLowBatteryProtection } from "./lowBatteryProtection";
import type { LowBatterySettings } from "./lowBatterySettings";

const SETTINGS: LowBatterySettings = {
  threshold: 15,
  warningEnabled: true,
  shutdownEnabled: true,
};

const setup = (overrides: Partial<LowBatterySettings> = {}) => {
  let loaded = true;
  let craftyPlus = true;
  let heaterActive = true;
  let setpointReached = true;
  let settings = { ...SETTINGS, ...overrides };
  let battery = {
    level: 50,
    readingId: 0,
    origin: "snapshot" as CraftyUpdateOrigin,
  };

  const io = {
    isLoaded: () => loaded,
    isCraftyPlus: () => craftyPlus,
    getSettings: () => settings,
    getBattery: () => battery,
    isHeaterActive: () => heaterActive,
    isSetpointReached: () => setpointReached,
    refreshLiveState: vi.fn(async () => {}),
    stopSessionExtension: vi.fn(),
    heaterOff: vi.fn(async () => {
      heaterActive = false;
    }),
    warnDevice: vi.fn(async () => {}),
    reportWarning: vi.fn(),
    reportShutdown: vi.fn(),
    reportError: vi.fn(),
  };

  const protection = createLowBatteryProtection(io);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const startSession = () => protection.update();
  const reading = (
    level: number,
    origin: CraftyUpdateOrigin = "notification"
  ) => {
    battery = { level, readingId: battery.readingId + 1, origin };
    protection.update();
  };
  const setHeater = (active: boolean) => {
    heaterActive = active;
    protection.update();
  };
  const setSetpoint = (reached: boolean) => {
    setpointReached = reached;
    protection.update();
  };
  const setSettings = (next: Partial<LowBatterySettings>) => {
    settings = { ...settings, ...next };
    protection.update();
  };
  const setBatterySnapshot = (level: number) => {
    battery = {
      level,
      readingId: battery.readingId + 1,
      origin: "snapshot",
    };
  };

  return {
    io,
    protection,
    settle,
    startSession,
    reading,
    setHeater,
    setSetpoint,
    setSettings,
    setBatterySnapshot,
    get battery() {
      return battery;
    },
    set loaded(value: boolean) {
      loaded = value;
    },
    set craftyPlus(value: boolean) {
      craftyPlus = value;
    },
    set heaterActive(value: boolean) {
      heaterActive = value;
    },
    get settings() {
      return settings;
    },
    set settings(value: LowBatterySettings) {
      settings = value;
    },
  };
};

describe("low-battery protection", () => {
  it("triggers on a downward crossing, including skipped levels", async () => {
    const h = setup();
    h.startSession();
    h.reading(10);

    await h.settle();

    expect(h.io.warnDevice).toHaveBeenCalledOnce();
    expect(h.io.reportWarning).toHaveBeenCalledWith({
      level: 10,
      threshold: 15,
    });
    expect(h.io.stopSessionExtension).toHaveBeenCalledOnce();
    expect(h.io.heaterOff).toHaveBeenCalledOnce();
    expect(h.io.reportShutdown).toHaveBeenCalledOnce();
  });

  it("defers the action until the target temperature is reached", async () => {
    const h = setup();
    h.setSetpoint(false);
    h.startSession();
    h.reading(10);

    await h.settle();
    expect(h.io.reportWarning).not.toHaveBeenCalled();
    expect(h.io.heaterOff).not.toHaveBeenCalled();

    h.setSetpoint(true);
    await h.settle();

    expect(h.io.reportWarning).toHaveBeenCalledOnce();
    expect(h.io.heaterOff).toHaveBeenCalledOnce();
  });

  it("does not act while charging with the heater off", async () => {
    const h = setup();
    h.setHeater(false);
    h.startSession();
    h.reading(80);
    h.reading(10);

    await h.settle();

    expect(h.io.reportWarning).not.toHaveBeenCalled();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });

  it("does nothing on non-Crafty+ devices", async () => {
    const h = setup();
    h.craftyPlus = false;
    h.startSession();
    h.reading(10);

    await h.settle();

    expect(h.io.reportWarning).not.toHaveBeenCalled();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });

  it("ignores initial snapshots already below the threshold", async () => {
    const h = setup();
    h.setBatterySnapshot(10);
    h.startSession();
    h.reading(9);

    await h.settle();

    expect(h.io.reportWarning).not.toHaveBeenCalled();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });

  it("does not trigger because a setting changed", async () => {
    const h = setup();
    h.startSession();
    h.setSettings({ threshold: 30 });

    await h.settle();

    expect(h.io.reportWarning).not.toHaveBeenCalled();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });

  it("ignores duplicate readings and acts only once per heating session", async () => {
    const h = setup({ shutdownEnabled: false });
    h.startSession();
    h.reading(10);
    await h.settle();

    // Same reading again, then another downward crossing in the session.
    h.protection.update();
    h.reading(10);
    h.reading(20);
    h.reading(10);
    await h.settle();

    expect(h.io.reportWarning).toHaveBeenCalledOnce();
    expect(h.io.warnDevice).toHaveBeenCalledOnce();
  });

  it("allows an intentional manual restart below the threshold", async () => {
    const h = setup();
    h.startSession();
    h.reading(10);
    await h.settle();
    expect(h.io.heaterOff).toHaveBeenCalledOnce();

    h.setHeater(false);
    h.setHeater(true);
    h.reading(9);
    await h.settle();

    expect(h.io.reportWarning).toHaveBeenCalledOnce();
    expect(h.io.heaterOff).toHaveBeenCalledOnce();
  });

  it("runs warning and shutdown independently", async () => {
    const warningOnly = setup({ shutdownEnabled: false });
    warningOnly.startSession();
    warningOnly.reading(10);
    await warningOnly.settle();
    expect(warningOnly.io.warnDevice).toHaveBeenCalledOnce();
    expect(warningOnly.io.reportWarning).toHaveBeenCalledOnce();
    expect(warningOnly.io.heaterOff).not.toHaveBeenCalled();

    const shutdownOnly = setup({ warningEnabled: false });
    shutdownOnly.startSession();
    shutdownOnly.reading(10);
    await shutdownOnly.settle();
    expect(shutdownOnly.io.warnDevice).not.toHaveBeenCalled();
    expect(shutdownOnly.io.reportWarning).not.toHaveBeenCalled();
    expect(shutdownOnly.io.heaterOff).toHaveBeenCalledOnce();
    expect(shutdownOnly.io.reportShutdown).toHaveBeenCalledOnce();

    const both = setup();
    both.startSession();
    both.reading(10);
    await both.settle();
    expect(both.io.reportWarning).toHaveBeenCalledOnce();
    expect(both.io.heaterOff).toHaveBeenCalledOnce();

    const neither = setup({
      warningEnabled: false,
      shutdownEnabled: false,
    });
    neither.startSession();
    neither.reading(10);
    await neither.settle();
    expect(neither.io.warnDevice).not.toHaveBeenCalled();
    expect(neither.io.reportWarning).not.toHaveBeenCalled();
    expect(neither.io.heaterOff).not.toHaveBeenCalled();
  });

  it("does not shut down when fresh verification fails", async () => {
    const h = setup();
    h.io.refreshLiveState.mockRejectedValueOnce(new Error("disconnected"));
    h.startSession();
    h.reading(10);

    await h.settle();

    expect(h.io.heaterOff).not.toHaveBeenCalled();
    expect(h.io.reportError).toHaveBeenCalledWith("verification");
  });

  it("does not shut down when the fresh battery reading is above the threshold", async () => {
    const h = setup();
    h.io.refreshLiveState.mockImplementationOnce(async () => {
      h.setBatterySnapshot(50);
    });
    h.startSession();
    h.reading(10);

    await h.settle();

    expect(h.io.heaterOff).not.toHaveBeenCalled();
    expect(h.io.reportWarning).not.toHaveBeenCalled();
  });

  it("rechecks settings after the asynchronous reads", async () => {
    const h = setup();
    h.io.refreshLiveState.mockImplementationOnce(async () => {
      h.settings = { ...h.settings, shutdownEnabled: false };
    });
    h.startSession();
    h.reading(10);

    await h.settle();

    expect(h.io.reportWarning).toHaveBeenCalledOnce();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });

  it("does nothing when the device is disposed during verification", async () => {
    const h = setup();
    let release!: () => void;
    h.io.refreshLiveState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    h.startSession();
    h.reading(10);
    h.protection.dispose();
    release();

    await h.settle();

    expect(h.io.reportWarning).not.toHaveBeenCalled();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });

  it("reports heater command and confirmation failures", async () => {
    const commandFailure = setup();
    commandFailure.io.heaterOff.mockRejectedValueOnce(new Error("write"));
    commandFailure.startSession();
    commandFailure.reading(10);
    await commandFailure.settle();
    expect(commandFailure.io.reportError).toHaveBeenCalledWith("command");
    expect(commandFailure.io.reportShutdown).not.toHaveBeenCalled();

    const confirmationFailure = setup();
    confirmationFailure.io.heaterOff.mockImplementationOnce(async () => {});
    confirmationFailure.startSession();
    confirmationFailure.reading(10);
    await confirmationFailure.settle();
    expect(confirmationFailure.io.reportError).toHaveBeenCalledWith(
      "confirmation"
    );
    expect(confirmationFailure.io.reportShutdown).not.toHaveBeenCalled();
  });

  it("still shuts down when the device warning fails", async () => {
    const h = setup();
    h.io.warnDevice.mockImplementation(async () => {
      throw new Error("not supported");
    });
    h.startSession();
    h.reading(10);

    await h.settle();

    expect(h.io.reportError).toHaveBeenCalledWith("warning");
    expect(h.io.heaterOff).toHaveBeenCalledOnce();
  });

  it("detects a skipped threshold from a live snapshot after reaching temperature", async () => {
    const h = setup({ threshold: 35 });
    h.startSession();
    h.reading(42);
    h.setSetpoint(false);
    h.reading(30, "snapshot");
    await h.settle();
    expect(h.io.heaterOff).toHaveBeenCalledOnce();
  });

  it("rearms a lower threshold after an earlier warning in the same session", async () => {
    const h = setup({ threshold: 42, shutdownEnabled: false });
    h.startSession();
    h.reading(43);
    h.reading(42);
    await h.settle();
    expect(h.io.warnDevice).toHaveBeenCalledOnce();
    h.setSettings({ threshold: 30, shutdownEnabled: true });
    await h.settle();
    expect(h.io.heaterOff).not.toHaveBeenCalled();
    h.reading(31);
    h.reading(30);
    await h.settle();
    expect(h.io.heaterOff).toHaveBeenCalledOnce();
  });

  it("retries failed verification only on subsequent readings, at most three times", async () => {
    const h = setup({ threshold: 35 });
    h.io.refreshLiveState.mockRejectedValue(new Error("read"));
    h.startSession();
    h.reading(30);
    await h.settle();
    h.protection.update();
    await h.settle();
    expect(h.io.refreshLiveState).toHaveBeenCalledTimes(1);
    for (const level of [29, 28, 27, 26]) {
      h.reading(level);
      await h.settle();
    }
    expect(h.io.refreshLiveState).toHaveBeenCalledTimes(3);
    expect(h.io.heaterOff).not.toHaveBeenCalled();
  });
});
