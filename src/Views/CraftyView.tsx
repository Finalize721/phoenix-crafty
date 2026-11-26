import { type RouteSectionProps, useNavigate } from "@solidjs/router";
import ChevronRight from "lucide-solid/icons/chevron-right";
import MapPin from "lucide-solid/icons/map-pin";
import History from "lucide-solid/icons/rotate-ccw-clock";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Thermometer from "lucide-solid/icons/thermometer";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { BatteryChip, BatteryNotifyToggle } from "../components/BatteryChip";
import { ChargingPresentationContext } from "../components/crafty/ChargingGauge";
import { ShutdownTime } from "../components/crafty/ShutdownTime";
import { Temperature } from "../components/crafty/Temperature";
import { DeviceShell } from "../components/DeviceShell";
import {
  assessChargingActivity,
  type ChargingEvidence,
} from "../devices/crafty/chargingActivity";
import {
  appendChargingEtaTrace,
  classifyObserved99Arrival,
  type EtaTraceSnapshot,
  fingerprintBatterySamples,
  type Observed99Event,
} from "../devices/crafty/chargingDiagnostics";
import {
  type BatterySample,
  clearUserChargingHintAt,
  diagnoseChargingEta,
  type estimateChargingEta,
  readChargingHistory,
  readUserChargingHintAt,
  recordBatterySample,
  saveUserChargingHintAt,
} from "../devices/crafty/chargingEta";
import {
  SESSION_EXTENSION_DURATIONS,
  type SessionExtensionDuration,
} from "../devices/crafty/sessionExtension";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import { useBluetooth } from "../provider/BluetoothProvider";
import { CraftyProvider, useCrafty } from "../provider/CraftyProvider";
import { LiveSessionProvider } from "../provider/LiveSessionProvider";
import { buildRoute } from "../routes";
import { ConnectionState } from "../utils/uuids";

export const CraftyView: Component = () => {
  const {
    actions,
    derived,
    isCraftyPlus,
    state,
    extension,
    session,
    extensionEligible,
  } = useCrafty();
  const [extensionMinutes, setExtensionMinutes] =
    createSignal<SessionExtensionDuration>(15);

  // Keep the screen on while the device heats

  return (
    <>
      <ShutdownTime />
      <Temperature />
      <Show when={isCraftyPlus}>
        <section
          class="rounded-2xl border bg-card p-4 space-y-2"
          aria-label={m.crafty_extendSession()}
        >
          <h2 class="font-medium text-sm">{m.crafty_extendSession()}</h2>
          <p class="text-xs text-muted-foreground">
            {m.crafty_extensionLimit()}
          </p>
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>{m.crafty_extensionDuration()}</span>
            <select
              class="h-9 rounded-lg border bg-background px-2"
              value={extensionMinutes()}
              disabled={extension().active}
              onChange={(event) => {
                switch (event.currentTarget.value) {
                  case "30":
                    setExtensionMinutes(30);
                    break;
                  case "45":
                    setExtensionMinutes(45);
                    break;
                  case "60":
                    setExtensionMinutes(60);
                    break;
                  default:
                    setExtensionMinutes(15);
                }
              }}
            >
              <For each={SESSION_EXTENSION_DURATIONS}>
                {(minutes) => <option value={minutes}>{minutes} min</option>}
              </For>
            </select>
          </label>
          <Show
            when={state.loaded && !extension().active && !extensionEligible()}
          >
            <p class="text-xs text-muted-foreground">
              {m.crafty_extensionRequirements()}
            </p>
          </Show>
          <button
            type="button"
            class="rounded-lg border px-3 py-2 text-sm"
            onClick={() =>
              extension().active
                ? session.stop()
                : session.start(extensionMinutes())
            }
          >
            {extension().active
              ? m.crafty_extensionStop()
              : m.crafty_extensionStart()}
          </button>
          <Show when={extension().message}>
            <p class="text-xs text-muted-foreground" role="status">
              {extension().message}
            </p>
          </Show>
        </section>
      </Show>
      {/* Find My Device - only Crafty+ */}
      <Show when={isCraftyPlus}>
        <button
          type="button"
          disabled={derived.isFindMyActive()}
          onClick={actions.findMyDevice}
          class="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:opacity-60"
        >
          <MapPin class="size-[18px] text-muted-foreground" />
          <span class="flex flex-1 flex-col gap-0.5">
            <span class="font-medium text-sm">{m.settings_findMyDevice()}</span>
            <Show when={derived.isFindMyActive()}>
              <span class="text-primary text-xs">
                {m.settings_findMyDeviceRunning()}
              </span>
            </Show>
          </span>
          <ChevronRight class="size-4 text-muted-foreground" />
        </button>
      </Show>
    </>
  );
};

