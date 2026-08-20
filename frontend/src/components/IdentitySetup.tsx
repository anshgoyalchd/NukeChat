import React, { useState } from "react";
import { RefreshCw, ArrowLeft, Users } from "lucide-react";

interface IdentitySetupProps {
  onBackClick: () => void;
  identityName: string;
  avatarUrl: string;
  onRegenerate: () => void;
  onConfirm: () => void;
  roomCode: string;
  roomType: "timed" | "p2p";
  isConnecting: boolean;
}

export const IdentitySetup: React.FC<IdentitySetupProps> = ({
  onBackClick,
  identityName,
  avatarUrl,
  onRegenerate,
  onConfirm,
  roomCode,
  roomType,
  isConnecting,
}) => {
  const [isRotating, setIsRotating] = useState(false);

  const handleRegenerate = () => {
    setIsRotating(true);
    onRegenerate();
    setTimeout(() => setIsRotating(false), 500);
  };

  return (
    <div className="max-w-md mx-auto px-6 py-6 md:py-10 flex flex-col justify-center min-h-[90dvh] w-full select-none animate-fadeIn">
      {/* Back button */}
      <button
        onClick={onBackClick}
        disabled={isConnecting}
        className="group flex items-center gap-2 text-secondaryText hover:text-primaryText font-semibold text-xs tracking-wide uppercase transition-colors mb-6 disabled:opacity-50"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Cancel Join
      </button>

      <div className="bg-surface border border-[#E4E2DD] p-6 sm:p-8 rounded-3xl shadow-lg shadow-black/5 text-center space-y-5">
        <h2 className="text-xl font-bold tracking-tight text-primaryText mb-1">Confirm Room Entry</h2>
        
        {/* Card 1: Room Details (Clearly Labeled) */}
        <div className="p-4 bg-[#EEF2F6] rounded-2xl border border-[#E4E2DD]/80 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondaryText mb-1">ROOM CODE</p>
          <p className="text-2xl font-black tracking-widest text-[#4F46E5]">{roomCode}</p>
          <span className="inline-block mt-1 px-2.5 py-0.5 text-[9px] bg-brand-blue/50 text-sky-800 font-extrabold rounded-full uppercase tracking-wider">
            {roomType} CHAT
          </span>
        </div>

        {/* Card 2: Your Anonymous Profile (Clearly Labeled) */}
        <div className="bg-surface border border-[#E4E2DD] p-5 rounded-2xl flex flex-col items-center shadow-xxs">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondaryText mb-3">YOUR ANONYMOUS ALIAS</p>
          <div className="w-20 h-20 mb-3 select-none pointer-events-none rounded-2xl overflow-hidden shadow-md shadow-black/5 border border-[#E4E2DD] p-0.5 bg-white hover:scale-105 transition-transform duration-300">
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover rounded-xl" />
          </div>
          <h3 className="text-base font-bold text-primaryText tracking-tight">{identityName}</h3>
          <span className="text-[9px] text-secondaryText/80 font-bold uppercase tracking-wider mt-0.5">Temporary Nickname</span>
        </div>

        {/* Actions */}
        <div className="space-y-3 pt-1">
          <button
            onClick={onConfirm}
            disabled={isConnecting}
            className="w-full py-3 bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-xs tracking-wider uppercase rounded-full shadow-md shadow-indigo-600/10 disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] active:translate-y-[1px] transition-all duration-200"
          >
            <Users className="w-4 h-4" />
            ENTER CHAT ROOM
          </button>

          <button
            onClick={handleRegenerate}
            disabled={isConnecting}
            className="w-full py-2.5 border border-[#E4E2DD] hover:bg-black/5 text-primaryText font-semibold text-xs tracking-wider uppercase rounded-full flex items-center justify-center gap-2 active:scale-[0.98] active:translate-y-[1px] transition-all duration-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 transition-transform duration-500 ${isRotating ? "rotate-180" : ""}`} />
            Generate Different Alias
          </button>
        </div>
      </div>
    </div>
  );
};
