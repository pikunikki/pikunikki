-- MySQL 8 / MariaDB 10.5+
CREATE TABLE IF NOT EXISTS characters (
  id    VARCHAR(20) PRIMARY KEY,
  emoji VARCHAR(10) NOT NULL,
  name  VARCHAR(50) NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL,           -- ニックネーム(表示名)
  email         VARCHAR(255) NOT NULL UNIQUE,    -- ログインID
  password_hash VARCHAR(100) NOT NULL,
  character_id  VARCHAR(20)  NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64) PRIMARY KEY,
  user_id    INT NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  text       TEXT NOT NULL,
  photo_path VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_posts_user_created (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friend_requests (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sender_id   INT NOT NULL,
  receiver_id INT NOT NULL,
  status      ENUM('pending', 'accepted', 'rejected')
              NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_friend_request (sender_id, receiver_id),
  INDEX idx_friend_requests_receiver (receiver_id, status),

  FOREIGN KEY (sender_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (receiver_id)
    REFERENCES users(id)
    ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS friendships (
  user_id   INT NOT NULL,
  friend_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id, friend_id),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (friend_id)
    REFERENCES users(id)
    ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS shared_posts (
  post_id     INT NOT NULL,
  sender_id   INT NOT NULL,
  receiver_id INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (post_id, receiver_id),

  INDEX idx_shared_posts_receiver (receiver_id, created_at),
  INDEX idx_shared_posts_sender (sender_id, created_at),

  FOREIGN KEY (post_id)
    REFERENCES posts(id)
    ON DELETE CASCADE,

  FOREIGN KEY (sender_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (receiver_id)
    REFERENCES users(id)
    ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;