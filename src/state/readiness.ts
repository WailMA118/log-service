const state = {
  dbConnected: false,
  migrationsApplied: false,
};

export function setDbConnected(value: boolean): void {
  state.dbConnected = value;
}

export function setMigrationsApplied(value: boolean): void {
  state.migrationsApplied = value;
}

export function isReady(): boolean {
  return state.dbConnected && state.migrationsApplied;
}
