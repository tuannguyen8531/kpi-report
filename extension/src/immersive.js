/**
 * KPI Studio V2 Ultra - Immersive Wide-Screen Controller
 * Integrates dynamic canvas VFX, bento layout, realtime data sync, and reports
 */

import {
  today,
  addDays,
  parseDay,
  periods,
  timeAllocation,
  projectName,
  validateConfig,
} from './core.js';

import {
  dailyReport,
  selectPersonalTasks,
  taskStatus,
} from './tasks.js';

import {
  generateExcelWorkbook,
} from './excel.js';

import {
  validateOdooConfig,
  ODOO_TIMES,
  formatHoursMinutes,
} from './odoo.js';

// DOM Selector shortcut
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global application state
let currentDay = today();
let currentSnapshot = null;
let currentTasksSnapshot = null;
let currentOdooSnapshot = null;
let currentSettings = null;
let tasksFilter = { search: '', project: '', status: 'all' };
let editingLeaveId = null;
let leaveFilterMode = 'month';

// ==========================================================================
// 1. ATMOSPHERIC CANVAS VFX ENGINE
// ==========================================================================
const VFX_THEME_NAMES = {
  sakura: 'Xuân Sắc Anh Đào (Sáng)',
  cyber: 'Cyberpunk Neon (Tối)',
  rain: 'Cyberpunk Neon (Tối)',
  bamboo: 'Thanh Trúc Thúy Lộc (Sáng)',
  sun: 'Thanh Trúc Thúy Lộc (Sáng)',
  aurora: 'Dạ Nguyệt Cực Quang (Đêm)',
  off: 'Tối Giản / Stealth (Tắt hiệu ứng)'
};

const THEME_ALIASES = {
  rain: 'cyber',
  sun: 'bamboo'
};

class VFXEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = 'sakura';
    this.particles = [];
    this.animId = null;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.isRunning = false;

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);

    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stop();
      } else if (this.theme !== 'off') {
        this.start();
      }
    });

    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.initParticles();
  }

  setTheme(theme) {
    const resolvedTheme = THEME_ALIASES[theme] || theme;
    this.theme = resolvedTheme;
    document.body.className = `theme-${resolvedTheme}`;
    document.querySelectorAll('.vfx-btn').forEach(btn => {
      const btnTheme = btn.dataset.theme;
      const isActive = btnTheme === resolvedTheme || btnTheme === theme;
      btn.classList.toggle('active', isActive);
      const name = VFX_THEME_NAMES[btnTheme] || '';
      btn.title = isActive ? `${name} (Đang kích hoạt)` : name;
    });
    chrome.storage.local.set({ immersive_theme: resolvedTheme }).catch(() => {});

    if (resolvedTheme === 'off') {
      this.stop();
      this.ctx.clearRect(0, 0, this.width, this.height);
    } else {
      this.initParticles();
      this.start();
    }
  }

  initParticles() {
    this.particles = [];
    if (this.theme === 'sakura') {
      const count = Math.min(50, Math.floor(this.width / 28));
      for (let i = 0; i < count; i++) {
        const isNear = Math.random() > 0.65; // Foreground depth layer
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          size: isNear ? (Math.random() * 5 + 11) : (Math.random() * 4 + 7),
          speedY: isNear ? (Math.random() * 0.9 + 1.0) : (Math.random() * 0.7 + 0.6),
          speedX: isNear ? (Math.random() * 1.3 + 0.7) : (Math.random() * 0.9 + 0.4),
          angle: Math.random() * Math.PI * 2,
          angularSpeed: (Math.random() - 0.5) * 0.025,
          flip: Math.random() * Math.PI,
          flipSpeed: Math.random() * 0.025 + 0.01,
          opacity: isNear ? (Math.random() * 0.25 + 0.65) : (Math.random() * 0.25 + 0.45),
          color: Math.random() > 0.45 ? '#fbcfe8' : '#f472b6',
          isNear,
        });
      }
    } else if (this.theme === 'cyber' || this.theme === 'rain') {
      const count = Math.min(130, Math.floor(this.width / 12));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * (this.width + 200) - 100,
          y: Math.random() * this.height,
          length: Math.random() * 24 + 18,
          speedY: Math.random() * 12 + 16,
          speedX: -3.5,
          color: Math.random() > 0.3 ? 'rgba(0, 240, 255, 0.65)' : 'rgba(192, 132, 252, 0.65)',
        });
      }
      this.ripples = [];
    } else if (this.theme === 'bamboo' || this.theme === 'sun') {
      const count = Math.min(45, Math.floor(this.width / 30));
      const bambooColors = ['#059669', '#10b981', '#34d399', '#15803d', '#65a30d', '#4ade80'];
      for (let i = 0; i < count; i++) {
        const isNear = Math.random() > 0.65;
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          length: isNear ? (Math.random() * 10 + 26) : (Math.random() * 8 + 18),
          width: isNear ? (Math.random() * 3 + 7) : (Math.random() * 2 + 5),
          speedY: isNear ? (Math.random() * 0.8 + 1.1) : (Math.random() * 0.6 + 0.7),
          speedX: isNear ? (Math.random() * 1.2 + 0.8) : (Math.random() * 0.8 + 0.5),
          angle: Math.random() * Math.PI * 2,
          angularSpeed: (Math.random() - 0.5) * 0.03,
          flip: Math.random() * Math.PI,
          flipSpeed: Math.random() * 0.025 + 0.012,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: Math.random() * 0.02 + 0.01,
          opacity: isNear ? (Math.random() * 0.25 + 0.68) : (Math.random() * 0.25 + 0.48),
          color: bambooColors[Math.floor(Math.random() * bambooColors.length)],
          isNear,
        });
      }
    } else if (this.theme === 'aurora') {
      this.stars = [];
      const starCount = Math.min(85, Math.floor(this.width / 18));
      const starColors = ['#ffffff', '#e0f2fe', '#fae8ff', '#fef08a', '#93c5fd'];
      for (let i = 0; i < starCount; i++) {
        const isHero = i < 6; // 6 prominent hero stars with diffraction spikes
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * (this.height * 0.85),
          radius: isHero ? (Math.random() * 1.2 + 1.8) : (Math.random() * 1.2 + 0.4),
          baseAlpha: isHero ? (Math.random() * 0.3 + 0.7) : (Math.random() * 0.6 + 0.2),
          twinkleSpeed: Math.random() * 0.03 + 0.01,
          phase: Math.random() * Math.PI * 2,
          color: starColors[Math.floor(Math.random() * starColors.length)],
          isHero,
        });
      }
      this.meteors = [];
      this.meteorTimer = Math.floor(Math.random() * 120 + 80);
      this.auroraTime = 0;
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  loop() {
    if (!this.isRunning) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (this.theme === 'sakura') {
      this.renderSakura();
    } else if (this.theme === 'cyber' || this.theme === 'rain') {
      this.renderRain();
    } else if (this.theme === 'bamboo' || this.theme === 'sun') {
      this.renderBamboo();
    } else if (this.theme === 'aurora') {
      this.renderAurora();
    }

    this.animId = requestAnimationFrame(this.loop);
  }

  renderSakura() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.y += p.speedY;
      p.x += Math.sin(p.angle) * 1.2 + p.speedX;
      p.angle += p.angularSpeed;
      p.flip += p.flipSpeed;

      if (p.y > this.height + 25) {
        p.y = -25;
        p.x = Math.random() * (this.width + 100) - 50;
      }
      if (p.x > this.width + 25) {
        p.x = -25;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(1, Math.cos(p.flip));
      ctx.globalAlpha = p.opacity;

      // Soft shadow for foreground floating illusion
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = p.isNear ? 5 : 2.5;
      ctx.shadowOffsetY = p.isNear ? 2.5 : 1;

      // Natural cherry blossom petal silhouette with notch
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.8);
      ctx.bezierCurveTo(-s * 0.7, s * 0.3, -s * 0.7, -s * 0.6, -s * 0.15, -s * 0.8);
      ctx.quadraticCurveTo(0, -s * 0.65, s * 0.15, -s * 0.8);
      ctx.bezierCurveTo(s * 0.7, -s * 0.6, s * 0.7, s * 0.3, 0, s * 0.8);
      ctx.closePath();

      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    }
  }

  renderRain() {
    const ctx = this.ctx;
    ctx.lineWidth = 1.4;

    for (const p of this.particles) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.speedX, p.y + p.length);
      ctx.strokeStyle = p.color;
      ctx.stroke();

      p.x += p.speedX;
      p.y += p.speedY;

      if (p.y > this.height - 40) {
        if (Math.random() > 0.6 && this.ripples.length < 25) {
          this.ripples.push({
            x: p.x,
            y: this.height - Math.random() * 20 - 5,
            radius: 1,
            maxRadius: Math.random() * 12 + 6,
            alpha: 0.6,
          });
        }
        p.y = -p.length;
        p.x = Math.random() * (this.width + 200) - 100;
      }
    }

    // Draw ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.radius * 2, r.radius * 0.7, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${r.alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      r.radius += 0.8;
      r.alpha -= 0.03;
      if (r.alpha <= 0 || r.radius >= r.maxRadius) {
        this.ripples.splice(i, 1);
      }
    }
  }

  renderBamboo() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.y += p.speedY;
      p.swayPhase += p.swaySpeed;
      p.x += Math.sin(p.swayPhase) * 1.35 + p.speedX;
      p.angle += p.angularSpeed;
      p.flip += p.flipSpeed;

      if (p.y > this.height + 35) {
        p.y = -35;
        p.x = Math.random() * (this.width + 100) - 50;
      }
      if (p.x > this.width + 35) {
        p.x = -35;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(1, Math.cos(p.flip));
      ctx.globalAlpha = p.opacity;

      // Soft shadow for foreground depth illusion
      ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
      ctx.shadowBlur = p.isNear ? 5 : 2.5;
      ctx.shadowOffsetY = p.isNear ? 2.5 : 1;

      // Slender, tapered bamboo leaf silhouette
      const L = p.length;
      const W = p.width;
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.5); // Tip
      ctx.bezierCurveTo(W * 0.65, -L * 0.2, W * 0.65, L * 0.25, 0, L * 0.5); // Right curve to base
      ctx.bezierCurveTo(-W * 0.65, L * 0.25, -W * 0.65, -L * 0.2, 0, -L * 0.5); // Left curve to tip
      ctx.closePath();

      ctx.fillStyle = p.color;
      ctx.fill();

      // Delicate central leaf vein
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.45);
      ctx.lineTo(0, L * 0.45);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();
    }
  }

  renderAurora() {
    const ctx = this.ctx;
    this.auroraTime += 0.012;

    // 1. Cosmic Aurora Ribbons / Draperies (Curtains of Northern Lights)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const curtains = [
      {
        baseY: 120,
        height: 140,
        colorTop: 'rgba(168, 85, 247, 0.16)', // Mystical violet crest
        colorMid: 'rgba(6, 182, 212, 0.22)',  // Vibrant cyan middle
        colorBot: 'rgba(16, 185, 129, 0.04)', // Soft emerald base
        freq1: 0.0025,
        freq2: 0.005,
        speed: 0.7,
        offset: 0,
      },
      {
        baseY: 160,
        height: 160,
        colorTop: 'rgba(56, 189, 248, 0.15)', // Sky blue crest
        colorMid: 'rgba(52, 211, 153, 0.24)', // Luminous emerald middle
        colorBot: 'rgba(16, 185, 129, 0.02)', // Fading base
        freq1: 0.002,
        freq2: 0.004,
        speed: 0.5,
        offset: 2.2,
      },
      {
        baseY: 200,
        height: 170,
        colorTop: 'rgba(236, 72, 153, 0.12)', // Magenta edge
        colorMid: 'rgba(139, 92, 246, 0.18)', // Deep purple/violet middle
        colorBot: 'rgba(6, 182, 212, 0.03)',  // Cyan base
        freq1: 0.003,
        freq2: 0.006,
        speed: 0.9,
        offset: 4.1,
      },
    ];

    for (const c of curtains) {
      ctx.beginPath();
      const topPoints = [];
      const botPoints = [];
      const step = 20;

      for (let x = 0; x <= this.width + step; x += step) {
        const wave = Math.sin(x * c.freq1 + this.auroraTime * c.speed + c.offset) * 40 +
                     Math.cos(x * c.freq2 - this.auroraTime * (c.speed * 0.6)) * 25;
        const yTop = c.baseY + wave - c.height * 0.5;
        const yBot = c.baseY + wave + c.height * 0.5;
        topPoints.push({ x, y: yTop });
        botPoints.push({ x, y: yBot });
      }

      ctx.moveTo(topPoints[0].x, topPoints[0].y);
      for (let i = 1; i < topPoints.length; i++) {
        ctx.lineTo(topPoints[i].x, topPoints[i].y);
      }
      for (let i = botPoints.length - 1; i >= 0; i--) {
        ctx.lineTo(botPoints[i].x, botPoints[i].y);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, c.baseY - c.height * 0.5, 0, c.baseY + c.height * 0.5);
      grad.addColorStop(0, c.colorTop);
      grad.addColorStop(0.4, c.colorMid);
      grad.addColorStop(1, c.colorBot);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();

    // 2. Twinkling Deep Space Starfield & Hero Stars with Cross-Spikes
    for (const s of this.stars) {
      s.phase += s.twinkleSpeed;
      const alpha = s.baseAlpha * (0.6 + Math.sin(s.phase) * 0.4);

      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = Math.max(0.08, alpha);
      ctx.fill();

      // If it's a hero star, draw diamond diffraction spikes
      if (s.isHero && alpha > 0.45) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = (alpha - 0.45) * 0.9;
        const spikeLen = s.radius * 4;

        ctx.beginPath();
        ctx.moveTo(s.x - spikeLen, s.y);
        ctx.lineTo(s.x + spikeLen, s.y);
        ctx.moveTo(s.x, s.y - spikeLen);
        ctx.lineTo(s.x, s.y + spikeLen);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. Shooting Stars (Meteors / Sao Băng)
    this.meteorTimer--;
    if (this.meteorTimer <= 0) {
      this.meteorTimer = Math.floor(Math.random() * 220 + 120); // Spawns every 3-6s
      if (this.meteors.length < 3) {
        const startX = Math.random() * (this.width * 0.8) + this.width * 0.1;
        const startY = Math.random() * (this.height * 0.35);
        const speed = Math.random() * 10 + 14;
        const angle = Math.PI * 0.72 + (Math.random() - 0.5) * 0.2; // down-left trajectory
        this.meteors.push({
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          len: Math.random() * 90 + 80,
          life: 0,
          maxLife: Math.floor(Math.random() * 18 + 26),
          color: Math.random() > 0.4 ? '#67e8f9' : '#f472b6',
        });
      }
    }

    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.life++;
      m.x += m.vx;
      m.y += m.vy;

      const progress = m.life / m.maxLife;
      const alpha = Math.sin(progress * Math.PI); // Fade in then out

      if (alpha > 0.02) {
        ctx.save();
        const dist = Math.hypot(m.vx, m.vy) || 1;
        const tailX = m.x - (m.vx / dist) * m.len;
        const tailY = m.y - (m.vy / dist) * m.len;

        const grad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        grad.addColorStop(0.7, m.color);
        grad.addColorStop(1, '#ffffff');

        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();

        // Glowing white head
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 12;
        ctx.fill();

        ctx.restore();
      }

      if (m.life >= m.maxLife) {
        this.meteors.splice(i, 1);
      }
    }
  }
}

