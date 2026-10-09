INSERT INTO characters (id, emoji, name) VALUES
  ('cat', '🐱', 'ねこ'),
  ('dog', '🐶', 'いぬ'),
  ('rabbit', '🐰', 'うさぎ'),
  ('bear', '🐻', 'くま'),
  ('panda', '🐼', 'ぱんだ'),
  ('fox', '🦊', 'きつね')
ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), name = VALUES(name);
