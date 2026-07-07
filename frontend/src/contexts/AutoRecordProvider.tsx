'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import {
  AUTO_RECORD_TIMEOUT_PREF,
  DEFAULT_AUTO_RECORD_TIMEOUT_SECONDS,
  clampAutoRecordTimeout,
} from '@/lib/autoRecord';

/**
 * AutoRecordProvider
 *
 * Implements the "Auto Record" feature. When enabled (Settings → Recordings), it polls the
 * backend for microphone activity by any app other than Meetily (a platform-agnostic meeting
 * signal). When a meeting is detected it starts recording automatically; when the meeting app
 * releases the mic for a sustained period it prompts the user to stop.
 *
 * Reuses the app's existing recording plumbing:
 * - Start: the `autoStartRecording` sessionStorage flag + navigate to `/` (handled by
 *   useRecordingStart), which also performs model-readiness/device checks.
 * - Stop: `stop_recording` command → the global RecordingPostProcessingProvider saves & navigates.
 */

const POLL_INTERVAL_MS = 5000;
const START_STREAK = 2; // consecutive active polls (~10s) before auto-starting

/** Fire a Windows/OS notification (in addition to the in-app modal) asking to stop recording. */
async function notifyMeetingEnded() {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (granted) {
      sendNotification({
        title: 'Meeting ended?',
        body: 'It appears the meeting is over. Open Meetily to stop recording.',
      });
    }
  } catch (error) {
    console.error('[AutoRecord] Failed to send OS notification:', error);
  }
}

export function AutoRecordProvider({ children }: { children: React.ReactNode }) {
  const { isRecording } = useRecordingState();
  const router = useRouter();

  const [enabled, setEnabled] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  // Refs so the poll loop reads current values without re-subscribing each render.
  const isRecordingRef = useRef(isRecording);
  const autoStartedRef = useRef(false);
  const activeStreakRef = useRef(0);
  const inactiveSinceRef = useRef<number | null>(null);
  const suppressUntilActiveRef = useRef(false);
  const promptShownRef = useRef(false); // ensures we notify/prompt once per meeting-end
  const timeoutMsRef = useRef(DEFAULT_AUTO_RECORD_TIMEOUT_SECONDS * 1000);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Whenever recording ends (manual stop, auto stop, error), clear our bookkeeping so manual
  // recordings are never affected by the meeting-over prompt.
  useEffect(() => {
    if (!isRecording) {
      autoStartedRef.current = false;
      inactiveSinceRef.current = null;
      suppressUntilActiveRef.current = false;
      promptShownRef.current = false;
      setShowPrompt(false);
    }
  }, [isRecording]);

  // Load + live-subscribe to the auto_record preference and the meeting-end timeout.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    (async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');

        setEnabled((await store.get<boolean>('auto_record')) ?? false);
        const timeout = await store.get<number>(AUTO_RECORD_TIMEOUT_PREF);
        timeoutMsRef.current = clampAutoRecordTimeout(timeout ?? DEFAULT_AUTO_RECORD_TIMEOUT_SECONDS) * 1000;

        unlisteners.push(
          await store.onKeyChange<boolean>('auto_record', (val) => setEnabled(val ?? false)),
        );
        unlisteners.push(
          await store.onKeyChange<number>(AUTO_RECORD_TIMEOUT_PREF, (val) => {
            timeoutMsRef.current =
              clampAutoRecordTimeout(val ?? DEFAULT_AUTO_RECORD_TIMEOUT_SECONDS) * 1000;
          }),
        );
      } catch (error) {
        console.error('[AutoRecord] Failed to load auto_record preferences:', error);
      }
    })();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Close the prompt if the feature gets disabled.
  useEffect(() => {
    if (!enabled) setShowPrompt(false);
  }, [enabled]);

  const startAutoRecording = useCallback(() => {
    autoStartedRef.current = true;
    toast.info('Meeting detected — starting recording', { duration: 4000 });

    // Reuse the app's canonical "start from anywhere" paths (which also run model/device checks):
    // - already on home: useRecordingStart listens for this event (router.push('/') would be a
    //   no-op and wouldn't re-fire the mount-time flag check).
    // - other page: set the flag and navigate home, where useRecordingStart consumes it on mount.
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
    } else {
      try {
        sessionStorage.setItem('autoStartRecording', 'true');
      } catch {
        // sessionStorage unavailable — nothing else we can do
      }
      router.push('/');
    }
  }, [router]);

  const stopAutoRecording = useCallback(async () => {
    setShowPrompt(false);
    try {
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      await invoke('stop_recording', { args: { save_path: savePath } });

      // stop_recording only emits `recording-stopped` (folder/name data); it does NOT run the
      // post-processing flow. Manual stops trigger it explicitly via handleRecordingStop, so mirror
      // that here to get the same completion behavior: transcription wait → save meeting →
      // navigate to meeting details → auto-summarize. handleRecordingStop is exposed on window by
      // useRecordingStop (mounted globally in RecordingPostProcessingProvider).
      const w = window as unknown as { handleRecordingStop?: (callApi?: boolean) => void };
      if (typeof w.handleRecordingStop === 'function') {
        w.handleRecordingStop(true);
      } else {
        console.warn('[AutoRecord] handleRecordingStop not available; post-processing skipped');
      }
    } catch (error) {
      console.error('[AutoRecord] Failed to stop recording:', error);
      toast.error('Failed to stop recording');
    }
  }, []);

  const keepRecording = useCallback(() => {
    // Don't nag again until the mic goes active and then inactive once more.
    suppressUntilActiveRef.current = true;
    inactiveSinceRef.current = null;
    setShowPrompt(false);
  }, []);

  // Detection poll loop (runs only while enabled).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      let active = false;
      try {
        active = await invoke<boolean>('is_meeting_microphone_active');
      } catch (error) {
        console.error('[AutoRecord] microphone detection failed:', error);
        return;
      }
      if (cancelled) return;

      if (active) {
        activeStreakRef.current += 1;
        inactiveSinceRef.current = null;
        suppressUntilActiveRef.current = false;
        promptShownRef.current = false; // meeting resumed — allow prompting again next time
        setShowPrompt(false); // dismiss any pending prompt (no-op if closed)

        if (
          !isRecordingRef.current &&
          !autoStartedRef.current &&
          activeStreakRef.current >= START_STREAK
        ) {
          startAutoRecording();
        }
      } else {
        activeStreakRef.current = 0;
        if (
          autoStartedRef.current &&
          isRecordingRef.current &&
          !suppressUntilActiveRef.current &&
          !promptShownRef.current
        ) {
          if (inactiveSinceRef.current === null) {
            inactiveSinceRef.current = Date.now();
          } else if (Date.now() - inactiveSinceRef.current >= timeoutMsRef.current) {
            promptShownRef.current = true;
            setShowPrompt(true);
            notifyMeetingEnded(); // Windows/OS notification in addition to the in-app modal
          }
        }
      }
    };

    const id = setInterval(tick, POLL_INTERVAL_MS);
    tick(); // run an immediate first check

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, startAutoRecording]);

  return (
    <>
      {children}
      {showPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Meeting ended?</h3>
            <p className="text-sm text-gray-600 mb-6">
              It appears the meeting is over. Stop recording?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={keepRecording}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Keep recording
              </button>
              <button
                onClick={stopAutoRecording}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Stop recording
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
