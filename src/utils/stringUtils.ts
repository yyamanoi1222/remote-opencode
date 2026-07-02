export function sanitizeModel(model: string): string {
  return model.trim().replace(/\r/g, '');
}

export function sanitizeAgent(agent: string): string {
  return agent.trim().replace(/\r/g, '').toLowerCase();
}
