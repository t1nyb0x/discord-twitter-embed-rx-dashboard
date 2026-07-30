---
name: issue-to-merge
description: Drive a GitHub issue from intake to a green, reviewed PR in this repo (rx-twitter/rx-twitter-dashboard). Clarify with Q&A before coding, file cross-linked companion issues on the bot repo, implement TDD following existing Astro/Preact/Drizzle patterns, pass the quality gates, keep drizzle migrations committed, triage review feedback honestly, keep CI green, and verify by actually running the app.
---

# issue-to-merge

このリポジトリ（`rx-twitter/rx-twitter-dashboard`。Bot 本体は別リポ `rx-twitter/rx-twitter`）で、
機能追加・改修を「起票 → 設計 Q&A → TDD 実装 → 品質ゲート → レビュー対応 → CI 緑 → 動作確認」まで
一貫して進めるための手引き。

## When to Use

- Issue を立てたい／既存 Issue の実装に着手する
- レビュー指摘に対応する（PR コメント / review）
- Bot と Dashboard の両方に跨る機能（Redis のキー設計・`@rx-twitter/shared` の型を共有するもの）
- 「まず質疑応答してから作って」と頼まれたとき

---

## 貫く原則

- **確かめてから動く**: 推測で実装・起票しない。まず該当コードを読む。分からない設計判断は Q&A で潰す。
- **正直なトリアージ**: レビュー指摘を全部鵜呑みにしない。「直す / スコープ外 / 別issue化 / 反論」を根拠付きで。
- **スコープを割る**: 既存バグ・別関心事は本流に混ぜず別 Issue に切り出す。
- **秘密は相手が扱う**: Discord トークン・`NODE_AUTH_TOKEN`・`SESSION_SECRET` などは自分で持たない。credentialed な実行はユーザーに `! <cmd>` で依頼。
- **default ブランチを汚さない**: `develop` 直ではなく feature ブランチを切る。コミット/PR はユーザーが望んだときだけ。
- **`main` は release-please のもの**: 手で `main` に PR を出さない。`develop` に積み、リリース PR は release-please が作る。

---

## Phase 1 — Intake & 設計 Q&A（コード前）

1. **現状把握**: 触る周辺を読む。似た実装を1つ「テンプレート」として特定する。
   - API を足すなら `src/pages/api/guilds/[guildId]/config.ts` とその `tests/unit/api/guild-config.test.ts` を雛形にする。
   - 横断的な処理（認可・ヘッダ・セッション）は `src/middleware.ts` に集約されている。ページ側で再実装しない。
   - 設定の読み書きは Redis キャッシュ（`app:guild:{guildId}:config`）と SQLite の write-through。片方だけ更新する実装をしない。
2. **理解を共有**: 見つけた構造・制約を短くまとめてユーザーに提示する（「私の理解」）。
3. **Q&A で設計を確定**: `AskUserQuestion` で分岐を潰す。各設問の先頭に自分の推しを置く。
   - ユーザーが「まず確認したい」と返したら、質問を組み直してから再提示する。
   - 決定は表にして復唱する。

## Phase 2 — Issue 起票

- **cross-repo は companion issue**: Bot 側（`rx-twitter/rx-twitter`）と Dashboard 側で別々に立てて相互リンク（`owner/repo#N`）。
  - `gh issue create --repo rx-twitter/rx-twitter-dashboard --title ... --label enhancement --body-file <f>`
  - 先に親を作って番号を得て、子に参照を入れ、親にも子番号を追記する。
  - Redis のキー・ペイロード形式が絡む変更は、**どちらが正か**を Issue 本文で明示する（Bot 側が producer、Dashboard 側が consumer など）。
- 既存 Issue のスレッドに未回答の質問があれば、決定事項をコメントで**回答**する。
- 本文は「背景/目的・現状・決定事項(表)・技術メモ/制約・スコープ(チェックリスト)・非スコープ・関連」で構成。

## Phase 3 — TDD 実装

- feature ブランチを切る: `git checkout -b feat/<issue>-<slug>`（既存の慣習は `feat/` `fix/` `refactor/` + issue番号）。
- **テスト先行**（t-wada スタイル）。テストは `tests/unit/` に src と同じ構造で（`lib/` と `api/`）。
  - User/Session のモックは `tests/helpers.ts` を使う。手で作り直さない。
  - Redis / SQLite は必ずモック。テスト用の環境変数は `vitest.config.ts` の `test.env` で与えられているので、テスト内で秘密を書かない。
- 既存パターンを踏襲する:
  - レスポンスは `{ success, data?, error? }` エンベロープ。`src/lib/api-helpers.ts` のビルダー経由で返す。
  - ログは `createLogger("ModuleName")`（`src/lib/logger.ts`）。`console.*` を使わない。
  - 型は strict。`App.Locals` の追加は `src/env.d.ts` に。
- **スキーマを変えたら migration をコミットする**: `src/lib/db/schema.ts` を触ると pre-commit（`.githooks/pre-commit`）が `npm run db:generate` を走らせて `drizzle/` を stage する。CI の build ジョブは `db:generate` 後に `git diff --exit-code -- drizzle/` を見るので、生成物の取りこぼしはそこで落ちる。
- **`@rx-twitter/shared` は published dependency**: このリポでビルドできない。共有型を変える必要が出たら Bot 側リポで直して publish → ここで `package.json` のバージョンを上げる、という順序になる。`npm ci` には GitHub Packages 認証（`NODE_AUTH_TOKEN`）が必要なので、認証が絡む実行はユーザーに依頼する。
- 実装したら随時、下の品質ゲートを回す。

### 品質ゲート（コミット前に必ず）

