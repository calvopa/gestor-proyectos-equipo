# Gestor de Proyectos GCS

Herramienta web interna para gestionar proyectos, recursos y horas del equipo técnico de GrupoCESA. Stack: Node.js + Express + SQLite (better-sqlite3). Frontend vanilla JS con 3 temas visuales.

## Levantar con Docker Compose

```bash
cp .env.example .env
# Editá .env con PORT, CLICKUP_TOKEN, GROQ_API_KEY
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
| `GROQ_API_KEY` | — | API key de Groq para resúmenes IA (`gsk_xxx`) |

## Configurar token de ClickUp

1. **Env del stack** (recomendado para Portainer): cargá `CLICKUP_TOKEN` y `CLICKUP_TEAM_ID` en las variables del stack.
2. **Desde la UI**: Configuración → Integración ClickUp → guardar el token.

Token personal: ClickUp → Avatar → Settings → Apps → API Token.

## Resúmenes con IA

La app integra **Groq** (`llama-3.1-8b-instant`) para generar resúmenes de 3 líneas por proyecto:

- **Vista Proyectos**: botón ✨ en cada fila → genera y guarda resumen en `projects.ai_summary`
- **Vista Semana**: botón ✨ por card → guarda en `weekly_snapshots.ai_summary`
- **Modo presentación**: botón ✨ disponible dentro del overlay de presentación
- El resumen persiste hasta que se regenera manualmente

Requiere `GROQ_API_KEY` en el `.env` del servidor.

## Temas visuales

El nav incluye un selector de tema persistido en `localStorage`:

| Tema | Descripción |
|---|---|
| 🌙 Dark | Dark mode (default) con sidebar oscuro |
| ☀ Flat | Diseño plano, fondo claro, sidebar azul |
| ◉ Neu | Neumorphism, sombras suaves extruidas/hundidas |

## Sync con ClickUp

- **Manual**: Configuración → "Sync ahora" o `POST /api/sync/clickup`
- **Automático**: cada `SYNC_INTERVAL_MIN` minutos
- Idempotente: upsert por `clickup_id`

## Exportar a Google Sheets

Requiere configurar el webhook URL en Configuración → Sheets webhook URL.

Los exports incluyen:
- **Vista Semana**: fase, salud, eventos, movimiento, horas estimadas, Resumen IA
- **Vista Proyectos**: estado, prioridad, técnicos, Horas reg., Horas est., Resumen IA

Ver documentación completa en `apps-script/webhook.gs`.

## Dónde vive la DB

La base de datos vive en el volumen Docker `gestor-proyectos-data`, mapeado a `/data/gestor.sqlite`.

```bash
# Backup
docker run --rm -v gestor-proyectos-data:/data -v $(pwd):/backup alpine \
  cp /data/gestor.sqlite /backup/gestor-$(date +%Y%m%d).sqlite
```

## Despliegue en Portainer (stack Git)

1. Stacks → Add stack → Git repository
2. Repository URL: `https://github.com/calvopa/gestor-proyectos-equipo`
3. Compose path: `docker-compose.yml`
4. Variables: `PORT=3100`, `CLICKUP_TOKEN=pk_...`, `CLICKUP_TEAM_ID=...`, `GROQ_API_KEY=gsk_...`
5. Deploy

Para actualizar: `git push` al repo + `git pull && docker compose up -d --build` en el servidor.

## Nginx reverse proxy

```
Forward hostname: gestor
Forward port:     3100
```
