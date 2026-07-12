CREATE TABLE users (
  id INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE
);

CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT NOT NULL,
  amount DOUBLE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
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

ANALYZE TABLE users, orders;
