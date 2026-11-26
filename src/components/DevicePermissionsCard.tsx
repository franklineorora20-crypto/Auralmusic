import { Bell, Check, HardDrive, Lock, ShieldCheck, Smartphone, Sun } from "lucide-react";
import {
  countGrantedDevicePermissions,
  type DevicePermissionsSnapshot,
  type PermissionStatusValue,
} from "../music/lib/devicePermissions";

interface DevicePermissionsCardProps {
  permissions: DevicePermissionsSnapshot;
  wakeLockEnabled: boolean;
  onToggleWakeLock: (enabled: boolean) => void;
  onGrantAll: () => Promise<void>;
  requesting?: boolean;
}

function formatStatusLabel(status: PermissionStatusValue): string {
  if (status === "granted") return "Granted";
  if (status === "denied") return "Blocked in browser";
  if (status === "prompt") return "Tap to allow";
  return "Managed by device";
}

export function DevicePermissionsCard({
  permissions,
  wakeLockEnabled,
  onToggleWakeLock,
  onGrantAll,
  requesting = false,
}: DevicePermissionsCardProps) {
  const { granted, total } = countGrantedDevicePermissions(permissions);
  const hasPromptable =
    permissions.persistentStorage === "prompt" ||
    permissions.notifications === "prompt" ||
    (permissions.wakeLockSupported && !wakeLockEnabled);

  return (
    <section className="device-permissions-card" aria-label="Device permissions and background playback">
      <div className="device-permissions-header">
        <div className="install-app-copy">
          <div className="install-app-icon" aria-hidden="true">
            <ShieldCheck size={20} />
          </div>
          <div>
            <strong>Device &amp; lock-screen permissions</strong>
            <small>
              Keep the home-screen player alive on Next/Previous and protect offline tracks ({granted}/{total} active).
            </small>
          </div>
        </div>
        <div className="device-permissions-actions">
          {hasPromptable ? (
            <button
              type="button"
              className="primary-button install-card-btn"
              onClick={() => {
                void onGrantAll();
              }}
              disabled={requesting}
            >
              {requesting ? "Requesting…" : "Grant device permissions"}
            </button>
          ) : (
            <span className="install-status-badge">
              <Check size={14} /> Permissions active
            </span>
          )}
        </div>
      </div>

      <div className="device-permissions-grid">
        <div className={`permission-pill ${permissions.mediaSession === "active" ? "is-granted" : ""}`}>
          <Lock size={14} aria-hidden="true" />
          <div>
            <strong>Lock-screen controls</strong>
            <small>
              {permissions.audioSession === "playback"
                ? "AudioSession playback + MediaSession"
                : permissions.mediaSession === "active"
                  ? "MediaSession + transition keep-alive"
                  : "Limited in this browser"}
            </small>
          </div>
        </div>

        <div className={`permission-pill ${permissions.persistentStorage === "granted" ? "is-granted" : ""}`}>
          <HardDrive size={14} aria-hidden="true" />
          <div>
            <strong>Persistent offline storage</strong>
            <small>{formatStatusLabel(permissions.persistentStorage)}</small>
          </div>
        </div>

        <div className={`permission-pill ${permissions.notifications === "granted" ? "is-granted" : permissions.notifications === "denied" ? "is-denied" : ""}`}>
          <Bell size={14} aria-hidden="true" />
          <div>
            <strong>Device notifications</strong>
            <small>{formatStatusLabel(permissions.notifications)}</small>
          </div>
        </div>

        <button
          type="button"
          className={`permission-pill permission-toggle ${wakeLockEnabled ? "is-granted" : ""}`}
          onClick={() => onToggleWakeLock(!wakeLockEnabled)}
          disabled={!permissions.wakeLockSupported}
          aria-pressed={wakeLockEnabled}
        >
          {permissions.wakeLockSupported ? <Sun size={14} aria-hidden="true" /> : <Smartphone size={14} aria-hidden="true" />}
          <div>
            <strong>Keep screen awake</strong>
            <small>
              {!permissions.wakeLockSupported
                ? "Not supported on device"
                : wakeLockEnabled
                  ? permissions.wakeLockActive
                    ? "Active while playing"
                    : "Enabled during playback"
                  : "Off — tap to enable"}
            </small>
          </div>
        </button>
      </div>
    </section>
  );
}
