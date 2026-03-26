import { doc, getDoc } from 'firebase/firestore';
import { getFirestoreDb } from '@/lib/firebase';

export type ImageUploadPolicy = {
  blocked: boolean;
  maxImageCount: number | null;
  maxFileBytes: number | null;
  message: string | null;
};

type GuardInput = {
  existingImageCount: number;
  nextFileBytes: number;
};

type GuardResult = {
  allowed: boolean;
  reason?: string;
};

const DEFAULT_MESSAGE = '現在は画像アップロードを停止しています。';
/** 環境変数・Firestore未設定時の1枚あたり上限（選択ファイルの元サイズ。iPhoneスクショ想定） */
export const DEFAULT_MAX_RECIPE_IMAGE_BYTES = 3 * 1024 * 1024;
const CONFIG_COLLECTION = 'app-config';
const CONFIG_DOC = 'limits';
const CACHE_MS = 5_000;

let cache: { at: number; policy: ImageUploadPolicy } | null = null;

function toNumberOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  return Math.floor(v);
}

function formatMaxFileLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
  }
  return `${Math.ceil(bytes / 1024)}KB`;
}

function basePolicy(): ImageUploadPolicy {
  const blockedByEnv = process.env.NEXT_PUBLIC_BLOCK_IMAGE_UPLOAD === 'true';
  const envMaxBytes = toNumberOrNull(
    process.env.NEXT_PUBLIC_MAX_RECIPE_IMAGE_BYTES
      ? Number(process.env.NEXT_PUBLIC_MAX_RECIPE_IMAGE_BYTES)
      : null
  );
  return {
    blocked: blockedByEnv,
    maxImageCount: toNumberOrNull(
      process.env.NEXT_PUBLIC_MAX_RECIPE_IMAGE_COUNT
        ? Number(process.env.NEXT_PUBLIC_MAX_RECIPE_IMAGE_COUNT)
        : null
    ),
    maxFileBytes: envMaxBytes ?? DEFAULT_MAX_RECIPE_IMAGE_BYTES,
    message: blockedByEnv ? DEFAULT_MESSAGE : null,
  };
}

function mergeRemote(base: ImageUploadPolicy, raw: unknown): ImageUploadPolicy {
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const blocked = typeof obj.blockImageUpload === 'boolean' ? obj.blockImageUpload : base.blocked;
  const maxImageCount = toNumberOrNull(obj.maxRecipeImagesPerWeek) ?? base.maxImageCount;
  const maxFileBytes = toNumberOrNull(obj.maxImageBytes) ?? base.maxFileBytes;
  const message =
    typeof obj.imageUploadMessage === 'string' && obj.imageUploadMessage.trim().length > 0
      ? obj.imageUploadMessage.trim()
      : blocked
        ? base.message ?? DEFAULT_MESSAGE
        : base.message;
  return { blocked, maxImageCount, maxFileBytes, message };
}

export async function getImageUploadPolicy(): Promise<ImageUploadPolicy> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.policy;

  const base = basePolicy();
  const db = getFirestoreDb();
  if (!db) {
    cache = { at: now, policy: base };
    return base;
  }

  try {
    const snap = await getDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC));
    const policy = snap.exists() ? mergeRemote(base, snap.data()) : base;
    cache = { at: now, policy };
    return policy;
  } catch {
    // フェイルセーフ: 予算保護のため、設定取得に失敗した場合はアップロード禁止へ倒す
    const safePolicy: ImageUploadPolicy = {
      ...base,
      blocked: true,
      message: '設定取得に失敗したため、画像アップロードを一時停止しています。',
    };
    cache = { at: now, policy: safePolicy };
    return safePolicy;
  }
}

export async function checkImageUploadGuard(input: GuardInput): Promise<GuardResult> {
  const policy = await getImageUploadPolicy();
  if (policy.blocked) {
    return { allowed: false, reason: policy.message ?? DEFAULT_MESSAGE };
  }
  if (policy.maxImageCount !== null && input.existingImageCount >= policy.maxImageCount) {
    return { allowed: false, reason: `画像の上限(${policy.maxImageCount}枚)に達しました。` };
  }
  if (policy.maxFileBytes !== null && input.nextFileBytes > policy.maxFileBytes) {
    return {
      allowed: false,
      reason: `画像サイズが上限(${formatMaxFileLabel(policy.maxFileBytes)})を超えています。`,
    };
  }
  return { allowed: true };
}

