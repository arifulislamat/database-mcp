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

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  data BLOB
);

INSERT INTO files (id, data) VALUES (1, x'00ff10');

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  day DATE,
  at TIMESTAMP
);

INSERT INTO events (id, day, at) VALUES (1, '2024-01-02', '2024-01-02 03:04:05');
