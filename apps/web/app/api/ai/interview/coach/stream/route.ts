import type { InterviewCoachRequest, ProviderId } from '@notebook-ai/contracts';
import { streamInterviewCoachText } from '@notebook-ai/server-ai';
import { sseResponse } from '../../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = InterviewCoachRequest & {
  accessToken?: string;
  provider?: ProviderId;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const provider = payload.provider ?? 'openai';

  return sseResponse(
    streamInterviewCoachText(payload, {
      provider,
      accessToken: payload.accessToken,
      model: payload.model,
    }),
  );
}
