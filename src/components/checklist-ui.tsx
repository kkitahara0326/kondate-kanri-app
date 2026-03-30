'use client';

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/** チェックリストのアクセント（チェック時の色・見出しバー・フォーカスリング） */
export type ChecklistAccent = 'emerald' | 'amber' | 'violet' | 'rose';

const CHECKED: Record<ChecklistAccent, string> = {
  emerald: 'border-emerald-600 bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-600',
  amber: 'border-amber-600 bg-amber-500 dark:border-amber-400 dark:bg-amber-600',
  violet: 'border-violet-600 bg-violet-500 dark:border-violet-400 dark:bg-violet-600',
  rose: 'border-rose-600 bg-rose-500 dark:border-rose-400 dark:bg-rose-600',
};

const BAR: Record<ChecklistAccent, string> = {
  emerald: 'bg-emerald-500 dark:bg-emerald-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  rose: 'bg-rose-500 dark:bg-rose-400',
};

const FOCUS_RING: Record<ChecklistAccent, string> = {
  emerald: 'focus:ring-emerald-400/50',
  amber: 'focus:ring-amber-400/50',
  violet: 'focus:ring-violet-400/50',
  rose: 'focus:ring-rose-400/50',
};

const ADD_BTN: Record<ChecklistAccent, string> = {
  emerald: 'bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400',
  amber: 'bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400',
  violet: 'bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400',
  rose: 'bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400',
};

const PANEL_SHELL: Record<'amber' | 'violet' | 'emerald', string> = {
  amber:
    'border-amber-200/70 bg-gradient-to-br from-amber-50/60 to-white dark:border-amber-900/45 dark:from-amber-950/25 dark:to-zinc-900/40',
  violet:
    'border-violet-200/70 bg-gradient-to-br from-violet-50/50 to-white dark:border-violet-900/40 dark:from-violet-950/20 dark:to-zinc-900/40',
  emerald:
    'border-emerald-200/70 bg-gradient-to-br from-emerald-50/60 to-white dark:border-emerald-900/45 dark:from-emerald-950/25 dark:to-zinc-900/40',
};

/** チェックボックス風の正方形（sr-only の input と併用） */
export function ChecklistCheckboxVisual({ checked, accent }: { checked: boolean; accent: ChecklistAccent }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        checked ? CHECKED[accent] : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'
      }`}
      aria-hidden
    >
      {checked ? (
        <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : null}
    </span>
  );
}

/** 1行分のチェック項目（食材・その他買い物・やること・削除予定など共通） */
export function ChecklistRow({
  id,
  checked,
  onChange,
  label,
  accent,
  ariaLabelChecked,
  ariaLabelUnchecked,
  className = '',
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  accent: ChecklistAccent;
  ariaLabelChecked: string;
  ariaLabelUnchecked: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-3 py-2.5 pr-1 transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 ${className}`}
    >
      <ChecklistCheckboxVisual checked={checked} accent={accent} />
      <span
        className={`min-w-0 flex-1 text-sm leading-snug ${
          checked ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-200'
        }`}
      >
        {label}
      </span>
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={Boolean(checked)}
        onChange={onChange}
        aria-label={checked ? ariaLabelChecked : ariaLabelUnchecked}
      />
    </label>
  );
}

/** 折りたたみ献立バーなど用のコンパクト行 */
export function ChecklistCompactRow({
  id,
  checked,
  onChange,
  label,
  accent,
  ariaLabel,
  onPointerDown,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  accent: ChecklistAccent;
  ariaLabel: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLInputElement>) => void;
}) {
  const labelTone =
    accent === 'rose'
      ? 'text-rose-700 dark:text-rose-300'
      : 'text-zinc-600 dark:text-zinc-300';
  return (
    <label
      htmlFor={id}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-1 py-0.5 text-[10px] font-bold transition hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50"
    >
      <ChecklistCheckboxVisual checked={checked} accent={accent} />
      <span className={labelTone}>{label}</span>
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={Boolean(checked)}
        onChange={onChange}
        onPointerDown={onPointerDown}
        aria-label={ariaLabel}
      />
    </label>
  );
}

export function ChecklistList({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  return (
    <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800" role="list" aria-label={ariaLabel}>
      {children}
    </ul>
  );
}

export function ChecklistListItem({ children }: { children: ReactNode }) {
  return <li className="first:pt-0">{children}</li>;
}

/** セクション見出し（縦バー + タイトル + 補足 + 右アクション） */
export function ChecklistSectionHeader({
  title,
  subtitle,
  accent,
  right,
}: {
  title: string;
  subtitle?: string;
  accent: ChecklistAccent;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 h-4 w-1 shrink-0 rounded-full ${BAR[accent]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

/** チェック済みをまとめて削除（通常・全チェックリスト共通のピル型） */
export function ChecklistBulkRemoveButton({
  count,
  onClick,
  label,
}: {
  count: number;
  onClick: () => void;
  /** 件数は自動で （n） が付く */
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full bg-zinc-200/90 px-2.5 py-1 text-[10px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-600 dark:hover:bg-zinc-600"
    >
      {label}（{count}件）
    </button>
  );
}

/** 献立のまとめて削除など、破壊的操作用（形状は共通・色のみ警告系） */
export function ChecklistBulkRemoveDangerButton({
  count,
  onClick,
  label,
}: {
  count: number;
  onClick: () => void;
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full bg-rose-100/95 px-2.5 py-1 text-[10px] font-semibold text-rose-800 shadow-sm ring-1 ring-rose-200/90 transition hover:bg-rose-200/90 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800/60 dark:hover:bg-rose-900/50"
    >
      {label}（{count}件）
    </button>
  );
}

/** 入力 + 追加ボタン（全チェックリスト共通レイアウト） */
export function ChecklistAddBar({
  value,
  onChange,
  onAdd,
  placeholder,
  accent,
  addButtonLabel = '追加',
  inputAriaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
  accent: ChecklistAccent;
  addButtonLabel?: string;
  inputAriaLabel: string;
}) {
  return (
    <div className="mt-3 flex min-w-0 w-full items-center gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        className={`min-h-10 min-w-0 max-w-full flex-1 rounded-xl border-0 bg-zinc-100/80 px-3 py-2 text-base outline-none ring-1 ring-zinc-200/80 transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 dark:bg-zinc-800/80 dark:ring-zinc-700 dark:focus:bg-zinc-950 ${FOCUS_RING[accent]}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd();
          }
        }}
      />
      <button
        type="button"
        onClick={onAdd}
        className={`min-h-10 shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] ${ADD_BTN[accent]}`}
      >
        {addButtonLabel}
      </button>
    </div>
  );
}

/** その他買い物 / やること 用のカード外枠 */
export function ChecklistPanelShell({
  variant,
  children,
}: {
  variant: 'amber' | 'violet' | 'emerald';
  children: ReactNode;
}) {
  return <div className={`rounded-2xl border p-4 shadow-sm ${PANEL_SHELL[variant]}`}>{children}</div>;
}

export function ChecklistEmptyHint({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{children}</p>;
}
