import type {
  DriveConnectionStatus,
  InterviewTurn,
  NoteDocument,
  ProviderId,
  StoragePreference,
  SyncStatus,
} from '@notebook-ai/contracts';
import { ChevronRight, PanelLeftClose, PanelRightClose, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { AIActionPanel } from './components/AIActionPanel';
import { NoteList } from './components/NoteList';
import { SettingsModal } from './components/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import {
  TranscriptionPanel,
  type CaptureMode,
  type CaptureSessionMode,
} from './components/TranscriptionPanel';
import {
  createNote,
  completeDesktopAuth,
  disconnectProvider,
  fetchInterviewTurns,
  fetchLocalRoot,
  fetchNotes,
  fetchGoogleDriveStatus,
  fetchProviderStatus,
  fetchStoragePreference,
  fetchSyncStatus,
  openOpenAIOAuth,
  pollDesktopAuthState,
  runSyncNow,
  setLocalRoot,
  startDesktopAuthFlow,
  storeByok,
  openGoogleDriveConnect,
  streamInterviewCoach,
  streamTransform,
  transcribeAudioChunk,
  updateStoragePreference,
  updateNote,
  type TranscriptionEngine,
} from './lib/api';

const DEFAULT_BODY = '# New note\n\nStart typing...';
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

