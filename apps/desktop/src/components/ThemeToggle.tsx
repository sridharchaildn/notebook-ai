import { MoonStar, SunMedium } from 'lucide-react';

interface Props {
  theme: 'light' | 'dark';
  onChange: (theme: 'light' | 'dark') => void;
}

export function ThemeToggle({ theme, onChange }: Props) {
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      {isDark ? <SunMedium size={16} /> : <MoonStar size={16} />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
