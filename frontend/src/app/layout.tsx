import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AETHER // MILP LLM Router",
  description: "Operations Research Optimization Framework for LLM Routing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex bg-[#09090b] text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white">
        {/* Left Sidebar Navigation */}
        <aside className="fixed inset-y-0 left-0 w-64 border-r border-zinc-900 bg-[#09090b]/80 backdrop-blur-md flex flex-col z-30">
          {/* Header/Logo */}
          <div className="h-14 px-6 border-b border-zinc-900 flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-gradient-to-br from-indigo-500 to-emerald-400 flex items-center justify-center font-mono text-xs font-bold text-black shadow-md shadow-indigo-500/20">
              Æ
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-xs tracking-widest text-zinc-400 font-bold">AETHER ROUTER</span>
              <span className="text-[10px] text-zinc-600 font-medium font-mono leading-none">MILP OPTIMIZER v1.0</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-4 py-4 space-y-1">
            <Link
              href="/"
              className="flex items-center gap-3 px-3 py-2 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50 transition-all font-mono text-xs group"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="group-hover:text-indigo-400 transition-colors"
              >
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
              </svg>
              Dashboard
            </Link>

            <Link
              href="/analytics"
              className="flex items-center gap-3 px-3 py-2 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50 transition-all font-mono text-xs group"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="group-hover:text-emerald-400 transition-colors"
              >
                <line x1="18" x2="18" y1="20" y2="10" />
                <line x1="12" x2="12" y1="20" y2="4" />
                <line x1="6" x2="6" y1="20" y2="14" />
              </svg>
              Analytics
            </Link>
          </nav>

          {/* System Footer Status */}
          <div className="p-4 border-t border-zinc-900 bg-zinc-950/20">
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-zinc-900/30 border border-zinc-900/50">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-mono text-[10px] text-zinc-500">OPTIMIZATION ENGINE: OK</span>
            </div>
          </div>
        </aside>

        {/* Main Content Pane */}
        <main className="pl-64 flex-1 min-h-screen flex flex-col relative">
          {children}
        </main>
      </body>
    </html>
  );
}
