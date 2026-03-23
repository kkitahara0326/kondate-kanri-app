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
