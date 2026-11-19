import Bell from "lucide-solid/icons/bell";
import BellRing from "lucide-solid/icons/bell-ring";
import Zap from "lucide-solid/icons/zap";
import { createSignal, Show } from "solid-js";
import { cn } from "../lib/utils";
import { m } from "../paraglide/messages";
import { useToast } from "../provider/ToastProvider";
import {
  getBatteryNotifyPreference,
  isNotificationSupported,
  setBatteryNotifyPreference,
} from "../utils/notify";
import { Button } from "./ui/button";

/** Battery level for the header, with a bolt while charging */
export const BatteryChip = (props: {
  /** Percent; nothing is shown until the device reported it */
  level: number | undefined;
  charging?: boolean;
}) => {
  const fillColor = () => {
    const level = props.level ?? 0;
    if (level > 50) return "bg-success";
    if (level > 20) return "bg-amber-500";
    return "bg-destructive";
  };

  return (
    <Show when={props.level !== undefined}>
      <div
        role="img"
        aria-label={`${m.device_battery()}: ${props.level} %${props.charging ? `, ${m.device_isCharging()}` : ""}`}
        class={cn(
          "flex h-8 shrink-0 items-center gap-2 rounded-lg border bg-card px-2.5 font-medium text-[13px] tabular-nums",
          props.charging && "border-primary/40 bg-primary-soft"
        )}
      >
        <Show
          when={props.charging}
          fallback={
            <span class="relative h-[11px] w-[22px] rounded-[3px] border-[1.5px] border-muted-foreground p-px">
              <span
                class={cn("block h-full rounded-[1px]", fillColor())}
                style={{
                  width: `${Math.max(0, Math.min(100, props.level ?? 0))}%`,
                }}
              />
            </span>
          }
        >
          <Zap class="size-3.5 fill-primary text-primary" />
        </Show>
        {props.level} %
      </div>
    </Show>
  );
};

/** Battery level and its quick 99% notification toggle for the device header. */
export const BatteryHeaderStatus = (props: {
  level: number | undefined;
  charging?: boolean;
}) => {
  const [notifyAt99, setNotifyAt99] = createSignal(
    getBatteryNotifyPreference(99)
  );
  const [pending, setPending] = createSignal(false);
  const showToast = useToast();

  const toggleNotification = async () => {
    if (pending()) return;
    const enabled = !notifyAt99();
    setPending(true);
    try {
      const effective = await setBatteryNotifyPreference(99, enabled);
      setNotifyAt99(effective);
      if (enabled && !effective) {
        showToast({ message: m.settings_notifyBlocked() });
      }
    } catch (error) {
      console.error("Updating the battery notification failed:", error);
      showToast({ message: m.settings_notifyBlocked() });
    } finally {
      setPending(false);
    }
  };

  return (
    <Show when={props.level !== undefined}>
      <div class="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          class={cn("text-muted-foreground", notifyAt99() && "text-primary")}
          aria-label={m.settings_notifyBattery99()}
          title={`${m.settings_notifyBattery99()}. ${m.settings_notifyBatteryHint()}`}
          aria-pressed={notifyAt99()}
          disabled={!isNotificationSupported() || pending()}
          onClick={toggleNotification}
        >
          <Show when={notifyAt99()} fallback={<Bell />}>
            <BellRing />
          </Show>
        </Button>
        <BatteryChip level={props.level} charging={props.charging} />
      </div>
    </Show>
  );
};
