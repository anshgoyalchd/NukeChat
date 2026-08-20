import React from "react";
import { X, Users } from "lucide-react";

interface ParticipantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Array<{ id: string; identity: string; avatar: string }>;
  mySessionId: string;
}

export const ParticipantPanel: React.FC<ParticipantPanelProps> = ({
  isOpen,
  onClose,
  participants,
  mySessionId,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end animate-fadeIn select-none">
      {/* Backdrop with frosted blur */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />

      {/* Drawer Body */}
      <div className="relative w-full max-w-sm bg-surface h-full shadow-2xl flex flex-col border-l border-[#E4E2DD] animate-slideInRight">
        {/* Header */}
        <div className="p-6 border-b border-[#E4E2DD] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-secondaryText" />
            <h3 className="font-extrabold text-base tracking-tight text-primaryText">In This Chat</h3>
            <span className="bg-[#EEF2F6] text-primaryText px-2.5 py-0.5 rounded-full text-xxs font-bold">
              {participants.length}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 rounded-full transition-colors active:scale-90">
            <X className="w-5 h-5 text-secondaryText" />
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {participants.map((p) => {
            const isMe = p.id === mySessionId;
            return (
              <div key={p.id} className="flex items-center gap-4 bg-[#EEF2F6]/50 border border-[#E4E2DD]/80 p-3.5 rounded-2xl shadow-xxs">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 select-none bg-white border border-[#E4E2DD] p-0.5">
                  <img src={p.avatar} alt={p.identity} className="w-full h-full object-cover rounded-lg" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-primaryText truncate flex items-center gap-1.5">
                    {p.identity} 
                    {isMe && (
                      <span className="text-[9px] text-indigo-600 font-extrabold tracking-wider bg-[#E0E7FF] px-1.5 py-0.5 rounded-md uppercase">
                        YOU
                      </span>
                    )}
                  </h4>
                  <p className="text-[10px] font-bold text-secondaryText/80 uppercase tracking-widest mt-0.5">
                    {isMe ? "Active Session" : "Connected Peer"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
