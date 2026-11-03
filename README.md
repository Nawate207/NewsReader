# RSS Reader（GitHub Pages + Azure Logic Apps）

HTML/CSS/JavaScript のみの静的サイトです。ボタンで Logic Apps を実行し、返却された JSON をカード一覧で表示します。

## セットアップ

1. このフォルダをGitHubリポジトリに push し、Settings → Pages で公開（ブランチのルート）。
2. 公開URL（`https://<user>.github.io/<repo>/`）を各端末で開く。
3. 「設定」に Logic Apps の HTTP トリガー URL（SAS署名付き）を貼り付けて保存。
   **URLはソースに含めず、各ブラウザの localStorage にのみ保存されます**（公開リポジトリに署名URLを置かないため）。

## Logic Apps 側の要件

- トリガー: `When a HTTP request is received`（本アプリは **POST・ヘッダー/ボディなし**で呼び出し）
- RSS取得（`List all RSS feed items` など）→ 最後に **Response アクション**で JSON を返却
  - Status 200、Body: 配列、または `{ "value": [...] }`
  - 各要素の対応フィールド: `title`, `primaryLink`（または `link`/`url`/`links[]`）, `summary`（HTMLは除去して表示）, `publishDate`（または `updatedOn`）, `source`（任意）
  - **CORS対応**: Response の Headers に `Access-Control-Allow-Origin: https://<user>.github.io`（オリジンのみ、パスなし）を設定。ワイルドカード `*` は避ける。
  - Logic Apps のトリガーはプリフライト（OPTIONS）を処理できないため、本アプリは単純リクエストとして呼び出します。

## セキュリティ対策

- CSP: スクリプト/スタイルは自己ドメインのみ、通信先は `https://*.logic.azure.com` のみ
- 外部データは `textContent` で描画（`innerHTML` 不使用）。リンクは http/https のみ許可、`rel="noopener noreferrer"`
- URLは https かつ `*.logic.azure.com` のみ受け付け、入力欄は伏せ字（password）
- Referrer 送信なし、`noindex`、Cookie/認証情報は送信しない、タイムアウト・サイズ上限あり
- 推奨（Azure側）: SAS署名キーの定期ローテーション（Logic Apps → 「Regenerate access key」）、Response のオリジン固定、Logic App に過剰な権限を持たせない（RSS取得のみ）、実行履歴/アラートの確認
- 注意: GitHub Pages では HTTP レスポンスヘッダー（`frame-ancestors` 等）を設定できません。リポジトリは URL を含めないため公開でも問題ありませんが、署名URLを他人に共有しないでください。
