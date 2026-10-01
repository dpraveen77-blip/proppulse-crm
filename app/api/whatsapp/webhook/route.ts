import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'proppulse_secure_token_123';

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

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const contact = value?.contacts?.[0];
    const message = value?.messages?.[0];

    if (message) {
      const phone = contact?.wa_id || message?.from;
      const fullName = contact?.profile?.name || 'Unknown Lead';
      const messageText = message?.text?.body || message?.caption || 'Media/No text';

      console.log(`Processing inbound lead: ${fullName} (${phone}) - "${messageText}"`);

      if (phone) {
        // 1. Check if lead already exists
        const { data: existingLead } = await supabaseAdmin
          .from('leads')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();

        let leadId = existingLead?.id;

        if (!existingLead) {
          // 2. Insert new lead
          const { data: newLead, error: leadError } = await supabaseAdmin
            .from('leads')
            .insert({
              phone: phone,
              full_name: fullName,
              status: 'NEW_LEAD',
            })
            .select('id')
            .single();

          if (leadError) {
            console.error('Lead Insert Error:', leadError);
          } else {
            leadId = newLead?.id;
          }
        } else {
          // 3. Update timestamp for existing lead
          await supabaseAdmin
            .from('leads')
            .update({ updated_at: new Date().toISOString() })
            .eq('phone', phone);
        }

        // 4. Insert message
        const { error: msgError } = await supabaseAdmin
          .from('messages')
          .insert({
            lead_id: leadId || null,
            direction: 'INBOUND',
            message_text: messageText,
          });

        if (msgError) {
          console.error('Message Insert Error:', msgError);
        } else {
          console.log('SUCCESS: Stored message in Supabase!');
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Webhook execution failed:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}