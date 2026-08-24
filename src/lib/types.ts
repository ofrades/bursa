export type SharedAnalysisRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  reasoning?: string | null;
  thesisJson?: string | null;
  macroThesisJson?: string | null;
  name: string | null;
  perfDay?: number | null;
  perfWtd?: number | null;
  perfMtd?: number | null;
  peNtm?: number | null;
  revenueGrowthYoy?: number | null;
  isSaved?: boolean;
  isWatching?: boolean;
};
