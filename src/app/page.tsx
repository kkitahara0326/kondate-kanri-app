'use client';

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
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
import type { DayOfWeek, GlobalChecklistItem, MenuItem, RecipeImage } from '@/lib/types';
import { checkImageUploadGuard } from '@/lib/image-upload-policy';
import { getRecipeImageBlob, getRecipeImageOriginalBlob } from '@/lib/recipe-image-blobs';
import { DAYS, DAYS_SUN_START } from '@/lib/types';
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
  addMenuWithDetails,
  addOtherShoppingItem,
  addRecipeImage,
  addTodoItem,
  appendRecipeUrl,
  getPlannerData,
  removeRecipeUrlAt,
  moveMenu,
  moveMenuToFlatGapIndex,
  removeBasketItem,
  removeCheckedIngredients,
  removeCheckedOtherShopping,
  removeCheckedTodos,
  removeDeleteMarkedMenus,
  removeRecipeImage,
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

type DraftPendingImage = {
  id: string;
  name: string;
  blob: Blob;
  previewUrl: string;
};

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
      {DAYS_SUN_START.map((d) => (
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
  const [draft, setDraft] = useState<MenuDraft>(() => emptyDraft(DAYS_SUN_START[0].key));
  const [draftRecipeUrlInput, setDraftRecipeUrlInput] = useState('');
  const [draftIngredientInput, setDraftIngredientInput] = useState('');
  const [draftIngredientChecked, setDraftIngredientChecked] = useState<boolean[]>([]);
  const [draftPendingImages, setDraftPendingImages] = useState<DraftPendingImage[]>([]);
  const [draftImageBusy, setDraftImageBusy] = useState(false);
  const [draftImageError, setDraftImageError] = useState<string | null>(null);
  const [saveMenuError, setSaveMenuError] = useState<string | null>(null);
  const [saveMenuSubmitting, setSaveMenuSubmitting] = useState(false);

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

  /** 日→土の順にフラット表示（枠なし一覧用） */
  const flatMenusForDisplay = useMemo(() => {
    const out: MenuItem[] = [];
    for (const d of DAYS_SUN_START) {
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
    setDraftImageError(null);
    setSaveMenuError(null);
    setDraftPendingImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setEditorOpen(true);
  };

  const openEdit = (menu: MenuItem) => {
    setDraftImageError(null);
    setSaveMenuError(null);
    setDraftPendingImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setEditingMenuId(menu.id);
    setDraft({
      title: menu.title,
      day: menu.day,
      recipeUrlsText: menu.recipeUrls.join('\n'),
      ingredientsText: menu.ingredients.map((i) => i.text).join('\n'),
      notes: menu.notes ?? '',
    });
    setEditorOpen(true);
  };

  const saveMenu = async () => {
    setSaveMenuError(null);
    const recipeUrls = parseUrls(draft.recipeUrlsText);
    const ingredients = parseLines(draft.ingredientsText);
    const title = draft.title.trim();
    if (!title) {
      setSaveMenuError('メニュー名を入力してください。');
      return;
    }
    if (editingMenuId) {
      const cur = getPlannerData().menus.find((m) => m.id === editingMenuId);
      if (cur && cur.day !== draft.day) {
        const appendIndex = getPlannerData().menus.filter((m) => m.day === draft.day && m.id !== editingMenuId).length;
        moveMenu(editingMenuId, draft.day, appendIndex);
      }
      updateMenu(editingMenuId, {
        title,
        day: draft.day,
        notes: draft.notes,
        recipeUrls,
      });
      setMenuIngredients(editingMenuId, ingredients);
      setEditorOpen(false);
      setDraftRecipeUrlInput('');
      setDraftIngredientInput('');
      return;
    }

    setSaveMenuSubmitting(true);
    try {
      const uploadableDraftImages = draftPendingImages;
      if (draftPendingImages.length > 0) {
        const existingImageCount = data.menus.reduce((sum, m) => sum + (m.recipeImages?.length ?? 0), 0);
        const maxBytes = Math.max(...draftPendingImages.map((p) => p.blob.size));
        const guard = await checkImageUploadGuard({
          existingImageCount,
          nextFileBytes: maxBytes,
        });
        if (!guard.allowed) {
          setDraftImageError(
            guard.reason ?? 'クラウドストレージの上限に近いため、一時的に画像アップロードを制限しています。'
          );
          for (const img of draftPendingImages) {
            URL.revokeObjectURL(img.previewUrl);
          }
          setDraftPendingImages([]);
          return;
        }
      }

      const menu = await addMenuWithDetails({
        title,
        day: draft.day,
        notes: draft.notes,
        recipeUrls,
        ingredientTexts: ingredients,
        recipeImageBlobs: uploadableDraftImages.map((p) => ({
          name: p.name,
          blob: p.blob,
        })),
      });
      if (!menu) {
        setSaveMenuError('保存に失敗しました。入力内容を確認してください。');
        return;
      }
      if (menu) {
        for (const img of uploadableDraftImages) {
          URL.revokeObjectURL(img.previewUrl);
        }
      }
      if (uploadableDraftImages.length > 0) {
        setDraftPendingImages([]);
      }
      setEditorOpen(false);
      setDraftRecipeUrlInput('');
      setDraftIngredientInput('');
    } catch (err) {
      console.error(err);
      setSaveMenuError('保存に失敗しました。通信状況を確認して再試行してください。');
    } finally {
      setSaveMenuSubmitting(false);
    }
  };

  const onDraftRecipeImageSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const existingImageCount =
      data.menus.reduce((sum, m) => sum + (m.recipeImages?.length ?? 0), 0) + draftPendingImages.length;
    const guard = await checkImageUploadGuard({ existingImageCount, nextFileBytes: file.size });
    if (!guard.allowed) {
      setDraftImageError(guard.reason ?? '現在は画像アップロードできません。');
      return;
    }
    setDraftImageError(null);
    setSaveMenuError(null);
    setDraftImageBusy(true);
    try {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `pimg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      setDraftPendingImages((prev) => [
        ...prev,
        { id, name: file.name || 'recipe-image.jpg', blob: file, previewUrl },
      ]);
    } catch (err) {
      console.error(err);
    } finally {
      setDraftImageBusy(false);
    }
  };

  const removeDraftPendingImage = (id: string) => {
    setDraftPendingImages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const addDraftRecipeUrl = () => {
    const t = draftRecipeUrlInput.trim();
    if (!t) return;
    setDraft((d) => {
      const lines = parseUrls(d.recipeUrlsText);
      return { ...d, recipeUrlsText: [...lines, t].join('\n') };
    });
    setDraftRecipeUrlInput('');
  };

  const removeDraftRecipeUrlAt = (idx: number) => {
    setDraft((d) => {
      const lines = parseUrls(d.recipeUrlsText);
      lines.splice(idx, 1);
      return { ...d, recipeUrlsText: lines.join('\n') };
    });
  };

  const addDraftIngredient = () => {
    const t = draftIngredientInput.trim();
    if (!t) return;
    setDraft((d) => {
      const lines = parseLines(d.ingredientsText);
      return { ...d, ingredientsText: [...lines, t].join('\n') };
    });
    setDraftIngredientInput('');
  };

  const draftRecipeUrls = useMemo(() => parseUrls(draft.recipeUrlsText), [draft.recipeUrlsText]);
  const draftIngredients = useMemo(() => parseLines(draft.ingredientsText), [draft.ingredientsText]);

  // 食材リスト行のチェック状態（「編集モーダル内の削除操作」用）
  useEffect(() => {
    setDraftIngredientChecked((prev) => {
      const nextLen = draftIngredients.length;
      if (prev.length === nextLen) return prev;
      return new Array(nextLen).fill(false);
    });
  }, [draftIngredients.length, draft.ingredientsText]);

  const toggleDraftIngredientCheckedAt = (idx: number) => {
    setDraftIngredientChecked((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const removeCheckedDraftIngredients = () => {
    const lines = parseLines(draft.ingredientsText);
    const next = lines.filter((_, idx) => !draftIngredientChecked[idx]);
    setDraft((d) => ({ ...d, ingredientsText: next.join('\n') }));
  };

  return (
    <div className="min-h-[100svh] w-full overflow-x-hidden px-3 pb-8 pt-2 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
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
          const overGap = m ? Number(m[1]) : null;

          // Touch / Pointer のどちらでも、ドラッグ位置の Y 座標を拾う
          type ClientYTouch = { clientY?: number };
          const activatorEvent = e.activatorEvent as unknown as { clientY?: unknown; touches?: unknown; changedTouches?: unknown };
          const firstTouchClientY = (list: unknown): number | null => {
            if (!Array.isArray(list) || list.length === 0) return null;
            const y = (list[0] as ClientYTouch | undefined)?.clientY;
            return typeof y === 'number' && Number.isFinite(y) ? y : null;
          };
          const clientY =
            typeof activatorEvent?.clientY === 'number' && Number.isFinite(activatorEvent.clientY)
              ? activatorEvent.clientY
              : firstTouchClientY(activatorEvent.touches) ?? firstTouchClientY(activatorEvent.changedTouches) ?? null;

          // カードの中心（上半分/下半分の境界）を越えたら入れ替える
          let nextGap: number | null = overGap;
          if (typeof clientY === 'number' && Number.isFinite(clientY) && flatMenusForDisplay.length > 0) {
            const centers: number[] = [];
            let ok = true;
            for (const menu of flatMenusForDisplay) {
              const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(menu.id) : menu.id.replace(/"/g, '\\"');
              const el = document.querySelector<HTMLElement>(`[data-menu-id="${escaped}"]`);
              if (!el) {
                ok = false;
                break;
              }
              const rect = el.getBoundingClientRect();
              centers.push(rect.top + rect.height / 2);
            }

            if (ok) {
              let found = false;
              for (let i = 0; i < centers.length; i++) {
                if (clientY < centers[i]) {
                  nextGap = i;
                  found = true;
                  break;
                }
              }
              if (!found) nextGap = centers.length;
            }
          }

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
                    onEdit={() => openEdit(m)}
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
              onClick={() => openCreate(DAYS_SUN_START[0].key)}
              className="mt-4 w-full rounded-2xl border-2 border-dashed border-emerald-200/80 bg-emerald-50/30 py-3.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40"
            >
              ＋ レシピを追加
            </button>

            {editorOpen && !editingMenuId ? (
              <div className="mt-4 min-w-0 max-w-full overflow-x-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900/40">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 sm:col-span-2">
                    <label className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">メニュー名</label>
                    <input
                      value={draft.title}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className="mt-2 w-full rounded-xl border-2 border-zinc-300 bg-white px-4 py-3 text-base dark:border-zinc-600 dark:bg-zinc-950"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">曜日</label>
                    <select
                      value={draft.day}
                      onChange={(e) => setDraft((d) => ({ ...d, day: Number(e.target.value) as DayOfWeek }))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      {DAYS_SUN_START.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0 sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">レシピURL</label>
                    <div className="mt-1 flex min-w-0 gap-2">
                      <input
                        type="url"
                        value={draftRecipeUrlInput}
                        onChange={(e) => setDraftRecipeUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addDraftRecipeUrl();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        className="min-h-10 min-w-0 max-w-full flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
                      />
                      <button
                        type="button"
                        onClick={addDraftRecipeUrl}
                        className="min-h-10 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                      >
                        追加
                      </button>
                    </div>
                    {draftRecipeUrls.length > 0 ? (
                      <ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-950">
                        {draftRecipeUrls.map((u, idx) => (
                          <li key={`${u}-${idx}`} className="flex items-start gap-2 px-3 py-2">
                            <span className="min-w-0 flex-1 break-all text-sm leading-snug">{u}</span>
                            <button
                              type="button"
                              onClick={() => removeDraftRecipeUrlAt(idx)}
                              className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              削除
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="min-w-0 sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">買い物チェックリスト</label>
                    <div className="mt-1 flex min-w-0 gap-2">
                      <input
                        value={draftIngredientInput}
                        onChange={(e) => setDraftIngredientInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addDraftIngredient();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        className="min-h-10 min-w-0 max-w-full flex-1 rounded-xl border border-amber-300/80 bg-white px-3 py-2 text-base dark:border-amber-700 dark:bg-zinc-950"
                      />
                      <button
                        type="button"
                        onClick={addDraftIngredient}
                        className="min-h-10 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                      >
                        追加
                      </button>
                    </div>
                    {draftIngredients.length > 0 ? (
                      <>
                        <div className="mt-2 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3">
                          <ChecklistBulkRemoveButton
                            count={draftIngredientChecked.filter(Boolean).length}
                            onClick={removeCheckedDraftIngredients}
                            label="チェック済みを削除"
                          />
                        </div>
                        <ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-950">
                          {draftIngredients.map((item, idx) => (
                            <li key={`${item}-${idx}`}>
                              <ChecklistRow
                                id={`draft-ing-${idx}`}
                                checked={Boolean(draftIngredientChecked[idx])}
                                onChange={() => toggleDraftIngredientCheckedAt(idx)}
                                label={item}
                                accent="emerald"
                                ariaLabelChecked={`${item}のチェックを外す`}
                                ariaLabelUnchecked={`${item}を削除対象にする`}
                              />
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>

                  <div className="min-w-0 sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">レシピ画像</label>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        id="draft-recipe-image-input"
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          void onDraftRecipeImageSelected(e);
                        }}
                        className="sr-only"
                      />
                      <label
                        htmlFor="draft-recipe-image-input"
                        className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] dark:bg-emerald-500 dark:hover:bg-emerald-400"
                      >
                        {draftImageBusy ? '処理中...' : '画像を追加'}
                      </label>
                    </div>
                    {draftImageError ? (
                      <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{draftImageError}</p>
                    ) : null}
                    {draftPendingImages.length > 0 ? (
                      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {draftPendingImages.map((img) => (
                          <li
                            key={img.id}
                            className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            <img src={img.previewUrl} alt="" className="h-28 w-full object-cover" />
                            <div className="flex items-center justify-end gap-2 px-2 py-1.5">
                              <button
                                type="button"
                                onClick={() => removeDraftPendingImage(img.id)}
                                className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                削除
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="min-w-0 sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">メモ</label>
                    <textarea
                      value={draft.notes}
                      onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                      rows={3}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-200/70 pt-3 dark:border-zinc-700/70">
                  {saveMenuError ? (
                    <p className="mr-auto text-xs font-medium text-rose-600 dark:text-rose-400">{saveMenuError}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setEditorOpen(false);
                      setSaveMenuError(null);
                      setDraftRecipeUrlInput('');
                      setDraftIngredientInput('');
                      setDraftPendingImages((p) => {
                        for (const x of p) URL.revokeObjectURL(x.previewUrl);
                        return [];
                      });
                    }}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={saveMenuSubmitting}
                    onClick={() => {
                      void saveMenu();
                    }}
                    className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2 text-sm font-bold text-white shadow-md shadow-emerald-900/20 transition hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:from-emerald-500 dark:to-teal-500"
                  >
                    {saveMenuSubmitting ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            ) : null}

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
        open={editorOpen && Boolean(editingMenuId)}
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

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">曜日</label>
            <select
              value={draft.day}
              onChange={(e) => setDraft((d) => ({ ...d, day: Number(e.target.value) as DayOfWeek }))}
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {DAYS_SUN_START.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 sm:col-span-2">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              レシピURL（1行に1つ）
            </label>
            <textarea
              value={draft.recipeUrlsText}
              onChange={(e) => setDraft((d) => ({ ...d, recipeUrlsText: e.target.value }))}
              rows={4}
              className="mt-1 w-full min-w-0 max-w-full break-all rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
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
          {saveMenuError ? (
            <p className="mr-auto text-xs font-medium text-rose-600 dark:text-rose-400">{saveMenuError}</p>
          ) : null}
          <button
            onClick={() => {
              setEditorOpen(false);
              setSaveMenuError(null);
            }}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            キャンセル
          </button>
          <button
            disabled={saveMenuSubmitting}
            onClick={() => {
              void saveMenu();
            }}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-900/20 transition hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:from-emerald-500 dark:to-teal-500"
          >
            {saveMenuSubmitting ? '保存中...' : '保存'}
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
      collisionDetection={closestCenter}
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
        className={`touch-auto min-w-0 select-none rounded-2xl ${
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
  const save = (nextRaw: string) => {
    const next = nextRaw.trim();
    const cur = (menu.notes ?? '').trim();
    if (next === cur) return;
    updateMenu(menu.id, { notes: next });
  };

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <ChecklistSectionHeader title="メモ" accent="emerald" />
      <textarea
        id={`notes-${menu.id}`}
        defaultValue={menu.notes ?? ''}
        onBlur={(e) => save(e.currentTarget.value)}
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
    <div className="mt-4 min-w-0 border-t border-zinc-100 pt-4 dark:border-zinc-800">
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
          {menu.recipeUrls.map((u, idx) => (
            <ChecklistListItem key={`${u}-${idx}`}>
              <div className="flex items-start gap-2 py-2.5">
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 break-all text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
                >
                  {u}
                </a>
                <button
                  type="button"
                  onClick={() => removeRecipeUrlAt(menu.id, idx)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  aria-label={`レシピURLを削除: ${u}`}
                >
                  削除
                </button>
              </div>
            </ChecklistListItem>
          ))}
        </ChecklistList>
      ) : null}
    </div>
  );
}

function RecipeImageSection({ menu }: { menu: MenuItem }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const images = menu.recipeImages ?? [];
  const inputId = `recipe-image-input-${menu.id}`;

  const handleSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const existingImageCount = getPlannerData().menus.reduce((sum, m) => sum + (m.recipeImages?.length ?? 0), 0);
    const guard = await checkImageUploadGuard({ existingImageCount, nextFileBytes: file.size });
    if (!guard.allowed) {
      setError(guard.reason ?? '現在は画像アップロードできません。');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await addRecipeImage(menu.id, { name: file.name || 'recipe-image.jpg', blob: file });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setViewerIndex((prev) => {
      if (prev === null) return null;
      if (images.length === 0) return null;
      if (prev >= images.length) return images.length - 1;
      return prev;
    });
  }, [images.length]);

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <ChecklistSectionHeader title="レシピ画像" accent="emerald" />
      <div className="mt-3 flex items-center gap-2">
        <input
          id={inputId}
          type="file"
          accept="image/*"
          onChange={handleSelect}
          className="sr-only"
        />
        <label
          htmlFor={inputId}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] dark:bg-emerald-500 dark:hover:bg-emerald-400"
        >
          {busy ? '保存中...' : '画像を追加'}
        </label>
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p> : null}
      {images.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((img, index) => (
            <RecipeImageCard
              key={img.id}
              menuId={menu.id}
              img={img}
              onOpen={() => setViewerIndex(index)}
              onDelete={() => {
                void removeRecipeImage(menu.id, img.id);
              }}
            />
          ))}
        </ul>
      ) : null}
      <RecipeImageLightbox
        open={viewerIndex !== null && images.length > 0}
        menuId={menu.id}
        images={images}
        index={viewerIndex ?? 0}
        onChangeIndex={setViewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </div>
  );
}

