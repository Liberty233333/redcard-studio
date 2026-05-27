export interface AvatarCompositeOptions {
  accountName?: string;
  position?: 'bottom-left' | 'bottom-right';
  width?: number;
  height?: number;
  avatarSize?: number;
  marginX?: number;
  marginBottom?: number;
  gap?: number;
  accountNameFontSize?: number;
  accentColor?: string;
}

export interface CoverPaletteSelection {
  family: 'red' | 'amber' | 'blue' | 'neon';
  bgMode: 'light' | 'dark';
}

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1440;
const DEFAULT_AVATAR_SIZE = 72;
const DEFAULT_MARGIN_X = 64;
const DEFAULT_MARGIN_BOTTOM = 20;
const DEFAULT_GAP = 14;
const DEFAULT_ACCOUNT_NAME_FONT_SIZE = 22;

const ACCENT_BY_PALETTE: Record<string, string> = {
  'red-light': '#B82828',
  'red-dark': '#E40C0C',
  'amber-light': '#D97706',
  'amber-dark': '#D97706',
  'blue-light': '#1F4FA8',
  'blue-dark': '#1E40AF',
  'neon-dark': '#FCFC0C',
};

export function getAccentColor(palette: CoverPaletteSelection): string {
  return ACCENT_BY_PALETTE[`${palette.family}-${palette.bgMode}`] ?? '#B82828';
}

export async function compositeAvatar(
  coverDataUrl: string,
  avatarDataUrl: string,
  options: AvatarCompositeOptions = {}
): Promise<string> {
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const avatarSize = options.avatarSize || DEFAULT_AVATAR_SIZE;
  const marginX = options.marginX || DEFAULT_MARGIN_X;
  const marginBottom = options.marginBottom || DEFAULT_MARGIN_BOTTOM;
  const gap = options.gap || DEFAULT_GAP;
  const accountName = options.accountName || '';
  const accountNameFontSize = options.accountNameFontSize || DEFAULT_ACCOUNT_NAME_FONT_SIZE;
  const accentColor = options.accentColor || '#B82828';
  const position = options.position || 'bottom-right';

  const canvas = createCanvas(width, height);
  const ctx = get2dContext(canvas);
  const cover = await loadCanvasImage(coverDataUrl);
  const avatar = await loadCanvasImage(avatarDataUrl);

  ctx.drawImage(cover, 0, 0, width, height);

  const avatarX = position === 'bottom-left'
    ? marginX
    : width - marginX - avatarSize;
  const avatarY = height - marginBottom - avatarSize;
  const textX = position === 'bottom-left'
    ? avatarX + avatarSize + gap
    : avatarX - gap;
  const textAlign: CanvasTextAlign = position === 'bottom-left' ? 'left' : 'right';
  const textY = avatarY + avatarSize / 2 + 4;
  const labelStyle = pickAccountLabelStyle(ctx, 0, height - 260, width, 220, accentColor);

  drawCircularAvatar(ctx, avatar, avatarX, avatarY, avatarSize, accentColor);
  if (accountName) {
    drawAccountName(ctx, accountName, textX, textY, labelStyle, textAlign, accountNameFontSize);
  }

  return canvasToDataUrl(canvas);
}

export function pickContrastColor(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): '#1F2937' | '#FFFFFF' {
  const data = ctx.getImageData(x, y, width, height).data;
  let total = 0;
  let samples = 0;
  const stride = 16;
  for (let i = 0; i < data.length; i += 4 * stride) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    samples += 1;
  }
  const average = samples ? total / samples : 255;
  return average > 145 ? '#1F2937' : '#FFFFFF';
}

interface AccountLabelStyle {
  fill: string;
  stroke: string;
  shadow: string;
}

function pickAccountLabelStyle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  accentColor: string
): AccountLabelStyle {
  const contrast = pickContrastColor(ctx, x, y, width, height);
  if (contrast === '#FFFFFF') {
    return {
      fill: '#F8F1E7',
      stroke: 'rgba(47, 24, 20, 0.32)',
      shadow: 'rgba(0, 0, 0, 0.28)',
    };
  }

  return {
    fill: softenDarkText(accentColor),
    stroke: 'rgba(255, 248, 235, 0.52)',
    shadow: 'rgba(255, 255, 255, 0.18)',
  };
}

function softenDarkText(accentColor: string): string {
  const normalized = accentColor.toUpperCase();
  if (normalized.startsWith('#1F') || normalized.startsWith('#1E')) return '#203C78';
  if (normalized === '#FCFC0C') return '#5F5C12';
  if (normalized === '#D97706') return '#8A4F13';
  return '#7D2420';
}

function drawCircularAvatar(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  avatar: CanvasImageSource,
  x: number,
  y: number,
  size: number,
  accentColor: string
) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.12)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, x, y, size, size);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawAccountName(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  accountName: string,
  x: number,
  y: number,
  style: AccountLabelStyle,
  align: CanvasTextAlign,
  fontSize: number
) {
  ctx.save();
  ctx.font = `500 ${fontSize}px "Songti SC", "STSong", "Noto Serif CJK SC", "PingFang SC", serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = '0.02em';
  }
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = style.shadow;
  ctx.shadowBlur = 3;
  ctx.strokeText(accountName, x, y);
  ctx.fillStyle = style.fill;
  ctx.fillText(accountName, x, y);
  ctx.restore();
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2dContext(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

async function loadCanvasImage(dataUrl: string): Promise<CanvasImageSource> {
  const blob = await (await fetch(dataUrl)).blob();
  if (typeof createImageBitmap !== 'undefined') return createImageBitmap(blob);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = dataUrl;
  });
}

async function canvasToDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blobToDataUrl(blob);
  }
  return canvas.toDataURL('image/png');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
