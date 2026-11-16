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
  - **カテゴリ**: 各要素に `category`（`国内メイン` / `IT` / `経済` / `鉄道` / `その他`）を付与。未指定・上記以外は「その他」に分類。`category` に会社名（`JR東日本`、`東武鉄道` など主要鉄道会社）が入っている場合は「鉄道」に集約し、会社名はカードの配信元として表示され、「鉄道」の中は 地域（JR／関東／中部／関西／中国・四国／九州・沖縄／その他）→ 会社 の2階層の開閉グループに分けて表示（地域は初期状態で開き、会社は閉じる。キーワード絞り込み中は自動で開く）。会社名と地域の対応は [app.js](app.js) の `RAIL_REGIONS` で定義（新しい会社を追加する場合はここに追記。未登録でも「その他」地域に表示されます）。`{ "国内メイン": [...], "IT": [...] }` のカテゴリ別オブジェクトでも可。`IT（Yahoo）` / `IT（窓の杜）` / `IT（IT Media）` のように括弧付きで返すと、「IT」大分類の配下にメディア別の開閉グループとして表示（括弧は全角・半角どちらも可）。アプリ側ではカテゴリごとの開閉表示（開閉状態は端末に保存）。重複記事は除外し、配信元ごとに最新20件・カテゴリごとに最大300件まで表示: Response の Headers に `Access-Control-Allow-Origin: https://<user>.github.io`（オリジンのみ、パスなし）を設定。ワイルドカード `*` は避ける。
  - Logic Apps のトリガーはプリフライト（OPTIONS）を処理できないため、本アプリは単純リクエスト（`text/plain` の POST、ボディ `{}`）として呼び出します。トリガーのリクエスト本文スキーマは未設定にしてください。

## 新着（New）表示

- 取得のたびに、前回までに見ていない記事へ「New」ラベルを付け、含まれるカテゴリ／地域／会社の枠にも「New 件数」を表示します。
- 記事のリンクを開くと、その記事の New が消えます（開くまで残り続けます）。「全て既読」ボタンで一括解除もできます。
- 初回の取得は基準として記録するだけで、New にはしません。
- 既読/未読の状態は端末のブラウザごとに保存されます（PCとスマホで共有されません）。

## セキュリティ対策

- CSP: スクリプト/スタイルは自己ドメインのみ、通信先は `https://*.logic.azure.com` のみ
- 外部データは `textContent` で描画（`innerHTML` 不使用）。リンクは http/https のみ許可、`rel="noopener noreferrer"`
- URLは https かつ `*.logic.azure.com` のみ受け付け、入力欄は伏せ字（password）
- Referrer 送信なし、`noindex`、Cookie/認証情報は送信しない、タイムアウト・サイズ上限あり
- 推奨（Azure側）: SAS署名キーの定期ローテーション（Logic Apps → 「Regenerate access key」）、Response のオリジン固定、Logic App に過剰な権限を持たせない（RSS取得のみ）、実行履歴/アラートの確認
- 注意: GitHub Pages では HTTP レスポンスヘッダー（`frame-ancestors` 等）を設定できません。リポジトリは URL を含めないため公開でも問題ありませんが、署名URLを他人に共有しないでください。
