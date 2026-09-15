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
  let seg = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      segIsAd.push(false);
      segUrls.push([]);
      seg = segIsAd.length - 1;
    } else if (seg >= 0) {
      const m = EXTINF_RE.exec(t);
      if (!m) continue;
      if (!onGrid(parseFloat(m[1]))) segIsAd[seg] = true;
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
