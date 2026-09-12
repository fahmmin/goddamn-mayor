import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';

interface VideoItem {
  id: number;
  label: string;
  url: string;
}

const VIDEOS: VideoItem[] = [
  {
    id: 0,
    label: 'Golden Hour',
    url: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081127_0992a171-d3c6-4978-8213-0ec5df8b6d63.mp4',
  },
  {
    id: 1,
    label: 'Still Water',
    url: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_092026_dd05b805-ea0f-40b2-8c52-332b88502592.mp4',
  },
  {
    id: 2,
    label: 'Deep Woods',
    url: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081042_df7202bf-bd80-4b2b-bbc6-1f09ba2870e9.mp4',
  },
  {
    id: 3,
    label: 'Quiet Dawn',
    url: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_080959_4cac5234-3573-464e-a5b7-76b94b8a7d61.mp4',
  },
];

const NAV_LINKS = ['How It Works', 'Features', 'Pricing', 'Community'];

const STATS = [
  '60+ Deep Sessions',
  '12,000+ Creators',
  '4.8 User Satisfaction',
  'Intentional-First Design',
];

export default function LandingPage() {
  const [activeVideo, setActiveVideo] = useState<number>(0);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);

  // Deep Woods (3rd video, index 2) triggers dark mode color for hero content
  const isDeepWoods = activeVideo === 2;

  const handleVideoSelect = (index: number) => {
    if (index === activeVideo || isTransitioning) return;
    setActiveVideo(index);
    setIsTransitioning(true);

    // 1000ms cooldown matching CSS crossfade duration
    window.setTimeout(() => {
      setIsTransitioning(false);
    }, 1000);
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <section className="relative w-full h-screen overflow-hidden bg-black select-none">
      {/* ========================================================= */}
      {/* 1. BACKGROUND VIDEO LAYER                                  */}
      {/* 4 fullscreen looping videos stacked and crossfaded (1000ms)*/}
      {/* ========================================================= */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
        {VIDEOS.map((video, index) => (
          <video
            key={video.id}
            src={video.url}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out ${
              activeVideo === index ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />
        ))}
      </div>

      {/* ========================================================= */}
      {/* 2. TRANSPARENT PNG OVERLAY (z-index 1)                     */}
      {/* Continuous train-bob animation (translateY 0 to -6px, 3s) */}
      {/* ========================================================= */}
      <div className="absolute inset-0 w-full h-full z-[1] pointer-events-none overflow-hidden">
        <img
          src="https://soft-zoom-63098134.figma.site/_assets/v11/0b4a435b2df2747593c43d7a1c9b4578f7d8d90c.png"
          alt="Cinematic atmospheric overlay"
          className="w-full h-full object-cover animate-train-bob select-none pointer-events-none"
        />
      </div>

      {/* ========================================================= */}
      {/* 3. MOBILE MENU OVERLAY (fixed, z-50)                      */}
      {/* ========================================================= */}
      <div
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileMenuOpen(false)}
      >
        {/* Mobile close button at top right */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMobileMenuOpen(false);
          }}
          className="absolute top-6 right-6 w-11 h-11 rounded-full liquid-glass flex items-center justify-center text-white"
          aria-label="Close menu"
        >
          <X className="w-6 h-6" />
        </button>

        <div
          className="flex flex-col items-center gap-7 text-center px-6"
          onClick={(e) => e.stopPropagation()}
        >
          {NAV_LINKS.map((link, idx) => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => setMobileMenuOpen(false)}
              className="text-white text-3xl font-sans tracking-wide hover:opacity-80 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                transitionDelay: mobileMenuOpen ? `${100 + idx * 50}ms` : '0ms',
                transform: mobileMenuOpen ? 'translateY(0)' : 'translateY(16px)',
                opacity: mobileMenuOpen ? 1 : 0,
              }}
            >
              {link}
            </a>
          ))}

          <button
            onClick={() => setMobileMenuOpen(false)}
            className="mt-4 bg-white text-black font-sans font-medium text-lg px-8 py-3 rounded-full hover:bg-white/90 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{
              transitionDelay: mobileMenuOpen ? '300ms' : '0ms',
              transform: mobileMenuOpen ? 'scale(1)' : 'scale(0.9)',
              opacity: mobileMenuOpen ? 1 : 0,
            }}
          >
            Get Started
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 4. CONTENT LAYER (z-index 2) - Flex Column Full Height     */}
      {/* ========================================================= */}
      <div className="relative z-[2] flex flex-col justify-between h-full w-full max-w-7xl mx-auto px-5 py-5 sm:px-8 sm:py-7 md:px-12 md:py-8 lg:px-16 pointer-events-none">
        
        {/* ------------------------------------------------------- */}
        {/* NAVIGATION (top) - always white                        */}
        {/* ------------------------------------------------------- */}
        <header className="flex items-center justify-between w-full pointer-events-auto">
          {/* Left: Logo */}
          <a
            href="/"
            className="font-serif italic text-white text-xl sm:text-2xl tracking-wide select-none hover:opacity-90 transition-opacity"
          >
            Lumora
          </a>

          {/* Right (desktop md+): liquid-glass pill */}
          <nav className="hidden md:flex items-center gap-6 px-5 py-2 rounded-full liquid-glass shadow-sm">
            {NAV_LINKS.map((link) => (
              <a
                key={link}
                href={`#${link.toLowerCase().replace(/\s+/g, '-')}`}
                className="text-white/90 hover:text-white text-sm font-sans tracking-tight transition-colors duration-200"
              >
                {link}
              </a>
            ))}
            <button className="bg-white text-black hover:bg-white/90 text-sm font-sans font-medium px-4 py-1.5 rounded-full transition-all duration-200 shadow-sm">
              Get Started
            </button>
          </nav>

          {/* Right (mobile): liquid-glass rounded hamburger with crossfade rotation */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden liquid-glass relative w-10 h-10 rounded-full flex items-center justify-center text-white focus:outline-none"
            aria-label="Toggle Navigation"
          >
            {/* Menu icon rotates out 90deg and scales to 75% */}
            <span
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
                mobileMenuOpen
                  ? 'opacity-0 rotate-90 scale-75 pointer-events-none'
                  : 'opacity-100 rotate-0 scale-100'
              }`}
            >
              <Menu className="w-5 h-5" />
            </span>

            {/* X icon rotates in from -90deg */}
            <span
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
                mobileMenuOpen
                  ? 'opacity-100 rotate-0 scale-100'
                  : 'opacity-0 -rotate-90 scale-75 pointer-events-none'
              }`}
            >
              <X className="w-5 h-5" />
            </span>
          </button>
        </header>

        {/* ------------------------------------------------------- */}
        {/* HERO CONTENT (centered, below nav)                     */}
        {/* Transitions to #182C41 when Deep Woods (index 2) active */}
        {/* ------------------------------------------------------- */}
        <main className="flex-1 flex flex-col items-center justify-center text-center px-2 sm:px-4 my-auto pointer-events-auto">
          {/* BADGE */}
          <div
            className={`inline-flex items-center px-4 py-1.5 rounded-full text-xs sm:text-sm font-sans tracking-normal transition-all duration-700 mb-5 sm:mb-6 shadow-sm ${
              isDeepWoods
                ? 'liquid-glass liquid-glass-dark text-[#182C41]'
                : 'liquid-glass text-white/95'
            }`}
          >
            Over 10,000 minds already finding their clarity
          </div>

          {/* HEADING */}
          <h1
            className={`font-serif tracking-tight leading-[1.1] max-w-4xl text-4xl sm:text-5xl md:text-7xl lg:text-[5.5rem] transition-colors duration-700 ${
              isDeepWoods ? 'text-[#182C41]' : 'text-white'
            }`}
          >
            Clarity in an Endlessly
            <br />
            Noisy Universe
          </h1>

          {/* SUBTEXT */}
          <p
            className={`mt-5 sm:mt-6 font-sans text-sm sm:text-base md:text-lg leading-relaxed max-w-xl transition-colors duration-700 ${
              isDeepWoods ? 'text-[#182C41]/85' : 'text-white/80'
            }`}
          >
            Rise above the chaos of pings, infinite scrolling, and relentless demands.
            Discover how to protect your presence and create with intention.
          </p>

          {/* EMAIL INPUT FORM */}
          <form
            onSubmit={handleEmailSubmit}
            className={`mt-7 sm:mt-8 w-full max-w-[320px] sm:max-w-sm rounded-full p-1.5 pl-4 sm:pl-5 flex items-center justify-between gap-2 shadow-lg transition-all duration-700 ${
              isDeepWoods
                ? 'liquid-glass liquid-glass-dark text-[#182C41]'
                : 'liquid-glass text-white'
            }`}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={submitted ? 'Access Reserved!' : 'Your Best Email'}
              className={`bg-transparent font-sans text-xs sm:text-sm w-full outline-none transition-colors duration-700 ${
                isDeepWoods
                  ? 'text-[#182C41] placeholder:text-[#182C41]/55'
                  : 'text-white placeholder:text-white/50'
              }`}
            />
            <button
              type="submit"
              className={`font-sans font-medium text-xs sm:text-sm px-4 py-2 sm:px-5 sm:py-2.5 rounded-full whitespace-nowrap transition-all duration-700 shrink-0 shadow-md ${
                isDeepWoods
                  ? 'bg-[#182C41] text-white hover:bg-[#182C41]/90'
                  : 'bg-white text-black hover:bg-white/90'
              }`}
            >
              {submitted ? 'Joined' : 'Get Early Access'}
            </button>
          </form>

          {/* VIDEO SWITCHER BUTTONS */}
          <div className="mt-9 sm:mt-11 flex flex-wrap items-center justify-center gap-4 sm:gap-6 md:gap-8">
            {VIDEOS.map((video, idx) => {
              const isActive = activeVideo === idx;
              return (
                <button
                  key={video.id}
                  onClick={() => handleVideoSelect(idx)}
                  disabled={isTransitioning && activeVideo !== idx}
                  className={`font-sans text-xs sm:text-sm font-medium pb-1 transition-all duration-700 cursor-pointer disabled:cursor-not-allowed ${
                    isActive
                      ? isDeepWoods
                        ? 'text-[#182C41] border-b-2 border-[#182C41] opacity-100'
                        : 'text-white border-b-2 border-white opacity-100'
                      : isDeepWoods
                      ? 'text-[#182C41] border-b-2 border-transparent opacity-50 hover:opacity-80'
                      : 'text-white border-b-2 border-transparent opacity-50 hover:opacity-80'
                  }`}
                >
                  {video.label}
                </button>
              );
            })}
          </div>
        </main>

        {/* ------------------------------------------------------- */}
        {/* BOTTOM STATS (pushed to bottom via flex-1 spacer)       */}
        {/* Always white                                            */}
        {/* ------------------------------------------------------- */}
        <footer className="w-full pt-4 pb-2 pointer-events-auto">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 md:gap-6 text-white/70 text-xs sm:text-sm font-sans tracking-wide text-center">
            {STATS.map((stat, i) => (
              <React.Fragment key={stat}>
                <span>{stat}</span>
                {i < STATS.length - 1 && (
                  <span className="hidden sm:inline-block text-white/30">|</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </footer>

      </div>
    </section>
  );
}
