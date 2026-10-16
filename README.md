# pikunikki

ピク日記のログイン画面に飛ぶ
https://pikunikki.github.io/pikunikki/frontend/login.html

pikunikki/
 ├── backend/        ← サーバー側（API）
 │    ├── db/
 │    │    ├── schema.sql   ← テーブルを作るSQL
 │    │    └── seed.sql     ← 初期データ
 │    ├── app.js            ← API本体（Node.jsの場合）
 │    └── config.js         ← DB接続設定
 ├── frontend/       ← HTML/CSS/JS
 │    ├── index.html
 │    ├── login.html
 │    └── post.html
 └── README.md

## 本物の登録・ログインを使う(ローカルで動かす)

GitHub Pages(上のURL)にはバックエンドが無いため、デモモード(ブラウザ内保存のみ)で動きます。
本物の登録・ログインはバックエンド(Express + MySQL)を自分のPCで起動し、`http://localhost:3000/` で開くと使えます。

### 初回セットアップ

**1. 必要なものを確認する**(Node.js 18以上 / MySQL 8 または MariaDB 10.5以上)

PowerShellかコマンドプロンプトで
```sh
node -v
npm -v
mysql --version
```
入っていなければ https://nodejs.org と https://dev.mysql.com/downloads/mysql/ からインストールする。

**2. DBとユーザーを作る**

ターミナルで以下を実行
```sh
mysql -u root -p
```

mysql> というプロンプトが出たらログイン成功
```sql
CREATE DATABASE pikunikki CHARACTER SET utf8mb4;
CREATE USER 'pikunikki'@'localhost' IDENTIFIED BY 'change_me';
GRANT ALL ON pikunikki.* TO 'pikunikki'@'localhost';
```
`change_me` は好きなパスワードに変えてよい(手順3の `.env` と合わせる)。`exit` で抜ける。

```sql
SHOW DATABASES;
```
一覧に pikunikki があれば OK です。終わったら exit で抜ける

**3. バックエンドを準備して起動する**
```sh
git pull
cd backend
npm install
cp .env.example .env   # Windows(PowerShell)は: copy .env.example .env
# .env の DB_PASSWORD を手順2のパスワードに書き換える
npm run db:init        # テーブル作成 + キャラ初期データ(古いDBは email 列を自動追加)
npm start              # http://localhost:3000 で起動(ターミナルは閉じない)
```

**4. ブラウザで開く**

`http://localhost:3000/login.html` を開き、新規登録 → キャラ選択 → ホームの表示 → ログアウト → 再ログイン、で動作確認できる。

注意: `github.io` / `file://` / `http://192.168...` などのIPアドレスで開くと、APIやパスワードのハッシュ化(`crypto.subtle`)が使えず登録・ログインに失敗する。

### 2回目以降

初回セットアップは不要。MySQLが起動している状態で次だけ行う。
```sh
cd backend
npm start
```
ブラウザで `http://localhost:3000/login.html` を開く。終了は `Ctrl + C`。

コードを更新(`git pull`)したときは、必要に応じて `npm install` と `npm run db:init` も実行する(何度実行しても安全)。

### うまくいかないとき

| エラー | 原因・対処 |
|---|---|
| `Access denied for user 'pikunikki'` | `.env` の `DB_PASSWORD` が手順2と違う |
| `Unknown database 'pikunikki'` | 手順2の `CREATE DATABASE` が未実行 |
| `ECONNREFUSED` | MySQLが起動していない(Windowsは `services.msc` で「MySQL80」を開始) |
| `EADDRINUSE` | ポート3000が使用中。`.env` の `PORT` を変え、開くURLも合わせる |
| 「登録に失敗しました」 | `npm start` のターミナルのエラーを確認。`github.io` で開いていないかも確認 |
