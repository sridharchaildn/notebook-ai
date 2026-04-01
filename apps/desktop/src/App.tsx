import {
  commitTag,
  removeTag,
} from './lib/noteMetadata';
import type { NoteContextPreset } from '@notebook-ai/contracts';
import {
  getInterviewSession,
  getTranscriptSession,
  isMarkdownNote,
  isTranscriptNote,
} from '@notebook-ai/app-core';
import type {
  CopilotChatMessage,
  AITransformType,
  ContentFormat,
  DriveConnectionStatus,
  FolderNode,
  InterviewSessionData,
  InterviewTurn,
  MarkdownSettings,
  ModelUseCase,
  NoteAIContext,
  NoteKind,
  NoteDocument,
  SourceHint,
  ProviderConnection,
  ProviderId,
  ProviderModel,
  SupabaseSessionPayload,
  StoragePreference,
  SyncStatus,
  TranscriptionPreferences,
  TranscriptSegment,
  TranscriptSessionData,
} from '@notebook-ai/contracts';
import { ChevronRight, Pencil, PanelLeftClose, PanelRightClose, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type UIEvent } from 'react';
import { AIActionPanel } from './components/AIActionPanel';
import { MarkdownPreview } from './components/MarkdownPreview';
import { NoteContextEditor } from './components/NoteContextEditor';
import { NoteList } from './components/NoteList';
import { RichMarkdownEditor } from './components/RichMarkdownEditor';
import { SettingsModal } from './components/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import { SyncStatusBanner } from './components/SyncStatusBanner';
import { TagEditor } from './components/TagEditor';
import { TranscriptSessionView } from './components/TranscriptSessionView';
import {
  TranscriptionPanel,
  type CaptureMode,
  type CaptureSessionMode,
} from './components/TranscriptionPanel';
import {
  authInvalidEventName,
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  getRendererSessionFallback,
  disconnectProvider,
  type DesktopRendererSession,
  fetchFolders,
  fetchMarkdownSettings,
  fetchProviderModels,
  fetchInterviewTurns,
  fetchLocalRoot,
  fetchNotes,
  fetchGoogleDriveStatus,
  fetchProviderStatus,
  fetchStoragePreference,
  fetchSyncStatus,
  fetchTranscriptionPreferences,
  logoutCloudSession,
  moveNote,
  renameFolder,
  runSyncNow,
  setRendererSessionFallback,
  setLocalRoot,
  storeByok,
  openGoogleDriveConnect,
  streamCopilotChat,
  streamInterviewCoach,
  streamTransform,
  transcribeAudioChunk,
  updateMarkdownSettings,
  updateStoragePreference,
  updateNote,
  updateTranscriptionPreferences,
  type TranscriptionEngine,
} from './lib/api';
import { describeSyncStatus } from './lib/syncStatus';
import {
  completeDesktopAuthCallback,
  hasPendingDesktopAuthFlow,
  sendDesktopMagicLink,
  startDesktopGoogleSignIn,
} from './lib/supabaseAuth';

const DEFAULT_BODY = 'Start typing...';
const DELETE_UNDO_MS = 5000;
const INTERVIEW_SEGMENT_MS = 8000;
const INTERVIEW_RECOVERABLE_FAILURE_LIMIT = 2;
const INTERVIEW_TRANSCRIPT_TAIL_CHARS = 5000;
const COACH_PLACEHOLDER = 'Waiting for a new interviewer question...';
const DEFAULT_DRIVE_STATUS: DriveConnectionStatus = {
  connected: false,
  folder_name: 'Notebook AI',
  folder_id: null,
  last_updated_at: null,
};
const INTERVIEW_FILLER_UTTERANCES = new Set([
  'okay',
  'ok',
  'cool',
  'sure',
  'right',
  'alright',
  'got it',
  'thanks',
  'thank you',
]);
const COPILOT_PROVIDER_STORAGE_KEY = 'notebook_copilot_provider';
const COPILOT_MODEL_STORAGE_KEY = 'notebook_copilot_model';
const TRANSCRIPTION_LLM_PROVIDER_STORAGE_KEY = 'notebook_transcription_llm_provider';
const TRANSCRIPTION_LLM_MODEL_STORAGE_KEY = 'notebook_transcription_llm_model';
const TRANSCRIPTION_WHISPER_MODEL_STORAGE_KEY = 'notebook_transcription_whisper_model';
const ROOT_FOLDER_LABEL = 'Notes';
const SIDEBAR_WIDTH_STORAGE_KEY = 'notebook_sidebar_width';
const AI_PANEL_WIDTH_STORAGE_KEY = 'notebook_ai_panel_width';
const NOTE_DETAILS_EXPANDED_STORAGE_KEY = 'notebook_note_details_expanded';
const DEFAULT_SIDEBAR_WIDTH = 280;
const DEFAULT_AI_PANEL_WIDTH = 340;
const MIN_SIDEBAR_WIDTH = 236;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_AI_PANEL_WIDTH = 280;
const MAX_AI_PANEL_WIDTH = 480;
const MIN_EDITOR_WIDTH = 560;
const MOBILE_STACK_BREAKPOINT = 860;
const CONTEXT_PRESET_LABELS: Record<NoteContextPreset, string> = {
  meeting: 'Meeting',
  podcast: 'Podcast',
  youtube: 'YouTube',
  custom: 'Custom',
};

interface PendingDeleteState {
  note: NoteDocument;
  index: number;
}

interface SourceRecorderHandle {
  sourceHint: Extract<SourceHint, 'me' | 'other_audio'>;
  recorder: MediaRecorder;
  chunks: Blob[];
  done: Promise<Blob>;
}

function readStoredProviderId(key: string, fallback: ProviderId): ProviderId {
  const raw = localStorage.getItem(key);
  return raw === 'openai' || raw === 'openrouter' ? raw : fallback;
}

function readStoredString(key: string): string {
  return localStorage.getItem(key)?.trim() ?? '';
}

function readStoredNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function useDebouncedEffect(effect: () => void, deps: unknown[], delay: number) {
  const cleanupRef = useRef<void | (() => void)>();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      cleanupRef.current = effect();
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (typeof cleanupRef.current === 'function') cleanupRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}

type SettingsFeedback = {
  tone: 'success' | 'error';
  message: string;
};

