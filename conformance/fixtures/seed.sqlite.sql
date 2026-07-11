CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  amount REAL NOT NULL
);

CREATE INDEX idx_orders_user_id ON orders (user_id);

INSERT INTO users (id, name, email) VALUES
  (1, 'Tavian', 'tavian@example.com'),
  (2, 'Arman', 'arman@example.com'),
  (3, 'Rahim', 'rahim@example.com'),
  (4, 'Korim', 'korim@example.com'),
  (5, 'Shams', 'shams@example.com');

INSERT INTO orders (id, user_id, amount) VALUES
  (1, 1, 19.99),
  (2, 1, 5.00),
  (3, 3, 42.50);
