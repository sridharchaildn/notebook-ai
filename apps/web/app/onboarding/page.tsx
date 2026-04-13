import { redirect } from 'next/navigation';
import { OnboardingClient } from './OnboardingClient';

interface OnboardingPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function matchesPreviewFlag(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) {
    return value.includes('1') || value.includes('true');
  }
  return value === '1' || value === 'true';
}

export default function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const onboardingEnabled =
    process.env.ENABLE_WEB_ONBOARDING === 'true'
    || process.env.NEXT_PUBLIC_ENABLE_WEB_ONBOARDING === 'true';
  const allowPreview = matchesPreviewFlag(searchParams?.preview);

  if (!onboardingEnabled && !allowPreview) {
    redirect('/home');
  }

  return <OnboardingClient />;
}