function useRecipeImageDisplaySrc(menuId: string, img: RecipeImage | null): string | null {
  const [displaySrc, setDisplaySrc] = useState<string | null>(() => {
    if (!img) return null;
    return img.downloadUrl ?? img.dataUrl ?? null;
  });

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const run = async () => {
      if (!img) {
        setDisplaySrc(null);
        return;
      }
      if (img.downloadUrl || img.dataUrl) {
        setDisplaySrc(img.downloadUrl ?? img.dataUrl ?? null);
        return;
      }
      if (img.localOnly) {
        const originalBlob = await getRecipeImageOriginalBlob(menuId, img.id);
        const blob = originalBlob ?? (await getRecipeImageBlob(menuId, img.id));
        if (cancelled) return;
        if (!blob) {
          setDisplaySrc(null);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setDisplaySrc(objectUrl);
        return;
      }
      setDisplaySrc(null);
    };

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [menuId, img]);

  return displaySrc;
}

function RecipeImageCard({
  menuId,
  img,
  onOpen,
  onDelete,
}: {
  menuId: string;
  img: RecipeImage;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const displaySrc = useRecipeImageDisplaySrc(menuId, img);

  return (
    <li className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {displaySrc ? (
        <button
          type="button"
          onClick={onOpen}
          className="block h-28 w-full overflow-hidden text-left"
          aria-label={`${img.name}を拡大表示`}
        >
          <img src={displaySrc} alt={img.name} className="h-28 w-full object-cover" />
        </button>
      ) : (
        <div className="flex h-28 w-full items-center justify-center bg-zinc-100 px-2 text-center text-[11px] leading-snug text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {img.localOnly ? 'この端末に保存された画像（他端末では表示されません）' : '画像を表示できません'}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        {displaySrc ? (
          <a
            href={displaySrc}
            download={img.name}
            className="truncate text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
          >
            保存
          </a>
        ) : (
          <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">—</span>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          削除
        </button>
      </div>
    </li>
  );
}

function RecipeImageLightbox({
  open,
  menuId,
  images,
  index,
  onChangeIndex,
  onClose,
}: {
  open: boolean;
  menuId: string;
  images: RecipeImage[];
  index: number;
  onChangeIndex: (next: number) => void;
  onClose: () => void;
}) {
  const hasImages = images.length > 0;
  const safeIndex = hasImages ? Math.max(0, Math.min(index, images.length - 1)) : 0;
  const current = hasImages ? images[safeIndex] : null;
  const displaySrc = useRecipeImageDisplaySrc(menuId, current);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const moveBy = useCallback(
    (delta: number) => {
      if (images.length <= 1) return;
      const raw = safeIndex + delta;
      if (raw < 0) {
        onChangeIndex(images.length - 1);
        return;
      }
      if (raw >= images.length) {
        onChangeIndex(0);
        return;
      }
      onChangeIndex(raw);
    },
    [images.length, onChangeIndex, safeIndex]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') moveBy(-1);
      if (e.key === 'ArrowRight') moveBy(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, moveBy]);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyTouchAction = body.style.touchAction;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.touchAction = 'pan-x';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.touchAction = prevBodyTouchAction;
    };
  }, [open]);

  if (!open || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden overscroll-none bg-black/95"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="画像プレビュー"
    >
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-3 py-2 text-white">
        <div className="text-xs font-medium">
          {safeIndex + 1} / {images.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold backdrop-blur hover:bg-white/25"
        >
          閉じる
        </button>
      </div>

      <div
        className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStartXRef.current = t?.clientX ?? null;
          touchStartYRef.current = t?.clientY ?? null;
        }}
        onTouchEnd={(e) => {
          const sx = touchStartXRef.current;
          const sy = touchStartYRef.current;
          touchStartXRef.current = null;
          touchStartYRef.current = null;
          const t = e.changedTouches[0];
          if (sx === null || sy === null || !t) return;
          const dx = t.clientX - sx;
          const dy = t.clientY - sy;
          if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
          if (dx < 0) moveBy(1);
          else moveBy(-1);
        }}
      >
        {displaySrc ? (
          <>
            <img
              src={displaySrc}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-[100dvh] w-[100vw] scale-110 object-cover blur-2xl brightness-75"
            />
            <img
              src={displaySrc}
              alt={current.name}
              className="relative z-[1] mx-auto block h-[100dvh] w-auto max-w-full object-contain object-top"
            />
          </>
        ) : (
          <div className="rounded-xl bg-white/10 px-4 py-3 text-sm text-zinc-200">
            画像を表示できません
          </div>
        )}

        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => moveBy(-1)}
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/45 px-3 py-2 text-xl font-bold text-white hover:bg-black/60"
              aria-label="前の画像"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => moveBy(1)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/45 px-3 py-2 text-xl font-bold text-white hover:bg-black/60"
              aria-label="次の画像"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
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
  // レシピカード内の食材チェックリストと揃えるため、買い物枠も emerald を使用
  const accent = variant === 'shopping' ? 'emerald' : 'violet';
  const shellVariant = variant === 'shopping' ? 'emerald' : 'violet';

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
            label=""
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
            {DAYS_SUN_START.map((d) => (
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100/70 text-zinc-600 transition hover:bg-zinc-200/70 dark:bg-zinc-800/60 dark:hover:bg-zinc-700/60 dark:text-zinc-100"
            aria-label={collapsed ? '開く' : '閉じる'}
            title={collapsed ? '開く' : '閉じる'}
          >
            <span className="text-xl leading-none">{collapsed ? '▸' : '▾'}</span>
          </button>
        ) : (
          <span className="text-base text-zinc-500 dark:text-zinc-400">{collapsed ? '▸' : '▾'}</span>
        )}
      </div>
    </div>
  );
}

