/**
 * 지도 위 날씨 효과 — **B 창에 맺힌 날씨** (2026-09-06 사용자가 고른 방향).
 *
 * 폰 화면이 창문이다. 비는 유리에 맺혀 흘러내리고, 눈은 붙었다가 녹아 물방울이 되어
 * 흘러내리고, 화면 아래 창틀에 쌓인다. 시안 넷(창밖 / 창에 맺힘 / 앰비언트 / 번호 보호)
 * 중 이것을 골랐다.
 *
 * ★**트레이드오프를 알고 고른 것이다**: 물방울이 호선번호 위에 앉을 수 있다.
 *  D 안(다 그린 뒤 마커 둘레를 `destination-out` 으로 뚫기)이 그걸 없애지만
 *  사용자가 B 를 골랐다. 나중에 거슬리면 그 한 겹만 더하면 된다.
 *
 * ─ 이 파일이 지키는 것 (전부 실측으로 얻은 것이다. 지우지 말 것) ────────────────
 * ★**GPU 힌트를 한 줄도 넣지 않는다** — `will-change`·`translate3d`·`backface-visibility`.
 *  이 계열 앱에서 그것 때문에 6커밋을 날렸다. 남의 눈 라이브러리에는 그게 박혀 있어
 *  (Snowstorm `useGPU`, hdcodedev 의 `willChange`) 코드를 그대로 옮기면 같이 딸려온다.
 * ★**발열의 가장 큰 변수는 알갱이 수가 아니라 캔버스 픽셀 수다**(실측: 배율 1→3 이
 *  알갱이 0개에서도 +10.5%p, 알갱이 0→300 은 배율 1 에서 +3.1%p). 그래서 1.5 로 자른다.
 *  이 층에는 글자가 없다 — 호선번호는 아래 SVG 가 그리므로 흐려져도 잃는 게 없다.
 * ★**`<canvas>` 는 대체 요소다.** `inset:0` 만으로는 안 늘어난다(고유 크기 300x150 이
 *  이기고 right/bottom 이 무시된다). width/height 를 **명시**해야 한다.
 * ★**밝은 지도 위에서 흰 것은 안 보인다.** 흰 눈송이·흰 하이라이트가 통째로 묻힌다 —
 *  테두리를 청회색으로 두르고, 물방울은 「아래로 빛이 몰리는」 대비로 읽히게 한다.
 * ★**굴절은 없다.** 굴절 기법 셋이 전부 배경의 래스터 스냅샷을 전제하는데 우리 배경은
 *  팬·줌·회전하는 라이브 SVG 다. 배경 블러(`backdrop-filter`)도 금지 — 흐리면 번호를 못 읽는다.
 */
import { useEffect, useRef } from 'react';
import type { Wx } from '../lib/weather';

interface Props {
  /** 없으면 아무것도 그리지 않는다 (맑음·구름·안개). */
  wx: Wx | null;
  /** 화면에서 가로로 미는 양(-1~1). `weather.ts` 의 `windPushX()`. */
  pushX: number;
  /** 효과를 덮을 영역 — 지도 뷰포트. 버튼·칩·카드 위에는 안 그린다. */
  viewport: HTMLElement | null;
}

interface Drop { x: number; y: number; r: number; sx: number; sy: number; m: number; mx: number; last: number; next: number; dead: boolean }
interface Flake { x: number; y: number; r: number; v: number; li: number; ph: number; stick: boolean; sy: number }
interface Stuck { x: number; y: number; r: number; melt: number; life: number }

/** 물방울 반지름. 조사한 구현들의 5~22 는 1000px 넘는 캔버스 기준이라 폰에서는 비눗방울이 된다. */
const MIN_R = 3.2, MAX_R = 11, DR = MAX_R - MIN_R;
/** 창틀에 쌓이는 눈의 버킷 폭(px)과 최대 높이. */
const BUCKET = 4, PILE_MAX = 30;
/** 30fps 로 묶는다. rAF 는 계속 걸고 시뮬·그리기만 건너뛴다. */
const STEP_MS = 1000 / 30, DRIFT_EPS = 5;

