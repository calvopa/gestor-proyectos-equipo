-- Nuevos campos para sync basado en tasks de ClickUp
ALTER TABLE projects ADD COLUMN clickup_status TEXT;
ALTER TABLE projects ADD COLUMN last_comment_text TEXT;
ALTER TABLE projects ADD COLUMN last_comment_by TEXT;
ALTER TABLE projects ADD COLUMN last_comment_at DATETIME;

-- Limpiar imports incorrectos de listas (clickup_id = list_xxx o folder_xxx)
DELETE FROM projects WHERE clickup_id LIKE 'list_%' OR clickup_id LIKE 'folder_%';
