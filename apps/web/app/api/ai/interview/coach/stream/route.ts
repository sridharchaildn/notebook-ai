import type { InterviewCoachRequest, ProviderId } from '@notebook-ai/contracts';
import { streamInterviewCoachText } from '@notebook-ai/server-ai';
import { requireBearerToken } from '../../../../_auth';
import { sseResponse } from '../../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = InterviewCoachRequest & {
  provider?: ProviderId;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const provider = payload.provider ?? 'openai';
  const accessToken = requireBearerToken(request);
  if (accessToken instanceof Response) return accessToken;

  return sseResponse(
    streamInterviewCoachText(payload, {
      provider,
      accessToken,
      model: payload.model,
    }),
  );
}
