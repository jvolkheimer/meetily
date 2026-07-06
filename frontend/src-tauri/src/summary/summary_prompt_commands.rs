//! Tauri commands for managing user-defined meeting summary prompts.

use crate::summary::summary_prompts::{self, SummaryPrompt, SummaryPromptStore};
use tauri::Runtime;
use tracing::info;

/// Lists all summary prompts and the current default id.
///
/// Seeds a starter default prompt on first call so the store is never empty.
#[tauri::command]
pub async fn api_list_summary_prompts<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<SummaryPromptStore, String> {
    info!("api_list_summary_prompts called");
    Ok(summary_prompts::list())
}

/// Creates (empty id) or updates (matching id) a summary prompt. Returns the updated store.
#[tauri::command]
pub async fn api_save_summary_prompt<R: Runtime>(
    _app: tauri::AppHandle<R>,
    prompt: SummaryPrompt,
) -> Result<SummaryPromptStore, String> {
    info!("api_save_summary_prompt called for '{}'", prompt.name);
    summary_prompts::upsert(prompt)
}

/// Deletes a summary prompt by id. Returns the updated store.
#[tauri::command]
pub async fn api_delete_summary_prompt<R: Runtime>(
    _app: tauri::AppHandle<R>,
    id: String,
) -> Result<SummaryPromptStore, String> {
    info!("api_delete_summary_prompt called for '{}'", id);
    summary_prompts::delete(&id)
}

/// Marks a summary prompt as the default. Returns the updated store.
#[tauri::command]
pub async fn api_set_default_summary_prompt<R: Runtime>(
    _app: tauri::AppHandle<R>,
    id: String,
) -> Result<SummaryPromptStore, String> {
    info!("api_set_default_summary_prompt called for '{}'", id);
    summary_prompts::set_default(&id)
}