let vfx = null;

// ==========================================================================
// 2. HELPER FUNCTIONS & IPC MESSAGING
// ==========================================================================

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Không nhận được phản hồi từ tiện ích.');
  }
  return response.data;
}

const TOAST_ICONS = {
  syncing: '<svg class="toast-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  success: '<svg class="toast-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  error: '<svg class="toast-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
};

function showToast(message, type = 'info', duration = 3200) {
  const container = $('toast-container');
  if (!container) return null;

  const toast = document.createElement('div');
  toast.className = `studio-toast ${type}`;

  const iconEl = document.createElement('span');
  iconEl.className = 'studio-toast-icon';
  iconEl.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;

  const textEl = document.createElement('span');
  textEl.className = 'studio-toast-text';
  textEl.textContent = message;

  toast.appendChild(iconEl);
  toast.appendChild(textEl);

  const progressEl = document.createElement('div');
  progressEl.className = 'studio-toast-progress';
  toast.appendChild(progressEl);

  container.appendChild(toast);

  let timer = null;
  let fadeTimer = null;
  const scheduleDismiss = (ms) => {
    if (timer) clearTimeout(timer);
    if (fadeTimer) clearTimeout(fadeTimer);

    if (ms > 0) {
      progressEl.style.animation = 'none';
      void progressEl.offsetHeight; // force reflow
      progressEl.style.animation = `toast-progress ${ms}ms linear forwards`;

      const fadeDuration = 220;
      const fadeStart = Math.max(0, ms - fadeDuration);

      fadeTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px) scale(0.97)';
        toast.style.transition = `opacity ${fadeDuration}ms ease, transform ${fadeDuration}ms ease`;
      }, fadeStart);

      timer = setTimeout(() => {
        toast.remove();
      }, ms + 20);
    } else {
      progressEl.style.animation = 'none';
    }
  };

  if (duration > 0) {
    scheduleDismiss(duration);
  }

  return {
    update({ message: newMsg, type: newType = 'info', duration: newDur = 3200 }) {
      toast.className = `studio-toast ${newType}`;
      iconEl.innerHTML = TOAST_ICONS[newType] || TOAST_ICONS.info;
      textEl.style.opacity = '0';
      textEl.style.transform = 'translateY(-3px)';
      setTimeout(() => {
        textEl.textContent = newMsg;
        textEl.style.opacity = '1';
        textEl.style.transform = 'translateY(0)';
      }, 100);

      toast.style.transform = 'translateY(0) scale(1.035)';
      setTimeout(() => {
        toast.style.transform = 'translateY(0) scale(1)';
      }, 150);

      if (newDur > 0) {
        scheduleDismiss(newDur);
      }
    },
    dismiss() {
      if (timer) clearTimeout(timer);
      if (fadeTimer) clearTimeout(fadeTimer);
      progressEl.style.animation = 'none';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.97)';
      toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => toast.remove(), 210);
    }
  };
}

function syncCustomSelect(selectId) {
  const select = $(selectId);
  if (!select) return;

  const wrap = $(`${selectId}-wrap`);
  const trigger = $(`${selectId}-trigger`);
  const label = $(`${selectId}-label`);
  const menu = $(`${selectId}-menu`);
  if (!wrap || !trigger || !label || !menu) return;

  const currentVal = select.value;
  const currentOpt = select.options[select.selectedIndex] || select.options[0];
  if (currentOpt) {
    label.textContent = currentOpt.textContent || currentOpt.value || 'Tất cả dự án';
  }

  // Render options inside custom menu
  menu.innerHTML = '';
  Array.from(select.options).forEach((opt) => {
    const isSelected = opt.value === currentVal;
    const item = document.createElement('div');
    item.className = `custom-select-option ${isSelected ? 'is-selected' : ''}`;
    item.dataset.value = opt.value;
    item.role = 'option';
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    const leftWrap = document.createElement('div');
    leftWrap.className = 'custom-option-left';

    const icon = document.createElement('span');
    icon.className = 'custom-option-icon';
    if (!opt.value) {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
    } else {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    }

    const text = document.createElement('span');
    text.className = 'custom-option-text';
    text.textContent = opt.textContent;
    text.title = opt.textContent;

    leftWrap.append(icon, text);
    item.appendChild(leftWrap);

    if (isSelected) {
      const check = document.createElement('span');
      check.className = 'custom-option-check';
      check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      item.appendChild(check);
    }

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      select.value = opt.value;
      label.textContent = opt.textContent;
      closeAllCustomSelects();
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncCustomSelect(selectId);
    });

    menu.appendChild(item);
  });
}

function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select-wrap.is-open').forEach(wrap => {
    wrap.classList.remove('is-open');
    wrap.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function initCustomSelect(selectId) {
  const wrap = $(`${selectId}-wrap`);
  const trigger = $(`${selectId}-trigger`);
  const menu = $(`${selectId}-menu`);
  if (!wrap || !trigger || !menu) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains('is-open');
    closeAllCustomSelects();
    if (!isOpen) {
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  });

  syncCustomSelect(selectId);
}

function formatDDMMYYYY(isoString) {
  if (!isoString) return '--/--/----';
  const parts = isoString.slice(0, 10).split('-');
  if (parts.length !== 3) return isoString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function updateModalDateDisplays() {
  const leaveInput = $('leave-day');
  const leaveText = document.querySelector('#leave-day-display .form-date-text');
  if (leaveInput && leaveText) {
    leaveText.textContent = formatDDMMYYYY(leaveInput.value);
  }

  const manualInput = $('manual-day');
  const manualText = document.querySelector('#manual-day-display .form-date-text');
  if (manualInput && manualText) {
    manualText.textContent = formatDDMMYYYY(manualInput.value);
  }
}

// ==========================================================================
// VIETNAMESE LUNAR CALENDAR ALGORITHM (Hồ Ngọc Đức Astronomical Math)
// ==========================================================================
function INT(x) { return Math.floor(x); }

function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}

