/** safetyone-match.mjs 의 타입 선언. 로직은 .mjs 한 곳에만 둔다. */
export interface SyncRow { hull: string; loc: string }
export interface Slot { x: number; y: number; r: number }
export interface PlanItem { hull: string; loc: string; berth: string; to: Slot; from: { x: number; y: number } | null }
export interface SyncPlan {
  moves: PlanItem[]; creates: PlanItem[];
  skips: SyncRow[]; sea: SyncRow[]; unknown: SyncRow[]; untouched: string[];
}
export const BERTH_SLOTS: Record<string, Slot[]>;
export const BERTH_LABEL: Record<string, string>;
export function berthFromLoc(loc: string): string | null;
export function isSeaLoc(loc: string): boolean;
export function parseListText(text: string): { rows: SyncRow[]; unknownLines: string[] };
export function berthOfPos(pos: { x: number; y: number }): string | null;
export function planMoves(rows: SyncRow[], live: Map<string, unknown>): SyncPlan;
/** 지도에 그리지 않을 배 — 수집이 한 번은 본 배인데 마지막 명단에 없다. 명단이 없으면 빈 집합. */
export function absentHulls(ships: Map<string, unknown> | Record<string, unknown>, present: string[] | null | undefined): Set<string>;
