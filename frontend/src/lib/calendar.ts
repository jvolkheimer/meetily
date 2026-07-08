/**
 * Read-only calendar integration (frontend helpers).
 *
 * Wraps the Tauri calendar commands and carries the event captured at recording
 * start (in sessionStorage) through to the stop handler, which persists it
 * against the saved meeting id. All lookups are best-effort: any failure falls
 * back to the default timestamp-based meeting name and no metadata is stored.
 */

import { invoke } from '@tauri-apps/api/core';

/** Mirrors the Rust `CalendarEvent` (snake_case, matching the rest of the app). */
export interface CalendarEvent {
  subject: string;
  start: string;
  end: string;
  organizer: string;
  location: string;
  is_online: boolean;
  is_all_day: boolean;
  join_url: string | null;
  required: string[];
  optional: string[];
}

const PENDING_KEY = 'pending_calendar_event';
/** Bound the Outlook/PowerShell lookup so recording start never hangs on it. */
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Look up calendar events overlapping `when`, ranked most-specific first (real
 * meetings before all-day blocks, shorter before longer). Returns an empty array
 * on no match, timeout, non-Windows, or any error.
 */
export async function lookupCalendarEvents(when: Date): Promise<CalendarEvent[]> {
  try {
    const iso = when.toISOString();
    const events = await Promise.race<CalendarEvent[]>([
      invoke<CalendarEvent[]>('get_calendar_events_for_time', { iso }),
      new Promise<CalendarEvent[]>((resolve) => setTimeout(() => resolve([]), LOOKUP_TIMEOUT_MS)),
    ]);
    return Array.isArray(events) ? events.filter((e) => e && e.subject) : [];
  } catch (error) {
    console.warn('Calendar lookup failed; using default meeting title:', error);
    return [];
  }
}

/** Build a date-prefixed meeting title from an event: "YYYY-MM-DD Subject". */
export function calendarTitle(event: CalendarEvent): string {
  const datePrefix = (event.start || '').slice(0, 10);
  return datePrefix ? `${datePrefix} ${event.subject}` : event.subject;
}

/**
 * Format the matched calendar event as an authoritative context block to prepend
 * to the summary's user context, so the model uses the real subject, date, time,
 * and participants instead of inventing them from the transcript.
 */
export function formatCalendarContext(event: CalendarEvent): string {
  const lines: string[] = [
    'Meeting details from the calendar invite (authoritative — use these for the ' +
      'subject, date, time, and participants; do not infer or invent them):',
    `Subject: ${event.subject}`,
  ];

  const start = event.start ? new Date(event.start) : null;
  if (start && !isNaN(start.getTime())) {
    const dateStr = start.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (event.is_all_day) {
      lines.push(`Date: ${dateStr} (all day)`);
    } else {
      const end = event.end ? new Date(event.end) : null;
      const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const endTime =
        end && !isNaN(end.getTime())
          ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : '';
      lines.push(`Date: ${dateStr}`);
      lines.push(`Time: ${endTime ? `${startTime} – ${endTime}` : startTime}`);
    }
  }

  if (event.organizer) lines.push(`Organizer: ${event.organizer}`);
  if (event.location) lines.push(`Location: ${event.location}`);
  if (event.required.length > 0) lines.push(`Required participants: ${event.required.join(', ')}`);
  if (event.optional.length > 0) lines.push(`Optional participants: ${event.optional.join(', ')}`);

  return lines.join('\n');
}

export function stashPendingCalendarEvent(event: CalendarEvent): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(event));
  } catch {
    /* sessionStorage unavailable — non-fatal */
  }
}

/** Read and clear the pending event stashed at recording start. */
export function takePendingCalendarEvent(): CalendarEvent | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as CalendarEvent;
  } catch {
    return null;
  }
}

export function clearPendingCalendarEvent(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Persist the calendar event for a saved meeting (best-effort). */
export async function saveMeetingCalendar(meetingId: string, event: CalendarEvent): Promise<void> {
  await invoke('save_meeting_calendar', { meetingId, event });
}

/** Remove the stored calendar event for a meeting (unassociate). */
export async function clearMeetingCalendar(meetingId: string): Promise<void> {
  await invoke('clear_meeting_calendar', { meetingId });
}

/** Fetch the stored calendar event for a meeting, or null if none was captured. */
export async function getMeetingCalendar(meetingId: string): Promise<CalendarEvent | null> {
  try {
    const event = await invoke<CalendarEvent | null>('get_meeting_calendar', { meetingId });
    return event ?? null;
  } catch (error) {
    console.warn('Failed to fetch meeting calendar metadata:', error);
    return null;
  }
}
