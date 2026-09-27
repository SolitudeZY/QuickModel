'use strict';

function resolveThemePeriod(themeMode, now = new Date()) {
  const mode = String(themeMode || 'auto').toLowerCase();
  if (mode === 'day' || mode === 'dusk' || mode === 'night') return mode;
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'dusk';
  return 'night';
}

const Starfield = (() => {
  const scene = document.getElementById('background-scene');
  const baseCanvases = [
    document.getElementById('background-base-a'),
    document.getElementById('background-base-b'),
  ];
  const baseContexts = baseCanvases.map(canvas => canvas && canvas.getContext('2d'));
  const weatherCanvas = document.getElementById('starfield-canvas');
  const weatherCtx = weatherCanvas && weatherCanvas.getContext('2d', { alpha: true });
  const rainCanvas = document.getElementById('background-rain');
  const lightning = document.getElementById('background-lightning');
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  const QUALITY = {
    eco: { fps: 20, dpr: 0.85, clouds: 4, snow: 120, fog: 5, dust: 24, stars: 110, trails: 280, rainScale: 0.62, rainLimit: 190, droplets: 80 },
    balanced: { fps: 30, dpr: 1.1, clouds: 6, snow: 210, fog: 7, dust: 40, stars: 150, trails: 430, rainScale: 0.76, rainLimit: 360, droplets: 145 },
    high: { fps: 40, dpr: 1.35, clouds: 8, snow: 320, fog: 9, dust: 58, stars: 200, trails: 600, rainScale: 0.9, rainLimit: 560, droplets: 220 },
  };

  let enabled = false;
  let running = false;
  let raf = 0;
  let width = Math.max(1, window.innerWidth);
  let height = Math.max(1, window.innerHeight);
  let renderDpr = 1;
  let activeBase = 0;
  let period = 'night';
  let weather = { weather_code: 0, wind_speed: 3, cloud_cover: 0 };
  let weatherKindValue = 'clear';
  let config = {};
  let qualityName = 'balanced';
  let intensity = 0.7;
  let mist = 0.32;
  let refraction = 0.65;
  let wind = 0.35;
  let lastFrameAt = 0;
  let lastTrailAt = 0;
  let resizeTimer = 0;
  let transitionToken = 0;
  let periodToken = 0;
  let nextLightningAt = 0;
  let rainFx = null;
  let rainFailed = false;

  let stars = [];
  let trailStars = [];
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
  function currentQuality() { return QUALITY[qualityName] || QUALITY.balanced; }

  function weatherKind(code) {
    const value = Number(code);
    if ([95, 96, 99].includes(value)) return 'thunder';
    if ([71, 73, 75, 77, 85, 86].includes(value)) return 'snow';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return 'rain';
    if ([45, 48].includes(value)) return 'fog';
    if ([1, 2, 3].includes(value)) return 'cloudy';
    return 'clear';
  }

  function weatherEffectsEnabled() {
    const preview = config.weather_preview || 'auto';
    const explicitWeather = ['cloudy', 'rain', 'snow', 'fog', 'thunder'].includes(preview);
    return config.weather_enabled !== false || explicitWeather;
  }

  function seeded(index) {
    const value = Math.sin(index * 91.177 + 17.31) * 43758.5453;
    return value - Math.floor(value);
  }

  function setCanvasSize(canvas, context, scale) {
    if (!canvas) return;
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (context) context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function cityPalette(value) {
    if (value === 'day') {
      return {
        layers: ['rgba(101,133,147,0.30)', 'rgba(66,99,116,0.54)', 'rgba(35,65,81,0.82)'],
        windows: ['rgba(205,232,239,0.22)', 'rgba(190,224,235,0.32)', 'rgba(169,211,226,0.38)'],
        reflection: 'rgba(166,213,228,0.18)',
      };
    }
    if (value === 'dusk') {
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

  function drawCityLayer(ctx, value, layer) {
    const palette = cityPalette(value);
    const bases = [0.70, 0.80, 1.01];
    const minWidths = [44, 48, 62];
    const maxWidths = [88, 104, 132];
    const minHeights = [34, 72, 105];
    const maxHeights = [118, 198, 260];
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
        ctx.fillStyle = value === 'night' ? 'rgba(239,90,85,0.76)' : 'rgba(255,214,170,0.48)';
        ctx.arc(x + buildingWidth * 0.5, top - 25, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = palette.layers[layer];
      }

      if (layer > 0) {
        const gapX = layer === 1 ? 11 : 14;
        const gapY = layer === 1 ? 13 : 17;
        const columns = Math.max(1, Math.floor((buildingWidth - 12) / gapX));
        const rows = Math.max(1, Math.floor((buildingHeight - 16) / gapY));
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const chance = seeded(index * 37 + row * 13 + column * 5);
            if (chance < (value === 'night' ? 0.48 : value === 'dusk' ? 0.60 : 0.70)) continue;
            ctx.fillStyle = palette.windows[layer];
            ctx.fillRect(x + 7 + column * gapX, top + 10 + row * gapY, layer === 1 ? 2 : 3, layer === 1 ? 3 : 5);
          }
        }
        ctx.fillStyle = palette.layers[layer];
      }
      x += buildingWidth + 4 + seeded(index + 43) * 10;
      index += 1;
    }
  }

  function drawStaticStars(ctx) {
    for (let index = 0; index < 130; index += 1) {
      const x = seeded(index + 220) * width;
      const y = seeded(index + 340) * height * 0.62;
      const size = 0.4 + seeded(index + 510) * 1.3;
      ctx.beginPath();
      ctx.fillStyle = `rgba(222,235,255,${0.22 + seeded(index + 620) * 0.44})`;
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRainNeon(ctx, value, atmosphere) {
    if (!['rain', 'thunder'].includes(atmosphere)) return;
    const colors = value === 'dusk'
      ? [[255,105,118],[255,174,92],[102,218,224]]
      : [[63,218,255],[255,71,164],[255,196,78]];
    const signCount = Math.max(10, Math.min(24, Math.round(width / 70)));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let index = 0; index < signCount; index += 1) {
      const color = colors[index % colors.length];
      const x = seeded(index + 1401) * width;
      const y = height * (0.56 + seeded(index + 1421) * 0.24);
      const signWidth = 22 + seeded(index + 1441) * 48;
      const signHeight = 4 + seeded(index + 1461) * 8;
      const alpha = (value === 'day' ? 0.52 : 0.74) + seeded(index + 1481) * 0.18;

      ctx.shadowColor = `rgba(${color.join(',')},0.86)`;
      ctx.shadowBlur = 15 + seeded(index + 1501) * 17;
      ctx.fillStyle = `rgba(${color.join(',')},${alpha})`;
      ctx.fillRect(x, y, signWidth, signHeight);
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.62})`;
      ctx.fillRect(x + 2, y + 1, Math.max(2, signWidth - 4), Math.max(1, signHeight - 2));

      const reflectionTop = Math.max(y + signHeight + 4, height * 0.69);
      const reflectionHeight = height - reflectionTop;
      const reflectionX = x + signWidth * (0.25 + seeded(index + 1521) * 0.5);
      ctx.shadowBlur = 18;
      for (let segment = 0; segment < 6; segment += 1) {
        const progress = segment / 6;
        const segmentY = reflectionTop + reflectionHeight * progress;
        const segmentHeight = Math.max(5, reflectionHeight * (0.055 + seeded(index * 17 + segment) * 0.05));
        const segmentWidth = (10 + seeded(index * 29 + segment) * 22) * (1 - progress * 0.36);
        ctx.fillStyle = `rgba(${color.join(',')},${alpha * (0.54 - progress * 0.39)})`;
        ctx.fillRect(reflectionX - segmentWidth * 0.5, segmentY, segmentWidth, segmentHeight);
      }

      const reflected = ctx.createLinearGradient(0, reflectionTop, 0, height);
      reflected.addColorStop(0, `rgba(${color.join(',')},${alpha * 0.34})`);
      reflected.addColorStop(0.46, `rgba(${color.join(',')},${alpha * 0.12})`);
      reflected.addColorStop(1, `rgba(${color.join(',')},0)`);
      ctx.shadowBlur = 24;
      ctx.fillStyle = reflected;
      ctx.fillRect(reflectionX - 5, reflectionTop, 10, reflectionHeight);
    }

    const horizonGlow = ctx.createLinearGradient(0, height * 0.60, 0, height * 0.88);
    horizonGlow.addColorStop(0, 'rgba(69,205,238,0)');
    horizonGlow.addColorStop(0.48, value === 'dusk' ? 'rgba(255,105,126,0.12)' : 'rgba(69,205,238,0.11)');
    horizonGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.shadowBlur = 0;
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, height * 0.60, width, height * 0.28);
    ctx.restore();
  }

  function drawCelestialGlow(ctx, value) {
    const isDay = value === 'day';
    const x = isDay ? width * 0.76 : value === 'dusk' ? width * 0.72 : width * 0.78;
    const y = isDay ? height * 0.18 : value === 'dusk' ? height * 0.34 : height * 0.16;
    const color = isDay ? [255, 231, 170] : value === 'dusk' ? [255, 151, 102] : [183, 211, 237];
    const radius = Math.max(width, height) * (isDay ? 0.36 : 0.25);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(${color.join(',')},${isDay ? 0.54 : 0.36})`);
    glow.addColorStop(0.14, `rgba(${color.join(',')},0.17)`);
    glow.addColorStop(1, `rgba(${color.join(',')},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    ctx.fillStyle = `rgba(${color.join(',')},${value === 'night' ? 0.72 : 0.86})`;
    ctx.arc(x, y, value === 'night' ? 17 : 28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSkyline(ctx, value, atmosphere) {
    const palette = cityPalette(value);
    drawCityLayer(ctx, value, 0);
    const haze = ctx.createLinearGradient(0, height * 0.50, 0, height * 0.78);
    haze.addColorStop(0, 'rgba(255,255,255,0)');
    haze.addColorStop(0.52, value === 'dusk' ? 'rgba(244,177,151,0.12)' : 'rgba(184,211,221,0.10)');
    haze.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, height * 0.48, width, height * 0.34);
    drawCityLayer(ctx, value, 1);
    drawCityLayer(ctx, value, 2);

    if (value !== 'day') {
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
    drawRainNeon(ctx, value, atmosphere);
  }

  function renderBase(ctx, value, atmosphere = weatherKindValue) {
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const colors = value === 'day'
      ? ['#86bed8', '#c7dce4', '#eef1eb']
      : value === 'dusk' ? ['#485673', '#c77d78', '#f0b07e'] : ['#07111e', '#12283b', '#294053'];
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, colors[0]);
    sky.addColorStop(0.58, colors[1]);
    sky.addColorStop(1, colors[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    if (value === 'night') drawStaticStars(ctx);
    drawCelestialGlow(ctx, value);
    drawSkyline(ctx, value, atmosphere);
    const lowerHaze = ctx.createLinearGradient(0, height * 0.54, 0, height);
    lowerHaze.addColorStop(0, 'rgba(255,255,255,0)');
    lowerHaze.addColorStop(1, value === 'night' ? 'rgba(5,12,20,0.48)' : 'rgba(224,235,235,0.30)');
    ctx.fillStyle = lowerHaze;
    ctx.fillRect(0, height * 0.5, width, height * 0.5);
    ctx.restore();
  }

  function makeCloudSprite(value, storm = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 230;
    const ctx = canvas.getContext('2d');
    const color = storm
      ? (value === 'dusk' ? [83, 69, 79] : [45, 63, 78])
      : value === 'day' ? [236, 245, 246] : value === 'dusk' ? [212, 177, 176] : [109, 135, 156];
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
    if (kind === 1) ctx.ellipse(0, 0, 4.2, 12.5, -0.28, 0, Math.PI * 2);
    else {
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
    cloudSprite = makeCloudSprite(period);
    stormCloudSprite = makeCloudSprite(period, true);
    fogSprites = [makeFogSprite(0), makeFogSprite(0.6), makeFogSprite(1)];
    snowSprites = [makeSnowSprite(0), makeSnowSprite(1), makeSnowSprite(2)];
    clouds = Array.from({ length: quality.clouds }, (_, index) => ({
      x: random(-width * 0.35, width), y: random(height * 0.04, height * 0.48),
      scale: random(0.42, 0.94), speed: random(5, 13), alpha: random(0.18, 0.42), phase: index * 1.37,
    }));
    snowflakes = Array.from({ length: quality.snow }, () => ({
      x: random(-30, width + 30), y: random(-height, height), depth: random(0.15, 1),
      size: random(5, 18), speed: random(18, 72), sway: random(6, 28), phase: random(0, Math.PI * 2),
      spin: random(-1, 1), sprite: Math.floor(random(0, 3)),
    }));
    fogBands = Array.from({ length: quality.fog }, (_, index) => ({
      x: random(-width, width),
      y: height * (0.18 + (index / Math.max(1, quality.fog - 1)) * 0.62) + random(-45, 45),
      scale: random(0.7, 1.35), speed: random(3, 9), alpha: random(0.10, 0.24), sprite: index % 3,
    }));
    dustMotes = Array.from({ length: quality.dust }, () => ({
      x: random(0, width), y: random(0, height), size: random(0.7, 2.8),
      speed: random(2, 8), phase: random(0, Math.PI * 2), alpha: random(0.12, 0.38),
    }));
    const colors = [[122,162,247],[125,207,255],[238,212,159],[229,233,255]];
    stars = Array.from({ length: quality.stars }, () => ({
      x: random(0, width), y: random(0, height * 0.65), r: random(0.55, 1.8), phase: random(0, Math.PI * 2),
      speed: random(0.00045, 0.00125), color: colors[Math.floor(random(0, colors.length))], glow: Math.random() > 0.52,
    }));
    const cx = width * 1.1;
    const cy = height * 1.14;
    const nearR = Math.hypot(cx - width, cy - height) * 0.78;
    const farR = Math.hypot(cx, cy);
    trailStars = Array.from({ length: quality.trails }, () => ({
      radius: nearR + Math.pow(Math.random(), 0.82) * (farR - nearR), theta: random(0, Math.PI * 2),
      r: random(0.45, 1.35), alpha: random(0.30, 0.82), angularSpeed: random(0.000012, 0.000058),
      color: colors[Math.floor(random(0, colors.length))],
    }));
  }

  function drawClouds(dt, strength = 1, storm = false) {
    const sprite = storm ? stormCloudSprite : cloudSprite;
    if (!sprite) return;
    const speedFactor = 0.45 + wind * 1.6;
    for (const cloud of clouds) {
      cloud.x += cloud.speed * speedFactor * dt;
      const drawWidth = sprite.width * cloud.scale;
      const drawHeight = sprite.height * cloud.scale;
      if (cloud.x > width + drawWidth * 0.25) cloud.x = -drawWidth - random(30, 180);
      weatherCtx.globalAlpha = clamp(cloud.alpha * strength * (storm ? 1.35 : 1), 0, 0.68);
      weatherCtx.drawImage(sprite, cloud.x, cloud.y + Math.sin(performance.now() * 0.00018 + cloud.phase) * 3, drawWidth, drawHeight);
    }
    weatherCtx.globalAlpha = 1;
  }

  function drawSnow(ts, dt) {
    drawClouds(dt, 0.34);
    const windOffset = (wind - 0.35) * 62;
    const visibleCount = Math.floor(snowflakes.length * (0.38 + intensity * 0.62));
    for (let index = 0; index < visibleCount; index += 1) {
      const flake = snowflakes[index];
      const depthSpeed = 0.42 + flake.depth * 0.9;
      flake.y += flake.speed * depthSpeed * dt;
      flake.x += (windOffset * depthSpeed + Math.sin(ts * 0.00065 + flake.phase) * flake.sway) * dt;
      if (flake.y > height + 40) { flake.y = random(-100, -20); flake.x = random(-30, width + 30); }
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
    const speedFactor = 0.4 + wind * 1.25;
    for (const band of fogBands) {
      band.x += band.speed * speedFactor * dt;
      const sprite = fogSprites[band.sprite];
      const drawWidth = sprite.width * band.scale;
      const drawHeight = sprite.height * band.scale;
      if (band.x > width + drawWidth * 0.1) band.x = -drawWidth;
      weatherCtx.globalAlpha = band.alpha * (0.55 + intensity * 0.75) * (0.5 + mist);
      weatherCtx.drawImage(sprite, band.x, band.y, drawWidth, drawHeight);
      weatherCtx.drawImage(sprite, band.x - drawWidth, band.y, drawWidth, drawHeight);
    }
    weatherCtx.globalAlpha = 1;
    const veil = weatherCtx.createLinearGradient(0, 0, 0, height);
    veil.addColorStop(0, `rgba(210,222,225,${0.04 + mist * 0.08})`);
    veil.addColorStop(0.58, `rgba(220,229,230,${0.10 + mist * 0.18})`);
    veil.addColorStop(1, `rgba(228,234,234,${0.06 + mist * 0.13})`);
    weatherCtx.fillStyle = veil;
    weatherCtx.fillRect(0, 0, width, height);
  }

  function drawDust(ts, dt) {
    const warm = period !== 'night';
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

  function drawTwinkle(ts) {
    for (const star of stars) {
      const pulse = (Math.sin(ts * star.speed + star.phase) + 1) / 2;
      const alpha = 0.18 + pulse * 0.72;
      const [r, g, b] = star.color;
      if (star.glow) {
        const halo = weatherCtx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 5);
        halo.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.24})`);
        halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
        weatherCtx.fillStyle = halo;
        weatherCtx.fillRect(star.x - star.r * 5, star.y - star.r * 5, star.r * 10, star.r * 10);
      }
      weatherCtx.beginPath();
      weatherCtx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      weatherCtx.arc(star.x, star.y, star.r * (0.75 + pulse * 0.45), 0, Math.PI * 2);
      weatherCtx.fill();
    }
  }

  function drawTrails(ts) {
    if (!lastTrailAt) lastTrailAt = ts;
    const dt = Math.min(40, ts - lastTrailAt);
    lastTrailAt = ts;
    weatherCtx.save();
    weatherCtx.globalCompositeOperation = 'destination-out';
    weatherCtx.fillStyle = 'rgba(0,0,0,0.058)';
    weatherCtx.fillRect(0, 0, width, height);
    weatherCtx.restore();
    const cx = width * 1.1;
    const cy = height * 1.14;
    for (const star of trailStars) {
      star.theta = (star.theta + dt * star.angularSpeed) % (Math.PI * 2);
      const x = cx + Math.cos(star.theta) * star.radius;
      const y = cy + Math.sin(star.theta) * star.radius;
      if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
      const [r, g, b] = star.color;
      weatherCtx.beginPath();
      weatherCtx.fillStyle = `rgba(${r},${g},${b},${star.alpha})`;
      weatherCtx.arc(x, y, star.r, 0, Math.PI * 2);
      weatherCtx.fill();
    }
  }

  function drawFallbackRain(dt, thunder = false) {
    drawClouds(dt, thunder ? 0.72 : 0.35, thunder);
    const count = Math.floor(65 + intensity * 110);
    const windOffset = 4 + wind * 18;
    weatherCtx.lineWidth = 0.8;
    weatherCtx.strokeStyle = `rgba(203,226,240,${0.16 + intensity * 0.16})`;
    weatherCtx.beginPath();
    const tick = performance.now() * 0.5;
    for (let index = 0; index < count; index += 1) {
      const x = (seeded(index + 920) * (width + 220) + tick * windOffset * 0.06) % (width + 220) - 110;
      const y = (seeded(index + 1120) * height + tick * (0.7 + seeded(index) * 1.2)) % (height + 60) - 30;
      weatherCtx.moveTo(x, y);
      weatherCtx.lineTo(x + windOffset, y + 18 + intensity * 24);
    }
    weatherCtx.stroke();
  }

  function drawRainAtmosphere(dt, thunder = false) {
    const dayFactor = period === 'day' ? 1 : period === 'dusk' ? 0.72 : 0.46;
    weatherCtx.fillStyle = thunder
      ? `rgba(8,20,34,${0.22 + intensity * 0.18})`
      : `rgba(25,48,62,${dayFactor * (0.07 + intensity * 0.08)})`;
    weatherCtx.fillRect(0, 0, width, height);
    drawClouds(dt, thunder ? 0.52 : 0.23 + intensity * 0.16, thunder);
  }

  function drawRainNeonBloom(ts, thunder = false) {
    const colors = period === 'dusk'
      ? [[255,105,118],[255,174,92],[102,218,224]]
      : [[63,218,255],[255,71,164],[255,196,78]];
    weatherCtx.save();
    weatherCtx.globalCompositeOperation = 'screen';
    for (let index = 0; index < 7; index += 1) {
      const color = colors[index % colors.length];
      const x = seeded(index + 1701) * width;
      const y = height * (0.66 + seeded(index + 1721) * 0.25);
      const radius = 46 + seeded(index + 1741) * 92;
      const pulse = 0.92 + Math.sin(ts * 0.00035 + index * 1.7) * 0.08;
      const alpha = (thunder ? 0.10 : 0.14) * pulse * (0.72 + intensity * 0.28);
      const glow = weatherCtx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgba(${color.join(',')},${alpha})`);
      glow.addColorStop(0.28, `rgba(${color.join(',')},${alpha * 0.52})`);
      glow.addColorStop(1, `rgba(${color.join(',')},0)`);
      weatherCtx.fillStyle = glow;
      weatherCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    weatherCtx.restore();
  }

  function triggerLightning(ts) {
    if (weatherKindValue !== 'thunder' || ts < nextLightningAt || !lightning) return;
    lightning.classList.remove('flash');
    void lightning.offsetWidth;
    lightning.classList.add('flash');
    nextLightningAt = ts + random(2300, 6500) / (0.7 + intensity * 0.7);
  }

  function clearWeather() {
    if (!weatherCtx) return;
    weatherCtx.clearRect(0, 0, width, height);
  }

  function renderWeather(ts, dt) {
    const trailsActive = weatherKindValue === 'clear' && period === 'night' && config.starfield_mode === 'trails';
    if (!trailsActive) clearWeather();
    switch (weatherKindValue) {
      case 'clear':
        if (period === 'night') trailsActive ? drawTrails(ts) : drawTwinkle(ts);
        else drawDust(ts, dt);
        break;
      case 'cloudy': drawClouds(dt, 0.82 + intensity * 0.34); break;
      case 'snow': drawSnow(ts, dt); break;
      case 'fog': drawFog(dt); break;
      case 'rain':
        drawRainAtmosphere(dt, false);
        drawRainNeonBloom(ts, false);
        if (rainFailed) drawFallbackRain(dt, false);
        break;
      case 'thunder':
        drawRainAtmosphere(dt, true);
        drawRainNeonBloom(ts, true);
        if (rainFailed) drawFallbackRain(dt, true);
        triggerLightning(ts);
        break;
      default: break;
    }
  }

  function updateRainOptions() {
    if (!rainFx) return;
    const quality = currentQuality();
    const highlight = 0.38 + refraction * 0.42;
    rainFx.options.spawnLimit = Math.floor(quality.rainLimit * (0.45 + intensity * 0.55));
    rainFx.options.spawnInterval = [0.075 + (1 - intensity) * 0.08, 0.14 + (1 - intensity) * 0.12];
    rainFx.options.dropletsPerSeconds = Math.floor(quality.droplets * (0.35 + intensity * 0.65));
    rainFx.options.slipRate = 0.34 + intensity * 0.48;
    rainFx.options.xShifting = [-0.012 - wind * 0.035, 0.012 + wind * 0.035];
    rainFx.options.mist = mist > 0.04;
    rainFx.options.mistColor = period === 'dusk'
      ? [0.12, 0.055, 0.045, 0.24 + mist * 0.34]
      : [0.018, 0.028, 0.038, 0.24 + mist * 0.34];
    rainFx.options.refractBase = 0.2 + refraction * 0.28;
    rainFx.options.refractScale = 0.32 + refraction * 0.48;
    rainFx.options.raindropLightPos = period === 'dusk' ? [-0.65, 0.72, 2.2, 0] : [-0.9, 0.95, 2.4, 0];
    rainFx.options.raindropDiffuseLight = period === 'dusk'
      ? [0.48 + refraction * 0.12, 0.34 + refraction * 0.10, 0.30 + refraction * 0.08]
      : [0.44 + refraction * 0.14, 0.50 + refraction * 0.14, 0.58 + refraction * 0.16];
    rainFx.options.raindropSpecularLight = period === 'dusk'
      ? [highlight, highlight * 0.72, highlight * 0.58]
      : [highlight * 0.76, highlight * 0.9, highlight];
    rainFx.options.raindropSpecularShininess = Math.round(104 - refraction * 52);
    rainFx.options.raindropLightBump = 1.15 + refraction * 0.85;
    rainFx.options.raindropShadowOffset = 0.82 + refraction * 0.16;
  }

  function stopRain(destroy = false) {
    if (!rainFx) return;
    try { destroy ? rainFx.destroy() : rainFx.stop(); } catch (error) { console.warn('Rain renderer stop failed', error); }
    if (destroy) rainFx = null;
  }

  async function startRain(token = transitionToken) {
    rainFailed = false;
    if (!rainCanvas || typeof window.RaindropFX !== 'function' || (reducedMotion && reducedMotion.matches)) {
      rainFailed = true;
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
          backgroundBlurSteps: qualityName === 'eco' ? 1 : 2,
          mist: true,
          mistBlurStep: qualityName === 'high' ? 3 : 2,
          mistTime: 13,
          dropletsPerSeconds: quality.droplets,
          dropletSize: [8, 24],
          smoothRaindrop: [0.965, 0.995],
          raindropCompose: 'smoother',
          raindropLightPos: [-0.9, 0.95, 2.4, 0],
          raindropDiffuseLight: [0.52, 0.58, 0.68],
          raindropShadowOffset: 0.92,
          raindropSpecularLight: [0.48, 0.58, 0.66],
          raindropSpecularShininess: 68,
          raindropLightBump: 1.7,
        });
      }
      updateRainOptions();
      await rainFx.start();
      if (token !== transitionToken || !['rain', 'thunder'].includes(weatherKindValue) || !enabled) {
        stopRain(false);
        return;
      }
      rainCanvas.classList.add('is-visible');
    } catch (error) {
      console.warn('RaindropFX unavailable; using Canvas fallback', error);
      stopRain(true);
      rainFailed = true;
    }
  }

  function frame(ts) {
    if (!running || !enabled) return;
    const interval = 1000 / currentQuality().fps;
    if (lastFrameAt && ts - lastFrameAt < interval) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, lastFrameAt ? (ts - lastFrameAt) / 1000 : 0.016);
    lastFrameAt = ts;
    renderWeather(ts, dt);
    if (!reducedMotion || !reducedMotion.matches) raf = requestAnimationFrame(frame);
  }

  function resize() {
    if (!scene || !weatherCtx) return;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    renderDpr = Math.min(window.devicePixelRatio || 1, currentQuality().dpr);
    baseCanvases.forEach((canvas, index) => setCanvasSize(canvas, baseContexts[index], renderDpr));
    setCanvasSize(weatherCanvas, weatherCtx, renderDpr);
    renderBase(baseContexts[activeBase], period, weatherKindValue);
    renderBase(baseContexts[activeBase === 0 ? 1 : 0], period, weatherKindValue);
    rebuildVisuals();
    clearWeather();
    lastTrailAt = 0;
  }

  async function switchWeather(nextKind) {
    const token = ++transitionToken;
    if (weatherCanvas) weatherCanvas.classList.add('is-muted');
    if (rainCanvas) rainCanvas.classList.remove('is-visible');
    await delay(reducedMotion && reducedMotion.matches ? 10 : 340);
    if (token !== transitionToken || !enabled) return;

    if (['rain', 'thunder'].includes(weatherKindValue)) stopRain(false);
    weatherKindValue = 'clear';
    clearWeather();
    lastTrailAt = 0;
    weatherKindValue = nextKind;
    const incomingBase = activeBase === 0 ? 1 : 0;
    renderBase(baseContexts[incomingBase], period, nextKind);
    baseCanvases[incomingBase].classList.add('is-visible');
    baseCanvases[activeBase].classList.remove('is-visible');
    rebuildVisuals();
    nextLightningAt = performance.now() + random(900, 2600);
    await delay(reducedMotion && reducedMotion.matches ? 10 : 980);
    if (token !== transitionToken || !enabled) return;
    activeBase = incomingBase;
    renderBase(baseContexts[activeBase === 0 ? 1 : 0], period, nextKind);
    if (['rain', 'thunder'].includes(nextKind)) await startRain(token);
    if (token !== transitionToken || !enabled) return;

    requestAnimationFrame(() => {
      if (weatherCanvas) weatherCanvas.classList.remove('is-muted');
      if (rainCanvas && ['rain', 'thunder'].includes(nextKind) && !rainFailed) rainCanvas.classList.add('is-visible');
    });
  }

  async function switchPeriod(nextPeriod) {
    const token = ++periodToken;
    if (!enabled) { period = nextPeriod; return; }
    if (weatherCanvas) weatherCanvas.classList.add('is-muted');
    if (rainCanvas) rainCanvas.classList.remove('is-visible');
    await delay(reducedMotion && reducedMotion.matches ? 10 : 320);
    if (token !== periodToken || !enabled) return;

    period = nextPeriod;
    const incomingBase = activeBase === 0 ? 1 : 0;
    renderBase(baseContexts[incomingBase], period, weatherKindValue);
    baseCanvases[incomingBase].classList.add('is-visible');
    baseCanvases[activeBase].classList.remove('is-visible');
    await delay(reducedMotion && reducedMotion.matches ? 10 : 1260);
    if (token !== periodToken || !enabled) return;

    activeBase = incomingBase;
    rebuildVisuals();
    clearWeather();
    lastTrailAt = 0;
    if (['rain', 'thunder'].includes(weatherKindValue)) {
      const rainToken = ++transitionToken;
      stopRain(true);
      await startRain(rainToken);
    }
    if (weatherCanvas) weatherCanvas.classList.remove('is-muted');
  }

  function stop() {
    enabled = false;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastFrameAt = 0;
    lastTrailAt = 0;
    transitionToken += 1;
    periodToken += 1;
    stopRain(true);
    clearWeather();
    if (rainCanvas) rainCanvas.classList.remove('is-visible');
    if (scene) scene.classList.remove('is-active');
    document.documentElement.dataset.starfield = 'off';
    document.documentElement.dataset.weather = 'clear';
  }

  function apply(nextConfig) {
    if (!scene || !weatherCtx || !baseContexts.every(Boolean)) return;
    const wasEnabled = enabled;
    const previousQuality = qualityName;
    config = nextConfig || {};
    enabled = config.starfield_enabled === true;
    qualityName = QUALITY[config.background_quality] ? config.background_quality : 'balanced';
    intensity = clamp(Number(config.weather_intensity ?? 70) / 100, 0.2, 1);
    mist = clamp(Number(config.weather_mist ?? 32) / 100, 0, 1);
    refraction = clamp(Number(config.weather_refraction ?? 65) / 100, 0.2, 1);
    const nextPeriod = document.documentElement.dataset.period || resolveThemePeriod(config.theme_mode);
    if (!enabled) { stop(); return; }

    document.documentElement.dataset.starfield = 'on';
    scene.classList.add('is-active');
    if (!wasEnabled) {
      period = nextPeriod;
      resize();
    } else if (previousQuality !== qualityName) {
      resize();
      if (['rain', 'thunder'].includes(weatherKindValue)) {
        stopRain(true);
        startRain(++transitionToken);
      }
    }
    if (period !== nextPeriod) switchPeriod(nextPeriod);
    updateRainOptions();
    running = true;
    lastFrameAt = 0;
    if (!raf && (!reducedMotion || !reducedMotion.matches)) raf = requestAnimationFrame(frame);
    if (reducedMotion && reducedMotion.matches) frame(performance.now());
  }

  function setWeather(data) {
    weather = weatherEffectsEnabled() && data && data.ok
      ? data : { weather_code: 0, wind_speed: 3, cloud_cover: 0 };
    wind = clamp(Number(weather.wind_speed || 3) / 24, 0.08, 1);
    const nextKind = weatherEffectsEnabled() ? weatherKind(weather.weather_code) : 'clear';
    document.documentElement.dataset.weather = nextKind;
    if (nextKind !== weatherKindValue && enabled) switchWeather(nextKind);
    else {
      weatherKindValue = nextKind;
      updateRainOptions();
      if (enabled) { clearWeather(); lastFrameAt = 0; lastTrailAt = 0; }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!enabled) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      running = false;
      if (rainFx) rainFx.stop();
    } else {
      running = true;
      lastFrameAt = 0;
      if (rainFx && ['rain', 'thunder'].includes(weatherKindValue)) {
        rainFx.start().then(() => rainCanvas && rainCanvas.classList.add('is-visible')).catch(() => { rainFailed = true; });
      }
      if (!reducedMotion || !reducedMotion.matches) raf = requestAnimationFrame(frame);
      else frame(performance.now());
    }
  });

  window.addEventListener('resize', () => {
    if (!enabled) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const hadRain = ['rain', 'thunder'].includes(weatherKindValue);
      if (rainCanvas) rainCanvas.classList.remove('is-visible');
      if (hadRain) stopRain(true);
      resize();
      if (hadRain) startRain(++transitionToken);
    }, 220);
  });

  return { apply, setWeather, stop };
})();

function applyStarfieldSettings(config) { Starfield.apply(config || {}); }
function setStarfieldWeather(data) { Starfield.setWeather(data || {}); }
