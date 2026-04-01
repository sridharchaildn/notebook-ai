export function requireBearerToken(request: Request): string | Response {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ detail: 'Missing bearer token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authorization.slice('bearer '.length).trim();
  if (!token) {
    return new Response(JSON.stringify({ detail: 'Missing bearer token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return token;
}
