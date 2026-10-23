# backend (Express + MySQL)

## セットアップ
```sql
CREATE DATABASE pikunikki CHARACTER SET utf8mb4;
CREATE USER 'pikunikki'@'localhost' IDENTIFIED BY 'change_me';
GRANT ALL ON pikunikki.* TO 'pikunikki'@'localhost';
```
```sh
cd backend
npm install
cp .env.example .env   # DB接続情報を編集
npm run db:init        # テーブル作成 + キャラ初期データ(旧スキーマのDBは email・user_code 列を自動追加。既存ユーザーのIDは user<番号>)
npm start              # http://localhost:3000
```

## データベースの初期化(全データを消して作り直す)
ユーザー・投稿・友達などをすべて消して、最初の状態に戻します。**元に戻せません。**

管理者権限(root など)でMySQLに入り、データベースを作り直します。
```sh
mysql -u root -p
```
```sql
DROP DATABASE pikunikki;
CREATE DATABASE pikunikki CHARACTER SET utf8mb4;
```
```sh
cd backend
npm run db:init        # テーブル作成 + キャラ初期データ
rm uploads/*           # 投稿した画像も消す場合
```
- `pikunikki` ユーザーの権限はデータベースを消しても残ります。接続できなくなったら、セットアップの `GRANT` をもう一度実行してください。
- セッションも消えるので、ブラウザは自動でログイン画面に戻ります。新規登録からやり直せます。
- GitHub Pages のデモモードのデータはブラウザの localStorage にあるため、この手順では消えません。

## API(認証は httpOnly Cookie `session`)
| メソッド | パス | 内容 |
|---|---|---|
| GET | /api/characters | キャラ一覧 |
| GET | /api/users/exists?email= | メール登録済みか(新規登録の重複チェック) |
| POST | /api/register | `{nickname,email,password,character}` 登録＋ログイン。ユーザーID(8文字の英数字)はサーバーが自動で発行し、レスポンスの `userId` で返す |
| POST | /api/login | `{email,password}` |
| POST | /api/logout | |
| GET | /api/me | 自分の情報＋投稿数(要ログイン) |
| GET | /api/posts | 自分の投稿一覧(要ログイン) |
| POST | /api/posts | multipart: `text`(必須), `photo`(任意, 5MBまで) |
| PUT | /api/me/character | `{character}` キャラ変更 |
| GET | /api/friends | 友達一覧 `[{id,username,userId,character}]` |
| GET | /api/users/search?userId= | IDで検索(完全一致・自分以外) |
| GET | /api/friend-requests | 自分宛ての未承認の友達申請 |
| POST | /api/friend-requests | `{receiverId}` 友達申請を送る |
| POST | /api/friend-requests/:id/accept | 申請を承認(友達になる) |
| POST | /api/friend-requests/:id/reject | 申請を拒否 |

`frontend/` を静的配信しているので、`http://localhost:3000/` で開けば同一オリジンでCookieが使えます。
