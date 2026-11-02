/* eslint-disable no-console */

/**
 * 从 HLS 媒体播放列表中剔除广告分片。
 *
 * 原理：广告段与正片的编码帧率通常不同，导致其分片时长落在不同的帧网格上。
 * 先推断正片主帧率，再把偏离该网格的整段分片从播放列表中剔除。
 * 与旧实现（无差别删除全部 DISCONTINUITY、依赖解码失败丢段）相比，
 * 这里只删除明确异常的分片，且保留 DISCONTINUITY 标记，不会误伤正片段。
 *
 * 细网格（50/60fps）是粗网格（25/30fps）的超集。若直接取命中数最高的帧率，
 * 广告尾片（例如 1.7s）会把结果抬到 50fps，导致整段广告都“在网格上”。
 * 因此在命中数接近时回退到半帧率。分片 URL 的序号族作为兜底：
 * 正片序号连续，插入广告时常跳到另一组编号。
 *
 * 还有一类广告和正片同帧率，尾片也落在网格上（例如 5×4.000s + 1.000s）。
 * 这类段的特征是：除最后一片外时长完全相同，尾片明显更短。
 * 整段都是相同时长的正片（例如连续 4.000s）不会被这条规则命中。
 *
 * 片尾若只是很短的一段，且分辨率和正片明显不同（例如 1280x720 接在 1920x800 后面），
 * 由 filterAdsFromM3U8Resolved 再读两个分片的 SPS 后删掉。时长规则分不出这种段。
 */
