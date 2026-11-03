import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SplashScreen } from './SplashScreen';

describe('SplashScreen', () => {
  it('offers a local workspace without an account', () => {
    const onContinueLocally = vi.fn();
    const html = renderToStaticMarkup(
      <SplashScreen
        onLogin={() => undefined}
        onContinueLocally={onContinueLocally}
        onMagicLinkEmailChange={() => undefined}
        onSendMagicLink={() => undefined}
      />,
    );

    expect(html).toContain('Continue without an account');
    expect(html).toContain('API keys stay on this machine');
    expect(html).not.toContain('Open Workspace');
  });
});
