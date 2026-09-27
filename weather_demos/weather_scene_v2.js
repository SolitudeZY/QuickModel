'use strict';

const $ = id => document.getElementById(id);
const baseCanvases = [$('base-a'), $('base-b')];
const baseContexts = baseCanvases.map(canvas => canvas.getContext('2d'));
const weatherCanvas = $('weather-canvas');
const weatherCtx = weatherCanvas.getContext('2d');
const rainCanvas = $('rain-canvas');
const lightning = $('lightning');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const PERIOD_LABELS = { day: '白天', dusk: '黄昏', night: '夜晚' };
const WEATHER_META = {
  clear: ['晴朗', '清透天空与缓慢漂浮的光尘'],
  cloudy: ['多云', '分层云团随风缓慢掠过'],
  rain: ['雨', '雨滴停留、汇聚并沿玻璃滑落'],
  snow: ['雪', '远近不同的雪花穿过窗前'],
  fog: ['雾', '薄雾分层流动并遮蔽远景'],
  thunder: ['雷暴', '雨幕、深云与不规则闪电'],
};
const WEATHER_SHORT = { clear: '晴', cloudy: '云', rain: '雨', snow: '雪', fog: '雾', thunder: '雷' };
const QUALITY = {
  eco: { fps: 20, dpr: 0.85, clouds: 4, snow: 145, fog: 5, dust: 28, rainScale: 0.68, rainLimit: 220, droplets: 90 },
  balanced: { fps: 30, dpr: 1.15, clouds: 6, snow: 240, fog: 7, dust: 44, rainScale: 0.82, rainLimit: 420, droplets: 170 },
  high: { fps: 40, dpr: 1.4, clouds: 8, snow: 360, fog: 9, dust: 60, rainScale: 1, rainLimit: 680, droplets: 260 },
};

const state = {
  period: 'day',
  weather: 'clear',
  quality: 'balanced',
  intensity: 0.7,
  wind: 0.45,
  mist: 0.32,
  refraction: 0.65,
};

let width = Math.max(1, window.innerWidth);
let height = Math.max(1, window.innerHeight);
let renderDpr = 1;
let activeBase = 0;
let animationHandle = 0;
let lastFrameAt = 0;
let fpsSampleStarted = 0;
let fpsFrames = 0;
let transitionToken = 0;
let periodToken = 0;
let resizeTimer = 0;
let nextLightningAt = 0;
let rainFx = null;
let rainReady = false;
let rainFailed = false;

