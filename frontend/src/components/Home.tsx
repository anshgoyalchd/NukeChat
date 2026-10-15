import React, { useState } from "react";
import { Shield, Clock, Zap, Shuffle, Plus, ArrowRight, Activity, Loader2, KeyRound, Download } from "lucide-react";
import { usePWAInstall } from "../hooks/usePWAInstall";

interface HomeProps {
  onCreateClick: () => void;
  onRandomClick: () => void;
  onJoinSubmit: (code: string) => void;
  onJoinOfflineSubmit?: (code: string) => void;
  offlineCandidateCode?: string | null;
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
  onJoinOfflineSubmit,
  offlineCandidateCode,
  activeRoomCode,
  onRejoinClick,
  onLeaveSessionClick,
  isJoining,
  errorMessage,
}) => {
  const [code, setCode] = useState("");

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow ONLY numbers (no alphabets, no special characters), max 6 digits
    const cleaned = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(cleaned);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    onJoinSubmit(code.trim());
  };

  const { canInstall, installApp, showIOSTooltip, setShowIOSTooltip, isIOS } = usePWAInstall();

  return (
    <div className="flex flex-col items-center justify-center min-h-[90dvh] px-4 py-8 max-w-4xl mx-auto text-center font-sans select-none animate-fadeIn">
      {/* Branding Tag & PWA Install Button */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 mb-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-peach/40 border border-brand-coral/20 text-brand-coral text-xs font-black uppercase tracking-wider shadow-xxs">
          <span>💥</span>
          <span>NUKE CHAT</span>
        </div>

        {canInstall && (
          <div className="relative">
            <button
              type="button"
              onClick={installApp}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-surface border border-indigo-200 hover:border-indigo-400 text-indigo-600 hover:text-indigo-700 text-xs font-bold transition-all shadow-xxs active:scale-95 cursor-pointer"
              title="Install Nuke Chat app for 100% offline access"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install App</span>
            </button>

            {isIOS && showIOSTooltip && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-64 p-3 bg-neutral-900 text-white text-[11px] rounded-2xl shadow-2xl z-50 text-left border border-neutral-700 animate-fadeIn">
                <div className="flex items-center justify-between mb-1 font-bold">
                  <span>Install on iPhone/iPad</span>
                  <button
                    type="button"
                    onClick={() => setShowIOSTooltip(false)}
                    className="text-neutral-400 hover:text-white px-1"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-neutral-300 leading-snug">
                  Tap the <span className="font-bold text-white">Share (⎙)</span> icon at the bottom of Safari, then select <span className="font-bold text-white">"Add to Home Screen"</span>.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Hero Header */}
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-primaryText tracking-tight mb-3">
        Nuke Chat: Talk. Share. <br className="hidden sm:inline" />
        <span className="text-brand-coral">Nuke It.</span>
      </h1>

      {/* Description Text */}
      <p className="text-secondaryText text-xs sm:text-sm max-w-lg mb-8 leading-relaxed font-medium">
        Nuke Chat provides secure, temporary, and anonymous messaging rooms for people who don't want permanent conversation histories. Zero signup, zero tracking.
      </p>

      {/* Active Session Warning or Join Action Area */}
      {activeRoomCode ? (
        /* Rejoin / Active Session Card */
        <div className="w-full max-w-sm mb-8 bg-surface border border-[#E4E2DD] p-5 rounded-3xl shadow-lg shadow-black/3 text-center animate-scaleUp">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-indigo-100">
            <Activity className="w-5 h-5" aria-hidden="true" />
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
              <div className="flex gap-2 relative">
                <div className="relative flex-1 flex items-center">
                  <KeyRound className="w-4 h-4 text-secondaryText/50 absolute left-3.5 pointer-events-none" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      // Do not let user enter any alphabet or special char, only numbers
                      if (
                        !/[\d]/.test(e.key) &&
                        !["Backspace", "Tab", "Enter", "ArrowLeft", "ArrowRight", "Delete"].includes(e.key) &&
                        !e.ctrlKey &&
                        !e.metaKey
                      ) {
                        e.preventDefault();
                      }
                    }}
                    placeholder="e.g. 849201"
                    disabled={isJoining}
                    aria-label="Room Code"
                    className="w-full pl-10 pr-3 py-2.5 border-2 border-[#E4E2DD] focus:border-indigo-500 rounded-2xl text-left text-sm font-bold tracking-wider outline-none bg-[#EEF2F6]/50 focus:bg-surface transition-all placeholder:normal-case placeholder:font-medium placeholder:tracking-normal placeholder:text-secondaryText/40"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!code.trim() || isJoining}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-2xl shadow-md shadow-indigo-600/10 disabled:opacity-50 transition-all active:scale-95 shrink-0 flex items-center justify-center min-w-[70px]"
                >
                  {isJoining ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    "JOIN"
                  )}
                </button>
              </div>
            </div>

            {/* Error Message inside Card with Offline Recovery Action (shown only AFTER clicking join) */}
            {(errorMessage || (offlineCandidateCode && offlineCandidateCode === code)) && (
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs font-medium text-left leading-normal space-y-2.5 animate-fadeIn">
                {errorMessage && (
                  <div className="flex items-start gap-1.5 text-amber-950 font-medium leading-relaxed">
                    <span className="shrink-0 font-bold text-amber-600">⚠️</span>
                    <span>{errorMessage}</span>
                  </div>
                )}
                {offlineCandidateCode && onJoinOfflineSubmit && (
                  <button
                    type="button"
                    onClick={() => onJoinOfflineSubmit(offlineCandidateCode)}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs tracking-wider uppercase rounded-xl shadow-md shadow-amber-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-4 h-4 fill-white text-white" />
                    <span>⚡ Join Offline ({offlineCandidateCode})</span>
                  </button>
                )}
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
              <Plus className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              Create Room
            </button>

            {/* Random Match */}
            <button
              onClick={onRandomClick}
              disabled={isJoining}
              className="flex-1 py-3.5 bg-gradient-to-r from-sky-50 to-sky-100/70 text-sky-700 border border-sky-200/50 hover:from-sky-100/80 hover:to-sky-200/70 rounded-full font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm shadow-sky-100 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <Shuffle className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              Random Match
            </button>
          </div>
        </div>
      )}

      {/* Selling Points Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl border-t border-[#E4E2DD]/85 pt-8">
        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-lavender/35 rounded-lg flex items-center justify-center mb-2 text-indigo-600 shadow-xxs">
            <Shield className="w-4 h-4" aria-hidden="true" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">Anonymous</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">No accounts, phone numbers, or profiles stored.</p>
        </div>

        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-peach/35 rounded-lg flex items-center justify-center mb-2 text-brand-coral shadow-xxs">
            <Clock className="w-4 h-4" aria-hidden="true" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">Temporary</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">Rooms disappear when empty or when expired.</p>
        </div>

        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-mint/35 rounded-lg flex items-center justify-center mb-2 text-emerald-600 shadow-xxs">
            <Shield className="w-4 h-4" aria-hidden="true" />
          </div>
          <h4 className="font-extrabold text-xs text-primaryText mb-0.5 tracking-tight">Encrypted</h4>
          <p className="text-[10px] text-secondaryText leading-relaxed max-w-[140px]">Timed messages use client-side AES-GCM encryption.</p>
        </div>

        <div className="flex flex-col items-center text-center p-2">
          <div className="w-8 h-8 bg-brand-blue/35 rounded-lg flex items-center justify-center mb-2 text-sky-600 shadow-xxs">
            <Zap className="w-4 h-4" aria-hidden="true" />
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
        <a href="#/blog" className="hover:text-primaryText underline transition-colors">Blog</a>
        <span className="w-1 h-1 rounded-full bg-secondaryText/45" />
        <a href="#/privacy" className="hover:text-primaryText underline transition-colors">Privacy Policy</a>
        <span className="w-1 h-1 rounded-full bg-secondaryText/45" />
        <a href="#/terms" className="hover:text-primaryText underline transition-colors">Terms of Service</a>
      </footer>
    </div>
  );
};
