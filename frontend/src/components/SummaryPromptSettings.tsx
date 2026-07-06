import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Star, Loader2 } from 'lucide-react';

interface SummaryPrompt {
  id: string;
  name: string;
  prompt: string;
}

interface SummaryPromptStore {
  prompts: SummaryPrompt[];
  default_id: string | null;
}

/**
 * Settings tab for managing user-defined meeting summary prompts.
 * Each prompt is a free-form system prompt; one is marked as the default (used for automatic
 * summarization and pre-selected for manual summaries). Prompts replace the built-in templates
 * in the meeting summary dropdown.
 */
export function SummaryPromptSettings() {
  const [store, setStore] = useState<SummaryPromptStore>({ prompts: [], default_id: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The prompt currently being edited (id === '' means a new, unsaved prompt); null = not editing.
  const [editing, setEditing] = useState<SummaryPrompt | null>(null);

  const load = async () => {
    try {
      const result = await invoke<SummaryPromptStore>('api_list_summary_prompts');
      setStore(result);
    } catch (error) {
      console.error('Failed to load summary prompts:', error);
      toast.error('Failed to load summary prompts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.prompt.trim()) {
      toast.error('Please provide both a name and a prompt');
      return;
    }
    setSaving(true);
    try {
      const result = await invoke<SummaryPromptStore>('api_save_summary_prompt', {
        prompt: { id: editing.id, name: editing.name.trim(), prompt: editing.prompt },
      });
      setStore(result);
      setEditing(null);
      toast.success('Prompt saved');
    } catch (error) {
      console.error('Failed to save summary prompt:', error);
      toast.error('Failed to save prompt', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await invoke<SummaryPromptStore>('api_delete_summary_prompt', { id });
      setStore(result);
      if (editing?.id === id) setEditing(null);
      toast.success('Prompt deleted');
    } catch (error) {
      console.error('Failed to delete summary prompt:', error);
      toast.error('Failed to delete prompt');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const result = await invoke<SummaryPromptStore>('api_set_default_summary_prompt', { id });
      setStore(result);
      toast.success('Default prompt updated');
    } catch (error) {
      console.error('Failed to set default summary prompt:', error);
      toast.error('Failed to set default prompt');
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Meeting Summary Prompts</h3>
        <p className="text-sm text-gray-600">
          Define your own system prompts for meeting summaries. The default prompt is used for
          automatic summaries and is pre-selected when you summarize a meeting. These prompts
          replace the built-in templates in the meeting summary dropdown.
        </p>
      </div>

      {/* Editor */}
      {editing && (
        <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Action Items Only"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
            <textarea
              value={editing.prompt}
              onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
              placeholder="You are an expert meeting-notes assistant. Summarize the transcript as..."
              rows={8}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Used as the system prompt. The meeting transcript is supplied automatically.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              disabled={saving}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Add button */}
      {!editing && (
        <button
          onClick={() => setEditing({ id: '', name: '', prompt: '' })}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <Plus className="w-4 h-4" />
          Add Prompt
        </button>
      )}

      {/* List */}
      <div className="space-y-3">
        {store.prompts.map((prompt) => {
          const isDefault = store.default_id === prompt.id;
          return (
            <div
              key={prompt.id}
              className="flex items-start justify-between gap-4 p-4 border rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{prompt.name}</span>
                  {isDefault && (
                    <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">
                  {prompt.prompt}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleSetDefault(prompt.id)}
                  disabled={isDefault}
                  title={isDefault ? 'Default prompt' : 'Set as default'}
                  className="p-2 rounded-md hover:bg-gray-100 disabled:opacity-40"
                >
                  <Star
                    className={`w-4 h-4 ${isDefault ? 'text-yellow-500 fill-yellow-500' : 'text-gray-500'}`}
                  />
                </button>
                <button
                  onClick={() => setEditing({ ...prompt })}
                  title="Edit prompt"
                  className="p-2 rounded-md hover:bg-gray-100"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
                <button
                  onClick={() => handleDelete(prompt.id)}
                  title="Delete prompt"
                  className="p-2 rounded-md hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
          );
        })}

        {store.prompts.length === 0 && (
          <div className="p-4 border rounded-lg bg-yellow-50 text-sm text-yellow-800">
            No summary prompts yet. Add one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
