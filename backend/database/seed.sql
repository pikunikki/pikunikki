INSERT INTO characters (id, emoji, name) VALUES
  ('pink', '🎀', 'ピンク'),
  ('orange', '🍊', 'オレンジ'),
  ('purple', '🔮', 'パープル'),
  ('blue', '💎', 'ブルー')
ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), name = VALUES(name);
