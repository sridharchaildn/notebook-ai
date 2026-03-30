import type { ProviderId } from '@notebook-ai/contracts';
import { transcribeAudioChunk } from '@notebook-ai/server-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file');
  const provider = (form.get('provider') as ProviderId | null) ?? 'openai';
  const accessToken = (form.get('accessToken') as string | null) ?? undefined;
  const model = (form.get('model') as string | null) ?? undefined;

  if (!(file instanceof File)) {
    return Response.json({ detail: 'Missing audio file.' }, { status: 400 });
  }

  const result = await transcribeAudioChunk(file, {
    provider,
    accessToken,
    model,
  });

  return Response.json(result);
}