/** 一覧の「この位置の前に挿入」用ドロップゾーン */
function MenuInsertGap({
  insertIndex,
  active,
  highlight: _highlight,
}: {
  insertIndex: number;
  /** 献立カードをドラッグ中のみヒット領域を広げる */
  active: boolean;
  highlight: boolean;
}) {
  const id = `insert-at:${insertIndex}`;
  void _highlight;
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      // 位置調整のための「ヒット領域」は維持しつつ、見た目のバーだけ非表示にする
      className={`rounded-full transition-all opacity-0 ${
        active ? 'min-h-4 py-3' : 'min-h-0 py-0'
      }`}
      aria-hidden
    />
  );
}

const PlannerMenuRow = memo(
  function PlannerMenuRow({
    menu: m,
    activeDragMenuId,
    isCollapsed,
    onEdit,
    onToggleCollapsed,
  }: {
    menu: MenuItem;
    activeDragMenuId: string | null;
    isCollapsed: boolean;
    onEdit: () => void;
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
              <MenuCardBody menu={m} onEdit={onEdit} onToggleCollapsed={onToggleCollapsed} />
            )}
          </DraggableMenuCard>
        )}
      </div>
    );
  },
  (p, n) =>
    p.menu === n.menu && p.activeDragMenuId === n.activeDragMenuId && p.isCollapsed === n.isCollapsed
);

const MenuCardBody = memo(
  function MenuCardBody({
    menu,
    onEdit,
    onToggleCollapsed,
  }: {
    menu: MenuItem;
    onEdit: () => void;
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
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100/70 text-zinc-600 transition hover:bg-zinc-200/70 dark:bg-zinc-800/60 dark:hover:bg-zinc-700/60 dark:text-zinc-100"
                aria-label="メニューを編集"
                title="メニューを編集"
              >
                <span className="text-lg leading-none">✎</span>
              </button>
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100/70 text-zinc-600 transition hover:bg-zinc-200/70 dark:bg-zinc-800/60 dark:hover:bg-zinc-700/60 dark:text-zinc-100"
                aria-label="折りたたむ"
                title="折りたたむ"
              >
                <span className="text-xl leading-none">▾</span>
              </button>
            </div>
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
      <RecipeImageSection menu={menu} />
      <IngredientSection menu={menu} />
      <MenuNotesField menu={menu} />
    </div>
  );
  },
  (p, n) => p.menu === n.menu
);
