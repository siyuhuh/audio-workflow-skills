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
  estimatedLatencyMs: number | null;
  sampleRate: number | null;
  inputLevel: number;
  isClipping: boolean;
  setSelectedDeviceId: (deviceId: string) => void;
  setIsMonitoring: (enabled: boolean) => void;
  setMonitorGain: (gain: number) => void;
  setNoiseReduction: (enabled: boolean) => void;
  refreshDevices: () => void;
  acquireRecordingStream: () => Promise<MediaStream>;
}

interface MicrophoneMonitorPanelProps {
  monitor: MicrophoneMonitorController;
}

export function MicrophoneMonitorPanel({ monitor }: MicrophoneMonitorPanelProps) {
  const { t } = useTranslation();
  const defaultStatus =
    monitor.status === "Low-latency microphone monitoring is active."
      ? t("room:mic.headphones")
      : monitor.status === "Monitor off"
        ? t("room:mic.monitorOff")
        : monitor.status;
  const displayStatus =
    monitor.isMonitoring && monitor.sampleRate
      ? monitor.estimatedLatencyMs
        ? t("room:mic.lowLatencyStatus", {
            latency: Math.round(monitor.estimatedLatencyMs),
            sampleRate: Math.round(monitor.sampleRate / 1000)
          })
        : t("room:mic.lowLatencyUnreported", {
            sampleRate: Math.round(monitor.sampleRate / 1000)
          })
      : defaultStatus;

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
        <span>
          {t("room:mic.level")}
          <small data-clipping={monitor.isClipping}>
            {monitor.isClipping ? t("room:mic.clipping") : t("room:mic.signal")}
          </small>
        </span>
        <span
          className="roomMicMeter"
          role="meter"
          aria-label={t("room:mic.inputLevel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(monitor.inputLevel * 100)}
        >
          <i style={{ transform: `scaleX(${monitor.inputLevel})` }} />
        </span>
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