function getNewMoonDay(k, timeZone) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * M * dr);
  C1 -= 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(2 * Mpr * dr);
  C1 -= 0.0004 * Math.sin(3 * Mpr * dr);
  C1 += 0.0104 * Math.sin(2 * F * dr) - 0.0051 * Math.sin((M + Mpr) * dr);
  C1 -= 0.0074 * Math.sin((M - Mpr) * dr) + 0.0004 * Math.sin((2 * F + M) * dr);
  C1 -= 0.0004 * Math.sin((2 * F - M) * dr) - 0.0006 * Math.sin((2 * F + Mpr) * dr);
  C1 += 0.0010 * Math.sin((2 * F - Mpr) * dr) + 0.0005 * Math.sin((2 * M + Mpr) * dr);
  const deltat = (T < -11)
    ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2;
  const JdNew = Jd1 + C1 - deltat;
  return INT(JdNew + 0.5 + timeZone / 24);
}

function getSunLongitude(jdn, timeZone) {
  const T = (jdn - 2451545.5 - timeZone / 24) / 36525, T2 = T * T, dr = Math.PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L -= Math.PI * 2 * INT(L / (Math.PI * 2));
  return INT(L / Math.PI * 6);
}

function getLunarMonth11(yy, timeZone) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) nm = getNewMoonDay(k - 1, timeZone);
  return nm;
}

function getLeapMonthOffset(a11, timeZone) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0, i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

function convertSolar2Lunar(dd, mm, yy, timeZone = 7) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k, timeZone);
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29.530588853 + 0.5);
  let lunarMonth = diff + 11;
  let lunarLeap = 0;
  const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
  if (b11 - a11 > 365) {
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, isLeap: lunarLeap === 1 };
}

function getLunarYearCanChi(year) {
  const CAN = ['Canh', 'Tân', 'Nhâm', 'Quý', 'Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ'];
  const CHI = ['Thân', 'Dậu', 'Tuất', 'Hợi', 'Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi'];
  const can = CAN[((year % 10) + 10) % 10];
  const chi = CHI[((year % 12) + 12) % 12];
  return `${can} ${chi}`;
}

function shiftMonth(dayStr, delta) {
  const d = parseDay(dayStr);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
  return next.toISOString().slice(0, 10);
}

function formatHours(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return '0.0h';
  return `${Number(num).toFixed(1)}h`;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function confirmDialog(message, {
  title = 'Xác nhận hành động',
  okText = 'Đồng ý',
  cancelText = 'Hủy',
  danger = true,
} = {}) {
  const modal = $('modal-confirm');
  if (!modal) return Promise.resolve(confirm(message));

  return new Promise((resolve) => {
    const titleEl = $('confirm-dialog-title');
    const msgEl = $('confirm-dialog-message');
    const okBtn = $('confirm-btn-ok');
    const cancelBtn = $('confirm-btn-cancel');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (cancelBtn) cancelBtn.textContent = cancelText;

    if (okBtn) {
      okBtn.textContent = okText;
      okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    }

    const iconWrap = $('confirm-icon-wrap');
    if (iconWrap) {
      iconWrap.classList.toggle('is-info', !danger);
    }

    modal.hidden = false;
    okBtn?.focus();

    const cleanup = () => {
      modal.hidden = true;
      okBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
    };

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };

    okBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
  });
}

