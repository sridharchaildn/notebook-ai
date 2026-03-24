import type { NoteDocument, ProviderId } from '@notebook-ai/contracts';
import { ChevronRight, PanelLeftClose, PanelRightClose, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AIActionPanel } from './components/AIActionPanel';
import { NoteList } from './components/NoteList';
import { SettingsModal } from './components/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import { TranscriptionPanel, type CaptureMode } from './components/TranscriptionPanel';
import {
  createNote,
  disconnectProvider,
  fetchNotes,
  fetchProviderStatus,
  openOpenAIOAuth,
  storeByok,
  streamTransform,
  transcribeAudioChunk,
  updateNote,
  type TranscriptionEngine,
} from './lib/api';

const DEFAULT_BODY = '# New note\n\nStart typing...';

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
  const [showSplash, setShowSplash] = useState(() => {
    return !localStorage.getItem('notebook_has_visited');
  });
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
  const captureStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Buffered recorder chunks; merged and transcribed once on stop as a complete audio file. */
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  const transcriptionEngineSessionRef = useRef<TranscriptionEngine>('whisper');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('notebook_theme', theme);
  }, [theme]);

  useEffect(() => {
    void (async () => {
      try {
        const [loadedNotes, providerStatuses] = await Promise.all([
          fetchNotes(),
          fetchProviderStatus(),
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

  function stopCaptureTracks() {
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
    audioContextRef.current = null;
    recorderRef.current = null;
  }

  function stopRecording() {
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
    },
  ) {
    const { listeningStatus, shareStream, transcriptionEngine } = options;

    recorderRef.current = recorder;
    transcriptionEngineSessionRef.current = transcriptionEngine;
    recordedAudioChunksRef.current = [];

    const transcriptTitle = `Transcript ${new Date().toLocaleTimeString()}`;
    const created = await createNote({
      title: transcriptTitle,
      body: '',
      tags: ['transcript'],
    });
    setNotes((prev) => [created, ...prev]);
    setSelectedId(created.frontmatter.id);
    setTitle(created.frontmatter.title);
    setBody('');
    setTags(created.frontmatter.tags.join(', '));

    setRecording(true);
    setTranscriptionStatus(listeningStatus);

    const onChunk = (chunkText: string) => {
      const normalized = chunkText.trim();
      if (!normalized) return;

      setBody((prev) => `${prev}${prev.trim().length === 0 ? '' : ' '}${normalized}`);
    };

    if (transcriptionEngine === 'llm') {
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        recordedAudioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        setRecording(false);
        const chunks = recordedAudioChunksRef.current;
        recordedAudioChunksRef.current = [];
        const mimeType = recorder.mimeType || 'audio/webm';
        const merged =
          chunks.length === 1 ? chunks[0]! : new Blob(chunks, { type: mimeType });

        if (merged.size === 0) {
          setTranscriptionStatus('No audio captured.');
          return;
        }

        setTranscriptionBusy(true);
        setTranscriptionStatus('Transcribing full recording (LLM)...');

        void transcribeAudioChunk(merged, 'openai', 'llm')
          .then((result) => {
            if (result.text.trim()) {
              onChunk(result.text);
              setTranscriptionStatus(
                `Done (${result.provider} / ${result.model}). Capture stopped.`,
              );
            } else if (result.detail) {
              setTranscriptionStatus(result.detail);
            } else {
              setTranscriptionStatus('LLM returned no text for this recording.');
            }
          })
          .catch((error: unknown) => {
            setTranscriptionStatus(
              error instanceof Error ? error.message : 'LLM transcription failed.',
            );
          })
          .finally(() => {
            setTranscriptionBusy(false);
          });
      };
    } else {
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        recordedAudioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        setRecording(false);
        const chunks = recordedAudioChunksRef.current;
        recordedAudioChunksRef.current = [];
        const mimeType = recorder.mimeType || 'audio/webm';
        const merged =
          chunks.length === 1 ? chunks[0]! : new Blob(chunks, { type: mimeType });

        if (merged.size === 0) {
          setTranscriptionStatus('No audio captured.');
          return;
        }

        setTranscriptionBusy(true);
        setTranscriptionStatus('Transcribing final recording (Whisper)...');

        void transcribeAudioChunk(merged, 'openai', 'whisper')
          .then((result) => {
            if (result.text.trim()) {
              onChunk(result.text);
              setTranscriptionStatus(
                `Done (${result.provider} / ${result.model}). Capture stopped.`,
              );
            } else if (result.detail) {
              setTranscriptionStatus(result.detail);
            } else {
              setTranscriptionStatus('Whisper returned no text for this recording.');
            }
          })
          .catch((error: unknown) => {
            setTranscriptionStatus(
              error instanceof Error ? error.message : 'Whisper transcription failed.',
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
  }

  async function startRecording(mode: CaptureMode, transcriptionEngine: TranscriptionEngine) {
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
        audioStreamRef.current = null;
        micStreamRef.current = micStream;
        audioContextRef.current = null;

        const recorder = buildAudioRecorder(micStream);
        await beginTranscriptionSession(recorder, {
          listeningStatus: 'Listening to microphone...',
          shareStream: null,
          transcriptionEngine,
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

      if (micStream && micEnabled) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);
      }

      const mixedAudioStream = destination.stream;

      captureStreamRef.current = captureStream;
      audioStreamRef.current = mixedAudioStream;
      micStreamRef.current = micStream;
      audioContextRef.current = audioContext;

      const recorder = buildAudioRecorder(mixedAudioStream);
      await beginTranscriptionSession(recorder, {
        listeningStatus: micEnabled
          ? 'Listening to system audio + microphone...'
          : 'Listening to system audio...',
        shareStream: captureStream,
        transcriptionEngine,
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
    return (
      <SplashScreen
        onLogin={() => {
          localStorage.setItem('notebook_has_visited', 'true');
          setShowSplash(false);
        }}
      />
    );
  }

  const gridCols = [
    sidebarOpen ? '280px' : '48px',
    '1fr',
    aiPanelOpen ? '340px' : '48px',
  ].join(' ');

  return (
    <main className="app-shell" style={{ gridTemplateColumns: gridCols }}>
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
              void startRecording(opts.captureMode, opts.engine);
            }}
            onStop={stopRecording}
          />
        </div>

        <textarea
          className="note-editor"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write your thoughts here..."
        />
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
      />
    </main>
  );
}
