import { CHORDS_BY_ID, OPEN_CHORDS, voicingMidi, type ChordDef } from './chords';
import { spectrumToChroma } from './chroma';
import { buildTemplates, confidenceOf, rankChords, type ChordTemplate } from './matcher';
import { ChordStabilizer } from './stabilizer';

export type DetectorStatus = 'idle' | 'starting' | 'listening' | 'error';

/**
 * `time` is when the chord was committed; `strumTime` is the attack that produced it
 * (the most recent onset before the commit), which is what rhythm scoring should use.
 */
export type ChordChangeListener = (chordId: string, time: number, strumTime: number) => void;
export type OnsetListener = (time: number) => void;
export type ClickKind = 'down' | 'beat' | 'count';

export interface CandidateView {
  id: string;
  similarity: number;
  confidence: number;
}

export interface DetectorSnapshot {
  status: DetectorStatus;
  error: string | null;
  /** Last chord held steadily enough to report. Kept through silence. */
  chordId: string | null;
  confidence: number;
  /** True while that chord is ringing right now (vs. being the last one heard). */
  live: boolean;
  candidates: CandidateView[];
  levelDb: number;
  tuningCents: number | null;
}

/** ~340 ms window at 48 kHz: ~3 Hz bins, enough to separate low E from F. */
const FFT_SIZE = 16384;
const CHROMA_SMOOTHING = 0.6;
const MIN_SIMILARITY = 0.75;
/** Frames (at ~60 fps) a chord must stay on top before it's reported. */
const HOLD_FRAMES = 6;
const EMIT_INTERVAL_MS = 66;
const SILENT_DB = -100;

/** ~21 ms window for strum attacks. */
const ONSET_FFT_SIZE = 1024;
/** Onsets are detected below this, so metronome clicks (3 kHz+) don't register as strums. */
const ONSET_LOWPASS_HZ = 1200;
/** A strum is a rise of this much over the quietest level in the last ONSET_LOOKBACK_MS. */
const ONSET_RISE_DB = 6;
const ONSET_LOOKBACK_MS = 150;
const ONSET_REFRACTORY_MS = 120;
/** …and the level must still be climbing frame to frame (a ringing chord isn't). */
const ONSET_STEP_DB = 2;
/** How far back from a chord commit to look for the strum that caused it. */
const STRUM_SEARCH_MS = 800;
/** Used when no onset was found: typical strum-to-commit delay. */
const FALLBACK_COMMIT_DELAY_MS = 250;

const CLICK_HZ: Record<ClickKind, number> = { down: 4000, beat: 3200, count: 2700 };

const INITIAL_SNAPSHOT: DetectorSnapshot = {
  status: 'idle',
  error: null,
  chordId: null,
  confidence: 0,
  live: false,
  candidates: [],
  levelDb: SILENT_DB,
  tuningCents: null,
};

interface Graph {
  ctx: AudioContext;
  /** Everything to be analysed (microphone, test strums) goes into this node. */
  input: GainNode;
  analyser: AnalyserNode;
  onsetAnalyser: AnalyserNode;
}

/**
 * Owns the audio graph and analysis loop. Lives outside React; components read
 * snapshots through subscribe/getSnapshot, and the visualizer reads `chroma` directly
 * every animation frame.
 */
export class DetectorEngine {
  /** Smoothed chroma of the current input, for drawing. */
  readonly chroma = new Float32Array(12);

  private raw = new Float32Array(12);
  private graph: Graph | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private freq = new Float32Array(FFT_SIZE / 2);
  private time = new Float32Array(FFT_SIZE);
  private onsetTime = new Float32Array(ONSET_FFT_SIZE);
  private recentShort: { t: number; db: number }[] = [];
  private lastOnset = -Infinity;
  private prevShortDb = -Infinity;
  private testVoice: GainNode | null = null;
  private onsets: number[] = [];
  private rafId = 0;
  private templates: ChordTemplate[] = buildTemplates(OPEN_CHORDS);
  private gateDb = -50;
  private stabilizer = new ChordStabilizer(HOLD_FRAMES);
  private tuning: number | null = null;
  private lastEmit = 0;
  private snapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private chordListeners = new Set<ChordChangeListener>();
  private onsetListeners = new Set<OnsetListener>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Fires the moment a new chord is committed, with performance.now() timestamps.
   * Use this rather than snapshots when timing matters; snapshots are throttled.
   */
  onChordChange(listener: ChordChangeListener): () => void {
    this.chordListeners.add(listener);
    return () => {
      this.chordListeners.delete(listener);
    };
  }

