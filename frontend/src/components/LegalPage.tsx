import React from "react";
import { ArrowLeft, ShieldCheck, FileText, Ban, Trash2 } from "lucide-react";

interface LegalPageProps {
  type: "privacy" | "terms";
  onBack: () => void;
}

export const LegalPage: React.FC<LegalPageProps> = ({ type, onBack }) => {
  const isPrivacy = type === "privacy";

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 md:py-12 w-full select-none animate-fadeIn">
      {/* Back button */}
      <button
        onClick={onBack}
        className="group flex items-center gap-2 text-secondaryText hover:text-primaryText font-semibold text-xs tracking-wide uppercase transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Back
      </button>

      <div className="bg-surface border border-[#E4E2DD] p-6 sm:p-8 rounded-3xl shadow-lg shadow-black/5">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#E4E2DD]/85">
          <div className="w-10 h-10 bg-brand-peach/30 text-brand-coral rounded-xl flex items-center justify-center shadow-xxs">
            {isPrivacy ? <ShieldCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-primaryText">
              {isPrivacy ? "Privacy & Data Policy" : "Terms of Service"}
            </h1>
            <p className="text-xxs text-secondaryText uppercase tracking-widest mt-0.5 font-bold">
              {isPrivacy ? "NukeChat Data Practices" : "NukeChat Agreement"}
            </p>
          </div>
        </div>

        {isPrivacy ? (
          /* Privacy Content */
          <div className="space-y-6 text-sm text-secondaryText leading-relaxed">
            <section className="space-y-2">
              <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">1. No Personal Data Collection</h3>
              <p>
                NukeChat is built from the ground up as a zero-knowledge, accountless platform. We do not collect, request, or store any Personally Identifiable Information (PII) such as names, phone numbers, email addresses, or IP addresses.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">2. End-to-End Encryption (E2EE)</h3>
              <p>
                In Timed Chat rooms, all text messages are encrypted client-side using the `AES-256-GCM` algorithm on your device. The keys are derived from your Room Code and are never transmitted to our servers. We only transport encrypted ciphertext payloads.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">3. Serverless P2P Transfers</h3>
              <p>
                In P2P Mesh mode, files and text messages bypass our servers entirely, moving directly from browser-to-browser via WebRTC Data Channels. No files are ever uploaded or cached on our infrastructure.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">4. Ephemeral Storage Wiping</h3>
              <p>
                Our databases are transient. Active chat records are stored in memory/temporary SQLite structures and are permanently, irrevocably deleted the moment the room timer hits zero, all participants leave, or a "Nuke" vote succeeds.
              </p>
            </section>
          </div>
        ) : (
          /* Terms Content */
          <div className="space-y-6 text-sm text-secondaryText leading-relaxed">
            <section className="space-y-2">
              <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">1. Service Provision "As-Is"</h3>
              <p>
                NukeChat is provided on an "as-is" and "as-available" basis. We offer zero guarantees regarding service uptime, reliability, database persistence, or delivery of messages.
              </p>
            </section>

            <section className="space-y-2 flex gap-3.5 bg-brand-peach/10 border border-brand-coral/20 p-4 rounded-2xl">
              <Trash2 className="w-5 h-5 text-brand-coral shrink-0 mt-0.5" />
              <div>
                <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">2. Irrevocable Deletion Notice</h3>
                <p className="text-xs mt-1">
                  Once a chat room is nuked, expired, or vacated, all records are instantly and permanently deleted from both our servers and client caches. There is absolutely no support line or backup mechanism to recover lost data.
                </p>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">3. Acceptable Conduct</h3>
              <p>
                You agree not to use NukeChat to distribute malicious code, transmit malware, engage in harassment, coordinate illegal acts, or share materials that violate intellectual property copyrights.
              </p>
            </section>

            <section className="space-y-2 flex gap-3.5 bg-[#EEF2F6] border border-[#E4E2DD]/85 p-4 rounded-2xl">
              <Ban className="w-5 h-5 text-secondaryText shrink-0 mt-0.5" />
              <div>
                <h3 className="font-extrabold text-primaryText text-xs uppercase tracking-wider">4. Limitation of Liability</h3>
                <p className="text-xs mt-1">
                  Under no circumstances shall the creators of NukeChat be held liable for any direct, indirect, incidental, or consequential damages resulting from communications, data leaks, or service terminations on the platform.
                </p>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
