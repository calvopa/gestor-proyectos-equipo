-- Indexes para queries frecuentes en filtros y joins
CREATE INDEX IF NOT EXISTS idx_projects_estado   ON projects(estado);
CREATE INDEX IF NOT EXISTS idx_resources_activo  ON resources(activo);
CREATE INDEX IF NOT EXISTS idx_wa_week_start     ON weekly_activity(week_start);
