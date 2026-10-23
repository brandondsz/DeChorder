import { useEffect, useRef } from 'react';
import { chordPitchClasses, chordTemplate, PITCH_CLASS_NAMES, type ChordDef } from '../audio/chords';

interface Props {
  chroma: Float32Array;
  /** Detected chord: its notes are highlighted and its expected profile drawn as markers. */
  chord: ChordDef | null;
}

const LABEL_HEIGHT = 22;

/** 12 pitch-class bars, redrawn every animation frame from the engine's live chroma. */
export function ChromaVisualizer({ chroma, chord }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chordRef = useRef(chord);
  chordRef.current = chord;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let templateFor: ChordDef | null = null;
    let template: Float32Array | null = null;
    let notes = new Set<number>();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const current = chordRef.current;
      if (current !== templateFor) {
        templateFor = current;
        template = current ? chordTemplate(current) : null;
        notes = current ? chordPitchClasses(current) : new Set();
      }

      const styles = getComputedStyle(canvas);
      const colors = {
        bar: styles.getPropertyValue('--chroma-bar'),
        note: styles.getPropertyValue('--accent'),
        track: styles.getPropertyValue('--chroma-track'),
        marker: styles.getPropertyValue('--text'),
        label: styles.getPropertyValue('--text-muted'),
        labelActive: styles.getPropertyValue('--text'),
      };

      let peak = 0;
      for (const v of chroma) peak = Math.max(peak, v);
      let templatePeak = 0;
      if (template) for (const v of template) templatePeak = Math.max(templatePeak, v);

      const slot = width / 12;
      const barWidth = Math.min(36, slot * 0.62);
      const barTop = 6;
      const barHeight = height - LABEL_HEIGHT - barTop;
      ctx.font = `600 12px ${styles.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let pc = 0; pc < 12; pc++) {
        const cx = slot * (pc + 0.5);
        const left = cx - barWidth / 2;
        ctx.fillStyle = colors.track;
        roundRect(ctx, left, barTop, barWidth, barHeight, 4);

        const value = peak > 0.05 ? chroma[pc] / peak : 0;
        const h = value * barHeight;
        if (h > 0.5) {
          ctx.fillStyle = notes.has(pc) ? colors.note : colors.bar;
          roundRect(ctx, left, barTop + barHeight - h, barWidth, h, 4);
        }

        if (template && templatePeak > 0) {
          const y = barTop + barHeight - (template[pc] / templatePeak) * barHeight;
          ctx.fillStyle = colors.marker;
          ctx.fillRect(left - 3, y - 1, barWidth + 6, 2);
        }

        ctx.fillStyle = notes.has(pc) ? colors.labelActive : colors.label;
        ctx.fillText(PITCH_CLASS_NAMES[pc], cx, height - LABEL_HEIGHT / 2);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [chroma]);

  return (
    <canvas
      ref={canvasRef}
      className="chroma-canvas"
      role="img"
      aria-label="Live pitch-class energy, C through B"
    />
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2));
  ctx.fill();
}
