//! Read-only calendar integration.
//!
//! On Windows we read the local Classic Outlook calendar over COM to find the
//! event that overlaps a recording's start time, and use it to name the meeting
//! and enrich it with attendees/metadata. The COM access is performed by a
//! bundled PowerShell script (`get_event.ps1`) that only ever *reads* Outlook
//! properties — it never calls Save/Send/Delete/Move. Keeping the Outlook access
//! in a small, self-contained script makes the read-only guarantee auditable at
//! a glance.
//!
//! Non-Windows platforms have no calendar source and simply return `None`.

use serde::{Deserialize, Serialize};

use crate::database::repositories::meeting_calendar::MeetingCalendarRepository;
use crate::state::AppState;

/// A calendar event, as read from Outlook and as stored per meeting.
///
/// Field names are snake_case to stay consistent with the rest of the app's
/// Tauri payloads (e.g. `folder_path`, `meeting_id`) and with the JSON emitted
/// by `get_event.ps1`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub subject: String,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub organizer: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub is_online: bool,
    #[serde(default)]
    pub is_all_day: bool,
    #[serde(default)]
    pub join_url: Option<String>,
    #[serde(default)]
    pub required: Vec<String>,
    #[serde(default)]
    pub optional: Vec<String>,
}

/// Look up the calendar events overlapping `iso` (an ISO-8601 instant, typically
/// the moment a recording started). Returns candidates ranked most-specific
/// first (real meetings before all-day blocks, shorter before longer), or an
/// empty list when nothing matches / Outlook is unavailable / on any error.
#[tauri::command]
pub fn get_calendar_events_for_time(iso: String) -> Result<Vec<CalendarEvent>, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(windows_impl::query_outlook(&iso))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = iso;
        Ok(Vec::new())
    }
}

/// Persist the calendar event captured at recording start against the saved
/// meeting (keyed by the SQLite `meeting_id` produced when the meeting is saved).
#[tauri::command]
pub async fn save_meeting_calendar(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    event: CalendarEvent,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    MeetingCalendarRepository::save(pool, &meeting_id, &event)
        .await
        .map_err(|e| e.to_string())
}

/// Remove the stored calendar event for a meeting (used when a recording did not
/// correspond to a calendar entry, e.g. an ad-hoc call).
#[tauri::command]
pub async fn clear_meeting_calendar(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    MeetingCalendarRepository::delete(pool, &meeting_id)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch the stored calendar event for a meeting, if any (used by Meeting
/// Details to render the attendees/metadata header).
#[tauri::command]
pub async fn get_meeting_calendar(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<CalendarEvent>, String> {
    let pool = state.db_manager.pool();
    MeetingCalendarRepository::get(pool, &meeting_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::CalendarEvent;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use tracing::warn;

    /// The read-only Outlook COM lookup script, compiled into the binary.
    const SCRIPT: &str = include_str!("get_event.ps1");
    /// CREATE_NO_WINDOW — don't flash a console window when spawning PowerShell.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// Resolve powershell.exe by absolute path. `CreateProcess` searches System32
    /// but not the `WindowsPowerShell\v1.0` subdirectory, so relying on a bare
    /// "powershell" name fails whenever that dir isn't on the inherited PATH.
    fn powershell_exe() -> String {
        match std::env::var("SystemRoot") {
            Ok(root) => format!(r"{}\System32\WindowsPowerShell\v1.0\powershell.exe", root),
            Err(_) => "powershell".to_string(),
        }
    }

    pub fn query_outlook(iso: &str) -> Vec<CalendarEvent> {
        let exe = powershell_exe();

        // Materialize the embedded script to a temp file and run it with `-File`.
        // Piping the script via `-Command -` on stdin does not run reliably when
        // the parent is a windowless GUI process (PowerShell exits 0 having read
        // nothing), so we avoid stdin entirely.
        let script_path = std::env::temp_dir().join("meetily_get_event.ps1");
        if let Err(e) = std::fs::write(&script_path, SCRIPT) {
            warn!("calendar: failed to write script file: {}", e);
            return Vec::new();
        }

        let output = Command::new(&exe)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script_path)
            .env("MEETILY_QUERY_TIME", iso)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let output = match output {
            Ok(o) => o,
            Err(e) => {
                warn!("calendar: failed to run powershell ({}): {}", exe, e);
                return Vec::new();
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        match serde_json::from_str::<Vec<CalendarEvent>>(trimmed) {
            Ok(events) => events,
            Err(e) => {
                warn!("calendar: failed to parse events JSON: {} (raw: {})", e, trimmed);
                Vec::new()
            }
        }
    }
}
