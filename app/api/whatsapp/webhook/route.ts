import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import axios from 'axios';

const WHATSAPP_TOKEN = process.env.WHATSAPP_PERMANENT_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return NextResponse.json({ status: 'no_message' });

    const fromPhone = message.from;
    const msgText = message.text?.body?.trim() || '';

    let { data: lead } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('phone_number', fromPhone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabaseAdmin
        .from('leads')
        .insert([{ phone_number: fromPhone, status: 'NEW' }])
        .select()
        .single();
      lead = newLead;
    }

    await supabaseAdmin.from('whatsapp_logs').insert([
      { lead_id: lead.id, sender: 'USER', message_body: msgText, raw_payload: message }
    ]);

    let responseText = '';
    let nextStatus = lead.status;

    if (lead.status === 'NEW') {
      responseText = `Hello! Welcome to PropPulse Real Estate 🏡\n\nWhat property configuration are you looking for?\n1. 2 BHK\n2. 3 BHK\n3. Villa`;
      nextStatus = 'QUALIFYING';
    } else if (lead.status === 'QUALIFYING' && !lead.preferred_config) {
      await supabaseAdmin.from('leads').update({ preferred_config: msgText }).eq('id', lead.id);
      responseText = `Got it (${msgText})! What is your maximum budget?\n1. ₹50L - ₹1 Cr\n2. ₹1 Cr - ₹2 Cr\n3. ₹2 Cr+`;
    } else if (lead.status === 'QUALIFYING' && !lead.preferred_budget_max) {
      await supabaseAdmin.from('leads').update({
        preferred_budget_max: 15000000,
        status: 'QUALIFIED',
        intent_score: 'HOT'
      }).eq('id', lead.id);
      responseText = `Awesome! We have verified ready-to-move properties matching your criteria. Would you like to schedule a site visit this weekend?`;
      nextStatus = 'QUALIFIED';
    } else {
      responseText = `Thanks! A senior consultant will reach out with unit layouts and floor plans shortly.`;
    }

    if (nextStatus !== lead.status) {
      await supabaseAdmin.from('leads').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', lead.id);
    }

    if (responseText) {
      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: fromPhone, type: 'text', text: { body: responseText } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );

      await supabaseAdmin.from('whatsapp_logs').insert([
        { lead_id: lead.id, sender: 'BOT', message_body: responseText }
      ]);
    }

    return NextResponse.json({ status: 'success' });
  } catch (err: any) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}