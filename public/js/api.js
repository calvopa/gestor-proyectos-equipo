const api = {
  async _fetch(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // Projects
  getProjects: (q = {}) => api._fetch('/api/projects?' + new URLSearchParams(q)),
  getProject: (id) => api._fetch(`/api/projects/${id}`),
  createProject: (body) => api._fetch('/api/projects', { method: 'POST', body }),
  updateProject: (id, body) => api._fetch(`/api/projects/${id}`, { method: 'PUT', body }),
  deleteProject: (id) => api._fetch(`/api/projects/${id}`, { method: 'DELETE' }),

  // Resources
  getResources: (q = {}) => api._fetch('/api/resources?' + new URLSearchParams(q)),
  getResource: (id) => api._fetch(`/api/resources/${id}`),
  createResource: (body) => api._fetch('/api/resources', { method: 'POST', body }),
  updateResource: (id, body) => api._fetch(`/api/resources/${id}`, { method: 'PUT', body }),
  deleteResource: (id) => api._fetch(`/api/resources/${id}`, { method: 'DELETE' }),
  getCarga: () => api._fetch('/api/resources/report/carga'),

  // Assignments
  getAssignments: (pid) => api._fetch(`/api/projects/${pid}/assignments`),
  createAssignment: (pid, body) => api._fetch(`/api/projects/${pid}/assignments`, { method: 'POST', body }),
  updateAssignment: (pid, id, body) => api._fetch(`/api/projects/${pid}/assignments/${id}`, { method: 'PUT', body }),
  deleteAssignment: (pid, id) => api._fetch(`/api/projects/${pid}/assignments/${id}`, { method: 'DELETE' }),

  // Time
  getTime: (q = {}) => api._fetch('/api/time?' + new URLSearchParams(q)),
  startTimer: (body) => api._fetch('/api/time/start', { method: 'POST', body }),
  stopTimer: (body) => api._fetch('/api/time/stop', { method: 'POST', body }),
  addManual: (body) => api._fetch('/api/time/manual', { method: 'POST', body }),
  deleteEntry: (id) => api._fetch(`/api/time/${id}`, { method: 'DELETE' }),
  getTotals: () => api._fetch('/api/time/totals'),

  // Alerts
  getAlerts: () => api._fetch('/api/alerts'),

  // Sync
  syncClickUp: () => api._fetch('/api/sync/clickup', { method: 'POST' }),
  getSyncStatus: () => api._fetch('/api/sync/status'),

  // Settings
  getSettings: () => api._fetch('/api/settings'),
  saveSettings: (body) => api._fetch('/api/settings', { method: 'PUT', body }),
};
