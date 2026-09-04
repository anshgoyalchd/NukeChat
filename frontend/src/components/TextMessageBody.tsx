import React, { useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";

// Shared URL and Code-block renderer for students sharing links/scripts in classrooms
const renderUrlSegments = (text: string) => {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi);
  return parts.map((part, index) => {
    if (part.match(/^https?:\/\//i)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:text-indigo-800 underline break-all select-text font-semibold"
        >
          {part}
        </a>
      );
    } else if (part.match(/^www\./i)) {
      return (
        <a
          key={index}
          href={`https://${part}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:text-indigo-800 underline break-all select-text font-semibold"
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const renderTextWithLinks = (text: string) => {
  if (!text) return "";

  if (text.includes("```")) {
    const parts = text.split("```");
    return parts.map((part, index) => {
      // Even elements are standard text, odd elements are code blocks
      if (index % 2 === 1) {
        const lines = part.split("\n");
        let firstLine = lines[0].trim();
        let codeBody = part;
        const languages = [
          "python",
          "javascript",
          "typescript",
          "html",
          "css",
          "cpp",
          "java",
          "c",
          "rust",
          "go",
          "json",
          "bash",
          "sh",
          "sql",
        ];

        if (languages.includes(firstLine.toLowerCase())) {
          codeBody = lines.slice(1).join("\n");
        } else {
          firstLine = "code";
        }

        return (
          <div
            key={index}
            className="my-2.5 border border-[#E4E2DD] rounded-2xl overflow-hidden shadow-xxs max-w-full font-mono text-xs select-text bg-[#EEF2F6]/90"
          >
            <div className="flex items-center justify-between px-4 py-2 bg-[#EEF2F6] border-b border-[#E4E2DD] text-[10px] font-bold text-secondaryText/80 select-none">
              <span>{firstLine.toUpperCase()}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(codeBody.trim())}
                className="hover:text-indigo-600 transition-colors uppercase tracking-wider text-[9px]"
              >
                Copy Code
              </button>
            </div>
            <pre className="p-4 overflow-x-auto whitespace-pre leading-relaxed select-text text-left text-primaryText">
              <code>{codeBody.trim()}</code>
            </pre>
          </div>
        );
      }
      return renderUrlSegments(part);
    });
  }

  return renderUrlSegments(text);
};

export const MessageCopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy full message"
      className="opacity-70 hover:opacity-100 p-0.5 hover:bg-black/5 rounded transition-all active:scale-90 flex items-center gap-1 select-none"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
          <span className="text-[9px] text-emerald-600 font-bold">Copied</span>
        </>
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  );
};

interface TextMessageBodyProps {
  text: string;
  isMe: boolean;
}

export const TextMessageBody: React.FC<TextMessageBodyProps> = ({ text, isMe }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Long message threshold: more than 320 characters or more than 5 line breaks
  const isLong = text.length > 320 || (text.match(/\n/g) || []).length > 5;

  const handleCopyAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <div
        className={`overflow-hidden transition-all duration-300 ${
          isLong && !isExpanded ? "max-h-36 relative" : ""
        }`}
      >
        <div className="select-text whitespace-pre-wrap">{renderTextWithLinks(text)}</div>

        {/* Gradient fade overlay for collapsed long messages */}
        {isLong && !isExpanded && (
          <div
            className={`absolute bottom-0 inset-x-0 h-16 pointer-events-none bg-gradient-to-t ${
              isMe
                ? "from-brand-lavender via-brand-lavender/80 to-transparent"
                : "from-surface via-surface/80 to-transparent"
            }`}
          />
        )}
      </div>

      {/* Interactive Action Bar for long messages */}
      {isLong && (
        <div className="flex items-center justify-between gap-3 pt-2 mt-1 border-t border-black/5 select-none">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={`text-xs font-extrabold flex items-center gap-1 transition-colors ${
              isMe
                ? "text-indigo-700 hover:text-indigo-900"
                : "text-indigo-600 hover:text-indigo-800"
            }`}
          >
            <span>{isExpanded ? "Show less" : "Read more"}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 px-2 py-0.5 rounded-md transition-all active:scale-95 ${
              isMe ? "hover:bg-black/5 text-primaryText/80" : "hover:bg-black/5 text-secondaryText"
            }`}
            title="Copy full message text"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                <span className="text-emerald-600 font-bold">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy all</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
