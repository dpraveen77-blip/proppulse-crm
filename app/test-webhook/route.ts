export async function GET() {
  return new Response('SERVER_ALIVE', { status: 200 });
}