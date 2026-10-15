import React, { useState } from "react";
import { ArrowLeft, Loader2, Shuffle, Zap } from "lucide-react";

interface JoinRoomProps {
  onBackClick: () => void;
  onJoinRoom: (roomCode: string) => void;
  onJoinOfflineSubmit?: (roomCode: string) => void;
  offlineCandidateCode?: string | null;
  onRandomClick: () => void;
  isJoining: boolean;
  errorMessage: string | null;
}

export const JoinRoom: React.FC<JoinRoomProps> = ({
  onBackClick,
  onJoinRoom,
  onJoinOfflineSubmit,
  offlineCandidateCode,
  onRandomClick,
  isJoining,
  errorMessage,
}) => {
  const [code, setCode] = useState("");
  const [hostIp, setHostIp] = useState(() => {
    return (typeof localStorage !== "undefined" && localStorage.getItem("nukechat_custom_host_ip")) || "";
  });
  const [showAdvancedLan, setShowAdvancedLan] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow ONLY numbers (no alphabets, no special characters), max 6 digits
    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    if (hostIp.trim() && typeof localStorage !== "undefined") {
      localStorage.setItem("nukechat_custom_host_ip", hostIp.trim());
    }
    onJoinRoom(code.trim());
  };

  return (
    <div className="max-w-md mx-auto px-6 py-12 md:py-20 w-full select-none animate-fadeIn">
      {/* Back button */}
      <button
        onClick={onBackClick}
        disabled={isJoining}
        className="group flex items-center gap-2 text-secondaryText hover:text-primaryText font-semibold text-xs tracking-wide uppercase transition-colors mb-8 disabled:opacity-50"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Back to Home
      </button>

      <div className="bg-surface border border-[#E4E2DD] p-6 sm:p-8 rounded-3xl shadow-lg shadow-black/5">
        <h2 className="text-2xl font-bold tracking-tight text-primaryText mb-1.5">Join a Chat Room</h2>
        <p className="text-xs text-secondaryText mb-6 leading-relaxed">Enter a 6-digit room code to join an existing session.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Room Code Input */}
          <div>
            <label className="block text-xxs font-bold uppercase tracking-wider text-secondaryText mb-2.5">
              Room Code
            </label>
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
              placeholder="E.G. 849201"
              required
              disabled={isJoining}
              autoFocus
              className="w-full px-5 py-4 border-2 border-[#E4E2DD] focus:border-indigo-500 rounded-2xl text-center text-xl font-black tracking-widest placeholder:tracking-normal placeholder:font-bold outline-none transition-all disabled:opacity-50 bg-[#EEF2F6]/50 focus:bg-surface"
            />
          </div>

          {/* Error Message with Offline Action (shown only AFTER user clicks join) */}
          {(errorMessage || (offlineCandidateCode && offlineCandidateCode === code)) && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs font-medium space-y-2.5 animate-fadeIn text-left">
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
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs tracking-wider uppercase rounded-xl shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Zap className="w-4 h-4 fill-white text-white" />
                  <span>⚡ Join Offline ({offlineCandidateCode})</span>
                </button>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={isJoining || !code.trim()}
              className="w-full py-3.5 bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-xs tracking-wider uppercase rounded-full shadow-md shadow-indigo-600/10 disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] active:translate-y-[1px] transition-all duration-200"
            >
              {isJoining ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                "JOIN CHAT"
              )}
            </button>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-[#E4E2DD]"></div>
              <span className="flex-shrink mx-4 text-[10px] font-bold text-secondaryText/85 uppercase tracking-widest">or</span>
              <div className="flex-grow border-t border-[#E4E2DD]"></div>
            </div>

            <button
              type="button"
              onClick={onRandomClick}
              disabled={isJoining}
              className="w-full py-3 border border-brand-blue/80 text-sky-600 hover:bg-brand-blue/15 font-semibold text-xs tracking-wider uppercase rounded-full flex items-center justify-center gap-2 active:scale-[0.98] active:translate-y-[1px] transition-all duration-200 disabled:opacity-50"
            >
              <Shuffle className="w-4 h-4 stroke-[2.5]" />
              Match Random Chat
            </button>

            {/* Offline Local Wi-Fi Quick Join Section */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-left space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1.5">
                  ⚡ Offline LAN Mode
                </span>
                <button
                  type="button"
                  onClick={() => setShowAdvancedLan(!showAdvancedLan)}
                  className="text-[10px] text-amber-700 underline font-semibold cursor-pointer"
                >
                  {showAdvancedLan ? "Hide Host IP" : "Set Host Laptop IP"}
                </button>
              </div>

              {showAdvancedLan ? (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-[10px] uppercase font-bold text-neutral-500">
                    Host Laptop IP (e.g. 192.168.1.15)
                  </label>
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value)}
                    placeholder="192.168.1.15"
                    className="w-full px-3 py-2 text-xs border border-amber-500/40 rounded-xl bg-white focus:outline-none focus:border-amber-600 font-mono text-black"
                  />
                  <p className="text-[9px] text-neutral-500 leading-snug">
                    If joining from a phone on the same Wi-Fi router, enter the IP shown on the presenter&apos;s screen.
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-neutral-600 leading-snug">
                  Both devices on the same Wi-Fi router? Enter the 6-digit code above. If joining from a phone, tap &quot;Set Host Laptop IP&quot; to connect directly.
                </p>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
