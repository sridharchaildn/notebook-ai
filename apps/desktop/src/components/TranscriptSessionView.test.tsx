import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '@notebook-ai/contracts';

function buildTranscriptViewProps() {
  return {
    title: 'Transcript',
    transcript: 'Hello world',
    segments: [],
    summary: '',
    summaryBusy: false,
    activeTab: 'transcript' as const,
    contextPreset: 'meeting' as const,
    contextText: 'Customer sync',
    controlsCollapsed: false,
    onToggleControls: vi.fn(),
    connectedProviders: ['openai'] satisfies ProviderId[],
    transcriptionProvider: 'openai' as const,
    transcriptionModel: '',
    transcriptionModels: [],
    transcriptionModelsLoading: false,
    transcriptionModelsError: '',
    copilotProvider: 'openai' as const,
    copilotModel: '',
    copilotModels: [],
    copilotModelsLoading: false,
    copilotModelsError: '',
    onTranscriptionModelChange: vi.fn(),
    onCopilotProviderChange: vi.fn(),
    onCopilotModelChange: vi.fn(),
    onTabChange: vi.fn(),
    onSummaryChange: vi.fn(),
  };
}

describe('TranscriptSessionView', () => {
  afterEach(() => {
    vi.doUnmock('react');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('shows the single supported transcription path in quick setup', async () => {
    let useStateCallCount = 0;
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useState: vi.fn((initial: unknown) => {
          if (useStateCallCount === 0 && initial === false) {
            useStateCallCount += 1;
            return [true, vi.fn()] as const;
          }
          return actual.useState(initial);
        }),
      };
    });

    const { TranscriptSessionView } = await import('./TranscriptSessionView');
    const html = renderToStaticMarkup(<TranscriptSessionView {...buildTranscriptViewProps()} />);

    expect(html).toContain('OpenAI STT');
    expect(html).toContain('Desktop recording uses OpenAI speech-to-text models.');
    expect(html).not.toContain('Detailed');
    expect(html).not.toContain('Fast');
  });
});
