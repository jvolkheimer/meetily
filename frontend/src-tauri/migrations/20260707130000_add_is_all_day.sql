-- Track whether the matched calendar event is an all-day event.
ALTER TABLE meeting_calendar ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0;
