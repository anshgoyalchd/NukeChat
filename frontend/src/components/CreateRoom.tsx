import React, { useState } from "react";
import { Clock, Shield, Users, ArrowLeft, Loader2 } from "lucide-react";
import { RoomType, RoomVisibility } from "../../../shared/types";

interface CreateRoomProps {
  onBackClick: () => void;
  onCreateRoom: (params: {
    type: RoomType;
    visibility: RoomVisibility;
    expiresInMinutes: number;
  }) => void;
  isCreating: boolean;
}

export const CreateRoom: React.FC<CreateRoomProps> = ({
  onBackClick,
  onCreateRoom,
  isCreating,
}) => {
  const [roomType, setRoomType] = useState<RoomType>("timed");
  const [expiresIn, setExpiresIn] = useState<number>(30); // minutes
  const [visibility, setVisibility] = useState<RoomVisibility>("private");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateRoom({
      type: roomType,
      visibility,
      expiresInMinutes: roomType === "timed" ? expiresIn : 120, // default P2P maximum
    });
  };

  return (
    <div className="max-w-md mx-auto px-6 py-6 md:py-10 flex flex-col justify-center min-h-[90dvh] w-full select-none animate-fadeIn">
      {/* Back button */}
      <button
        onClick={onBackClick}
        disabled={isCreating}
        className="group flex items-center gap-2 text-secondaryText hover:text-primaryText font-semibold text-xs tracking-wide uppercase transition-colors mb-6 disabled:opacity-50"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Back to Home
      </button>

      <div className="bg-surface border border-[#E4E2DD] p-6 rounded-3xl shadow-lg shadow-black/5">
        <h2 className="text-xl font-bold tracking-tight text-primaryText mb-5">Create a Chat Room</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Professional Segmented Control for Room Type */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-secondaryText mb-2">Room Type</label>
            <div className="bg-[#EEF2F6] p-1 rounded-2xl border border-[#E4E2DD] grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setRoomType("timed")}
                className={`py-2 text-[11px] font-bold rounded-xl transition-all duration-300 ${
                  roomType === "timed"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                    : "text-secondaryText hover:text-primaryText"
                }`}
              >
                Timed
              </button>
              <button
                type="button"
                onClick={() => setRoomType("p2p")}
                className={`py-2 text-[11px] font-bold rounded-xl transition-all duration-300 ${
                  roomType === "p2p"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                    : "text-secondaryText hover:text-primaryText"
                }`}
              >
                P2P Mesh
              </button>
              <button
                type="button"
                onClick={() => setRoomType("meet")}
                className={`py-2 text-[11px] font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1 ${
                  roomType === "meet"
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/10"
                    : "text-secondaryText hover:text-primaryText"
                }`}
              >
                <span>Local Meet</span>
                <span className="text-[9px] px-1 py-0.2 bg-emerald-500/30 rounded text-white font-black">LAN</span>
              </button>
            </div>
          </div>

          {/* Conditional Options for Timed Chat */}
          {roomType === "timed" ? (
            <div className="space-y-4 animate-fadeIn">
              {/* Expiration selection */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-secondaryText mb-2">Expires In</label>
                <div className="grid grid-cols-4 gap-1.5 bg-[#EEF2F6] p-1 rounded-full border border-[#E4E2DD]">
                  {[15, 30, 60, 120].map((mins) => {
                    const label = mins >= 60 ? `${mins / 60} hr${mins > 60 ? 's' : ''}` : `${mins} min`;
                    const isSelected = expiresIn === mins;
                    return (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setExpiresIn(mins)}
                        className={`py-1.5 text-[10px] font-bold rounded-full transition-all duration-200 ${
                          isSelected
                            ? "bg-surface text-primaryText shadow-sm"
                            : "text-secondaryText hover:text-primaryText"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Visibility selection */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-secondaryText mb-2">Visibility</label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Private */}
                  <button
                    type="button"
                    onClick={() => setVisibility("private")}
                    className={`flex items-center gap-3 p-3 rounded-2xl border-2 text-left active:scale-[0.98] transition-all duration-300 ${
                      visibility === "private"
                        ? "border-indigo-500 bg-[#EEF2F6]"
                        : "border-[#E4E2DD] hover:border-indigo-300"
                    }`}
                  >
                    <div className="w-7 h-7 bg-brand-peach/40 border border-brand-peach/60 rounded-lg flex items-center justify-center text-brand-coral shrink-0 shadow-xxs">
                      <Shield className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h5 className="font-bold text-xs text-primaryText leading-none mb-0.5">Private</h5>
                      <p className="text-[9px] text-secondaryText leading-none">Code required</p>
                    </div>
                  </button>

                  {/* Open */}
                  <button
                    type="button"
                    onClick={() => setVisibility("open")}
                    className={`flex items-center gap-3 p-3 rounded-2xl border-2 text-left active:scale-[0.98] transition-all duration-300 ${
                      visibility === "open"
                        ? "border-indigo-500 bg-[#EEF2F6]"
                        : "border-[#E4E2DD] hover:border-indigo-300"
                    }`}
                  >
                    <div className="w-7 h-7 bg-brand-blue/40 border border-brand-blue/60 rounded-lg flex items-center justify-center text-sky-600 shrink-0 shadow-xxs">
                      <Users className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h5 className="font-bold text-xs text-primaryText leading-none mb-0.5">Open</h5>
                      <p className="text-[9px] text-secondaryText leading-none">Public match</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ) : roomType === "meet" ? (
            /* Local Meet Classroom explanation */
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200/80 text-[11px] text-emerald-900 space-y-2 animate-fadeIn">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-emerald-200/80 text-emerald-800 font-extrabold text-[9px] rounded-full uppercase tracking-wider">
                  Offline Classroom LAN
                </span>
              </div>
              <p className="font-bold text-emerald-950 text-xs">Zero-Internet Screen & Audio Broadcast</p>
              <ul className="list-disc pl-4 space-y-1 text-[10px] text-emerald-800/90 leading-relaxed">
                <li>Streams teacher screen (slides, VS Code, PDFs) & microphone directly over local Wi-Fi.</li>
                <li>Uses <b>0 KB</b> internet data during the lecture.</li>
                <li>High-efficiency Star Topology supports up to <b>60 students</b> simultaneously.</li>
              </ul>
            </div>
          ) : (
            /* P2P explanation text */
            <div className="p-3.5 bg-brand-blue/20 rounded-2xl border border-brand-blue/40 text-[11px] text-secondaryText space-y-1.5 animate-fadeIn">
              <p className="font-bold text-primaryText uppercase tracking-wider text-[9px]">P2P Security Guidelines:</p>
              <ul className="list-disc pl-4 space-y-1 text-[10px] leading-relaxed">
                <li>Direct device-to-device media channels (no server storage).</li>
                <li>Your files are hosted from your device and vanish when you leave.</li>
                <li>Uses secure TURN servers for robust firewall traversal.</li>
              </ul>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={isCreating}
            className={`w-full py-3 font-semibold text-xs tracking-wider uppercase rounded-full shadow-md disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] active:translate-y-[1px] transition-all duration-200 ${
              roomType === "meet"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10"
                : "bg-[#6366F1] hover:bg-[#4F46E5] text-white shadow-indigo-600/10"
            }`}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating Room...
              </>
            ) : roomType === "meet" ? (
              "START LOCAL MEET"
            ) : (
              "CREATE CHAT"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
