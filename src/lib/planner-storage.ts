import type {
  BasketItem,
  GlobalChecklistItem,
  Ingredient,
  MenuItem,
  PlannerData,
  PlannerDataV1,
  PlannerDataV2,
  PlannerDataV3,
  PlannerDataV4,
} from '@/lib/types';
import { getFirestoreDb } from '@/lib/firebase';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';

const STORAGE_KEY = 'kondate-planner-data';
const UPDATED_EVENT = 'kondate-planner-updated';

type PlannerDoc = { data: PlannerDataV4 };
const COLLECTION = 'shushi-app';
const DOCUMENT_ID = 'kondate-planner';
const LEGACY_COLLECTION = 'kondate-app';
const LEGACY_DOCUMENT_ID = 'planner';

function now() {
  return Date.now();
}

function nextId(prefix: string) {
  return `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 未保存・localStorage なしの初期状態。updatedAt は 0（「まだ一度も保存していない」）に固定する。
 * これを now() にすると、再起動直後の空ローカルがクラウドより新しく見えて Firestore を空で上書きするバグになる。
 */
function defaultData(): PlannerDataV4 {
  return {
    version: 4,
    updatedAt: 0,
    menus: [],
    basket: [],
    slotCountsByDay: { '0': 2, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2 },
    otherShopping: [],
    todos: [],
  };
}

function hasPlannerContent(data: PlannerDataV4): boolean {
  return (
    data.menus.length > 0 ||
    data.basket.length > 0 ||
    data.otherShopping.length > 0 ||
    data.todos.length > 0
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseGlobalItems(raw: unknown): GlobalChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GlobalChecklistItem[] = [];
  for (const row of raw) {
    if (!isObject(row)) continue;
    const id = String((row as { id?: unknown }).id ?? '');
    const text = String((row as { text?: unknown }).text ?? '').trim();
    if (!id || !text) continue;
    out.push({
      id,
      text,
      createdAt: Number((row as { createdAt?: unknown }).createdAt ?? now()),
      checked: Boolean((row as { checked?: unknown }).checked),
    });
  }
  return out;
}

function normalizePlannerV4(d: PlannerDataV4): PlannerDataV4 {
  return {
    version: 4,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    menus: Array.isArray(d.menus) ? d.menus : [],
    basket: Array.isArray(d.basket) ? d.basket : [],
    slotCountsByDay:
      d.slotCountsByDay && typeof d.slotCountsByDay === 'object' ? d.slotCountsByDay : defaultData().slotCountsByDay,
    otherShopping: Array.isArray(d.otherShopping) ? d.otherShopping : [],
    todos: Array.isArray(d.todos) ? d.todos : [],
  };
}

/** ローカル／クラウドの任意バージョンを正規化した v4 に統一 */
export function toPlannerDataV4(parsed: PlannerData | PlannerDataV4 | Record<string, unknown>): PlannerDataV4 {
  const ver = (parsed as { version?: unknown }).version;
  if (ver === 4) {
    return normalizePlannerV4(parsed as PlannerDataV4);
  }
  const v3 = migrateToV3(parsed as PlannerData);
  const raw = parsed as Record<string, unknown>;
  return normalizePlannerV4({
    ...v3,
    version: 4,
    otherShopping: parseGlobalItems(raw.otherShopping),
    todos: parseGlobalItems(raw.todos),
  });
}

function parseCloudData(raw: unknown): PlannerDataV4 | null {
  if (!isObject(raw)) return null;
  const maybeData = (raw as { data?: unknown }).data;
  if (!isObject(maybeData)) return null;
  const version = (maybeData as { version?: unknown }).version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return null;
  return toPlannerDataV4(maybeData as unknown as Record<string, unknown>);
}

function uploadToFirestore(data: PlannerDataV4): void {
  const db = getFirestoreDb();
  if (!db) return;
  const ref = doc(db, COLLECTION, DOCUMENT_ID);
  void setDoc(ref, { data } satisfies PlannerDoc, { merge: true }).catch(() => {
    // ignore (offline / no config)
  });
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function computeSlotCountsByDay(menus: MenuItem[]): Record<string, number> {
  const counts: Record<string, number> = { '0': 2, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2 };
  const maxByDay = new Map<number, number>();
  for (const m of menus) {
    const prev = maxByDay.get(m.day) ?? -1;
    maxByDay.set(m.day, Math.max(prev, m.order));
  }
  for (const [day, maxOrder] of maxByDay.entries()) {
    counts[String(day)] = Math.max(2, maxOrder + 1);
  }
  return counts;
}

function migrateToV3(parsed: PlannerData): PlannerDataV3 {
  if (parsed.version === 4) {
    const p = parsed as PlannerDataV4;
    return {
      version: 3,
      updatedAt: p.updatedAt,
      menus: p.menus,
      basket: p.basket,
      slotCountsByDay: p.slotCountsByDay,
    };
  }
  if (parsed.version === 3) return parsed as PlannerDataV3;
  const v2 = parsed.version === 2 ? (parsed as PlannerDataV2) : migrateToV2(parsed);
  return {
    version: 3,
    // v2 の更新時刻を維持（毎回 now() にすると同期比較が壊れる）
    updatedAt: typeof v2.updatedAt === 'number' ? v2.updatedAt : 0,
    menus: v2.menus,
    basket: v2.basket,
    slotCountsByDay: computeSlotCountsByDay(v2.menus),
  };
}

function migrateToV2(parsed: PlannerData): PlannerDataV2 {
  // v1(slotあり) -> v2(order) に寄せる
  if (parsed.version === 2) return parsed as PlannerDataV2;
  if (parsed.version === 4) {
    const v4 = parsed as PlannerDataV4;
    return { version: 2, updatedAt: v4.updatedAt, menus: v4.menus, basket: v4.basket };
  }
  if (parsed.version === 3) {
    const v3 = parsed as PlannerDataV3;
    return { version: 2, updatedAt: v3.updatedAt, menus: v3.menus, basket: v3.basket };
  }

  const v1 = parsed as PlannerDataV1;
  const slotOrder: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, other: 3 };

  const migratedMenus: MenuItem[] = (v1.menus ?? []).map((m: unknown) => {
    const obj = (m ?? {}) as Record<string, unknown>;
    const order =
      typeof obj.order === 'number'
        ? obj.order
        : typeof obj.slot === 'string'
          ? (slotOrder[obj.slot] ?? 0)
          : 0;

    return {
      id: String(obj.id ?? ''),
      title: String(obj.title ?? ''),
      day: Number(obj.day) as MenuItem['day'],
      order,
      recipeUrls: Array.isArray(obj.recipeUrls) ? obj.recipeUrls.map((u) => String(u)) : [],
      ingredients: Array.isArray(obj.ingredients)
        ? obj.ingredients
            .map((i: unknown) => {
              const ing = (i ?? {}) as Record<string, unknown>;
              return {
                id: String(ing.id ?? ''),
                text: String(ing.text ?? ''),
                createdAt: Number(ing.createdAt ?? now()),
                checked: Boolean(ing.checked),
              };
            })
            .filter((i: Ingredient) => Boolean(i.text))
        : [],
      notes: String(obj.notes ?? ''),
      createdAt: Number(obj.createdAt ?? now()),
      updatedAt: Number(obj.updatedAt ?? now()),
      deleteMarked: Boolean(obj.deleteMarked),
    } satisfies MenuItem;
  });

  // day+order で安定化。重複orderがあってもupdatedAt順で並べ直して連番に振り直す
  const byDay = new Map<number, MenuItem[]>();
  for (const m of migratedMenus) {
    const arr = byDay.get(m.day) ?? [];
    arr.push(m);
    byDay.set(m.day, arr);
  }
  const normalized: MenuItem[] = [];
  for (const [day, arr] of byDay.entries()) {
    const sorted = [...arr].sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt);
    sorted.forEach((m, idx) =>
      normalized.push({
        ...m,
        day: day as MenuItem['day'],
        order: idx,
      })
    );
  }

  const migratedBasket: BasketItem[] = (v1.basket ?? []).map((b: unknown) => {
    const obj = (b ?? {}) as Record<string, unknown>;
    return {
      id: String(obj.id ?? ''),
      text: String(obj.text ?? ''),
      menuId: String(obj.menuId ?? ''),
      menuTitle: String(obj.menuTitle ?? ''),
      day: Number(obj.day) as BasketItem['day'],
      addedAt: Number(obj.addedAt ?? now()),
    };
  });

  return {
    version: 2,
    updatedAt: now(),
    menus: normalized,
    basket: migratedBasket.filter((b) => Boolean(b.text)),
  };
}

export function getPlannerData(): PlannerDataV4 {
  if (typeof window === 'undefined') return defaultData();
  const parsed = safeParse<PlannerData | PlannerDataV4>(window.localStorage.getItem(STORAGE_KEY));
  if (
    !parsed ||
    (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4)
  ) {
    return defaultData();
  }
  return toPlannerDataV4(parsed as unknown as Record<string, unknown>);
}

export function savePlannerData(data: PlannerDataV4): void {
  if (typeof window === 'undefined') return;
  const next: PlannerDataV4 = normalizePlannerV4({ ...data, version: 4, updatedAt: now() });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: next }));
  uploadToFirestore(next);
}

export async function initialSyncPlannerFromFirestore(): Promise<void> {
  if (typeof window === 'undefined') return;
  const db = getFirestoreDb();
  if (!db) return;

  try {
    const ref = doc(db, COLLECTION, DOCUMENT_ID);
    const legacyRef = doc(db, LEGACY_COLLECTION, LEGACY_DOCUMENT_ID);
    const localRaw = window.localStorage.getItem(STORAGE_KEY);
    const localAny = safeParse<PlannerData | PlannerDataV4>(localRaw);
    const local = localAny ? toPlannerDataV4(localAny as unknown as Record<string, unknown>) : defaultData();
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // 旧保存先にデータがある場合は新保存先へ移行
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        const legacyCloud = parseCloudData(legacySnap.data());
        if (legacyCloud) {
          await setDoc(ref, { data: legacyCloud } satisfies PlannerDoc, { merge: true });
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyCloud));
          return;
        }
      }
      await setDoc(ref, { data: local } satisfies PlannerDoc, { merge: true });
      return;
    }

    const cloud = parseCloudData(snap.data());
    if (!cloud) {
      await setDoc(ref, { data: local } satisfies PlannerDoc, { merge: true });
      return;
    }

    // クラウドに献立/かごがあるのにローカルが空 → 必ずクラウド優先（空ローカルで上書きしない）
    if (hasPlannerContent(cloud) && !hasPlannerContent(local)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
      return;
    }
    // ローカルにだけ中身がある → アップロード
    if (hasPlannerContent(local) && !hasPlannerContent(cloud)) {
      await setDoc(ref, { data: local } satisfies PlannerDoc, { merge: true });
      return;
    }

    // 両方中身がある、または両方空 → updatedAt が新しい方を正として同期
    if ((local.updatedAt ?? 0) > (cloud.updatedAt ?? 0)) {
      await setDoc(ref, { data: local } satisfies PlannerDoc, { merge: true });
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
  } catch {
    // ignore
  }
}

export function subscribePlanner(onChange: (data: PlannerDataV4) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const db = getFirestoreDb();
  if (!db) return () => {};

  const ref = doc(db, COLLECTION, DOCUMENT_ID);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const cloud = parseCloudData(snap.data());
      if (!cloud) return;
      const local = getPlannerData();
      // 古いスナップショットで最新ローカルを巻き戻さない
      if ((cloud.updatedAt ?? 0) < (local.updatedAt ?? 0)) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
      onChange(cloud);
    },
    () => {
      // ignore
    }
  );
}

export function subscribePlannerLocal(onChange: (data: PlannerDataV4) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (ev: Event) => {
    const e = ev as CustomEvent<PlannerDataV4 | PlannerDataV3>;
    if (!e.detail) return;
    if (e.detail.version === 4) {
      onChange(normalizePlannerV4(e.detail as PlannerDataV4));
      return;
    }
    if (e.detail.version === 3) {
      onChange(toPlannerDataV4(e.detail as unknown as PlannerData));
      return;
    }
  };
  window.addEventListener(UPDATED_EVENT, handler);
  return () => window.removeEventListener(UPDATED_EVENT, handler);
}

export function addMenu(
  input: Pick<MenuItem, 'title' | 'day'> & Partial<Pick<MenuItem, 'notes' | 'recipeUrls' | 'order'>>
): MenuItem | null {
  const data = getPlannerData();
  const t = input.title.trim();
  if (!t) return null;
  const ts = now();

  const dayMenus = data.menus.filter((m) => m.day === input.day);
  const nextOrder = input.order ?? (dayMenus.length > 0 ? Math.max(...dayMenus.map((m) => m.order)) + 1 : 0);

  const menu: MenuItem = {
    id: nextId('menu-'),
    title: t,
    day: input.day,
    order: nextOrder,
    recipeUrls: (input.recipeUrls ?? []).map((u) => u.trim()).filter(Boolean),
    ingredients: [],
    notes: (input.notes ?? '').trim(),
    createdAt: ts,
    updatedAt: ts,
    deleteMarked: false,
  };
  const nextMenus = [...data.menus, menu];
  savePlannerData({ ...data, menus: nextMenus });
  return menu;
}

export function updateMenu(
  menuId: string,
  patch: Partial<Pick<MenuItem, 'title' | 'day' | 'notes' | 'recipeUrls' | 'order'>>
): void {
  const data = getPlannerData();
  const ts = now();
  const nextMenus = data.menus.map((m) => {
    if (m.id !== menuId) return m;
    return {
      ...m,
      title: patch.title !== undefined ? patch.title.trim() : m.title,
      day: patch.day !== undefined ? patch.day : m.day,
      order: patch.order !== undefined ? patch.order : m.order,
      notes: patch.notes !== undefined ? patch.notes.trim() : m.notes,
      recipeUrls:
        patch.recipeUrls !== undefined ? patch.recipeUrls.map((u) => u.trim()).filter(Boolean) : m.recipeUrls,
      updatedAt: ts,
    };
  });
  savePlannerData({ ...data, menus: nextMenus });
}

export function deleteMenu(menuId: string): void {
  const data = getPlannerData();
  savePlannerData({
    ...data,
    menus: data.menus.filter((m) => m.id !== menuId),
    basket: data.basket.filter((b) => b.menuId !== menuId),
  });
}

export function toggleMenuDeleteMarked(menuId: string): void {
  const data = getPlannerData();
  const ts = now();
  const nextMenus = data.menus.map((m) =>
    m.id === menuId ? { ...m, deleteMarked: !m.deleteMarked, updatedAt: ts } : m
  );
  savePlannerData({ ...data, menus: nextMenus });
}

/** チェック済み（deleteMarked）の献立をまとめて削除。関連する買い物かご行も削除 */
export function removeDeleteMarkedMenus(): void {
  const data = getPlannerData();
  const removeIds = new Set(data.menus.filter((m) => m.deleteMarked).map((m) => m.id));
  if (removeIds.size === 0) return;
  savePlannerData({
    ...data,
    menus: data.menus.filter((m) => !m.deleteMarked),
    basket: data.basket.filter((b) => !removeIds.has(b.menuId)),
  });
}

/** メニューをドラッグ&ドロップ等で移動（曜日/順番の変更 + 再採番） */
export function moveMenu(menuId: string, nextDay: MenuItem['day'], nextOrder: number): void {
  const data = getPlannerData();
  const menu = data.menus.find((m) => m.id === menuId);
  if (!menu) return;

  const fromDay = menu.day;
  const toDay = nextDay;
  const ts = now();

  const fromList = data.menus.filter((m) => m.day === fromDay && m.id !== menuId).sort((a, b) => a.order - b.order);
  const toBase =
    fromDay === toDay
      ? fromList
      : data.menus.filter((m) => m.day === toDay).sort((a, b) => a.order - b.order);

  const insertAt = Math.max(0, Math.min(nextOrder, toBase.length));
  const moved: MenuItem = { ...menu, day: toDay, order: insertAt, updatedAt: ts };
  const toList = [...toBase.slice(0, insertAt), moved, ...toBase.slice(insertAt)];

  const reindex = (list: MenuItem[], day: MenuItem['day']) =>
    list.map((m, idx) => ({ ...m, day, order: idx, updatedAt: m.id === menuId ? ts : m.updatedAt }));

  const nextMenus =
    fromDay === toDay
      ? [
          ...data.menus.filter((m) => m.day !== fromDay),
          ...reindex(toList, toDay),
        ]
      : [
          ...data.menus.filter((m) => m.day !== fromDay && m.day !== toDay),
          ...reindex(fromList, fromDay),
          ...reindex(toList, toDay),
        ];

  // かごの表示も曜日変更に追従（メニュータイトル変更にも追従）
  const nextBasket = data.basket.map((b) =>
    b.menuId === menuId ? { ...b, day: toDay, menuTitle: moved.title } : b
  );

  savePlannerData({ ...data, menus: nextMenus, basket: nextBasket });
}

/** 月→日・同一曜日内 order でフラット化（表示順と一致） */
export function flattenMenusByDayOrder(menus: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (let d = 0; d <= 6; d++) {
    out.push(
      ...menus
        .filter((m) => m.day === d)
        .sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt)
    );
  }
  return out;
}

/**
 * 一覧（月→日順）の gapIndex 番目の「線」の前に挿入。gapIndex === 並びの長さなら末尾へ。
 */
export function moveMenuToFlatGapIndex(menuId: string, gapIndex: number): void {
  const data = getPlannerData();
  const full = flattenMenusByDayOrder(data.menus);
  const n = full.length;

  if (gapIndex < 0 || gapIndex > n) return;

  const selfIdx = full.findIndex((m) => m.id === menuId);
  if (selfIdx >= 0 && gapIndex === selfIdx) return;

  if (gapIndex === n) {
    const without = full.filter((m) => m.id !== menuId);
    const last = without[without.length - 1];
    if (!last) {
      const self = data.menus.find((m) => m.id === menuId);
      if (!self) return;
      moveMenu(menuId, self.day, 0);
      return;
    }
    const tailCount = without.filter((m) => m.day === last.day).length;
    moveMenu(menuId, last.day, tailCount);
    return;
  }

  const beforeTarget = full[gapIndex];
  if (beforeTarget.id === menuId) return;

  const targetDay = beforeTarget.day;
  const sameDaySorted = full
    .filter((m) => m.day === targetDay && m.id !== menuId)
    .sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt);
  const pos = sameDaySorted.findIndex((m) => m.id === beforeTarget.id);
  if (pos < 0) return;
  moveMenu(menuId, targetDay, pos);
}

/** 折りたたみバー等から曜日だけ変更（移動先曜日の末尾に追加） */
export function setMenuDay(menuId: string, nextDay: MenuItem['day']): void {
  const data = getPlannerData();
  const menu = data.menus.find((m) => m.id === menuId);
  if (!menu || menu.day === nextDay) return;
  const toBase = data.menus.filter((m) => m.day === nextDay).sort((a, b) => a.order - b.order);
  moveMenu(menuId, nextDay, toBase.length);
}

/**
 * 月→日の曜日順に、各曜日内を order → 更新日時 → タイトルで整列し order を 0 から振り直す
 */
export function sortMenusByDayOrder(): void {
  const data = getPlannerData();
  const nextMenus: MenuItem[] = [];
  for (let d = 0; d <= 6; d++) {
    const list = data.menus
      .filter((m) => m.day === d)
      .sort(
        (a, b) =>
          a.order - b.order ||
          a.updatedAt - b.updatedAt ||
          a.title.localeCompare(b.title, 'ja')
      );
    list.forEach((m, idx) => nextMenus.push({ ...m, order: idx }));
  }
  savePlannerData({ ...data, menus: nextMenus });
}

export function addIngredient(menuId: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  const data = getPlannerData();
  const ts = now();
  const nextMenus = data.menus.map((m) => {
    if (m.id !== menuId) return m;
    const ing: Ingredient = { id: nextId('ing-'), text: t, createdAt: ts, checked: false };
    return { ...m, ingredients: [...m.ingredients, ing], updatedAt: ts };
  });
  savePlannerData({ ...data, menus: nextMenus });
}

/** メニューの買い物リスト（食材）を一括で置き換える（モーダル保存時用） */
export function setMenuIngredients(menuId: string, texts: string[]): void {
  const data = getPlannerData();
  const ts = now();
  const ingredients: Ingredient[] = texts
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ id: nextId('ing-'), text, createdAt: ts, checked: false }));
  const nextMenus = data.menus.map((m) => {
    if (m.id !== menuId) return m;
    return { ...m, ingredients, updatedAt: ts };
  });
  savePlannerData({ ...data, menus: nextMenus });
}

/** チェック済みの食材をまとめて削除 */
export function removeCheckedIngredients(menuId: string): void {
  const data = getPlannerData();
  const ts = now();
  const nextMenus = data.menus.map((m) => {
    if (m.id !== menuId) return m;
    const remaining = m.ingredients.filter((i) => !i.checked);
    return { ...m, ingredients: remaining, updatedAt: ts };
  });
  savePlannerData({ ...data, menus: nextMenus });
}

/** メニューにレシピURLを1件追加 */
export function appendRecipeUrl(menuId: string, url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const data = getPlannerData();
  const menu = data.menus.find((m) => m.id === menuId);
  if (!menu) return;
  if (menu.recipeUrls.includes(trimmed)) return;
  updateMenu(menuId, { recipeUrls: [...menu.recipeUrls, trimmed] });
}

/** 食材のチェック（買った印）をトグル。食材は消えず一覧に残る */
export function toggleIngredientChecked(menuId: string, ingredientId: string): void {
  const data = getPlannerData();
  const ts = now();
  const nextMenus = data.menus.map((m) => {
    if (m.id !== menuId) return m;
    return {
      ...m,
      ingredients: m.ingredients.map((i) =>
        i.id === ingredientId ? { ...i, checked: !i.checked } : i
      ),
      updatedAt: ts,
    };
  });
  savePlannerData({ ...data, menus: nextMenus });
}

export function moveIngredientToBasket(menuId: string, ingredientId: string): void {
  const data = getPlannerData();
  const menu = data.menus.find((m) => m.id === menuId);
  if (!menu) return;
  const ing = menu.ingredients.find((i) => i.id === ingredientId);
  if (!ing) return;

  const ts = now();
  const basketItem: BasketItem = {
    id: nextId('basket-'),
    text: ing.text,
    menuId: menu.id,
    menuTitle: menu.title,
    day: menu.day,
    addedAt: ts,
  };

  const nextMenus = data.menus.map((m) => {
    if (m.id !== menuId) return m;
    return { ...m, ingredients: m.ingredients.filter((i) => i.id !== ingredientId), updatedAt: ts };
  });

  savePlannerData({ ...data, menus: nextMenus, basket: [...data.basket, basketItem] });
}

export function removeBasketItem(basketItemId: string): void {
  const data = getPlannerData();
  savePlannerData({ ...data, basket: data.basket.filter((b) => b.id !== basketItemId) });
}

// --- その他の買い物チェックリスト（献立外） ---

export function addOtherShoppingItem(text: string): void {
  const t = text.trim();
  if (!t) return;
  const data = getPlannerData();
  const ts = now();
  const item: GlobalChecklistItem = { id: nextId('oshop-'), text: t, createdAt: ts, checked: false };
  savePlannerData({ ...data, otherShopping: [...data.otherShopping, item] });
}

export function toggleOtherShoppingItem(itemId: string): void {
  const data = getPlannerData();
  savePlannerData({
    ...data,
    otherShopping: data.otherShopping.map((i) =>
      i.id === itemId ? { ...i, checked: !i.checked } : i
    ),
  });
}

export function removeOtherShoppingItem(itemId: string): void {
  const data = getPlannerData();
  savePlannerData({ ...data, otherShopping: data.otherShopping.filter((i) => i.id !== itemId) });
}

export function removeCheckedOtherShopping(): void {
  const data = getPlannerData();
  savePlannerData({ ...data, otherShopping: data.otherShopping.filter((i) => !i.checked) });
}

// --- やることチェックリスト ---

export function addTodoItem(text: string): void {
  const t = text.trim();
  if (!t) return;
  const data = getPlannerData();
  const ts = now();
  const item: GlobalChecklistItem = { id: nextId('todo-'), text: t, createdAt: ts, checked: false };
  savePlannerData({ ...data, todos: [...data.todos, item] });
}

export function toggleTodoItem(itemId: string): void {
  const data = getPlannerData();
  savePlannerData({
    ...data,
    todos: data.todos.map((i) => (i.id === itemId ? { ...i, checked: !i.checked } : i)),
  });
}

export function removeTodoItem(itemId: string): void {
  const data = getPlannerData();
  savePlannerData({ ...data, todos: data.todos.filter((i) => i.id !== itemId) });
}

export function removeCheckedTodos(): void {
  const data = getPlannerData();
  savePlannerData({ ...data, todos: data.todos.filter((i) => !i.checked) });
}

