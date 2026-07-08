-- Store read-only calendar metadata captured for a meeting at recording start.
-- Attendee lists are stored as JSON arrays of display strings.
CREATE TABLE IF NOT EXISTS meeting_calendar (
    meeting_id TEXT PRIMARY KEY NOT NULL,
    subject TEXT,
    organizer TEXT,
    location TEXT,
    start_time TEXT,
    end_time TEXT,
    is_online INTEGER NOT NULL DEFAULT 0,
    join_url TEXT,
    required_attendees TEXT,   -- JSON array of display strings
    optional_attendees TEXT,   -- JSON array of display strings
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
