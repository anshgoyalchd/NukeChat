import React, { useState } from "react";
import { ArrowLeft, Loader2, Shuffle } from "lucide-react";

interface JoinRoomProps {
  onBackClick: () => void;
  onJoinRoom: (roomCode: string) => void;
  onRandomClick: () => void;
  isJoining: boolean;
  errorMessage: string | null;
}

export const JoinRoom: React.FC<JoinRoomProps> = ({
  onBackClick,
  onJoinRoom,
  onRandomClick,
  isJoining,
  errorMessage,
}) => {
  const [code, setCode] = useState("");

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    // Keep only letters, numbers and hyphens
    val = val.replace(/[^A-Z0-9-]/g, "");
    setCode(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
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
        <p className="text-xs text-secondaryText mb-6 leading-relaxed">Enter a room code to join an existing Timed or P2P session.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Room Code Input */}
          <div>
            <label className="block text-xxs font-bold uppercase tracking-wider text-secondaryText mb-2.5">
              Room Code
            </label>
            <input
              type="text"
              value={code}
              onChange={handleInputChange}
              placeholder="E.G. MANGO-42"
              required
              disabled={isJoining}
              autoFocus
              className="w-full px-5 py-4 border-2 border-[#E4E2DD] focus:border-indigo-500 rounded-2xl text-center text-xl font-black tracking-widest placeholder:tracking-normal placeholder:font-bold outline-none transition-all disabled:opacity-50 bg-[#EEF2F6]/50 focus:bg-surface"
            />
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-4 bg-brand-peach/30 border border-brand-coral/20 text-xs text-brand-coral rounded-2xl font-medium animate-fadeIn">
              ⚠️ {errorMessage}
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
          </div>
        </form>
      </div>
    </div>
  );
};
