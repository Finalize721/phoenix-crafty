import ChevronRight from "lucide-solid/icons/chevron-right";
import MapPin from "lucide-solid/icons/map-pin";
import Download from "lucide-solid/icons/download";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { type Component, createSignal, Show } from "solid-js";
import { AnalysisSection } from "../components/AnalysisSection";
import { AppSettingsSection } from "../components/AppSettingsSection";
import { PageTitle } from "../components/DeviceShell";
import { FactoryReset } from "../components/FactoryReset";
import {
  InfoRow,
  SettingRow,
  SettingSlider,
  SettingSwitch,
  SettingsSection,
} from "../components/Settings";
import { Alert, AlertDescription } from "../components/ui/alert";
import {
  createChargingDebugExport,
  downloadChargingDebugExport,
} from "../devices/crafty/chargingDiagnostics";
import {
  getLowBatterySettings,
  LOW_BATTERY_MAX_THRESHOLD,
  LOW_BATTERY_MIN_THRESHOLD,
  setLowBatteryShutdownEnabled,
  setLowBatteryThreshold,
  setLowBatteryWarningEnabled,
} from "../devices/crafty/lowBatterySettings";
import { Limits } from "../devices/crafty/protocol";
import { m } from "../paraglide/messages";
import { useBluetooth } from "../provider/BluetoothProvider";
import { useCrafty } from "../provider/CraftyProvider";
import { APP_BUILD_INFO } from "../utils/buildInfo";
import { formatDuration } from "../utils/heatProgress";

