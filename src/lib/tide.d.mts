/** tide.mjs 의 타입 선언. 로직은 .mjs 한 곳에만 둔다. */
export interface TideExtreme { type: 'High' | 'Low'; time: string; height: number }
/** App.tsx 의 TideInfo 와 같은 모양 — 화면 두 곳이 이 모양을 쓴다. 깨지 말 것. */
export interface TideInfo { dateStr: string; lunarStr: string; tides: TideExtreme[]; status: string }
export interface TideDoc {
  station: { code: string; name: string };
  days: Record<string, TideExtreme[]>;
  lastSuccess: number;
  source: string;
}
export const TIDE_STATION: { code: string; name: string; lat: number; lon: number };
export const TIDE_DAYS: number;
export const TIDE_SYNC_PERIOD_H: number;
export const TIDE_STALE_MS: number;
export const MIN_TIDES_PER_DAY: number;
export const KHOA_TIDE_API: string;
export const TIDE_DOC: { collection: string; id: string };
export function kstParts(ms: number): { y: number; m: number; d: number; hh: number; mm: number };
export function kstDateKey(ms: number): string;
export function kstYmd(ms: number): string;
export function addDays(dateKey: string, n: number): string;
export function normalizeServiceKey(key: string): string;
export function serviceKeyShape(key: string): string;
export function khoaTideUrl(serviceKey: string, dateYmd: string, code?: string): string;
export function parseKhoaHighLow(json: unknown, expectDate: string): { date: string; station: { name: string; lat: number; lon: number }; tides: TideExtreme[] };
export function buildTideDoc(days: { date: string; tides: TideExtreme[] }[], nowMs: number): TideDoc;
export function mulName(lunarDay: number): string;
export function newMoonMs(k: number): number;
export function lunarDay(ms: number): number;
export function tideInfoFrom(docData: Partial<TideDoc> | null | undefined, nowMs: number): TideInfo | null;
export function tideFreshness(docData: Partial<TideDoc> | null | undefined, nowMs: number): { text: string; stale: boolean } | null;
