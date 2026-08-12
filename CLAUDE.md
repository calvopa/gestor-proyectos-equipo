# Gestor de Proyectos del Equipo — CLAUDE.md

## Stack y entorno

- **Runtime:** Node.js + Express + SQLite (better-sqlite3)
- **Frontend:** Vanilla JS, dark mode, sin frameworks
- **Puerto producción:** 3100 → `http://192.168.1.12:3100`
- **Servidor:** `/home/alteor/gestor-proyectos-equipo` en `192.168.1.12`
- **Repo:** `github.com/calvopa/gestor-proyectos-equipo` (rama `main`)
- **Directorio local (dev):** `/home/calvop/dev/gestor-proyectos-equipo`

## Deploy

```bash
git push origin main
ssh alteor@192.168.1.12 "cd /home/alteor/gestor-proyectos-equipo && git pull && docker compose up -d --build"
```

- **Volumen DB:** `gestor-proyectos-data` → `/data/gestor.sqlite`
- Verificar: `curl http://192.168.1.12:3100/health`

## Schema SQLite (producción)

```sql
projects:   id, nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin_est,
            clickup_id, cuenta_horas, created_at, updated_at,
            clickup_status, last_comment_text, last_comment_by, last_comment_at, ai_summary

resources:  id, nombre, rol, email, clickup_member_id, activo, telefono

assignments: id, project_id, resource_id, rol_en_proyecto, dedicacion_pct

time_entries: id, project_id, resource_id, tipo, inicio, fin, duracion_seg, nota, created_at

settings:   clave, valor (ClickUp token, team_id, etc.)
```

**Valores CHECK:**
- `projects.estado`: backlog | en_curso | pausado | cerrado
- `projects.prioridad`: baja | media | alta | critica
- `time_entries.tipo`: timer | manual

## Rutas API

| Ruta | Archivo |
|---|---|
| `/api/projects` | `src/routes/projects.js` |
| `/api/resources` | `src/routes/resources.js` |
| `/api/assignments` | `src/routes/assignments.js` |
| `/api/time` | `src/routes/time.js` |
| `/api/alerts` | `src/routes/alerts.js` |
| `/api/semana` | `src/routes/semana.js` |
| `/api/sync/clickup` | `src/routes/sync.js` |
| `/api/export` | `src/routes/export.js` |
| `/api/sofia/*` | `src/routes/sofia.js` |
| `/api/settings` | `src/routes/settings.js` |
| `/api/dashboard` | `src/routes/dashboard.js` |

## Sofia — Chat IA

- **Widget:** FAB ✦ esquina inferior derecha
- **Backend:** `src/routes/sofia.js`
- **LLM:** OpenClaw vía SSH → `alteor@192.168.1.38`, agente `gestor` (qwen2.5:14b, sin tools)
- **Comando OpenClaw:** `openclaw agent --agent gestor --session-key '<UUID>' --message '<prompt>' --json`
- **SSH key en container:** `/root/.ssh/id_gestor` (montada desde `/home/alteor/.ssh/id_gestor`)
- **Session key:** UUID efímero por llamada (evita context overflow de historial en disco)
- **Contexto auto:** snapshot de DB en cada turno vía `buildAutoContext()`
- **Límites:** MAX_PROMPT_CHARS: 4000 / contexto: 3000

**Rutas Sofia:**
- `POST /api/sofia/chat` — chat principal
- `DELETE /api/sofia/chat` — limpiar historial de sesión
- `GET /api/sofia/projects` — proyectos activos con estado/horas/comentarios
- `POST /api/sofia/parse-file` — parsear PDF adjunto
- `GET /api/sofia/status` — estado del servicio
- `POST /api/sofia/whatsapp-send` — envío real de WhatsApp

**WhatsApp desde Sofia:**
- Marcadores `[WA:NombrePersona:msg]` → resueltos a E.164 buscando en resources
- `normalizePhone(raw)` convierte números locales argentinos a E.164 (+549...)
- Frontend muestra burbuja verde con Enviar ✓ / Cancelar antes de enviar

## Compaction hints

Al compactar esta conversación, preservar siempre:
- Schema completo de `projects` y `resources` (incluidos los campos de migrations)
- Arquitectura de Sofia: agente `gestor`, session key UUID efímero, no historial propio
- Comando de deploy (git push + SSH pull + docker compose up --build)
- Puerto 3100, DB en volumen `gestor-proyectos-data`

## Bugs conocidos / lecciones aprendidas

1. `projects.riesgo` no existe en DB — no agregar a queries
2. Agente `main` de OpenClaw tiene tools registradas → ciertos verbos disparan tool calls sin respuesta → usar siempre agente `gestor`
3. Session key fija → OpenClaw carga historial de disco → context overflow → usar UUID efímero por llamada
4. Marcadores `===` en prompts → qwen2.5 los interpreta como tool response delimiters → usar texto plano
5. gemma2:9b (8192 tokens) → demasiado pequeño para el system prompt de OpenClaw → usar qwen2.5:14b
