# Gestor de Proyectos del Equipo

Herramienta web interna para gestionar proyectos, recursos y horas del equipo. Stack: Node + Express + SQLite (better-sqlite3). Frontend vanilla JS, dark mode.

## Levantar con Docker Compose

```bash
cp .env.example .env
# Editá .env si querés cambiar PORT o agregar CLICKUP_TOKEN
docker compose up -d
```

App disponible en `http://localhost:3000` (o el PORT configurado).

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la app |
| `DB_PATH` | `/data/gestor.sqlite` | Ruta del archivo SQLite |
| `CLICKUP_TOKEN` | — | Token personal de ClickUp (`pk_xxx`) |
| `CLICKUP_TEAM_ID` | — | ID del workspace de ClickUp |
| `SYNC_INTERVAL_MIN` | `30` | Intervalo auto-sync en minutos (0 = desactivado) |

## Configurar token de ClickUp

Podés cargarlo de dos formas:

1. **Env del stack** (recomendado para Portainer): cargá `CLICKUP_TOKEN` y `CLICKUP_TEAM_ID` en las variables del stack.
2. **Desde la UI**: ir a Configuración → Integración ClickUp → guardar el token.

El token personal se obtiene en: ClickUp → Avatar → Settings → Apps → API Token.

## Sync con ClickUp

- **Manual**: Configuración → "Sync ahora" o `POST /api/sync/clickup`
- **Automático**: cada `SYNC_INTERVAL_MIN` minutos (configurable, 0 para desactivar)
- El sync es idempotente: correrlo N veces no duplica proyectos ni recursos (upsert por `clickup_id`)

## Dónde vive la DB y cómo respaldarla

La base de datos vive en el volumen Docker `gestor-proyectos-data`, mapeado a `/data/gestor.sqlite` dentro del container.

```bash
# Backup
docker run --rm -v gestor-proyectos-data:/data -v $(pwd):/backup alpine \
  cp /data/gestor.sqlite /backup/gestor-$(date +%Y%m%d).sqlite

# Ver dónde está en el host
docker volume inspect gestor-proyectos-data
```

## Despliegue en Portainer (stack Git)

1. Stacks → Add stack → Git repository
2. Repository URL: `https://github.com/calvopa/gestor-proyectos-equipo`
3. Compose path: `docker-compose.yml`
4. Variables de entorno del stack: `PORT=3100`, `CLICKUP_TOKEN=pk_...`, `CLICKUP_TEAM_ID=...`
5. Deploy

Para actualizar: `git push` al repo + "Pull and redeploy" en Portainer.

## Nginx reverse proxy (Nginx Proxy Manager)

Apuntá el proxy host al container en el puerto configurado (`3100` en srv-portainer).

```
Forward hostname: gestor (nombre del servicio en la red de Docker)
Forward port:     3100
```

O usá el bloque de Nginx directamente:

```nginx
server {
    listen 80;
    server_name proyectos.local;

    location / {
        proxy_pass http://localhost:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```
