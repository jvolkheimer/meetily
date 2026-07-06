//! User-defined meeting summary prompts.
//!
//! A "summary prompt" is a free-form system prompt the user authors to control how meeting
//! summaries are generated. Unlike the structured [`super::templates`], a prompt is just a
//! name and a body. Prompts are stored as a single JSON document in the user's data directory
//! and one is always marked as the default (used for automatic summarization and pre-selected
//! for manual summaries).

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tracing::{info, warn};

/// Serializes read-modify-write access to the on-disk store to avoid corrupting the file
/// when multiple commands run concurrently.
static STORE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// A single user-defined summary prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryPrompt {
    /// Stable identifier (UUID). Generated on creation when empty.
    pub id: String,
    /// Display name shown in the settings list and the meeting dropdown.
    pub name: String,
    /// The system prompt body used verbatim when generating a summary.
    pub prompt: String,
}

/// The full persisted store: all prompts plus which one is the default.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SummaryPromptStore {
    #[serde(default)]
    pub prompts: Vec<SummaryPrompt>,
    #[serde(default)]
    pub default_id: Option<String>,
}

/// System prompt seeded on first run so summarization always has a usable default.
const SEED_PROMPT_NAME: &str = "Standard Meeting Summary";
const SEED_PROMPT_BODY: &str = "You are an expert meeting-notes assistant. Read the meeting \
transcript provided by the user and write a clear, well-structured summary in Markdown.\n\n\
Begin with a short `#` title that captures the meeting, then include the following sections \
when relevant:\n\
- **Overview** — a brief paragraph on what the meeting was about.\n\
- **Key Discussion Points** — the main topics discussed, as a bulleted list.\n\
- **Decisions** — any decisions that were made.\n\
- **Action Items** — outstanding tasks as a list of `owner — task`.\n\n\
Only use information present in the transcript; do not invent details. If a section has no \
relevant information, omit it entirely.";

/// Path to the JSON store: `<data_dir>/Meetily/summary_prompts.json`.
fn store_path() -> Option<PathBuf> {
    let mut path = dirs::data_dir()?;
    path.push("Meetily");
    path.push("summary_prompts.json");
    Some(path)
}

/// Ensures the store's default points at a real prompt: exactly one default whenever the store
/// is non-empty, none when it is empty.
fn normalize(store: &mut SummaryPromptStore) {
    if store.prompts.is_empty() {
        store.default_id = None;
        return;
    }

    let default_valid = store
        .default_id
        .as_ref()
        .is_some_and(|id| store.prompts.iter().any(|p| &p.id == id));

    if !default_valid {
        store.default_id = Some(store.prompts[0].id.clone());
    }
}

/// Loads the store from disk, returning an empty store if the file is missing or unreadable.
fn load_store() -> SummaryPromptStore {
    let Some(path) = store_path() else {
        warn!("Could not resolve data directory for summary prompts");
        return SummaryPromptStore::default();
    };

    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<SummaryPromptStore>(&content) {
            Ok(mut store) => {
                normalize(&mut store);
                store
            }
            Err(e) => {
                warn!("Failed to parse summary prompts at {:?}: {}", path, e);
                SummaryPromptStore::default()
            }
        },
        Err(_) => SummaryPromptStore::default(),
    }
}

/// Writes the store to disk as pretty JSON, creating the parent directory if needed.
fn save_store(store: &SummaryPromptStore) -> Result<(), String> {
    let path = store_path().ok_or_else(|| "Could not resolve data directory".to_string())?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize summary prompts: {}", e))?;

    std::fs::write(&path, json).map_err(|e| format!("Failed to write summary prompts: {}", e))
}

/// Seeds a single default prompt when the store is empty. Returns the (possibly updated) store.
pub fn seed_default_if_empty() -> SummaryPromptStore {
    let _guard = STORE_LOCK.lock().unwrap();
    let mut store = load_store();

    if store.prompts.is_empty() {
        let seed = SummaryPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            name: SEED_PROMPT_NAME.to_string(),
            prompt: SEED_PROMPT_BODY.to_string(),
        };
        store.default_id = Some(seed.id.clone());
        store.prompts.push(seed);
        if let Err(e) = save_store(&store) {
            warn!("Failed to seed default summary prompt: {}", e);
        } else {
            info!("Seeded default summary prompt");
        }
    }

    store
}

