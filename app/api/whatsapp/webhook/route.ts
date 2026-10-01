import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// 1. GET Handler: Meta Webhook Verification Challenge
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'proppulse_secure_token_123';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook Verification Succeeded.');
    return new Response(challenge || '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  console.warn('Webhook Verification Failed: Token mismatch or invalid mode.');
  return new Response('Forbidden', { status: 403 });
}

// 2. POST Handler: Process Inbound WhatsApp Messages & Store in Supabase
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Safely extract change value payload
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const contact = value?.contacts?.[0];
    const message = value?.messages?.[0];

    // Only process when an actual message object exists
    if (message) {
      const phone = contact?.wa_id || message?.from;
      const fullName = contact?.profile?.name || 'Unknown Lead';
      const messageText = message?.text?.body || message?.caption || '';

      console.log(`Processing inbound lead: ${fullName} (${phone}) - "${messageText}"`);

      if (phone) {
        // Step A: Upsert Lead record in Supabase (matches 'full_name' column)
        const { data: leadData, error: leadError } = await supabaseAdmin
          .from('leads')
          .upsert(
            {
              phone,
              full_name: fullName,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'phone' }
          )
          .select()
          .single();

        if (leadError) {
          console.error('Supabase Lead Insert Error:', leadError);
        } else if (leadData && messageText) {
          // Step B: Insert Inbound Message linked to lead ID
          const { error: msgError } = await supabaseAdmin.from('messages').insert({
            lead_id: leadData.id,
            direction: 'INBOUND',
            message_text: messageText,
          });

          if (msgError) {
            console.error('Supabase Message Insert Error:', msgError);
          } else {
            console.log('Successfully saved lead and message to Supabase!');
          }
        }
      }
    }

    // Always acknowledge Meta with 200 OK
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Webhook execution failed:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}