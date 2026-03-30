import type { InterviewTurnsRequest, ProviderId } from '@notebook-ai/contracts';
import { extractInterviewTurns } from '@notebook-ai/server-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = InterviewTurnsRequest & {
  accessToken?: string;
  provider?: ProviderId;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const provider = payload.provider ?? 'openai';
  const response = await extractInterviewTurns(payload, {
    provider,
    accessToken: payload.accessToken,
    model: payload.model,
  });
  return Response.json(response);
}
