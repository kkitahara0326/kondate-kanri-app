# 献立管理アプリ（kondate-kanri-app）

要件を満たす「1週間の献立 + 買い物かご」管理アプリです。

- **1週間の献立を曜日ごとに管理**
- **メニューごとに曜日を選択（朝/昼/夜/その他も対応）**
- **食材メモ → 「かごへ」でサッと削除（買い物かごへ移動）**
- **メニューごとにクックパッド/インスタ等のURL保存**
- **スマホのブラウザでURLを開くだけで常に最新を確認/編集**
  - Firebase を設定した場合: Firestore を購読しリアルタイム反映
  - 未設定の場合: localStorage のみで動作

## セットアップ

```bash
cd kondate-kanri-app
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開いてください。

## Firebase（任意・推奨）

スマホ/PCで「常に最新」にするには Firestore を使います。

`.env.local` に以下を設定してください。

```bash
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
```

未設定でもアプリ自体は動きます（localStorageのみ）。

> 注意: Firestore を認証なしで使う場合は、セキュリティルール設計が必要です。

## 課金について

**課金を前提にはしていません。**

- Firebase を**未設定**のときは **localStorage のみ**で動き、クラウド料金はかかりません。
- **Firestore** は無料枠（Spark）の範囲で使う想定です（ルールは必ず自分で設計してください）。
- **Firebase Storage**（レシピ画像のクラウド保存）を有効にすると、プロジェクトによっては **Blaze（従量課金）への切り替え**が必要になることがあります。使わない・未設定なら、画像は **IndexedDB のみ**で表示されます。

## GitHub への「デプロイ」

1. **コードを GitHub に載せる**  
   リポジトリを作成し、`git remote add` して `main`（または運用ブランチ）へ `git push` するだけです。

2. **push したら自動で Firebase Hosting へ出す（任意）**  
   `.github/workflows/deploy-hosting.yml` が `main` への push で `npm run build` → Firebase Hosting にデプロイします。  
   GitHub リポジトリの **Settings → Secrets and variables → Actions** に次を設定してください。

   | Name | 内容 |
   |------|------|
   | `FIREBASE_SERVICE_ACCOUNT` | Firebase コンソールのサービスアカウント JSON 全文（[Hosting の GitHub 連携手順](https://firebase.google.com/docs/hosting/github-integration)参照） |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ビルド時に埋め込む（本番と同じ値推奨） |
   | `NEXT_PUBLIC_FIREBASE_API_KEY` | 同上 |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 同上 |
   | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | 任意（未設定ならクライアント側で `projectId.appspot.com` 系に寄せる想定） |

   ブランチ名が `main` でない場合は、ワークフローの `branches` を書き換えてください。

手元からだけデプロイする場合は `npm run deploy`（Firebase CLI ログイン済みが前提）でも同じです。

## 予算アラート連動の自動停止（blockImageUpload の自動化）

予算アラートを Pub/Sub に流し、Cloud Function で `app-config/limits.blockImageUpload=true` を自動更新できます。

### 1) Budget alert の Pub/Sub 通知を有効化

Google Cloud Billing の予算設定で、通知先に Pub/Sub トピック（例: `billing-budget-alerts`）を追加します。

### 2) 関数をデプロイ

```bash
npm run deploy:budget-guard
```

必要に応じて `scripts/deploy-budget-guard.ps1` の引数で変更できます。

```powershell
.\scripts\deploy-budget-guard.ps1 -ProjectId shushi-kanri-app -Region asia-northeast1 -Topic billing-budget-alerts -Threshold 0.8
```

### 3) 動作

- 予算通知の閾値が `BUDGET_GUARD_THRESHOLD`（既定 0.8）以上になると、Firestore `app-config/limits` に以下を merge します。
  - `blockImageUpload: true`
  - `imageUploadMessage: 今月上限に近いため画像追加を停止中です（予算アラート連動）`
  - `updatedBy: budget-guard-function`

> 注意: 自動で `false` には戻しません。月初など任意タイミングで手動解除してください。
