import React, { useState } from "react";
import { Shield, Clock, Zap, Shuffle, Plus, ArrowRight, Activity, Loader2 } from "lucide-react";

interface HomeProps {
  onCreateClick: () => void;
  onRandomClick: () => void;
  onJoinSubmit: (code: string) => void;
  activeRoomCode: string | null;
  onRejoinClick: () => void;
  onLeaveSessionClick: () => void;
  isJoining: boolean;
  errorMessage: string | null;
}

export const Home: React.FC<HomeProps> = ({
  onCreateClick,
  onRandomClick,
  onJoinSubmit,
  activeRoomCode,
  onRejoinClick,
  onLeaveSessionClick,
  isJoining,
  errorMessage,
}) => {
  const [code, setCode] = useState("");

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    val = val.replace(/[^A-Z0-9-]/g, "");
    setCode(val);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || isJoining) return;
    onJoinSubmit(code.trim());
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 md:py-10 flex flex-col items-center justify-center min-h-[90dvh] w-full select-none animate-fadeIn">
      {/* Brand Floating Header Badge */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 bg-brand-peach/40 border border-brand-peach/60 rounded-full text-brand-coral font-bold text-xxs tracking-wider uppercase mb-3 shadow-sm shadow-brand-coral/5 backdrop-blur-sm">
          <span>💥</span> NUKE CHAT
        </div>
        
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-2 text-primaryText leading-[1.1]">
          Nuke Chat: Talk. Share. <span className="text-brand-coral font-black">Nuke It.</span>
        </h1>
        
        <p className="text-xs sm:text-sm text-secondaryText max-w-md mx-auto leading-relaxed font-normal">
          Nuke Chat provides secure, temporary, and anonymous messaging rooms for people who don't want permanent conversation histories. Zero signup, zero tracking.
        </p>
      </div>

      {/* Active Session Warning Card */}
      {activeRoomCode ? (
        <div className="w-full max-w-sm bg-surface border border-brand-peach/60 p-6 rounded-3xl shadow-lg shadow-black/5 text-center mb-8 transition-all duration-300">
          <div className="w-12 h-12 bg-brand-peach/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-brand-coral animate-bounce">
            <Activity className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-primaryText mb-1 tracking-tight">Active Session In Progress</h3>
          <p className="text-secondaryText mb-5 text-[11px] max-w-xs mx-auto leading-relaxed">
            You're currently connected in <span className="font-bold text-primaryText">{activeRoomCode}</span>. Please rejoin or exit to join a new room.
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              onClick={onRejoinClick}
              className="w-full py-2.5 bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-xs tracking-wide rounded-full shadow-md shadow-indigo-600/10 active:scale-[0.98] active:translate-y-[1px] transition-all duration-200"
            >
              REJOIN ROOM ({activeRoomCode})
            </button>
            <button
              onClick={onLeaveSessionClick}
              className="w-full py-2.5 border border-[#E4E2DD] hover:bg-black/5 text-brand-coral font-semibold text-xs tracking-wide rounded-full active:scale-[0.98] active:translate-y-[1px] transition-all duration-200"
            >
              EXIT CURRENT ROOM
            </button>
          </div>
        </div>
      ) : (
        /* Action Form Card & Button Row */
        <div className="w-full max-w-sm mb-8 flex flex-col items-center">
          {/* Join Code Input Form (Top) */}
          <form onSubmit={handleJoinSubmit} className="w-full bg-surface border border-[#E4E2DD] p-5 rounded-3xl shadow-lg shadow-black/3 space-y-4">
            <div>
              <label className="block text-[9px] font-bold uppercase tracking-widest text-secondaryText mb-2 text-left px-1">
                Enter Room Code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={handleInputChange}
                  placeholder="E.G. MANGO-42"
                  disabled={isJoining}
                  autoFocus
                  className="flex-1 px-4 py-2.5 border-2 border-[#E4E2DD] focus:border-indigo-500 rounded-2xl text-center text-sm font-black tracking-widest outline-none bg-[#EEF2F6]/50 focus:bg-surface transition-all uppercase placeholder:font-bold placeholder:tracking-normal"
                />
                <button
                  type="submit"
                  disabled={!code.trim() || isJoining}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-2xl shadow-md shadow-indigo-600/10 disabled:opacity-50 transition-all active:scale-95 shrink-0 flex items-center justify-center min-w-[70px]"
                >
                  {isJoining ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "JOIN"
                  )}
                </button>
              </div>
            </div>

            {/* Error Message inside Card */}
            {errorMessage && (
              <div className="p-3 bg-brand-peach/30 border border-brand-coral/20 text-[10px] text-brand-coral rounded-xl font-semibold text-left leading-normal animate-fadeIn">
                ⚠️ {errorMessage}
              </div>
            )}
          </form>

          {/* Create & Match Random Buttons Row (Bottom) */}
          <div className="flex gap-3 w-full mt-3">
            {/* Create Room */}
            <button
              onClick={onCreateClick}
              disabled={isJoining}
              className="flex-1 py-3.5 bg-gradient-to-r from-indigo-50 to-indigo-100/70 text-indigo-700 border border-indigo-200/50 hover:from-indigo-100/80 hover:to-indigo-200/70 rounded-full font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm shadow-indigo-100 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              Create Room
            </button>

            {/* Random Match */}
            <button
              onClick={onRandomClick}
              disabled={isJoining}
              className="flex-1 py-3.5 bg-gradient-to-r from-sky-50 to-sky-100/70 text-sky-700 border border-sky-200/50 hover:from-sky-100/80 hover:to-sky-200/70 rounded-full font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm shadow-sky-100 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <Shuffle className="w-4 h-4 stroke-[2.5]" />
              Random Match
            </button>
          </div>
        </div>
      )}

      {/* Selling Points Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl border-t border-[#E4E2DD]/85 pt-8">
        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-lavender/35 rounded-lg flex items-center justify-center mb-2 text-indigo-600 shadow-xxs">
            <Shield className="w-4 h-4" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">Anonymous</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">No accounts, phone numbers, or profiles stored.</p>
        </div>

        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-peach/35 rounded-lg flex items-center justify-center mb-2 text-brand-coral shadow-xxs">
            <Clock className="w-4 h-4" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">Temporary</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">Rooms disappear when empty or when expired.</p>
        </div>

        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-mint/35 rounded-lg flex items-center justify-center mb-2 text-emerald-600 shadow-xxs">
            <Shield className="w-4 h-4" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">Encrypted</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">Timed messages use client-side AES-GCM encryption.</p>
        </div>

        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-blue/35 rounded-lg flex items-center justify-center mb-2 text-sky-600 shadow-xxs">
            <Zap className="w-4 h-4" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">P2P Mesh</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">Direct browser-to-browser WebRTC connection.</p>
        </div>
      </div>

      {/* FAQ Section for SEO and User Information */}
      <div className="w-full max-w-3xl mt-12 border-t border-[#E4E2DD]/85 pt-8 text-left">
        <h3 className="text-sm font-black uppercase tracking-widest text-primaryText mb-6 text-center">Frequently Asked Questions</h3>
        <div className="space-y-4">
          <details className="group border border-[#E4E2DD] rounded-2xl bg-surface p-4 transition-all duration-200 open:shadow-sm">
            <summary className="flex items-center justify-between cursor-pointer font-bold text-xs text-primaryText select-none list-none [&::-webkit-details-marker]:hidden">
              <span>What is Nuke Chat and how does it work?</span>
              <span className="transition-transform duration-200 group-open:rotate-180 text-secondaryText">▼</span>
            </summary>
            <p className="mt-3 text-[11px] text-secondaryText leading-relaxed">
              Nuke Chat is a secure, temporary, and completely anonymous communication tool that doesn't retain logs, histories, or user accounts. You can create a room or join one with a unique room code, type under an automatically generated identity, and discard the room whenever you're done.
            </p>
          </details>

          <details className="group border border-[#E4E2DD] rounded-2xl bg-surface p-4 transition-all duration-200 open:shadow-sm">
            <summary className="flex items-center justify-between cursor-pointer font-bold text-xs text-primaryText select-none list-none [&::-webkit-details-marker]:hidden">
              <span>Are my chat messages encrypted and private?</span>
              <span className="transition-transform duration-200 group-open:rotate-180 text-secondaryText">▼</span>
            </summary>
            <p className="mt-3 text-[11px] text-secondaryText leading-relaxed">
              Yes, entirely. For Timed Chat rooms, all text messages are encrypted client-side using <strong>AES-256-GCM</strong>. The encryption keys are derived from the room code and salt, and are never transmitted to our servers. For P2P Chat rooms, files and messages are sent directly from browser to browser using WebRTC Data Channels.
            </p>
          </details>

          <details className="group border border-[#E4E2DD] rounded-2xl bg-surface p-4 transition-all duration-200 open:shadow-sm">
            <summary className="flex items-center justify-between cursor-pointer font-bold text-xs text-primaryText select-none list-none [&::-webkit-details-marker]:hidden">
              <span>What is the "Nuke" feature?</span>
              <span className="transition-transform duration-200 group-open:rotate-180 text-secondaryText">▼</span>
            </summary>
            <p className="mt-3 text-[11px] text-secondaryText leading-relaxed">
              The Nuke feature allows any participant in a room to initiate a vote to clear the chat. Once the vote passes (majority of active users agree), all chat records are permanently wiped from the server, client caches are cleared, and active WebSocket connections are immediately severed.
            </p>
          </details>

          <details className="group border border-[#E4E2DD] rounded-2xl bg-surface p-4 transition-all duration-200 open:shadow-sm">
            <summary className="flex items-center justify-between cursor-pointer font-bold text-xs text-primaryText select-none list-none [&::-webkit-details-marker]:hidden">
              <span>Do I need to sign up or download an app?</span>
              <span className="transition-transform duration-200 group-open:rotate-180 text-secondaryText">▼</span>
            </summary>
            <p className="mt-3 text-[11px] text-secondaryText leading-relaxed">
              No registration, emails, or phone numbers are ever required. Nuke Chat is a zero-account web application that runs directly in your browser. Since we do not track sessions, your privacy is protected by default.
            </p>
          </details>

          <details className="group border border-[#E4E2DD] rounded-2xl bg-surface p-4 transition-all duration-200 open:shadow-sm">
            <summary className="flex items-center justify-between cursor-pointer font-bold text-xs text-primaryText select-none list-none [&::-webkit-details-marker]:hidden">
              <span>How long do chat rooms stay active?</span>
              <span className="transition-transform duration-200 group-open:rotate-180 text-secondaryText">▼</span>
            </summary>
            <p className="mt-3 text-[11px] text-secondaryText leading-relaxed">
              When creating a room, you can select an expiration timer of 15 minutes, 30 minutes, 1 hour, or 2 hours. Once the timer ends, the room and its messages are permanently destroyed. P2P mesh chat rooms also auto-destroy as soon as the last active user leaves.
            </p>
          </details>
        </div>
      </div>

      {/* Legal Footer */}
      <footer className="mt-8 text-[10px] text-secondaryText/60 flex items-center justify-center gap-3">
        <a href="#/privacy" className="hover:text-primaryText underline transition-colors">Privacy Policy</a>
        <span className="w-1 h-1 rounded-full bg-secondaryText/45" />
        <a href="#/terms" className="hover:text-primaryText underline transition-colors">Terms of Service</a>
      </footer>
    </div>
  );
};
