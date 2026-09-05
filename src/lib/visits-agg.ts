/**
 * 접속 기록 → 날짜별 집계. **파이어스토어를 모른다** — 순수 계산만 한다.
 *
 * ★왜 파일을 갈랐나: 이 계산은 **조용히 틀리는** 종류다. 같은 사람을
 *  「홍길동 · 이름 미등록 1명」으로 두 번 세어도 에러가 아니라 그냥 숫자가 커진다.
 *  그래서 파이어스토어 없이 **실제 코드를 그대로 돌려** 검증할 수 있어야 한다
 *  (`node scripts/test-visits-agg.mjs`). yard-transform.mjs 와 같은 이유다.
 */

export interface DayStat {
  /** YYYY-MM-DD (KST) */
  day: string;
  /** 그날 접속한 **기기 수** */
  people: number;
  /** 그날 이름을 밝힌 사람들 (중복 없음, 가나다순) */
  names: string[];
  /** 그날 이름 없이 들어온 기기 수 */
  anon: number;
}

export interface VisitStats {
  days: DayStat[];          // 최근 → 과거
  today: DayStat;
  /** 기간 전체의 기기 수 */
  totalPeople: number;
  /** 상한에 닿아 과거가 잘렸는가. 잘렸으면 숫자를 믿으면 안 된다. */
  truncated: boolean;
}

/** 집계에 필요한 것만. 파이어스토어 문서에서 이 셋만 뽑아 넘긴다. */
export interface VisitRow {
  device: string;
  name: string;
  /** 이미 KST 로 환산된 YYYY-MM-DD */
  day: string;
}

/** 로컬(한국시간) 기준 YYYY-MM-DD. `toISOString` 은 UTC 라 아침에 어제가 나온다. */
export function kstDay(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * ★**기기 단위로 묶는 것이 핵심**이다.
 *  같은 기기가 하루에 두 줄을 남길 수 있다 — 앱이 뜨자마자 한 줄(이름 없음), 이름을 적으면
 *  또 한 줄(이름 있음). 규칙이 `update` 를 **오너에게도** 막아 뒀기 때문에 고칠 수가 없어
 *  한 줄 더 쓰는 것이다. 그걸 안 묶으면 한 사람이 두 번 세인다.
 *  ★같은 기기의 두 줄 중 **이름이 있는 쪽이 이긴다.**
 */
export function groupVisits(rows: VisitRow[], today: string, truncated = false): VisitStats {
  const byDay = new Map<string, Map<string, string>>();   // 날짜 → (기기 → 이름, 없으면 '')
  const allDevices = new Set<string>();

  for (const r of rows) {
    if (!r.device || !r.day) continue;
    const g = byDay.get(r.day) ?? new Map<string, string>();
    const nm = (r.name ?? '').trim();
    g.set(r.device, nm || (g.get(r.device) ?? ''));
    byDay.set(r.day, g);
    allDevices.add(r.device);
  }

  const days: DayStat[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))       // 최근이 위
    .map(([day, g]) => {
      const got = [...g.values()];
      return {
        day,
        people: g.size,
        names: [...new Set(got.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
        anon: got.filter(n => !n).length,
      };
    });

  return {
    days,
    today: days.find(d => d.day === today) ?? { day: today, people: 0, names: [], anon: 0 },
    totalPeople: allDevices.size,
    truncated,
  };
}