const CraftyBattery = () => {
  const { state } = useCrafty();
  return (
    <BatteryChip
      level={state.loaded ? state.batteryLevel : undefined}
    />
  );
};

const CraftyChargeNotification = () => {
  const { state } = useCrafty();
  return <BatteryNotifyToggle level={state.loaded ? state.batteryLevel : undefined} />;
};

const CraftyChargingEta = (props: { children: JSX.Element }) => {
  const { state, derived, isCraftyPlus } = useCrafty();
  const { connectionState, deviceInfo, knownDevice } = useBluetooth();
  const [eta, setEta] = createSignal<
    (ReturnType<typeof estimateChargingEta> & { fullAt?: number }) | undefined
  >();
  const [activity, setActivity] = createSignal<ChargingEvidence>({
    state: "unknown",
    showEta: false,
    manualOnly: false,
    canComputeHistoricalEta: false,
    chargingIntervals: [],
  });
  const [now, setNow] = createSignal(Date.now());
  const [userChargingHintAt, setUserChargingHintAt] = createSignal<number>();
  const [sampleVersion, setSampleVersion] = createSignal(0);
  const [continuityVersion, setContinuityVersion] = createSignal(0);
  const updateClock = () => setNow(Date.now());
  const clockTimer = setInterval(updateClock, 60_000);
  let historyId: string | undefined;
  let sessionId: string | undefined;
  let samples: BatterySample[] = [];
  let lastProcessedReadingId: number | undefined;
  let breakBeforeNextSample = false;
  let continuityValid = false;
  let wasConnected = connectionState() === ConnectionState.CONNECTED;

  const markDiscontinuity = () => {
    breakBeforeNextSample = true;
    continuityValid = false;
    setContinuityVersion((version) => version + 1);
  };
  let wasHeaterActive = derived.isHeaterActive();
  const toTraceSnapshot = (
    value:
      | (ReturnType<typeof estimateChargingEta> & { fullAt?: number })
      | undefined
  ): EtaTraceSnapshot | null =>
    value
      ? {
          remainingMinutes: value.remainingMinutes,
          source: value.source,
          targetLevel: value.targetLevel,
          historicalRunCount: value.historicalRunCount,
          adaptedToLive: value.adaptedToLive,
          provisional: value.provisional,
          chargingObserved: value.chargingObserved,
          predictedCompletionAt: value.fullAt,
        }
      : null;
  createEffect(() => {
    const heaterActive = derived.isHeaterActive();
    if (heaterActive === wasHeaterActive) return;
    wasHeaterActive = heaterActive;
    markDiscontinuity();
    if (heaterActive && historyId) {
      clearUserChargingHintAt(historyId);
      setUserChargingHintAt(undefined);
    }
  });
  const calculateEta = (
    history: BatterySample[],
    level: number,
    activeSessionId: string,
    time: number,
    observed99?: Observed99Event
  ) => {
    const previousEta = toTraceSnapshot(eta());
    const { estimate, diagnostics } = diagnoseChargingEta(
      history,
      level,
      activeSessionId,
      time
    );
    const latest = [...history]
      .reverse()
      .find((sample) => sample.sessionId === activeSessionId);
    const fullAt =
      estimate?.remainingMinutes === undefined || !latest
        ? undefined
        : latest.time + estimate.remainingMinutes * 60_000;
    const updatedEta = estimate ? { ...estimate, fullAt } : undefined;
    setEta(updatedEta);
    if (historyId) {
      try {
        appendChargingEtaTrace(historyId, {
          kind: "eta_recalculation",
          recordedAt: Date.now(),
          input: {
            deviceId: historyId,
            currentLevel: level,
            sessionId: activeSessionId,
            calculationTime: time,
            historySampleCount: history.length,
            historyFingerprint: fingerprintBatterySamples(history),
            ...(latest ? { latestSample: latest } : {}),
          },
          previousEta,
          updatedEta: toTraceSnapshot(updatedEta),
          calculation: diagnostics,
          ...(observed99 ? { observed99 } : {}),
        });
      } catch (error) {
        console.error("Could not save charging ETA diagnostics:", error);
      }
    }
    return estimate;
  };
  const handleVisibilityChange = () => {
    updateClock();
    if (document.visibilityState !== "visible") return;
    const id = deviceInfo().serialNumber || knownDevice()?.id;
    const activeSessionId = sessionId;
    if (
      !state.loaded ||
      !isCraftyPlus ||
      !id ||
      id !== historyId ||
      !activeSessionId ||
      connectionState() !== ConnectionState.CONNECTED
    ) {
      return;
    }
    calculateEta(samples, state.batteryLevel, activeSessionId, Date.now());
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  onCleanup(() => {
    clearInterval(clockTimer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });
  document.addEventListener("visibilitychange", markDiscontinuity);
  onCleanup(() =>
    document.removeEventListener("visibilitychange", markDiscontinuity)
  );

  createEffect(() => {
    sampleVersion();
    continuityVersion();
    const currentNow = Math.max(now(), Date.now());
    const activeSessionId = sessionId;
    const id = historyId;
    const heaterActive = derived.isHeaterActive();
    const hintAt = userChargingHintAt();
    if (
      !state.loaded ||
      !isCraftyPlus ||
      !id ||
      !activeSessionId ||
      connectionState() !== ConnectionState.CONNECTED
    ) {
      setActivity({
        state: "unknown",
        showEta: false,
        manualOnly: false,
        canComputeHistoricalEta: false,
        chargingIntervals: [],
      });
      return;
    }
    let evidence = assessChargingActivity(samples, activeSessionId, {
      now: currentNow,
      userChargingHintAt: hintAt,
    });
    if (heaterActive) {
      evidence = {
        ...evidence,
        state: "using",
        showEta: false,
        manualOnly: false,
      };
    } else if (breakBeforeNextSample && evidence.state === "charging-likely") {
      const manualHintIsFresh =
        hintAt !== undefined &&
        currentNow >= hintAt &&
        currentNow - hintAt <= 3 * 60_000;
      evidence = {
        ...evidence,
        state: "unknown",
        showEta: manualHintIsFresh,
        manualOnly: manualHintIsFresh,
      };
    }
    setActivity(evidence);
  });

  createEffect(() => {
    const connected = connectionState() === ConnectionState.CONNECTED;
    if (!connected) {
      markDiscontinuity();
      setEta(undefined);
    } else if (!wasConnected) {
      markDiscontinuity();
      sessionId = crypto.randomUUID();
    }
    wasConnected = connected;
  });

  createEffect(() => {
    const level = state.batteryLevel;
    const readingId = state.batteryReadingId;
    const readingTime = state.batteryReadingAt;
    const id = deviceInfo().serialNumber || knownDevice()?.id;
    if (readingId === lastProcessedReadingId) return;
    if (!state.loaded || !isCraftyPlus || !id || readingTime === undefined) {
      setEta(undefined);
      return;
    }
    const connected = untrack(connectionState) === ConnectionState.CONNECTED;
    if (!connected) return;

    if (historyId !== id) {
      historyId = id;
      sessionId = crypto.randomUUID();
      samples = readChargingHistory(id);
      const savedHint = readUserChargingHintAt(id);
      if (derived.isHeaterActive()) {
        clearUserChargingHintAt(id);
        setUserChargingHintAt(undefined);
      } else {
        setUserChargingHintAt(savedHint);
      }
      breakBeforeNextSample = false;
      continuityValid = false;
    }
    const activeSessionId = sessionId ?? crypto.randomUUID();
    sessionId = activeSessionId;
    const now = readingTime;
    const visible = document.visibilityState === "visible";
    const previousSample = samples[samples.length - 1];
    if (previousSample && level < previousSample.level) {
      clearUserChargingHintAt(id);
      setUserChargingHintAt(undefined);
    }
    const nextSamples = recordBatterySample(
      id,
      level,
      now,
      activeSessionId,
      samples,
      {
        origin: state.batteryReadingOrigin ?? "snapshot",
        heaterActive: derived.isHeaterActive(),
        ...(breakBeforeNextSample ? { breakBefore: true } : {}),
        ...(continuityValid && connected && visible
          ? { continuousSincePrevious: true }
          : {}),
      }
    );
    const latestSample = nextSamples[nextSamples.length - 1];
    const recorded =
      latestSample !== previousSample &&
      latestSample?.time === now &&
      latestSample.level === level &&
      latestSample.sessionId === activeSessionId;
    samples = nextSamples;
    if (recorded) {
      breakBeforeNextSample = !connected || !visible;
      continuityValid = connected && visible;
    } else if (!connected || !visible) {
      continuityValid = false;
    }
    lastProcessedReadingId = readingId;
    updateClock();
    setSampleVersion((version) => version + 1);

    const observed99 =
      recorded && latestSample
        ? classifyObserved99Arrival(latestSample, previousSample)
        : undefined;
    const estimate = calculateEta(
      samples,
      level,
      activeSessionId,
      now,
      observed99
    );
    if (estimate) {
      const history = samples;
      const expiryTimer = setTimeout(
        () => calculateEta(history, level, activeSessionId, Date.now()),
        Math.max(0, estimate.expiresAt - now + 1)
      );
      onCleanup(() => {
        clearTimeout(expiryTimer);
      });
    }
  });

  const duration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours
      ? `${hours} h ${String(remainder).padStart(2, "0")} min`
      : `${minutes} min`;
  };
  const remainingMinutes = (fullAt: number) =>
    Math.max(1, Math.ceil((fullAt - now()) / 60_000));
  const timeAtFull = (fullAt: number) =>
    new Intl.DateTimeFormat(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(fullAt);
  const canShowEta = () =>
    activity().showEta && !derived.isHeaterActive();
  const visibleFullAt = () => {
    const estimate = eta();
    if (!estimate) return undefined;
    // An unconfirmed historical preview means "if charging starts now".
    // Without observed charging, elapsed wall time must not count down an
    // unchanged battery level towards a fictitious completion timestamp.
    if (activity().manualOnly && !estimate.chargingObserved) {
      return now() + estimate.remainingMinutes * 60_000;
    }
    return estimate.fullAt !== undefined && estimate.fullAt > now()
      ? estimate.fullAt
      : undefined;
  };
  const visibleEta = () => (visibleFullAt() === undefined ? undefined : eta());
  const canOfferManualEta = () =>
    Boolean(eta()) &&
    activity().canComputeHistoricalEta &&
    activity().state === "unknown" &&
    (!activity().showEta || activity().manualOnly) &&
    !derived.isHeaterActive();
  const showManualEta = () => {
    if (!historyId || derived.isHeaterActive()) return;
    const requestedAt = Date.now();
    saveUserChargingHintAt(historyId, requestedAt);
    setUserChargingHintAt(requestedAt);
    updateClock();
  };
  const hideManualEta = () => {
    if (historyId) clearUserChargingHintAt(historyId);
    setUserChargingHintAt(undefined);
  };

  return (
    <ChargingPresentationContext.Provider value={{
      show: canShowEta,
      full: () => state.loaded && isCraftyPlus && state.batteryLevel >= 99,
      manual: () => activity().manualOnly,
      provisional: () => Boolean(visibleEta()?.provisional || activity().manualOnly),
      remaining: () => {
        const fullAt = visibleFullAt();
        return fullAt === undefined ? undefined : duration(remainingMinutes(fullAt));
      },
      completionTime: () => {
        const fullAt = visibleFullAt();
        return fullAt === undefined ? undefined : timeAtFull(fullAt);
      },
      canOfferManual: canOfferManualEta,
      toggleManual: () => activity().manualOnly ? hideManualEta() : showManualEta(),
    }}>
      {props.children}
    </ChargingPresentationContext.Provider>
  );
};

const CraftyLiveSession = (props: { children: JSX.Element }) => {
  const { state, derived } = useCrafty();
  return (
    <LiveSessionProvider
      reading={() => ({
        current: state.currentTemp,
        target: state.targetTemp,
        heating: derived.isHeaterActive(),
        reached: derived.isHeaterActive() && derived.isSetpointReached(),
        ready: state.loaded,
        batteryLevel: state.loaded ? state.batteryLevel : undefined,
      })}
    >
      {props.children}
    </LiveSessionProvider>
  );
};

/** Wrapper for all Crafty routes: device store, header and tabs */
export const CraftyShell = (props: RouteSectionProps) => {
  const navigate = useNavigate();
  const { connectionState } = useBluetooth();

  // Redirect to connect page if not connected (the provider renders nothing
  // without a connected device, so this must live outside of it)
  createEffect(() => {
    const state = connectionState();
    if (
      state === ConnectionState.NOT_CONNECTED ||
      state === ConnectionState.RECONNECTING ||
      state === ConnectionState.CONNECTION_FAILED
    ) {
      navigate(buildRoute.root());
    }
  });

  return (
    <CraftyProvider>
      <CraftyLiveSession>
        <CraftyChargingEta>
        <DeviceShell
          headerTrailing={<CraftyBattery />}
          headerActions={<CraftyChargeNotification />}
          tabs={[
            {
              href: buildRoute.craftyRoot(),
              label: m.nav_control(),
              icon: Thermometer,
            },
            {
              href: buildRoute.craftyHistory(),
              label: m.nav_history(),
              icon: History,
            },
            {
              href: buildRoute.craftySettings(),
              label: m.settings_title(),
              icon: SlidersHorizontal,
            },
          ]}
        >
          {props.children}
        </DeviceShell>
        </CraftyChargingEta>
      </CraftyLiveSession>
    </CraftyProvider>
  );
};
