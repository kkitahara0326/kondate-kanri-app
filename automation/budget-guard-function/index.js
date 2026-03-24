import { Firestore } from "@google-cloud/firestore";

const firestore = new Firestore();
const LIMITS_DOC = "app-config/limits";

function getEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function parsePayload(event) {
  const candidates = [
    event?.data?.message?.data, // CloudEvent Pub/Sub
    event?.data?.data, // fallback shape
    event?.message?.data, // legacy shape
    event?.data, // direct payload/base64
  ];
  const encoded = candidates.find((v) => typeof v === "string" && v.length > 0);
  if (!encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  const attempts = [
    decoded,
    decoded.replace(/\\"/g, '"'),
    decoded.replace(/^["'](.*)["']$/s, "$1"),
    decoded.replace(/^["'](.*)["']$/s, "$1").replace(/\\"/g, '"'),
  ];
  for (const raw of attempts) {
    try {
      return JSON.parse(raw);
    } catch {
      // next attempt
    }
  }
  return null;
}

function extractThresholdRatio(payload) {
  // Budget notification examples:
  // - alertThresholdExceeded: 0.8
  // - budgetAmount/costAmount (derive ratio)
  const explicit = Number(payload?.alertThresholdExceeded);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const cost = Number(payload?.costAmount);
  const budget = Number(payload?.budgetAmount);
  if (Number.isFinite(cost) && Number.isFinite(budget) && budget > 0) {
    return cost / budget;
  }
  return null;
}

export async function budgetGuard(event) {
  const minThreshold = getEnvNumber("BUDGET_GUARD_THRESHOLD", 0.8);
  const blockMessage =
    process.env.BUDGET_GUARD_MESSAGE || "今月上限に近いため画像追加を停止中です（予算アラート連動）";

  const payload = parsePayload(event);
  const ratio = payload ? extractThresholdRatio(payload) : null;
  if (ratio !== null && ratio < minThreshold) {
    console.log(`budgetGuard: skip (ratio=${ratio} < threshold=${minThreshold})`);
    return;
  }
  const reason = ratio === null ? "payload-unparsed" : `ratio=${ratio}`;

  const data = {
    blockImageUpload: true,
    imageUploadMessage: blockMessage,
    updatedAt: Date.now(),
    updatedBy: "budget-guard-function",
  };

  await firestore.doc(LIMITS_DOC).set(data, { merge: true });
  console.log(`budgetGuard: block enabled (${reason})`);
}
