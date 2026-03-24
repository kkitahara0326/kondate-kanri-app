export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Mon..Sun

export interface Ingredient {
  id: string;
  text: string;
  createdAt: number;
  /** 買い物で買ったらチェック。true でも一覧からは消さない */
  checked?: boolean;
}

export interface RecipeImage {
  id: string;
  name: string;
  /** 旧データ互換: Firestoreへ直接保存していたbase64 */
  dataUrl?: string;
  /** 本番運用: Firebase Storage上のオブジェクトパス */
  storagePath?: string;
  /** 本番運用: Firebase StorageのダウンロードURL */
  downloadUrl?: string;
  createdAt: number;
}

export interface MenuItem {
  id: string;
  title: string;
  day: DayOfWeek;
  /** 同一曜日内の表示順（ドラッグや整列で更新） */
  order: number;
  recipeUrls: string[];
  ingredients: Ingredient[];
  notes: string;
  recipeImages?: RecipeImage[];
  createdAt: number;
  updatedAt: number;
  /** チェック後に一覧からまとめて削除するための印 */
  deleteMarked?: boolean;
}

export interface BasketItem {
  id: string;
  text: string;
  menuId: string;
  menuTitle: string;
  day: DayOfWeek;
  addedAt: number;
}

export interface PlannerDataV1 {
  version: 1;
  updatedAt: number;
  menus: MenuItem[];
  basket: BasketItem[];
}

export interface PlannerDataV2 {
  version: 2;
  updatedAt: number;
  menus: MenuItem[];
  basket: BasketItem[];
}

export interface PlannerDataV3 {
  version: 3;
  updatedAt: number;
  menus: MenuItem[];
  basket: BasketItem[];
  /** 旧バージョン互換用（UIでは未使用） */
  slotCountsByDay: Record<string, number>;
}

/** 献立に紐づかないチェックリスト行（その他買い物・やること等） */
export interface GlobalChecklistItem {
  id: string;
  text: string;
  createdAt: number;
  checked?: boolean;
}

export interface PlannerDataV4 {
  version: 4;
  updatedAt: number;
  menus: MenuItem[];
  basket: BasketItem[];
  slotCountsByDay: Record<string, number>;
  otherShopping: GlobalChecklistItem[];
  todos: GlobalChecklistItem[];
}

export type PlannerData = PlannerDataV1 | PlannerDataV2 | PlannerDataV3 | PlannerDataV4;

export const DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 0, label: '月' },
  { key: 1, label: '火' },
  { key: 2, label: '水' },
  { key: 3, label: '木' },
  { key: 4, label: '金' },
  { key: 5, label: '土' },
  { key: 6, label: '日' },
];

