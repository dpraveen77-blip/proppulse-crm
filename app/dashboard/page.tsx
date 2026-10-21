'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface Lead {
  id: string;
  phone: string;
  full_name: string | null;
  status: string;
  created_at: string;
  updated_at?: string;
}

interface Message {
  id: string;
  lead_id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  message_text: string;
  created_at: string;
  wamid?: string;
  status?: string; // 'sent' | 'delivered' | 'read'
}

interface QuickReply {
  label: string;
  text: string;
}

const STATUS_OPTIONS = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'HOT_LEAD', 'CLOSED'];

// Default Real Estate Quick Reply Templates
const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  {
    label: '🏢 Property Details',
    text: 'Could you please share the property location, total square footage, and expected price range?',
  },
  {
    label: '📅 Site Visit',
    text: 'Would you be available for an exclusive site visit this weekend?',
  },
  {
    label: '📄 Brochure',
    text: 'Thank you for your interest! I am sharing the project brochure and layout plans with you.',
  },
  {
    label: '👋 Follow Up',
    text: 'Hi! Just checking in to see if you had a chance to review the details we discussed.',
  },
];

export default function Dashboard() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Template Creator States
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(DEFAULT_QUICK_REPLIES);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newText, setNewText] = useState('');

  // 0. Protect Route: Verify Authentication Session
  useEffect(() => {
    setIsClient(true);

    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
      }
    }

    checkAuth();

    // Listen for auth state changes (log out events)
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    // Load custom templates from localStorage if available
    const savedTemplates = localStorage.getItem('propulse_custom_templates');
    if (savedTemplates) {
      try {
        setQuickReplies(JSON.parse(savedTemplates));
      } catch (err) {
        console.error('Error loading custom templates:', err);
      }
    }
  }, []);

  // Save templates to localStorage helper
  const saveTemplates = (updated: QuickReply[]) => {
    setQuickReplies(updated);
    localStorage.setItem('propulse_custom_templates', JSON.stringify(updated));
  };

  // Handle adding new template
  const handleAddTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !newText.trim()) return;

    const updated = [...quickReplies, { label: newLabel.trim(), text: newText.trim() }];
    saveTemplates(updated);
    setNewLabel('');
    setNewText('');
    setIsTemplateModalOpen(false);
  };

  // Handle deleting a template
  const handleDeleteTemplate = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this template?')) {
      const updated = quickReplies.filter((_, i) => i !== index);
      saveTemplates(updated);
    }
  };

  // Handle Sign Out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // 1. Fetch Leads
  const fetchLeads = async () => {
    setLoadingLeads(true);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching leads:', error);
    } else if (data) {
      setLeads(data);
      if (data.length > 0 && !selectedLead) {
        setSelectedLead(data[0]);
      }
    }
    setLoadingLeads(false);
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  // 2. Fetch Messages for Selected Lead
  useEffect(() => {
    if (!selectedLead) return;
    const leadId = selectedLead.id;

    async function fetchMessages() {
      setLoadingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
      } else if (data) {
        setMessages(data);
      }
      setLoadingMessages(false);
    }

    fetchMessages();
  }, [selectedLead]);

  // 3. Realtime Subscription
  useEffect(() => {
    if (!selectedLead) return;

    const msgChannel = supabase
      .channel(`realtime-inbound-${selectedLead.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `lead_id=eq.${selectedLead.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          if (newMessage.direction === 'INBOUND') {
            setMessages((prev) => [...prev, newMessage]);
          }
        }
      )
      .subscribe();

    const leadChannel = supabase
      .channel('realtime-leads-sidebar')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
        },
        () => {
          fetchLeads();
        }
      )
      .subscribe();

    const statusChannel = supabase
      .channel('realtime-message-statuses')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const updatedMsg = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMsg.id ? { ...m, status: updatedMsg.status } : m))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(leadChannel);
      supabase.removeChannel(statusChannel);
    };
  }, [selectedLead]);

  // 4. Update Lead Status
  const handleStatusChange = async (newStatus: string) => {
    if (!selectedLead) return;
    setUpdatingStatus(true);

    const { error } = await supabase
      .from('leads')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', selectedLead.id);

    if (error) {
      console.error('Error updating status:', error);
      alert('Failed to update lead status');
    } else {
      const updatedLead = { ...selectedLead, status: newStatus };
      setSelectedLead(updatedLead);
      setLeads((prevLeads) =>
        prevLeads.map((lead) => (lead.id === selectedLead.id ? updatedLead : lead))
      );
    }
    setUpdatingStatus(false);
  };

  // 5. Send Reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedLead || sending) return;

    setSending(true);

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLead.id,
          recipientPhone: selectedLead.phone,
          messageText: replyText.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send WhatsApp message');
      }

      if (result.message) {
        setMessages((prev) => [...prev, result.message]);

        const now = new Date().toISOString();
        const updatedLead = { ...selectedLead, updated_at: now };
        setSelectedLead(updatedLead);
        setLeads((prevLeads) => {
          const filtered = prevLeads.filter((l) => l.id !== selectedLead.id);
          return [updatedLead, ...filtered];
        });
      }
      setReplyText('');
    } catch (err: any) {
      console.error('Error sending message:', err);
      alert(err.message || 'Error sending message');
    } finally {
      setSending(false);
    }
  };

  const renderStatusTicks = (status?: string) => {
    if (status === 'read') {
      return <span className="text-cyan-300 font-bold ml-1" title="Read">✓✓</span>;
    }
    if (status === 'delivered') {
      return <span className="text-gray-200 font-bold ml-1" title="Delivered">✓✓</span>;
    }
    return <span className="text-gray-300 font-bold ml-1" title="Sent">✓</span>;
  };

  const filteredLeads = leads.filter((lead) => {
    const name = (lead.full_name || '').toLowerCase();
    const phone = (lead.phone || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || phone.includes(query);
  });

  return (
    <div className="flex h-screen bg-gray-100 font-sans relative">
      {/* Sidebar: Leads List */}
      <div className="w-1/3 border-r bg-white flex flex-col">
        <div className="p-4 border-b bg-slate-900 text-white flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">PropPulse CRM</h1>
            <p className="text-xs text-slate-300">WhatsApp Lead Inbox</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-xs bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:border-red-500 transition-colors"
            title="Sign Out"
          >
            Sign Out
          </button>
        </div>

        {/* Search Bar Input */}
        <div className="p-3 border-b bg-gray-50">
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border rounded-lg px-3 py-1.5 text-xs bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingLeads ? (
            <div className="p-4 text-center text-gray-500">Loading leads...</div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">No matching leads found.</div>
          ) : (
            filteredLeads.map((lead) => (
              <div
                key={lead.id}
                onClick={() => setSelectedLead(lead)}
                className={`p-4 border-b cursor-pointer transition-colors ${
                  selectedLead?.id === lead.id
                    ? 'bg-blue-50 border-l-4 border-l-blue-600'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-gray-800">
                    {lead.full_name || 'Unknown Lead'}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">
                    {lead.status}
                  </span>
                </div>
                <div className="text-sm text-gray-500">{lead.phone}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main View: Chat Window */}
      <div className="flex-1 flex flex-col">
        {selectedLead ? (
          <>
            {/* Header with Status Dropdown */}
            <div className="p-4 border-b bg-white flex justify-between items-center shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-gray-800">
                  {selectedLead.full_name || 'Unknown Lead'}
                </h2>
                <p className="text-sm text-gray-500">{selectedLead.phone}</p>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-500">Status:</label>
                <select
                  value={selectedLead.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={updatingStatus}
                  className="border rounded-lg px-3 py-1.5 text-xs font-semibold bg-gray-50 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Messages Container */}
            <div className="flex-1 p-4 overflow-y-auto bg-slate-50 flex flex-col gap-3">
              {loadingMessages ? (
                <div className="text-center text-gray-500 my-auto">Loading chat history...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-400 my-auto">
                  No messages recorded for this lead.
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`max-w-md p-3 rounded-lg text-sm ${
                      msg.direction === 'INBOUND'
                        ? 'bg-white text-gray-800 self-start border shadow-sm'
                        : 'bg-blue-600 text-white self-end shadow-sm'
                    }`}
                  >
                    <p>{msg.message_text}</p>
                    <span
                      className={`text-[10px] flex items-center justify-end gap-1 mt-1 ${
                        msg.direction === 'INBOUND' ? 'text-gray-400' : 'text-blue-100'
                      }`}
                    >
                      {isClient
                        ? new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                      {msg.direction === 'OUTBOUND' && renderStatusTicks(msg.status)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Quick Reply Templates & Reply Input Bar */}
            <div className="border-t bg-white p-3 flex flex-col gap-2">
              <div className="flex gap-2 items-center overflow-x-auto pb-1 no-scrollbar">
                {quickReplies.map((qr, idx) => (
                  <div
                    key={idx}
                    onClick={() => setReplyText(qr.text)}
                    className="group flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 px-3 py-1.5 rounded-full border border-slate-200 transition-colors whitespace-nowrap cursor-pointer"
                    title="Click to insert template"
                  >
                    <span>{qr.label}</span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteTemplate(idx, e)}
                      className="text-gray-400 hover:text-red-500 font-bold ml-0.5 opacity-60 group-hover:opacity-100"
                      title="Delete template"
                    >
                      ×
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(true)}
                  className="text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-full border border-blue-200 transition-colors whitespace-nowrap flex items-center gap-1"
                >
                  <span>+ Add Template</span>
                </button>
              </div>

              {/* Reply Form */}
              <form onSubmit={handleSendReply} className="flex gap-2">
                <input
                  type="text"
                  placeholder={`Reply to ${selectedLead.full_name || selectedLead.phone}...`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="flex-1 border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a lead from the sidebar to view conversation history.
          </div>
        )}
      </div>

      {/* Add Template Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Create Quick Reply Template</h3>
            <form onSubmit={handleAddTemplate} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Template Label (e.g. 💰 Pricing)</label>
                <input
                  type="text"
                  placeholder="e.g., 💰 Pricing"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Message Text</label>
                <textarea
                  placeholder="Type the message that will be inserted..."
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  required
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}