// ==========================================================================
// 3. CLOCK & DATE NAVIGATION
// ==========================================================================
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
  const clockTime = $('clock-time');
  if (clockTime) clockTime.textContent = timeStr;

  const daysVi = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const dayName = daysVi[now.getDay()];
  const dateStr = `${dayName}, ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const clockDate = $('clock-date');
  if (clockDate) clockDate.textContent = dateStr;
}

function setAnchorDate(day) {
  currentDay = day;
  const input = $('anchor-date');
  if (input) input.value = day;

  const display = $('date-display-text');
  if (display) display.textContent = formatDDMMYYYY(day);

  void refreshAllData(false);
  const modal = $('modal-leave');
  if (modal && !modal.hidden) {
    renderLeaves();
  }
}

// ==========================================================================
// 4. DATA LOADING & RENDERING
// ==========================================================================

async function refreshAllData(force = false) {
  const syncBtn = $('btn-sync');
  if (syncBtn) syncBtn.classList.add('is-syncing');

  try {
    const [snapshot, tasks, odoo, settings] = await Promise.all([
      send({ type: 'snapshot', day: currentDay, force }).catch(e => {
        console.error('Snapshot load failed', e);
        return null;
      }),
      send({ type: 'tasks.snapshot', force }).catch(e => {
        console.error('Tasks load failed', e);
        return null;
      }),
      force && currentOdooSnapshot?.config?.enabled
        ? send({ type: 'odoo.refresh' }).catch(() => send({ type: 'odoo.settings' }).catch(() => null))
        : send({ type: 'odoo.settings' }).catch(() => null),
      send({ type: 'settings' }).catch(() => null),
    ]);

    currentSnapshot = snapshot;
    currentTasksSnapshot = tasks;
    currentOdooSnapshot = odoo;
    currentSettings = settings;

    // Greeting
    const greeting = $('user-greeting');
    if (greeting) {
      const displayName = snapshot?.name || settings?.config?.name || snapshot?.username || settings?.config?.username;
      if (displayName) {
        greeting.textContent = `Xin chào, ${displayName}`;
      } else {
        greeting.textContent = 'Chưa kết nối tài khoản GitLab';
      }
    }

    if ((snapshot?.username || settings?.config?.username) && (!snapshot?.name || snapshot.name === snapshot.username)) {
      send({ type: 'user.profile' }).then(profile => {
        if (profile?.name && greeting) {
          greeting.textContent = `Xin chào, ${profile.name}`;
          if (currentSnapshot) currentSnapshot.name = profile.name;
        }
      }).catch(() => {});
    }

    renderDailyGauge(snapshot);
    renderMonthlyKPI(snapshot);
    renderOdoo(odoo);
    renderAllocation(snapshot);
    renderTasks(tasks);
    renderDailyReport(snapshot);
    renderTimelogsAndNotes(snapshot);
  } finally {
    if (syncBtn) syncBtn.classList.remove('is-syncing');
  }
}

// Helper: Calculate total tracked time (work + leave)
function getTracked(item) {
  const work = item?.hours ?? null;
  const leave = item?.leaveHours ?? 0;
  if (work === null && leave === 0) return { total: 0, work: 0, leave: 0 };
  const total = (work || 0) + leave;
  return { total, work: work || 0, leave };
}

// Render Card 1: Daily Target Gauge
function renderDailyGauge(snapshot) {
  const circle = $('daily-gauge-circle');
  const hoursEl = $('daily-gauge-hours');
  const percentEl = $('daily-gauge-percent');
  const chipEl = $('daily-status-chip');
  const gitlabEl = $('stat-gitlab-hours');
  const manualEl = $('stat-manual-hours');
  const leaveEl = $('stat-leave-hours');

  if (!snapshot || !snapshot.day) {
    if (hoursEl) hoursEl.innerHTML = `0.0<span class="unit">h</span>`;
    return;
  }

  const dayStats = getTracked(snapshot.day);
  const totalHours = dayStats.total;
  const leaveHours = dayStats.leave;
  const target = 8.0;

  // Breakdown calculation
  let gitlabHours = 0;
  let manualHours = 0;
  for (const log of snapshot.logs || []) {
    if (log.date === currentDay) {
      if (log.type === 'MANUAL') manualHours += log.hours || 0;
      else if (log.type !== 'OFF') gitlabHours += log.hours || 0;
    }
  }

  if (hoursEl) hoursEl.innerHTML = `${totalHours.toFixed(1)}<span class="unit">h</span>`;
  if (gitlabEl) gitlabEl.textContent = formatHours(gitlabHours);
  if (manualEl) manualEl.textContent = formatHours(manualHours);
  if (leaveEl) leaveEl.textContent = formatHours(leaveHours);

  const percent = Math.min(100, Math.round((totalHours / target) * 100));
  if (percentEl) percentEl.textContent = `${percent}% của ${target.toFixed(1)}h`;

  // Stroke Dashoffset for 160x160 SVG circle with r=68 (perimeter ~ 427.25)
  if (circle) {
    const perimeter = 427;
    const offset = Math.max(0, perimeter - (perimeter * Math.min(1, totalHours / target)));
    circle.style.strokeDashoffset = String(offset);
  }

  if (chipEl) {
    if (totalHours >= target) {
      chipEl.textContent = 'Đã hoàn thành';
      chipEl.className = 'status-indicator-chip';
    } else {
      const remaining = (target - totalHours).toFixed(1);
      chipEl.textContent = `Thiếu ${remaining}h`;
      chipEl.className = 'status-indicator-chip is-warning';
    }
  }
}

// Render Card 2: Monthly Progress Orbit
function renderMonthlyKPI(snapshot) {
  const totalEl = $('monthly-total-hours');
  const captionEl = $('monthly-target-caption');
  const fillEl = $('monthly-progress-fill');
  const percentLabel = $('monthly-percent-label');
  const remainingLabel = $('monthly-remaining-label');
  const weekVal = $('week-hours-val');
  const leaveVal = $('month-leave-val');
  const avgVal = $('month-avg-val');

  if (!snapshot) return;

  const monthStats = getTracked(snapshot.month);
  const monthTotal = monthStats.total;
  const monthLeave = monthStats.leave;
  const weekStats = getTracked(snapshot.week);
  const weekTotal = weekStats.total;

  // Compute standard work days in this month
  const range = periods(currentDay);
  let standardWorkingDays = 0;
  let daysPassed = 0;
  for (const d of snapshot.days || []) {
    const dayOfWeek = parseDay(d.date).getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      standardWorkingDays++;
      if (d.date <= currentDay) daysPassed++;
    }
  }

  const standardTarget = standardWorkingDays * 8;
  const percent = standardTarget > 0 ? Math.min(100, Math.round((monthTotal / standardTarget) * 100)) : 0;

  if (totalEl) totalEl.innerHTML = `${monthTotal.toFixed(1)}<span class="unit">h</span>`;
  if (captionEl) captionEl.textContent = `/ ${standardTarget.toFixed(1)}h định mức`;
  if (fillEl) fillEl.style.width = `${percent}%`;
  if (percentLabel) percentLabel.textContent = `${percent}% định mức tháng`;

  const remainingDays = Math.max(0, standardWorkingDays - daysPassed);
  if (remainingLabel) remainingLabel.textContent = `Còn ${remainingDays} ngày làm`;

  if (weekVal) weekVal.textContent = formatHours(weekTotal);
  if (leaveVal) leaveVal.textContent = formatHours(monthLeave);

  const avg = daysPassed > 0 ? (monthTotal / daysPassed).toFixed(1) : '0.0';
  if (avgVal) avgVal.textContent = `${avg}h/ngày`;
}

// Render Card 3: Odoo Attendance
function renderOdoo(odooSnapshot) {
  const card = $('card-odoo');
  const banner = $('odoo-banner');
  const pill = $('odoo-status-pill');
  const titleEl = $('odoo-state-title');
  const timeEl = $('odoo-state-time');
  const timerDisplay = $('odoo-timer-display');
  const btnAction = $('btn-odoo-action');
  const btnText = $('btn-odoo-action-text');

  if (!odooSnapshot || !odooSnapshot.config?.enabled) {
    if (card) card.classList.remove('is-active-shift');
    if (pill) {
      pill.className = 'odoo-pill pill-disconnected';
      pill.textContent = 'Chưa kết nối';
    }
    if (titleEl) titleEl.textContent = '🔌 CHƯA KẾT NỐI ODOO';
    if (timeEl) timeEl.textContent = 'Bấm nút dưới để kết nối Odoo';
    if (timerDisplay) timerDisplay.textContent = '—';
    if (btnText) btnText.textContent = '+ Kết Nối Odoo';
    if (btnAction) btnAction.className = 'btn-odoo-primary is-connect';
    return;
  }

  const data = odooSnapshot.data;
  const isCheckedIn = data?.state === 'checked_in';
  const isCheckedOut = data?.state === 'checked_out';
  const hasError = Boolean(data?.error);

  // Card highlight & Pill status
  if (card) card.classList.toggle('is-active-shift', isCheckedIn);

  if (pill) {
    if (hasError) {
      pill.className = 'odoo-pill pill-error';
      pill.textContent = 'LỖI ODOO';
    } else if (isCheckedIn) {
      pill.className = 'odoo-pill pill-checked-in';
      pill.innerHTML = '<span class="pulse-dot"></span> ĐANG CHECK-IN';
    } else if (isCheckedOut) {
      pill.className = 'odoo-pill pill-checked-out';
      pill.textContent = 'ĐÃ CHECK-OUT';
    } else {
      pill.className = 'odoo-pill pill-not-today';
      pill.textContent = 'CHƯA CHECK-IN';
    }
  }

  if (banner) {
    banner.className = isCheckedIn
      ? 'odoo-status-banner is-checked-in'
      : (hasError ? 'odoo-status-banner is-error' : (isCheckedOut ? 'odoo-status-banner is-checked-out' : 'odoo-status-banner'));
  }

  if (titleEl) {
    if (hasError) {
      titleEl.textContent = '⚠️ LỖI KẾT NỐI ODOO';
    } else if (isCheckedIn) {
      titleEl.textContent = '🟢 ĐANG TRONG CA LÀM VIỆC';
    } else if (isCheckedOut) {
      titleEl.textContent = '🟠 ĐÃ CHECK-OUT (HẾT CA)';
    } else {
      titleEl.textContent = '⚪ CHƯA CHECK-IN HÔM NAY';
    }
  }

  const timeLabel = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  if (timeEl) {
    if (hasError) {
      timeEl.textContent = data.error === 'unavailable' ? 'Phiên đăng nhập Odoo hết hạn' : data.error;
    } else if (isCheckedIn && data?.lastCheckIn) {
      timeEl.textContent = `Check-in lúc: ${timeLabel(data.lastCheckIn)}${data?.checkedAt ? ` · Cập nhật: ${timeLabel(data.checkedAt)}` : ''}`;
    } else if (isCheckedOut && data?.lastCheckOut) {
      timeEl.textContent = `Check-out lúc: ${timeLabel(data.lastCheckOut)}${data?.checkedAt ? ` · Cập nhật: ${timeLabel(data.checkedAt)}` : ''}`;
    } else {
      timeEl.textContent = data?.checkedAt ? `Cập nhật lúc: ${timeLabel(data.checkedAt)}` : 'Chưa có dữ liệu ca làm hôm nay';
    }
  }

  // Display worked hours directly from Odoo API (exact same logic as classic popup)
  if (timerDisplay) {
    timerDisplay.textContent = formatHoursMinutes(odooSnapshot?.config?.enabled && !hasError ? data?.hoursToday : null);
  }

  if (btnText) btnText.textContent = '⚡ Đồng Bộ Điểm Danh';
  if (btnAction) btnAction.className = 'btn-odoo-primary';
}

// Leave Modal Management
function openLeaveModal() {
  const modal = $('modal-leave');
  if (!modal) return;
  modal.hidden = false;
  resetLeaveForm();
  renderLeaves();
}

function closeLeaveModal() {
  const modal = $('modal-leave');
  if (modal) modal.hidden = true;
  resetLeaveForm();
}

// ==========================================================================
// CALENDAR MODAL (Full Month Grid with Solar & Lunar Dates)
// ==========================================================================
let calModalActiveDay = currentDay;
const calModalSnapshotCache = new Map();

async function openCalendarModal() {
  calModalActiveDay = currentDay;
  const modal = $('modal-calendar');
  if (!modal) return;
  modal.hidden = false;
  await renderCalendarModal(calModalActiveDay);
}

function closeCalendarModal() {
  const modal = $('modal-calendar');
  if (modal) modal.hidden = true;
}

async function renderCalendarModal(dayStr) {
  const grid = $('cal-modal-grid');
  const monthLabel = $('cal-modal-month-label');
  if (!grid) return;

  const monthKey = dayStr.slice(0, 7);
  const [yStr, mStr] = monthKey.split('-');
  const yNum = parseInt(yStr, 10);
  const mNum = parseInt(mStr, 10);

  if (monthLabel) {
    monthLabel.textContent = `Tháng ${mNum} / ${yNum}`;
  }

  grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">Đang tải dữ liệu lịch tháng...</div>';

  let snapshot = null;
  if (currentSnapshot && currentSnapshot.date?.slice(0, 7) === monthKey) {
    snapshot = currentSnapshot;
  } else if (calModalSnapshotCache.has(monthKey)) {
    snapshot = calModalSnapshotCache.get(monthKey);
  } else {
    try {
      snapshot = await send({ type: 'snapshot', day: dayStr, force: false });
      if (snapshot) calModalSnapshotCache.set(monthKey, snapshot);
    } catch (err) {
      console.error('Failed to load snapshot for calendar modal', err);
    }
  }

  if (!snapshot || !Array.isArray(snapshot.days)) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: #ef4444; font-size: 13px;">Không thể tải dữ liệu lịch tháng này.</div>';
    return;
  }

  grid.innerHTML = '';

  // Monday-start week offset (UTC Monday = 1)
  const firstDay = parseDay(snapshot.range?.monthStart || `${monthKey}-01`);
  const offset = (firstDay.getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell cal-blank';
    grid.appendChild(blank);
  }

  const todayStr = today();
  for (const day of snapshot.days) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';

    const dObj = parseDay(day.date);
    const dow = (dObj.getUTCDay() + 6) % 7; // 0=Mon, ..., 5=Sat, 6=Sun
    const isWeekend = dow === 5 || dow === 6;

    if (isWeekend) cell.classList.add('is-weekend');
    if (day.date === todayStr) cell.classList.add('is-today');
    if (day.date === currentDay) cell.classList.add('is-selected');

    const [dY, dM, dD] = day.date.split('-');
    const solarNum = parseInt(dD, 10);
    const lunar = convertSolar2Lunar(solarNum, parseInt(dM, 10), parseInt(dY, 10), 7);

    let lunarText = '';
    let lunarClass = '';
    if (lunar.day === 1) {
      lunarText = `1/${lunar.month}${lunar.isLeap ? 'N' : ''}`;
      lunarClass = 'is-lunar-first';
    } else if (lunar.day === 15) {
      lunarText = '15 (Rằm)';
      lunarClass = 'is-lunar-ram';
    } else {
      lunarText = String(lunar.day);
    }

    const topWrap = document.createElement('div');
    topWrap.className = 'cal-cell-top';

    const solarEl = document.createElement('span');
    solarEl.className = `cal-solar-num ${isWeekend ? 'is-weekend-text' : ''}`;
    solarEl.textContent = solarNum;

    const lunarEl = document.createElement('span');
    lunarEl.className = `cal-lunar-text ${lunarClass}`;
    lunarEl.textContent = lunarText;
    lunarEl.title = `Âm lịch: Ngày ${String(lunar.day).padStart(2, '0')} tháng ${String(lunar.month).padStart(2, '0')} năm ${getLunarYearCanChi(lunar.year)}`;

    topWrap.append(solarEl, lunarEl);
    cell.appendChild(topWrap);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'cal-cell-chips';

    if (day.hours > 0) {
      const workChip = document.createElement('span');
      workChip.className = 'cal-chip-work';
      workChip.textContent = `⏱️ ${Number(day.hours).toFixed(1)}h`;
      chipsWrap.appendChild(workChip);
    }

    if (day.leaveHours > 0) {
      const leaveChip = document.createElement('span');
      leaveChip.className = 'cal-chip-leave';
      leaveChip.textContent = `🏖️ ${Number(day.leaveHours).toFixed(1)}h`;
      chipsWrap.appendChild(leaveChip);
    }

    cell.appendChild(chipsWrap);

    if (snapshot.notes?.[day.date]) {
      const noteIcon = document.createElement('span');
      noteIcon.className = 'cal-cell-note-icon';
      noteIcon.textContent = '📝';
      noteIcon.title = `Ghi chú: ${snapshot.notes[day.date]}`;
      cell.appendChild(noteIcon);
    }

    const dayOfWeekName = dow === 6 ? 'Chủ Nhật' : `Thứ ${dow + 2}`;
    const solarDateText = `${dayOfWeekName}, ngày ${dD} tháng ${dM} năm ${dY}`;
    const lunarDateText = `Ngày ${String(lunar.day).padStart(2, '0')} tháng ${String(lunar.month).padStart(2, '0')} năm ${getLunarYearCanChi(lunar.year)}`;

    cell.title = `Dương lịch: ${solarDateText}\nÂm lịch: ${lunarDateText}\nGiờ làm: ${formatHours(day.hours)}${day.leaveHours > 0 ? ` · Nghỉ: ${formatHours(day.leaveHours)}` : ''}`;
    if (snapshot.notes?.[day.date]) {
      cell.title += `\nGhi chú: ${snapshot.notes[day.date]}`;
    }

    cell.addEventListener('click', async () => {
      await setAnchorDate(day.date);
      closeCalendarModal();
      showToast(`Đã chuyển sang ngày ${formatDDMMYYYY(day.date)} (Âm lịch: ${lunar.day}/${lunar.month})`, 'success');
    });

    grid.appendChild(cell);
  }
}

function updateLeavePresetChips(val) {
  const num = parseFloat(val);
  document.querySelectorAll('.leave-preset-chip').forEach(chip => {
    chip.classList.toggle('active', parseFloat(chip.dataset.hours) === num);
  });
}

function adjustLeaveHours(delta) {
  const input = $('leave-hours');
  if (!input) return;
  let val = parseFloat(input.value) || 8;
  val = Math.max(0.5, Math.min(8, Math.round((val + delta) * 10) / 10));
  input.value = val;
  updateLeavePresetChips(val);
}

function adjustManualHours(delta) {
  const input = $('manual-hours');
  if (!input) return;
  let val = parseFloat(input.value) || 2;
  val = Math.max(0.25, Math.min(24, Math.round((val + delta) * 100) / 100));
  input.value = val;
}

function resetLeaveForm() {
  editingLeaveId = null;
  const dayInput = $('leave-day');
  const hoursInput = $('leave-hours');
  const reasonInput = $('leave-reason');
  const titleEl = $('leave-form-title');
  const submitBtn = $('btn-leave-submit');
  const cancelBtn = $('btn-leave-cancel-edit');

  if (dayInput) dayInput.value = currentDay;
  if (hoursInput) hoursInput.value = 8;
  updateLeavePresetChips(8);
  if (reasonInput) reasonInput.value = '';
  if (titleEl) titleEl.textContent = '➕ Thêm Ngày Nghỉ Phép Mới';
  if (submitBtn) {
    submitBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="btn-icon"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      <span>Thêm Lịch</span>
    `;
  }
  if (cancelBtn) cancelBtn.hidden = true;
  updateModalDateDisplays();
}