export default function App() {
  const [notes, setNotes] = useState<NoteDocument[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [noteKind, setNoteKind] = useState<NoteKind>('note');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('markdown');
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [contextPreset, setContextPreset] = useState<NoteContextPreset>('custom');
  const [contextText, setContextText] = useState('');
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('notebook_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [providers, setProviders] = useState<ProviderConnection[]>([]);
  const [copilotProvider, setCopilotProvider] = useState<ProviderId>(() =>
    readStoredProviderId(COPILOT_PROVIDER_STORAGE_KEY, 'openai'),
  );
  const [copilotModel, setCopilotModel] = useState(() => readStoredString(COPILOT_MODEL_STORAGE_KEY));
  const [llmTranscriptionProvider, setLlmTranscriptionProvider] = useState<ProviderId>(() =>
    readStoredProviderId(TRANSCRIPTION_LLM_PROVIDER_STORAGE_KEY, 'openai'),
  );
  const [llmTranscriptionModel, setLlmTranscriptionModel] = useState(() =>
    readStoredString(TRANSCRIPTION_LLM_MODEL_STORAGE_KEY),
  );
  const [whisperTranscriptionModel, setWhisperTranscriptionModel] = useState(() =>
    readStoredString(TRANSCRIPTION_WHISPER_MODEL_STORAGE_KEY),
  );
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModel[]>>({});
  const [providerModelsLoading, setProviderModelsLoading] = useState<Record<string, boolean>>({});
  const [providerModelsError, setProviderModelsError] = useState<Record<string, string>>({});
  const [byokProvider, setByokProvider] = useState<'openai' | 'openrouter'>('openai');
  const [byokValue, setByokValue] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [manualSignInUrl, setManualSignInUrl] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [buildVersion, setBuildVersion] = useState('0.1.0');
  const [storagePreference, setStoragePreference] = useState<StoragePreference>({
    mode: 'local',
    local_root: null,
  });
  const [transcriptionPreferences, setTranscriptionPreferences] = useState<TranscriptionPreferences>({
    main_language: 'auto',
    spoken_languages: [],
    custom_vocabulary: [],
    updated_at: null,
  });
  const [markdownSettings, setMarkdownSettings] = useState<MarkdownSettings>({
    enable_import: true,
    enable_export: true,
    editor_mode: 'rich_text',
    updated_at: null,
  });
  const [localRootPath, setLocalRootPath] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncActionBusy, setSyncActionBusy] = useState(false);
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>(DEFAULT_DRIVE_STATUS);
  const [driveStatusBusy, setDriveStatusBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredNumber(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH),
  );
  const [aiPanelWidth, setAiPanelWidth] = useState(() =>
    readStoredNumber(AI_PANEL_WIDTH_STORAGE_KEY, DEFAULT_AI_PANEL_WIDTH),
  );
  const [detailsExpanded, setDetailsExpanded] = useState(() =>
    readStoredBoolean(NOTE_DETAILS_EXPANDED_STORAGE_KEY, false),
  );
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeTransformAction, setActiveTransformAction] = useState<AITransformType | null>(null);
  const [byokSubmitting, setByokSubmitting] = useState(false);
  const [providerDisconnecting, setProviderDisconnecting] = useState<ProviderId | null>(null);
  const [aiOutput, setAiOutput] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<SettingsFeedback | null>(null);
  const [message, setMessage] = useState('Ready');
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('Capture is idle');
  const [activeSessionMode, setActiveSessionMode] = useState<CaptureSessionMode>('notes');
  const [candidateMuted, setCandidateMuted] = useState(false);
  const [interviewTranscript, setInterviewTranscript] = useState('');
  const [interviewTurns, setInterviewTurns] = useState<InterviewTurn[]>([]);
  const [interviewGuidance, setInterviewGuidance] = useState('');
  const [interviewGuidanceBusy, setInterviewGuidanceBusy] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [noteSummary, setNoteSummary] = useState('');
  const [transcriptViewTab, setTranscriptViewTab] = useState<'transcript' | 'summary'>('transcript');
  const [copilotChatDraft, setCopilotChatDraft] = useState('');
  const [copilotChatHistory, setCopilotChatHistory] = useState<CopilotChatMessage[]>([]);
  const [copilotChatBusy, setCopilotChatBusy] = useState(false);
  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngine>(() => {
    return (localStorage.getItem('notebook_transcription_engine') as TranscriptionEngine) || 'whisper';
  });

  function handleTranscriptionEngineChange(engine: TranscriptionEngine) {
    setTranscriptionEngine(engine);
    localStorage.setItem('notebook_transcription_engine', engine);
  }

  function clearSettingsFeedback() {
    setSettingsFeedback(null);
  }

  function setSettingsSuccess(nextMessage: string) {
    setSettingsFeedback({ tone: 'success', message: nextMessage });
  }

  function setSettingsError(nextMessage: string) {
    setSettingsFeedback({ tone: 'error', message: nextMessage });
  }

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsFeedback(null);
    }
  }, [settingsOpen]);

  const [isMacPlatform] = useState(() => /mac/i.test(navigator.platform));
  const captureStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pendingTitleFocusIdRef = useRef<string | null>(null);
  /** Buffered recorder chunks; merged and transcribed once on stop as a complete audio file. */
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  const transcriptionEngineSessionRef = useRef<TranscriptionEngine>('whisper');
  const sessionModeRef = useRef<CaptureSessionMode>('notes');
  const captureActiveRef = useRef(false);
  const interviewSegmentTimerRef = useRef<number | null>(null);
  const interviewSegmentChunksRef = useRef<Blob[]>([]);
  const interviewSegmentQueueRef = useRef<Array<{ segmentId: number; blob: Blob }>>([]);
  const interviewSegmentProcessingRef = useRef(false);
  const nextInterviewSegmentIdRef = useRef(1);
  const interviewRecoverableFailureCountRef = useRef(0);
  const interviewUpdateInFlightRef = useRef(false);
  const interviewTranscriptRef = useRef('');
  const interviewTurnsRef = useRef<InterviewTurn[]>([]);
  const interviewDigestRef = useRef('');
  const lastCoachedInterviewerTurnIdRef = useRef<string | null>(null);
  const coachInFlightRequestIdRef = useRef(0);
  const interviewGuidanceRef = useRef('');
  const transcriptSegmentsRef = useRef<TranscriptSegment[]>([]);
  const noteSummaryRef = useRef('');
  const candidateMutedRef = useRef(false);
  const interviewThreadRef = useRef<HTMLDivElement | null>(null);
  const interviewBottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollInterviewRef = useRef(true);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const autoEnhanceNoteIdRef = useRef<string | null>(null);
  const authCallbackInFlightRef = useRef<string | null>(null);
  const lastHandledAuthCallbackRef = useRef<string | null>(null);
  const driveConnectPollingRef = useRef(false);
  const transformAbortRef = useRef<AbortController | null>(null);
  const copilotChatAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(aiPanelWidth));
  }, [aiPanelWidth]);

  useEffect(() => {
    localStorage.setItem(NOTE_DETAILS_EXPANDED_STORAGE_KEY, String(detailsExpanded));
  }, [detailsExpanded]);

  useEffect(() => {
    return () => {
      document.body.classList.remove('is-resizing-panels');
    };
  }, []);

  function getSidebarWidthBounds() {
    const otherPanelWidth = aiPanelOpen ? aiPanelWidth : 48;
    const maxAllowed = Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - otherPanelWidth - MIN_EDITOR_WIDTH);
    return {
      min: MIN_SIDEBAR_WIDTH,
      max: Math.max(MIN_SIDEBAR_WIDTH, maxAllowed),
    };
  }

  function getAiPanelWidthBounds() {
    const otherPanelWidth = sidebarOpen ? sidebarWidth : 48;
    const maxAllowed = Math.min(MAX_AI_PANEL_WIDTH, window.innerWidth - otherPanelWidth - MIN_EDITOR_WIDTH);
    return {
      min: MIN_AI_PANEL_WIDTH,
      max: Math.max(MIN_AI_PANEL_WIDTH, maxAllowed),
    };
  }

  function startPanelResize(panel: 'sidebar' | 'ai', event: ReactPointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= MOBILE_STACK_BREAKPOINT) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = panel === 'sidebar' ? sidebarWidth : aiPanelWidth;
    document.body.classList.add('is-resizing-panels');

    const handleMove = (moveEvent: PointerEvent) => {
      if (panel === 'sidebar') {
        const bounds = getSidebarWidthBounds();
        setSidebarWidth(clampValue(startWidth + moveEvent.clientX - startX, bounds.min, bounds.max));
        return;
      }

      const bounds = getAiPanelWidthBounds();
      setAiPanelWidth(clampValue(startWidth + startX - moveEvent.clientX, bounds.min, bounds.max));
    };

    const cleanup = () => {
      document.body.classList.remove('is-resizing-panels');
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }

  function applyRendererSession(session: DesktopRendererSession | null) {
    setRendererSessionFallback(session);
    setAuthPending(false);
    setManualSignInUrl(null);
    setSessionUserId(session?.userId ?? null);
    setShowSplash(!session?.userId);
    setMessage(session?.userId ? 'Signed in. Loading workspace...' : 'Ready');
  }

  const selectedNote = useMemo(
    () => notes.find((note) => note.frontmatter.id === selectedId) ?? null,
    [notes, selectedId],
  );
  const showInterviewNoteView = selectedNote?.kind === 'interview_assist';
  const showTranscriptNoteView = isTranscriptNote(selectedNote);
  const connectedProviders = useMemo(
    () => providers.filter((entry) => entry.connected).map((entry) => entry.provider),
    [providers],
  );
  const activeTranscriptionProvider: ProviderId =
    transcriptionEngine === 'whisper' ? 'openai' : llmTranscriptionProvider;
  const activeTranscriptionModel =
    transcriptionEngine === 'whisper' ? whisperTranscriptionModel : llmTranscriptionModel;
  const copilotModelCacheKey = `${copilotProvider}:copilot`;
  const transcriptionModelCacheKey = `${activeTranscriptionProvider}:transcription`;
  const copilotModelOptions = connectedProviders.includes(copilotProvider)
    ? providerModels[copilotModelCacheKey] ?? []
    : [];
  const transcriptionProviderConnected =
    transcriptionEngine === 'whisper'
      ? connectedProviders.includes('openai')
      : connectedProviders.includes(activeTranscriptionProvider);
  const transcriptionModelOptions = transcriptionProviderConnected
    ? providerModels[transcriptionModelCacheKey] ?? []
    : [];
  const copilotModelsLoading = providerModelsLoading[copilotModelCacheKey] ?? false;
  const transcriptionModelsLoading = transcriptionProviderConnected
    ? providerModelsLoading[transcriptionModelCacheKey] ?? false
    : false;
  const copilotModelsError = connectedProviders.includes(copilotProvider)
    ? providerModelsError[copilotModelCacheKey] ?? ''
    : '';
  const transcriptionModelsError = transcriptionProviderConnected
    ? providerModelsError[transcriptionModelCacheKey] ?? ''
    : '';

  useEffect(() => {
    setSelectedNoteIds((prev) =>
      prev.filter((noteId) => notes.some((note) => note.frontmatter.id === noteId)),
    );
  }, [notes]);

  function mergeProviderStatuses(statuses: ProviderConnection[]) {
    setProviders(
      statuses.map((entry) => ({
        provider: entry.provider,
        connected: entry.connected,
        via: entry.via,
        scope: entry.scope,
        last_updated_at: entry.last_updated_at,
      })),
    );
  }

  async function loadProviderModels(provider: ProviderId, useCase: ModelUseCase) {
    const cacheKey = `${provider}:${useCase}`;
    setProviderModelsLoading((prev) => ({ ...prev, [cacheKey]: true }));
    setProviderModelsError((prev) => ({ ...prev, [cacheKey]: '' }));
    try {
      const models = await fetchProviderModels(provider, useCase);
      setProviderModels((prev) => ({ ...prev, [cacheKey]: models }));
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unable to load models.';
      const friendlyMessage =
        rawMessage === 'Credential not found'
          ? `Save a local ${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} key in Settings to browse models on this device.`
          : rawMessage;
      setProviderModelsError((prev) => ({
        ...prev,
        [cacheKey]: friendlyMessage,
      }));
    } finally {
      setProviderModelsLoading((prev) => ({ ...prev, [cacheKey]: false }));
    }
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('notebook_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(COPILOT_PROVIDER_STORAGE_KEY, copilotProvider);
  }, [copilotProvider]);

  useEffect(() => {
    if (copilotModel.trim()) {
      localStorage.setItem(COPILOT_MODEL_STORAGE_KEY, copilotModel);
      return;
    }
    localStorage.removeItem(COPILOT_MODEL_STORAGE_KEY);
  }, [copilotModel]);

  useEffect(() => {
    localStorage.setItem(TRANSCRIPTION_LLM_PROVIDER_STORAGE_KEY, llmTranscriptionProvider);
  }, [llmTranscriptionProvider]);

  useEffect(() => {
    if (llmTranscriptionModel.trim()) {
      localStorage.setItem(TRANSCRIPTION_LLM_MODEL_STORAGE_KEY, llmTranscriptionModel);
      return;
    }
    localStorage.removeItem(TRANSCRIPTION_LLM_MODEL_STORAGE_KEY);
  }, [llmTranscriptionModel]);

  useEffect(() => {
    if (whisperTranscriptionModel.trim()) {
      localStorage.setItem(TRANSCRIPTION_WHISPER_MODEL_STORAGE_KEY, whisperTranscriptionModel);
      return;
    }
    localStorage.removeItem(TRANSCRIPTION_WHISPER_MODEL_STORAGE_KEY);
  }, [whisperTranscriptionModel]);

  useEffect(() => {
    interviewGuidanceRef.current = interviewGuidance;
  }, [interviewGuidance]);

  useEffect(() => {
    transcriptSegmentsRef.current = transcriptSegments;
  }, [transcriptSegments]);

  useEffect(() => {
    noteSummaryRef.current = noteSummary;
  }, [noteSummary]);

  useEffect(() => {
    interviewTurnsRef.current = interviewTurns;
  }, [interviewTurns]);

  useEffect(() => {
    candidateMutedRef.current = candidateMuted;
    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = candidateMuted ? 0 : 1;
    }
    for (const track of micStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !candidateMuted;
    }
  }, [candidateMuted]);

  useEffect(() => {
    const sentinel = interviewBottomSentinelRef.current;
    if (!sentinel) return;
    if (noteKind !== 'interview_assist') return;
    if (!shouldAutoScrollInterviewRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      sentinel.scrollIntoView({ block: 'end' });
      setShowJumpToLatest(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interviewTurns, noteKind]);

  useEffect(() => {
    if (noteKind !== 'interview_assist') return;
    const container = interviewThreadRef.current;
    const sentinel = interviewBottomSentinelRef.current;
    if (!container || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        shouldAutoScrollInterviewRef.current = entry.isIntersecting;
        setShowJumpToLatest(!entry.isIntersecting);
      },
      {
        root: container,
        threshold: 0.95,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [noteKind, interviewTurns.length]);

  useEffect(() => {
    if (activeSessionMode !== 'interview_assist') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'm') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      event.preventDefault();
      setCandidateMuted((prev) => !prev);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeSessionMode]);

  useEffect(() => {
    const pendingNoteId = autoEnhanceNoteIdRef.current;
    if (!pendingNoteId) return;
    if (recording || transcriptionBusy) return;
    if (!selectedNote || selectedNote.frontmatter.id !== pendingNoteId) return;
    if (!['transcript', 'interview_assist'].includes(selectedNote.kind)) return;
    if (!body.trim() && !interviewTranscriptRef.current.trim()) return;
    if (!connectedProviders.includes(copilotProvider)) {
      autoEnhanceNoteIdRef.current = null;
      return;
    }

    autoEnhanceNoteIdRef.current = null;
    void runTransform('summarize');
  }, [
    body,
    connectedProviders,
    copilotProvider,
    recording,
    selectedNote,
    transcriptionBusy,
  ]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [appInfo, bridgeSession, pendingAuthFlow] = await Promise.all([
          window.notebookDesktop?.getAppInfo?.(),
          window.notebookDesktop?.getAuthSession?.(),
          hasPendingDesktopAuthFlow(),
        ]);
        const session = bridgeSession ?? getRendererSessionFallback();
        if (disposed) return;
        setBuildVersion(appInfo?.buildVersion ?? appInfo?.version ?? '0.1.0');
        setSessionUserId(session?.userId ?? null);
        setAuthPending(Boolean(!session?.userId && pendingAuthFlow));
        setShowSplash(!session?.userId);
      } finally {
        if (!disposed) {
          setAuthReady(true);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const eventName = authInvalidEventName();
    const handler = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail === 'string'
          ? event.detail
          : 'Session expired. Sign in again.';
      setRendererSessionFallback(null);
      setSessionUserId(null);
      setAuthPending(false);
      setManualSignInUrl(null);
      setSettingsOpen(false);
      setShowSplash(true);
      setMessage(detail);
    };

    window.addEventListener(eventName, handler);
    return () => {
      window.removeEventListener(eventName, handler);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const syncSessionFromMain = async () => {
      const session = (await window.notebookDesktop?.getAuthSession?.()) ?? getRendererSessionFallback();
      if (!disposed && session?.userId) {
        applyRendererSession(session);
        return true;
      }
      return false;
    };

    const tryConsumePending = async () => {
      try {
        if (await syncSessionFromMain()) {
          return;
        }
        const url = await window.notebookDesktop?.consumeAuthCallback?.();
        if (!disposed && url) {
          void handleDesktopAuthCallback(url);
        }
      } catch {
        /* ignore pending callback drain errors */
      }
    };

    void tryConsumePending();
    const pollTimer = window.setInterval(() => {
      if (sessionUserId) return;
      void tryConsumePending();
    }, 1200);

    const unsubscribeAuthCallback = window.notebookDesktop?.onAuthCallback?.((url) => {
      void handleDesktopAuthCallback(url);
    });
    const unsubscribeSession = window.notebookDesktop?.onAuthSessionUpdated?.((session) => {
      applyRendererSession(session);
    });
    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      unsubscribeAuthCallback?.();
      unsubscribeSession?.();
    };
  }, [sessionUserId]);

  useEffect(() => {
    if (!authReady || !sessionUserId) return;
    void (async () => {
      try {
        const [
          loadedNotes,
          loadedFolders,
          providerStatuses,
          pref,
          localRoot,
          sync,
          drive,
          loadedTranscriptionPreferences,
          loadedMarkdownSettings,
        ] = await Promise.all([
          fetchNotes(),
          fetchFolders().catch(() => []),
          fetchProviderStatus(),
          fetchStoragePreference().catch(() => ({ mode: 'local', local_root: null } as StoragePreference)),
          fetchLocalRoot().catch(() => ''),
          fetchSyncStatus().catch(() => null),
          fetchGoogleDriveStatus().catch(() => DEFAULT_DRIVE_STATUS),
          fetchTranscriptionPreferences().catch(
            () =>
              ({
                main_language: 'auto',
                spoken_languages: [],
                custom_vocabulary: [],
                updated_at: null,
              }) as TranscriptionPreferences,
          ),
          fetchMarkdownSettings().catch(
            () =>
              ({
                enable_import: true,
                enable_export: true,
                editor_mode: 'rich_text',
                updated_at: null,
              }) as MarkdownSettings,
          ),
        ]);

        setNotes(loadedNotes);
        setFolders(loadedFolders);
        mergeProviderStatuses(providerStatuses);
        setStoragePreference(pref);
        setTranscriptionPreferences(loadedTranscriptionPreferences);
        setMarkdownSettings(loadedMarkdownSettings);
        setLocalRootPath(pref.local_root || localRoot);
        setSyncStatus(sync);
        setDriveStatus(drive);

        const first = loadedNotes[0];
        if (first) {
          setSelectedId(first.frontmatter.id);
          setSelectedFolderId(first.frontmatter.folder_id ?? null);
          applyEditorStateFromNote(first);
        } else {
          const created = await createNote({
            title: 'Welcome note',
            content: DEFAULT_BODY,
            tags: ['welcome'],
            kind: 'note',
            content_format: 'markdown',
            context_preset: 'custom',
            context_text: '',
          });
          setNotes([created]);
          setSelectedId(created.frontmatter.id);
          setSelectedFolderId(created.frontmatter.folder_id ?? null);
          applyEditorStateFromNote(created);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Failed to initialize');
      }
    })();
  }, [authReady, sessionUserId]);

  useEffect(() => {
    if (connectedProviders.length === 0) return;
    if (!connectedProviders.includes(copilotProvider)) {
      setCopilotProvider(connectedProviders[0]!);
    }
  }, [connectedProviders, copilotProvider]);

  useEffect(() => {
    if (transcriptionEngine !== 'llm') return;
    if (connectedProviders.length === 0) return;
    if (!connectedProviders.includes(llmTranscriptionProvider)) {
      setLlmTranscriptionProvider(connectedProviders[0]!);
    }
  }, [connectedProviders, llmTranscriptionProvider, transcriptionEngine]);

  useEffect(() => {
    if (!authReady || !sessionUserId) return;
    if (!connectedProviders.includes(copilotProvider)) return;
    void loadProviderModels(copilotProvider, 'copilot');
  }, [authReady, sessionUserId, connectedProviders, copilotProvider]);

  useEffect(() => {
    if (!authReady || !sessionUserId) return;
    if (transcriptionEngine === 'whisper') {
      if (!connectedProviders.includes('openai')) return;
    } else if (!connectedProviders.includes(activeTranscriptionProvider)) {
      return;
    }
    void loadProviderModels(activeTranscriptionProvider, 'transcription');
  }, [
    authReady,
    sessionUserId,
    connectedProviders,
    activeTranscriptionProvider,
    transcriptionEngine,
  ]);

  useEffect(() => {
    if (copilotModelOptions.length === 0) {
      if (copilotModel) setCopilotModel('');
      return;
    }
    if (!copilotModelOptions.some((option) => option.id === copilotModel)) {
      setCopilotModel(copilotModelOptions[0]!.id);
    }
  }, [copilotModelOptions, copilotModel]);

  useEffect(() => {
    if (transcriptionEngine !== 'llm') return;
    if (transcriptionModelOptions.length === 0) {
      if (llmTranscriptionModel) setLlmTranscriptionModel('');
      return;
    }
    if (!transcriptionModelOptions.some((option) => option.id === llmTranscriptionModel)) {
      setLlmTranscriptionModel(transcriptionModelOptions[0]!.id);
    }
  }, [transcriptionEngine, transcriptionModelOptions, llmTranscriptionModel]);

  useEffect(() => {
    if (transcriptionEngine !== 'whisper') return;
    if (transcriptionModelOptions.length === 0) {
      if (whisperTranscriptionModel) setWhisperTranscriptionModel('');
      return;
    }
    if (!transcriptionModelOptions.some((option) => option.id === whisperTranscriptionModel)) {
      setWhisperTranscriptionModel(transcriptionModelOptions[0]!.id);
    }
  }, [transcriptionEngine, transcriptionModelOptions, whisperTranscriptionModel]);

  useEffect(() => {
    if (!authReady || !sessionUserId) return;
    if (storagePreference.mode !== 'local_and_drive') return;

    let disposed = false;
    const poll = async () => {
      try {
        const status = await fetchSyncStatus();
        if (!disposed) {
          setSyncStatus(status);
        }
      } catch {
        /* ignore transient sync polling failures */
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2500);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [authReady, sessionUserId, storagePreference.mode]);



  function clearInterviewSegmentTimer() {
    if (interviewSegmentTimerRef.current !== null) {
      window.clearTimeout(interviewSegmentTimerRef.current);
      interviewSegmentTimerRef.current = null;
    }
  }

  function buildInterviewSession(
    transcript: string,
    guidance: string,
    turns: InterviewTurn[] = interviewTurnsRef.current,
    summary: string | null = noteSummaryRef.current || null,
  ): InterviewSessionData {
    return {
      session_type: 'interview_assist',
      transcript,
      guidance,
      turns,
      summary,
      last_coached_interviewer_turn_id: lastCoachedInterviewerTurnIdRef.current,
      last_updated_at: new Date().toISOString(),
    };
  }

  function buildTranscriptSession(
    transcript: string,
    segments: TranscriptSegment[] = transcriptSegmentsRef.current,
    summary: string | null = noteSummaryRef.current || null,
  ): TranscriptSessionData {
    return {
      session_type: 'transcript',
      transcript,
      segments,
      summary,
      last_updated_at: new Date().toISOString(),
    };
  }

  function serializeExistingSessionForCompare(session: NoteDocument['session'] | null) {
    if (!session || typeof session !== 'object') {
      return 'null';
    }
    const comparable = { ...((session as unknown) as Record<string, unknown>) };
    delete comparable.last_updated_at;
    return JSON.stringify(comparable);
  }

  function serializeSessionForCompare(kind: NoteKind, content: string): string {
    if (kind === 'interview_assist') {
      return serializeExistingSessionForCompare(
        buildInterviewSession(
          interviewTranscriptRef.current || content,
          interviewGuidanceRef.current,
          interviewTurnsRef.current,
          noteSummaryRef.current || null,
        ),
      );
    }

    if (kind === 'transcript') {
      return serializeExistingSessionForCompare(
        buildTranscriptSession(content, transcriptSegmentsRef.current, noteSummaryRef.current || null),
      );
    }

    return 'null';
  }

  function buildCurrentNoteContext(): NoteAIContext {
    return {
      title: title.trim() || 'Untitled note',
      tags,
      note_kind: noteKind,
      context_preset: contextPreset,
      context_text: contextText.trim() || null,
      transcript_segments: noteKind === 'transcript' ? transcriptSegmentsRef.current : [],
      summary: noteSummaryRef.current || null,
    };
  }

  function buildTransformNoteContext(action: AITransformType): NoteAIContext {
    const base = buildCurrentNoteContext();
    if (action === 'summarize' || action === 'rewrite') {
      return {
        ...base,
        transcript_segments: [],
        summary: null,
      };
    }
    return base;
  }

  function isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    );
  }

  function commitTagDraft() {
    setTags((prev) => commitTag(prev, tagDraft));
    setTagDraft('');
  }

  function focusTitleInput() {
    window.requestAnimationFrame(() => {
      const input = titleInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }

  function applyEditorStateFromNote(note: NoteDocument | null) {
    if (!note) {
      setTitle('');
      setBody('');
      setNoteKind('note');
      setContentFormat('markdown');
      setTags([]);
      setTagDraft('');
      setContextPreset('custom');
      setContextText('');
      setTranscriptSegments([]);
      setNoteSummary('');
      setTranscriptViewTab('transcript');
      setInterviewTranscript('');
      setInterviewTurns([]);
      setInterviewGuidance('');
      setCopilotChatDraft('');
      setCopilotChatHistory([]);
      setAiOutput('');
      return;
    }

    setTitle(note.frontmatter.title);
    setBody(note.content);
    setNoteKind(note.kind);
    setContentFormat(note.content_format);
    setShowMarkdownSource(false);
    setTags(note.frontmatter.tags);
      setTagDraft('');
      setContextPreset(note.frontmatter.context_preset ?? 'custom');
      setContextText(note.frontmatter.context_text ?? '');
      setAiOutput('');
      setTranscriptViewTab('transcript');
      setCopilotChatDraft('');
      setCopilotChatHistory([]);

    if (note.kind === 'interview_assist') {
      const session = getInterviewSession(note);
      const transcript = session?.transcript ?? note.content;
      const guidance = session?.guidance ?? '';
      const turns = session?.turns ?? [];
      interviewTranscriptRef.current = transcript;
      interviewTurnsRef.current = turns;
      interviewGuidanceRef.current = guidance;
      setInterviewTranscript(transcript);
      setInterviewTurns(turns);
      setInterviewGuidance(guidance);
      setNoteSummary(session?.summary ?? '');
      lastCoachedInterviewerTurnIdRef.current =
        session?.last_coached_interviewer_turn_id ?? null;
      setTranscriptSegments([]);
      return;
    }

    if (note.kind === 'transcript') {
      const session = getTranscriptSession(note);
      const transcript = session?.transcript ?? note.content;
      setBody(transcript);
      setTranscriptSegments(session?.segments ?? []);
      setNoteSummary(session?.summary ?? '');
      interviewTranscriptRef.current = '';
      interviewTurnsRef.current = [];
      interviewGuidanceRef.current = '';
      setInterviewTranscript('');
      setInterviewTurns([]);
      setInterviewGuidance('');
      return;
    }

    setTranscriptSegments([]);
    setNoteSummary('');
    interviewTranscriptRef.current = '';
    interviewTurnsRef.current = [];
    interviewGuidanceRef.current = '';
    setInterviewTranscript('');
    setInterviewTurns([]);
    setInterviewGuidance('');
  }

  function buildTransformContent(currentNote: NoteDocument | null, currentContent: string) {
    if (!currentNote) return currentContent;
    if (currentNote.kind === 'interview_assist') {
      return [
        interviewTranscriptRef.current || currentContent,
        interviewGuidanceRef.current,
      ]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    }
    return currentContent;
  }

  function latestTurn(role: 'interviewer' | 'interviewee', turns: InterviewTurn[] = interviewTurnsRef.current) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]!;
      if (turn.role === role) return turn;
    }
    return null;
  }

  function normalizeComparableText(raw: string) {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mergeTranscriptText(previous: string, incoming: string) {
    const next = incoming.trim();
    if (!next) return previous;
    const prior = previous.trim();
    if (!prior) return next;

    const priorWords = normalizeComparableText(prior).split(' ').filter(Boolean);
    const nextWords = normalizeComparableText(next).split(' ').filter(Boolean);
    if (nextWords.length === 0) return previous;
    if (priorWords.join(' ').includes(nextWords.join(' '))) return previous;

    const maxOverlap = Math.min(priorWords.length, nextWords.length, 80);
    let overlap = 0;
    for (let size = maxOverlap; size >= 6; size -= 1) {
      const priorTail = priorWords.slice(-size).join(' ');
      const nextHead = nextWords.slice(0, size).join(' ');
      if (priorTail === nextHead) {
        overlap = size;
        break;
      }
    }

    if (overlap === 0) {
      const recentPrior = priorWords.slice(-30).join(' ');
      const recentNext = nextWords.slice(-30).join(' ');
      if (recentPrior && recentPrior === recentNext) return previous;
      return `${prior} ${next}`.trim();
    }

    const delta = nextWords.slice(overlap).join(' ').trim();
    if (!delta) return previous;
    return `${prior} ${delta}`.trim();
  }

  function isCoachableInterviewerTurn(turn: InterviewTurn) {
    const text = turn.text.trim();
    if (text.length < 8) return false;
    const normalized = normalizeComparableText(text);
    if (!normalized) return false;
    if (INTERVIEW_FILLER_UTTERANCES.has(normalized)) return false;
    if (normalized.split(' ').length < 3 && !text.includes('?')) return false;
    return true;
  }

  function appearsInTranscriptTail(turnText: string, transcript: string) {
    const normalizedTurn = normalizeComparableText(turnText);
    const normalizedTranscriptTail = normalizeComparableText(
      transcript.slice(-INTERVIEW_TRANSCRIPT_TAIL_CHARS),
    );
    if (!normalizedTurn || !normalizedTranscriptTail) return false;
    if (normalizedTranscriptTail.includes(normalizedTurn)) return true;

    const tokens = normalizedTurn.split(' ').filter(Boolean);
    const probe = tokens.slice(-Math.min(tokens.length, 8)).join(' ');
    return probe.length > 0 && normalizedTranscriptTail.includes(probe);
  }

  function selectCoachTargetTurn(turns: InterviewTurn[], transcript: string) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]!;
      if (turn.role !== 'interviewer') continue;
      if (!isCoachableInterviewerTurn(turn)) continue;
      if (appearsInTranscriptTail(turn.text, transcript)) return turn;
    }
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]!;
      if (turn.role !== 'interviewer') continue;
      if (!isCoachableInterviewerTurn(turn)) continue;
      return turn;
    }
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]!;
      if (turn.role !== 'interviewer') continue;
      if (!turn.text.trim()) continue;
      return turn;
    }
    return null;
  }

  function handleInterviewThreadScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom < 56;
    shouldAutoScrollInterviewRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }

  function jumpInterviewThreadToLatest() {
    const sentinel = interviewBottomSentinelRef.current;
    if (!sentinel) return;
    sentinel.scrollIntoView({ block: 'end' });
    shouldAutoScrollInterviewRef.current = true;
    setShowJumpToLatest(false);
  }

  function normalizeCoachText(raw: string, maxLines = 3) {
    const cleaned = raw
      .replace(/^[#*\-\s]+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!cleaned) return '';
    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(0, maxLines).join('\n');
  }

  function buildCoachFallback(
    interviewerTurn: InterviewTurn,
    latestIntervieweeTurn: InterviewTurn | null,
    maxLines = 3,
  ) {
    const question = interviewerTurn.text.trim();
    const prior = latestIntervieweeTurn?.text.trim() ?? '';
    if (maxLines <= 1) {
      return `I’d answer '${question.slice(0, 70)}' directly, then add one concrete example.`;
    }
    if (prior) {
      return [
        `I’d answer '${question.slice(0, 90)}' directly first.`,
        'Then give one concise example from my work.',
        'End with measurable impact in one line.',
      ].join('\n');
    }
    return [
      `I’d start by directly answering '${question.slice(0, 90)}'.`,
      'Then add one clear example from my experience.',
      'Finish with the outcome and impact.',
    ].join('\n');
  }

  function scheduleInterviewSegmentRollover() {
    clearInterviewSegmentTimer();
    interviewSegmentTimerRef.current = window.setTimeout(() => {
      if (!captureActiveRef.current) return;
      if (sessionModeRef.current !== 'interview_assist') return;
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== 'recording') return;
      try {
        recorder.requestData();
      } catch {
        /* ignore */
      }
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }, INTERVIEW_SEGMENT_MS);
  }

  function forceInterviewSegmentRollover(statusText: string) {
    if (!captureActiveRef.current) return;
    if (sessionModeRef.current !== 'interview_assist') return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;

    setTranscriptionStatus(statusText);
    try {
      recorder.requestData();
    } catch {
      /* ignore */
    }
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }

  function attachInterviewRecorderHandlers(
    recorder: MediaRecorder,
    transcriptionEngine: TranscriptionEngine,
  ) {
    interviewSegmentChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      interviewSegmentChunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      clearInterviewSegmentTimer();

      const chunks = interviewSegmentChunksRef.current;
      interviewSegmentChunksRef.current = [];
      const mimeType = recorder.mimeType || 'audio/webm';
      const segmentBlob = chunks.length === 1 ? chunks[0]! : new Blob(chunks, { type: mimeType });
      if (segmentBlob.size > 0) {
        const segmentId = nextInterviewSegmentIdRef.current;
        nextInterviewSegmentIdRef.current += 1;
        interviewSegmentQueueRef.current.push({ segmentId, blob: segmentBlob });
        if (interviewSegmentQueueRef.current.length > 24) {
          interviewSegmentQueueRef.current.shift();
        }
        void processInterviewSegmentQueue(transcriptionEngine);
      }

      if (!captureActiveRef.current || sessionModeRef.current !== 'interview_assist') return;
      const stream = audioStreamRef.current;
      if (!stream) return;

      const nextRecorder = buildAudioRecorder(stream);
      recorderRef.current = nextRecorder;
      attachInterviewRecorderHandlers(nextRecorder, transcriptionEngine);
      nextRecorder.start();
      scheduleInterviewSegmentRollover();
      setTranscriptionStatus('Listening...');
    };
  }

  async function processInterviewSegmentQueue(transcriptionEngine: TranscriptionEngine) {
    if (interviewSegmentProcessingRef.current) return;
    interviewSegmentProcessingRef.current = true;
    try {
      while (interviewSegmentQueueRef.current.length > 0) {
        const nextSegment = interviewSegmentQueueRef.current.shift();
        if (!nextSegment) continue;
        await refreshInterviewAssist(nextSegment.blob, transcriptionEngine, nextSegment.segmentId);
      }
    } finally {
      interviewSegmentProcessingRef.current = false;
    }
  }

  async function refreshInterviewAssist(
    mergedAudio: Blob,
    transcriptionEngine: TranscriptionEngine,
    segmentId?: number,
  ) {
    if (sessionModeRef.current !== 'interview_assist') return;
    if (interviewUpdateInFlightRef.current) return;
    if (mergedAudio.size === 0) return;
    if (!connectedProviders.includes(copilotProvider)) {
      setTranscriptionStatus('Connect an AI provider in Settings to use Interview Assist.');
      return;
    }
    if (transcriptionEngine === 'llm' && !connectedProviders.includes(llmTranscriptionProvider)) {
      setTranscriptionStatus('Connect a provider in Settings to use Detailed transcription.');
      return;
    }

    interviewUpdateInFlightRef.current = true;
    setTranscriptionBusy(true);

    try {
      const result = await transcribeAudioChunk(
        mergedAudio,
        activeTranscriptionProvider,
        transcriptionEngine,
        segmentId,
        activeTranscriptionModel || undefined,
        {
          contextPreset,
          contextText,
          sourceHint: activeSessionMode === 'interview_assist' ? 'unknown' : null,
        },
      );
      if (!result.ok) {
        const recoverableFailure = Boolean(result.recoverable);
        const detail =
          result.detail?.trim() ||
          'Transcription failed.';
        setTranscriptionStatus(detail);

        if (
          recoverableFailure &&
          transcriptionEngine === 'whisper' &&
          sessionModeRef.current === 'interview_assist'
        ) {
          interviewRecoverableFailureCountRef.current += 1;
          if (interviewRecoverableFailureCountRef.current >= INTERVIEW_RECOVERABLE_FAILURE_LIMIT) {
            interviewRecoverableFailureCountRef.current = 0;
            forceInterviewSegmentRollover('Recovering audio capture...');
          }
        } else {
          interviewRecoverableFailureCountRef.current = 0;
        }
        return;
      }

      const chunkTranscript = result.text.trim();
      if (!chunkTranscript) {
        interviewRecoverableFailureCountRef.current = 0;
        setTranscriptionStatus(result.detail?.trim() || 'Listening...');
        return;
      }
      interviewRecoverableFailureCountRef.current = 0;

      const nextTranscript = mergeTranscriptText(interviewTranscriptRef.current, chunkTranscript);
      if (!nextTranscript || nextTranscript === interviewTranscriptRef.current) {
        setTranscriptionStatus('Listening...');
        return;
      }
      const transcriptForTurnExtraction = nextTranscript.slice(-INTERVIEW_TRANSCRIPT_TAIL_CHARS);

      const turnPayload = await fetchInterviewTurns({
        transcript: transcriptForTurnExtraction,
        previous_turns: interviewTurnsRef.current,
        provider: copilotProvider,
        model: copilotModel || undefined,
      });
      if (turnPayload.transcript_digest === interviewDigestRef.current) {
        setTranscriptionStatus('Listening...');
        return;
      }

      interviewDigestRef.current = turnPayload.transcript_digest;
      interviewTranscriptRef.current = nextTranscript;
      interviewTurnsRef.current = turnPayload.turns;
      setInterviewTranscript(nextTranscript);
      setInterviewTurns(turnPayload.turns);
      setBody(nextTranscript);
      setTranscriptionStatus('Listening...');

      const interviewerTurn = selectCoachTargetTurn(turnPayload.turns, nextTranscript);
      if (!interviewerTurn) {
        setTranscriptionStatus('Listening... waiting for a clear interviewer question.');
        return;
      }
      if (interviewerTurn.id === lastCoachedInterviewerTurnIdRef.current) return;
      const latestIntervieweeTurn = latestTurn('interviewee', turnPayload.turns);

      const coachRequestId = coachInFlightRequestIdRef.current + 1;
      coachInFlightRequestIdRef.current = coachRequestId;
      setInterviewGuidanceBusy(true);
      let coachDraft = '';

      await streamInterviewCoach(
        {
          latest_interviewer_turn: interviewerTurn,
          latest_interviewee_turn: latestIntervieweeTurn,
          brevity: 'short',
          provider: copilotProvider,
          model: copilotModel || undefined,
        },
        (token) => {
          if (coachRequestId !== coachInFlightRequestIdRef.current) return;
          coachDraft += token;
          setInterviewGuidance(coachDraft);
        },
      );

      if (coachRequestId !== coachInFlightRequestIdRef.current) return;
      const normalizedCoach =
        normalizeCoachText(coachDraft, 3) ||
        buildCoachFallback(interviewerTurn, latestIntervieweeTurn, 3);
      lastCoachedInterviewerTurnIdRef.current = interviewerTurn.id;
      setInterviewGuidance(normalizedCoach);
      setBody(nextTranscript);
    } catch (error) {
      setTranscriptionStatus(
        error instanceof Error ? error.message : 'Interview guidance refresh failed.',
      );
    } finally {
      interviewUpdateInFlightRef.current = false;
      setTranscriptionBusy(false);
      setInterviewGuidanceBusy(false);
    }
  }

  async function regenerateCoach(brevity: 'short' | 'one_liner') {
    if (!connectedProviders.includes(copilotProvider)) {
      setMessage('Connect an AI provider in Settings to use Interview Assist.');
      setSettingsOpen(true);
      return;
    }
    const interviewerTurn = selectCoachTargetTurn(
      interviewTurnsRef.current,
      interviewTranscriptRef.current,
    );
    if (!interviewerTurn) return;
    const intervieweeTurn = latestTurn('interviewee');

    const coachRequestId = coachInFlightRequestIdRef.current + 1;
    coachInFlightRequestIdRef.current = coachRequestId;
    setInterviewGuidanceBusy(true);
    setInterviewGuidance('');
    let coachDraft = '';

    try {
      await streamInterviewCoach(
        {
          latest_interviewer_turn: interviewerTurn,
          latest_interviewee_turn: intervieweeTurn,
          brevity,
          provider: copilotProvider,
          model: copilotModel || undefined,
        },
        (token) => {
          if (coachRequestId !== coachInFlightRequestIdRef.current) return;
          coachDraft += token;
          setInterviewGuidance(coachDraft);
        },
      );
      if (coachRequestId !== coachInFlightRequestIdRef.current) return;
      const targetLines = brevity === 'one_liner' ? 1 : 3;
      const normalized =
        normalizeCoachText(coachDraft, targetLines) ||
        buildCoachFallback(interviewerTurn, intervieweeTurn, targetLines);
      setInterviewGuidance(normalized);
      setBody(interviewTranscriptRef.current);
    } finally {
      setInterviewGuidanceBusy(false);
    }
  }

  async function copyCoachToClipboard() {
    const text = interviewGuidance.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Coach answer copied.');
    } catch {
      setMessage('Unable to copy coach answer.');
    }
  }

  useEffect(() => {
    applyEditorStateFromNote(selectedNote);
  }, [selectedNote?.frontmatter.id]);

  useEffect(() => {
    if (!selectedNote) return;
    if (pendingTitleFocusIdRef.current !== selectedNote.frontmatter.id) return;
    pendingTitleFocusIdRef.current = null;
    focusTitleInput();
  }, [selectedNote?.frontmatter.id]);

  useDebouncedEffect(
    () => {
      if (!selectedId) return;

      const current = notes.find((note) => note.frontmatter.id === selectedId);
      if (!current) return;

      const payload = {
        id: selectedId,
        title: title.trim() || 'Untitled note',
        content: noteKind === 'interview_assist' ? interviewTranscriptRef.current || body : body,
        tags,
        kind: noteKind,
        content_format: contentFormat,
        context_preset: contextPreset,
        context_text: contextText.trim() || null,
        session:
          noteKind === 'interview_assist'
            ? buildInterviewSession(
                interviewTranscriptRef.current || body,
                interviewGuidanceRef.current,
                interviewTurnsRef.current,
                noteSummaryRef.current || null,
              )
            : noteKind === 'transcript'
              ? buildTranscriptSession(body, transcriptSegmentsRef.current, noteSummaryRef.current || null)
              : null,
      };

      const unchanged =
        current.frontmatter.title === payload.title &&
        current.content === payload.content &&
        current.kind === payload.kind &&
        current.content_format === payload.content_format &&
        current.frontmatter.tags.join('|') === payload.tags.join('|') &&
        (current.frontmatter.context_preset ?? null) === payload.context_preset &&
        (current.frontmatter.context_text ?? null) === payload.context_text &&
        serializeExistingSessionForCompare(current.session ?? null) ===
          serializeSessionForCompare(noteKind, body);

      if (unchanged) return;

      setSaving(true);

      void updateNote(payload)
        .then((updated) => {
          setNotes((prev) => prev.map((note) => (note.frontmatter.id === updated.frontmatter.id ? updated : note)));
          setMessage('Saved');
        })
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : 'Save failed');
        })
        .finally(() => {
          setSaving(false);
        });
    },
    [
      selectedId,
      title,
      body,
      tags,
      noteKind,
      contentFormat,
      contextPreset,
      contextText,
      notes,
      interviewTranscript,
      interviewGuidance,
      interviewTurns,
      transcriptSegments,
      noteSummary,
    ],
    280,
  );

  async function handleCreateNote() {
    try {
      const created = await createNote({
        title: 'Untitled note',
        content: DEFAULT_BODY,
        tags: [],
        kind: 'note',
        content_format: 'markdown',
        folder_id: selectedFolderId,
        context_preset: contextPreset,
        context_text: contextText.trim() || null,
      });

      setNotes((prev) => [created, ...prev]);
      setSelectedId(created.frontmatter.id);
      setSelectedFolderId(created.frontmatter.folder_id ?? null);
      applyEditorStateFromNote(created);
      setMessage('Created a new note');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Create failed');
    }
  }

  function handleSelectNote(noteId: string) {
    const note = notes.find((entry) => entry.frontmatter.id === noteId) ?? null;
    setSelectedId(noteId);
    setSelectedFolderId(note?.frontmatter.folder_id ?? null);
  }

  function handleSelectFolder(folderId: string | null) {
    setSelectedFolderId(folderId);
    setSelectedId(null);
    applyEditorStateFromNote(null);
  }

  function handleToggleNoteSelection(noteId: string, checked: boolean) {
    setSelectedNoteIds((prev) => {
      if (checked) {
        if (prev.includes(noteId)) return prev;
        return [...prev, noteId];
      }
      return prev.filter((id) => id !== noteId);
    });
  }

  async function handleSearchChange(value: string) {
    setSearch(value);
    const loaded = await fetchNotes(value);
    setNotes(loaded);
  }

  async function handleCreateFolder(name: string) {
    if (!name.trim()) return;
    try {
      const created = await createFolder(name.trim());
      setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedFolderId(created.id);
      setSelectedId(null);
      applyEditorStateFromNote(null);
      setMessage(`Created folder "${created.name}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create folder.');
    }
  }

  async function handleRenameFolder(folderId: string, name: string) {
    if (!name.trim()) return;
    const current = folders.find((folder) => folder.id === folderId);
    if (!current || name.trim() === current.name) return;
    try {
      const updated = await renameFolder(folderId, name.trim());
      setFolders((prev) =>
        prev.map((folder) => (folder.id === updated.id ? updated : folder)).sort((a, b) => a.name.localeCompare(b.name)),
      );
      setMessage(`Renamed folder to "${updated.name}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to rename folder.');
    }
  }

  async function handleDeleteFolder(folderId: string) {
    const current = folders.find((folder) => folder.id === folderId);
    if (!current) return;
    try {
      await deleteFolder(folderId);
      const [loadedNotes, loadedFolders] = await Promise.all([fetchNotes(search), fetchFolders()]);
      setNotes(loadedNotes);
      setFolders(loadedFolders);
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      setMessage(`Deleted folder "${current.name}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete folder.');
    }
  }

  async function handleMoveNote(noteId: string, folderId: string | null) {
    try {
      const updated = await moveNote(noteId, { folder_id: folderId });
      setNotes((prev) => prev.map((note) => (note.frontmatter.id === updated.frontmatter.id ? updated : note)));
      if (selectedId === updated.frontmatter.id) {
        setSelectedFolderId(updated.frontmatter.folder_id ?? null);
      }
      setMessage(folderId ? 'Moved note.' : `Moved note to ${ROOT_FOLDER_LABEL}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to move note.');
    }
  }

  async function handleMoveSelectedNotes(folderId: string | null) {
    if (selectedNoteIds.length === 0) return;
    try {
      const movedNotes = await Promise.all(
        selectedNoteIds.map((noteId) => moveNote(noteId, { folder_id: folderId })),
      );
      const movedById = new Map(movedNotes.map((note) => [note.frontmatter.id, note]));
      setNotes((prev) =>
        prev.map((note) => movedById.get(note.frontmatter.id) ?? note),
      );
      setSelectedNoteIds([]);
      setSelectedFolderId(folderId);
      setMessage(
        folderId
          ? `Moved ${movedNotes.length} notes.`
          : `Moved ${movedNotes.length} notes to ${ROOT_FOLDER_LABEL}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to move selected notes.');
    }
  }

  async function handleTranscriptionPreferencesPatch(
    patch: Partial<Omit<TranscriptionPreferences, 'updated_at'>>,
  ) {
    const next = {
      main_language: patch.main_language ?? transcriptionPreferences.main_language,
      spoken_languages: patch.spoken_languages ?? transcriptionPreferences.spoken_languages,
      custom_vocabulary: patch.custom_vocabulary ?? transcriptionPreferences.custom_vocabulary,
    };
    setTranscriptionPreferences((prev) => ({ ...prev, ...next }));
    try {
      const saved = await updateTranscriptionPreferences(next);
      setTranscriptionPreferences(saved);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to update transcription settings.');
      setMessage(error instanceof Error ? error.message : 'Unable to update transcription settings.');
    }
  }

  async function handleMarkdownSettingsPatch(
    patch: Partial<Omit<MarkdownSettings, 'updated_at'>>,
  ) {
    const next = {
      enable_import: patch.enable_import ?? markdownSettings.enable_import,
      enable_export: patch.enable_export ?? markdownSettings.enable_export,
      editor_mode: patch.editor_mode ?? markdownSettings.editor_mode,
    };
    setMarkdownSettings((prev) => ({ ...prev, ...next }));
    try {
      const saved = await updateMarkdownSettings(next);
      setMarkdownSettings(saved);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to update markdown settings.');
      setMessage(error instanceof Error ? error.message : 'Unable to update markdown settings.');
    }
  }

  function handleRenameNote(noteId?: string) {
    if (noteId && noteId !== selectedId) {
      pendingTitleFocusIdRef.current = noteId;
      setSelectedId(noteId);
      return;
    }
    focusTitleInput();
  }

  async function finalizePendingDelete(pending: PendingDeleteState) {
    try {
      await deleteNote(pending.note.frontmatter.id);
      setMessage(`Deleted "${pending.note.frontmatter.title || 'Untitled note'}".`);
    } catch (error) {
      setNotes((prev) => {
        const next = [...prev];
        next.splice(Math.min(pending.index, next.length), 0, pending.note);
        return next;
      });
      setSelectedId(pending.note.frontmatter.id);
      applyEditorStateFromNote(pending.note);
      setMessage(error instanceof Error ? error.message : 'Unable to delete note.');
    } finally {
      setPendingDelete((currentPending) =>
        currentPending?.note.frontmatter.id === pending.note.frontmatter.id ? null : currentPending,
      );
      if (deleteUndoTimerRef.current !== null) {
        window.clearTimeout(deleteUndoTimerRef.current);
        deleteUndoTimerRef.current = null;
      }
    }
  }

  function handleDeleteNote(noteId: string) {
    const targetIndex = notes.findIndex((note) => note.frontmatter.id === noteId);
    if (targetIndex < 0) return;
    const target = notes[targetIndex]!;

    if (pendingDelete) {
      void finalizePendingDelete(pendingDelete);
    }

    const remainingNotes = notes.filter((note) => note.frontmatter.id !== noteId);
    setPendingDelete({ note: target, index: targetIndex });
    setNotes(remainingNotes);
    setSelectedNoteIds((prev) => prev.filter((id) => id !== noteId));

    if (selectedId === noteId) {
      const nextSelection = remainingNotes[targetIndex] ?? remainingNotes[targetIndex - 1] ?? null;
      setSelectedId(nextSelection?.frontmatter.id ?? null);
      applyEditorStateFromNote(nextSelection);
    }

    setMessage(`Deleted "${target.frontmatter.title || 'Untitled note'}". Undo?`);

    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
    }
    deleteUndoTimerRef.current = window.setTimeout(() => {
      void finalizePendingDelete({ note: target, index: targetIndex });
    }, DELETE_UNDO_MS);
  }

  function undoDeleteNote() {
    if (!pendingDelete) return;
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }
    setNotes((prev) => {
      const next = [...prev];
      next.splice(Math.min(pendingDelete.index, next.length), 0, pendingDelete.note);
      return next;
    });
    setSelectedId(pendingDelete.note.frontmatter.id);
    applyEditorStateFromNote(pendingDelete.note);
    setPendingDelete(null);
    setMessage('Delete undone.');
  }

  function dismissPendingDelete() {
    if (!pendingDelete) return;
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }
    void finalizePendingDelete(pendingDelete);
  }

  async function runCopilotChat() {
    if (!selectedId || !selectedNote || !copilotChatDraft.trim()) return;
    if (!connectedProviders.includes(copilotProvider)) {
      setMessage('Connect an AI provider in Settings before using Copilot chat.');
      setSettingsOpen(true);
      return;
    }

    const question = copilotChatDraft.trim();
    const history: CopilotChatMessage[] = [
      ...copilotChatHistory,
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
    ];
    setCopilotChatHistory(history);
    setCopilotChatDraft('');
    setCopilotChatBusy(true);
    copilotChatAbortRef.current?.abort();
    const abortController = new AbortController();
    copilotChatAbortRef.current = abortController;

    let answer = '';
    try {
      await streamCopilotChat(
        {
          question,
          content: buildTransformContent(selectedNote, body),
          history: copilotChatHistory,
          note_context: buildCurrentNoteContext(),
          provider: copilotProvider,
          model: copilotModel || undefined,
        },
        (token) => {
          answer += token;
          setCopilotChatHistory((prev) => {
            const next = [...prev];
            if (next.length === 0) return next;
            next[next.length - 1] = { role: 'assistant', content: answer };
            return next;
          });
        },
        abortController.signal,
      );
      setMessage('Copilot response ready.');
    } catch (error) {
      if (isAbortError(error)) {
        if (!answer.trim()) {
          setCopilotChatHistory((prev) => prev.filter((_, index) => index < prev.length - 1));
        }
        setMessage('Copilot request stopped.');
      } else {
        setCopilotChatHistory((prev) => prev.filter((_, index) => index < prev.length - 1));
        setMessage(error instanceof Error ? error.message : 'Copilot chat failed.');
      }
    } finally {
      setCopilotChatBusy(false);
      copilotChatAbortRef.current = null;
    }
  }

  async function runTransform(action: 'summarize' | 'rewrite' | 'extract_action_items') {
    if (!selectedId) return;
    if (!connectedProviders.includes(copilotProvider)) {
      setMessage('Connect an AI provider in Settings before running Copilot.');
      setSettingsOpen(true);
      return;
    }

    setBusy(true);
    setActiveTransformAction(action);
    setAiOutput('');
    if (action === 'summarize' && (noteKind === 'transcript' || noteKind === 'interview_assist')) {
      setTranscriptViewTab('summary');
      setMessage('Generating summary...');
    } else {
      setMessage('Running Copilot...');
    }
    transformAbortRef.current?.abort();
    const abortController = new AbortController();
    transformAbortRef.current = abortController;
    let nextOutput = '';

    try {
      await streamTransform(
        selectedId,
        buildTransformContent(selectedNote, body),
        action,
        (token) => {
          nextOutput += token;
          setAiOutput(nextOutput);
        },
        'concise',
        copilotProvider,
        copilotModel || undefined,
        buildTransformNoteContext(action),
        abortController.signal,
      );

      if (action === 'summarize' && (noteKind === 'transcript' || noteKind === 'interview_assist')) {
        const summary = nextOutput.trim();
        setNoteSummary(summary);
        if (noteKind === 'transcript') {
          setTranscriptViewTab('summary');
        }
        setMessage(summary ? 'Summary saved.' : 'Summary is empty.');
      } else {
        setMessage('AI transform complete');
      }
    } catch (error) {
      if (isAbortError(error)) {
        setMessage('Copilot request stopped.');
      } else {
        setMessage(error instanceof Error ? error.message : 'AI transform failed');
      }
    } finally {
      setBusy(false);
      setActiveTransformAction(null);
      transformAbortRef.current = null;
    }
  }

  async function handleSaveByok() {
    if (!byokValue.trim()) {
      setSettingsError('Enter an API key before saving.');
      setMessage('Enter an API key before saving.');
      return;
    }

    setByokSubmitting(true);
    clearSettingsFeedback();
    try {
      await storeByok(byokProvider, byokValue.trim());
      setByokValue('');
      const statuses = await fetchProviderStatus();
      mergeProviderStatuses(statuses);
      void loadProviderModels(byokProvider, 'copilot');
      void loadProviderModels(byokProvider, 'transcription');
      setSettingsSuccess('Provider key saved locally on this device.');
      setMessage('Provider key saved locally on this device.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to save key');
      setMessage(error instanceof Error ? error.message : 'Unable to save key');
    } finally {
      setByokSubmitting(false);
    }
  }

  async function handleDisconnectProvider(provider: ProviderId) {
    clearSettingsFeedback();
    setProviderDisconnecting(provider);
    try {
      await disconnectProvider(provider);
      const statuses = await fetchProviderStatus();
      mergeProviderStatuses(statuses);
      setProviderModelsError((prev) => ({
        ...prev,
        [`${provider}:copilot`]: '',
        [`${provider}:transcription`]: '',
      }));
      const successMessage = `Removed ${provider} key from this device.`;
      setSettingsSuccess(successMessage);
      setMessage(successMessage);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to disconnect provider');
      setMessage(error instanceof Error ? error.message : 'Unable to disconnect provider');
    } finally {
      setProviderDisconnecting(null);
    }
  }

  async function applyDesktopSession(session: SupabaseSessionPayload) {
    const rendererSession =
      (await window.notebookDesktop?.saveAuthSession?.(session)) ?? {
        accessToken: session.access_token,
        expiresAt: session.expires_at ?? null,
        userId: session.user.id,
        userEmail: session.user.email ?? null,
      };
    applyRendererSession(rendererSession);
  }

  async function finishDesktopAuth(rawUrl: string): Promise<boolean> {
    setMessage('Finishing desktop sign in...');
    const session = await completeDesktopAuthCallback(rawUrl);
    if (!session?.user?.id) {
      setAuthPending(false);
      setMessage('Desktop opened, but sign-in could not be completed. Click Sign In again.');
      return false;
    }
    await applyDesktopSession(session);
    return true;
  }

  async function handleStartDesktopSignIn() {
    if (authBusy) return;
    if (authPending && !sessionUserId) {
      if (manualSignInUrl) {
        try {
          if (window.notebookDesktop?.openExternal) {
            await window.notebookDesktop.openExternal(manualSignInUrl);
          } else {
            window.open(manualSignInUrl, '_blank', 'noopener,noreferrer');
          }
          setMessage('Re-opened sign-in in browser. Complete auth there.');
        } catch {
          setMessage('Sign-in is still pending in browser. Complete auth to continue.');
        }
      } else {
        setMessage('Sign-in is in progress. Complete auth in your browser.');
      }
      return;
    }
    setManualSignInUrl(null);
    authCallbackInFlightRef.current = null;
    lastHandledAuthCallbackRef.current = null;
    setAuthBusy(true);
    try {
      const { url, browserOpened } = await startDesktopGoogleSignIn();
      setManualSignInUrl(url);
      setAuthPending(true);
      if (browserOpened) {
        setMessage('Complete sign in in browser. Desktop will continue automatically.');
      } else {
        setMessage('Browser did not open automatically. Use Open Sign-In Page below.');
      }
    } catch (error) {
      const fallback = 'Unable to start desktop sign in.';
      setManualSignInUrl(null);
      if (error instanceof Error) {
        setMessage(error.message || fallback);
      } else {
        setMessage(fallback);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSendMagicLink() {
    if (authBusy) return;
    authCallbackInFlightRef.current = null;
    lastHandledAuthCallbackRef.current = null;
    setAuthBusy(true);
    try {
      await sendDesktopMagicLink(magicLinkEmail);
      setAuthPending(true);
      setManualSignInUrl(null);
      setMessage('Magic link sent. Open your email and continue sign in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send magic link.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDesktopAuthCallback(rawUrl: string) {
    if (authCallbackInFlightRef.current === rawUrl || lastHandledAuthCallbackRef.current === rawUrl) {
      return;
    }
    authCallbackInFlightRef.current = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.host === 'open') {
        setMessage('Desktop app opened.');
        lastHandledAuthCallbackRef.current = rawUrl;
        return;
      }
      const completed = await finishDesktopAuth(rawUrl);
      if (!completed) {
        return;
      }
      lastHandledAuthCallbackRef.current = rawUrl;
      setMessage('Signed in. Desktop is ready.');
    } catch (error) {
      setAuthPending(false);
      setMessage(error instanceof Error ? error.message : 'Desktop sign in failed');
    } finally {
      if (authCallbackInFlightRef.current === rawUrl) {
        authCallbackInFlightRef.current = null;
      }
    }
  }

  async function handleOpenManualSignIn() {
    if (!manualSignInUrl) return;
    try {
      if (window.notebookDesktop?.openExternal) {
        await window.notebookDesktop.openExternal(manualSignInUrl);
      } else {
        window.open(manualSignInUrl, '_blank', 'noopener,noreferrer');
      }
      setMessage('Opened sign-in in your default browser.');
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? `Unable to open browser automatically: ${error.message}`
          : 'Unable to open the sign-in page automatically. Copy the sign-in URL below.',
      );
    }
  }

  async function handleCopyManualSignInUrl() {
    if (!manualSignInUrl) return;
    try {
      await navigator.clipboard.writeText(manualSignInUrl);
      setMessage('Copied the sign-in URL. Paste it into your browser.');
    } catch {
      setMessage('Unable to copy automatically. Select the URL below and open it in your browser.');
    }
  }

  async function handleStorageModeChange(mode: StoragePreference['mode']) {
    setStorageBusy(true);
    clearSettingsFeedback();
    try {
      const updated = await updateStoragePreference(mode);
      setStoragePreference(updated);
      const sync = await fetchSyncStatus();
      setSyncStatus(sync);
      if (mode === 'local_and_drive') {
        const drive = await fetchGoogleDriveStatus().catch(() => DEFAULT_DRIVE_STATUS);
        setDriveStatus(drive);
        const successMessage = drive.connected
          ? describeSyncStatus(sync, drive.folder_name || 'Notebook AI')
          : 'Drive mirror enabled. Connect Google Drive to start mirroring.';
        setSettingsSuccess(successMessage);
        setMessage(successMessage);
      } else {
        setSettingsSuccess('Local-only storage enabled.');
        setMessage('Local-only storage enabled.');
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to update storage preference');
      setMessage(error instanceof Error ? error.message : 'Unable to update storage preference');
    } finally {
      setStorageBusy(false);
    }
  }

  async function handleLogout() {
    if (!sessionUserId || logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logoutCloudSession().catch(() => {
        /* ignore logout failures for expired sessions */
      });
      await window.notebookDesktop.clearAuthSession?.();
      authCallbackInFlightRef.current = null;
      lastHandledAuthCallbackRef.current = null;
      setSessionUserId(null);
      setAuthPending(false);
      setManualSignInUrl(null);
      setShowSplash(true);
      setSettingsOpen(false);
      setMessage('Signed out successfully.');
    } finally {
      setLogoutBusy(false);
    }
  }

  async function handleRefreshDriveStatus() {
    setDriveStatusBusy(true);
    try {
      const status = await fetchGoogleDriveStatus();
      setDriveStatus(status);
      if (status.connected && storagePreference.mode === 'local_and_drive') {
        setSyncStatus((prev) => ({
          enabled: prev?.enabled ?? true,
          pending_ops: prev?.pending_ops ?? 0,
          state: 'syncing',
          phase: 'preparing',
          current_item: 'Checking Drive mirror',
          completed_items: 0,
          total_items: Math.max(prev?.pending_ops ?? prev?.total_items ?? 1, 1),
          last_run_at: prev?.last_run_at ?? null,
          last_synced_at: prev?.last_synced_at ?? null,
          last_error: null,
        }));
        const sync = await runSyncNow();
        setSyncStatus(sync);
        setMessage(describeSyncStatus(sync, status.folder_name || 'Notebook AI'));
        return;
      }
      setMessage(
        status.connected
          ? `Google Drive connected (${status.folder_name || 'Notebook AI'}).`
          : 'Google Drive is not connected yet.',
      );
    } catch (error) {
      setSyncStatus((prev) =>
        prev
          ? {
              ...prev,
              state: 'error',
              phase: 'idle',
              current_item: null,
              last_error: error instanceof Error ? error.message : 'Unable to load Google Drive status',
            }
          : prev,
      );
      setMessage(error instanceof Error ? error.message : 'Unable to load Google Drive status');
    } finally {
      setDriveStatusBusy(false);
    }
  }

  async function pollForDriveConnection() {
    if (driveConnectPollingRef.current) return;
    driveConnectPollingRef.current = true;
    setDriveStatusBusy(true);
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await fetchGoogleDriveStatus().catch(() => null);
        if (status?.connected) {
          setDriveStatus(status);
          if (storagePreference.mode === 'local_and_drive') {
            setSyncStatus((prev) => ({
              enabled: prev?.enabled ?? true,
              pending_ops: prev?.pending_ops ?? 0,
              state: 'syncing',
              phase: 'preparing',
              current_item: 'Checking Drive mirror',
              completed_items: 0,
              total_items: Math.max(prev?.pending_ops ?? prev?.total_items ?? 1, 1),
              last_run_at: prev?.last_run_at ?? null,
              last_synced_at: prev?.last_synced_at ?? null,
              last_error: null,
            }));
            const sync = await runSyncNow();
            setSyncStatus(sync);
            setMessage(describeSyncStatus(sync, status.folder_name || 'Notebook AI'));
          } else {
            setMessage(`Google Drive connected (${status.folder_name || 'Notebook AI'}).`);
          }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      setMessage('Finish Google Drive approval in your browser, then click Refresh status.');
    } catch (error) {
      setSyncStatus((prev) =>
        prev
          ? {
              ...prev,
              state: 'error',
              phase: 'idle',
              current_item: null,
              last_error: error instanceof Error ? error.message : 'Unable to start Drive mirroring',
            }
          : prev,
      );
      setMessage(error instanceof Error ? error.message : 'Unable to start Drive mirroring');
    } finally {
      driveConnectPollingRef.current = false;
      setDriveStatusBusy(false);
    }
  }

  async function handleConnectGoogleDrive() {
    try {
      await openGoogleDriveConnect();
      setMessage('Approve Google Drive access in your browser. Notebook AI will start mirroring automatically.');
      void pollForDriveConnection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start Google Drive connection');
    }
  }

  async function handleChooseLocalFolder() {
    try {
      clearSettingsFeedback();
      const selected = await window.notebookDesktop?.chooseDirectory?.();
      if (!selected) return;
      const updatedPath = await setLocalRoot(selected);
      setLocalRootPath(updatedPath);
      setStoragePreference((prev) => ({ ...prev, local_root: updatedPath }));
      if (storagePreference.mode === 'local_and_drive') {
        const sync = await fetchSyncStatus().catch(() => null);
        if (sync) {
          setSyncStatus(sync);
          const successMessage = `Local folder updated. ${describeSyncStatus(sync, driveStatus.folder_name || 'Notebook AI')}`;
          setSettingsSuccess(successMessage);
          setMessage(successMessage);
        } else {
          setSettingsSuccess('Local folder updated. Reconciling with Google Drive...');
          setMessage('Local folder updated. Reconciling with Google Drive...');
        }
      } else {
        setSettingsSuccess('Local storage folder updated.');
        setMessage('Local storage folder updated.');
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to update local folder');
      setMessage(error instanceof Error ? error.message : 'Unable to update local folder');
    }
  }

  async function handleRunSyncNow() {
    setSyncActionBusy(true);
    setStorageBusy(true);
    clearSettingsFeedback();
    try {
      setMessage('Starting Drive sync...');
      setSyncStatus((prev) => ({
        enabled: prev?.enabled ?? true,
        pending_ops: prev?.pending_ops ?? 0,
        state: 'syncing',
        phase: 'preparing',
        current_item: 'Checking Drive mirror',
        completed_items: 0,
        total_items: Math.max(prev?.pending_ops ?? prev?.total_items ?? 1, 1),
        last_run_at: prev?.last_run_at ?? null,
        last_synced_at: prev?.last_synced_at ?? null,
        last_error: null,
      }));
      const status = await runSyncNow();
      setSyncStatus(status);
      const successMessage = describeSyncStatus(status, driveStatus.folder_name || 'Notebook AI');
      setSettingsSuccess(successMessage);
      setMessage(successMessage);
    } catch (error) {
      setSyncStatus((prev) =>
        prev
          ? {
              ...prev,
              state: 'error',
              phase: 'idle',
              current_item: null,
              last_error: error instanceof Error ? error.message : 'Unable to run sync',
            }
          : prev,
      );
      setSettingsError(error instanceof Error ? error.message : 'Unable to run sync');
      setMessage(error instanceof Error ? error.message : 'Unable to run sync');
    } finally {
      setSyncActionBusy(false);
      setStorageBusy(false);
    }
  }

  function stopCaptureTracks() {
    clearInterviewSegmentTimer();
    captureActiveRef.current = false;
    for (const track of captureStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    for (const track of audioStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    for (const track of micStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
    }
    captureStreamRef.current = null;
    audioStreamRef.current = null;
    micStreamRef.current = null;
    micGainNodeRef.current = null;
    audioContextRef.current = null;
    recorderRef.current = null;
  }

  function stopRecording() {
    clearInterviewSegmentTimer();
    captureActiveRef.current = false;
    interviewSegmentQueueRef.current = [];
    coachInFlightRequestIdRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.requestData();
      } catch {
        /* ignore */
      }
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    stopCaptureTracks();
    setRecording(false);
    setTranscriptionStatus('Capture stopped');
    setInterviewGuidanceBusy(false);
    setTranscriptionBusy(false);
  }

  function buildAudioRecorder(inputStream: MediaStream): MediaRecorder {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const selectedMime = preferred.find(
      (candidate) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate),
    );
    return selectedMime
      ? new MediaRecorder(inputStream, { mimeType: selectedMime })
      : new MediaRecorder(inputStream);
  }

  function createSourceRecorderHandle(
    sourceHint: Extract<SourceHint, 'me' | 'other_audio'>,
    inputStream: MediaStream,
  ): SourceRecorderHandle {
    const recorder = buildAudioRecorder(inputStream);
    const chunks: Blob[] = [];
    let resolveDone: ((blob: Blob) => void) | null = null;
    const done = new Promise<Blob>((resolve) => {
      resolveDone = resolve;
    });

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      chunks.push(event.data);
    };
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = chunks.length <= 1 ? chunks[0] ?? new Blob([], { type: mimeType }) : new Blob(chunks, { type: mimeType });
      resolveDone?.(blob);
    };

    return { sourceHint, recorder, chunks, done };
  }

  async function beginTranscriptionSession(
    recorder: MediaRecorder,
    options: {
      listeningStatus: string;
      shareStream: MediaStream | null;
      transcriptionEngine: TranscriptionEngine;
      sessionMode: CaptureSessionMode;
      sourceRecorderHandles?: SourceRecorderHandle[];
      mixedSources?: boolean;
    },
  ) {
    const {
      listeningStatus,
      shareStream,
      transcriptionEngine,
      sessionMode,
      sourceRecorderHandles = [],
      mixedSources = false,
    } = options;

    recorderRef.current = recorder;
    transcriptionEngineSessionRef.current = transcriptionEngine;
    sessionModeRef.current = sessionMode;
    captureActiveRef.current = true;
    setActiveSessionMode(sessionMode);
    recordedAudioChunksRef.current = [];
    interviewSegmentQueueRef.current = [];
    interviewSegmentProcessingRef.current = false;
    interviewSegmentChunksRef.current = [];
    nextInterviewSegmentIdRef.current = 1;
    interviewRecoverableFailureCountRef.current = 0;
    interviewTranscriptRef.current = '';
    interviewTurnsRef.current = [];
    interviewDigestRef.current = '';
    lastCoachedInterviewerTurnIdRef.current = null;
    coachInFlightRequestIdRef.current += 1;
    interviewGuidanceRef.current = '';
    shouldAutoScrollInterviewRef.current = true;
    setShowJumpToLatest(false);
    setCandidateMuted(false);
    setInterviewTranscript('');
    setInterviewTurns([]);
    setInterviewGuidance('');
    setInterviewGuidanceBusy(false);
    setTranscriptSegments([]);

    const transcriptTitle =
      sessionMode === 'interview_assist'
        ? `Interview Assist ${new Date().toLocaleTimeString()}`
        : `Transcript ${new Date().toLocaleTimeString()}`;
    const initialBody = '';
    const created = await createNote({
      title: transcriptTitle,
      content: initialBody,
      tags: sessionMode === 'interview_assist' ? ['interview-assist', 'transcript'] : ['transcript'],
      kind: sessionMode === 'interview_assist' ? 'interview_assist' : 'transcript',
      content_format: 'plain_text',
      context_preset: contextPreset,
      context_text: contextText.trim() || null,
      session:
        sessionMode === 'interview_assist'
          ? buildInterviewSession('', '', [])
          : buildTranscriptSession('', []),
    });
    setNotes((prev) => [created, ...prev]);
    setSelectedId(created.frontmatter.id);
    applyEditorStateFromNote(created);
    autoEnhanceNoteIdRef.current = created.frontmatter.id;

    setRecording(true);
    setTranscriptionStatus(listeningStatus);

    const appendTranscriptChunk = (chunkText: string) => {
      const normalized = chunkText.trim();
      if (!normalized) return;

      setBody((prev) => `${prev}${prev.trim().length === 0 ? '' : ' '}${normalized}`);
    };
    if (sessionMode === 'interview_assist') {
      attachInterviewRecorderHandlers(recorder, transcriptionEngine);
    } else {
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        recordedAudioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        setRecording(false);
        clearInterviewSegmentTimer();
        const chunks = recordedAudioChunksRef.current;
        recordedAudioChunksRef.current = [];
        const mimeType = recorder.mimeType || 'audio/webm';
        const merged = chunks.length === 1 ? chunks[0]! : new Blob(chunks, { type: mimeType });

        if (merged.size === 0) {
          setTranscriptionStatus('No audio captured.');
          return;
        }
        if (transcriptionEngine === 'llm' && !connectedProviders.includes(llmTranscriptionProvider)) {
          setTranscriptionStatus('Connect a provider in Settings to use Detailed transcription.');
          return;
        }

        setTranscriptionBusy(true);
        setTranscriptionStatus(
          'Finalizing transcript...',
        );

        for (const handle of sourceRecorderHandles) {
          if (handle.recorder.state === 'recording') {
            try {
              handle.recorder.requestData();
            } catch {
              /* ignore */
            }
            handle.recorder.stop();
          }
        }

        void transcribeAudioChunk(
          merged,
          activeTranscriptionProvider,
          transcriptionEngine,
          undefined,
          activeTranscriptionModel || undefined,
          {
            contextPreset: contextPreset,
            contextText,
            sourceHint:
              sourceRecorderHandles.length === 0
                ? (mixedSources ? 'unknown' : shareStream ? 'other_audio' : 'me')
                : 'unknown',
          },
        )
          .then(async (result) => {
            let nextSegments: TranscriptSegment[] = [];
            if (sourceRecorderHandles.length > 0) {
              const segmentResults = await Promise.all(
                sourceRecorderHandles.map(async (handle, index) => {
                  const sourceBlob = await handle.done;
                  if (sourceBlob.size === 0) return null;
                  const sourceResult = await transcribeAudioChunk(
                    sourceBlob,
                    activeTranscriptionProvider,
                    transcriptionEngine,
                    undefined,
                    activeTranscriptionModel || undefined,
                    {
                      contextPreset,
                      contextText,
                      sourceHint: handle.sourceHint,
                    },
                  );
                  const text = sourceResult.text.trim();
                  if (!text) return null;
                  return {
                    id: `segment-${index + 1}-${handle.sourceHint}`,
                    text,
                    source_hint: handle.sourceHint,
                  } satisfies TranscriptSegment;
                }),
              );
              nextSegments = segmentResults.filter(
                (segment): segment is NonNullable<typeof segment> => segment !== null,
              );
            } else if (mixedSources && result.text.trim()) {
              nextSegments = [
                {
                  id: 'segment-1',
                  text: result.text.trim(),
                  source_hint: shareStream ? 'other_audio' : 'me',
                },
              ];
            }

            if (nextSegments.length > 0) {
              const transcriptText =
                result.text.trim() || nextSegments.map((segment) => segment.text.trim()).filter(Boolean).join('\n\n');
              setTranscriptSegments(nextSegments);
              setBody(transcriptText);
              setTranscriptionStatus('Transcript ready.');
              return;
            }

            if (result.text.trim()) {
              appendTranscriptChunk(result.text);
              setTranscriptionStatus('Transcript ready.');
            } else if (result.detail) {
              setTranscriptionStatus(result.detail);
            } else {
              setTranscriptionStatus(
                transcriptionEngine === 'llm'
                  ? 'Detailed mode returned no text for this recording.'
                  : 'Fast mode returned no text for this recording.',
              );
            }
          })
          .catch((error: unknown) => {
            setTranscriptionStatus(
              error instanceof Error
                ? error.message
                : transcriptionEngine === 'llm'
                  ? 'Detailed transcription failed.'
                  : 'Fast transcription failed.',
            );
          })
          .finally(() => {
            setTranscriptionBusy(false);
          });
      };
    }

    const endOnStop = () => {
      stopRecording();
    };

    const videoTrack = shareStream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', endOnStop);
    } else {
      const micTrack = recorder.stream.getAudioTracks()[0];
      micTrack?.addEventListener('ended', endOnStop);
    }

    for (const handle of sourceRecorderHandles) {
      handle.recorder.start();
    }
    recorder.start();
    if (sessionMode === 'interview_assist') {
      scheduleInterviewSegmentRollover();
    }
  }

  async function startRecording(
    mode: CaptureMode,
    transcriptionEngine: TranscriptionEngine,
    sessionMode: CaptureSessionMode,
  ) {
    if (recording) return;

    if (mode === 'mic') {
      setTranscriptionStatus('Requesting microphone permission...');
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (micStream.getAudioTracks().length === 0) {
          for (const track of micStream.getTracks()) track.stop();
          throw new Error('No microphone track available.');
        }

        captureStreamRef.current = null;
        micStreamRef.current = micStream;
        const audioContext = new AudioContext();
        await audioContext.resume();
        const destination = audioContext.createMediaStreamDestination();
        const micSource = audioContext.createMediaStreamSource(micStream);
        const micGain = audioContext.createGain();
        micGain.gain.value = candidateMutedRef.current ? 0 : 1;
        micSource.connect(micGain);
        micGain.connect(destination);

        audioStreamRef.current = destination.stream;
        audioContextRef.current = audioContext;
        micGainNodeRef.current = micGain;

        const recorder = buildAudioRecorder(destination.stream);
        await beginTranscriptionSession(recorder, {
          listeningStatus:
            sessionMode === 'interview_assist'
              ? 'Interview Assist: listening to microphone...'
              : 'Listening to microphone...',
          shareStream: null,
          transcriptionEngine,
          sessionMode,
          mixedSources: false,
        });
      } catch (error) {
        stopCaptureTracks();
        setRecording(false);
        setTranscriptionBusy(false);
        setTranscriptionStatus(
          error instanceof Error ? error.message : 'Unable to start microphone capture.',
        );
      }
      return;
    }

    setTranscriptionStatus('Requesting screen/audio permission...');

    try {
      const captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = captureStream.getAudioTracks();
      if (audioTracks.length === 0) {
        for (const track of captureStream.getTracks()) track.stop();
        throw new Error('No system audio track detected. Enable system audio in the share dialog.');
      }

      const systemAudioStream = new MediaStream(audioTracks);
      let micStream: MediaStream | null = null;
      let micEnabled = false;

      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        micEnabled = (micStream.getAudioTracks().length ?? 0) > 0;
      } catch {
        micStream = null;
      }

      const audioContext = new AudioContext();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();

      const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
      systemSource.connect(destination);

      let micGainNode: GainNode | null = null;
      if (micStream && micEnabled) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micGainNode = audioContext.createGain();
        micGainNode.gain.value = candidateMutedRef.current ? 0 : 1;
        micSource.connect(micGainNode);
        micGainNode.connect(destination);
      }

      const mixedAudioStream = destination.stream;
      const sourceRecorderHandles: SourceRecorderHandle[] =
        sessionMode === 'notes' && micEnabled
          ? [
              createSourceRecorderHandle('other_audio', systemAudioStream),
              ...(micStream ? [createSourceRecorderHandle('me', micStream)] : []),
            ]
          : [];

      captureStreamRef.current = captureStream;
      audioStreamRef.current = mixedAudioStream;
      micStreamRef.current = micStream;
      audioContextRef.current = audioContext;
      micGainNodeRef.current = micGainNode;

      const recorder = buildAudioRecorder(mixedAudioStream);
      await beginTranscriptionSession(recorder, {
        listeningStatus:
          sessionMode === 'interview_assist'
            ? micEnabled
              ? 'Interview Assist: listening to system audio + microphone...'
              : 'Interview Assist: listening to system audio...'
            : micEnabled
              ? 'Listening to system audio + microphone...'
              : 'Listening to system audio...',
        shareStream: captureStream,
        transcriptionEngine,
        sessionMode,
        sourceRecorderHandles,
        mixedSources: micEnabled,
      });
    } catch (error) {
      stopCaptureTracks();
      setRecording(false);
      setTranscriptionBusy(false);
      setTranscriptionStatus(
        error instanceof Error ? error.message : 'Unable to start system audio capture.',
      );
    }
  }

  useEffect(() => {
    return () => {
      if (deleteUndoTimerRef.current !== null) {
        window.clearTimeout(deleteUndoTimerRef.current);
      }
      stopCaptureTracks();
    };
  }, []);

  if (showSplash) {
    return (
      <SplashScreen
        onLogin={() => {
          void handleStartDesktopSignIn();
        }}
        onReturnToApp={() => setShowSplash(false)}
        onLogout={() => {
          void handleLogout();
        }}
        onMagicLinkEmailChange={setMagicLinkEmail}
        onSendMagicLink={() => {
          void handleSendMagicLink();
        }}
        onOpenManualSignIn={() => {
          void handleOpenManualSignIn();
        }}
        onCopyManualSignInUrl={() => {
          void handleCopyManualSignInUrl();
        }}
        authBusy={authBusy || !authReady}
        authPending={authPending}
        logoutBusy={logoutBusy}
        sessionUserId={sessionUserId}
        statusMessage={authReady ? message : 'Loading secure session...'}
        manualSignInUrl={manualSignInUrl}
        magicLinkEmail={magicLinkEmail}
        buildVersion={buildVersion}
      />
    );
  }

  const gridCols = [
    sidebarOpen ? `${sidebarWidth}px` : '48px',
    '1fr',
    aiPanelOpen ? `${aiPanelWidth}px` : '48px',
  ].join(' ');
  const coachTargetTurn = selectCoachTargetTurn(interviewTurns, interviewTranscript);
  const showMarkdownPreview =
    isMarkdownNote(selectedNote) &&
    (markdownSettings.editor_mode === 'preview' ? !showMarkdownSource : showMarkdownSource);
  const transcriptViewText = getTranscriptSession(selectedNote)?.transcript ?? body;
  const transcriptViewSegments = selectedNote?.frontmatter.id === selectedId
    ? transcriptSegments
    : (getTranscriptSession(selectedNote)?.segments ?? []);
  const showCopilotChat = showTranscriptNoteView || showInterviewNoteView;
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const detailsTagLabel = tags.length === 1 ? '1 tag' : `${tags.length} tags`;
  const detailsContextLabel = CONTEXT_PRESET_LABELS[contextPreset];


  return (
    <main className={`app-shell${isMacPlatform ? ' is-mac' : ''}`} style={{ gridTemplateColumns: gridCols }}>
      <div className="ambient-bg" />

      {/* Sidebar */}
      {sidebarOpen ? (
        <div className="panel-shell panel-shell--sidebar">
          <NoteList
            notes={notes}
            folders={folders}
            selectedId={selectedId}
            selectedFolderId={selectedFolderId}
            selectedNoteIds={selectedNoteIds}
            search={search}
            onSearchChange={(value) => {
              void handleSearchChange(value);
            }}
            onSelect={handleSelectNote}
            onSelectFolder={handleSelectFolder}
            onToggleNoteSelection={handleToggleNoteSelection}
            onMoveSelectedNotes={(folderId) => {
              void handleMoveSelectedNotes(folderId);
            }}
            onCreate={() => {
              void handleCreateNote();
            }}
            onCreateFolder={(name) => {
              void handleCreateFolder(name);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSplash={() => setShowSplash(true)}
            onCollapse={() => setSidebarOpen(false)}
            onLogout={() => {
              void handleLogout();
            }}
            onRenameNote={handleRenameNote}
            onDeleteNote={handleDeleteNote}
            onRenameFolder={(folderId, name) => {
              void handleRenameFolder(folderId, name);
            }}
            onDeleteFolder={(folderId) => {
              void handleDeleteFolder(folderId);
            }}
            onMoveNote={(noteId, folderId) => {
              void handleMoveNote(noteId, folderId);
            }}
            onClearSelectedNotes={() => setSelectedNoteIds([])}
            logoutBusy={logoutBusy}
          />
          <div
            className="panel-resizer panel-resizer--right"
            role="separator"
            aria-label="Resize notes panel"
            onPointerDown={(event) => startPanelResize('sidebar', event)}
          />
        </div>
      ) : (
        <div className="collapsed-sidebar">
          <button type="button" className="collapse-toggle" onClick={() => setSidebarOpen(true)} aria-label="Expand sidebar">
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Editor */}
      <section className="editor-panel">
        {selectedNote ? (
          <header className="editor-header">
            <div className="title-wrap">
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="title-input"
                placeholder="Untitled note"
              />
            </div>

            <div className="header-right">
              <div className="editor-header__actions">

                <button type="button" className="ghost-btn" onClick={() => handleRenameNote()}>
                  <Pencil size={14} />
                  Rename
                </button>
                <button
                  type="button"
                  className="ghost-btn danger-soft"
                  onClick={() => handleDeleteNote(selectedNote.frontmatter.id)}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
                {isMarkdownNote(selectedNote) ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setShowMarkdownSource((prev) => !prev)}
                  >
                    {showMarkdownPreview ? 'Edit note' : 'Preview note'}
                  </button>
                ) : null}
              </div>
              <span className="status-pill">{saving ? 'Saving...' : message}</span>
            </div>
          </header>
        ) : !selectedNote ? (
          <header className="editor-header editor-header--empty">
            <div className="title-wrap">
              <h2 className="editor-empty-title">No note selected</h2>
              <p className="editor-empty-copy">
                {selectedFolder
                  ? `Create a note in ${selectedFolder.name} or start a recording to capture a transcript there.`
                  : 'Create a note or start a recording to open a new transcript.'}
              </p>
            </div>
            <div className="header-right">
              <span className="status-pill">{message}</span>
            </div>
          </header>
        ) : null}

        {selectedNote ? (
          <section className={`editor-details${detailsExpanded ? ' is-expanded' : ''}`}>
            <button
              type="button"
              className="editor-details__toggle"
              aria-expanded={detailsExpanded}
              onClick={() => setDetailsExpanded((prev) => !prev)}
            >
              <div className="editor-details__copy">
                <span className="editor-details__eyebrow">Details</span>
                <strong>Tags and recording context</strong>
              </div>
              <div className="editor-details__summary">
                <span className="editor-details__summary-pill">{detailsTagLabel}</span>
                <span className="editor-details__summary-pill">{detailsContextLabel}</span>
                <ChevronRight className="editor-details__chevron" size={16} />
              </div>
            </button>
            {detailsExpanded ? (
              <div className="editor-details__body">
                <TagEditor
                  tags={tags}
                  draftValue={tagDraft}
                  onDraftChange={setTagDraft}
                  onCommitDraft={commitTagDraft}
                  onRemoveTag={(tag) => setTags((prev) => removeTag(prev, tag))}
                  onRemoveLastTag={() =>
                    setTags((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev))
                  }
                />
                <NoteContextEditor
                  preset={contextPreset}
                  text={contextText}
                  onPresetChange={setContextPreset}
                  onTextChange={setContextText}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {storagePreference.mode === 'local_and_drive' ? (
          <div className="sync-banner-wrap">
            <SyncStatusBanner
              syncStatus={syncStatus}
              driveFolderName={driveStatus.folder_name || 'Notebook AI'}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        ) : null}

          <div className="transcription-anchor transcription-anchor--floating">
            <TranscriptionPanel
              recording={recording}
              busy={transcriptionBusy}
              status={transcriptionStatus}
              contextPreset={contextPreset}
              contextText={contextText}
              onStart={(opts) => {
                void startRecording(opts.captureMode, transcriptionEngine, opts.mode);
              }}
              onStop={stopRecording}
              onModeChange={setActiveSessionMode}
            />
          </div>

        {!selectedNote ? (
          <section className="note-empty-panel">
            <h3>{selectedFolder ? `${selectedFolder.name}` : 'No note selected'}</h3>
            <p>
              {selectedFolder
                ? `This folder is selected. Create a new note here or move selected notes into it from the sidebar.`
                : 'Create a new note, open an existing one, or start recording to capture a transcript.'}
            </p>
            <div className="note-empty-panel__context">
              <h4>Next recording context</h4>
              <p>Set this before you start a transcript so Copilot and summaries know what the audio is about.</p>
              <NoteContextEditor
                preset={contextPreset}
                text={contextText}
                onPresetChange={setContextPreset}
                onTextChange={setContextText}
              />
            </div>
            <button
              type="button"
              className="solid-btn"
              onClick={() => {
                void handleCreateNote();
              }}
            >
              Create Note
            </button>
          </section>
        ) : showInterviewNoteView ? (
          <section className="interview-chat-screen" aria-live="polite">
            <header className="interview-chat-header">
              <div className="interview-chat-header__title">
                <h3>Interview Conversation</h3>
                <p>{title.trim() || 'Live interview note'}</p>
              </div>
              <div className="interview-chat-controls">
                <button
                  type="button"
                  className={`ghost-btn${candidateMuted ? ' danger-soft' : ''}`}
                  onClick={() => setCandidateMuted((prev) => !prev)}
                >
                  {candidateMuted ? 'Unmute Mic' : 'Mute My Mic'}
                </button>
                <span className="status-pill">{candidateMuted ? 'Muted (M)' : 'Live mic (M)'}</span>
                <span className="status-pill">
                  {recording ? (interviewGuidanceBusy ? 'Coach thinking' : 'Live') : 'Idle'}
                </span>
              </div>
            </header>

            <article className="teleprompter-card teleprompter-sticky">
              <div className="teleprompter-header">
                <h4>Say This Next</h4>
                <div className="teleprompter-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      void copyCoachToClipboard();
                    }}
                    disabled={!interviewGuidance.trim()}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      void regenerateCoach('one_liner');
                    }}
                    disabled={interviewGuidanceBusy || !coachTargetTurn}
                  >
                    Shorter
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      void regenerateCoach('short');
                    }}
                    disabled={interviewGuidanceBusy || !coachTargetTurn}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
              <div className="teleprompter-body">
                {interviewGuidance || COACH_PLACEHOLDER}
              </div>
            </article>

            {showJumpToLatest ? (
              <div className="interview-thread-jump-wrap">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={jumpInterviewThreadToLatest}
                >
                  Jump to latest
                </button>
              </div>
            ) : null}

            <div
              ref={interviewThreadRef}
              className="interview-chat-thread"
              onScroll={handleInterviewThreadScroll}
            >
              {interviewTurns.length === 0 ? (
                <div className="interview-chat-empty">
                  {recording
                    ? 'Listening... conversation will appear here as interviewer/interviewee turns.'
                    : 'Choose Interview Assist and press Start to open live conversation coaching.'}
                </div>
              ) : (
                interviewTurns.map((turn) => (
                  <article key={turn.id} className={`chat-bubble ${turn.role}`}>
                    <div className="chat-bubble-role">
                      {turn.role === 'interviewer'
                        ? 'Interviewer'
                        : 'Interviewee'}
                    </div>
                    <div className="chat-bubble-content">{turn.text}</div>
                  </article>
                ))
              )}
              <div ref={interviewBottomSentinelRef} className="interview-thread-bottom-sentinel" />
            </div>
          </section>
        ) : showTranscriptNoteView ? (
          <TranscriptSessionView
            title={title}
            transcript={transcriptViewText}
            segments={transcriptViewSegments}
            summary={noteSummary}
            summaryBusy={busy && activeTransformAction === 'summarize'}
            activeTab={transcriptViewTab}
            contextPreset={contextPreset}
            contextText={contextText}
            connectedProviders={connectedProviders}
            transcriptionEngine={transcriptionEngine}
            transcriptionProvider={activeTranscriptionProvider}
            transcriptionModel={activeTranscriptionModel}
            transcriptionModels={transcriptionModelOptions}
            transcriptionModelsLoading={transcriptionModelsLoading}
            transcriptionModelsError={transcriptionModelsError}
            copilotProvider={copilotProvider}
            copilotModel={copilotModel}
            copilotModels={copilotModelOptions}
            copilotModelsLoading={copilotModelsLoading}
            copilotModelsError={copilotModelsError}
            onTranscriptionEngineChange={handleTranscriptionEngineChange}
            onTranscriptionProviderChange={setLlmTranscriptionProvider}
            onTranscriptionModelChange={(model) => {
              if (transcriptionEngine === 'whisper') {
                setWhisperTranscriptionModel(model);
                return;
              }
              setLlmTranscriptionModel(model);
            }}
            onCopilotProviderChange={setCopilotProvider}
            onCopilotModelChange={setCopilotModel}
            onTabChange={setTranscriptViewTab}
            onSummaryChange={setNoteSummary}
          />
        ) : showMarkdownPreview ? (
          <section className="note-preview-panel">
            <header className="note-preview-panel__header">
              <h3>Markdown Preview</h3>
              <span className="status-pill">Rendered markdown</span>
            </header>
            <MarkdownPreview content={body} />
          </section>
        ) : (
          <RichMarkdownEditor value={body} onChange={setBody} placeholder="Write your thoughts here..." />
        )}
      </section>

      {/* AI Copilot - Right Rail */}
      {aiPanelOpen ? (
        <div className="panel-shell panel-shell--right-rail">
          <div
            className="panel-resizer panel-resizer--left"
            role="separator"
            aria-label="Resize AI Copilot panel"
            onPointerDown={(event) => startPanelResize('ai', event)}
          />
          <aside className="right-rail">
            <div className="right-rail__header">
              <button type="button" className="collapse-toggle" onClick={() => setAiPanelOpen(false)} aria-label="Collapse AI panel">
                <PanelRightClose size={16} />
              </button>
            </div>
            <AIActionPanel
              output={aiOutput}
              running={busy}
              runningAction={activeTransformAction}
              onRun={(action) => void runTransform(action)}
              onStopTransform={() => transformAbortRef.current?.abort()}
              transcriptChatEnabled={showCopilotChat}
              chatDraft={copilotChatDraft}
              chatHistory={copilotChatHistory}
              chatBusy={copilotChatBusy}
              onChatDraftChange={setCopilotChatDraft}
              onSendChat={() => {
                void runCopilotChat();
              }}
              onStopChat={() => copilotChatAbortRef.current?.abort()}
              onClearChat={() => {
                setCopilotChatHistory([]);
                setCopilotChatDraft('');
              }}
            />
          </aside>
        </div>
      ) : (
        <div className="collapsed-rail">
          <button type="button" className="collapse-toggle vertical" onClick={() => setAiPanelOpen(true)} aria-label="Expand AI panel">
            <Sparkles size={16} />
            <span>AI</span>
          </button>
        </div>
      )}

      {pendingDelete ? (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{pendingDelete.note.frontmatter.title || 'Untitled note'} deleted.</span>
          <div className="undo-toast__actions">
            <button type="button" className="ghost-btn" onClick={undoDeleteNote}>
              Undo
            </button>
            <button type="button" className="ghost-btn ghost-btn--icon" onClick={dismissPendingDelete} aria-label="Dismiss delete message">
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}

      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          clearSettingsFeedback();
          setSettingsOpen(false);
        }}
        settingsFeedback={settingsFeedback}
        onClearSettingsFeedback={clearSettingsFeedback}
        providers={providers}
        byokProvider={byokProvider}
        byokValue={byokValue}
        byokSubmitting={byokSubmitting}
        onByokProviderChange={(value) => {
          clearSettingsFeedback();
          setByokProvider(value);
        }}
        onByokValueChange={setByokValue}
        onSaveByok={() => {
          void handleSaveByok();
        }}
        disconnectingProvider={providerDisconnecting}
        onDisconnectProvider={(p) => {
          void handleDisconnectProvider(p);
        }}
        connectedProviders={connectedProviders}
        copilotProvider={copilotProvider}
        copilotModel={copilotModel}
        copilotModels={copilotModelOptions}
        copilotModelsLoading={copilotModelsLoading}
        copilotModelsError={copilotModelsError}
        onCopilotProviderChange={setCopilotProvider}
        onCopilotModelChange={setCopilotModel}
        theme={theme}
        onThemeChange={setTheme}
        sessionUserId={sessionUserId}
        logoutBusy={logoutBusy}
        storageMode={storagePreference.mode}
        localRootPath={localRootPath}
        storageBusy={storageBusy}
        syncPendingOps={syncStatus?.pending_ops ?? 0}
        syncStatus={syncStatus}
        syncActionBusy={syncActionBusy}
        driveConnected={driveStatus.connected}
        driveFolderName={driveStatus.folder_name || 'Notebook AI'}
        driveStatusBusy={driveStatusBusy}
        onStorageModeChange={(mode) => {
          void handleStorageModeChange(mode);
        }}
        onChooseLocalFolder={() => {
          void handleChooseLocalFolder();
        }}
        onRunSyncNow={() => {
          void handleRunSyncNow();
        }}
        onLogout={() => {
          void handleLogout();
        }}
        transcriptionPreferences={transcriptionPreferences}
        onTranscriptionPreferencesChange={(patch) => {
          void handleTranscriptionPreferencesPatch(patch);
        }}
        onConnectDrive={() => {
          void handleConnectGoogleDrive();
        }}
        onRefreshDriveStatus={() => {
          void handleRefreshDriveStatus();
        }}
        transcriptionEngine={transcriptionEngine}
        transcriptionProvider={activeTranscriptionProvider}
        transcriptionModel={activeTranscriptionModel}
        transcriptionModels={transcriptionModelOptions}
        transcriptionModelsLoading={transcriptionModelsLoading}
        transcriptionModelsError={transcriptionModelsError}
        onTranscriptionEngineChange={handleTranscriptionEngineChange}
        onTranscriptionProviderChange={setLlmTranscriptionProvider}
        onTranscriptionModelChange={(model) => {
          if (transcriptionEngine === 'whisper') {
            setWhisperTranscriptionModel(model);
            return;
          }
          setLlmTranscriptionModel(model);
        }}
        markdownSettings={markdownSettings}
        onMarkdownSettingsChange={(patch) => {
          void handleMarkdownSettingsPatch(patch);
        }}
        buildVersion={buildVersion}
      />
    </main>
  );
}
