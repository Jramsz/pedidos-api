# Pedidos · Node.js / Express + PostgreSQL

API RESTful de clientes y pedidos desarrollada en **Node.js 22 con Express**, con base de datos **PostgreSQL 16**, desplegada en el PaaS multi-tenant sobre Kubernetes (inquilino `tenant-beta`). Incluye una página web que consume la API.

**URL:** http://pedidos.paas.local

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/clientes` | Lista clientes con su número de pedidos |
| GET | `/api/clientes/:id` | Un cliente con sus pedidos |
| POST | `/api/clientes` | Crea un cliente (`nombre`, `email`, `ciudad`) |
| PUT | `/api/clientes/:id` | Modifica un cliente |
| DELETE | `/api/clientes/:id` | Borra un cliente y sus pedidos |
| GET | `/api/pedidos?estado=&limite=` | Lista pedidos con cliente y total |
| GET | `/api/pedidos/:id` | Un pedido |
| POST | `/api/pedidos` | Crea un pedido (`cliente_id`, `producto`, `cantidad`, `precio_unitario`) |
| PUT | `/api/pedidos/:id` | Modifica un pedido o su `estado` |
| DELETE | `/api/pedidos/:id` | Borra un pedido |
| GET | `/api/resumen` | Totales y pedidos por estado |
| GET | `/health` | Salud de la app y de su conexión a PostgreSQL |

Códigos de error: 400 (id o JSON inválido), 404 (no existe), 409 (email repetido), 422 (datos inválidos o cliente inexistente).

```bash
curl http://pedidos.paas.local/api/resumen
curl -X POST http://pedidos.paas.local/api/pedidos \
     -H "Content-Type: application/json" \
     -d '{"cliente_id":1,"producto":"Teclado","cantidad":2,"precio_unitario":54.5}'
```

## Estructura

```
src/server.js                     Rutas REST, validación y manejo de errores
src/db.js                         Conexión, esquema y datos iniciales
public/index.html                 Página que consume la API
Dockerfile                        Imagen node:22-alpine
paas/values.yaml                  Lo que el cliente entrega al PaaS
.github/workflows/desplegar.yml   Despliegue automático
```

## Variables de entorno

No hay credenciales en este repositorio.

| Variable | Origen |
|---|---|
| `NODE_ENV`, `PORT`, `DB_POOL_MAX` | `paas/values.yaml` → ConfigMap |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | Secret `bd-credenciales`, generado por la plataforma |

## Despliegue continuo

Cada `git push` a `main` ejecuta el workflow `Desplegar en el PaaS` en el runner de la plataforma: construye la imagen desde el `Dockerfile` (etiquetada con el commit), despliega con el CLI del PaaS y comprueba `GET /health`. Al arrancar, la API crea las tablas que falten.