async function getProfileLeaves() {
  try {
    const { config, profiles = {} } = await chrome.storage.local.get(['config', 'profiles']);
    if (config?.profile && Array.isArray(profiles[config.profile]?.leaves)) {
      return [...profiles[config.profile].leaves];
    }
  } catch (err) {
    console.error('Failed to read profile leaves', err);
  }
  return currentSnapshot?.leaves || [];
}

async function renderLeaves() {
  const container = $('leave-table-container');
  const badge = $('leave-modal-badge');
  if (!container) return;

  const allLeaves = await getProfileLeaves();
  const currentMonthPrefix = currentDay.slice(0, 7);
  const leaves = leaveFilterMode === 'month'
    ? allLeaves.filter(l => l.day && l.day.startsWith(currentMonthPrefix))
    : allLeaves;

  leaves.sort((a, b) => b.day.localeCompare(a.day));

  const totalHours = leaves.reduce((sum, l) => sum + (Number(l.hours) || 0), 0);
  if (badge) {
    badge.textContent = `${leaves.length} ngày (${totalHours}h)`;
  }

  container.innerHTML = '';
  if (leaves.length === 0) {
    const [y, m] = currentMonthPrefix.split('-');
    const emptyMsg = leaveFilterMode === 'month'
      ? `Không có ngày nghỉ nào trong tháng ${m}/${y}`
      : 'Chưa có dữ liệu ngày nghỉ phép nào được lưu';
    container.innerHTML = `<div class="empty-state-muted">${emptyMsg}</div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'leave-cards-list';

  leaves.forEach(entry => {
    const isEditing = editingLeaveId === entry.id;
    const card = document.createElement('div');
    card.className = `leave-row-item ${isEditing ? 'is-editing' : ''}`;

    const main = document.createElement('div');
    main.className = 'leave-row-main';

    const header = document.createElement('div');
    header.className = 'leave-row-header';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'leave-row-date';
    dateSpan.textContent = `📅 ${formatDDMMYYYY(entry.day)}`;

    const hoursSpan = document.createElement('span');
    hoursSpan.className = 'leave-row-hours';
    hoursSpan.textContent = `${entry.hours}h OFF`;

    header.append(dateSpan, hoursSpan);

    const reasonDiv = document.createElement('div');
    reasonDiv.className = 'leave-row-reason';
    reasonDiv.textContent = entry.reason || 'Nghỉ phép';

    main.append(header, reasonDiv);

    const actions = document.createElement('div');
    actions.className = 'leave-row-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-leave-action';
    editBtn.textContent = '✏️ Sửa';
    editBtn.title = 'Sửa ngày nghỉ này';
    editBtn.addEventListener('click', () => {
      editingLeaveId = entry.id;
      if ($('leave-day')) $('leave-day').value = entry.day;
      if ($('leave-hours')) $('leave-hours').value = entry.hours;
      updateLeavePresetChips(entry.hours);
      if ($('leave-reason')) $('leave-reason').value = entry.reason;
      if ($('leave-form-title')) $('leave-form-title').textContent = `✏️ Sửa Ngày Nghỉ ${formatDDMMYYYY(entry.day)}`;
      if ($('btn-leave-submit')) {
        $('btn-leave-submit').innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          <span>Lưu Thay Đổi</span>
        `;
      }
      if ($('btn-leave-cancel-edit')) $('btn-leave-cancel-edit').hidden = false;
      updateModalDateDisplays();
      renderLeaves();
      $('leave-reason')?.focus();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-leave-action btn-leave-delete';
    deleteBtn.textContent = '🗑️ Xóa';
    deleteBtn.title = 'Xóa ngày nghỉ này';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Bạn có chắc muốn xóa lịch nghỉ ngày ${formatDDMMYYYY(entry.day)} (${entry.hours}h)?`)) return;
      try {
        await send({ type: 'leave.delete', id: entry.id });
        if (editingLeaveId === entry.id) resetLeaveForm();
        showToast('Đã xóa ngày nghỉ phép!', 'success');
        await refreshAllData(true);
        await renderLeaves();
      } catch (err) {
        showToast(err.message || 'Lỗi khi xóa ngày nghỉ', 'error');
      }
    });

    actions.append(editBtn, deleteBtn);
    card.append(main, actions);
    list.appendChild(card);
  });

  container.appendChild(list);
}

// Settings Modal Management
function openSettingsModal(tab = 'general') {
  const modal = $('modal-settings');
  if (!modal) return;
  modal.hidden = false;
  switchSettingsTab(tab);
  populateSettings();
}

function closeSettingsModal() {
  const modal = $('modal-settings');
  if (modal) modal.hidden = true;
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.settings-tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.pane === tab);
  });
}

function populateSettings() {
  const cfg = currentSettings?.config;
  if (cfg) {
    if ($('excel-pattern')) $('excel-pattern').value = cfg.excelPattern || 'report_MM_YYYY.xlsx';
    if ($('reminder-enabled')) $('reminder-enabled').checked = cfg.reminderEnabled !== false;
    if ($('reminder-time')) $('reminder-time').value = cfg.reminderTime || '10:00';

    if ($('gitlab-url')) $('gitlab-url').value = cfg.url || '';
    if ($('remember-token')) $('remember-token').checked = Boolean(cfg.rememberToken);
    if ($('gitlab-projects') && cfg.projects?.length) {
      $('gitlab-projects').value = JSON.stringify(cfg.projects, null, 2);
    }
    if ($('btn-disconnect-gitlab')) $('btn-disconnect-gitlab').hidden = false;
  } else {
    if ($('btn-disconnect-gitlab')) $('btn-disconnect-gitlab').hidden = true;
  }

  const odooCfg = currentOdooSnapshot?.config;
  if (odooCfg) {
    if ($('odoo-url')) $('odoo-url').value = odooCfg.url || '';
    if ($('odoo-reminders')) $('odoo-reminders').checked = odooCfg.reminders !== false;
    (odooCfg.times || ODOO_TIMES).forEach((t, i) => {
      const el = $(`odoo-time-${i}`);
      if (el) el.value = t;
    });
    if ($('btn-disconnect-odoo')) $('btn-disconnect-odoo').hidden = !odooCfg.enabled;
  } else {
    if ($('btn-disconnect-odoo')) $('btn-disconnect-odoo').hidden = true;
  }
}

// Distribute percentages so the rounded values always sum exactly to 100% (Largest Remainder Method)
function calculateDisplayPercentages(rows) {
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + (r.hours || 0), 0);
  if (total <= 0) return rows.map(() => 0);

  const items = rows.map((r, i) => {
    const raw = ((r.hours || 0) / total) * 100;
    const floor = Math.floor(raw);
    const rem = raw - floor;
    return { i, floor, rem };
  });

  const sumFloor = items.reduce((s, item) => s + item.floor, 0);
  let deficit = 100 - sumFloor;

  items.sort((a, b) => b.rem - a.rem);
  for (let k = 0; k < deficit && k < items.length; k++) {
    items[k].floor += 1;
  }

  items.sort((a, b) => a.i - b.i);
  return items.map(item => item.floor);
}

// Render Card 5: Time Allocation
function renderAllocation(snapshot) {
  const stackedBar = $('allocation-stacked-bar');
  const projectList = $('allocation-project-list');
  const totalChip = $('allocation-total-chip');

  if (!snapshot || !stackedBar || !projectList) return;

  const allocation = timeAllocation(snapshot);
  if (totalChip) totalChip.textContent = `${allocation.total.toFixed(1)}h tổng`;

  stackedBar.innerHTML = '';
  projectList.innerHTML = '';

  if (!allocation.rows.length || allocation.total <= 0) {
    projectList.innerHTML = `<div class="empty-state-muted">Chưa có dữ liệu phân bổ giờ làm việc</div>`;
    return;
  }

  const colors = [
    'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
    'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
    'linear-gradient(135deg, #34d399 0%, #059669 100%)',
    'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
    'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
    'linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)',
  ];

  const displayPercents = calculateDisplayPercentages(allocation.rows);

  allocation.rows.forEach((row, i) => {
    const color = colors[i % colors.length];
    const percent = displayPercents[i] ?? Math.round((row.share || 0) * 100);

    // Segment in top stacked bar (uses flex-grow so segments always fill 100% flush)
    if (row.hours > 0) {
      const seg = document.createElement('div');
      seg.className = 'bar-segment';
      seg.style.flex = `${row.hours} 0 0%`;
      seg.style.width = `${((row.share || 0) * 100).toFixed(2)}%`;
      seg.style.background = color;
      seg.title = `${projectName(row.project)}: ${row.hours.toFixed(1)}h (${percent}%)`;
      stackedBar.appendChild(seg);
    }

    // Row in project list
    const item = document.createElement('div');
    item.className = 'project-row-item';
    item.innerHTML = `
      <div class="project-item-left">
        <span class="project-color-badge" style="background: ${color}"></span>
        <span class="project-name-label" title="${row.project}">${projectName(row.project)}</span>
      </div>
      <div class="project-item-right">
        <span class="project-hours-badge">${row.hours.toFixed(1)}h</span>
        <span class="project-percent-badge">${percent}%</span>
      </div>
    `;
    projectList.appendChild(item);
  });
}

// Render Card 6: Personal Tasks Board & Card 4: Radar
function renderTasks(tasksSnapshot) {
  const totalBadge = $('tasks-total-badge');
  const overdueCount = $('tasks-overdue-count');
  const readyCount = $('tasks-ready-count');
  const upcomingCount = $('tasks-upcoming-count');
  const missingCount = $('tasks-missing-count');
  const listContainer = $('tasks-items-list');
  const projectSelect = $('tasks-project-select');

  if (!tasksSnapshot || !tasksSnapshot.items) {
    if (listContainer) listContainer.innerHTML = `<div class="empty-state-muted">Chưa nạp được danh sách công việc</div>`;
    return;
  }

  const items = tasksSnapshot.items || [];

  // Calculate radar status counts matching classic popup logic
  let countOverdue = 0, countReady = 0, countUpcoming = 0, countMissing = 0, totalEstimateSecs = 0;
  for (const t of items) {
    totalEstimateSecs += t.estimateSeconds || 0;
    const st = taskStatus(t, currentDay);
    if (st === 'overdue') countOverdue++;
    else if (st === 'ready') countReady++;
    else if (st === 'upcoming') countUpcoming++;
    if (!t.startDate) countMissing++;
  }

  if (totalBadge) totalBadge.textContent = `${items.length} tasks (${Math.round(totalEstimateSecs / 3600)}h)`;
  if (overdueCount) overdueCount.textContent = String(countOverdue);
  if (readyCount) readyCount.textContent = String(countReady);
  if (upcomingCount) upcomingCount.textContent = String(countUpcoming);
  if (missingCount) missingCount.textContent = String(countMissing);

  // Update projects dropdown if needed
  if (projectSelect) {
    const uniqueProjects = new Set();
    items.forEach(t => { if (t.project) uniqueProjects.add(t.project); });

    const currentOptValues = Array.from(projectSelect.options).slice(1).map(o => o.value);
    const newProjects = Array.from(uniqueProjects);
    const isDifferent = currentOptValues.length !== newProjects.length || newProjects.some((p, idx) => p !== currentOptValues[idx]);

    if (isDifferent || projectSelect.options.length <= 1) {
      const preservedVal = projectSelect.value;
      projectSelect.innerHTML = '<option value="">Tất cả dự án</option>';
      newProjects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        projectSelect.appendChild(opt);
      });
      if (uniqueProjects.has(preservedVal)) {
        projectSelect.value = preservedVal;
      } else if (tasksFilter.project && !uniqueProjects.has(tasksFilter.project)) {
        projectSelect.value = '';
        tasksFilter.project = '';
      }
      syncCustomSelect('tasks-project-select');
    }
  }

  // Filter tasks using selectPersonalTasks
  const filtered = selectPersonalTasks(items, currentDay, {
    search: tasksFilter.search,
    project: tasksFilter.project,
    status: tasksFilter.status === 'all' ? '' : tasksFilter.status,
  });

  // Render task list
  if (!listContainer) return;
  listContainer.innerHTML = '';

  if (!filtered.length) {
    listContainer.innerHTML = `<div class="empty-state-muted">Không tìm thấy công việc phù hợp với bộ lọc</div>`;
    return;
  }

  const statusLabels = {
    overdue: 'QUÁ HẠN',
    ready: 'CẦN LÀM',
    upcoming: 'SẮP TỚI',
    missing: 'CHƯA KẾ HOẠCH',
  };

  filtered.forEach(task => {
    const status = taskStatus(task, currentDay);
    const card = document.createElement('div');
    card.className = `task-item-card border-${status}`;

    const statusText = statusLabels[status] || 'CÔNG VIỆC';
    const statusClass = `status-pill-${status}`;

    // Due date label
    let dueHtml = '';
    if (task.dueDate) {
      if (task.dueDate < currentDay) {
        dueHtml = `<span class="task-due-badge" style="color: #f87171; font-weight: 700;">Hạn: ${formatDDMMYYYY(task.dueDate)} (Quá hạn)</span>`;
      } else if (task.dueDate === currentDay) {
        dueHtml = `<span class="task-due-badge" style="color: #34d399; font-weight: 700;">Hạn: Hôm nay</span>`;
      } else {
        dueHtml = `<span class="task-due-badge">Hạn: ${formatDDMMYYYY(task.dueDate)}</span>`;
      }
    } else {
      dueHtml = `<span class="task-due-badge" style="opacity: 0.6;">Chưa có hạn</span>`;
    }

    // Estimate hours
    const estHours = task.estimateSeconds ? task.estimateSeconds / 3600 : null;

    // Spent hours calculation:
    // 1. From task.spentSeconds (totalTimeSpent from GitLab across all time)
    // 2. Fallback / supplementary: sum from currentSnapshot.logs
    let spentHours = 0;
    if (task.spentSeconds && task.spentSeconds > 0) {
      spentHours = task.spentSeconds / 3600;
    } else if (currentSnapshot?.logs && Array.isArray(currentSnapshot.logs)) {
      const taskLogs = currentSnapshot.logs.filter(log => {
        const matchIid = String(log.task) === String(task.iid);
        const matchPath = (!log.projectPath || !task.projectPath) || log.projectPath === task.projectPath;
        return matchIid && matchPath && log.hours > 0;
      });
      spentHours = taskLogs.reduce((sum, l) => sum + (l.hours || 0), 0);
    }

    const isOver = estHours && spentHours > estHours;
    const spentHtml = spentHours > 0
      ? `<span class="task-spent-badge ${isOver ? 'is-over' : ''}" title="Thời gian đã làm thực tế${isOver ? ' (Đã vượt ước lượng!)' : ''}">⏱️ ${spentHours.toFixed(1)}h</span>`
      : '';
    const estHtml = estHours
      ? `<span class="task-estimate-badge" title="Thời gian ước lượng hoàn thành">🎯 ${estHours.toFixed(1)}h</span>`
      : '';

    // Suggested start plan label
    const startHtml = task.startDate
      ? `<span class="task-project-pill" style="color: var(--neon-cyan); border-color: rgba(6,182,212,0.3);" title="Kế hoạch ngày bắt đầu gợi ý">Bắt đầu: ${formatDDMMYYYY(task.startDate)}</span>`
      : '';

    card.innerHTML = `
      <div class="task-meta-left">
        <a href="${task.url || '#'}" target="_blank" rel="noopener noreferrer" class="task-title-link" title="${task.title}">
          #${task.iid} ${task.title}
        </a>
        <div class="task-tags-row">
          <span class="task-project-pill">${task.project || 'GitLab'}</span>
          <span class="task-status-pill ${statusClass}">${statusText}</span>
          ${startHtml}
        </div>
      </div>
      <div class="task-meta-right">
        ${dueHtml}
        <div class="task-hours-group">
          ${spentHtml}
          ${estHtml}
        </div>
      </div>
    `;

    // Click handler to open task in new tab
    const titleLink = card.querySelector('.task-title-link');
    if (titleLink && task.url) {
      titleLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: task.url });
      });
    }

    listContainer.appendChild(card);
  });
}

// Render Card 7: Daily Report Studio
async function renderDailyReport(snapshot) {
  const editor = $('daily-report-editor');
  const charCount = $('report-char-count');
  if (!editor || !snapshot) return;

  const key = `daily-report:${snapshot.profile}:${currentDay}`;
  const saved = await chrome.storage.local.get(key);
  editor.value = saved[key] || '';

  if (charCount) charCount.textContent = `${editor.value.length} ký tự`;
}

// Render Card 8: Timelogs stream & Notes
async function renderTimelogsAndNotes(snapshot) {
  const feedList = $('timelogs-feed-list');
  const noteEditor = $('daily-note-text');
  const streamBadge = $('stream-count-badge');

  if (!snapshot) return;

  const dayLogs = (snapshot.logs || []).filter(l => l.date === currentDay);
  if (streamBadge) streamBadge.textContent = `${dayLogs.length} mục`;

  if (feedList) {
    feedList.innerHTML = '';
    if (!dayLogs.length) {
      feedList.innerHTML = `<div class="empty-state-muted">Chưa có giờ làm việc ghi nhận cho ngày này</div>`;
    } else {
      dayLogs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'log-entry-item';

        const left = document.createElement('div');
        left.className = 'log-entry-left';

        // Title element (link if log.url, otherwise div)
        const titleEl = document.createElement(log.url ? 'a' : 'div');
        titleEl.className = 'log-entry-title';
        titleEl.textContent = log.title || log.task || 'Không có tiêu đề';
        if (log.url) {
          titleEl.href = log.url;
          titleEl.target = '_blank';
          titleEl.rel = 'noopener noreferrer';
          titleEl.title = `Mở task trên GitLab: ${log.url}`;
          titleEl.innerHTML += ` <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px; opacity: 0.6; display: inline-block; vertical-align: middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
          titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: log.url });
          });
        }

        const meta = document.createElement('div');
        meta.className = 'log-entry-meta';
        const projectLabel = log.type === 'MANUAL' ? 'Việc ngoài' : projectName(log.project);
        const typeLabel = log.type ? `[${log.type}]` : '';
        const summaryText = log.summary ? ` · 💬 ${escapeHtml(log.summary)}` : '';
        meta.innerHTML = `<span>📂 ${escapeHtml(projectLabel)} ${escapeHtml(typeLabel)}</span><span>${summaryText}</span>`;

        left.append(titleEl, meta);

        const hoursEl = document.createElement('div');
        hoursEl.className = 'log-entry-hours';
        hoursEl.textContent = (log.hours > 0 ? '+' : '') + formatHours(log.hours);

        item.append(left, hoursEl);
        feedList.appendChild(item);
      });
    }
  }

  // Load Note (from synchronized snapshot.notes matching classic popup)
  if (noteEditor) {
    noteEditor.value = snapshot?.notes?.[currentDay] || '';
  }
}

