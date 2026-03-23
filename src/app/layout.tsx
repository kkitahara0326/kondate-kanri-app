import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { PlannerSyncProvider } from '@/components/planner-sync-provider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '献立管理アプリ',
  description: '1週間の献立と買い物かごをスマホで管理',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-zinc-50 font-sans text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50`}
      >
        <header className="sticky top-0 z-20 border-b border-emerald-100/80 bg-white/90 shadow-sm shadow-emerald-900/5 backdrop-blur-md dark:border-emerald-900/30 dark:bg-zinc-950/90">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5">
            <Link
              href="/"
              className="text-base font-bold tracking-tight text-emerald-900 dark:text-emerald-100"
            >
              献立管理
            </Link>
            <div className="hidden text-[11px] text-zinc-500 sm:block dark:text-zinc-400">
              Firestore 設定時は自動同期
            </div>
          </div>
        </header>
        <PlannerSyncProvider>
          <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        </PlannerSyncProvider>
      </body>
    </html>
  );
}
