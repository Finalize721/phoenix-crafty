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
} from "solid-js";
import { BatteryChip } from "../components/BatteryChip";
import { ShutdownTime } from "../components/crafty/ShutdownTime";
import { Temperature } from "../components/crafty/Temperature";
import { DeviceShell } from "../components/DeviceShell";
import {
  type BatterySample,
  estimateChargingEta,
  readChargingHistory,
  recordBatterySample,
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
    createSignal<SessionExtensionDuration>(5);

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
                  case "10":
                    setExtensionMinutes(10);
                    break;
                  case "15":
                    setExtensionMinutes(15);
                    break;
                  default:
                    setExtensionMinutes(5);
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
  return <BatteryChip level={state.loaded ? state.batteryLevel : undefined} />;
};

const CraftyChargingEta = () => {
  const { state, isCraftyPlus } = useCrafty();
  const { deviceInfo, knownDevice } = useBluetooth();
  const [eta, setEta] = createSignal<
    (ReturnType<typeof estimateChargingEta> & { fullAt?: number }) | undefined
  >();
  const [now, setNow] = createSignal(Date.now());
  let historyId: string | undefined;
  let sessionId: string | undefined;
  let samples: BatterySample[] = [];

  createEffect(() => {
    const level = state.batteryLevel;
    const id = deviceInfo().serialNumber || knownDevice()?.id;
    if (!state.loaded || !isCraftyPlus || !id) {
      setEta(undefined);
      return;
    }

    if (historyId !== id) {
      historyId = id;
      sessionId = crypto.randomUUID();
      samples = readChargingHistory(id);
    }
    const activeSessionId = sessionId ?? crypto.randomUUID();
    sessionId = activeSessionId;
    const now = Date.now();
    samples = recordBatterySample(id, level, now, activeSessionId, samples);

    const estimate = estimateChargingEta(samples, level, activeSessionId, now);
    const fullAt =
      estimate?.remainingMinutes === undefined
        ? undefined
        : now + estimate.remainingMinutes * 60_000;
    setEta(estimate ? { ...estimate, fullAt } : undefined);
    if (estimate) {
      const history = samples;
      const expiryTimer = setTimeout(
        () =>
          setEta(
            estimateChargingEta(history, level, activeSessionId, Date.now())
          ),
        Math.max(0, estimate.expiresAt - now + 1)
      );
      const countdownTimer =
        fullAt === undefined
          ? undefined
          : setInterval(() => setNow(Date.now()), 60_000);
      onCleanup(() => {
        clearTimeout(expiryTimer);
        if (countdownTimer) clearInterval(countdownTimer);
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

  return (
    <Show when={eta()}>
      {(estimate) => (
        <section
          class="rounded-2xl border bg-card px-4 py-3 text-sm"
          role="status"
          aria-live="polite"
        >
          <p class="font-medium">{m.device_isCharging()}</p>
          <Show
            when={estimate().fullAt}
            fallback={
              <p class="text-muted-foreground">{m.device_etaCalculating()}</p>
            }
          >
            {(fullAt) => (
              <>
                <p class="text-muted-foreground">
                  {m.device_etaRemaining({
                    duration: duration(remainingMinutes(fullAt())),
                  })}
                </p>
                <p class="text-muted-foreground">
                  {m.device_etaAt({ time: timeAtFull(fullAt()) })}
                </p>
              </>
            )}
          </Show>
        </section>
      )}
    </Show>
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
        <DeviceShell
          headerTrailing={<CraftyBattery />}
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
          <CraftyChargingEta />
          {props.children}
        </DeviceShell>
      </CraftyLiveSession>
    </CraftyProvider>
  );
};
