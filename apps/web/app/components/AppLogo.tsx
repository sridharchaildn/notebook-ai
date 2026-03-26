/**
 * App logo matching the desktop app's splash screen:
 * BookOpen icon inside a rounded square with primary background.
 */
export function AppLogo({ size = 28 }: { size?: number }) {
  const iconInset = size * 0.22;
  const iconSize = size - iconInset * 2;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: 'var(--primary)',
        color: 'var(--primary-text)',
        flexShrink: 0,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Lucide BookOpen icon — matches desktop SplashScreen.tsx */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    </div>
  );
}
