import type { MetricCaliber } from './metric-profile.seed';

export type { MetricCaliber };

export interface MetricProfileView {
  id: string;
  key: string | null;
  name: string;
  summary: string;
  category: string;
  calibers: MetricCaliber[];
  brief: string;
  reportOutline: string | null;
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
  updatedAt: Date;
}

/** 注入 prompt 所需的最小字段。 */
export interface MetricProfileForPrompt {
  name: string;
  calibers: MetricCaliber[];
  brief: string;
  reportOutline: string | null;
}

export class UpsertMetricProfileDto {
  name?: string;
  summary?: string;
  category?: string;
  calibers?: MetricCaliber[];
  brief?: string;
  reportOutline?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}