let clouds = [];
let snowflakes = [];
let fogBands = [];
let dustMotes = [];
let cloudSprite = null;
let stormCloudSprite = null;
let fogSprites = [];
let snowSprites = [];

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function random(min, max) { return min + Math.random() * (max - min); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function currentQuality() { return QUALITY[state.quality]; }

function setCanvasSize(canvas, ctx, scale) {
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function seeded(index) {
  const value = Math.sin(index * 91.177 + 17.31) * 43758.5453;
  return value - Math.floor(value);
}

function cityPalette(period) {
  if (period === 'day') {
    return {
      layers: ['rgba(101,133,147,0.30)', 'rgba(66,99,116,0.54)', 'rgba(35,65,81,0.82)'],
      windows: ['rgba(205,232,239,0.22)', 'rgba(190,224,235,0.32)', 'rgba(169,211,226,0.38)'],
      reflection: 'rgba(166,213,228,0.18)',
    };
  }
  if (period === 'dusk') {
    return {
      layers: ['rgba(79,75,91,0.40)', 'rgba(53,55,72,0.68)', 'rgba(29,34,49,0.91)'],
      windows: ['rgba(255,205,139,0.30)', 'rgba(255,193,112,0.54)', 'rgba(255,218,150,0.66)'],
      reflection: 'rgba(244,154,104,0.20)',
    };
  }
  return {
    layers: ['rgba(29,52,69,0.46)', 'rgba(15,35,52,0.74)', 'rgba(7,20,32,0.96)'],
    windows: ['rgba(157,203,221,0.28)', 'rgba(255,210,121,0.62)', 'rgba(255,224,153,0.78)'],
    reflection: 'rgba(109,168,197,0.20)',
  };
}

function drawCityLayer(ctx, period, layer) {
  const palette = cityPalette(period);
  const bases = [0.70, 0.80, 1.01];
  const minWidths = [44, 48, 62];
  const maxWidths = [88, 104, 132];
  const minHeights = [34, 72, 105];
  const maxHeights = [118, 198, 280];
  const baseY = height * bases[layer];
  let x = -24;
  let index = layer * 211;
  ctx.fillStyle = palette.layers[layer];

  while (x < width + 40) {
    const buildingWidth = minWidths[layer] + seeded(index + 7) * (maxWidths[layer] - minWidths[layer]);
    const buildingHeight = minHeights[layer] + seeded(index + 19) * (maxHeights[layer] - minHeights[layer]);
    const top = baseY - buildingHeight;
    ctx.fillRect(x, top, buildingWidth, height - top);

    const roofType = Math.floor(seeded(index + 31) * 4);
    if (roofType === 1) ctx.fillRect(x + buildingWidth * 0.22, top - 8, buildingWidth * 0.56, 8);
    if (roofType === 2) {
      ctx.beginPath();
      ctx.moveTo(x + buildingWidth * 0.18, top);
      ctx.lineTo(x + buildingWidth * 0.5, top - 14);
      ctx.lineTo(x + buildingWidth * 0.82, top);
      ctx.fill();
    }
    if (roofType === 3 && layer > 0) {
      ctx.fillRect(x + buildingWidth * 0.49, top - 24, 2, 24);
      ctx.beginPath();
      ctx.fillStyle = period === 'night' ? 'rgba(239,90,85,0.76)' : 'rgba(255,214,170,0.48)';
      ctx.arc(x + buildingWidth * 0.5, top - 25, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.layers[layer];
    }

    if (layer > 0) {
      const windowGapX = layer === 1 ? 11 : 14;
      const windowGapY = layer === 1 ? 13 : 17;
      const columns = Math.max(1, Math.floor((buildingWidth - 12) / windowGapX));
      const rows = Math.max(1, Math.floor((buildingHeight - 16) / windowGapY));
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const chance = seeded(index * 37 + row * 13 + column * 5);
          if (chance < (period === 'night' ? 0.48 : period === 'dusk' ? 0.60 : 0.70)) continue;
          ctx.fillStyle = palette.windows[layer];
          ctx.fillRect(x + 7 + column * windowGapX, top + 10 + row * windowGapY, layer === 1 ? 2 : 3, layer === 1 ? 3 : 5);
        }
      }
      ctx.fillStyle = palette.layers[layer];
    }
    x += buildingWidth + 4 + seeded(index + 43) * 10;
    index += 1;
  }
}

function drawSkyline(ctx, period) {
  const palette = cityPalette(period);
  drawCityLayer(ctx, period, 0);

  const horizonHaze = ctx.createLinearGradient(0, height * 0.50, 0, height * 0.78);
  horizonHaze.addColorStop(0, 'rgba(255,255,255,0)');
  horizonHaze.addColorStop(0.52, period === 'dusk' ? 'rgba(244,177,151,0.12)' : 'rgba(184,211,221,0.10)');
  horizonHaze.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizonHaze;
  ctx.fillRect(0, height * 0.48, width, height * 0.34);

  drawCityLayer(ctx, period, 1);
  drawCityLayer(ctx, period, 2);

  if (period !== 'day') {
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < Math.floor(width / 23); index += 1) {
      if (seeded(index + 901) < 0.58) continue;
      const x = index * 23 + 6;
      const top = height * (0.73 + seeded(index + 951) * 0.08);
      const reflected = ctx.createLinearGradient(0, top, 0, height);
      reflected.addColorStop(0, palette.reflection);
      reflected.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = reflected;
      ctx.fillRect(x, top, 2 + seeded(index + 981) * 4, height - top);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawStars(ctx) {
  for (let index = 0; index < 130; index += 1) {
    const x = seeded(index + 220) * width;
    const y = seeded(index + 340) * height * 0.62;
    const size = 0.4 + seeded(index + 510) * 1.3;
    ctx.beginPath();
    ctx.fillStyle = `rgba(222,235,255,${0.28 + seeded(index + 620) * 0.56})`;
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCelestialGlow(ctx, period) {
  const isDay = period === 'day';
  const x = isDay ? width * 0.76 : period === 'dusk' ? width * 0.72 : width * 0.78;
  const y = isDay ? height * 0.18 : period === 'dusk' ? height * 0.34 : height * 0.16;
  const color = isDay ? [255, 231, 170] : period === 'dusk' ? [255, 151, 102] : [183, 211, 237];
  const radius = Math.max(width, height) * (isDay ? 0.36 : 0.25);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, `rgba(${color.join(',')},${isDay ? 0.54 : 0.36})`);
  glow.addColorStop(0.14, `rgba(${color.join(',')},0.17)`);
  glow.addColorStop(1, `rgba(${color.join(',')},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.fillStyle = `rgba(${color.join(',')},${period === 'night' ? 0.78 : 0.86})`;
  ctx.arc(x, y, period === 'night' ? 17 : 28, 0, Math.PI * 2);
  ctx.fill();
}

function renderBase(ctx, period) {
  ctx.save();
  ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const colors = period === 'day'
    ? ['#86bed8', '#c7dce4', '#eef1eb']
    : period === 'dusk'
      ? ['#485673', '#c77d78', '#f0b07e']
      : ['#07111e', '#12283b', '#294053'];
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, colors[0]);
  sky.addColorStop(0.58, colors[1]);
  sky.addColorStop(1, colors[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  if (period === 'night') drawStars(ctx);
  drawCelestialGlow(ctx, period);

  drawSkyline(ctx, period);
  const lowerHaze = ctx.createLinearGradient(0, height * 0.54, 0, height);
  lowerHaze.addColorStop(0, 'rgba(255,255,255,0)');
  lowerHaze.addColorStop(1, period === 'night' ? 'rgba(5,12,20,0.48)' : 'rgba(224,235,235,0.30)');
  ctx.fillStyle = lowerHaze;
  ctx.fillRect(0, height * 0.5, width, height * 0.5);
  ctx.restore();
}

function makeCloudSprite(period, storm = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 230;
  const ctx = canvas.getContext('2d');
  const color = storm
    ? (period === 'dusk' ? [83, 69, 79] : [45, 63, 78])
    : period === 'day' ? [236, 245, 246] : period === 'dusk' ? [212, 177, 176] : [109, 135, 156];
  ctx.shadowBlur = 26;
  ctx.shadowColor = `rgba(${color.join(',')},${storm ? 0.34 : 0.42})`;
  ctx.fillStyle = `rgba(${color.join(',')},${storm ? 0.90 : 0.82})`;
  const blobs = [[120,150,120,52],[245,112,142,78],[375,126,150,70],[505,154,120,48],[318,164,262,44]];
  for (const [x, y, rx, ry] of blobs) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makeFogSprite(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 260;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, 'rgba(225,235,237,0)');
  gradient.addColorStop(0.18, `rgba(225,235,237,${0.22 + seed * 0.05})`);
  gradient.addColorStop(0.54, `rgba(231,238,239,${0.42 - seed * 0.06})`);
  gradient.addColorStop(0.86, 'rgba(225,235,237,0.12)');
  gradient.addColorStop(1, 'rgba(225,235,237,0)');
  ctx.fillStyle = gradient;
  ctx.filter = `blur(${18 + seed * 9}px)`;
  for (let index = 0; index < 8; index += 1) {
    ctx.beginPath();
    ctx.ellipse(80 + index * 118, 120 + Math.sin(index + seed) * 28, 150, 58 + seed * 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makeSnowSprite(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (kind === 0) {
    const glow = ctx.createRadialGradient(24, 24, 0, 24, 24, 22);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.24, 'rgba(244,250,255,0.60)');
    glow.addColorStop(1, 'rgba(224,240,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 48, 48);
    return canvas;
  }
  ctx.translate(24, 24);
  ctx.shadowColor = 'rgba(217,239,255,0.72)';
  ctx.shadowBlur = kind === 1 ? 8 : 5;
  ctx.fillStyle = kind === 1 ? 'rgba(255,255,255,0.92)' : 'rgba(230,245,255,0.84)';
  ctx.beginPath();
  if (kind === 1) {
    ctx.ellipse(0, 0, 4.2, 12.5, -0.28, 0, Math.PI * 2);
  } else {
    ctx.moveTo(0, -13);
    ctx.lineTo(5.5, -1.5);
    ctx.lineTo(1.5, 12);
    ctx.lineTo(-4.5, 2);
    ctx.closePath();
  }
  ctx.fill();
  return canvas;
}

function rebuildVisuals() {
  const quality = currentQuality();
  cloudSprite = makeCloudSprite(state.period);
  stormCloudSprite = makeCloudSprite(state.period, true);
  fogSprites = [makeFogSprite(0), makeFogSprite(0.6), makeFogSprite(1)];
  snowSprites = [makeSnowSprite(0), makeSnowSprite(1), makeSnowSprite(2)];
  clouds = Array.from({ length: quality.clouds }, (_, index) => ({
    x: random(-width * 0.35, width),
    y: random(height * 0.04, height * 0.48),
    scale: random(0.42, 0.94),
    speed: random(5, 13),
    alpha: random(0.18, 0.42),
    phase: index * 1.37,
  }));
  snowflakes = Array.from({ length: quality.snow }, () => ({
    x: random(-30, width + 30),
    y: random(-height, height),
    depth: random(0.15, 1),
    size: random(5, 18),
    speed: random(18, 72),
    sway: random(6, 28),
    phase: random(0, Math.PI * 2),
    spin: random(-1, 1),
    sprite: Math.floor(random(0, 3)),
  }));
  fogBands = Array.from({ length: quality.fog }, (_, index) => ({
    x: random(-width, width),
    y: height * (0.18 + (index / Math.max(1, quality.fog - 1)) * 0.62) + random(-45, 45),
    scale: random(0.7, 1.35),
    speed: random(3, 9),
    alpha: random(0.10, 0.24),
    sprite: index % fogSprites.length,
  }));
  dustMotes = Array.from({ length: quality.dust }, () => ({
    x: random(0, width), y: random(0, height), size: random(0.7, 2.8),
    speed: random(2, 8), phase: random(0, Math.PI * 2), alpha: random(0.12, 0.38),
  }));
}

function drawClouds(dt, strength = 1, storm = false) {
  const speedFactor = 0.45 + state.wind * 1.6;
  const sprite = storm ? stormCloudSprite : cloudSprite;
  for (const cloud of clouds) {
    cloud.x += cloud.speed * speedFactor * dt;
    const drawWidth = sprite.width * cloud.scale;
    const drawHeight = sprite.height * cloud.scale;
    if (cloud.x > width + drawWidth * 0.25) cloud.x = -drawWidth - random(30, 180);
    const alpha = cloud.alpha * strength * (storm ? 1.35 : 1);
    weatherCtx.globalAlpha = clamp(alpha, 0, 0.68);
    weatherCtx.drawImage(sprite, cloud.x, cloud.y + Math.sin(performance.now() * 0.00018 + cloud.phase) * 3, drawWidth, drawHeight);
  }
  weatherCtx.globalAlpha = 1;
}

function drawSnow(ts, dt) {
  drawClouds(dt, 0.34);
  const wind = (state.wind - 0.35) * 62;
  const visibleCount = Math.floor(snowflakes.length * (0.38 + state.intensity * 0.62));
  for (let index = 0; index < visibleCount; index += 1) {
    const flake = snowflakes[index];
    const depthSpeed = 0.42 + flake.depth * 0.9;
    flake.y += flake.speed * depthSpeed * dt;
    flake.x += (wind * depthSpeed + Math.sin(ts * 0.00065 + flake.phase) * flake.sway) * dt;
    if (flake.y > height + 40) {
      flake.y = random(-100, -20);
      flake.x = random(-30, width + 30);
    }
    if (flake.x > width + 50) flake.x = -40;
    if (flake.x < -50) flake.x = width + 40;
    const size = flake.size * (0.45 + flake.depth * 1.25);
    weatherCtx.save();
    weatherCtx.translate(flake.x, flake.y);
    weatherCtx.rotate(ts * 0.00016 * flake.spin + flake.phase);
    weatherCtx.globalAlpha = 0.22 + flake.depth * 0.64;
    weatherCtx.drawImage(snowSprites[flake.sprite], -size, -size, size * 2, size * 2);
    weatherCtx.restore();
  }
}

function drawFog(dt) {
  drawClouds(dt, 0.22);
  const speedFactor = 0.4 + state.wind * 1.25;
  for (const band of fogBands) {
    band.x += band.speed * speedFactor * dt;
    const sprite = fogSprites[band.sprite];
    const drawWidth = sprite.width * band.scale;
    const drawHeight = sprite.height * band.scale;
    if (band.x > width + drawWidth * 0.1) band.x = -drawWidth;
    weatherCtx.globalAlpha = band.alpha * (0.55 + state.intensity * 0.75) * (0.5 + state.mist);
    weatherCtx.drawImage(sprite, band.x, band.y, drawWidth, drawHeight);
    weatherCtx.drawImage(sprite, band.x - drawWidth, band.y, drawWidth, drawHeight);
  }
  weatherCtx.globalAlpha = 1;
  const veil = weatherCtx.createLinearGradient(0, 0, 0, height);
  veil.addColorStop(0, `rgba(210,222,225,${0.04 + state.mist * 0.08})`);
  veil.addColorStop(0.58, `rgba(220,229,230,${0.10 + state.mist * 0.18})`);
  veil.addColorStop(1, `rgba(228,234,234,${0.06 + state.mist * 0.13})`);
  weatherCtx.fillStyle = veil;
  weatherCtx.fillRect(0, 0, width, height);
}

function drawDust(ts, dt) {
  const warm = state.period !== 'night';
  for (const mote of dustMotes) {
    mote.y -= mote.speed * dt;
    mote.x += Math.sin(ts * 0.00034 + mote.phase) * 4 * dt;
    if (mote.y < -10) { mote.y = height + 10; mote.x = random(0, width); }
    weatherCtx.beginPath();
    weatherCtx.fillStyle = warm
      ? `rgba(255,239,194,${mote.alpha})`
      : `rgba(194,221,255,${mote.alpha * 0.72})`;
    weatherCtx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
    weatherCtx.fill();
  }
}

function drawFallbackRain(dt, thunder = false) {
  drawClouds(dt, thunder ? 0.72 : 0.35, thunder);
  const count = Math.floor(65 + state.intensity * 110);
  const wind = 4 + state.wind * 18;
  weatherCtx.lineWidth = 0.8;
  weatherCtx.strokeStyle = `rgba(203,226,240,${0.16 + state.intensity * 0.16})`;
  weatherCtx.beginPath();
  const tick = performance.now() * 0.5;
  for (let index = 0; index < count; index += 1) {
    const x = (seeded(index + 920) * (width + 220) + tick * wind * 0.06) % (width + 220) - 110;
    const y = (seeded(index + 1120) * height + tick * (0.7 + seeded(index) * 1.2)) % (height + 60) - 30;
    weatherCtx.moveTo(x, y);
    weatherCtx.lineTo(x + wind, y + 18 + state.intensity * 24);
  }
  weatherCtx.stroke();
}

function drawRainAtmosphere(dt, thunder = false) {
  const dayFactor = state.period === 'day' ? 1 : state.period === 'dusk' ? 0.72 : 0.46;
  weatherCtx.fillStyle = thunder
    ? `rgba(8,20,34,${0.22 + state.intensity * 0.18})`
    : `rgba(25,48,62,${dayFactor * (0.07 + state.intensity * 0.08)})`;
  weatherCtx.fillRect(0, 0, width, height);
  drawClouds(dt, thunder ? 0.52 : 0.23 + state.intensity * 0.16, thunder);
}

function triggerLightning(ts) {
  if (state.weather !== 'thunder' || ts < nextLightningAt) return;
  lightning.classList.remove('flash');
  void lightning.offsetWidth;
  lightning.classList.add('flash');
  nextLightningAt = ts + random(2300, 6500) / (0.7 + state.intensity * 0.7);
}

function renderWeather(ts, dt) {
  weatherCtx.clearRect(0, 0, width, height);
  switch (state.weather) {
    case 'clear': drawDust(ts, dt); break;
    case 'cloudy': drawClouds(dt, 0.82 + state.intensity * 0.34); break;
    case 'snow': drawSnow(ts, dt); break;
    case 'fog': drawFog(dt); break;
    case 'rain':
      drawRainAtmosphere(dt, false);
      if (rainFailed) drawFallbackRain(dt, false);
      break;
    case 'thunder':
      drawRainAtmosphere(dt, true);
      if (rainFailed) drawFallbackRain(dt, true);
      triggerLightning(ts);
      break;
    default: break;
  }
}

function updateFps(ts) {
  fpsFrames += 1;
  if (!fpsSampleStarted) fpsSampleStarted = ts;
  if (ts - fpsSampleStarted < 900) return;
  const fps = Math.round((fpsFrames * 1000) / (ts - fpsSampleStarted));
  $('fps-status').textContent = `${fps} FPS`;
  fpsFrames = 0;
  fpsSampleStarted = ts;
}

function animate(ts) {
  if (document.hidden) return;
  const interval = 1000 / currentQuality().fps;
  if (lastFrameAt && ts - lastFrameAt < interval) {
    animationHandle = requestAnimationFrame(animate);
    return;
  }
  const dt = Math.min(0.05, lastFrameAt ? (ts - lastFrameAt) / 1000 : 0.016);
  lastFrameAt = ts;
  renderWeather(ts, dt);
  updateFps(ts);
  animationHandle = requestAnimationFrame(animate);
}

function updateRainOptions() {
  if (!rainFx) return;
  const quality = currentQuality();
  rainFx.options.spawnLimit = Math.floor(quality.rainLimit * (0.45 + state.intensity * 0.55));
  rainFx.options.spawnInterval = [0.075 + (1 - state.intensity) * 0.08, 0.14 + (1 - state.intensity) * 0.12];
  rainFx.options.dropletsPerSeconds = Math.floor(quality.droplets * (0.35 + state.intensity * 0.65));
  rainFx.options.slipRate = 0.34 + state.intensity * 0.48;
  rainFx.options.xShifting = [-0.012 - state.wind * 0.035, 0.012 + state.wind * 0.035];
  rainFx.options.mist = state.mist > 0.04;
  rainFx.options.mistColor = state.period === 'dusk'
    ? [0.12, 0.055, 0.045, 0.24 + state.mist * 0.34]
    : [0.018, 0.028, 0.038, 0.24 + state.mist * 0.34];
  rainFx.options.refractBase = 0.2 + state.refraction * 0.28;
  rainFx.options.refractScale = 0.32 + state.refraction * 0.48;
}

function stopRain(destroy = false) {
  if (!rainFx) return;
  try { destroy ? rainFx.destroy() : rainFx.stop(); } catch (error) { console.warn('Rain renderer stop failed', error); }
  if (destroy) rainFx = null;
  rainReady = false;
}

async function startRain(token = transitionToken) {
  rainFailed = false;
  if (typeof window.RaindropFX !== 'function') {
    rainFailed = true;
    $('renderer-status').textContent = 'Canvas 2D 降级';
    return;
  }
  try {
    const quality = currentQuality();
    const rainWidth = Math.max(1, Math.floor(width * quality.rainScale));
    const rainHeight = Math.max(1, Math.floor(height * quality.rainScale));
    rainCanvas.width = rainWidth;
    rainCanvas.height = rainHeight;
    rainCanvas.style.width = `${width}px`;
    rainCanvas.style.height = `${height}px`;
    if (rainFx) {
      stopRain(false);
      rainFx.resize(rainWidth, rainHeight);
      await rainFx.setBackground(baseCanvases[activeBase]);
    } else {
      rainFx = new window.RaindropFX({
        canvas: rainCanvas,
        background: baseCanvases[activeBase],
        spawnLimit: quality.rainLimit,
        spawnSize: [34, 92],
        spawnInterval: [0.08, 0.16],
        slipRate: 0.72,
        motionInterval: [0.8, 2.6],
        xShifting: [-0.03, 0.03],
        trailDropDensity: 0.18,
        trailDropSize: [0.28, 0.44],
        trailDistance: [22, 40],
        backgroundBlurSteps: state.quality === 'eco' ? 1 : 2,
        mist: true,
        mistBlurStep: state.quality === 'high' ? 3 : 2,
        mistTime: 13,
        dropletsPerSeconds: quality.droplets,
        dropletSize: [8, 24],
        smoothRaindrop: [0.965, 0.995],
        raindropCompose: 'smoother',
        raindropDiffuseLight: [0.38, 0.42, 0.46],
        raindropSpecularLight: [0.08, 0.10, 0.12],
      });
    }
    updateRainOptions();
    await rainFx.start();
    if (token !== transitionToken || (state.weather !== 'rain' && state.weather !== 'thunder')) {
      stopRain(false);
      return;
    }
    rainReady = true;
    $('renderer-status').textContent = 'WebGL2 · RaindropFX';
  } catch (error) {
    console.error('RaindropFX initialization failed', error);
    stopRain(true);
    rainFailed = true;
    $('renderer-status').textContent = 'Canvas 2D 降级';
  }
}

function updateLabels() {
  const meta = WEATHER_META[state.weather];
  $('scene-title').textContent = `${PERIOD_LABELS[state.period]} · ${WEATHER_SHORT[state.weather]}`;
  $('weather-name').textContent = meta[0];
  $('weather-detail').textContent = meta[1];
}

function markActive(containerId, attribute, value) {
  document.querySelectorAll(`#${containerId} button[${attribute}]`).forEach(button => {
    button.classList.toggle('is-active', button.getAttribute(attribute) === value);
  });
}

async function switchWeather(nextWeather) {
  if (!WEATHER_META[nextWeather] || nextWeather === state.weather) return;
  const token = ++transitionToken;
  markActive('weather-switch', 'data-weather', nextWeather);
  $('transition-status').textContent = '淡出旧天气';
  weatherCanvas.classList.add('is-muted');
  rainCanvas.classList.remove('is-visible');
  await delay(reducedMotion.matches ? 10 : 360);
  if (token !== transitionToken) return;

  const previousWeather = state.weather;
  if (previousWeather === 'rain' || previousWeather === 'thunder') stopRain(false);
  state.weather = nextWeather;
  rebuildVisuals();
  weatherCtx.clearRect(0, 0, width, height);
  updateLabels();
  nextLightningAt = performance.now() + random(900, 2600);

  $('transition-status').textContent = '准备新天气';
  if (nextWeather === 'rain' || nextWeather === 'thunder') await startRain(token);
  else $('renderer-status').textContent = 'Canvas 2D';
  if (token !== transitionToken) return;

  requestAnimationFrame(() => {
    weatherCanvas.classList.remove('is-muted');
    if ((nextWeather === 'rain' || nextWeather === 'thunder') && !rainFailed) rainCanvas.classList.add('is-visible');
  });
  $('transition-status').textContent = '淡入新天气';
  await delay(reducedMotion.matches ? 10 : 560);
  if (token === transitionToken) $('transition-status').textContent = '稳定';
}

async function switchPeriod(nextPeriod) {
  if (!PERIOD_LABELS[nextPeriod] || nextPeriod === state.period) return;
  const token = ++periodToken;
  markActive('period-switch', 'data-period', nextPeriod);
  $('transition-status').textContent = '淡出天气层';
  weatherCanvas.classList.add('is-muted');
  rainCanvas.classList.remove('is-visible');
  await delay(reducedMotion.matches ? 10 : 360);
  if (token !== periodToken) return;

  state.period = nextPeriod;
  const incomingBase = activeBase === 0 ? 1 : 0;
  renderBase(baseContexts[incomingBase], nextPeriod);
  baseCanvases[incomingBase].classList.add('is-visible');
  baseCanvases[activeBase].classList.remove('is-visible');
  $('transition-status').textContent = '切换环境光';
  await delay(reducedMotion.matches ? 10 : 1260);
  if (token !== periodToken) return;
  activeBase = incomingBase;
  rebuildVisuals();
  updateLabels();

  if (state.weather === 'rain' || state.weather === 'thunder') {
    const rainToken = ++transitionToken;
    stopRain(true);
    await startRain(rainToken);
    if (rainToken !== transitionToken) return;
    if (!rainFailed) rainCanvas.classList.add('is-visible');
  }
  weatherCanvas.classList.remove('is-muted');
  $('transition-status').textContent = '稳定';
}

async function applyQuality(nextQuality) {
  if (!QUALITY[nextQuality] || nextQuality === state.quality) return;
  state.quality = nextQuality;
  markActive('quality-switch', 'data-quality', nextQuality);
  $('transition-status').textContent = '重建渲染器';
  fitScene();
  if (state.weather === 'rain' || state.weather === 'thunder') {
    const token = ++transitionToken;
    rainCanvas.classList.remove('is-visible');
    stopRain(true);
    await startRain(token);
    if (!rainFailed) rainCanvas.classList.add('is-visible');
  }
  $('transition-status').textContent = '稳定';
}

function fitScene() {
  width = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  renderDpr = Math.min(window.devicePixelRatio || 1, currentQuality().dpr);
  for (let index = 0; index < baseCanvases.length; index += 1) setCanvasSize(baseCanvases[index], baseContexts[index], renderDpr);
  setCanvasSize(weatherCanvas, weatherCtx, renderDpr);
  renderBase(baseContexts[activeBase], state.period);
  renderBase(baseContexts[activeBase === 0 ? 1 : 0], state.period);
  rebuildVisuals();
  lastFrameAt = 0;
}

function bindRange(id, key) {
  const input = $(id);
  const output = $(`${id}-value`);
  const apply = () => {
    state[key] = Number(input.value) / 100;
    output.textContent = `${input.value}%`;
    updateRainOptions();
  };
  input.addEventListener('input', apply);
  apply();
}

$('period-switch').addEventListener('click', event => {
  const button = event.target.closest('button[data-period]');
  if (button) switchPeriod(button.dataset.period);
});

$('weather-switch').addEventListener('click', event => {
  const button = event.target.closest('button[data-weather]');
  if (button) switchWeather(button.dataset.weather);
});

$('quality-switch').addEventListener('click', event => {
  const button = event.target.closest('button[data-quality]');
  if (button) applyQuality(button.dataset.quality);
});

$('panel-toggle').addEventListener('click', () => {
  const hidden = $('control-panel').classList.toggle('is-hidden');
  $('panel-toggle').setAttribute('aria-expanded', String(!hidden));
});

bindRange('intensity', 'intensity');
bindRange('wind', 'wind');
bindRange('mist', 'mist');
bindRange('refraction', 'refraction');

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const rainWasActive = state.weather === 'rain' || state.weather === 'thunder';
    if (rainWasActive) {
      rainCanvas.classList.remove('is-visible');
      stopRain(true);
    }
    fitScene();
    if (rainWasActive) {
      const token = ++transitionToken;
      await startRain(token);
      if (!rainFailed) rainCanvas.classList.add('is-visible');
    }
  }, 220);
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (animationHandle) cancelAnimationFrame(animationHandle);
    animationHandle = 0;
    if (rainFx) rainFx.stop();
    return;
  }
  lastFrameAt = 0;
  fpsSampleStarted = 0;
  if ((state.weather === 'rain' || state.weather === 'thunder') && rainFx) {
    try { await rainFx.start(); rainCanvas.classList.add('is-visible'); } catch (error) { rainFailed = true; }
  }
  if (!animationHandle) animationHandle = requestAnimationFrame(animate);
});

fitScene();
updateLabels();
animationHandle = requestAnimationFrame(animate);
