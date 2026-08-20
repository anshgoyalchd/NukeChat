import React, { useState, useEffect, useRef } from "react";
import { Send, Users, Bomb, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { ParticipantPanel } from "./ParticipantPanel";
import { UIMessage } from "./ActiveRoom";

interface TimedChatProps {
  roomCode: string;
  participants: Array<{ id: string; identity: string; avatar: string }>;
  mySessionId: string;
  expiresAt: string;
  messages: UIMessage[];
  onSendMessage: (text: string) => void;
  onNukeClick: () => void;
  onLeaveClick: () => void;
  nukeVotesState: { votesCount: number; neededVotes: number };
  isConnected: boolean;
}

export const TimedChat: React.FC<TimedChatProps> = ({
  roomCode,
  participants,
  mySessionId,
  expiresAt,
  messages,
  onSendMessage,
  onNukeClick,
  onLeaveClick,
  nukeVotesState,
  isConnected,
}) => {
  const [inputText, setInputText] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Expiration countdown handler
  useEffect(() => {
    const updateCountdown = () => {
      const expiry = new Date(expiresAt).getTime();
      const now = Date.now();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeLeft("00:00:00");
        return;
      }

      const hrs = Math.floor(diff / 3600000).toString().padStart(2, "0");
      const mins = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
      const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");

      setTimeLeft(`${hrs}:${mins}:${secs}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!inputText.trim()) return;
      onSendMessage(inputText.trim());
      setInputText("");
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#F8F7F4] select-none w-full animate-fadeIn font-sans">
      {/* Header with Glassmorphism */}
      <header className="px-4 py-3 bg-surface/85 backdrop-blur-md border-b border-[#E4E2DD] flex items-center justify-between shrink-0 sticky top-0 z-30 shadow-sm shadow-black/2 font-sans">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfirmLeave(true)}
            className="p-1.5 hover:bg-black/5 rounded-full transition-all active:scale-95 shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-secondaryText" />
          </button>
          
          <div>
            <h1 className="font-extrabold text-base tracking-tight text-primaryText flex items-center gap-1.5 leading-none">
              {roomCode}
              <span className="flex h-2 w-2 relative">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? "bg-emerald-400" : "bg-brand-coral"}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? "bg-emerald-500" : "bg-brand-coral"}`} />
              </span>
            </h1>
            <p className="text-[10px] font-bold text-secondaryText flex items-center gap-1 mt-0.5 uppercase tracking-wide">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 inline" />
              E2EE TIMED
            </p>
          </div>
        </div>

        {/* Info Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsPanelOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#EEF2F6] hover:bg-[#E2E8F0] text-primaryText rounded-full font-bold text-xxs tracking-wider uppercase transition-all duration-200 active:scale-95"
          >
            <Users className="w-3.5 h-3.5 text-secondaryText" />
            <span>{participants.length}</span>
          </button>

          <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 bg-[#EEF2F6] border border-[#E4E2DD] rounded-full text-xxs font-bold text-secondaryText">
            EXPIRES IN: <span className="font-mono text-primaryText font-bold ml-0.5">{timeLeft}</span>
          </span>

          <button
            onClick={onNukeClick}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-coral hover:bg-brand-coral/95 text-white font-bold text-xxs tracking-wider uppercase rounded-full shadow-md shadow-brand-coral/10 transition-all duration-200 active:scale-95"
          >
            <Bomb className="w-3.5 h-3.5" />
            <span>NUKE IT</span>
          </button>
        </div>
      </header>

      {/* Nuke Voting Banner */}
      {nukeVotesState.votesCount > 0 && (
        <div className="bg-brand-peach/40 border-b border-brand-peach/60 px-4 py-2.5 text-center text-xs font-bold text-brand-coral flex items-center justify-center gap-2 animate-pulse shrink-0">
          <span>☢️</span> NUKE VOTE IN PROGRESS: {nukeVotesState.votesCount} OF {nukeVotesState.neededVotes} VOTES CAST
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex flex-col items-center justify-center py-6 text-center text-xxs text-secondaryText/90 space-y-1 bg-[#EEF2F6]/30 rounded-2xl border border-[#E4E2DD]/40 p-4 max-w-lg mx-auto">
          <p>⚠️ Do not share sensitive details. The room will vanish forever once the timer hits zero or all users leave.</p>
          <p className="sm:hidden font-mono font-bold">Expires in: {timeLeft}</p>
        </div>

        {messages.map((m) => {
          const isMe = m.senderId === mySessionId;
          return (
            <div
              key={m.messageId}
              className={`flex items-end gap-2.5 max-w-[85%] sm:max-w-[70%] ${
                isMe ? "ml-auto flex-row-reverse" : "mr-auto"
              }`}
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 select-none bg-white border border-[#E4E2DD] p-0.5 shadow-xxs">
                <img src={m.avatar} alt={m.senderName} className="w-full h-full object-cover rounded" />
              </div>

              {/* Balloon */}
              <div className="flex flex-col min-w-0">
                <span className={`text-[10px] font-bold text-secondaryText mb-1 px-1 ${isMe ? "text-right" : "text-left"}`}>
                  {m.senderName}
                </span>
                
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-xxs break-words ${
                    isMe
                      ? "bg-brand-lavender text-primaryText rounded-tr-none"
                      : "bg-surface text-primaryText border border-[#E4E2DD]/80 rounded-tl-none"
                  }`}
                >
                  {m.text}
                </div>
                
                <span className={`text-[9px] text-secondaryText/70 mt-1 px-1 ${isMe ? "text-right" : "text-left"}`}>
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {m.isSending && " • sending..."}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Input Area */}
      <form onSubmit={handleSend} className="p-3 bg-surface border-t border-[#E4E2DD] flex gap-2 items-center shrink-0">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type an encrypted message..."
          rows={1}
          autoFocus
          className="flex-1 px-4 py-3 bg-[#EEF2F6]/60 border border-[#E4E2DD] focus:border-indigo-500 rounded-2xl text-sm outline-none resize-none max-h-24 font-normal leading-relaxed focus:bg-surface transition-all"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-md shadow-indigo-600/10 disabled:opacity-50 shrink-0 active:scale-95"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Confirm Leave Modal */}
      {showConfirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fadeIn">
          <div className="bg-surface border border-[#E4E2DD] p-6 sm:p-8 rounded-3xl max-w-sm w-full text-center shadow-2xl">
            <h3 className="text-xl font-bold text-primaryText mb-2 tracking-tight">Leave Chat?</h3>
            <p className="text-xs text-secondaryText mb-6 leading-relaxed">
              If you are the last participant, the room database and all messages will be destroyed immediately.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmLeave(false)}
                className="flex-1 py-2.5 border border-[#E4E2DD] hover:bg-black/5 text-primaryText font-bold rounded-full text-xs transition-colors active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={onLeaveClick}
                className="flex-1 py-2.5 bg-brand-coral hover:bg-brand-coral/95 text-white font-bold rounded-full text-xs transition-colors active:scale-95 shadow-md shadow-brand-coral/10"
              >
                Leave Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side Panel Drawer */}
      <ParticipantPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        participants={participants}
        mySessionId={mySessionId}
      />
    </div>
  );
};
