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
npm run db:init        # テーブル作成 + キャラ初期データ
npm start              # http://localhost:3000
```

## API(認証は httpOnly Cookie `session`)
| メソッド | パス | 内容 |
|---|---|---|
| GET | /api/characters | キャラ一覧 |
| GET | /api/users/exists?email= | メール登録済みか(新規登録の重複チェック) |
| POST | /api/register | `{nickname,email,password,character}` 登録＋ログイン |
| POST | /api/login | `{email,password}` |
| POST | /api/logout | |
| GET | /api/me | 自分の情報＋投稿数(要ログイン) |
| GET | /api/posts | 自分の投稿一覧(要ログイン) |
| POST | /api/posts | multipart: `text`(必須), `photo`(任意, 5MBまで) |

`frontend/` を静的配信しているので、`http://localhost:3000/` で開けば同一オリジンでCookieが使えます。
