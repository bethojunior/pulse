export interface PulseProjectInspection {
  nest: boolean;
  reason?: string;
  manifest?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  sourceRoot?: string;
}

export interface PulseScaffoldResult extends PulseProjectInspection {
  pulseDir?: string;
  created: string[];
  preserved: string[];
}

export function inspectProject(targetRoot: string): PulseProjectInspection;
export function scaffoldPulse(targetRoot: string, options?: { password?: string }): PulseScaffoldResult;
export function run(argv?: string[], env?: NodeJS.ProcessEnv): void;
