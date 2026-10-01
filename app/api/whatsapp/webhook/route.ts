import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = 'proppulse_secure_token_123';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new Response(challenge || '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Safely parse WhatsApp payload structure
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (message && contact) {
      const phone = contact.wa_id;
      const name = contact.profile?.name || 'Unknown Lead';
      const messageText = message.text?.body || '';

      console.log(`Processing Lead: ${name} (${phone}) - Text: ${messageText}`);

      // 1. Upsert Lead record in Supabase
      const { data: leadData, error: leadError } = await supabaseAdmin
        .from('leads')
        .upsert(
          { phone, name, updated_at: new Date().toISOString() },
          { onConflict: 'phone' }
        )
        .select()
        .single();

      if (leadError) {
        console.error('Database lead insert error:', leadError);
      } else if (leadData && messageText) {
        // 2. Insert incoming message linked to lead ID
        const { error: msgError } = await supabaseAdmin.from('messages').insert({
          lead_id: leadData.id,
          direction: 'INBOUND',
          message_text: messageText,
        });

        if (msgError) {
          console.error('Database message insert error:', msgError);
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Webhook payload error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}