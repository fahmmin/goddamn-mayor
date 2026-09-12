import React from 'react';

const DISTRICTS = ['AIRFIELD', 'DOWNTOWN', 'RIVERFRONT', 'MIDTOWN', 'HARBOR', 'HILLS'];

export default function LandingPage() {
  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-[#090d12] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,210,97,0.18),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(29,113,182,0.22),_transparent_32%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:60px_60px]" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="text-[0.7rem] font-medium uppercase tracking-[0.45em] text-white/75">
            GODDAMN MAYOR
          </div>
          <button className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[0.68rem] uppercase tracking-[0.28em] text-white/80 backdrop-blur-sm transition hover:bg-white/10">
            Build The City
          </button>
        </header>

        <main className="flex flex-1 flex-col justify-center pb-10 pt-10 lg:flex-row lg:items-end lg:gap-12">
          <div className="max-w-xl">
            <p className="mb-5 text-[0.72rem] uppercase tracking-[0.52em] text-amber-200/80">
              Why this app
            </p>

            <h1 className="font-display text-[3.4rem] leading-[0.8] tracking-[-0.08em] text-white sm:text-[5rem] lg:text-[8rem]">
              IM THE
              <br />
              GODDAMN
              <br />
              MAYOR
            </h1>

            <p className="mt-6 max-w-lg text-base leading-7 text-slate-200/85 sm:text-lg">
              This is the fun part of city-building: the moment you stop watching the system and start steering it.
              You see the bad call, the wasted budget, the obvious upgrade nobody else had the nerve to make.
              Then you do it.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <button className="rounded-full bg-amber-300 px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-slate-950 transition hover:bg-amber-200">
                Open The City
              </button>
              <button className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-white/85 transition hover:bg-white/10">
                Watch The Chaos
              </button>
            </div>

            <blockquote className="mt-10 max-w-md border-l border-amber-300/50 pl-5 text-lg italic leading-8 text-amber-100/90">
              “This guy should’ve done this instead of that. Put money here instead of there.”
            </blockquote>
          </div>

          <div className="mt-10 flex flex-1 justify-end lg:mt-0">
            <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_0_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
              <div className="mb-6 flex items-center justify-between text-[0.68rem] uppercase tracking-[0.35em] text-slate-300">
                <span>City Mood</span>
                <span>Dominance</span>
              </div>

              <div className="space-y-4 text-left">
                <p className="text-[0.7rem] uppercase tracking-[0.45em] text-amber-200/80">
                  Power move
                </p>

                <p className="text-base leading-7 text-slate-100/90">
                  Had that feeling? The city was making the wrong call. The bus line should have gone there. The money should have landed somewhere else.
                </p>

                <p className="text-base leading-7 text-slate-100/90">
                  Time to put it in action. Rezone the district, shift the economy, and make the skyline bend to your instincts.
                </p>
              </div>

              <div className="mt-8 flex flex-wrap gap-3 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/80">
                {DISTRICTS.map((district) => (
                  <span
                    key={district}
                    className="rounded-full border border-white/15 bg-black/20 px-3 py-2"
                  >
                    {district}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </main>

        <footer className="pointer-events-none pb-2 pt-4">
          <div className="flex justify-end">
            <div className="flex max-w-full flex-wrap items-center justify-end gap-x-4 gap-y-2 text-right text-[0.72rem] font-medium uppercase tracking-[0.42em] text-white/70">
              {DISTRICTS.map((district, index) => (
                <React.Fragment key={district}>
                  <span>{district}</span>
                  {index < DISTRICTS.length - 1 && <span className="text-white/30">/</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </section>
  );
}