  /** Fires on each strum attack, whether or not it changes the chord. */
  onOnset(listener: OnsetListener): () => void {
    this.onsetListeners.add(listener);
    return () => {
      this.onsetListeners.delete(listener);
    };
  }

  getSnapshot = () => this.snapshot;

  setChordSet(chordIds: string[]): void {
    const chords = chordIds.flatMap((id) => CHORDS_BY_ID.get(id) ?? []);
    this.templates = buildTemplates(chords.length > 0 ? chords : OPEN_CHORDS);
    this.stabilizer.reset();
    this.update({ chordId: null, confidence: 0, live: false, candidates: [] });
  }

  setGate(gateDb: number): void {
    this.gateDb = gateDb;
  }

  async start(): Promise<void> {
    if (this.snapshot.status === 'starting' || this.snapshot.status === 'listening') return;
    this.update({ status: 'starting', error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Browser voice processing smears and gates the very signal we want to analyse.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const { ctx, input } = this.ensureGraph();
      this.stream = stream;
      this.source = ctx.createMediaStreamSource(stream);
      this.source.connect(input);
      await ctx.resume();
      this.update({ status: 'listening' });
      this.startLoop();
    } catch (err) {
      this.teardown();
      this.update({ status: 'error', error: describeError(err) });
    }
  }

  stop(): void {
    this.teardown();
    this.update({ ...INITIAL_SNAPSHOT, chordId: this.snapshot.chordId });
  }

  /** Make sure the audio clock is running, e.g. before scheduling clicks. Call from a user gesture. */
  async prepareAudio(): Promise<void> {
    const { ctx } = this.ensureGraph();
    await ctx.resume();
    this.startLoop();
  }

  /**
   * Schedule a metronome tick to be *heard* at `atPerfMs` (performance.now() clock).
   * High-pitched so the chord and onset analysis ignore it if the mic picks it up.
   */
  scheduleClick(atPerfMs: number, kind: ClickKind): void {
    const { ctx } = this.ensureGraph();
    const when = this.perfToContextTime(ctx, atPerfMs);
    if (when < ctx.currentTime) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = CLICK_HZ[kind];
    const peak = kind === 'down' ? 0.35 : 0.22;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  /** Short sine cue to the speakers only (not into the analyser). */
  beep(frequency: number, durationSec = 0.12): void {
    const { ctx } = this.ensureGraph();
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  /** Development aid: strum a synthesized voicing into the analyser (and speakers). */
  playTestChord(chord: ChordDef): void {
    const { ctx, input } = this.ensureGraph();
    void ctx.resume();
    const harmonics = 9;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let h = 1; h < harmonics; h++) imag[h] = 0.6 ** (h - 1);
    const wave = ctx.createPeriodicWave(real, imag);
    const now = ctx.currentTime;
    // Damp the previous strum, like a real re-strum or chord change does.
    if (this.testVoice) {
      this.testVoice.gain.setTargetAtTime(0, now, 0.01);
      const old = this.testVoice;
      setTimeout(() => old.disconnect(), 200);
    }
    const out = ctx.createGain();
    out.connect(input);
    out.connect(ctx.destination);
    this.testVoice = out;
    voicingMidi(chord).forEach((midi, i) => {
      const start = now + i * 0.015;
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      const gain = ctx.createGain();
      // Pick transient, quick drop, then the long sustain of a ringing string.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 2.5);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + 2.6);
    });
    this.startLoop();
  }

  private ensureGraph(): Graph {
    if (!this.graph) {
      const ctx = new AudioContext();
      const input = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      input.connect(analyser);

      const onsetAnalyser = ctx.createAnalyser();
      onsetAnalyser.fftSize = ONSET_FFT_SIZE;
      onsetAnalyser.smoothingTimeConstant = 0;
      // Two cascaded low-passes (~24 dB/octave) keep the metronome out of onset detection.
      let node: AudioNode = input;
      for (let i = 0; i < 2; i++) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = ONSET_LOWPASS_HZ;
        node.connect(lowpass);
        node = lowpass;
      }
      node.connect(onsetAnalyser);
      this.graph = { ctx, input, analyser, onsetAnalyser };
    }
    return this.graph;
  }

  private perfToContextTime(ctx: AudioContext, perfMs: number): number {
    const ts = ctx.getOutputTimestamp();
    if (ts.contextTime && ts.performanceTime) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    const outputLatency = ctx.outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime + (perfMs - performance.now()) / 1000 - outputLatency;
  }

  private teardown(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    void this.graph?.ctx.close();
    this.stream = null;
    this.source = null;
    this.graph = null;
    this.testVoice = null;
    this.chroma.fill(0);
    this.recentShort = [];
    this.onsets = [];
  }

  private startLoop(): void {
    if (!this.rafId) this.rafId = requestAnimationFrame(this.tick);
  }

  private detectOnset(onsetAnalyser: AnalyserNode, now: number): void {
    onsetAnalyser.getFloatTimeDomainData(this.onsetTime);
    let energy = 0;
    for (const x of this.onsetTime) energy += x * x;
    const db = 10 * Math.log10(energy / this.onsetTime.length + 1e-12);

    this.recentShort = this.recentShort.filter((s) => now - s.t <= ONSET_LOOKBACK_MS);
    let floor = Infinity;
    for (const s of this.recentShort) floor = Math.min(floor, s.db);

    const rising = db - this.prevShortDb >= ONSET_STEP_DB;
    this.prevShortDb = db;
    if (
      rising &&
      db >= this.gateDb &&
      db - floor >= ONSET_RISE_DB &&
      now - this.lastOnset >= ONSET_REFRACTORY_MS
    ) {
      this.lastOnset = now;
      this.onsets.push(now);
      if (this.onsets.length > 32) this.onsets.shift();
      // Forget the pre-strum quiet, or the chord's own ring re-triggers once the refractory ends.
      this.recentShort = [];
      this.onsetListeners.forEach((l) => l(now));
    }
    this.recentShort.push({ t: now, db });
  }

  private strumTimeFor(commitTime: number): number {
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const t = this.onsets[i];
      if (t <= commitTime && commitTime - t <= STRUM_SEARCH_MS) return t;
    }
    return commitTime - FALLBACK_COMMIT_DELAY_MS;
  }

