'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragCancelEvent,
  type DragOverEvent,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { DayOfWeek, GlobalChecklistItem, MenuItem } from '@/lib/types';
import { DAYS } from '@/lib/types';
import { usePlannerSync } from '@/components/planner-sync-provider';
import {
  ChecklistAddBar,
  ChecklistBulkRemoveButton,
  ChecklistBulkRemoveDangerButton,
  ChecklistCompactRow,
  ChecklistList,
  ChecklistListItem,
  ChecklistPanelShell,
  ChecklistRow,
  ChecklistSectionHeader,
} from '@/components/checklist-ui';
import {
  addIngredient,
  addMenu,
  addOtherShoppingItem,
  addTodoItem,
  appendRecipeUrl,
  getPlannerData,
  moveMenu,
  moveMenuToFlatGapIndex,
  removeBasketItem,
  removeCheckedIngredients,
  removeCheckedOtherShopping,
  removeCheckedTodos,
  removeDeleteMarkedMenus,
  savePlannerData,
  setMenuDay,
  setMenuIngredients,
  toggleIngredientChecked,
  toggleMenuDeleteMarked,
  toggleOtherShoppingItem,
  toggleTodoItem,
  updateMenu,
} from '@/lib/planner-storage';

function dayLabel(day: DayOfWeek) {
  return DAYS.find((d) => d.key === day)?.label ?? '';
}

/** ボタン・入力・リンク・ラベル上では並べ替えドラッグを開始しない */
function dragListenersExceptInteractive(
  listeners: DraggableSyntheticListeners | undefined
): DraggableSyntheticListeners | undefined {
  if (!listeners) return undefined;
  const { onPointerDown, ...rest } = listeners;
  if (!onPointerDown) return listeners;
  return {
    ...rest,
    onPointerDown: (e: ReactPointerEvent<Element>) => {
      const el = e.target as HTMLElement | null;
      // ドラッグ開始はハンドル限定にしてスクロールと干渉させない
      if (!el?.closest('[data-drag-handle]')) return;
      onPointerDown(e);
    },
  };
}

type MenuDraft = {
  title: string;
  day: DayOfWeek;
  recipeUrlsText: string;
  ingredientsText: string;
  notes: string;
};

function emptyDraft(day: DayOfWeek): MenuDraft {
  return { title: '', day, recipeUrlsText: '', ingredientsText: '', notes: '' };
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 並べ替え可能であることを示すグリップ（装飾・スクリーンリーダー用ラベルは親で） */
function DragGripIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="20"
      viewBox="0 0 14 20"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="10" cy="4" r="1.5" />
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="4" cy="16" r="1.5" />
      <circle cx="10" cy="16" r="1.5" />
    </svg>
  );
}

