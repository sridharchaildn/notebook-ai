import type { InterviewTurnsRequest, ProviderId } from '@notebook-ai/contracts';
import { extractInterviewTurns } from '@notebook-ai/server-ai';
import { requireBearerToken } from '../../../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = InterviewTurnsRequest & {
  provider?: ProviderId;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const provider = payload.provider ?? 'openai';
  const accessToken = requireBearerToken(request);
  if (accessToken instanceof Response) return accessToken;
  const response = await extractInterviewTurns(payload, {
    provider,
    accessToken,
    model: payload.model,
  });
  return Response.json(response);
}