export default function WeatherFx({ wx, pushX, viewport }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  /* ★바람은 30분마다 갱신된다. 그걸 effect 의존성에 넣으면 **그때마다 유리가 초기화되어**
     맺혀 있던 물방울이 통째로 사라진다 — 바람이 조금 바뀐 것뿐인데 화면이 리셋되는 셈이다.
     ref 로 흘려 넣어 다음 프레임부터 자연스럽게 반영되게 한다. */
  const pushRef = useRef(pushX);
  pushRef.current = pushX;

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !viewport || !wx) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, prev = 0, next = 0, alive = true;
    let g: CanvasRenderingContext2D | null = null;
    let W = 0, H = 0, SILL = 0;
    const snow = wx.kind === '눈';

    let drops: Drop[] = [];
    let flakes: Flake[] = [];
    let stuck: Stuck[] = [];
    let pile = new Float32Array(0);
    let pMin = 0, pMax = -1, smoothTick = 0;
    let spawnCap = 0, hardCap = 0;
    let sprite: HTMLCanvasElement | null = null;

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    /* ── 물방울은 **스프라이트 한 장**을 만들어 놓고 크기만 바꿔 찍는다 ─────────────
       방울마다 경로 넷(몸통·테두리·초승달·하이라이트)을 그리면 185개 x 4 = 740 draw call
       인데 drawImage 는 185회다. 그리고 물로 읽히게 하는 것은 하이라이트가 아니라
       **위가 어둡고 아래로 빛이 몰리는 세로 그라디언트**다 — 물렌즈가 빛을 아래로 모은다.
       첫 판처럼 「테두리 원 + 흰 점」으로 그리면 비눗방울이 된다(렌더해서 확인). */
    const makeSprite = () => {
      const S = 96, c = document.createElement('canvas');
      c.width = S; c.height = Math.round(S * 1.3);
      const q = c.getContext('2d');
      if (!q) return c;
      const cx = S / 2, cy = c.height / 2, rx = S / 2 - 3, ry = c.height / 2 - 3;
      const grad = q.createLinearGradient(0, cy - ry, 0, cy + ry);
      grad.addColorStop(0.00, 'rgba(20,54,88,0.30)');
      grad.addColorStop(0.42, 'rgba(198,230,252,0.14)');
      grad.addColorStop(0.80, 'rgba(245,252,255,0.58)');
      grad.addColorStop(1.00, 'rgba(255,255,255,0.86)');
      q.beginPath(); q.ellipse(cx, cy, rx, ry, 0, 0, 6.283); q.fillStyle = grad; q.fill();
      q.strokeStyle = 'rgba(18,50,82,0.34)'; q.lineWidth = 2; q.stroke();
      q.beginPath(); q.ellipse(cx, cy, rx * 0.78, ry * 0.78, 0, 0.58, 2.56);
      q.strokeStyle = 'rgba(255,255,255,0.95)'; q.lineWidth = rx * 0.24; q.stroke();
      q.beginPath(); q.arc(cx - rx * 0.34, cy - ry * 0.38, rx * 0.17, 0, 6.283);
      q.fillStyle = 'rgba(255,255,255,0.92)'; q.fill();
      return c;
    };

    const mkDrop = (): Drop => {
      // 세제곱 바이어스 — 작은 방울이 압도적이고 큰 것은 드물다.
      const u = Math.random();
      return {
        // ★새로 맺히는 방울도 **화면 전체**에 생긴다. 위쪽에만 두면 아래 방울이 흘러
        //  사라진 뒤 다시 안 채워져 몇 초 만에 아래 절반이 빈다(시안에서 실제로 그랬다).
        x: Math.random() * W, y: rnd(-10, H), r: MIN_R + DR * u * u * u,
        sx: 0.5, sy: 0.5, m: 0, mx: 0, last: 0, next: rnd(MIN_R, MAX_R), dead: false,
      };
    };
    const aim = (f: Flake) => { f.stick = Math.random() < 0.55; f.sy = rnd(H * 0.10, SILL - 8); };
    const mkFlake = (li: number, anywhere: boolean): Flake => {
      // 속도 45~105 px/s 는 조사값 그대로. 크기만 밝은 배경에 맞게 올렸다.
      const L = [[45, 62, 1.5, 2.4], [62, 84, 2.2, 3.4], [82, 105, 3.0, 4.8]][li];
      const f: Flake = {
        x: rnd(-W * 0.3, W * 1.3), y: anywhere ? Math.random() * H : rnd(-40, -8),
        r: rnd(L[2], L[3]), v: rnd(L[0], L[1]), li, ph: Math.random() * 6.3, stick: false, sy: 0,
      };
      aim(f); return f;
    };

    const pileAt = (x: number) => pile[Math.max(0, Math.min(pile.length - 1, Math.floor(x / BUCKET)))] ?? 0;
    const addPile = (x: number, r: number) => {
      const c = Math.floor(x / BUCKET), sp = Math.ceil(r / BUCKET) + 1, add = r * 0.9;
      for (let k = -sp; k <= sp; k++) {
        const i = c + k;
        if (i < 0 || i >= pile.length) continue;
        if (Math.random() < 0.15) continue;          // 15%는 일부러 건너뛴다 — 질감
        pile[i] = Math.min(PILE_MAX, pile[i] + add * (1 - Math.abs(k) / (sp + 1)));
        if (i < pMin) pMin = i;
        if (i > pMax) pMax = i;
      }
    };

    const init = () => {
      const calm = mq.matches;
      const area = W * H;
      sprite = makeSprite();
      pile = new Float32Array(Math.max(1, Math.ceil(W / BUCKET)));
      pMin = pile.length; pMax = -1; smoothTick = 0;
      stuck = []; drops = []; flakes = [];

      hardCap = 300;
      if (snow) {
        // 눈일 때 물방울은 **오직 녹아서만** 생긴다 → 하늘에서 맺히는 목표는 0.
        spawnCap = 0;
        const n = Math.min(240, Math.round(area / 2600 * [0.55, 1, 1.6][wx.level - 1] * (calm ? 0.4 : 1)));
        for (let li = 0; li < 3; li++)
          for (let i = 0, c = Math.round(n * [0.40, 0.36, 0.24][li]); i < c; i++) flakes.push(mkFlake(li, true));
      } else {
        spawnCap = Math.min(240, Math.round(area / 2150 * [0.6, 1, 1.55][wx.level - 1] * (calm ? 0.4 : 1)));
        for (let i = 0; i < spawnCap * 0.55; i++) drops.push(mkDrop());
      }
    };

    const stepDrops = (ts: number) => {
      if (drops.length < spawnCap && Math.random() < 0.3 * ts)
        for (let k = 0, c = 1 + Math.floor(Math.random() * 3); k < c; k++) drops.push(mkDrop());

      for (const d of drops) {
        if (d.dead) continue;
        /* ★★이 효과의 심장 — 중력이 상시 걸리는 게 아니라 **확률적으로 미끄러짐이 터진다.**
           r<=MIN_R 이면 확률이 0 이라 영영 붙어 있고, 병합으로 커진 순간부터 자주·세게 흐른다.
           「맺혀 있다가 갑자기 주르륵」이 이 한 줄에서 나온다. */
        if (Math.random() < (d.r - MIN_R) * (0.1 / DR) * ts) d.m += Math.random() * (d.r / MAX_R) * 4;
        d.m = Math.max(0, d.m - Math.max(1, MIN_R * 0.5 - d.m) * 0.1 * ts);
        d.mx = d.mx * Math.pow(0.7, ts) + pushRef.current * d.m * 0.35 * ts;   // 바람은 옆으로만 민다
        d.y += d.m * ts; d.x += d.mx * ts;
        d.sx *= Math.pow(0.4, ts); d.sy *= Math.pow(0.7, ts);
        if (d.m > 0.5) {
          d.last += d.m * ts;
          if (d.last > d.next) {                       // 흐른 자리에 궤적을 남긴다
            d.last = 0;
            d.next = rnd(MIN_R, MAX_R) - d.m * 2 + (MAX_R - d.r);
            const cr = d.r * rnd(0.2, 0.5);
            if (cr > 1.3 && drops.length < hardCap)
              drops.push({ x: d.x + rnd(-d.r, d.r) * 0.1, y: d.y - d.r * 0.01, r: cr,
                           sx: 0, sy: 0, m: 0, mx: 0, last: 0, next: rnd(MIN_R, MAX_R), dead: false });
            d.r *= Math.pow(0.97, ts);                 // 자식을 떨구면 부모가 줄어든다
          }
        }
        if (d.r <= MIN_R && Math.random() < 0.05 * ts) d.r -= 0.12 * ts;   // 증발
        if (d.r <= 0.9 || d.y - d.r > H) d.dead = true;
      }

      // 병합 — y 로 정렬한 뒤 **뒤쪽 이웃 40개만** 본다(O(n²) 회피)
      drops.sort((a, b) => a.y - b.y);
      for (let i = 0; i < drops.length; i++) {
        const a = drops[i];
        if (a.dead) continue;
        const lim = Math.min(i + 40, drops.length);
        for (let j = i + 1; j < lim; j++) {
          const b = drops[j];
          if (b.dead) continue;
          if (Math.hypot(b.x - a.x, b.y - a.y) < (a.r + b.r) * (0.65 + a.m * 0.01 * ts)) {
            const big = a.r >= b.r ? a : b, sm = big === a ? b : a;
            big.r = Math.min(MAX_R, Math.sqrt(big.r * big.r + sm.r * sm.r * 0.8));   // 면적 기반, 손실형
            big.m = Math.max(sm.m, Math.min(40, big.m + big.r * 0.05 + 1));
            big.mx += (sm.x - big.x) * 0.1;
            big.sx = 0.6; big.sy = 0.6;
            sm.dead = true;
          }
        }
      }
      drops = drops.filter(d => !d.dead);
    };

    const draw = (dt: number, t: number, ts: number) => {
      if (!g) return;
      g.clearRect(0, 0, W, H);

      if (wx.kind === '뇌우') {                        // 5.2초에 한 번 번쩍
        const p = (t % 5200) / 5200;
        const a = p < 0.02 ? 0.42 : (p < 0.05 ? 0.18 : 0);
        if (a) { g.fillStyle = `rgba(226,240,255,${a})`; g.fillRect(0, 0, W, H); }
      }

      if (snow) {
        const sec = t / 1000;
        for (const f of flakes) {
          f.x += pushRef.current * f.v * dt + Math.sin(sec * 1.1 + f.ph) * 9 * dt;
          f.y += f.v * dt;
          if (f.stick && f.y >= f.sy) {                // ★유리에 **붙는다**
            stuck.push({ x: f.x, y: f.y, r: f.r * 1.25, melt: 0, life: rnd(3.5, 8) });
            Object.assign(f, mkFlake(f.li, false));
          } else if (f.y >= SILL - pileAt(f.x)) {      // 창틀에 쌓인다
            addPile(f.x, f.r * 1.2);
            Object.assign(f, mkFlake(f.li, false));
          } else if (f.x < -W * 0.35) f.x += W * 1.6;
          else if (f.x > W * 1.35) f.x -= W * 1.6;
        }
        // ★녹는다 → **물방울이 되어 흘러내린다**
        for (let i = stuck.length - 1; i >= 0; i--) {
          const s = stuck[i];
          s.melt += dt / s.life;
          s.r *= Math.pow(0.994, ts);
          if (s.melt >= 1) {
            stuck.splice(i, 1);
            if (drops.length < hardCap)
              drops.push({ x: s.x, y: s.y, r: MIN_R + rnd(0.4, 4.5), sx: 0, sy: 0,
                           m: 0, mx: 0, last: 0, next: rnd(MIN_R, MAX_R), dead: false });
          }
        }
        if (pMax >= pMin) {                            // 4프레임마다 한 번만 편다
          smoothTick = (smoothTick + 1) & 3;
          if (!smoothTick)
            for (let i = Math.max(1, pMin); i <= Math.min(pile.length - 2, pMax); i++)
              pile[i] += ((pile[i - 1] + pile[i + 1]) * 0.5 - pile[i]) * 0.16;
        }
      }

      stepDrops(ts);

      if (snow) {                                      // 내리는 눈 — 층마다 한 번씩만 그린다
        const LA = [0.52, 0.74, 0.92];
        for (let li = 0; li < 3; li++) {
          g.beginPath();
          for (const f of flakes) if (f.li === li) { g.moveTo(f.x + f.r, f.y); g.arc(f.x, f.y, f.r, 0, 6.283); }
          g.fillStyle = `rgba(255,255,255,${LA[li]})`; g.fill();
          // 테두리가 없으면 흰 눈이 밝은 지도에 그대로 묻힌다
          g.strokeStyle = `rgba(96,132,166,${LA[li] * 0.62})`; g.lineWidth = 0.9; g.stroke();
        }
      }

      if (sprite) for (const d of drops) {
        const rx = d.r * (1 + d.sx), ry = d.r * (1.26 + d.sy);   // 방울은 늘 세로로 길다
        g.drawImage(sprite, d.x - rx, d.y - ry, rx * 2, ry * 2);
      }

      if (snow) {
        for (const s of stuck) {                       // 녹을수록 아래로 처지고 투명해진다
          const a = Math.max(0.18, 0.95 - s.melt * 0.62);
          g.beginPath(); g.ellipse(s.x, s.y + s.r * s.melt * 0.5, s.r, s.r * (1 + s.melt * 0.55), 0, 0, 6.283);
          g.fillStyle = `rgba(255,255,255,${a})`; g.fill();
          g.strokeStyle = `rgba(104,140,174,${a * 0.6})`; g.lineWidth = 0.9; g.stroke();
        }
        if (pMax >= pMin) {                            // 창틀에 쌓인 눈
          g.beginPath(); g.moveTo(0, SILL + 3);
          for (let i = 0; i < pile.length; i++) g.lineTo(i * BUCKET, SILL - pile[i]);
          g.lineTo(W, SILL + 3); g.closePath();
          g.fillStyle = 'rgba(255,255,255,0.97)'; g.fill();
          g.beginPath();
          for (let i = 0; i < pile.length; i++) {
            const x = i * BUCKET, y = SILL - pile[i];
            if (i) g.lineTo(x, y); else g.moveTo(x, y);
          }
          g.strokeStyle = 'rgba(104,140,174,0.72)'; g.lineWidth = 1.2; g.stroke();
        }
      }
    };

    const tick = (t: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      // ★드리프트 보정이 없으면 60Hz 폰에서 33.33ms 문턱이 20fps 로 주저앉는다.
      if (next && t < next - DRIFT_EPS) return;
      next = Math.max(next + STEP_MS, t);
      const dt = prev ? Math.min((t - prev) / 1000, 0.1) : 1 / 30;   // 탭에서 돌아왔을 때 화면을 훑지 않게
      prev = t;
      draw(dt, t, Math.min(dt * 60, 1.1));
    };

    const boot = () => {
      const r = viewport.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      cv.style.left = `${Math.round(r.left)}px`;
      cv.style.top = `${Math.round(r.top)}px`;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;                      // ★대체 요소라 이걸 빼면 300x150 에 갇힌다

      /* ★**창틀은 캔버스 바닥이 아니다.** 지도 뷰포트는 지역 버튼 줄·최근 업데이트 바
         **아래까지** 이어져 있어서, 바닥(H)에 눈을 쌓으면 버튼 뒤에 가려 아무도 못 본다
         (실제 앱에 넣고 찍어 보고서야 알았다 — 시안에서는 그 줄이 없었다).
         높이를 여기에 또 적지 않고 그 줄을 **실측**한다. 브레이크포인트마다 높이가
         달라져도(작은 화면 70px / sm 이상 78px) 저절로 따라간다. */
      const sillEl = document.querySelector('[data-map-sill]');
      const sillTop = sillEl ? sillEl.getBoundingClientRect().top - r.top : H;
      SILL = Math.round(Math.min(H, Math.max(H * 0.5, sillTop)));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      g = cv.getContext('2d');
      g?.setTransform(dpr, 0, 0, dpr, 0, 0);           // 이 줄이 빠지면 고DPI 에서 전부 뭉갠다
      init();
      prev = 0; next = 0;
    };

    boot();
    raf = requestAnimationFrame(tick);

    // 화면을 안 보고 있으면 멈춘다 — 배터리·발열의 첫 번째 방어선.
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) { prev = 0; next = 0; raf = requestAnimationFrame(tick); }
    };
    // 「동작 줄이기」는 change 까지 듣는다 — 초기 검사만 하면 도중에 켠 사람을 놓친다.
    const onCalm = () => boot();
    const ro = new ResizeObserver(boot);
    ro.observe(viewport);
    document.addEventListener('visibilitychange', onVis);
    mq.addEventListener('change', onCalm);
    window.addEventListener('resize', boot);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      mq.removeEventListener('change', onCalm);
      window.removeEventListener('resize', boot);
    };
    // ★`wx` 객체가 아니라 **값**에 의존한다. 30분마다 같은 날씨를 다시 받아도 객체는 새로
    //  만들어지므로, 객체로 걸면 날씨가 그대로인데도 유리가 초기화된다.
  }, [wx?.kind, wx?.level, viewport]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!wx || !viewport) return null;
  /* z-30 — 지도·마커 **위**, 버튼·칩·카드 **아래**. 유리가 지도 앞에 있고 조작부는 그 앞이다.
     `pointer-events-none` 이라 팬·핀치·배 선택을 한 픽셀도 가리지 않는다. */
  return <canvas ref={ref} aria-hidden className="fixed z-30 pointer-events-none" />;
}