export const CraftySettingsView: Component = () => {
  const {
    state,
    actions,
    derived,
    firmwareVersion,
    isOldFirmware,
    isCraftyPlus,
  } = useCrafty();
  const { deviceInfo, knownDevice, rememberedDevice } = useBluetooth();
  const lowBattery = getLowBatterySettings;
  const [chargingExportStatus, setChargingExportStatus] =
    createSignal<string>();
  const chargingDeviceId = () =>
    deviceInfo().serialNumber || knownDevice()?.id || rememberedDevice()?.id;
  const exportChargingDiagnostics = () => {
    const deviceId = chargingDeviceId();
    if (!deviceId) return;
    try {
      downloadChargingDebugExport(
        createChargingDebugExport(deviceId, APP_BUILD_INFO)
      );
      setChargingExportStatus(m.settings_chargingDebugExported());
    } catch (error) {
      console.error("Could not export charging debug data:", error);
      setChargingExportStatus(m.settings_chargingDebugExportFailed());
    }
  };

  return (
    <>
      <PageTitle>{m.settings_title()}</PageTitle>

      <Show when={isOldFirmware}>
        <Alert variant="accent">
          <TriangleAlert />
          <AlertDescription>{m.crafty_oldDetected()}</AlertDescription>
        </Alert>
      </Show>

      {/* Find My Device - only Crafty+ */}
      <Show when={isCraftyPlus}>
        <button
          type="button"
          disabled={!state.loaded || derived.isFindMyActive()}
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

      <SettingsSection title={m.settings_sectionDevice()}>
        <SettingSlider
          label={m.settings_deviceBrightness()}
          valueLabel={`${state.ledBrightness} %`}
          value={state.ledBrightness}
          min={Limits.MIN_BRIGHTNESS}
          max={Limits.MAX_BRIGHTNESS}
          step={10}
          onChange={actions.setLedBrightness}
        />
        {/* Auto shutdown - only on Crafty+ */}
        <Show when={!isOldFirmware}>
          <SettingSlider
            label={m.settings_autoShutdownTime()}
            valueLabel={
              state.autoOffCountdown === null
                ? "-"
                : formatDuration(state.autoOffCountdown)
            }
            value={state.autoOffCountdown ?? Limits.MIN_AUTO_OFF}
            min={Limits.MIN_AUTO_OFF}
            max={Limits.MAX_AUTO_OFF}
            step={30}
            onChange={actions.setAutoOffCountdown}
          />
        </Show>
      </SettingsSection>

      <SettingsSection title={m.settings_sectionBehavior()}>
        <SettingSwitch
          label={m.settings_vibration()}
          description={m.settings_enableVibration()}
          checked={derived.isVibrationOn()}
          onChange={actions.setVibration}
        />
        <SettingSwitch
          label={m.settings_chargeIndicatorLamp()}
          description={m.settings_enableChargeLed()}
          checked={derived.isChargeLedOn()}
          onChange={actions.setChargeLed}
        />
        {/* Permanent Bluetooth - not on old firmware */}
        <Show when={!isOldFirmware}>
          <SettingSwitch
            label={m.settings_permanentBluetooth()}
            description={m.settings_keepBluetoothAlwaysOn()}
            checked={derived.isPermanentBluetooth()}
            onChange={actions.setPermanentBluetooth}
          />
        </Show>
      </SettingsSection>

      <Show when={isCraftyPlus}>
        <SettingsSection title={m.settings_sectionLowBattery()}>
          <p class="px-4 py-3.5 text-muted-foreground text-xs">
            {m.crafty_lowBatteryAppOnly()}
          </p>
          <SettingSlider
            label={m.crafty_lowBatteryThreshold()}
            valueLabel={`${lowBattery().threshold} %`}
            value={lowBattery().threshold}
            min={LOW_BATTERY_MIN_THRESHOLD}
            max={LOW_BATTERY_MAX_THRESHOLD}
            step={1}
            onChange={setLowBatteryThreshold}
          />
          <SettingSwitch
            label={m.crafty_lowBatteryWarning()}
            description={m.crafty_lowBatteryWarningHint()}
            checked={lowBattery().warningEnabled}
            onChange={setLowBatteryWarningEnabled}
          />
          <SettingSwitch
            label={m.crafty_lowBatteryShutdown()}
            description={m.crafty_lowBatteryShutdownHint()}
            checked={lowBattery().shutdownEnabled}
            onChange={setLowBatteryShutdownEnabled}
          />
        </SettingsSection>
      </Show>

      <AppSettingsSection />

      <Show when={!isOldFirmware}>
        <SettingsSection title={m.settings_sectionCharging()}>
          <SettingRow
            label={m.settings_chargingDebugExport()}
            description={m.settings_chargingDebugExportHint()}
          >
            <button
              type="button"
              class="shrink-0 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
              disabled={!chargingDeviceId()}
              aria-label={m.settings_chargingDebugExport()}
              onClick={exportChargingDiagnostics}
            >
              <Download class="size-4" />
            </button>
          </SettingRow>
          <Show when={chargingExportStatus()}>
            <p class="px-4 pb-3 text-xs text-muted-foreground" role="status">
              {chargingExportStatus()}
            </p>
          </Show>
          <Show when={!chargingDeviceId()}>
            <p class="px-4 pb-3 text-xs text-muted-foreground">
              {m.settings_chargingDebugNoDevice()}
            </p>
          </Show>
        </SettingsSection>
      </Show>

      <SettingsSection title={m.device_info()}>
        <InfoRow label={m.device_battery()}>{state.batteryLevel} %</InfoRow>
        <InfoRow label={m.crafty_usageTime()}>
          {state.useHours} h{!isOldFirmware && ` ${state.useMinutes ?? 0} min`}
        </InfoRow>
        <Show when={!isOldFirmware}>
          <InfoRow label={m.crafty_autoOffRemaining()}>
            {formatDuration(state.autoOffRemaining ?? 0)}
          </InfoRow>
        </Show>
        <InfoRow label={m.device_firmware()}>{firmwareVersion}</InfoRow>
        <Show when={!isOldFirmware}>
          <InfoRow label={m.crafty_bleFirmware()}>
            {state.bleFirmwareVersion ?? "-"}
          </InfoRow>
        </Show>
        <InfoRow label={m.crafty_statusRegister2()}>
          {state.statusRegister2}
        </InfoRow>
        {/* System status - only on Crafty+ */}
        <Show when={!isOldFirmware}>
          <InfoRow label={m.crafty_systemStatus()}>
            {state.systemStatus ?? "-"}
          </InfoRow>
          <InfoRow label={m.crafty_batteryStatus({ number: 1 })}>
            {state.akkuStatus ?? "-"}
          </InfoRow>
          <InfoRow label={m.crafty_batteryStatus({ number: 2 })}>
            {state.akkuStatus2 ?? "-"}
          </InfoRow>
        </Show>
      </SettingsSection>

      {/* Analysis and factory reset - not on old firmware */}
      <Show when={!isOldFirmware}>
        <SettingsSection title={m.settings_sectionInfo()}>
          <AnalysisSection run={actions.runAnalysis} />
        </SettingsSection>
        <SettingsSection title={m.settings_sectionDanger()}>
          <FactoryReset onReset={actions.factoryReset} />
        </SettingsSection>
      </Show>
    </>
  );
};