// ==========================================================================
// 5. EVENT LISTENERS & INITIALIZATION
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize VFX Canvas Engine & Interactive Expanding Theme Selector
  const canvas = $('vfx-canvas');
  const themeSelector = $('vfx-theme-selector');
  if (themeSelector) {
    themeSelector.classList.add('no-anim');
  }

  if (canvas) {
    vfx = new VFXEngine(canvas);
    const { immersive_theme } = await chrome.storage.local.get('immersive_theme');
    vfx.setTheme(immersive_theme || 'sakura');
  }

  if (themeSelector) {
    // Re-enable smooth transition animations after initial state is rendered
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        themeSelector.classList.remove('no-anim');
      });
    });

    const updateVfxAccessibility = (isOpen) => {
      themeSelector.setAttribute('aria-expanded', String(isOpen));
      themeSelector.querySelectorAll('.vfx-btn').forEach(btn => {
        btn.tabIndex = (isOpen || btn.classList.contains('active')) ? 0 : -1;
      });
    };
    updateVfxAccessibility(false);

    themeSelector.addEventListener('click', (e) => {
      const isOpen = themeSelector.classList.contains('is-open');
      const clickedBtn = e.target.closest('.vfx-btn');

      if (!isOpen) {
        // Expand to reveal choices
        e.stopPropagation();
        themeSelector.classList.add('is-open');
        updateVfxAccessibility(true);
        return;
      }

      // If already open and an option was clicked
      if (clickedBtn) {
        e.stopPropagation();
        const selectedTheme = clickedBtn.dataset.theme;
        if (vfx && selectedTheme) {
          vfx.setTheme(selectedTheme);
        }
        themeSelector.classList.remove('is-open');
        updateVfxAccessibility(false);
      }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (themeSelector.classList.contains('is-open') && !themeSelector.contains(e.target)) {
        themeSelector.classList.remove('is-open');
        updateVfxAccessibility(false);
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && themeSelector.classList.contains('is-open')) {
        themeSelector.classList.remove('is-open');
        updateVfxAccessibility(false);
        themeSelector.querySelector('.vfx-btn.active')?.focus();
      }
    });
  }

  // 2. Start digital clock
  updateClock();
  setInterval(updateClock, 1000);

  // 3. Setup Date Navigation
  const anchorInput = $('anchor-date');
  if (anchorInput) {
    anchorInput.value = currentDay;
    anchorInput.addEventListener('change', (e) => {
      if (e.target.value) setAnchorDate(e.target.value);
      anchorInput.blur();
    });
  }
  const dateDisplay = $('date-display-text');
  if (dateDisplay) dateDisplay.textContent = formatDDMMYYYY(currentDay);

  $('btn-prev-day')?.addEventListener('click', () => {
    setAnchorDate(addDays(currentDay, -1));
  });
  $('btn-next-day')?.addEventListener('click', () => {
    setAnchorDate(addDays(currentDay, 1));
  });
  $('btn-today')?.addEventListener('click', () => {
    setAnchorDate(today());
  });

  // 4. Header Actions
  $('btn-sync')?.addEventListener('click', async () => {
    const syncBtn = $('btn-sync');
    if (syncBtn?.classList.contains('is-syncing')) return;
    syncBtn?.classList.add('is-syncing');

    const toast = showToast('Đang đồng bộ dữ liệu thời gian thực...', 'syncing', 0);
    try {
      await refreshAllData(true);
      if (currentSnapshot?.error) {
        toast?.update({ message: currentSnapshot.error, type: 'error', duration: 4000 });
      } else {
        toast?.update({ message: 'Đã đồng bộ dữ liệu mới nhất!', type: 'success', duration: 3200 });
      }
    } catch (err) {
      toast?.update({ message: err instanceof Error ? err.message : 'Đồng bộ thất bại', type: 'error', duration: 4000 });
    } finally {
      syncBtn?.classList.remove('is-syncing');
    }
  });

  $('btn-open-classic')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/popup.html') });
  });

  // Settings Button in Header & Odoo card
  $('btn-open-settings')?.addEventListener('click', () => {
    openSettingsModal(currentSnapshot?.username ? 'general' : 'gitlab');
  });
  $('odoo-status-pill')?.addEventListener('click', () => {
    openSettingsModal('odoo');
  });
  $('btn-odoo-action')?.addEventListener('click', async () => {
    if (!currentOdooSnapshot?.config?.enabled) {
      openSettingsModal('odoo');
    } else {
      const toast = showToast('Đang đồng bộ Odoo...', 'syncing', 0);
      try {
        currentOdooSnapshot = await send({ type: 'odoo.refresh' });
        renderOdoo(currentOdooSnapshot);
        toast?.update({ message: 'Đã cập nhật trạng thái Odoo!', type: 'success', duration: 3000 });
      } catch (err) {
        toast?.update({ message: err.message, type: 'error', duration: 4000 });
      }
    }
  });

  // Settings modal tabs & close
  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });
  $('btn-close-settings')?.addEventListener('click', closeSettingsModal);
  document.querySelectorAll('.btn-close-settings-modal').forEach(btn => {
    btn.addEventListener('click', closeSettingsModal);
  });

  // General settings form
  $('form-settings-general')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const config = {
        excelPattern: $('excel-pattern')?.value?.trim() || 'report_MM_YYYY.xlsx',
        reminderEnabled: $('reminder-enabled')?.checked ?? true,
        reminderTime: $('reminder-time')?.value || '10:00',
      };
      await send({ type: 'settings.update_general', config });
      closeSettingsModal();
      showToast('Đã lưu cài đặt chung thành công!', 'success');
      await refreshAllData(false);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // GitLab settings form
  $('form-settings-gitlab')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const config = validateConfig({
        url: $('gitlab-url').value,
        projects: $('gitlab-projects')?.value || '',
        rememberToken: $('remember-token')?.checked ?? false,
        excelPattern: $('excel-pattern')?.value?.trim() || 'report_MM_YYYY.xlsx',
        reminderEnabled: $('reminder-enabled')?.checked ?? true,
        reminderTime: $('reminder-time')?.value || '10:00',
        language: 'vi',
      });

      const parsedUrl = new URL(config.url);
      const pattern = `${parsedUrl.protocol}//${parsedUrl.hostname}/*`;
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error('Vui lòng cấp quyền truy cập GitLab server.');

      const tokenVal = $('gitlab-token')?.value || '';
      const data = await send({
        type: 'connect',
        config,
        token: tokenVal,
        day: currentDay,
      });

      if ($('gitlab-token')) $('gitlab-token').value = '';
      closeSettingsModal();
      showToast(data.error || `Đã kết nối tài khoản ${data.username || ''}`, data.error ? 'error' : 'success');
      await refreshAllData(true);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Disconnect GitLab
  $('btn-disconnect-gitlab')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Xác nhận ngắt kết nối tài khoản GitLab này khỏi tiện ích?', {
      title: 'Ngắt kết nối GitLab',
      okText: 'Ngắt kết nối',
      danger: true,
    });
    if (!ok) return;

    try {
      await send({ type: 'disconnect' });
      closeSettingsModal();
      showToast('Đã ngắt kết nối tài khoản GitLab.', 'info');
      await refreshAllData(true);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Odoo settings form
  $('form-settings-odoo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const times = [
        $('odoo-time-0')?.value || '08:30',
        $('odoo-time-1')?.value || '12:00',
        $('odoo-time-2')?.value || '13:30',
        $('odoo-time-3')?.value || '18:00',
      ];
      const config = validateOdooConfig({
        url: $('odoo-url').value,
        reminders: $('odoo-reminders')?.checked ?? true,
        autoAttendance: false,
        times,
      });

      const granted = await chrome.permissions.request({ origins: [`${config.url}/*`] });
      if (!granted) throw new Error('Vui lòng cấp quyền truy cập địa chỉ Odoo.');

      currentOdooSnapshot = await send({ type: 'odoo.connect', config });
      closeSettingsModal();
      renderOdoo(currentOdooSnapshot);
      showToast('Đã kết nối Odoo thành công!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Disconnect Odoo
  $('btn-disconnect-odoo')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Xác nhận ngắt kết nối Odoo?', {
      title: 'Ngắt kết nối Odoo',
      okText: 'Ngắt kết nối',
      danger: true,
    });
    if (!ok) return;

    try {
      currentOdooSnapshot = await send({ type: 'odoo.disconnect' });
      closeSettingsModal();
      renderOdoo(currentOdooSnapshot);
      showToast('Đã ngắt kết nối Odoo.', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Backup & Restore handlers
  $('btn-backup-json')?.addEventListener('click', async () => {
    try {
      const json = await send({ type: 'backup' });
      downloadFile(`kpi-report-backup-${today()}.json`, json, 'application/json');
      showToast('Đã sao lưu JSON thành công!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('input-restore-json')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await send({ type: 'restore', backup: text });
      showToast('Đã khôi phục dữ liệu từ backup JSON!', 'success');
      await refreshAllData(true);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('input-projects-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if ($('gitlab-projects')) $('gitlab-projects').value = JSON.stringify(parsed, null, 2);
      showToast('Đã nạp file projects.json!', 'info');
    } catch {
      showToast('File JSON không hợp lệ.', 'error');
    }
  });

  // 5. Tasks Filter & Radar Listeners
  const triggerStatusFilter = (status) => {
    document.querySelectorAll('.status-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === status);
    });
    tasksFilter.status = status;
    renderTasks(currentTasksSnapshot);
  };

  $('card-metric-overdue')?.addEventListener('click', () => triggerStatusFilter('overdue'));
  $('card-metric-ready')?.addEventListener('click', () => triggerStatusFilter('ready'));
  $('card-metric-upcoming')?.addEventListener('click', () => triggerStatusFilter('upcoming'));
  $('card-metric-missing')?.addEventListener('click', () => triggerStatusFilter('missing'));

  // Dedicated Tasks Refresh
  async function refreshTasksOnly() {
    const btnBoard = $('btn-tasks-refresh');
    const btnRadar = $('btn-tasks-radar-refresh');
    if (btnBoard) {
      btnBoard.disabled = true;
      btnBoard.classList.add('is-refreshing');
    }
    if (btnRadar) {
      btnRadar.disabled = true;
      btnRadar.classList.add('is-refreshing');
    }

    const toast = showToast('Đang đồng bộ task từ GitLab...', 'syncing', 0);

    try {
      const data = await send({ type: 'tasks.snapshot', force: true });
      currentTasksSnapshot = data;
      renderTasks(currentTasksSnapshot);
      if (!data.error) {
        toast?.update({ message: 'Đã làm mới danh sách task thành công!', type: 'success', duration: 3000 });
      } else {
        toast?.update({ message: `Không thể nạp task: ${data.error}`, type: 'error', duration: 4000 });
      }
    } catch (err) {
      toast?.update({ message: `Lỗi đồng bộ task: ${err.message}`, type: 'error', duration: 4000 });
    } finally {
      if (btnBoard) {
        btnBoard.disabled = false;
        btnBoard.classList.remove('is-refreshing');
      }
      if (btnRadar) {
        btnRadar.disabled = false;
        btnRadar.classList.remove('is-refreshing');
      }
    }
  }

  $('btn-tasks-refresh')?.addEventListener('click', refreshTasksOnly);
  $('btn-tasks-radar-refresh')?.addEventListener('click', refreshTasksOnly);

  $('btn-quick-add-manual')?.addEventListener('click', () => {
    $('modal-manual-work').hidden = false;
    $('manual-day').value = currentDay;
    updateModalDateDisplays();
  });

  $('tasks-search-input')?.addEventListener('input', (e) => {
    tasksFilter.search = e.target.value;
    renderTasks(currentTasksSnapshot);
  });
  $('tasks-project-select')?.addEventListener('change', (e) => {
    tasksFilter.project = e.target.value;
    syncCustomSelect('tasks-project-select');
    renderTasks(currentTasksSnapshot);
  });
  initCustomSelect('tasks-project-select');

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrap')) {
      closeAllCustomSelects();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomSelects();
    }
  });
  document.querySelectorAll('.status-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tasksFilter.status = btn.dataset.filter;
      renderTasks(currentTasksSnapshot);
    });
  });

  // 6. Daily Report Studio Listeners
  const reportEditor = $('daily-report-editor');
  reportEditor?.addEventListener('input', () => {
    const charCount = $('report-char-count');
    if (charCount) charCount.textContent = `${reportEditor.value.length} ký tự`;

    if (currentSnapshot?.profile) {
      const key = `daily-report:${currentSnapshot.profile}:${currentDay}`;
      chrome.storage.local.set({ [key]: reportEditor.value });
      const status = $('report-save-status');
      if (status) status.textContent = 'Đã lưu tự động';
    }
  });

  $('btn-generate-report')?.addEventListener('click', async () => {
    if (!currentSnapshot) return;
    const ok = await confirmDialog('Tạo mới báo cáo sẽ ghi đè nội dung soạn thảo hiện tại. Tiếp tục?', {
      title: 'Sinh Báo Cáo Tự Động',
      okText: 'Tạo Báo Cáo',
      danger: false,
    });
    if (!ok) return;

    const report = dailyReport(currentSnapshot, currentTasksSnapshot?.items || []);
    if (reportEditor) {
      reportEditor.value = report;
      const key = `daily-report:${currentSnapshot.profile}:${currentDay}`;
      await chrome.storage.local.set({ [key]: report });
      showToast('Đã sinh báo cáo ngày thành công!', 'success');
    }
  });

  $('btn-copy-report')?.addEventListener('click', async () => {
    if (!reportEditor?.value) {
      showToast('Nội dung báo cáo đang trống.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(reportEditor.value);
      showToast('Đã sao chép báo cáo vào clipboard!', 'success');
    } catch {
      showToast('Không thể sao chép tự động.', 'error');
    }
  });

  // 7. Stream / Notes Tabs
  $('tab-btn-logs')?.addEventListener('click', () => {
    $('tab-btn-logs')?.classList.add('active');
    $('tab-btn-notes')?.classList.remove('active');
    $('pane-logs')?.classList.add('active');
    $('pane-notes')?.classList.remove('active');
  });
  $('tab-btn-notes')?.addEventListener('click', () => {
    $('tab-btn-notes')?.classList.add('active');
    $('tab-btn-logs')?.classList.remove('active');
    $('pane-notes')?.classList.add('active');
    $('pane-logs')?.classList.remove('active');
  });

  // Daily note auto-save via background note.save (100% interoperable with classic popup)
  let noteDebounceTimer = null;
  $('daily-note-text')?.addEventListener('input', (e) => {
    const text = e.target.value;
    const label = $('note-save-status');
    if (label) label.textContent = 'Đang lưu...';
    clearTimeout(noteDebounceTimer);
    noteDebounceTimer = setTimeout(async () => {
      try {
        if (!currentSnapshot?.profile) return;
        await send({
          type: 'note.save',
          day: currentDay,
          profile: currentSnapshot.profile,
          text,
        });
        if (currentSnapshot.notes) {
          if (text.trim()) currentSnapshot.notes[currentDay] = text;
          else delete currentSnapshot.notes[currentDay];
        }
        if (label) label.textContent = 'Đã lưu';
      } catch (err) {
        if (label) label.textContent = 'Lỗi lưu';
        console.error('Note auto-save failed', err);
      }
    }, 600);
  });

  // 8. Dock Action Center
  // Excel Export
  $('btn-export-excel-month')?.addEventListener('click', async () => {
    const toast = showToast('Đang xuất Excel tháng...', 'syncing', 0);
    try {
      const excelData = await send({ type: 'export_excel_data', day: currentDay, force: true });
      const resp = await fetch(chrome.runtime.getURL('assets/templates/work_report.xlsx'));
      const templateBuffer = await resp.arrayBuffer();

      await import('./vendor/exceljs.min.js');
      const buffer = await generateExcelWorkbook(templateBuffer, excelData, window.ExcelJS);
      downloadFile(excelData.filename, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast?.update({ message: 'Xuất Excel thành công!', type: 'success', duration: 3000 });
    } catch (e) {
      toast?.update({ message: `Lỗi xuất Excel: ${e.message}`, type: 'error', duration: 4000 });
    }
  });

  $('btn-export-excel-day')?.addEventListener('click', async () => {
    const toast = showToast('Đang xuất Excel ngày...', 'syncing', 0);
    try {
      const excelData = await send({ type: 'export_excel_data', day: currentDay, force: false });
      const resp = await fetch(chrome.runtime.getURL('assets/templates/work_report.xlsx'));
      const templateBuffer = await resp.arrayBuffer();

      await import('./vendor/exceljs.min.js');
      const buffer = await generateExcelWorkbook(templateBuffer, excelData, window.ExcelJS);
      downloadFile(excelData.filename, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast?.update({ message: 'Xuất Excel thành công!', type: 'success', duration: 3000 });
    } catch (e) {
      toast?.update({ message: `Lỗi xuất Excel: ${e.message}`, type: 'error', duration: 4000 });
    }
  });

  // Default View Switcher
  const defaultToggle = $('chk-default-immersive');
  if (defaultToggle) {
    const { defaultView } = await chrome.storage.local.get('defaultView');
    defaultToggle.checked = defaultView === 'immersive';

    defaultToggle.addEventListener('change', async (e) => {
      const mode = e.target.checked ? 'immersive' : 'popup';
      await send({ type: 'view.set_default', mode });
      showToast(mode === 'immersive'
        ? 'Đã bật: Nhấn icon tiện ích sẽ mở Màn hình rộng'
        : 'Đã tắt: Nhấn icon tiện ích sẽ mở Popup Cổ điển',
        'info');
    });
  }

  // Modals
  $('btn-open-manual-modal')?.addEventListener('click', () => {
    $('modal-manual-work').hidden = false;
    $('manual-day').value = currentDay;
    updateModalDateDisplays();
  });
  $('btn-close-manual')?.addEventListener('click', () => { $('modal-manual-work').hidden = true; });
  $('btn-cancel-manual')?.addEventListener('click', () => { $('modal-manual-work').hidden = true; });

  // Modal Date Inputs (DD/MM/YYYY overlay sync, blur on select/away & native picker launch)
  for (const id of ['anchor-date', 'leave-day', 'manual-day']) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', () => {
      if (id !== 'anchor-date') updateModalDateDisplays();
    });
    el.addEventListener('change', () => {
      if (id !== 'anchor-date') updateModalDateDisplays();
      el.blur();
    });
    el.addEventListener('click', () => {
      if (typeof el.showPicker === 'function') {
        try { el.showPicker(); } catch (_) {}
      }
    });
  }

  // Prevent sticky focus border by clearing date focus on pointerdown outside
  document.addEventListener('pointerdown', (e) => {
    if (!e.target?.closest?.('.form-date-wrap') && !e.target?.closest?.('.date-picker-wrap')) {
      ['anchor-date', 'leave-day', 'manual-day'].forEach(id => $(id)?.blur());
    }
  });

  // Modal Body Scroll Lock & Mouse Wheel Isolation
  function syncModalScrollLock() {
    const hasOpenModal = !!document.querySelector('.studio-modal-backdrop:not([hidden])');
    document.body.classList.toggle('modal-open', hasOpenModal);
  }

  const modalObserver = new MutationObserver(() => syncModalScrollLock());
  document.querySelectorAll('.studio-modal-backdrop').forEach(modal => {
    modalObserver.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
    modal.addEventListener('wheel', (e) => {
      const scrollable = e.target.closest('.leave-table-container, .settings-tab-content, .studio-modal-body, .cal-modal-body, textarea');
      if (!scrollable) {
        e.preventDefault();
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = scrollable;
      const isAtTop = scrollTop <= 0 && e.deltaY < 0;
      const isAtBottom = (scrollTop + clientHeight >= scrollHeight - 1) && e.deltaY > 0;
      if (isAtTop || isAtBottom) {
        e.preventDefault();
      }
    }, { passive: false });
  });
  syncModalScrollLock();

  $('form-manual-work')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const day = $('manual-day').value;
    const title = $('manual-title').value.trim();
    const hours = parseFloat($('manual-hours').value);

    await send({
      type: 'manual.save',
      entry: { day, title, hours },
      profile: currentSnapshot?.profile,
    });
    $('modal-manual-work').hidden = true;
    showToast('Đã lưu việc ngoài!', 'success');
    await refreshAllData(true);
  });

  // Stepper for Manual Work Modal
  $('btn-manual-hours-dec')?.addEventListener('click', () => adjustManualHours(-0.5));
  $('btn-manual-hours-inc')?.addEventListener('click', () => adjustManualHours(0.5));

  // Leave Modal Event Handlers
  $('btn-open-leave-modal')?.addEventListener('click', openLeaveModal);
  $('btn-close-leave')?.addEventListener('click', closeLeaveModal);
  $('btn-done-leave')?.addEventListener('click', closeLeaveModal);
  $('btn-leave-cancel-edit')?.addEventListener('click', () => {
    resetLeaveForm();
    renderLeaves();
  });

  // Calendar Modal Event Handlers
  $('btn-open-calendar-modal')?.addEventListener('click', openCalendarModal);
  $('btn-close-calendar-modal')?.addEventListener('click', closeCalendarModal);
  $('btn-done-calendar-modal')?.addEventListener('click', closeCalendarModal);
  $('btn-cal-modal-prev')?.addEventListener('click', () => {
    calModalActiveDay = shiftMonth(calModalActiveDay, -1);
    renderCalendarModal(calModalActiveDay);
  });
  $('btn-cal-modal-next')?.addEventListener('click', () => {
    calModalActiveDay = shiftMonth(calModalActiveDay, 1);
    renderCalendarModal(calModalActiveDay);
  });
  $('btn-cal-modal-today')?.addEventListener('click', () => {
    calModalActiveDay = today();
    renderCalendarModal(calModalActiveDay);
  });

  // Stepper & Presets for Leave Modal
  $('btn-leave-hours-dec')?.addEventListener('click', () => adjustLeaveHours(-0.5));
  $('btn-leave-hours-inc')?.addEventListener('click', () => adjustLeaveHours(0.5));
  $('leave-hours')?.addEventListener('input', (e) => updateLeavePresetChips(e.target.value));

  document.querySelectorAll('.leave-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const hours = parseFloat(chip.dataset.hours);
      if ($('leave-hours')) $('leave-hours').value = hours;
      updateLeavePresetChips(hours);
    });
  });

  $('btn-leave-filter-month')?.addEventListener('click', () => {
    leaveFilterMode = 'month';
    $('btn-leave-filter-month')?.classList.add('active');
    $('btn-leave-filter-all')?.classList.remove('active');
    renderLeaves();
  });

  $('btn-leave-filter-all')?.addEventListener('click', () => {
    leaveFilterMode = 'all';
    $('btn-leave-filter-all')?.classList.add('active');
    $('btn-leave-filter-month')?.classList.remove('active');
    renderLeaves();
  });

  $('form-leave')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const day = $('leave-day').value;
    const reason = $('leave-reason').value.trim();
    const hours = parseFloat($('leave-hours').value);

    try {
      await send({
        type: 'leave.save',
        id: editingLeaveId,
        entry: { day, reason, hours },
      });
      showToast(editingLeaveId ? 'Đã cập nhật lịch nghỉ phép!' : 'Đã thêm ngày nghỉ phép!', 'success');
      resetLeaveForm();
      await refreshAllData(true);
      await renderLeaves();
    } catch (err) {
      showToast(err.message || 'Lỗi khi lưu lịch nghỉ', 'error');
    }
  });

  // Initial Data Fetch & Date Displays Setup
  await refreshAllData(false);
  updateModalDateDisplays();
});