function DayChipSelect({
  value,
  onChange,
}: {
  value: DayOfWeek;
  onChange: (d: DayOfWeek) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="曜日を選択">
      {DAYS.map((d) => (
        <button
          key={d.key}
          type="button"
          onClick={() => onChange(d.key)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
            value === d.key
              ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20 dark:bg-emerald-500 dark:ring-emerald-400/25'
              : 'bg-zinc-100/90 text-zinc-600 hover:bg-zinc-200/90 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 p-4 backdrop-blur-sm sm:items-center">
      <div className="relative isolate max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-2xl shadow-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3 dark:border-zinc-800">
          <div className="text-base font-bold text-zinc-900 dark:text-zinc-50">{title}</div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            閉じる
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data } = usePlannerSync();
  const [basketOpen, setBasketOpen] = useState(false);
  const [activeDragMenuId, setActiveDragMenuId] = useState<string | null>(null);
  const [activeDragWidth, setActiveDragWidth] = useState<number | null>(null);
  const [collapsedByMenuId, setCollapsedByMenuId] = useState<Record<string, boolean>>({});
  const lastAppliedGapIndexRef = useRef<number | null>(null);

  /** ドラッグ中、挿入ラインのインデックス（0 = 先頭の前、length = 末尾） */
  const [dragOverGapIndex, setDragOverGapIndex] = useState<number | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MenuDraft>(() => emptyDraft(0));

  const menusByDay = useMemo(() => {
    const base = new Map<DayOfWeek, MenuItem[]>();
    for (const m of data.menus) {
      const arr = base.get(m.day) ?? [];
      arr.push(m);
      base.set(m.day, arr);
    }
    for (const [day, arr] of base.entries()) {
      base.set(day, [...arr].sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt));
    }
    return base;
  }, [data.menus]);

  /** 月→日の順にフラット表示（枠なし一覧用） */
  const flatMenusForDisplay = useMemo(() => {
    const out: MenuItem[] = [];
    for (const d of DAYS) {
      const arr = menusByDay.get(d.key) ?? [];
      out.push(...[...arr].sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt));
    }
    return out;
  }, [menusByDay]);

  const deleteMarkedMenuCount = useMemo(
    () => data.menus.filter((m) => m.deleteMarked).length,
    [data.menus]
  );

  const menuTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of data.menus) map.set(m.id, m.title);
    return map;
  }, [data.menus]);

  const basketSorted = useMemo(() => {
    return [...data.basket].sort((a, b) => b.addedAt - a.addedAt);
  }, [data.basket]);

  const openCreate = (day: DayOfWeek) => {
    setEditingMenuId(null);
    setDraft(emptyDraft(day));
    setEditorOpen(true);
  };

  const saveMenu = () => {
    const recipeUrls = parseUrls(draft.recipeUrlsText);
    const ingredients = parseLines(draft.ingredientsText);
    if (editingMenuId) {
      const cur = getPlannerData().menus.find((m) => m.id === editingMenuId);
      if (cur && cur.day !== draft.day) {
        const appendIndex = getPlannerData().menus.filter((m) => m.day === draft.day && m.id !== editingMenuId).length;
        moveMenu(editingMenuId, draft.day, appendIndex);
      }
      updateMenu(editingMenuId, {
        title: draft.title,
        day: draft.day,
        notes: draft.notes,
        recipeUrls,
      });
      setMenuIngredients(editingMenuId, ingredients);
    } else {
      const menu = addMenu({
        title: draft.title,
        day: draft.day,
        notes: draft.notes,
        recipeUrls,
      });
      if (menu && ingredients.length > 0) setMenuIngredients(menu.id, ingredients);
    }
    setEditorOpen(false);
  };

  return (
    <div className="min-h-dvh px-3 pb-12 pt-2 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto max-w-6xl space-y-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          <span className="bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-transparent dark:from-emerald-300 dark:to-teal-300">
            1週間の献立
          </span>
        </h1>

        {/* 買い物かごは献立ページ内で折りたたみ表示 */}
        {data.basket.length > 0 && (
          <div className="rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50/90 to-white shadow-md shadow-amber-900/5 dark:border-amber-900/40 dark:from-amber-950/40 dark:to-zinc-900/80">
            <button
              type="button"
              onClick={() => setBasketOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left"
            >
              <span className="text-sm font-bold text-amber-950 dark:text-amber-100">
                買い物かご（{data.basket.length}）
              </span>
              <span className="rounded-full bg-amber-100/80 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                {basketOpen ? '閉じる' : '開く'}
              </span>
            </button>
            {basketOpen && (
              <div className="border-t border-zinc-200/70 px-4 py-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const cur = getPlannerData();
                      savePlannerData({ ...cur, basket: [] });
                    }}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    かごを空にする
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {basketSorted.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-amber-100/80 bg-white/90 px-3 py-2.5 dark:border-amber-900/30 dark:bg-zinc-950/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.text}</span>
                      <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {dayLabel(b.day)} {b.menuTitle}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeBasketItem(b.id)}
                        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                      >
                        済
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <PlannerDndWrapper
        activeTitle={activeDragMenuId ? menuTitleById.get(activeDragMenuId) ?? '' : ''}
        activeWidth={activeDragWidth}
        onDragStart={(e) => {
          const id = String(e.active.id);
          setActiveDragMenuId(id);
          lastAppliedGapIndexRef.current = null;
          const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/"/g, '\\"');
          const el = document.querySelector<HTMLElement>(`[data-menu-id="${escaped}"]`);
          const w = el?.getBoundingClientRect().width;
          setActiveDragWidth(w && Number.isFinite(w) ? w : null);
        }}
        onDragOver={(e) => {
          const activeId = String(e.active.id);
          const overId = e.over?.id ? String(e.over.id) : '';
          const m = /^insert-at:(\d+)$/.exec(overId);
          const nextGap = m ? Number(m[1]) : null;
          setDragOverGapIndex(nextGap);
          // ドラッグ中に実際の順序も反映し、見た目をリアルタイムに入れ替える
          if (nextGap === null) return;
          if (lastAppliedGapIndexRef.current === nextGap) return;
          moveMenuToFlatGapIndex(activeId, nextGap);
          lastAppliedGapIndexRef.current = nextGap;
        }}
        onDragCancel={() => {
          setActiveDragMenuId(null);
          setActiveDragWidth(null);
          setDragOverGapIndex(null);
          lastAppliedGapIndexRef.current = null;
        }}
        onDragEnd={() => {
          setActiveDragMenuId(null);
          setActiveDragWidth(null);
          setDragOverGapIndex(null);
          lastAppliedGapIndexRef.current = null;
        }}
      >
          <div className="rounded-3xl border border-zinc-200/60 bg-white/90 p-4 shadow-lg shadow-zinc-900/[0.04] ring-1 ring-zinc-100/80 backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-black/20 dark:ring-zinc-800/60">
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
              <ChecklistBulkRemoveDangerButton
                count={deleteMarkedMenuCount}
                onClick={() => removeDeleteMarkedMenus()}
                label="チェックしたレシピを削除"
              />
            </div>

            <div className="space-y-3">
              {flatMenusForDisplay.map((m, i) => (
                <Fragment key={m.id}>
                  <MenuInsertGap
                    insertIndex={i}
                    active={Boolean(activeDragMenuId)}
                    highlight={dragOverGapIndex === i}
                  />
                  <PlannerMenuRow
                    menu={m}
                    activeDragMenuId={activeDragMenuId}
                    isCollapsed={(collapsedByMenuId[m.id] ?? true) === true}
                    onToggleCollapsed={() =>
                      setCollapsedByMenuId((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                    }
                  />
                </Fragment>
              ))}
              <MenuInsertGap
                insertIndex={flatMenusForDisplay.length}
                active={Boolean(activeDragMenuId)}
                highlight={dragOverGapIndex === flatMenusForDisplay.length}
              />
            </div>

            <button
              type="button"
              onClick={() => openCreate(0)}
              className="mt-4 w-full rounded-2xl border-2 border-dashed border-emerald-200/80 bg-emerald-50/30 py-3.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40"
            >
              ＋ レシピを追加
            </button>

            <div className="mt-4 space-y-4">
              <GlobalChecklistPanel
                title="その他の買い物チェックリスト"
                subtitle=""
                items={data.otherShopping}
                variant="shopping"
                onAdd={addOtherShoppingItem}
                onToggle={toggleOtherShoppingItem}
                onRemoveChecked={removeCheckedOtherShopping}
              />
              <GlobalChecklistPanel
                title="やることチェックリスト"
                subtitle=""
                items={data.todos}
                variant="todo"
                onAdd={addTodoItem}
                onToggle={toggleTodoItem}
                onRemoveChecked={removeCheckedTodos}
              />
            </div>
          </div>
        </PlannerDndWrapper>

        <Modal
        open={editorOpen}
        title={editingMenuId ? 'メニュー編集' : 'メニュー追加'}
        onClose={() => setEditorOpen(false)}
      >
        <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-800/80">
          <label className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">メニュー名</label>
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="mt-2 w-full rounded-xl border-2 border-zinc-300 bg-white px-4 py-3 text-base dark:border-zinc-600 dark:bg-zinc-950"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">曜日</label>
            <select
              value={draft.day}
              onChange={(e) => setDraft((d) => ({ ...d, day: Number(e.target.value) as DayOfWeek }))}
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {DAYS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              レシピURL（1行に1つ）
            </label>
            <textarea
              value={draft.recipeUrlsText}
              onChange={(e) => setDraft((d) => ({ ...d, recipeUrlsText: e.target.value }))}
              rows={4}
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              買い物チェックリスト（1行に1つ）
            </label>
            <textarea
              value={draft.ingredientsText}
              onChange={(e) => setDraft((d) => ({ ...d, ingredientsText: e.target.value }))}
              rows={4}
              className="mt-1 w-full rounded-xl border border-amber-300/80 bg-amber-50/50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950/30"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">メモ</label>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <button
            onClick={() => setEditorOpen(false)}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            キャンセル
          </button>
          <button
            onClick={saveMenu}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-900/20 transition hover:from-emerald-700 hover:to-teal-700 dark:from-emerald-500 dark:to-teal-500"
          >
            保存
          </button>
        </div>
        </Modal>
      </div>
    </div>
  );
}

function PlannerDndWrapper({
  children,
  activeTitle,
  activeWidth,
  onDragStart,
  onDragOver,
  onDragCancel,
  onDragEnd,
}: {
  children: React.ReactNode;
  activeTitle: string;
  activeWidth: number | null;
  onDragStart: (e: DragStartEvent) => void;
  onDragOver: (e: DragOverEvent) => void;
  onDragCancel: (e: DragCancelEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || over.id === active.id) return;
    const overId = String(over.id);
    const insert = /^insert-at:(\d+)$/.exec(overId);
    if (!insert) return;
    moveMenuToFlatGapIndex(String(active.id), Number(insert[1]));
  };

  return (
    <DndContext
      collisionDetection={pointerWithin}
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragCancel={onDragCancel}
      onDragEnd={(e) => {
        handleDragEnd(e);
        onDragEnd(e);
      }}
    >
      {children}
      <DragOverlay>
        {activeTitle ? (
          <div
            className="rounded-2xl border border-emerald-200/80 bg-white px-4 py-3 text-sm font-bold text-emerald-950 shadow-2xl shadow-emerald-900/15 ring-2 ring-emerald-400/30 dark:border-emerald-700 dark:bg-zinc-900 dark:text-emerald-50 dark:ring-emerald-500/25"
            style={activeWidth ? { width: `${Math.round(activeWidth)}px` } : undefined}
          >
            {activeTitle}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DraggableMenuCard({
  menu,
  title,
  children,
}: {
  menu: MenuItem;
  title: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: menu.id,
  });
  const safeListeners = dragListenersExceptInteractive(listeners);
  const style: React.CSSProperties = {
    // DragOverlay で追従表示するため、本体はドラッグ中に動かさない
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
  };
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zinc-200/50 bg-white text-sm shadow-md shadow-zinc-900/[0.06] transition-shadow duration-200 dark:border-zinc-700/60 dark:bg-zinc-900/90 dark:shadow-black/30 ${
        menu.deleteMarked && !isDragging
          ? 'ring-2 ring-red-400/50 ring-offset-2 ring-offset-zinc-50 dark:ring-red-500/40 dark:ring-offset-zinc-950'
          : ''
      } ${
        isDragging ? 'opacity-80 ring-2 ring-emerald-400/60 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-950' : 'hover:shadow-lg hover:shadow-zinc-900/[0.08]'
      }`}
    >
      <div
        ref={setNodeRef}
        style={style}
        data-menu-id={menu.id}
        className={`touch-auto select-none rounded-2xl ${
          isDragging ? 'px-3 py-2' : 'p-4'
        }`}
        {...attributes}
        {...safeListeners}
      >
        {isDragging ? (
          <div className="flex items-center gap-2 truncate text-sm font-bold text-emerald-900 dark:text-emerald-100">
            <DragGripIcon className="shrink-0 text-emerald-500" />
            <span className="truncate">{title}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** 献立カード内メモ（即時編集・blur で保存） */
function MenuNotesField({ menu }: { menu: MenuItem }) {
  const [value, setValue] = useState(menu.notes ?? '');
  useEffect(() => {
    setValue(menu.notes ?? '');
  }, [menu.id, menu.notes]);

  const save = () => {
    const next = value.trim();
    const cur = (menu.notes ?? '').trim();
    if (next === cur) return;
    updateMenu(menu.id, { notes: next });
  };

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <ChecklistSectionHeader title="メモ" accent="emerald" />
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        rows={3}
        data-no-dnd
        className="mt-3 min-h-[4.5rem] w-full resize-y rounded-xl border-0 bg-zinc-100/80 px-3 py-2.5 text-sm leading-relaxed text-zinc-900 outline-none ring-1 ring-zinc-200/80 transition focus:bg-white focus:ring-2 focus:ring-emerald-400/50 dark:bg-zinc-800/80 dark:text-zinc-100 dark:ring-zinc-700 dark:focus:bg-zinc-950"
        aria-label="この献立のメモ"
      />
    </div>
  );
}

/** 編集画面を開かずにレシピURLを1件ずつ追加 */
function RecipeUrlAdder({ menu }: { menu: MenuItem }) {
  const [url, setUrl] = useState('');
  const handleAdd = () => {
    const t = url.trim();
    if (!t) return;
    appendRecipeUrl(menu.id, t);
    setUrl('');
  };
  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <ChecklistSectionHeader title="レシピURL" accent="emerald" />
      <ChecklistAddBar
        value={url}
        onChange={setUrl}
        onAdd={handleAdd}
        placeholder=""
        accent="emerald"
        inputAriaLabel="レシピURLを追加"
      />
      {menu.recipeUrls.length > 0 ? (
        <ChecklistList ariaLabel="レシピURL一覧">
          {menu.recipeUrls.map((u) => (
            <ChecklistListItem key={u}>
              <a
                href={u}
                target="_blank"
                rel="noreferrer"
                className="block truncate py-2.5 text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
              >
                {u}
              </a>
            </ChecklistListItem>
          ))}
        </ChecklistList>
      ) : null}
    </div>
  );
}

/** 各献立（メニュー）ごとの買い物チェックリスト。チェックすると買った印だけ付く */
function IngredientSection({ menu }: { menu: MenuItem }) {
  const [text, setText] = useState('');
  const checkedCount = menu.ingredients.filter((i) => i.checked).length;

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <ChecklistSectionHeader
        title="買い物リスト（食材）"
        accent="emerald"
        right={
          <ChecklistBulkRemoveButton
            count={checkedCount}
            onClick={() => removeCheckedIngredients(menu.id)}
            label="チェック済みを削除"
          />
        }
      />
      <ChecklistAddBar
        value={text}
        onChange={setText}
        onAdd={() => {
          addIngredient(menu.id, text);
          setText('');
        }}
        placeholder="食材を追加…"
        accent="emerald"
        inputAriaLabel="食材を追加"
      />
      {menu.ingredients.length > 0 ? (
        <ChecklistList ariaLabel="買い物チェックリスト">
          {menu.ingredients.map((i) => (
            <ChecklistListItem key={i.id}>
              <ChecklistRow
                id={`ing-${menu.id}-${i.id}`}
                checked={Boolean(i.checked)}
                onChange={() => toggleIngredientChecked(menu.id, i.id)}
                label={i.text}
                accent="emerald"
                ariaLabelChecked={`${i.text}のチェックを外す`}
                ariaLabelUnchecked={`${i.text}を買ったことにする`}
              />
            </ChecklistListItem>
          ))}
        </ChecklistList>
      ) : null}
    </div>
  );
}

/** 献立に紐づかないグローバルチェックリスト（その他買い物・やること） */
function GlobalChecklistPanel({
  title,
  subtitle,
  items,
  variant,
  onAdd,
  onToggle,
  onRemoveChecked,
}: {
  title: string;
  subtitle: string;
  items: GlobalChecklistItem[];
  variant: 'shopping' | 'todo';
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onRemoveChecked: () => void;
}) {
  const [text, setText] = useState('');
  const checkedCount = items.filter((i) => i.checked).length;
  const accent = variant === 'shopping' ? 'amber' : 'violet';
  const shellVariant = variant === 'shopping' ? 'amber' : 'violet';

  const add = () => {
    onAdd(text);
    setText('');
  };

  return (
    <ChecklistPanelShell variant={shellVariant}>
      <ChecklistSectionHeader
        title={title}
        subtitle={subtitle}
        accent={accent}
        right={
          <ChecklistBulkRemoveButton
            count={checkedCount}
            onClick={() => onRemoveChecked()}
            label="チェック済みを削除"
          />
        }
      />
      <ChecklistAddBar
        value={text}
        onChange={setText}
        onAdd={add}
        placeholder=""
        accent={accent}
        inputAriaLabel={variant === 'shopping' ? '買い物項目を追加' : 'やることを追加'}
      />
      {items.length > 0 ? (
        <ChecklistList ariaLabel={title}>
          {items.map((i) => (
            <ChecklistListItem key={i.id}>
              <ChecklistRow
                id={`gcl-${variant}-${i.id}`}
                checked={Boolean(i.checked)}
                onChange={() => onToggle(i.id)}
                label={i.text}
                accent={accent}
                ariaLabelChecked={`${i.text}のチェックを外す`}
                ariaLabelUnchecked={
                  variant === 'shopping' ? `${i.text}を買ったことにする` : `${i.text}を完了にする`
                }
              />
            </ChecklistListItem>
          ))}
        </ChecklistList>
      ) : null}
    </ChecklistPanelShell>
  );
}

function CollapsedMenuBar({
  title,
  collapsed,
  onToggle,
  day,
  onDayChange,
  deleteMarked,
  onToggleDeleteMark,
  deleteMarkInputId,
  /** true のとき親カードの枠だけを使う（二重枠を防ぐ） */
  embedded,
}: {
  title: string;
  collapsed: boolean;
  onToggle?: () => void;
  /** 折りたたみ時に曜日を変更するドロップダウン（任意） */
  day?: DayOfWeek;
  onDayChange?: (next: DayOfWeek) => void;
  /** 一覧からまとめて削除するためのチェック */
  deleteMarked?: boolean;
  onToggleDeleteMark?: () => void;
  /** ChecklistCompactRow 用の一意 id */
  deleteMarkInputId?: string;
  embedded?: boolean;
}) {
  const shellClass = embedded
    ? 'w-full min-w-0 text-sm font-semibold text-zinc-900 dark:text-zinc-50'
    : 'rounded-2xl border border-zinc-200/60 bg-white/90 px-3 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50';

  return (
    <div className={shellClass}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate font-bold tracking-tight">
          <span
            data-drag-handle
            className="inline-flex shrink-0 cursor-grab touch-none text-zinc-400 active:cursor-grabbing dark:text-zinc-500"
            aria-label="ドラッグして並べ替え"
            title="ドラッグして並べ替え"
          >
            <DragGripIcon className="h-4 w-3" />
          </span>
          <span className="truncate">{title}</span>
        </div>
        {onToggleDeleteMark && deleteMarkInputId ? (
          <ChecklistCompactRow
            id={deleteMarkInputId}
            checked={Boolean(deleteMarked)}
            onChange={() => onToggleDeleteMark()}
            label="削除予定"
            accent="rose"
            ariaLabel="献立を削除予定にチェック"
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : null}
        {onDayChange !== undefined && day !== undefined ? (
          <select
            value={day}
            onChange={(e) => onDayChange(Number(e.target.value) as DayOfWeek)}
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 cursor-pointer appearance-none rounded-full bg-emerald-50 py-1 pl-2.5 pr-7 text-[11px] font-bold text-emerald-900 ring-1 ring-emerald-200/90 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800/80"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2310b981'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.35rem center', backgroundSize: '0.65rem' }}
            aria-label="曜日を変更"
          >
            {DAYS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        ) : null}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={collapsed ? '開く' : '閉じる'}
            title={collapsed ? '開く' : '閉じる'}
          >
            <span className="text-lg leading-none">{collapsed ? '▸' : '▾'}</span>
          </button>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{collapsed ? '▸' : '▾'}</span>
        )}
      </div>
    </div>
  );
}

/** 一覧の「この位置の前に挿入」用ドロップゾーン */
function MenuInsertGap({
  insertIndex,
  active,
  highlight,
}: {
  insertIndex: number;
  /** 献立カードをドラッグ中のみヒット領域を広げる */
  active: boolean;
  highlight: boolean;
}) {
  const id = `insert-at:${insertIndex}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  const hot = isOver || highlight;
  return (
    <div
      ref={setNodeRef}
      className={`rounded-full transition-all ${
        active ? 'min-h-4 py-3' : 'min-h-0 py-0'
      } ${hot ? 'bg-gradient-to-r from-emerald-400 to-teal-400 shadow-md shadow-emerald-600/25 ring-2 ring-white/50 dark:from-emerald-500 dark:to-teal-500' : active ? 'bg-zinc-200/60 dark:bg-zinc-700/50' : ''}`}
      aria-hidden
    />
  );
}

function PlannerMenuRow({
  menu: m,
  activeDragMenuId,
  isCollapsed,
  onToggleCollapsed,
}: {
  menu: MenuItem;
  activeDragMenuId: string | null;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="space-y-2">
      {activeDragMenuId && activeDragMenuId !== m.id ? (
        <CollapsedMenuBar title={m.title} collapsed />
      ) : (
        <DraggableMenuCard menu={m} title={m.title}>
          {isCollapsed ? (
            <CollapsedMenuBar
              title={m.title}
              collapsed
              embedded
              day={m.day}
              onDayChange={(nextDay) => setMenuDay(m.id, nextDay)}
              onToggle={onToggleCollapsed}
              deleteMarked={m.deleteMarked}
              onToggleDeleteMark={() => toggleMenuDeleteMarked(m.id)}
              deleteMarkInputId={`menu-del-${m.id}`}
            />
          ) : (
            <MenuCardBody menu={m} onToggleCollapsed={onToggleCollapsed} />
          )}
        </DraggableMenuCard>
      )}
    </div>
  );
}

function MenuCardBody({
  menu,
  onToggleCollapsed,
}: {
  menu: MenuItem;
  onToggleCollapsed: () => void;
}) {
  const ingredientCount = menu.ingredients.length;
  const recipeCount = menu.recipeUrls.length;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div
          data-drag-handle
          className="mt-1 shrink-0 text-zinc-300 dark:text-zinc-600"
          aria-label="ドラッグして並べ替え"
          title="ドラッグして並べ替え"
        >
          <DragGripIcon className="h-5 w-3.5 cursor-grab touch-none active:cursor-grabbing" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
              {menu.title}
            </h2>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="折りたたむ"
              title="折りたたむ"
            >
              <span className="text-lg">▾</span>
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            レシピ {recipeCount}件 · 買い物 {ingredientCount}件
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          曜日
        </p>
        <DayChipSelect value={menu.day} onChange={(d) => setMenuDay(menu.id, d)} />
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100/90 px-1.5 py-0.5 dark:bg-zinc-800/80">
          <DragGripIcon className="h-3 w-2.5 text-zinc-400" />
          ドラッグで移動
        </span>
      </p>

      <RecipeUrlAdder menu={menu} />
      <IngredientSection menu={menu} />
      <MenuNotesField menu={menu} />
    </div>
  );
}
