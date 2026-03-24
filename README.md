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
