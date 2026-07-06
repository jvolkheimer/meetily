import { useState, useEffect, useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';

export interface SummaryPrompt {
  id: string;
  name: string;
  prompt: string;
}

interface SummaryPromptStore {
  prompts: SummaryPrompt[];
  default_id: string | null;
}

/**
 * Loads the user's meeting summary prompts and tracks which one is selected for a meeting.
 * The default prompt (marked in Settings → Meeting Summary Prompts) is pre-selected, so both
 * manual and automatic summaries use it unless the user picks another.
 */
export function useSummaryPrompts() {
  const [prompts, setPrompts] = useState<SummaryPrompt[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  // Once the user manually picks a prompt for this meeting, stop overriding it with the default.
  const [userSelected, setUserSelected] = useState(false);

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const store = await invokeTauri('api_list_summary_prompts') as SummaryPromptStore;
        setPrompts(store.prompts);
        setDefaultPromptId(store.default_id);
        // Pre-select the default unless the user already chose one for this meeting.
        if (!userSelected) {
          setSelectedPromptId(store.default_id ?? store.prompts[0]?.id ?? '');
        }
      } catch (error) {
        console.error('Failed to fetch summary prompts:', error);
      }
    };
    fetchPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePromptSelect = useCallback((promptId: string, promptName: string) => {
    setSelectedPromptId(promptId);
    setUserSelected(true);
    toast.success('Prompt selected', {
      description: `Using "${promptName}" for summary generation`,
    });
    Analytics.trackFeatureUsed('summary_prompt_selected');
  }, []);

  return {
    prompts,
    defaultPromptId,
    selectedPromptId,
    handlePromptSelect,
  };
}
