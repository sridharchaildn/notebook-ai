export function sseResponse(source: AsyncIterable<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const token of source) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: 'token', data: token })}\n\n`),
          );
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event: 'complete', data: 'done' })}\n\n`),
        );
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Streaming failed.';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event: 'error', data: message })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
