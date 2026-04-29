import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";

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
      : monitor.status;

  return (
    <section
      data-monitoring={monitor.isMonitoring}
      className="grid gap-3 rounded-lg border border-ktv-line bg-ktv-surface p-3"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <strong className="text-sm font-semibold text-white">{t("room:mic.title")}</strong>
          <span className="text-xs font-medium text-ktv-text-muted">{displayStatus}</span>
        </div>
        <button
          type="button"
          data-selected={monitor.isMonitoring}
          onClick={() => monitor.setIsMonitoring(!monitor.isMonitoring)}
          className={cn(
            "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
            monitor.isMonitoring
              ? "border-primary bg-primary text-primary-foreground"
              : "border-ktv-line bg-transparent text-white/80 hover:border-white/30 hover:bg-white/5"
          )}
        >
          {monitor.isMonitoring ? t("room:mic.monitorOn") : t("room:mic.monitor")}
        </button>
      </header>

      <select
        value={monitor.selectedDeviceId}
        onChange={(event) => monitor.setSelectedDeviceId(event.target.value)}
        className="min-h-9 rounded-md border border-ktv-line bg-ktv-surface-strong px-3 text-sm text-white"
      >
        <option value="">{t("room:mic.systemDefault")}</option>
        {monitor.devices.map((device) => (
          <option key={device.deviceId || device.label} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-ktv-text-muted">{t("room:mic.level")}</span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.05"
          value={monitor.monitorGain}
          disabled={!monitor.isMonitoring}
          onChange={(event) => monitor.setMonitorGain(Number(event.currentTarget.value))}
          className="w-full accent-primary disabled:opacity-40"
        />
      </label>

      <label className="flex items-start gap-3 rounded-md border border-ktv-line bg-ktv-surface-strong p-2.5">
        <input
          type="checkbox"
          checked={monitor.noiseReduction}
          onChange={(event) => monitor.setNoiseReduction(event.currentTarget.checked)}
          className="mt-0.5 size-4 cursor-pointer accent-primary"
        />
        <span className="grid gap-0.5">
          <strong className="text-sm font-medium text-white">
            {t("room:mic.noiseReduction")}
          </strong>
          <em className="text-xs font-normal not-italic text-ktv-text-muted">
            {t("room:mic.noiseReductionHint")}
          </em>
        </span>
      </label>
    </section>
  );
}
