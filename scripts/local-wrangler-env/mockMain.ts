export default {
  async fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext): Promise<Response> {
    return new Response(JSON.stringify({ message: 'Mock Worker Response', url: request.url }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
