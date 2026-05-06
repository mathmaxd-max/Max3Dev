/** Shared project password gate (client-side deterrent). */

export const PROJECT_GATE_STORAGE_KEY = 'max3dev_project_access';

export function getExpectedProjectGateHash(): string {
  return import.meta.env.PUBLIC_PROJECT_ACCESS_SHA256?.trim() ?? '';
}

export function isProjectGateActive(): boolean {
  return Boolean(getExpectedProjectGateHash());
}
