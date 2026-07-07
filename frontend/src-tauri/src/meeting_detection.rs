//! Meeting detection for the "Auto Record" feature.
//!
//! The platform-agnostic signal we use is "is another application actively using the
//! microphone?" — virtually every meeting (Teams, Zoom, Meet, Discord, browser calls) holds the
//! microphone for its duration, and muting inside those apps does not release the OS capture
//! session. On Windows this state is exposed by the CapabilityAccessManager consent store (the
//! same data that drives the taskbar "🎤 in use" indicator).
//!
//! Meetily's own microphone usage is excluded so that, once auto-recording has started, we can
//! still detect when the *actual* meeting app releases the mic (i.e. the meeting is over).

/// Returns `true` when an application other than Meetily is currently using the microphone.
///
/// Non-Windows platforms return `false` for now (no detection); the Auto Record feature simply
/// never auto-triggers there. TODO: macOS support via CoreAudio / TCC.
#[tauri::command]
pub fn is_meeting_microphone_active() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::is_other_app_using_microphone()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// Pure predicate (shared by the Windows impl and unit tests): a consent-store entry means
/// "microphone in use by another app" when its `LastUsedTimeStop` is 0 (still open) and the entry
/// does not belong to Meetily itself.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn entry_indicates_other_app(key_name: &str, last_used_stop: Option<u64>, self_exe: Option<&str>) -> bool {
    if last_used_stop != Some(0) {
        return false;
    }
    match self_exe {
        // Desktop-app consent keys are the exe path with '\\' replaced by '#', so they end with
        // the executable file name (e.g. "...#meetily.exe"). Match case-insensitively.
        Some(exe) => !key_name.to_lowercase().ends_with(&exe.to_lowercase()),
        None => true,
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::entry_indicates_other_app;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const MIC_CONSENT_STORE: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    pub fn is_other_app_using_microphone() -> Result<bool, String> {
        let self_exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()));

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let mic = match hkcu.open_subkey(MIC_CONSENT_STORE) {
            Ok(k) => k,
            // Store missing (older Windows / no app has ever requested mic) → nothing in use.
            Err(_) => return Ok(false),
        };

        Ok(any_active(&mic, self_exe.as_deref()))
    }

    /// Checks direct subkeys (packaged apps) and recurses one level into `NonPackaged`
    /// (desktop apps). Returns true as soon as a non-Meetily app is found holding the mic.
    fn any_active(key: &RegKey, self_exe: Option<&str>) -> bool {
        for name in key.enum_keys().flatten() {
            let Ok(sub) = key.open_subkey(&name) else { continue };

            if name.eq_ignore_ascii_case("NonPackaged") {
                if any_active(&sub, self_exe) {
                    return true;
                }
                continue;
            }

            let last_used_stop = sub.get_value::<u64, _>("LastUsedTimeStop").ok();
            if entry_indicates_other_app(&name, last_used_stop, self_exe) {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::entry_indicates_other_app;

    #[test]
    fn in_use_by_other_app_is_detected() {
        // Zoom desktop entry, currently open (stop == 0)
        assert!(entry_indicates_other_app(
            "C:#Program Files#Zoom#bin#Zoom.exe",
            Some(0),
            Some("meetily.exe"),
        ));
    }

    #[test]
    fn meetily_own_usage_is_excluded() {
        assert!(!entry_indicates_other_app(
            "C:#Users#me#AppData#meetily.exe",
            Some(0),
            Some("meetily.exe"),
        ));
        // Case-insensitive match
        assert!(!entry_indicates_other_app(
            "C:#Users#me#MEETILY.EXE",
            Some(0),
            Some("meetily.exe"),
        ));
    }

    #[test]
    fn not_in_use_when_stop_is_nonzero_or_missing() {
        assert!(!entry_indicates_other_app("Some.App", Some(133_000_000_000_000_000), Some("meetily.exe")));
        assert!(!entry_indicates_other_app("Some.App", None, Some("meetily.exe")));
    }

    #[test]
    fn packaged_app_in_use_is_detected() {
        // New Teams (packaged) — key is a package family name, not a path.
        assert!(entry_indicates_other_app("MSTeams_8wekyb3d8bbwe", Some(0), Some("meetily.exe")));
    }
}
