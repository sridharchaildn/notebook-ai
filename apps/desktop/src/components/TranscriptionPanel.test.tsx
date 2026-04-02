import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TranscriptionPanel } from './TranscriptionPanel';

describe('TranscriptionPanel', () => {
  it('shows the recording timer in the collapsed live state', () => {
    const html = renderToStaticMarkup(
      <TranscriptionPanel
        recording
        busy={false}
        status="Recording 01:05"
        elapsedMs={65_000}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain('Recording 01:05');
  });

  it('shows the system audio + mic label and warning in the expanded state', () => {
    const html = renderToStaticMarkup(
      <TranscriptionPanel
        recording={false}
        busy={false}
        status="Ready"
        warning="Microphone unavailable. Continuing with system audio only."
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain('System audio + mic');
    expect(html).toContain('Microphone unavailable. Continuing with system audio only.');
  });
});