/// Returns the current store, seeding a default prompt first if it is empty.
pub fn list() -> SummaryPromptStore {
    seed_default_if_empty()
}

/// Creates a new prompt (empty id) or updates an existing one (matching id).
/// The first prompt ever created becomes the default.
pub fn upsert(mut prompt: SummaryPrompt) -> Result<SummaryPromptStore, String> {
    if prompt.name.trim().is_empty() {
        return Err("Prompt name cannot be empty".to_string());
    }
    if prompt.prompt.trim().is_empty() {
        return Err("Prompt body cannot be empty".to_string());
    }

    let _guard = STORE_LOCK.lock().unwrap();
    let mut store = load_store();

    if prompt.id.trim().is_empty() {
        prompt.id = uuid::Uuid::new_v4().to_string();
    }

    match store.prompts.iter_mut().find(|p| p.id == prompt.id) {
        Some(existing) => {
            existing.name = prompt.name;
            existing.prompt = prompt.prompt;
        }
        None => store.prompts.push(prompt),
    }

    normalize(&mut store);
    save_store(&store)?;
    Ok(store)
}

/// Deletes a prompt by id. If it was the default, another prompt is promoted.
pub fn delete(id: &str) -> Result<SummaryPromptStore, String> {
    let _guard = STORE_LOCK.lock().unwrap();
    let mut store = load_store();

    let before = store.prompts.len();
    store.prompts.retain(|p| p.id != id);
    if store.prompts.len() == before {
        return Err(format!("Prompt '{}' not found", id));
    }

    normalize(&mut store);
    save_store(&store)?;
    Ok(store)
}

/// Marks the given prompt as the default.
pub fn set_default(id: &str) -> Result<SummaryPromptStore, String> {
    let _guard = STORE_LOCK.lock().unwrap();
    let mut store = load_store();

    if !store.prompts.iter().any(|p| p.id == id) {
        return Err(format!("Prompt '{}' not found", id));
    }

    store.default_id = Some(id.to_string());
    save_store(&store)?;
    Ok(store)
}

/// Returns the prompt body for the given id, if it exists.
pub fn get_prompt_text(id: &str) -> Option<String> {
    load_store()
        .prompts
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt(id: &str, name: &str) -> SummaryPrompt {
        SummaryPrompt {
            id: id.to_string(),
            name: name.to_string(),
            prompt: "body".to_string(),
        }
    }

    #[test]
    fn normalize_empty_clears_default() {
        let mut store = SummaryPromptStore {
            prompts: vec![],
            default_id: Some("gone".to_string()),
        };
        normalize(&mut store);
        assert_eq!(store.default_id, None);
    }

    #[test]
    fn normalize_promotes_when_default_missing() {
        let mut store = SummaryPromptStore {
            prompts: vec![prompt("a", "A"), prompt("b", "B")],
            default_id: Some("missing".to_string()),
        };
        normalize(&mut store);
        assert_eq!(store.default_id, Some("a".to_string()));
    }

    #[test]
    fn normalize_keeps_valid_default() {
        let mut store = SummaryPromptStore {
            prompts: vec![prompt("a", "A"), prompt("b", "B")],
            default_id: Some("b".to_string()),
        };
        normalize(&mut store);
        assert_eq!(store.default_id, Some("b".to_string()));
    }

    #[test]
    fn store_json_roundtrip() {
        let store = SummaryPromptStore {
            prompts: vec![prompt("a", "A")],
            default_id: Some("a".to_string()),
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: SummaryPromptStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.prompts.len(), 1);
        assert_eq!(back.prompts[0].id, "a");
        assert_eq!(back.default_id, Some("a".to_string()));
    }
}