```bash
npm run lint          # oxlint src/        — 警告/エラー ゼロ
npm run format:check  # oxfmt --check .    — 差分ゼロ（崩れていたら npm run format）
npm run test          # vitest run（全ユニット）
npm run build         # astro check（型チェック）+ production build
```

- カバレッジを確認するときは `npm run test:coverage`（v8）。CI の test ジョブはこちらを回す。目標は 80% 以上。
- 単一ファイルだけ回すなら `npx vitest run tests/unit/lib/auth.test.ts`。

## Phase 4 — コミット

- **Conventional Commits**（`feat` `fix` `refactor` `docs` `test` `ci` `chore` …）、scope 可。焦点を絞って分割（feat / docs / test / ci を別コミットに）。
  - release-please がこのメッセージから CHANGELOG とバージョンを作る。`feat` / `fix` の使い分けを雑にしない。
- 末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- コードとコメントに絵文字を入れない。
- push・PR はユーザーの指示があってから。**PR base は `develop`**（CI は `main` / `develop` 向け PR で走る）。

## Phase 5 — レビュー対応

- 指摘ごとに**トリアージ表**を出す: `#`, 指摘, 判断（直す/スコープ外/既存の別問題/反論）, 根拠。
- **直す**: 明確に正しい correctness / 安全（認証・CSRF・暗号・レート制限）の指摘。
- **別issue化**: 既存コードの問題・別関心事（例: 既存の fallback 既定、リスナーリーク、CI 穴）は本流に混ぜず新 Issue に。
- **設計フォークは相談**: 実装形やアーキが大きく変わる判断は `AskUserQuestion` でユーザーに委ねてから着手（手戻り防止）。
- **反論も辞さない**: 過剰・的外れな指摘には根拠を添えて別案を出す。頭ごなしに従わない。
- 対応後: ADR / PR 本文を現行設計に更新し、PR にトリアージ表で**返信コメント**。

## Phase 6 — ADR（重要な設計判断）

- アーキ選択や、レビューで方針転換した場合は `docs/adr/NNNN-<slug>.md` に残す（このリポにはまだ `docs/adr/` が無いので、最初のものは `0001-` から始める）。
- Status / Date / Issue、Context / Decision / Consequences(Positive/Negative/Mitigation) を書く。
- 前提（例: 単一インスタンス、Redis はキャッシュであって source of truth ではない）とトレードオフを明記する。
- Bot 側と共有する設計なら、Bot リポの ADR と相互リンクする。

## Phase 7 — CI を緑にする

```bash
git push
gh run watch <run-id> --repo rx-twitter/rx-twitter-dashboard --exit-status
gh pr checks <pr> --repo rx-twitter/rx-twitter-dashboard
```

CI は `setup → lint → test → build` の直列。前が落ちると後ろは走らないので、ローカルでも同じ順で潰す。

よくある落とし穴と対処:

- **`drizzle/` の差分未コミット**: build ジョブが `db:generate` 後の diff で落ちる。→ ローカルで `npm run db:generate` して `drizzle/` をコミットする。
- **`node_modules` キャッシュが古い**: キャッシュキーは `package-lock.json` のハッシュ。lock を更新したら別キャッシュになるので、`npm ci` が走る前提で（`NODE_AUTH_TOKEN` が要る）。lock を手で書き換えない。
- **`astro check` だけが落ちる**: `npm run test` は通るが build で型エラー。`.astro` ファイルや `env.d.ts` の型は vitest では見ていない。コミット前に `npm run build` まで回す。
- **format:check だけ赤**: oxfmt はリポ全体（`.`）が対象。src 以外（md / json / config）の整形漏れも落ちる。

## Phase 8 — 動作確認（テストで終わらない）

- 実際に起動して挙動を見る。`npm run dev`（port 4321）。アプリの秘密は `.env.app`（Docker Compose 用の `.env` とは別）。
- **秘密はユーザーが扱う**: Discord OAuth の実ログインを伴う確認は、手順を渡してユーザーに `!` で実行してもらう。`.env.app` の中身を読み上げない・ログに残さない。
- Compose での確認は外部ネットワーク前提: `twitterrx_network` に Bot と Redis（`TwitterRX_Redis`）が既にいること。Redis はポート非公開なので、ホストから `redis-cli` は届かない → **コンテナ内で実行**する:
  ```bash
  docker exec TwitterRX_Redis redis-cli GET "app:guild:<guildId>:config"
  ```
- 確認したいのが「起動時の同期」なら、Redis を空にしてから起動して reseed（`src/lib/reseed.ts`）が効くかを見る。バックグラウンドジョブ（reconciliation 10分 / audit cleanup 2AM / heartbeat 2分）は `src/startup.ts`。
- 外向き・不可逆・全体に影響する操作（本番 Redis の削除、全ギルド設定の書き換え等）は、**影響範囲を警告してから**。テスト用ギルド限定を促す。

---

## Anti-patterns

- コードを読まずに Q&A や実装に入る。
- レビュー指摘を機械的に全部実装する（過剰実装・的外れ対応）。
- 既存バグを本流 PR に混ぜてスコープを膨らませる。
- `schema.ts` を変えて `drizzle/` の生成物をコミットしない。
- Redis と SQLite の片方だけ更新する（キャッシュと永続の乖離）。
- 認可チェックを個別ページに書く（`middleware.ts` に集約する）。
- `main` に直接 PR を出す / release-please のリリース PR を手で作る。
- `npm run test` だけ通して `npm run build`（astro check）を飛ばす。
- CI を見ずに「たぶん緑」で放置する。
- ユーザーのトークンを自分で使う／credentialed な実行を勝手に走らせる。
