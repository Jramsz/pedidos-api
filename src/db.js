const { Pool } = require('pg');

// La conexión sale de las variables que inyecta la plataforma (secreto bd-credenciales)
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
});

async function esperarBase(intentos = 30) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`Base de datos no disponible (${i}/${intentos}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('No se pudo conectar a PostgreSQL');
}

async function migrar() {
  // Varias réplicas pueden arrancar a la vez: un candado evita migrar dos veces
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock(4242)');
    await crearEsquema(cliente);
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(4242)').catch(() => {});
    cliente.release();
  }
}

async function crearEsquema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) NOT NULL UNIQUE,
      ciudad VARCHAR(80),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      producto VARCHAR(120) NOT NULL,
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario >= 0),
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','pagado','enviado','entregado','cancelado')),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pedidos_cliente_idx ON pedidos(cliente_id);
    CREATE INDEX IF NOT EXISTS pedidos_estado_idx ON pedidos(estado);
  `);

  const { rows } = await db.query('SELECT count(*)::int AS n FROM clientes');
  if (rows[0].n > 0) return;

  const clientes = [
    ['Ana López', 'ana.lopez@ejemplo.com', 'San Miguel'],
    ['Carlos Pérez', 'carlos.perez@ejemplo.com', 'San Salvador'],
    ['María Hernández', 'maria.hernandez@ejemplo.com', 'Santa Ana'],
    ['José Martínez', 'jose.martinez@ejemplo.com', 'Usulután'],
  ];
  for (const c of clientes) {
    await db.query('INSERT INTO clientes (nombre, email, ciudad) VALUES ($1, $2, $3)', c);
  }
  const pedidos = [
    [1, 'Monitor 24 pulgadas', 1, 159.9, 'pagado'],
    [1, 'Mouse inalámbrico', 2, 19.99, 'enviado'],
    [2, 'Silla ergonómica', 1, 210, 'pendiente'],
    [3, 'Cafetera de goteo', 1, 39.9, 'entregado'],
    [4, 'Taladro percutor', 1, 89.99, 'pendiente'],
  ];
  for (const p of pedidos) {
    await db.query(
      'INSERT INTO pedidos (cliente_id, producto, cantidad, precio_unitario, estado) VALUES ($1, $2, $3, $4, $5)',
      p,
    );
  }
}

module.exports = { pool, esperarBase, migrar };