export function filterAdsFromM3U8(m3u8Content: string): string {
  if (!m3u8Content) return '';

  const EXTINF_RE = /^#EXTINF:([0-9.]+)/;
  const lines = m3u8Content.split('\n');

  const durations: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = EXTINF_RE.exec(lines[i].trim());
    if (m) durations.push(parseFloat(m[1]));
  }

  // master playlist（无分片）或分片太少不足以判定帧率时，保持原样
  if (durations.length < 8) return m3u8Content;

  const CANDIDATE_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const HALF_FPS: Record<number, number> = {
    50: 25,
    60: 30,
    59.94: 29.97,
  };

  let bestFps = 0;
  let bestHit = -1;
  for (let f = 0; f < CANDIDATE_FPS.length; f++) {
    const fps = CANDIDATE_FPS[f];
    const g = 1 / fps;
    let hit = 0;
    for (let i = 0; i < durations.length; i++) {
      const r = durations[i] / g;
      if (Math.abs(r - Math.round(r)) < 0.02) hit++;
    }
    if (hit > bestHit || (hit === bestHit && fps < bestFps)) {
      bestHit = hit;
      bestFps = fps;
    }
  }

  // 50/60 命中略高时，改用 25/30：只让真正的高帧率正片留在细网格上
  const half = HALF_FPS[bestFps];
  if (half) {
    const g = 1 / half;
    let hit = 0;
    for (let i = 0; i < durations.length; i++) {
      const r = durations[i] / g;
      if (Math.abs(r - Math.round(r)) < 0.02) hit++;
    }
    const slack = Math.max(2, Math.floor(durations.length * 0.01));
    if (hit >= bestHit - slack) {
      bestFps = half;
      bestHit = hit;
    }
  }

  const grid = 1 / bestFps;
  const onGrid = (d: number): boolean => {
    const r = d / grid;
    return Math.abs(r - Math.round(r)) < 0.02;
  };

  const urlFamily = (url: string): string => {
    const m = url.match(/(\d+)\.(ts|m4s)(\?|$)/i);
    if (!m) return '';
    const digits = m[1];
    return digits.length <= 4 ? digits : digits.slice(0, -4);
  };

  // 按 #EXT-X-DISCONTINUITY 分段，段内任一分片偏离网格即整段判为广告
  // （必须段级判定：0.2s 这类值是 25/30 网格的公倍数，逐片判定会漏）
  const segIsAd: boolean[] = [];
  const segUrls: string[][] = [];
  const segDurs: number[][] = [];
  let seg = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      segIsAd.push(false);
      segUrls.push([]);
      segDurs.push([]);
      seg = segIsAd.length - 1;
    } else if (seg >= 0) {
      const m = EXTINF_RE.exec(t);
      if (!m) continue;
      const dur = parseFloat(m[1]);
      segDurs[seg].push(dur);
      if (!onGrid(dur)) segIsAd[seg] = true;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && !lines[j].trim().startsWith('#')) {
        segUrls[seg].push(lines[j].trim());
      }
    }
  }

  // 兜底：正片 URL 序号族占大多数时，少数族所在的 DISCONTINUITY 段视为广告
  const familyCount = new Map<string, number>();
  let urlTotal = 0;
  for (let s = 0; s < segUrls.length; s++) {
    for (let u = 0; u < segUrls[s].length; u++) {
      const fam = urlFamily(segUrls[s][u]);
      if (!fam) continue;
      familyCount.set(fam, (familyCount.get(fam) || 0) + 1);
      urlTotal++;
    }
  }
  let dominant = '';
  let dominantCount = 0;
  familyCount.forEach((n, fam) => {
    if (n > dominantCount) {
      dominantCount = n;
      dominant = fam;
    }
  });
  if (dominant && urlTotal >= 8 && dominantCount / urlTotal >= 0.7) {
    for (let s = 0; s < segUrls.length; s++) {
      const urls = segUrls[s];
      if (!urls.length) continue;
      let foreign = 0;
      for (let u = 0; u < urls.length; u++) {
        const fam = urlFamily(urls[u]);
        if (fam && fam !== dominant) foreign++;
      }
      if (foreign * 2 >= urls.length) segIsAd[s] = true;
    }
  }

  // 同帧率广告：除尾片外时长完全一致，尾片不超过主体的一半且 ≤ 2s
  for (let s = 0; s < segDurs.length; s++) {
    const durs = segDurs[s];
    if (durs.length < 5) continue;
    const body = durs[0];
    const tail = durs[durs.length - 1];
    if (!(body >= 2 && tail <= 2 && tail <= body * 0.5)) continue;
    let uniform = true;
    for (let u = 1; u < durs.length - 1; u++) {
      if (Math.abs(durs[u] - body) > 0.001) {
        uniform = false;
        break;
      }
    }
    if (uniform) segIsAd[s] = true;
  }

  const adSegCount = segIsAd.filter(Boolean).length;

  // 没有异常段：原样返回，对该源不做任何改动
  if (adSegCount === 0) return m3u8Content;

  // 剔除广告段的分片（#EXTINF 行 + 紧随其后的分片 URL 行）
  // 保留 DISCONTINUITY 标记，段边界的参数重探测不受影响
  const drop = new Set<number>();
  seg = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      seg++;
      continue;
    }
    if (seg >= 0 && segIsAd[seg] && EXTINF_RE.test(t)) {
      drop.add(i);
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && !lines[j].trim().startsWith('#')) drop.add(j);
    }
  }

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!drop.has(i)) kept.push(lines[i]);
  }

  // 清理因整段删空而产生的连续 DISCONTINUITY
  const out: string[] = [];
  let prevDisc = false;
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      if (prevDisc) continue;
      prevDisc = true;
    } else if (t) {
      prevDisc = false;
    }
    out.push(kept[i]);
  }

  if (process.env.NODE_ENV === 'development') {
    let remain = 0;
    for (let i = 0; i < out.length; i++) {
      if (EXTINF_RE.test(out[i].trim())) remain++;
    }
    console.log(
      `[去广告] 主帧率 ${bestFps}fps（网格 ${grid.toFixed(
        6
      )}s，命中 ${bestHit}/${durations.length}）`
    );
    console.log(
      `[去广告] 剔除 ${adSegCount}/${segIsAd.length} 段，分片 ${durations.length} -> ${remain}`
    );
  }

  return out.join('\n');
}

