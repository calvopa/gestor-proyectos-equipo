const { getDb } = require('./db');

function seed() {
  const db = getDb();
  const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
  if (projectCount > 0) return;

  console.log('[seed] inserting dummy data...');

  const insertProject = db.prepare(`
    INSERT INTO projects (nombre, descripcion, estado, prioridad, fecha_inicio, cuenta_horas)
    VALUES (?, ?, ?, ?, date('now'), ?)
  `);

  const insertResource = db.prepare(`
    INSERT OR IGNORE INTO resources (nombre, rol, email) VALUES (?, ?, ?)
  `);

  const insertAssignment = db.prepare(`
    INSERT OR IGNORE INTO assignments (project_id, resource_id, rol_en_proyecto, dedicacion_pct)
    VALUES (?, ?, ?, ?)
  `);

  db.transaction(() => {
    const p1 = insertProject.run('Website Corporativo', 'Rediseño del sitio web institucional', 'en_curso', 'alta', 1);
    const p2 = insertProject.run('App Mobile v2', 'Nueva versión de la app para clientes', 'backlog', 'media', 1);
    const p3 = insertProject.run('Migración Cloud', 'Migración de infra on-prem a AWS', 'pausado', 'critica', 0);

    const r1 = insertResource.run('Ana García', 'Frontend Developer', 'ana@example.com');
    const r2 = insertResource.run('Carlos López', 'Backend Developer', 'carlos@example.com');
    const r3 = insertResource.run('María Torres', 'Project Manager', 'maria@example.com');

    insertAssignment.run(p1.lastInsertRowid, r1.lastInsertRowid, 'Lead Frontend', 80);
    insertAssignment.run(p1.lastInsertRowid, r3.lastInsertRowid, 'PM', 30);
    insertAssignment.run(p2.lastInsertRowid, r2.lastInsertRowid, 'Lead Backend', 60);
    insertAssignment.run(p2.lastInsertRowid, r1.lastInsertRowid, 'Frontend', 40);
    insertAssignment.run(p3.lastInsertRowid, r2.lastInsertRowid, 'DevOps', 50);
    insertAssignment.run(p3.lastInsertRowid, r3.lastInsertRowid, 'PM', 20);

    // Una entrada manual de horas de ejemplo
    db.prepare(`
      INSERT INTO time_entries (project_id, resource_id, tipo, inicio, fin, duracion_seg, nota)
      VALUES (?, ?, 'manual', datetime('now','-2 hours'), datetime('now','-30 minutes'), 5400, 'Setup inicial del proyecto')
    `).run(p1.lastInsertRowid, r1.lastInsertRowid);
  })();

  console.log('[seed] done');
}

module.exports = { seed };
