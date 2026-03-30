import type { AITransformRequest, ProviderId } from '@notebook-ai/contracts';
import { streamTransformText } from '@notebook-ai/server-ai';
import { sseResponse } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = AITransformRequest & {
  accessToken?: string;
  provider?: ProviderId;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const provider = payload.provider ?? 'openai';

  return sseResponse(
    streamTransformText(payload, {
      provider,
      accessToken: payload.accessToken,
      model: payload.model,
    }),
  );
}
