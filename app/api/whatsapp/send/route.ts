import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const WHATSAPP_TOKEN = process.env.WHATSAPP_PERMANENT_TOKEN || process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

export async function POST(req: Request) {
  try {
    const { leadId, recipientPhone, messageText } = await req.json();

    if (!leadId || !recipientPhone || !messageText) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Console log token prefix to confirm token loading
    console.log('Sending message using token prefix:', WHATSAPP_TOKEN.substring(0, 15));
    console.log('Phone Number ID:', PHONE_NUMBER_ID);

    const metaResponse = await fetch(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: { body: messageText },
        }),
      }
    );

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('Full Meta API Error Details:', JSON.stringify(metaData, null, 2));
      return NextResponse.json(
        { 
          error: metaData.error?.message || 'Failed to send WhatsApp message via Meta',
          metaDetails: metaData.error 
        },
        { status: metaResponse.status }
      );
    }

    // Extract Meta's unique message ID (wamid)
    const wamid = metaData.messages?.[0]?.id || null;

    const { data: dbMessage, error: dbError } = await supabase
      .from('messages')
      .insert([
        {
          lead_id: leadId,
          direction: 'OUTBOUND',
          message_text: messageText,
          wamid: wamid,
          status: 'sent',
        },
      ])
      .select()
      .single();

    if (dbError) {
      console.error('Supabase save error:', dbError);
      return NextResponse.json(
        { error: 'Message sent via Meta, but failed to record in Supabase' },
        { status: 500 }
      );
    }

    // Also update lead's updated_at timestamp to trigger sidebar auto-sorting
    await supabase
      .from('leads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', leadId);

    return NextResponse.json({ success: true, metaData, message: dbMessage });
  } catch (error: any) {
    console.error('Outbound route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}