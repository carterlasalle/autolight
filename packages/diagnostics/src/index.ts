export interface LogRow { ts: string; monoNs: bigint; module: string; severity: "debug"|"info"|"warn"|"error"; deck?: number; event?: string }
export function log(module: string, severity: LogRow["severity"], event: string): LogRow {
  return { ts: new Date().toISOString(), monoNs: process.hrtime.bigint(), module, severity, event };
}
