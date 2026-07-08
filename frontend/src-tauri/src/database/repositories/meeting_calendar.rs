use crate::calendar::CalendarEvent;
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};

pub struct MeetingCalendarRepository;

impl MeetingCalendarRepository {
    /// Upsert the calendar event captured for a meeting. Attendee lists are
    /// serialized as JSON arrays.
    pub async fn save(
        pool: &SqlitePool,
        meeting_id: &str,
        event: &CalendarEvent,
    ) -> Result<(), SqlxError> {
        let required =
            serde_json::to_string(&event.required).unwrap_or_else(|_| "[]".to_string());
        let optional =
            serde_json::to_string(&event.optional).unwrap_or_else(|_| "[]".to_string());
        let created_at = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO meeting_calendar \
                (meeting_id, subject, organizer, location, start_time, end_time, \
                 is_online, is_all_day, join_url, required_attendees, optional_attendees, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(meeting_id) DO UPDATE SET \
                subject=excluded.subject, \
                organizer=excluded.organizer, \
                location=excluded.location, \
                start_time=excluded.start_time, \
                end_time=excluded.end_time, \
                is_online=excluded.is_online, \
                is_all_day=excluded.is_all_day, \
                join_url=excluded.join_url, \
                required_attendees=excluded.required_attendees, \
                optional_attendees=excluded.optional_attendees",
        )
        .bind(meeting_id)
        .bind(&event.subject)
        .bind(&event.organizer)
        .bind(&event.location)
        .bind(&event.start)
        .bind(&event.end)
        .bind(event.is_online as i64)
        .bind(event.is_all_day as i64)
        .bind(&event.join_url)
        .bind(required)
        .bind(optional)
        .bind(created_at)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Remove the stored calendar event for a meeting (unassociate).
    pub async fn delete(pool: &SqlitePool, meeting_id: &str) -> Result<(), SqlxError> {
        sqlx::query("DELETE FROM meeting_calendar WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Fetch the stored calendar event for a meeting, if one was captured.
    pub async fn get(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<CalendarEvent>, SqlxError> {
        let row: Option<(
            Option<String>, // subject
            Option<String>, // organizer
            Option<String>, // location
            Option<String>, // start_time
            Option<String>, // end_time
            i64,            // is_online
            i64,            // is_all_day
            Option<String>, // join_url
            Option<String>, // required_attendees (JSON)
            Option<String>, // optional_attendees (JSON)
        )> = sqlx::query_as(
            "SELECT subject, organizer, location, start_time, end_time, \
                    is_online, is_all_day, join_url, required_attendees, optional_attendees \
             FROM meeting_calendar WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(
            |(subject, organizer, location, start, end, is_online, is_all_day, join_url, required, optional)| {
                CalendarEvent {
                    subject: subject.unwrap_or_default(),
                    start: start.unwrap_or_default(),
                    end: end.unwrap_or_default(),
                    organizer: organizer.unwrap_or_default(),
                    location: location.unwrap_or_default(),
                    is_online: is_online != 0,
                    is_all_day: is_all_day != 0,
                    join_url,
                    required: required
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default(),
                    optional: optional
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default(),
                }
            },
        ))
    }
}
