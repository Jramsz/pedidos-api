const os = require('os');
const path = require('path');
const express = require('express');
const { pool, esperarBase, migrar } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ESTADOS = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];

app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const envolver = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function idValido(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validarCliente(b, parcial = false) {
  const errores = [];
  if (!parcial || b.nombre !== undefined) {
    if (typeof b.nombre !== 'string' || !b.nombre.trim() || b.nombre.length > 120) errores.push('nombre: texto de 1 a 120 caracteres');
  }
  if (!parcial || b.email !== undefined) {
    if (typeof b.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) errores.push('email: formato inválido');
  }
  if (b.ciudad !== undefined && b.ciudad !== null && (typeof b.ciudad !== 'string' || b.ciudad.length > 80)) errores.push('ciudad: hasta 80 caracteres');
  return errores;
}

function validarPedido(b, parcial = false) {
  const errores = [];
  if (!parcial || b.cliente_id !== undefined) {
    if (!idValido(b.cliente_id)) errores.push('cliente_id: entero positivo');
  }
  if (!parcial || b.producto !== undefined) {
    if (typeof b.producto !== 'string' || !b.producto.trim() || b.producto.length > 120) errores.push('producto: texto de 1 a 120 caracteres');
  }
  if (!parcial || b.cantidad !== undefined) {
    if (!Number.isInteger(b.cantidad) || b.cantidad < 1) errores.push('cantidad: entero mayor que 0');
  }
  if (!parcial || b.precio_unitario !== undefined) {
    if (typeof b.precio_unitario !== 'number' || b.precio_unitario < 0) errores.push('precio_unitario: número mayor o igual a 0');
  }
  if (b.estado !== undefined && !ESTADOS.includes(b.estado)) errores.push(`estado: uno de ${ESTADOS.join(', ')}`);
  return errores;
}

app.get('/health', envolver(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ estado: 'ok', pod: os.hostname() });
}));

app.get('/api', (req, res) => {
  res.json({
    servicio: 'pedidos-api',
    pod: os.hostname(),
    node: process.version,
    recursos: ['/api/clientes', '/api/pedidos', '/api/resumen'],
  });
});

app.get('/api/clientes', envolver(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.*, count(p.id)::int AS pedidos
    FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id
    GROUP BY c.id ORDER BY c.nombre`);
  res.json(rows);
}));

app.get('/api/clientes/:id', envolver(async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'cliente no encontrado' });
  const pedidos = await pool.query('SELECT * FROM pedidos WHERE cliente_id = $1 ORDER BY creado_en DESC', [id]);
  res.json({ ...rows[0], pedidos: pedidos.rows });
}));

app.post('/api/clientes', envolver(async (req, res) => {
  const errores = validarCliente(req.body);
  if (errores.length) return res.status(422).json({ errores });
  const { nombre, email, ciudad = null } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO clientes (nombre, email, ciudad) VALUES ($1, $2, $3) RETURNING *',
    [nombre.trim(), email.trim().toLowerCase(), ciudad],
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/clientes/:id', envolver(async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const errores = validarCliente(req.body, true);
  if (errores.length) return res.status(422).json({ errores });
  const { nombre, email, ciudad } = req.body;
  const { rows } = await pool.query(
    `UPDATE clientes SET
       nombre = COALESCE($2, nombre),
       email = COALESCE($3, email),
       ciudad = COALESCE($4, ciudad)
     WHERE id = $1 RETURNING *`,
    [id, nombre?.trim() ?? null, email?.trim().toLowerCase() ?? null, ciudad ?? null],
  );
  if (!rows.length) return res.status(404).json({ error: 'cliente no encontrado' });
  res.json(rows[0]);
}));

app.delete('/api/clientes/:id', envolver(async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { rowCount } = await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'cliente no encontrado' });
  res.status(204).end();
}));

app.get('/api/pedidos', envolver(async (req, res) => {
  const estado = req.query.estado;
  if (estado && !ESTADOS.includes(estado)) return res.status(400).json({ error: 'estado inválido' });
  const limite = Math.min(idValido(req.query.limite) || 50, 200);
  const params = [limite];
  let filtro = '';
  if (estado) {
    params.push(estado);
    filtro = 'WHERE p.estado = $2';
  }
  const { rows } = await pool.query(`
    SELECT p.*, c.nombre AS cliente, (p.cantidad * p.precio_unitario)::numeric(12,2) AS total
    FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
    ${filtro}
    ORDER BY p.creado_en DESC LIMIT $1`, params);
  res.json(rows);
}));

app.get('/api/pedidos/:id', envolver(async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { rows } = await pool.query(`
    SELECT p.*, c.nombre AS cliente, (p.cantidad * p.precio_unitario)::numeric(12,2) AS total
    FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'pedido no encontrado' });
  res.json(rows[0]);
}));

app.post('/api/pedidos', envolver(async (req, res) => {
  const errores = validarPedido(req.body);
  if (errores.length) return res.status(422).json({ errores });
  const { cliente_id, producto, cantidad, precio_unitario, estado = 'pendiente' } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO pedidos (cliente_id, producto, cantidad, precio_unitario, estado)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [cliente_id, producto.trim(), cantidad, precio_unitario, estado],
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/pedidos/:id', envolver(async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const errores = validarPedido(req.body, true);
  if (errores.length) return res.status(422).json({ errores });
  const { cliente_id, producto, cantidad, precio_unitario, estado } = req.body;
  const { rows } = await pool.query(
    `UPDATE pedidos SET
       cliente_id = COALESCE($2, cliente_id),
       producto = COALESCE($3, producto),
       cantidad = COALESCE($4, cantidad),
       precio_unitario = COALESCE($5, precio_unitario),
       estado = COALESCE($6, estado),
       actualizado_en = now()
     WHERE id = $1 RETURNING *`,
    [id, cliente_id ?? null, producto?.trim() ?? null, cantidad ?? null, precio_unitario ?? null, estado ?? null],
  );
  if (!rows.length) return res.status(404).json({ error: 'pedido no encontrado' });
  res.json(rows[0]);
}));

app.delete('/api/pedidos/:id', envolver(async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { rowCount } = await pool.query('DELETE FROM pedidos WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'pedido no encontrado' });
  res.status(204).end();
}));

app.get('/api/resumen', envolver(async (req, res) => {
  const [totales, porEstado] = await Promise.all([
    pool.query(`
      SELECT (SELECT count(*) FROM clientes)::int AS clientes,
             count(*)::int AS pedidos,
             COALESCE(sum(cantidad * precio_unitario), 0)::numeric(12,2) AS facturado
      FROM pedidos`),
    pool.query('SELECT estado, count(*)::int AS cantidad FROM pedidos GROUP BY estado ORDER BY estado'),
  ]);
  res.json({ ...totales.rows[0], por_estado: porEstado.rows, pod: os.hostname() });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'ruta no encontrada' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err.code === '23505') return res.status(409).json({ error: 'ya existe un registro con ese valor único' });
  if (err.code === '23503') return res.status(422).json({ error: 'el cliente indicado no existe' });
  console.error(err);
  res.status(500).json({ error: 'error interno' });
});

async function iniciar() {
  await esperarBase();
  await migrar();
  const servidor = app.listen(PORT, () => console.log(`pedidos-api escuchando en :${PORT} (pod ${os.hostname()})`));
  const cerrar = () => servidor.close(() => pool.end().finally(() => process.exit(0)));
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

iniciar().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
