import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Parse URL using standard Web API for 100% reliable query parameter extraction
    const url = new URL(request.url);

    const mode = url.searchParams.get('hub.mode')?.trim();
    const token = url.searchParams.get('hub.verify_token')?.trim();
    const challenge = url.searchParams.get('hub.challenge')?.trim();

    const VERIFY_TOKEN = 'proppulse_secure_token_123';

    // Verify token and mode match Meta requirements
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Meta Webhook Verified Successfully!');
      return new Response(challenge || '', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    console.warn(`Webhook verification failed. Received token: "${token}", Expected: "${VERIFY_TOKEN}"`);
    return new Response('Forbidden', { status: 403 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Error', { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Incoming WhatsApp Webhook:', JSON.stringify(body, null, 2));

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response('Internal Error', { status: 500 });
  }
}