import React, { useState, useEffect, useRef } from "react";
import { Send, Users, Bomb, ArrowLeft, Paperclip, ShieldAlert, FileText, Image, Video, Download, Link2, Check, RotateCw } from "lucide-react";
import { ParticipantPanel } from "./ParticipantPanel";
import { UIMessage } from "./ActiveRoom";
import { TextMessageBody, MessageCopyButton } from "./TextMessageBody";

interface P2PChatProps {
  roomCode: string;
  participants: Array<{ id: string; identity: string; avatar: string }>;
  mySessionId: string;
  messages: UIMessage[];
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onDownloadFile: (fileId: string, senderId: string) => void;
  onNukeClick: () => void;
  onLeaveClick: () => void;
  onReconnect?: () => void;
  nukeVotesState: { votesCount: number; neededVotes: number };
  activePeers: Record<string, { identity: string; avatar: string; state: string }>;
  fileProgress: Record<string, { name: string; progress: number; total: number; isSending: boolean }>;
  isConnected: boolean;
}

export const P2PChat: React.FC<P2PChatProps> = ({
  roomCode,
  participants,
  mySessionId,
  messages,
  onSendMessage,
  onSendFile,
  onDownloadFile,
  onNukeClick,
  onLeaveClick,
  onReconnect,
  nukeVotesState,
  activePeers,
  fileProgress,
  isConnected,
}) => {
  const [inputText, setInputText] = useState("");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, fileProgress]);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onSendFile(files[0]);
    }
  };

  const handleCopyLink = () => {
    const inviteUrl = `${window.location.origin}/#/join/${roomCode}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1500);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Helper: check if we are in a connecting loop with zero actual RTC channels open
  const openChannels = Object.values(activePeers).filter(
    (p) => p.state === "connected" || p.state === "completed"
  ).length;

  return (
    <div className="flex flex-col h-[100dvh] bg-[#F8F7F4] w-full animate-fadeIn font-sans">
      {/* Header with Glassmorphic design */}
      <header className="px-4 py-3 bg-surface/85 backdrop-blur-md border-b border-[#E4E2DD] flex items-center justify-between shrink-0 sticky top-0 z-30 shadow-sm shadow-black/2 font-sans select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfirmLeave(true)}
            className="p-1.5 hover:bg-black/5 rounded-full transition-all active:scale-95 shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-secondaryText" />
          </button>
          
          <div>
            <h1 className="font-extrabold text-base tracking-tight text-primaryText flex items-center gap-1.5 leading-none select-text">
              {roomCode}
              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy classroom join link"
                className="p-1 hover:bg-black/5 rounded text-secondaryText hover:text-primaryText transition-all duration-200 active:scale-90 select-none"
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Link2 className="w-3.5 h-3.5" />
                )}
              </button>
              <span className="flex h-2 w-2 relative select-none">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${openChannels > 0 ? "bg-emerald-400" : "bg-orange-400"}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${openChannels > 0 ? "bg-emerald-500" : "bg-orange-500"}`} />
              </span>
            </h1>
            <p className="text-[10px] font-bold text-secondaryText flex items-center gap-1 mt-0.5 uppercase tracking-wide">
              <span className="px-2 py-0.5 bg-brand-mint text-emerald-800 font-extrabold rounded-full mr-1 shrink-0">P2P MESH</span>
              {openChannels} peer{openChannels !== 1 && "s"} connected
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

          <button
            onClick={onNukeClick}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-coral hover:bg-brand-coral/95 text-white font-bold text-xxs tracking-wider uppercase rounded-full shadow-md shadow-brand-coral/10 transition-all duration-200 active:scale-95"
          >
            <Bomb className="w-3.5 h-3.5" />
            <span>NUKE IT</span>
          </button>
        </div>
      </header>

      {/* Connection loop warning when no signaling active */}
      {isConnected && openChannels === 0 && (
        participants.length > 1 ? (
          <div className="bg-[#FFFBEB] border-b border-[#FDE68A] px-4 py-2 text-center text-xs font-bold text-amber-800 flex items-center justify-center gap-3 shrink-0 select-none animate-fadeIn">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 animate-pulse" />
              <span>Connecting P2P direct mesh...</span>
            </div>
            {onReconnect && (
              <button
                type="button"
                onClick={onReconnect}
                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-lg text-xxs font-extrabold uppercase tracking-wider flex items-center gap-1 transition-all active:scale-95 shadow-xxs"
              >
                <RotateCw className="w-3 h-3" />
                Reconnect
              </button>
            )}
          </div>
        ) : (
          <div className="bg-[#FFFBEB] border-b border-[#FDE68A] px-4 py-2.5 text-center text-xs font-bold text-amber-700 flex items-center justify-center gap-2 shrink-0 select-none">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600" />
            Waiting for other participants to join room {roomCode} via WebRTC Signaling...
          </div>
        )
      )}

      {/* Nuke Voting Banner */}
      {nukeVotesState.votesCount > 0 && (
        <div className="bg-brand-peach/40 border-b border-brand-peach/60 px-4 py-2.5 text-center text-xs font-bold text-brand-coral flex items-center justify-center gap-2 animate-pulse shrink-0 select-none">
          <span>☢️</span> NUKE VOTE IN PROGRESS: {nukeVotesState.votesCount} OF {nukeVotesState.neededVotes} VOTES CAST
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex flex-col items-center justify-center py-6 text-center text-xxs text-secondaryText/90 space-y-1 bg-[#EEF2F6]/30 rounded-2xl border border-[#E4E2DD]/40 p-4 max-w-lg mx-auto select-none">
          <p>⚡ Direct P2P Mode. Files and messages are sent directly between peers.</p>
          <p>⚠️ No server logs or backups exist. If the sender leaves, their files vanish immediately.</p>
        </div>

        {messages.map((m) => {
          const isMe = m.senderId === mySessionId;
          const isFile = !!m.file;

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
                <span className={`text-[10px] font-bold text-secondaryText mb-1 px-1 select-none ${isMe ? "text-right" : "text-left"}`}>
                  {m.senderName}
                </span>
                
                {isFile && m.file ? (
                  // File Balloon Card
                  <div className="bg-surface border border-[#E4E2DD] p-4 rounded-2xl rounded-tr-none flex flex-col gap-3 min-w-[220px] max-w-sm shadow-sm select-none">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-brand-blue/40 text-sky-700 rounded-xl border border-brand-blue/60 shrink-0 shadow-xxs">
                        {m.file.mimeType.startsWith("image/") ? (
                          <Image className="w-5 h-5" />
                        ) : m.file.mimeType.startsWith("video/") ? (
                          <Video className="w-5 h-5" />
                        ) : (
                          <FileText className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-xs truncate text-primaryText leading-none mb-1">{m.file.name}</p>
                        <p className="text-[10px] text-secondaryText font-medium">{formatBytes(m.file.size)}</p>
                      </div>
                    </div>
                    
                    {/* Media Previews (when blobUrl is available) */}
                    {m.file.blobUrl && m.file.mimeType.startsWith("image/") && (
                      <div className="rounded-xl overflow-hidden border border-[#E4E2DD] max-h-48 shadow-xxs">
                        <img src={m.file.blobUrl} alt={m.file.name} className="w-full h-full object-cover" />
                      </div>
                    )}
                    
                    {m.file.blobUrl && m.file.mimeType.startsWith("video/") && (
                      <video src={m.file.blobUrl} controls className="rounded-xl border border-[#E4E2DD] max-h-48 shadow-xxs" />
                    )}

                    {/* Transfer Progress if actively sending/receiving this file */}
                    {fileProgress[m.file.fileId] && (
                      <div className="flex flex-col gap-1.5 py-1">
                        <div className="flex justify-between items-center text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                          <span>{fileProgress[m.file.fileId].isSending ? "Uploading..." : "Downloading via P2P..."}</span>
                          <span>{Math.round((fileProgress[m.file.fileId].progress / fileProgress[m.file.fileId].total) * 100)}%</span>
                        </div>
                        <div className="w-full bg-[#EEF2F6] h-2 rounded-full overflow-hidden border border-[#E4E2DD]">
                          <div
                            className="bg-indigo-600 h-full rounded-full transition-all duration-200"
                            style={{ width: `${Math.min(100, Math.round((fileProgress[m.file.fileId].progress / fileProgress[m.file.fileId].total) * 100))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Action Button: Download from Peer VS Save Downloaded File */}
                    {m.file.blobUrl ? (
                      <a
                        href={m.file.blobUrl}
                        download={m.file.name}
                        className="w-full py-2.5 bg-brand-blue/40 hover:bg-brand-blue/60 text-sky-900 font-extrabold rounded-xl text-[10px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors active:scale-98"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {isMe ? "Save File Copy" : "Download File"}
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled={!!fileProgress[m.file.fileId]}
                        onClick={() => onDownloadFile(m.file!.fileId, m.senderId)}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-extrabold rounded-xl text-[10px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors active:scale-98 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {fileProgress[m.file.fileId] ? "Downloading via P2P..." : "Download via P2P"}
                      </button>
                    )}
                  </div>
                ) : (
                  // Text Balloon
                  <div
                    className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-xxs break-words ${
                      isMe
                        ? "bg-brand-lavender text-primaryText rounded-tr-none"
                        : "bg-surface text-primaryText border border-[#E4E2DD]/80 rounded-tl-none"
                    }`}
                  >
                    <TextMessageBody text={m.text || ""} isMe={isMe} />
                  </div>
                )}
                
                <div className={`flex items-center gap-1.5 text-[9px] text-secondaryText/70 mt-1 px-1 select-none ${isMe ? "justify-end" : "justify-start"}`}>
                  <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {m.text && <MessageCopyButton text={m.text} />}
                </div>
              </div>
            </div>
          );
        })}

        {/* Dynamic File Progress Indicators */}
        {Object.entries(fileProgress).map(([peerId, info]) => (
          <div key={peerId} className="bg-surface border border-[#E4E2DD] p-4 rounded-2xl shadow-md max-w-sm mx-auto flex flex-col gap-2 select-none animate-fadeIn">
            <div className="flex justify-between items-center text-[10px] font-bold text-secondaryText uppercase tracking-wider">
              <span>{info.isSending ? "Sending File" : "Receiving File"}</span>
              <span>{Math.round((info.progress / info.total) * 100)}%</span>
            </div>
            <div className="text-xs font-bold truncate text-primaryText">{info.name}</div>
            <div className="w-full bg-[#EEF2F6] h-2 rounded-full overflow-hidden border border-[#E4E2DD]">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${(info.progress / info.total) * 100}%` }}
              />
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Input Area */}
      <form onSubmit={handleSend} className="p-3 bg-surface border-t border-[#E4E2DD] flex gap-2 items-center shrink-0 select-none">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-3.5 bg-[#EEF2F6] hover:bg-[#E2E8F0] text-secondaryText hover:text-primaryText rounded-2xl transition-all active:scale-95 shrink-0 shadow-xxs"
        >
          <Paperclip className="w-4 h-4 stroke-[2.5]" />
        </button>

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a direct P2P message..."
          rows={1}
          autoFocus
          className="flex-1 px-4 py-3 bg-[#EEF2F6]/60 border border-[#E4E2DD] focus:border-indigo-500 rounded-2xl text-sm outline-none resize-none max-h-24 font-normal leading-relaxed focus:bg-surface transition-all select-text"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fadeIn select-none">
          <div className="bg-surface border border-[#E4E2DD] p-6 sm:p-8 rounded-3xl max-w-sm w-full text-center shadow-2xl">
            <h3 className="text-xl font-bold text-primaryText mb-2 tracking-tight">Leave Chat?</h3>
            <p className="text-xs text-secondaryText mb-6 leading-relaxed">
              Leaving the direct mesh network will instantly tear down all local WebRTC channels.
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