type DiscGroup = { durs: number[]; url: string };

function listDiscGroups(m3u8Content: string): DiscGroup[] {
  const EXTINF_RE = /^#EXTINF:([0-9.]+)/;
  const lines = m3u8Content.split('\n');
  const groups: DiscGroup[] = [];
  let cur: DiscGroup | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      cur = { durs: [], url: '' };
      groups.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = EXTINF_RE.exec(t);
    if (!m) continue;
    cur.durs.push(parseFloat(m[1]));
    if (cur.url) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && !lines[j].trim().startsWith('#')) {
      cur.url = lines[j].trim();
    }
  }
  return groups;
}

function stripDiscGroup(m3u8Content: string, groupIndex: number): string {
  const EXTINF_RE = /^#EXTINF:([0-9.]+)/;
  const lines = m3u8Content.split('\n');
  const drop = new Set<number>();
  let seg = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      seg++;
      continue;
    }
    if (seg !== groupIndex || !EXTINF_RE.test(t)) continue;
    drop.add(i);
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && !lines[j].trim().startsWith('#')) drop.add(j);
  }
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!drop.has(i)) kept.push(lines[i]);
  }
  const out: string[] = [];
  let prevDisc = false;
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      if (prevDisc) continue;
      prevDisc = true;
    } else if (t) {
      prevDisc = false;
    }
    out.push(kept[i]);
  }
  return out.join('\n');
}

type VideoSize = { w: number; h: number };

/** 从 TS 前部的 H.264 SPS 读宽高。失败返回 null。 */
function readH264Size(buf: Uint8Array): VideoSize | null {
  let spsAt = -1;
  for (let i = 0; i + 4 < buf.length; i++) {
    if (
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      buf[i + 2] === 1 &&
      (buf[i + 3] & 0x1f) === 7
    ) {
      spsAt = i + 4;
      break;
    }
    if (
      i + 5 < buf.length &&
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      buf[i + 2] === 0 &&
      buf[i + 3] === 1 &&
      (buf[i + 4] & 0x1f) === 7
    ) {
      spsAt = i + 5;
      break;
    }
  }
  if (spsAt < 0) return null;

  const rbsp: number[] = [];
  for (let i = spsAt; i < buf.length && rbsp.length < 256; i++) {
    if (
      i + 2 < buf.length &&
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      buf[i + 2] === 3
    ) {
      rbsp.push(0, 0);
      i += 2;
      continue;
    }
    if (
      i + 2 < buf.length &&
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      (buf[i + 2] === 0 || buf[i + 2] === 1)
    ) {
      break;
    }
    rbsp.push(buf[i]);
  }
  if (rbsp.length < 4) return null;

  let bit = 0;
  const readBit = (): number => {
    const i = bit >> 3;
    if (i >= rbsp.length) return 0;
    const v = (rbsp[i] >> (7 - (bit & 7))) & 1;
    bit++;
    return v;
  };
  const readBits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | readBit();
    return v;
  };
  const readUE = (): number => {
    let zeros = 0;
    while (readBit() === 0 && zeros < 31) zeros++;
    let info = 0;
    for (let i = 0; i < zeros; i++) info = (info << 1) | readBit();
    return (1 << zeros) - 1 + info;
  };
  const readSE = (): number => {
    const ue = readUE();
    return (ue & 1) === 0 ? -(ue >> 1) : (ue + 1) >> 1;
  };

  const profile = readBits(8);
  readBits(16);
  readUE();
  let chroma = 1;
  if (
    profile === 100 ||
    profile === 110 ||
    profile === 122 ||
    profile === 244 ||
    profile === 44 ||
    profile === 83 ||
    profile === 86 ||
    profile === 118 ||
    profile === 128 ||
    profile === 138 ||
    profile === 139 ||
    profile === 134 ||
    profile === 135
  ) {
    chroma = readUE();
    if (chroma === 3) readBit();
    readUE();
    readUE();
    readBit();
    if (readBit()) {
      const n = chroma === 3 ? 12 : 8;
      for (let i = 0; i < n; i++) {
        if (!readBit()) continue;
        const size = i < 6 ? 16 : 64;
        let last = 8;
        let next = 8;
        for (let j = 0; j < size; j++) {
          if (next !== 0) next = (last + readSE() + 256) % 256;
          last = next === 0 ? last : next;
        }
      }
    }
  }
  readUE();
  const pocType = readUE();
  if (pocType === 0) {
    readUE();
  } else if (pocType === 1) {
    readBit();
    readSE();
    readSE();
    const n = readUE();
    for (let i = 0; i < n; i++) readSE();
  }
  readUE();
  readBit();
  const widthMbs = readUE() + 1;
  const heightMap = readUE() + 1;
  const frameMbsOnly = readBit();
  if (!frameMbsOnly) readBit();
  readBit();
  let cropLeft = 0;
  let cropRight = 0;
  let cropTop = 0;
  let cropBottom = 0;
  if (readBit()) {
    cropLeft = readUE();
    cropRight = readUE();
    cropTop = readUE();
    cropBottom = readUE();
  }
  const cropUnitX = chroma === 1 || chroma === 2 ? 2 : 1;
  const cropUnitY = (chroma === 1 ? 2 : 1) * (2 - frameMbsOnly);
  const w = widthMbs * 16 - (cropLeft + cropRight) * cropUnitX;
  const h =
    heightMap * 16 * (2 - frameMbsOnly) - (cropTop + cropBottom) * cropUnitY;
  if (w < 16 || h < 16 || w > 8192 || h > 8192) return null;
  return { w, h };
}

