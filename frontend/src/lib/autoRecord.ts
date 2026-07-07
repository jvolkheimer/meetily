/**
 * Shared constants for the Auto Record feature (used by RecordingSettings and AutoRecordProvider).
 */

/** preferences.json keys */
export const AUTO_RECORD_PREF = 'auto_record';
export const AUTO_RECORD_TIMEOUT_PREF = 'auto_record_timeout_seconds';

/** How long the microphone must be released before prompting "meeting is over". */
export const DEFAULT_AUTO_RECORD_TIMEOUT_SECONDS = 20;
export const MIN_AUTO_RECORD_TIMEOUT_SECONDS = 5;
export const MAX_AUTO_RECORD_TIMEOUT_SECONDS = 600;

/** Clamp a user-entered timeout to the supported range, falling back to the default. */
export function clampAutoRecordTimeout(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_AUTO_RECORD_TIMEOUT_SECONDS;
  return Math.min(
    MAX_AUTO_RECORD_TIMEOUT_SECONDS,
    Math.max(MIN_AUTO_RECORD_TIMEOUT_SECONDS, Math.round(seconds)),
  );
}
