// Static routes (no dynamic segments) so the app can be exported as plain files for the desktop
// app, offline PWA and any static host. The active workspace lives in local state, not the URL.

export const routes = {
  home: "/",
  welcome: "/welcome",
  page: (id: string) => `/page?id=${encodeURIComponent(id)}`,
  record: (pageId: string, recordId: string) => `/page?id=${encodeURIComponent(pageId)}&record=${encodeURIComponent(recordId)}`,
  notes: "/notes",
  projects: "/projects",
  newProject: "/projects?new=1",
  project: (id: string) => `/project?id=${encodeURIComponent(id)}`,
  tasks: "/tasks",
  task: (id: string) => `/tasks?task=${encodeURIComponent(id)}`,
  databases: "/databases",
  graph: "/graph",
  calendar: "/calendar",
  mail: (opts?: { compose?: boolean }) => (opts?.compose ? "/mail?compose=1" : "/mail"),
  chat: (id?: string) => (id ? `/chat?id=${encodeURIComponent(id)}` : "/chat"),
  settings: (tab?: string) => (tab ? `/settings?tab=${tab}` : "/settings"),
  /** Settings → AI, optionally on one of its tabs (providers, local, mcp, plugins, skills, agents, usage). */
  aiSettings: (section?: string) => (section ? `/settings?tab=ai&ai=${section}` : "/settings?tab=ai"),
};
