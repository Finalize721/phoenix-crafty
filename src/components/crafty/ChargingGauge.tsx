import Zap from "lucide-solid/icons/zap";
import {
  type Accessor,
  createContext,
  type JSX,
  Show,
  useContext,
} from "solid-js";
import { m } from "../../paraglide/messages";
import { useCrafty } from "../../provider/CraftyProvider";
import { isPlausibleTemp } from "../../utils/sessionHistory";
import { Button } from "../ui/button";

export interface ChargingPresentation {
  show: Accessor<boolean>;
  full: Accessor<boolean>;
  manual: Accessor<boolean>;
  provisional: Accessor<boolean>;
  remaining: Accessor<string | undefined>;
  completionTime: Accessor<string | undefined>;
  canOfferManual: Accessor<boolean>;
  toggleManual: () => void;
}

export const ChargingPresentationContext =
  createContext<ChargingPresentation>();

const RADIUS = 112;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC = CIRCUMFERENCE * 0.75;

/** Swap only the prominent gauge, never the controls or temperature history. */
export const CraftyGauge = (props: { children: JSX.Element }) => {
  const charging = useContext(ChargingPresentationContext);
  const { state, derived } = useCrafty();
  if (!charging) return <>{props.children}</>;

  const fraction = () => Math.min(1, Math.max(0, state.batteryLevel / 99));

  return (
    <div class="flex flex-col items-center gap-1">
      <Show when={charging.show() && !derived.isHeaterActive()} fallback={props.children}>
        <section
          class="flex w-full flex-col items-center gap-1"
          role="status"
          aria-live="polite"
          data-testid="crafty-charging-gauge"
        >
          <div class="relative aspect-[264/250] w-[264px] max-w-full">
            <svg viewBox="0 0 264 264" class="absolute inset-x-0 top-0 w-full" aria-hidden="true">
              <circle
                cx="132" cy="132" r={RADIUS}
                fill="none" stroke="var(--track)" stroke-width="12"
                stroke-linecap="round"
                stroke-dasharray={`${ARC} ${CIRCUMFERENCE}`}
                transform="rotate(135 132 132)"
              />
              <circle
                cx="132" cy="132" r={RADIUS}
                fill="none" stroke="var(--primary)" stroke-width="12"
                stroke-linecap="round"
                stroke-dasharray={`${ARC * fraction()} ${CIRCUMFERENCE}`}
                transform="rotate(135 132 132)"
                class="transition-[stroke-dasharray] duration-700 ease-out"
              />
            </svg>
            <div class="absolute inset-x-[13%] top-[23%] flex flex-col items-center gap-1 text-center">
              <div class="flex items-center gap-1 font-medium text-xs text-muted-foreground">
                <Zap class="size-3.5 text-primary" />
                <span>{state.batteryLevel} %</span>
              </div>
              <span class="text-[11px] text-muted-foreground">
                {m.device_chargeRemainingLabel()}
              </span>
              <Show when={charging.remaining()} fallback={
                <span class="py-2 font-medium text-xl">{m.device_etaCalculating()}</span>
              }>
                {(remaining) => (
                  <span class="font-light text-[clamp(1.75rem,8vw,3rem)] leading-tight tabular-nums tracking-tight">
                    {remaining()}
                  </span>
                )}
              </Show>
              <Show when={charging.completionTime()}>
                {(time) => (
                  <span class="text-xs text-muted-foreground">
                    {m.device_etaAt({ time: time() })}
                  </span>
                )}
              </Show>
              <Show when={charging.provisional()}>
                <span class="text-[11px] text-muted-foreground">{m.device_etaProvisional()}</span>
              </Show>
            </div>
          </div>
          <p class="-mt-2 max-w-full px-2 text-center text-xs text-muted-foreground">
            {charging.manual() ? m.device_historicalEtaUnconfirmed() : m.device_isLikelyCharging()}
          </p>
          <Show when={state.loaded && isPlausibleTemp(state.currentTemp)}>
            <p class="text-xs text-muted-foreground">
              {m.temperature_now()} · {state.currentTemp} °C
            </p>
          </Show>
        </section>
      </Show>
      <Show when={charging.full() && !derived.isHeaterActive()}>
        <span class="text-xs font-medium text-success" role="status">{m.device_chargeFull()}</span>
      </Show>
      <Show when={charging.canOfferManual() && !derived.isHeaterActive()}>
        <Button size="sm" variant="ghost" onClick={charging.toggleManual}>
          {charging.manual() ? m.device_hideChargingEta() : m.device_showChargingEta()}
        </Button>
      </Show>
    </div>
  );
};
