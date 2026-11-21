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

## X検索

ヘッダーの「X検索」から別ページを開きます。検索用 Logic Apps の署名付き URL は、ヘッダー右上の「設定」から入力します（普段は非表示。URL未設定で検索すると自動で開きます）。RSS 用とは別にブラウザの localStorage に保存されます。

検索画面の入力項目と、Logic Apps に送るパラメータの対応は次のとおりです。パラメータ名は画面には表示しません。未指定の値は空文字として送ります。

| 画面の項目 | パラメータ | 内容 |
|---|---|---|
| 検索キーワード | `p` | 検索キーワード |
| 並べ替え | `md` | 人気順=`h`、新着順=空 |
| 取得件数 | `results` | 取得件数 |
| メディアタイプ | `mtype` | 画像のみ=`image`、動画のみ=`video`、指定なし=空 |
| 取得開始位置 | `start` | 1始まり、上限10000 |
| ツイートID | `oldestTweetId` | カーソルページネーション |
| この時刻以降 / 以前 | `since` / `until` | 日時（端末のタイムゾーン）を **Unix 秒**に変換して送信 |

`since` / `until` は Unix 秒（文字列）で送ります。Logic Apps 側が別の形式を期待する場合は [search.js](search.js) の `validateParameters` を調整してください。詳細パラメータは「詳細パラメータ」を開いて入力します。

検索用 Logic Apps は JSON の POST を受け取り、`timeline.entry`（または `body.timeline.entry`）に投稿の配列を含む JSON を Response で返してください。投稿の本文、名前、日時、件数、対応する画像を表示します。画像は Yahoo! の `rts-pctr.c.yimg.jp` と `pbs.twimg.com` の HTTPS URL のみ読み込み、閲覧時に画像配信先へ通信します。画像がない、または表示できない場合も本文は表示されます。

ブラウザから `Content-Type: application/json` で送るため、**OPTIONS プリフライトの CORS 対応が必要**です。公開サイトのオリジン（例: `https://nawate207.github.io`）に対し、OPTIONS と実際の POST の両方で `Access-Control-Allow-Origin` を返し、OPTIONS では `Access-Control-Allow-Methods` に `POST, OPTIONS`、`Access-Control-Allow-Headers` に `Content-Type` を許可してください。Logic Apps のトリガーが OPTIONS に対応できない構成では、CORS 対応のゲートウェイ等が必要です。Response だけに CORS ヘッダーを付けてもプリフライトは成功しません。実環境での設定・接続確認は別途必要です。

署名付き URL を知る人は Logic Apps を呼び出せます。localStorage は暗号化された秘密保管庫ではなく、共有端末や同一オリジンのスクリプトから読まれる可能性があります。URL を公開リポジトリに含めず、漏えい時にはキーをローテーションしてください。

## ブックマーク・保存した検索条件

- RSS 記事（各カード右上）と X ポストの ☆ を押すと、この端末のブラウザ（localStorage の `rss.bookmarks`）に保存されます。★ で解除できます。最大1000件です。
- 一覧は **X検索ページの「★ ブックマーク」タブ**（RSS ページ上部の「★ ブックマーク」からも開けます）。Xポストと RSS 記事を同じ一覧で表示します。
- 一覧では、キーワード、種類（Xポスト／RSS記事）、タグ、画像付きのみ（Xポスト）、メモありのみで絞り込み、保存が新しい順／投稿が新しい順で並べ替えできます。
- 各ブックマークに、メモ（最大1000文字）とタグ（最大10個、空白またはカンマ区切り）を付けられます。タグをタップするとそのタグで絞り込みます。メモ・タグ付きのブックマークを解除するときは確認が出ます。
- 保存するのは表示に必要な項目（本文、名前、日時、件数、投稿URL、画像URL など）のみです。画像本体は保存せず、元の配信先の URL を表示します（元の投稿が削除されると画像だけ表示できなくなることがあります）。
- X検索ページの「保存した検索条件」で、キーワードと詳細パラメータを名前付きで最大50件保存でき、「実行」でフォームに反映して検索します（`xsearch.saved`）。
- 保存データは端末のブラウザごとです。PC とスマホでは共有されず、ブラウザのデータ削除で消えます。読み込み時に URL・長さ・形式を検証し、許可しない URL（`javascript:` や許可外の画像ホストなど）は表示しません。

## セキュリティ対策

- CSP: スクリプト/スタイルは自己ドメインのみ、通信先は `https://*.logic.azure.com` のみ
- 外部データは `textContent` で描画（`innerHTML` 不使用）。リンクは http/https のみ許可、`rel="noopener noreferrer"`
- URLは https かつ `*.logic.azure.com` のみ受け付け、入力欄は伏せ字（password）
- Referrer 送信なし、`noindex`、Cookie/認証情報は送信しない、タイムアウト・サイズ上限あり
- 推奨（Azure側）: SAS署名キーの定期ローテーション（Logic Apps → 「Regenerate access key」）、Response のオリジン固定、Logic App に過剰な権限を持たせない（RSS取得のみ）、実行履歴/アラートの確認
- 注意: GitHub Pages では HTTP レスポンスヘッダー（`frame-ancestors` 等）を設定できません。リポジトリは URL を含めないため公開でも問題ありませんが、署名URLを他人に共有しないでください。
