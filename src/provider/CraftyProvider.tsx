import type { JSX } from "solid-js";
import { createContext, Show, useContext } from "solid-js";
import type { CraftyDriver } from "../devices/crafty/driver";
import { type CraftyStore, createCraftyStore } from "../devices/crafty/store";
import { m } from "../paraglide/messages";
import { useBluetooth } from "./BluetoothProvider";
import { useToast } from "./ToastProvider";

const CraftyContext = createContext<CraftyStore>();

const CraftyStoreProvider = (props: {
  driver: CraftyDriver;
  children: JSX.Element;
}) => {
  // Read once on purpose: one store per driver instance
  const { reportStartFailure } = useBluetooth();
  const showToast = useToast();
  const store = createCraftyStore(
    props.driver,
    (error) => reportStartFailure(props.driver, error),
    {
      onWarning: ({ level }) =>
        showToast({
          message: m.crafty_lowBatteryWarningMessage({ percentage: level }),
        }),
      onShutdown: () =>
        showToast({ message: m.crafty_lowBatteryShutdownDone() }),
      onError: (reason) =>
        showToast({
          message:
            reason === "verification"
              ? m.crafty_lowBatteryVerificationFailed()
              : reason === "warning"
                ? m.crafty_lowBatteryDeviceWarningFailed()
                : m.crafty_lowBatteryShutdownFailed(),
        }),
    }
  );
  return (
    <CraftyContext.Provider value={store}>
      {props.children}
    </CraftyContext.Provider>
  );
};

/** Renders its children only while a Crafty is connected */
export const CraftyProvider = (props: { children: JSX.Element }) => {
  const { craftyDriver } = useBluetooth();
  return (
    <Show when={craftyDriver()} keyed>
      {(driver) => (
        <CraftyStoreProvider driver={driver}>
          {props.children}
        </CraftyStoreProvider>
      )}
    </Show>
  );
};

export const useCrafty = () => {
  const context = useContext(CraftyContext);
  if (!context) {
    throw new Error("useCrafty must be used within a CraftyProvider");
  }
  return context;
};
