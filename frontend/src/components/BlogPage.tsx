import React, { useEffect } from "react";
import { ArrowLeft, BookOpen, Clock, Calendar, Tag } from "lucide-react";
import { BLOG_POSTS, BlogPost } from "../blog/posts";

interface BlogPageProps {
  currentHash: string;
  onBack: () => void;
}

export const BlogPage: React.FC<BlogPageProps> = ({ currentHash, onBack }) => {
  const isPostDetail = currentHash.startsWith("#/blog/");
  const slug = isPostDetail ? currentHash.replace("#/blog/", "") : "";
  const post = isPostDetail ? BLOG_POSTS.find((p) => p.slug === slug) : null;

  // Scroll to top on navigation change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as any });
  }, [currentHash]);

  // Render Post List (Index View)
  const renderPostList = () => {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 md:py-12 w-full animate-fadeIn select-none">
        {/* Back button */}
        <button
          onClick={onBack}
          className="group flex items-center gap-2 text-secondaryText hover:text-primaryText font-semibold text-xs tracking-wide uppercase transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
          Back
        </button>

        {/* Header Title */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 bg-brand-peach/40 border border-brand-peach/60 rounded-full text-brand-coral font-bold text-xxs tracking-wider uppercase mb-3 shadow-sm">
            <BookOpen className="w-3 h-3" aria-hidden="true" /> Blog & Resources
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3 text-primaryText">
            Nuke Chat Technical Blog
          </h1>
          <p className="text-xs sm:text-sm text-secondaryText max-w-lg mx-auto leading-relaxed">
            Privacy guidelines, developer walkthroughs, and in-depth explainers about peer-to-peer web networks and cryptography.
          </p>
        </div>

        {/* Posts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {BLOG_POSTS.map((p) => (
            <article
              key={p.slug}
              onClick={() => {
                window.location.hash = `#/blog/${p.slug}`;
              }}
              className="group cursor-pointer flex flex-col bg-surface border border-[#E4E2DD] hover:border-indigo-500/40 p-5 rounded-3xl shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden"
            >
              {/* Category Badge */}
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#EEF2F6] border border-[#E4E2DD]/85 text-[#475569] font-bold text-[9px] uppercase tracking-wider rounded-md">
                  <Tag className="w-2.5 h-2.5" aria-hidden="true" /> {p.category}
                </span>
                <span className="text-[10px] text-secondaryText/80 font-medium flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" /> {p.readTime}
                </span>
              </div>

              <h2 className="text-base font-extrabold tracking-tight text-primaryText group-hover:text-indigo-600 transition-colors mb-2 leading-snug">
                {p.title}
              </h2>

              <p className="text-[11px] text-secondaryText leading-relaxed mb-6 flex-grow">
                {p.description}
              </p>

              <div className="pt-4 border-t border-[#E4E2DD]/60 text-[10px] font-bold text-indigo-600 flex items-center justify-between group-hover:translate-x-0.5 transition-transform duration-200">
                <span>READ ARTICLE</span>
                <span>→</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  };

  // Render Post Detail View
  const renderPostDetail = (p: BlogPost) => {
    return (
      <article className="max-w-2xl mx-auto px-6 py-8 md:py-12 w-full animate-fadeIn select-text">
        {/* Back to Blog Button */}
        <button
          onClick={() => {
            window.location.hash = "#/blog";
          }}
          className="group flex items-center gap-2 text-secondaryText hover:text-primaryText font-semibold text-xs tracking-wide uppercase transition-colors mb-8 select-none"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
          Back to Blog
        </button>

        {/* Post Metadata Card */}
        <div className="bg-surface border border-[#E4E2DD] p-6 sm:p-8 rounded-t-3xl shadow-sm">
          <div className="flex items-center gap-2.5 text-[10px] text-secondaryText font-bold uppercase tracking-wider mb-4 select-none">
            <span className="px-2 py-0.5 bg-[#EEF2F6] border border-[#E4E2DD]/85 text-[#475569] rounded-md">
              {p.category}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> {p.date}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" /> {p.readTime}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-primaryText leading-[1.15] mb-4">
            {p.title}
          </h1>
          <p className="text-xs sm:text-sm text-secondaryText leading-relaxed font-normal italic">
            {p.description}
          </p>
        </div>

        {/* Post Body (Structured Section Renderer) */}
        <div className="bg-surface border-x border-b border-[#E4E2DD] p-6 sm:p-8 rounded-b-3xl shadow-sm space-y-6 text-sm text-secondaryText leading-relaxed">
          {p.sections.map((sec, idx) => {
            switch (sec.type) {
              case "heading":
                return (
                  <h2 key={idx} className="font-extrabold text-primaryText text-sm sm:text-base uppercase tracking-wide mt-8 pt-4 border-t border-[#E4E2DD]/60 first:border-none first:pt-0 first:mt-0 select-none">
                    {sec.text}
                  </h2>
                );
              case "paragraph":
                return (
                  <p key={idx} className="text-[13px] sm:text-sm font-normal">
                    {sec.text}
                  </p>
                );
              case "quote":
                return (
                  <blockquote key={idx} className="border-l-4 border-brand-coral bg-brand-peach/10 p-4 rounded-r-2xl text-[12px] sm:text-[13px] leading-relaxed italic text-primaryText/90 font-medium">
                    {sec.text}
                  </blockquote>
                );
              case "list":
                return (
                  <ul key={idx} className="list-disc pl-5 space-y-2.5 text-[12px] sm:text-[13px] font-normal">
                    {sec.items?.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                );
              case "code":
                return (
                  <div key={idx} className="relative rounded-2xl overflow-hidden border border-[#E4E2DD] bg-[#1E293B] shadow-inner select-text">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-800 text-[10px] font-bold text-slate-400 select-none">
                      <span className="uppercase">{sec.language || "code"}</span>
                      <span>UTF-8</span>
                    </div>
                    <pre className="p-4 text-[11px] sm:text-xs overflow-x-auto text-slate-100 font-mono leading-relaxed select-text">
                      <code>{sec.code}</code>
                    </pre>
                  </div>
                );
              default:
                return null;
            }
          })}
        </div>
      </article>
    );
  };

  // Main Route Switch
  if (isPostDetail && post) {
    return renderPostDetail(post);
  }

  // Fallback view if slug is invalid
  if (isPostDetail && !post) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center select-none">
        <h1 className="text-xl font-bold mb-2">Article Not Found</h1>
        <p className="text-xs text-secondaryText mb-6">
          The requested blog post doesn't exist or has been removed.
        </p>
        <button
          onClick={() => {
            window.location.hash = "#/blog";
          }}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-full shadow-sm"
        >
          Return to Blog
        </button>
      </div>
    );
  }

  return renderPostList();
};