export default function App() {
  const [notes, setNotes] = useState<NoteDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [tags, setTags] = useState('');
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('notebook_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [providers, setProviders] = useState<
    Array<{
      provider: 'openai' | 'openrouter';
      connected: boolean;
      via: 'oauth' | 'api_key' | 'none';
      last_updated_at?: string;
    }>
  >([]);
  const [byokProvider, setByokProvider] = useState<'openai' | 'openrouter'>('openai');
  const [byokValue, setByokValue] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(
    () => localStorage.getItem('notebook_session_user_id') ?? null,
  );
  const [pendingDesktopAuthState, setPendingDesktopAuthState] = useState<string | null>(
    () => localStorage.getItem('notebook_pending_desktop_auth_state') ?? null,
  );
  const [showSplash, setShowSplash] = useState(() => !localStorage.getItem('notebook_session_user_id'));
  const [manualSignInUrl, setManualSignInUrl] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [storagePreference, setStoragePreference] = useState<StoragePreference>({
    mode: 'local',
    local_root: null,
  });
  const [localRootPath, setLocalRootPath] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>(DEFAULT_DRIVE_STATUS);
  const [driveStatusBusy, setDriveStatusBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [byokSubmitting, setByokSubmitting] = useState(false);
  const [providerDisconnecting, setProviderDisconnecting] = useState<ProviderId | null>(null);
  const [aiOutput, setAiOutput] = useState('');
  const [message, setMessage] = useState('Ready');
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
  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngine>(() => {
    return (localStorage.getItem('notebook_transcription_engine') as TranscriptionEngine) || 'whisper';
  });

  function handleTranscriptionEngineChange(engine: TranscriptionEngine) {
    setTranscriptionEngine(engine);
    localStorage.setItem('notebook_transcription_engine', engine);
  }
  const [isMacPlatform] = useState(() => /mac/i.test(navigator.platform));
  const captureStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
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
  const candidateMutedRef = useRef(false);
  const interviewThreadRef = useRef<HTMLDivElement | null>(null);
  const interviewBottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollInterviewRef = useRef(true);
  const authPollErrorShownRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('notebook_theme', theme);
  }, [theme]);

  useEffect(() => {
    interviewGuidanceRef.current = interviewGuidance;
  }, [interviewGuidance]);

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
    if (!shouldAutoScrollInterviewRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      sentinel.scrollIntoView({ block: 'end' });
      setShowJumpToLatest(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interviewTurns, activeSessionMode]);

  useEffect(() => {
    if (activeSessionMode !== 'interview_assist') return;
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
  }, [activeSessionMode, interviewTurns.length]);

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
    if (!window.notebookDesktop?.onAuthCallback) {
      return;
    }

    let disposed = false;
    const tryConsumePending = async () => {
      try {
        const url = await window.notebookDesktop.consumeAuthCallback?.();
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

    const unsubscribe = window.notebookDesktop.onAuthCallback((url) => {
      void handleDesktopAuthCallback(url);
    });
    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      unsubscribe();
    };
  }, [sessionUserId]);

  useEffect(() => {
    if (!showSplash || sessionUserId || !pendingDesktopAuthState) return;
    let disposed = false;

    const pollDesktopAuth = async () => {
      try {
        const status = await pollDesktopAuthState(pendingDesktopAuthState);
        if (!status.ready || !status.session_token || !status.user_id) {
          return;
        }
        if (disposed) return;
        applyDesktopSession(status.session_token, status.user_id);
        setMessage('Signed in. Desktop is ready.');
      } catch {
        if (authPollErrorShownRef.current) return;
        authPollErrorShownRef.current = true;
        setMessage(
          'Auth status check failed. Restart desktop + cloud API, then sign in again.',
        );
      }
    };

    void pollDesktopAuth();
    const timer = window.setInterval(() => {
      void pollDesktopAuth();
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [showSplash, sessionUserId, pendingDesktopAuthState]);

  useEffect(() => {
    void (async () => {
      try {
        const [loadedNotes, providerStatuses, pref, localRoot, sync, drive] = await Promise.all([
          fetchNotes(),
          fetchProviderStatus(),
          fetchStoragePreference().catch(() => ({ mode: 'local', local_root: null } as StoragePreference)),
          fetchLocalRoot().catch(() => ''),
          fetchSyncStatus().catch(() => null),
          fetchGoogleDriveStatus().catch(() => DEFAULT_DRIVE_STATUS),
        ]);

        setNotes(loadedNotes);
        setProviders(
          providerStatuses.map((entry) => ({
            provider: entry.provider,
            connected: entry.connected,
            via: entry.via,
            last_updated_at: entry.last_updated_at,
          })),
        );
        setStoragePreference(pref);
        setLocalRootPath(pref.local_root || localRoot);
        setSyncStatus(sync);
        setDriveStatus(drive);

        const first = loadedNotes[0];
        if (first) {
          setSelectedId(first.frontmatter.id);
          setTitle(first.frontmatter.title);
          setBody(first.body);
          setTags(first.frontmatter.tags.join(', '));
        } else {
          const created = await createNote({
            title: 'Welcome note',
            body: DEFAULT_BODY,
            tags: ['welcome'],
          });
          setNotes([created]);
          setSelectedId(created.frontmatter.id);
          setTitle(created.frontmatter.title);
          setBody(created.body);
          setTags(created.frontmatter.tags.join(', '));
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Failed to initialize');
      }
    })();
  }, []);

  const selectedNote = useMemo(
    () => notes.find((note) => note.frontmatter.id === selectedId) ?? null,
    [notes, selectedId],
  );

  function clearInterviewSegmentTimer() {
    if (interviewSegmentTimerRef.current !== null) {
      window.clearTimeout(interviewSegmentTimerRef.current);
      interviewSegmentTimerRef.current = null;
    }
  }

  function buildInterviewNoteBody(transcript: string, guidance: string) {
    const transcriptSection = transcript.trim() || '_Listening for interview conversation..._';
    const guidanceSection = guidance.trim() || `_${COACH_PLACEHOLDER}_`;
    return [
      '# Interview Assist Session',
      '',
      '## Live Transcript',
      transcriptSection,
      '',
      '## Recommended Next Response',
      guidanceSection,
    ].join('\n');
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

    interviewUpdateInFlightRef.current = true;
    setTranscriptionBusy(true);

    try {
      const result = await transcribeAudioChunk(
        mergedAudio,
        'openai',
        transcriptionEngine,
        segmentId,
      );
      if (!result.ok) {
        const recoverableFailure = Boolean(result.recoverable);
        const detail =
          result.detail?.trim() ||
          `Transcription failed (${result.provider} / ${result.model}).`;
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
        setTranscriptionStatus(
          result.detail?.trim() || `Listening... (${result.model})`,
        );
        return;
      }
      interviewRecoverableFailureCountRef.current = 0;

      const nextTranscript = mergeTranscriptText(interviewTranscriptRef.current, chunkTranscript);
      if (!nextTranscript || nextTranscript === interviewTranscriptRef.current) {
        setTranscriptionStatus(`Listening... (${result.model})`);
        return;
      }
      const transcriptForTurnExtraction = nextTranscript.slice(-INTERVIEW_TRANSCRIPT_TAIL_CHARS);

      const turnPayload = await fetchInterviewTurns({
        transcript: transcriptForTurnExtraction,
        previous_turns: interviewTurnsRef.current,
        provider: 'openai',
      });
      if (turnPayload.transcript_digest === interviewDigestRef.current) {
        setTranscriptionStatus(`Listening... (${result.model})`);
        return;
      }

      interviewDigestRef.current = turnPayload.transcript_digest;
      interviewTranscriptRef.current = nextTranscript;
      interviewTurnsRef.current = turnPayload.turns;
      setInterviewTranscript(nextTranscript);
      setInterviewTurns(turnPayload.turns);
      setBody(buildInterviewNoteBody(nextTranscript, interviewGuidanceRef.current));
      setTranscriptionStatus(`Listening... (${result.model})`);

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
          provider: 'openai',
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
      setBody(buildInterviewNoteBody(nextTranscript, normalizedCoach));
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
          provider: 'openai',
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
      setBody(buildInterviewNoteBody(interviewTranscriptRef.current, normalized));
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
    if (!selectedNote) return;
    setTitle(selectedNote.frontmatter.title);
    setBody(selectedNote.body);
    setTags(selectedNote.frontmatter.tags.join(', '));
  }, [selectedNote?.frontmatter.id]);

  useDebouncedEffect(
    () => {
      if (!selectedId) return;

      const current = notes.find((note) => note.frontmatter.id === selectedId);
      if (!current) return;

      const payload = {
        id: selectedId,
        title: title.trim() || 'Untitled note',
        body,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };

      const unchanged =
        current.frontmatter.title === payload.title &&
        current.body === payload.body &&
        current.frontmatter.tags.join('|') === payload.tags.join('|');

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
    [selectedId, title, body, tags, notes],
    280,
  );

  async function handleCreateNote() {
    try {
      const created = await createNote({
        title: 'Untitled note',
        body: DEFAULT_BODY,
        tags: [],
      });

      setNotes((prev) => [created, ...prev]);
      setSelectedId(created.frontmatter.id);
      setMessage('Created a new note');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Create failed');
    }
  }

  async function handleSearchChange(value: string) {
    setSearch(value);
    const loaded = await fetchNotes(value);
    setNotes(loaded);
  }

  async function runTransform(action: 'summarize' | 'rewrite' | 'extract_action_items') {
    if (!selectedId) return;

    setBusy(true);
    setAiOutput('');

    try {
      await streamTransform(selectedId, body, action, (token) => {
        setAiOutput((prev) => prev + token);
      });
      setMessage('AI transform complete');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI transform failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveByok() {
    if (!byokValue.trim()) {
      setMessage('Enter an API key before saving.');
      return;
    }

    setByokSubmitting(true);
    try {
      await storeByok(byokProvider, byokValue.trim());
      setByokValue('');
      const statuses = await fetchProviderStatus();
      setProviders(
        statuses.map((entry) => ({
          provider: entry.provider,
          connected: entry.connected,
          via: entry.via,
          last_updated_at: entry.last_updated_at,
        })),
      );
      setMessage('Provider key saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save key');
    } finally {
      setByokSubmitting(false);
    }
  }

  async function handleDisconnectProvider(provider: ProviderId) {
    setProviderDisconnecting(provider);
    try {
      await disconnectProvider(provider);
      const statuses = await fetchProviderStatus();
      setProviders(
        statuses.map((entry) => ({
          provider: entry.provider,
          connected: entry.connected,
          via: entry.via,
          last_updated_at: entry.last_updated_at,
        })),
      );
      setMessage(`Disconnected ${provider}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to disconnect provider');
    } finally {
      setProviderDisconnecting(null);
    }
  }

  function setPendingAuthState(state: string | null) {
    if (state) {
      localStorage.setItem('notebook_pending_desktop_auth_state', state);
      setPendingDesktopAuthState(state);
      authPollErrorShownRef.current = false;
      return;
    }
    localStorage.removeItem('notebook_pending_desktop_auth_state');
    setPendingDesktopAuthState(null);
    authPollErrorShownRef.current = false;
  }

  function applyDesktopSession(sessionToken: string, userId: string) {
    localStorage.setItem('notebook_has_visited', 'true');
    localStorage.setItem('notebook_session_token', sessionToken);
    localStorage.setItem('notebook_session_user_id', userId);
    setPendingAuthState(null);
    setSessionUserId(userId);
    setShowSplash(false);
  }

  async function handleStartDesktopSignIn() {
    if (authBusy) return;
    if (pendingDesktopAuthState && !sessionUserId) {
      if (manualSignInUrl) {
        try {
          await window.notebookDesktop.openExternal(manualSignInUrl);
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
    setAuthBusy(true);
    try {
      const { authUrl, state, browserOpened } = await startDesktopAuthFlow();
      setManualSignInUrl(authUrl);
      setPendingAuthState(state);
      if (browserOpened) {
        setMessage('Complete sign in in browser. Desktop will continue automatically.');
      } else {
        setMessage('Browser did not open automatically. Use Open Sign-In Page below.');
      }
    } catch (error) {
      const fallback = 'Unable to open browser automatically.';
      if (error instanceof Error) {
        const match = error.message.match(/https?:\/\/\S+/);
        if (match?.[0]) {
          setManualSignInUrl(match[0]);
          setMessage(`${fallback} Click the button below to continue.`);
        } else {
          setMessage(error.message || fallback);
        }
      } else {
        setMessage(fallback);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDesktopAuthCallback(rawUrl: string) {
    try {
      const parsed = new URL(rawUrl);
      const code = parsed.searchParams.get('code');
      if (!code) {
        setMessage('Desktop opened, but no sign-in code was found. Click Sign In again from splash.');
        return;
      }
      setMessage('Finishing desktop sign in...');
      const response = await completeDesktopAuth(code);
      if (!response.session_token || !response.user_id) {
        setMessage('Unable to complete sign in.');
        return;
      }

      applyDesktopSession(response.session_token, response.user_id);
      setMessage('Signed in. Desktop is ready.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Desktop sign in failed');
    }
  }

  async function handleStorageModeChange(mode: StoragePreference['mode']) {
    setStorageBusy(true);
    try {
      const updated = await updateStoragePreference(mode);
      setStoragePreference(updated);
      const sync = await fetchSyncStatus();
      setSyncStatus(sync);
      if (mode === 'local_and_drive') {
        const drive = await fetchGoogleDriveStatus().catch(() => DEFAULT_DRIVE_STATUS);
        setDriveStatus(drive);
        setMessage(
          drive.connected
            ? `Drive mirror enabled (${drive.folder_name || 'Notebook AI'}).`
            : 'Drive mirror enabled. Connect Google Drive to start mirroring.',
        );
      } else {
        setMessage('Local-only storage enabled.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update storage preference');
    } finally {
      setStorageBusy(false);
    }
  }

  async function handleLogout() {
    if (!sessionUserId || logoutBusy) return;
    setLogoutBusy(true);
    try {
      localStorage.removeItem('notebook_has_visited');
      localStorage.removeItem('notebook_session_token');
      localStorage.removeItem('notebook_session_user_id');
      setPendingAuthState(null);
      setSessionUserId(null);
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
      setMessage(
        status.connected
          ? `Google Drive connected (${status.folder_name || 'Notebook AI'}).`
          : 'Google Drive is not connected yet.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load Google Drive status');
    } finally {
      setDriveStatusBusy(false);
    }
  }

  function handleConnectGoogleDrive() {
    openGoogleDriveConnect();
    setMessage('Google Drive connect opened in browser. Approve access, then click Refresh status.');
  }

  async function handleChooseLocalFolder() {
    try {
      const selected = await window.notebookDesktop.chooseDirectory();
      if (!selected) return;
      const updatedPath = await setLocalRoot(selected);
      setLocalRootPath(updatedPath);
      setStoragePreference((prev) => ({ ...prev, local_root: updatedPath }));
      setMessage('Local storage folder updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update local folder');
    }
  }

  async function handleRunSyncNow() {
    setStorageBusy(true);
    try {
      const status = await runSyncNow();
      setSyncStatus(status);
      setMessage('Drive sync run complete.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to run sync');
    } finally {
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

  async function beginTranscriptionSession(
    recorder: MediaRecorder,
    options: {
      listeningStatus: string;
      shareStream: MediaStream | null;
      transcriptionEngine: TranscriptionEngine;
      sessionMode: CaptureSessionMode;
    },
  ) {
    const { listeningStatus, shareStream, transcriptionEngine, sessionMode } = options;

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

    const transcriptTitle =
      sessionMode === 'interview_assist'
        ? `Interview Assist ${new Date().toLocaleTimeString()}`
        : `Transcript ${new Date().toLocaleTimeString()}`;
    const initialBody =
      sessionMode === 'interview_assist' ? buildInterviewNoteBody('', '') : '';
    const created = await createNote({
      title: transcriptTitle,
      body: initialBody,
      tags: sessionMode === 'interview_assist' ? ['interview-assist', 'transcript'] : ['transcript'],
    });
    setNotes((prev) => [created, ...prev]);
    setSelectedId(created.frontmatter.id);
    setTitle(created.frontmatter.title);
    setBody(initialBody);
    setTags(created.frontmatter.tags.join(', '));

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

        setTranscriptionBusy(true);
        setTranscriptionStatus(
          transcriptionEngine === 'llm'
            ? 'Transcribing full recording (Detailed mode)...'
            : 'Transcribing final recording (Fast mode)...',
        );

        void transcribeAudioChunk(merged, 'openai', transcriptionEngine)
          .then((result) => {
            if (result.text.trim()) {
              appendTranscriptChunk(result.text);
              setTranscriptionStatus(
                `Done (${result.provider} / ${result.model}). Capture stopped.`,
              );
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
      stopCaptureTracks();
    };
  }, []);

  if (showSplash) {
    const authPending = Boolean(pendingDesktopAuthState && !sessionUserId);
    return (
      <SplashScreen
        onLogin={() => {
          if (sessionUserId) {
            localStorage.setItem('notebook_has_visited', 'true');
            setShowSplash(false);
            return;
          }
          void handleStartDesktopSignIn();
        }}
        authBusy={authBusy}
        authPending={authPending}
        sessionUserId={sessionUserId}
        statusMessage={message}
        manualSignInUrl={manualSignInUrl}
      />
    );
  }

  const gridCols = [
    sidebarOpen ? '280px' : '48px',
    '1fr',
    aiPanelOpen ? '340px' : '48px',
  ].join(' ');
  const coachTargetTurn = selectCoachTargetTurn(interviewTurns, interviewTranscript);

  return (
    <main className={`app-shell${isMacPlatform ? ' is-mac' : ''}`} style={{ gridTemplateColumns: gridCols }}>
      <div className="ambient-bg" />

      {/* Sidebar */}
      {sidebarOpen ? (
        <NoteList
          notes={notes}
          selectedId={selectedId}
          search={search}
          onSearchChange={(value) => {
            void handleSearchChange(value);
          }}
          onSelect={setSelectedId}
          onCreate={() => {
            void handleCreateNote();
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSplash={() => setShowSplash(true)}
          onCollapse={() => setSidebarOpen(false)}
        />
      ) : (
        <div className="collapsed-sidebar">
          <button type="button" className="collapse-toggle" onClick={() => setSidebarOpen(true)} aria-label="Expand sidebar">
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Editor */}
      <section className="editor-panel">
        <header className="editor-header">
          <div className="title-wrap">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="title-input"
              placeholder="Untitled note"
            />
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className="tags-input"
              placeholder="tags, comma-separated"
            />
          </div>

          <div className="header-right">
            <span className="status-pill">{saving ? 'Saving...' : message}</span>
          </div>
        </header>

        <div className="transcription-anchor">
          <TranscriptionPanel
            recording={recording}
            busy={transcriptionBusy}
            status={transcriptionStatus}
            onStart={(opts) => {
              void startRecording(opts.captureMode, transcriptionEngine, opts.mode);
            }}
            onStop={stopRecording}
            onModeChange={setActiveSessionMode}
          />
        </div>

        {activeSessionMode === 'interview_assist' ? (
          <section className="interview-chat-screen" aria-live="polite">
            <header className="interview-chat-header">
              <h3>Interview Conversation</h3>
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
        ) : (
          <textarea
            className="note-editor"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write your thoughts here..."
          />
        )}
      </section>

      {/* AI Copilot - Right Rail */}
      {aiPanelOpen ? (
        <aside className="right-rail">
          <div className="right-rail__header">
            <button type="button" className="collapse-toggle" onClick={() => setAiPanelOpen(false)} aria-label="Collapse AI panel">
              <PanelRightClose size={16} />
            </button>
          </div>
          <AIActionPanel output={aiOutput} running={busy} onRun={(action) => void runTransform(action)} />
        </aside>
      ) : (
        <div className="collapsed-rail">
          <button type="button" className="collapse-toggle vertical" onClick={() => setAiPanelOpen(true)} aria-label="Expand AI panel">
            <Sparkles size={16} />
            <span>AI</span>
          </button>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        providers={providers}
        byokProvider={byokProvider}
        byokValue={byokValue}
        byokSubmitting={byokSubmitting}
        onByokProviderChange={setByokProvider}
        onByokValueChange={setByokValue}
        onSaveByok={() => {
          void handleSaveByok();
        }}
        onOpenOAuth={openOpenAIOAuth}
        disconnectingProvider={providerDisconnecting}
        onDisconnectProvider={(p) => {
          void handleDisconnectProvider(p);
        }}
        theme={theme}
        onThemeChange={setTheme}
        sessionUserId={sessionUserId}
        logoutBusy={logoutBusy}
        storageMode={storagePreference.mode}
        localRootPath={localRootPath}
        storageBusy={storageBusy}
        syncPendingOps={syncStatus?.pending_ops ?? 0}
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
        onConnectDrive={() => {
          handleConnectGoogleDrive();
        }}
        onRefreshDriveStatus={() => {
          void handleRefreshDriveStatus();
        }}
        transcriptionEngine={transcriptionEngine}
        onTranscriptionEngineChange={handleTranscriptionEngineChange}
      />
    </main>
  );
}
