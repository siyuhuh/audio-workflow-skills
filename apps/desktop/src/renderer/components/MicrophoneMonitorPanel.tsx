import { useTranslation } from "react-i18next";
import { Icon } from "./ui/Icon";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface MicrophoneMonitorController {
  devices: AudioInputDevice[];
  selectedDeviceId: string;
  isMonitoring: boolean;
  monitorGain: number;
  noiseReduction: boolean;
  status: string;
  setSelectedDeviceId: (deviceId: string) => void;
  setIsMonitoring: (enabled: boolean) => void;
  setMonitorGain: (gain: number) => void;
  setNoiseReduction: (enabled: boolean) => void;
  refreshDevices: () => void;
}

interface MicrophoneMonitorPanelProps {
  monitor: MicrophoneMonitorController;
}

export function MicrophoneMonitorPanel({ monitor }: MicrophoneMonitorPanelProps) {
  const { t } = useTranslation();
  const displayStatus =
    monitor.status === "Monitoring input. Use headphones to avoid feedback."
      ? t("room:mic.headphones")
      : monitor.status === "Monitor off"
        ? t("room:mic.monitorOff")
        : monitor.status;

  return (
    <section data-monitoring={monitor.isMonitoring} className="roomMicPanel">
      <header className="roomMicHeader">
        <div>
          <strong>
            <Icon name="mic" />
            <span>{t("room:mic.title")}</span>
          </strong>
          <span>{displayStatus}</span>
        </div>
        <button
          type="button"
          data-selected={monitor.isMonitoring}
          onClick={() => monitor.setIsMonitoring(!monitor.isMonitoring)}
          className="roomMicMonitorButton"
        >
          <Icon name="headphones" />
          {monitor.isMonitoring ? t("room:mic.monitorOn") : t("room:mic.monitor")}
        </button>
      </header>

      <select
        value={monitor.selectedDeviceId}
        onChange={(event) => monitor.setSelectedDeviceId(event.target.value)}
        className="roomMicDevice"
      >
        <option value="">{t("room:mic.systemDefault")}</option>
        {monitor.devices.map((device) => (
          <option key={device.deviceId || device.label} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>

      <label className="roomMicLevel">
        <span>{t("room:mic.level")}</span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.05"
          value={monitor.monitorGain}
          disabled={!monitor.isMonitoring}
          onChange={(event) => monitor.setMonitorGain(Number(event.currentTarget.value))}
        />
      </label>

      <div className="roomMicOption">
        <div>
          <strong>
            <Icon name="settings" />
            <span>{t("room:mic.noiseReduction")}</span>
          </strong>
          <span>{t("room:mic.noiseReductionHint")}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={monitor.noiseReduction}
          onClick={() => monitor.setNoiseReduction(!monitor.noiseReduction)}
          data-selected={monitor.noiseReduction}
          className="roomSwitch"
        >
          <span />
        </button>
      </div>
    </section>
  );
}