async function fetchVideoSize(url: string): Promise<VideoSize | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { Range: 'bytes=0-16383' },
        signal: ctrl.signal,
      });
      if (!res.ok && res.status !== 206) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      const size = readH264Size(buf);
      if (size) return size;
    } catch {
      // 源站偶发断连，换一次再试
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * 先按播放列表剔除广告，再检查片尾短段的分辨率。
 * 只在片尾短于 20 秒、且宽高都明显小于正片时删除。探测失败则保持原列表。
 */
export async function filterAdsFromM3U8Resolved(
  m3u8Content: string,
  playlistUrl: string
): Promise<string> {
  const filtered = filterAdsFromM3U8(m3u8Content);
  if (!playlistUrl) return filtered;

  const groups = listDiscGroups(filtered);
  if (groups.length < 8) return filtered;
  const last = groups[groups.length - 1];
  let lastDur = 0;
  for (let i = 0; i < last.durs.length; i++) lastDur += last.durs[i];
  if (!last.url || last.durs.length >= 6 || lastDur <= 0 || lastDur >= 20) {
    return filtered;
  }

  const resolve = (rel: string): string => {
    try {
      return new URL(rel, playlistUrl).href;
    } catch {
      return rel;
    }
  };

  const refGroup = groups[Math.floor(groups.length * 0.4)];
  if (!refGroup || !refGroup.url) return filtered;

  const [ref, tail] = await Promise.all([
    fetchVideoSize(resolve(refGroup.url)),
    fetchVideoSize(resolve(last.url)),
  ]);
  if (!ref || !tail) return filtered;
  const dw = Math.abs(ref.w - tail.w);
  const dh = Math.abs(ref.h - tail.h);
  if (dw < 160 || dh < 64) return filtered;

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[去广告] 片尾 ${tail.w}x${tail.h}，正片 ${ref.w}x${
        ref.h
      }，剔除片尾 ${lastDur.toFixed(2)}s`
    );
  }
  return stripDiscGroup(filtered, groups.length - 1);
}
