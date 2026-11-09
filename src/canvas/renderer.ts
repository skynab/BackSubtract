import type { RgbaImage } from '../export/background';
import type { Mask, Mode, Rect } from '../mask/mask';
import type { View } from './view';

const VERTEX = `#version 300 es
in vec2 a_pos;
/** The area drawn, in image px (x, y, w, h): the image, or a download's frame, which can reach past it. */
uniform vec4 u_frame;
uniform float u_scale;
uniform vec2 u_offset;
uniform vec2 u_viewport;
out vec2 v_px;
void main() {
  vec2 px = u_frame.xy + a_pos * u_frame.zw;
  vec2 css = px * u_scale + u_offset;
  vec2 clip = css / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_px = px;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_px;
uniform vec2 u_imageSize;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform sampler2D u_preview;
/** 0: no preview, 1: Keep, -1: Remove. */
uniform float u_previewMode;
uniform vec3 u_previewTint;
uniform float u_ghost;
uniform float u_original;
uniform float u_checkerSize;
/** Shifts the checkerboard, in device px, so it can slide. */
uniform vec2 u_checkerOffset;
uniform vec3 u_checkerA;
uniform vec3 u_checkerB;
/** Behind the image: 0 the checkerboard, 1 a colour, 2 a picture over u_bgRect (image px). */
uniform int u_bgMode;
uniform vec3 u_bgColor;
uniform sampler2D u_bg;
uniform vec4 u_bgRect;
/** The area with something in it (image px); beyond it, the canvas background. Wider than u_frame only in the loupe. */
uniform vec4 u_content;
uniform vec3 u_canvasBg;
/** The touch loupe's circle (device px: x, y from the bottom, radius); radius 0 when not drawing it. */
uniform vec3 u_loupe;
out vec4 outColor;
void main() {
  vec2 uv = v_px / u_imageSize;
  // Outside the image (a frame reaching past it) there is only background.
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float within = inside.x * inside.y;
  vec4 color = texture(u_image, uv) * within;
  float m = texture(u_mask, uv).r * within;
  // Show the mask as it would be after the previewed tap, and tint what would change.
  float change = 0.0;
  if (u_previewMode != 0.0) {
    float s = texture(u_preview, uv).r;
    float next = u_previewMode > 0.0 ? max(m, s) : min(m, 1.0 - s);
    change = abs(next - m);
    m = next;
  }
  m = mix(m, 1.0, u_original);
  m = m + (1.0 - m) * u_ghost;
  vec3 bg;
  if (u_bgMode == 1) {
    bg = u_bgColor;
  } else if (u_bgMode == 2) {
    bg = texture(u_bg, (v_px - u_bgRect.xy) / u_bgRect.zw).rgb;
  } else {
    vec2 cell = floor((gl_FragCoord.xy + u_checkerOffset) / u_checkerSize);
    bg = mod(cell.x + cell.y, 2.0) < 1.0 ? u_checkerA : u_checkerB;
  }
  vec3 rgb = mix(bg, color.rgb, color.a * m);
  outColor = vec4(mix(rgb, u_previewTint, change * 0.45), 1.0);
  vec2 cin = step(u_content.xy, v_px) * step(v_px, u_content.xy + u_content.zw);
  if (cin.x * cin.y < 0.5) outColor = vec4(u_canvasBg, 1.0);
  if (u_loupe.z > 0.0 && distance(gl_FragCoord.xy, u_loupe.xy) > u_loupe.z) discard;
}`;

export type RGB = [number, number, number];

export interface RenderParams {
  view: View;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  /** 0–1: how strongly removed areas show through. */
  ghost: number;
  /** 1 shows the untouched original. */
  original: number;
  /** A previewed tap: what it would do, and the tint for the area it would change. */
  preview: { mode: Mode; tint: RGB } | null;
  background: RGB;
  checkerA: RGB;
  checkerB: RGB;
  /** How far the checkerboard has slid, in CSS px. */
  checkerOffset: [number, number];
  /** The area to draw (image px); the whole image when left out. */
  frame?: Rect;
  /** What shows behind the image in place of the checkerboard: a colour, or the picture from setBackdrop over `rect` (image px). */
  fill?: { kind: 'color'; color: RGB } | { kind: 'texture'; rect: Rect };
  /** Touch loupe: a circle (CSS px) drawn again with its own view, over the rest. */
  loupe?: { centre: { x: number; y: number }; radius: number; view: View };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed');
  }
  return shader;
}

