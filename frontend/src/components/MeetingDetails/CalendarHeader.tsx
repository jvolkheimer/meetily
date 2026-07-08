"use client";

import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, MapPin, Users, Video, RefreshCw, Loader2, CalendarPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CalendarEvent,
  getMeetingCalendar,
  lookupCalendarEvents,
  saveMeetingCalendar,
  clearMeetingCalendar,
} from '@/lib/calendar';

interface CalendarHeaderProps {
  meetingId: string;
  /** ISO timestamp used to look up the calendar for a prior meeting. */
  meetingTime?: string;
}

function formatRange(event: CalendarEvent): string {
  const start = event.start ? new Date(event.start) : null;
  const end = event.end ? new Date(event.end) : null;
  if (!start || isNaN(start.getTime())) return '';
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (event.is_all_day) return `${dateStr} · All day`;
  const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endTime =
    end && !isNaN(end.getTime())
      ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : '';
  return endTime ? `${dateStr} · ${startTime} – ${endTime}` : `${dateStr} · ${startTime}`;
}

function AttendeeList({ label, people }: { label: string; people: string[] }) {
  if (!people || people.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <span className="text-xs font-medium text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-700">{people.join(', ')}</span>
    </div>
  );
}

export function CalendarHeader({ meetingId, meetingTime }: CalendarHeaderProps) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [candidates, setCandidates] = useState<CalendarEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCandidates(null);
    getMeetingCalendar(meetingId).then((ev) => {
      if (!cancelled) {
        setEvent(ev);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const persist = useCallback(
    async (ev: CalendarEvent) => {
      await saveMeetingCalendar(meetingId, ev);
      setEvent(ev);
      setCandidates(null);
    },
    [meetingId],
  );

  const handleMatch = useCallback(async () => {
    setMatching(true);
    try {
      const when = meetingTime ? new Date(meetingTime) : new Date();
      const found = await lookupCalendarEvents(isNaN(when.getTime()) ? new Date() : when);
      if (found.length === 0) {
        toast.info('No calendar event found', {
          description: 'No meeting on your calendar overlapped this recording’s time.',
        });
      } else if (found.length === 1) {
        await persist(found[0]);
        toast.success('Matched calendar event', { description: found[0].subject });
      } else {
        // Multiple overlapping events — let the user choose.
        setCandidates(found);
      }
    } catch (error) {
      console.error('Calendar match failed:', error);
      toast.error('Could not read calendar', { description: String(error) });
    } finally {
      setMatching(false);
    }
  }, [meetingTime, persist]);

  const handlePick = useCallback(
    async (ev: CalendarEvent) => {
      try {
        await persist(ev);
        toast.success('Matched calendar event', { description: ev.subject });
      } catch (error) {
        toast.error('Could not save selection', { description: String(error) });
      }
    },
    [persist],
  );

  // Unassociate the calendar entry (e.g. for an ad-hoc call that had no invite).
  const handleClear = useCallback(async () => {
    try {
      await clearMeetingCalendar(meetingId);
      setEvent(null);
      setCandidates(null);
      toast.success('Calendar info removed');
    } catch (error) {
      toast.error('Could not remove calendar info', { description: String(error) });
    }
  }, [meetingId]);

  if (loading) return null;

  // Multiple candidates: present a chooser. Selecting one removes the rest.
  if (candidates && candidates.length > 1) {
    return (
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-2 text-xs font-medium text-gray-600">
            <CalendarDays className="w-3.5 h-3.5" />
            Which calendar event is this meeting?
          </span>
          <button
            onClick={() => setCandidates(null)}
            title="Cancel"
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-1">
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => handlePick(c)}
              className="w-full text-left px-3 py-2 rounded-md border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <div className="text-sm text-gray-800 truncate">{c.subject}</div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{formatRange(c)}</span>
                {(c.required.length + c.optional.length) > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {c.required.length + c.optional.length}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // No stored calendar event — offer a match (works retroactively for prior meetings).
  if (!event) {
    return (
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <span className="flex items-center gap-2 text-xs text-gray-500">
          <CalendarDays className="w-3.5 h-3.5" />
          No calendar info linked
        </span>
        <button
          onClick={handleMatch}
          disabled={matching}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
        >
          {matching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
          {matching ? 'Matching…' : 'Match to calendar'}
        </button>
      </div>
    );
  }

  const range = formatRange(event);

  return (
    <div className="px-4 py-3 border-b border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          {range && (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
              <span>{range}</span>
            </div>
          )}
          {event.organizer && (
            <div className="text-xs text-gray-500">
              Organized by <span className="text-gray-700">{event.organizer}</span>
            </div>
          )}
          {event.location && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
          {event.join_url && (
            <a
              href={event.join_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700"
            >
              <Video className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Join online meeting</span>
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(event.required.length > 0 || event.optional.length > 0) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              {event.required.length + event.optional.length}
            </button>
          )}
          <button
            onClick={handleMatch}
            disabled={matching}
            title="Re-match to calendar"
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
          >
            {matching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleClear}
            title="Remove calendar info"
            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
          <AttendeeList label="Required" people={event.required} />
          <AttendeeList label="Optional" people={event.optional} />
        </div>
      )}
    </div>
  );
}