  private tick = (now: number) => {
    this.rafId = 0;
    const { graph } = this;
    if (!graph) return;
    const { ctx, analyser, onsetAnalyser } = graph;

    this.detectOnset(onsetAnalyser, now);

    analyser.getFloatFrequencyData(this.freq);
    analyser.getFloatTimeDomainData(this.time);
    let energy = 0;
    for (const x of this.time) energy += x * x;
    const levelDb = Math.max(SILENT_DB, 10 * Math.log10(energy / this.time.length + 1e-12));
    const audible = levelDb >= this.gateDb;

    let candidates = this.snapshot.candidates;
    let topId: string | null = null;
    if (audible) {
      const { tuningCents, peakCount } = spectrumToChroma(this.freq, ctx.sampleRate, this.raw);
      for (let i = 0; i < 12; i++) {
        this.chroma[i] = CHROMA_SMOOTHING * this.chroma[i] + (1 - CHROMA_SMOOTHING) * this.raw[i];
      }
      const ranked = rankChords(this.chroma, this.templates);
      if (ranked[0] && ranked[0].similarity >= MIN_SIMILARITY) topId = ranked[0].chord.id;
      candidates = ranked.slice(0, 4).map((c) => ({
        id: c.chord.id,
        similarity: c.similarity,
        confidence: confidenceOf(c),
      }));
      if (peakCount >= 3) {
        this.tuning = this.tuning === null ? tuningCents : 0.95 * this.tuning + 0.05 * tuningCents;
      }
    } else {
      for (let i = 0; i < 12; i++) this.chroma[i] *= 0.92;
    }

    const previousId = this.snapshot.chordId;
    const chordId = this.stabilizer.push(topId);
    const live = audible && chordId !== null && topId === chordId;
    const current = candidates.find((c) => c.id === chordId);
    const confidence = live && current ? current.confidence : this.snapshot.confidence;
    if (chordId !== previousId && chordId !== null) {
      const strumTime = this.strumTimeFor(now);
      this.chordListeners.forEach((l) => l(chordId, now, strumTime));
    }

    if (chordId !== previousId || live !== this.snapshot.live || now - this.lastEmit >= EMIT_INTERVAL_MS) {
      this.lastEmit = now;
      this.update({
        chordId,
        live,
        confidence,
        candidates: audible ? candidates : this.snapshot.candidates,
        levelDb,
        tuningCents: this.tuning,
      });
    }
    this.startLoop();
  };

  private update(patch: Partial<DetectorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in your browser’s site settings and try again.';
    if (err.name === 'NotFoundError') return 'No microphone was found. Plug one in and try again.';
    if (err.name === 'NotReadableError') return 'The microphone is in use by another application.';
  }
  return err instanceof Error ? err.message : String(err);
}
