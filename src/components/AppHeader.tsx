import Bluetooth from "lucide-solid/icons/bluetooth";
import BluetoothOff from "lucide-solid/icons/bluetooth-off";
import Coffee from "lucide-solid/icons/coffee";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import Moon from "lucide-solid/icons/moon";
import Power from "lucide-solid/icons/power";
import Sun from "lucide-solid/icons/sun";
import { type JSX, Match, Show, Switch } from "solid-js";
import { useWakeLock } from "../hooks/utils/useWakeLock";
import { m } from "../paraglide/messages";
import { type DeviceInfo, useBluetooth } from "../provider/BluetoothProvider";
import { useDarkMode } from "../provider/DarkModeProvider";
import {
  getScreenAwakePreference,
  isScreenWakeLockSupported,
  setScreenAwakePreference,
} from "../utils/screenWakeLock";
import { ConnectionState, DeviceType } from "../utils/uuids";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { ColorPalette } from "./ColorPalette";
import { Button } from "./ui/button";

const DEVICE_TYPE_LABELS: Partial<Record<DeviceType, string>> = {
  [DeviceType.VOLCANO]: "Volcano Hybrid",
  [DeviceType.VENTY]: "Venty",
  [DeviceType.VEAZY]: "Veazy",
  [DeviceType.CRAFTY]: "Crafty",
};

/** Friendly device name, e.g. "Volcano Hybrid" instead of "S&B VOLCANO H" */
export const deviceLabel = (device: Pick<DeviceInfo, "type" | "name">) =>
  DEVICE_TYPE_LABELS[device.type] ?? device.name;

export const ThemeToggle = () => {
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  return (
    <Button
      variant="outline"
      size="icon"
      class="text-muted-foreground max-[360px]:size-9"
      aria-label={m.settings_darkMode()}
      aria-pressed={isDarkMode()}
      onClick={() => toggleDarkMode(!isDarkMode())}
    >
      <Show when={isDarkMode()} fallback={<Moon />}>
        <Sun />
      </Show>
    </Button>
  );
};

export const CaffeineToggle = () => {
  const { connectionState } = useBluetooth();
  useWakeLock(
    () =>
      getScreenAwakePreference() &&
      connectionState() !== ConnectionState.CONNECTED
  );

  return (
    <Button
      variant="outline"
      size="icon"
      class={
        getScreenAwakePreference()
          ? "text-primary max-[360px]:size-9"
          : "text-muted-foreground max-[360px]:size-9"
      }
      aria-label={m.settings_screenAwake()}
      title={
        isScreenWakeLockSupported()
          ? m.settings_screenAwakeHint()
          : m.settings_screenAwakeUnsupported()
      }
      aria-pressed={getScreenAwakePreference()}
      disabled={!isScreenWakeLockSupported()}
      onClick={() => setScreenAwakePreference(!getScreenAwakePreference())}
    >
      <Coffee />
    </Button>
  );
};

const DisconnectButton = () => {
  const { disconnect } = useBluetooth();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        as={Button}
        variant="outline"
        size="icon"
        class="text-muted-foreground"
        aria-label={m.connection_disconnect()}
      >
        <Power />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {m.connection_confirmDisconnect()}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose variant="outline">
            {m.common_cancel()}
          </AlertDialogClose>
          <AlertDialogClose variant="destructive" onClick={() => disconnect()}>
            <Power />
            {m.connection_disconnect()}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

interface AppHeaderProps {
  /** Device specific status next to the buttons, e.g. the battery level */
  trailing?: JSX.Element;
  /** Optional device actions in the second row, e.g. charge notification. */
  actions?: JSX.Element;
}

/** Device name, connection status, quick controls and disconnect */
export const AppHeader = (props: AppHeaderProps) => {
  const { connectionState, deviceInfo } = useBluetooth();

  const isConnected = () => connectionState() === ConnectionState.CONNECTED;
  const isConnecting = () => connectionState() === ConnectionState.CONNECTING;
  const deviceName = () => deviceLabel(deviceInfo());

  return (
    <header class="flex flex-col gap-2 pt-[max(1.125rem,env(safe-area-inset-top))] pb-2">
      <div class="flex min-w-0 items-center gap-1 min-[361px]:gap-2">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary [&_svg]:size-5">
          <Switch fallback={<BluetoothOff class="text-muted-foreground" />}>
            <Match when={isConnecting()}>
              <LoaderCircle class="animate-spin" />
            </Match>
            <Match when={isConnected()}>
              <Bluetooth />
            </Match>
          </Switch>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="truncate font-semibold text-base tracking-tight">
            <Show when={isConnected()} fallback={m.connection_notConnected()}>
              {deviceName()}
            </Show>
          </div>
          <div class="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Switch>
              <Match when={isConnecting()}>{m.connection_connecting()}</Match>
              <Match when={isConnected()}>
                <span class="size-1.5 shrink-0 rounded-full bg-success" />
                <span class="truncate">{m.connection_connected()}</span>
              </Match>
            </Switch>
          </div>
        </div>
        <CaffeineToggle />
        {props.trailing}
        <ThemeToggle />
      </div>
      <div class="flex items-center gap-2">
        <ColorPalette />
        <div class="flex-1" />
        {props.actions}
        <Show when={isConnected()}>
          <DisconnectButton />
        </Show>
      </div>
    </header>
  );
};