/**
 * Draws the original image with the hidden mask applied, over a transparency
 * checkerboard (or, while the Download menu is open, over the download's background).
 */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private imageTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private previewTex: WebGLTexture;
  private bgTex: WebGLTexture;
  private imageSize: [number, number] | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
    }
    this.program = program;
    for (const name of [
      'u_imageSize', 'u_frame', 'u_scale', 'u_offset', 'u_viewport', 'u_image', 'u_mask',
      'u_ghost', 'u_original', 'u_checkerSize', 'u_checkerOffset', 'u_checkerA', 'u_checkerB',
      'u_preview', 'u_previewMode', 'u_previewTint', 'u_bgMode', 'u_bgColor', 'u_bg', 'u_bgRect',
      'u_content', 'u_canvasBg', 'u_loupe',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.imageTex = this.createTexture(gl.LINEAR_MIPMAP_LINEAR);
    this.maskTex = this.createTexture(gl.LINEAR);
    this.previewTex = this.createTexture(gl.LINEAR);
    this.bgTex = this.createTexture(gl.LINEAR_MIPMAP_LINEAR);
    // One pixel until there is a picture, so the texture is complete whenever the shader is used.
    this.setBackdrop({ data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 });
  }

  private createTexture(minFilter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  setImage(image: ImageBitmap, mask: Mask): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    this.imageSize = [image.width, image.height];
  }

  /** Upload only the changed part of the mask. */
  updateMask(mask: Mask, rect: Rect): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, mask.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /** Upload a previewed selection (a full-size plane). */
  setPreview(data: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.previewTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  /** Upload the picture shown behind the image (a download's Image or Blur background). */
  setBackdrop(source: ImageBitmap | RgbaImage): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (source instanceof ImageBitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  render(p: RenderParams): void {
    const gl = this.gl;
    const u = this.uniforms;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(...p.background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.imageSize) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(u.u_imageSize, ...this.imageSize);
    const frame = p.frame ?? { x: 0, y: 0, w: this.imageSize[0], h: this.imageSize[1] };
    gl.uniform4f(u.u_frame, frame.x, frame.y, frame.w, frame.h);
    gl.uniform4f(u.u_content, frame.x, frame.y, frame.w, frame.h);
    gl.uniform3f(u.u_canvasBg, ...p.background);
    gl.uniform3f(u.u_loupe, 0, 0, 0);
    gl.uniform1f(u.u_scale, p.view.scale);
    gl.uniform2f(u.u_offset, p.view.x, p.view.y);
    gl.uniform2f(u.u_viewport, p.width, p.height);
    gl.uniform1f(u.u_ghost, p.ghost);
    gl.uniform1f(u.u_original, p.original);
    gl.uniform1f(u.u_checkerSize, 8 * p.dpr);
    // Kept within one two-cell period, so it never loses precision however long it runs.
    const period = 16 * p.dpr;
    gl.uniform2f(u.u_checkerOffset, (p.checkerOffset[0] * p.dpr) % period, (p.checkerOffset[1] * p.dpr) % period);
    gl.uniform3f(u.u_checkerA, ...p.checkerA);
    gl.uniform3f(u.u_checkerB, ...p.checkerB);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(u.u_image, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(u.u_mask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.previewTex);
    gl.uniform1i(u.u_preview, 2);
    gl.uniform1f(u.u_previewMode, p.preview ? (p.preview.mode === 'keep' ? 1 : -1) : 0);
    gl.uniform3f(u.u_previewTint, ...(p.preview?.tint ?? [0, 0, 0]));
    gl.uniform1i(u.u_bgMode, p.fill?.kind === 'color' ? 1 : p.fill?.kind === 'texture' ? 2 : 0);
    gl.uniform3f(u.u_bgColor, ...(p.fill?.kind === 'color' ? p.fill.color : ([0, 0, 0] as RGB)));
    const bgRect = p.fill?.kind === 'texture' ? p.fill.rect : frame;
    gl.uniform4f(u.u_bgRect, bgRect.x, bgRect.y, bgRect.w, bgRect.h);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(u.u_bg, 3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (p.loupe) {
      // Again, at the loupe's zoom, over a quad covering the whole circle and only inside it.
      const { centre, radius, view } = p.loupe;
      const d = radius * 2;
      gl.uniform4f(u.u_frame, (centre.x - radius - view.x) / view.scale, (centre.y - radius - view.y) / view.scale, d / view.scale, d / view.scale);
      gl.uniform1f(u.u_scale, view.scale);
      gl.uniform2f(u.u_offset, view.x, view.y);
      gl.uniform3f(u.u_loupe, centre.x * p.dpr, (p.height - centre.y) * p.dpr, radius * p.dpr);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.floor((centre.x - radius) * p.dpr),
        Math.floor((p.height - centre.y - radius) * p.dpr),
        Math.ceil(d * p.dpr) + 1,
        Math.ceil(d * p.dpr) + 1,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.imageTex);
    gl.deleteTexture(this.maskTex);
    gl.deleteTexture(this.previewTex);
    gl.deleteTexture(this.bgTex);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}

/** Read a `#rrggbb` CSS custom property as 0–1 RGB. */
export function cssColor(name: string, fallback: RGB): RGB {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : fallback;
}
