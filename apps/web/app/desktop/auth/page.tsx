import { redirect } from 'next/navigation';

type DesktopAuthPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function readParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }
  return null;
}

export default function DesktopAuthPage({ searchParams }: DesktopAuthPageProps) {
  const state = readParam(searchParams?.state);
  if (state) {
    redirect(`/auth/signin?state=${encodeURIComponent(state)}`);
  }
  redirect('/auth/signin');
}
