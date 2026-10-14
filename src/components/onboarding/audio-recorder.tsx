"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AUDIO_BYTES } from "@/lib/onboarding/audio-upload";
import type { AudioGuideQuestion } from "@/lib/onboarding/audio-guide";
import { Icon } from "@/components/dashboard/icon";
import "@/components/business-assistant/voice-recorder.css";

const WAVE_BARS = 46;
let primedCapture: Promise<MediaStream> | null = null;

export function primeVoiceCapture() {
  if (primedCapture || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
  primedCapture = navigator.mediaDevices.getUserMedia({ audio: true });
}

export function AudioRecorder({
  busy,
  onAnalyze,
  questions,
  onBack,
  analyzeLabel = "Analizo biznesin →",
  purpose = "onboarding",
  variant = "onboarding",
}: {
  busy: boolean;
  onAnalyze: (file: File) => Promise<void>;
  questions?: AudioGuideQuestion[];
  onBack?: () => void;
  analyzeLabel?: string;
  purpose?: "onboarding" | "request";
  variant?: "onboarding" | "assistant";
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const analysisInFlight = useRef(false);
  const analyzeCallback = useRef(onAnalyze);
  useEffect(() => { analyzeCallback.current = onAnalyze; }, [onAnalyze]);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const session = useRef(0);
  const discarded = useRef(false);
  const acceptOnStop = useRef(false);
  const started = useRef(false);
  const startRef = useRef<() => void>(() => {});
  const audioContext = useRef<AudioContext | null>(null);
  const waveFrame = useRef(0);
  const wave = useRef<HTMLDivElement>(null);
  const bars = useRef<Array<HTMLElement | null>>([]);
  const [barCount, setBarCount] = useState(WAVE_BARS);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      cancelAnimationFrame(waveFrame.current);
      const context = audioContext.current;
      audioContext.current = null;
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const runAnalysis = useCallback(async (audio: File) => {
    if (!mounted.current || analysisInFlight.current) return;
    analysisInFlight.current = true;
    setAnalyzing(true);
    setError("");
    try {
      await analyzeCallback.current(audio);
    } catch {
      if (mounted.current) setError("Analiza nuk përfundoi. Provo përsëri ose plotëso me shkrim.");
    } finally {
      analysisInFlight.current = false;
      if (mounted.current) setAnalyzing(false);
    }
  }, []);
  function releaseWave() {
    cancelAnimationFrame(waveFrame.current);
    const context = audioContext.current;
    audioContext.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }
  function follow(media: MediaStream) {
    releaseWave();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof AudioContext === "undefined") return;
    const context = new AudioContext();
    audioContext.current = context;
    const source = context.createMediaStreamSource(media);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const draw = () => {
      if (audioContext.current !== context) return;
      analyser.getByteTimeDomainData(data);
      const count = bars.current.length || WAVE_BARS;
      const bucket = Math.max(1, Math.floor(data.length / count));
      for (let i = 0; i < count; i++) {
        let peak = 0;
        const offset = Math.min(i * bucket, data.length - bucket);
        for (let j = 0; j < bucket; j++) peak = Math.max(peak, Math.abs(data[offset + j] - 128));
        const bar = bars.current[i];
        if (!bar) continue;
        bar.style.animation = "none";
        bar.style.transform = `scaleY(${Math.min(1, 0.14 + peak / 26)})`;
      }
      waveFrame.current = requestAnimationFrame(draw);
    };
    void context.resume().then(() => {
      if (audioContext.current === context) waveFrame.current = requestAnimationFrame(draw);
    });
  }
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }
  function cancel() {
    discarded.current = true;
    acceptOnStop.current = false;
    session.current += 1;
    releaseWave();
    stop();
    setFile(null);
    setError("");
    onBack?.();
  }
  function accept() {
    if (busy || analyzing) return;
    if (file && !recording) {
      void runAnalysis(file);
      return;
    }
    if (recording) {
      acceptOnStop.current = true;
      stop();
      return;
    }
    void start();
  }
  async function start() {
    if (busy || analysisInFlight.current || requesting || recording) return;
    const id = ++session.current;
    discarded.current = false;
    acceptOnStop.current = false;
    setError("");
    setRequesting(true);
    setFile(null);
    setSeconds(0);
    try {
      const primed = primedCapture;
      primedCapture = null;
      if (
        !primed &&
        (!navigator.mediaDevices?.getUserMedia ||
          typeof MediaRecorder === "undefined")
      )
        throw new Error("unsupported");
      const media = await (primed ?? navigator.mediaDevices.getUserMedia({ audio: true }));
      if (!mounted.current || session.current !== id) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mime) throw new Error("unsupported");
      const rec = new MediaRecorder(media, {
        mimeType: mime,
        audioBitsPerSecond: 64000,
      });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      rec.ondataavailable = (event) => {
        size += event.data.size;
        if (size > MAX_AUDIO_BYTES) {
          failed = true;
          stop();
          if (mounted.current)
            setError(
              "Regjistrimi është shumë i madh. Provo një përshkrim më të shkurtër.",
            );
        } else if (event.data.size) chunks.push(event.data);
      };
      rec.onerror = () => {
        failed = true;
        stop();
        if (mounted.current)
          setError(
            "Regjistrimi u ndërpre. Provo përsëri ose vazhdo manualisht.",
          );
      };
      rec.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        releaseWave();
        if (timer.current) clearInterval(timer.current);
        if (!mounted.current || discarded.current) {
          discarded.current = false;
          return;
        }
        setRecording(false);
        if (!failed && size > 100) {
          const audio = new File(chunks, "business-audio", { type: rec.mimeType });
          setFile(audio);
          if (acceptOnStop.current) {
            acceptOnStop.current = false;
            void runAnalysis(audio);
          }
        } else if (!failed) setError("Nuk u regjistrua audio. Provo përsëri.");
      };
      media.getAudioTracks().forEach(
        (track) =>
          (track.onended = () => {
            if (rec.state === "recording") stop();
          }),
      );
      follow(media);
      rec.start(1000);
      setRecording(true);
      const began = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - began) / 1000);
        setSeconds(Math.min(elapsed, 120));
        if (elapsed >= 120) stop();
      }, 250);
    } catch (err) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current)
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Lejo mikrofonin nga cilësimet e browser-it, ose plotëso manualisht."
            : "Mikrofoni nuk është i disponueshëm. Provo në një browser me HTTPS ose vazhdo manualisht.",
        );
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }
  startRef.current = () => { void start(); };
  useEffect(() => {
    const element = wave.current;
    if (!element) return;
    const measure = () => {
      const next = Math.max(28, Math.min(120, Math.floor((element.clientWidth + 3) / 5)));
      setBarCount((current) => current === next ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [variant]);
  useEffect(() => {
    if (variant !== "assistant" || started.current) return;
    started.current = true;
    startRef.current();
  }, [variant]);
  if (variant === "assistant") {
    const processing = busy || analyzing;
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const status = requesting ? "Po hapim mikrofonin…" : recording ? "Po regjistrojmë" : processing ? "Po e kthejmë në tekst…" : file ? "Regjistrimi është gati" : "Fol me Agjentin";
    return (
      <div className="assistant-voice-slot">
        <div className={`assistant-voice ${recording ? "is-recording" : ""} ${processing ? "is-processing" : ""}`} role="group" aria-label="Regjistrimi me zë">
          <span className="assistant-voice-plus" aria-hidden="true"><Icon name="plus" size={18} /></span>
          <div className="assistant-voice-wave" ref={wave} aria-hidden="true">
            {Array.from({ length: barCount }, (_, index) => (
              <i key={index} ref={(element) => { bars.current[index] = element; }} style={{ animationDelay: `${(index % 8) * 70}ms` }} />
            ))}
          </div>
          <span className="assistant-voice-time">{clock}</span>
          <button type="button" className="assistant-voice-button" onClick={cancel} disabled={processing} aria-label="Anulo regjistrimin">
            <Icon name="close" size={18} />
          </button>
          <button type="button" className="assistant-voice-button is-confirm" onClick={accept} disabled={processing || requesting} aria-label={processing ? "Po e kthejmë në tekst" : recording || file ? "Përdor regjistrimin" : "Fillo regjistrimin"}>
            {processing ? <span className="assistant-voice-spinner" aria-hidden="true" /> : <Icon name="check" size={18} />}
          </button>
          <p className="assistant-voice-live" role="status">{status}</p>
        </div>
        {error && <p className="assistant-voice-error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <div className="onboarding-audio-layout">
      {questions && <section className="onboarding-audio-guide" aria-labelledby="audio-guide-title">
        <h2 id="audio-guide-title">Pyetjet për biznesin tënd</h2>
        <p>Përgjigju në një audio. Kapërce çfarë nuk vlen për biznesin tënd.</p>
        <ol>
          {questions.map((question) => (
            <li key={question.id}>
              <strong>{question.title}</strong>
              <span>{question.hint}</span>
            </li>
          ))}
        </ol>
      </section>}
      <div className={`onboarding-audio-box ${questions ? "is-guided" : ""}`}>
        <div
          className={`onboarding-mic ${recording ? "is-recording" : ""}`}
          aria-hidden="true"
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" />
          </svg>
        </div>
        <div className="onboarding-recording-status">
          {questions && <h2>{file ? "Audioja është gati" : "Regjistro përgjigjet"}</h2>}
          <p role="status">
            {recording
              ? "Duke regjistruar…"
              : busy || analyzing
                ? purpose === "request" ? "Po e kthejmë audion në tekst…" : "Po e kthejmë audion në tekst dhe po përgatisim profilin…"
                : file ? "Dëgjoje ose regjistro përsëri para se të vazhdosh."
                : questions ? "Fol me fjalët e tua, deri në 2 minuta."
                : purpose === "request" ? "Thuaj çfarë dëshiron të ndryshosh, deri në 2 minuta." : "Fol natyrshëm. Agjenti do ta përgatisë hapësirën për ty."}
          </p>
          <p className="onboarding-audio-time">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} /
            2:00
          </p>
        </div>
        {!questions && purpose === "onboarding" && <p>Mund të përmendësh çfarë ofron, si të kontaktojnë klientët dhe çfarë dëshiron të bëjë Agjenti.</p>}
        {url && <audio controls src={url} aria-label="Dëgjo regjistrimin tënd" />}
        <div className="onboarding-audio-buttons">
          {recording ? (
            <button type="button" className="onboarding-next" onClick={stop}>
              ■ Përfundo regjistrimin
            </button>
          ) : (
            <button
              type="button"
              className={file ? "onboarding-back" : "onboarding-next"}
              disabled={busy || analyzing || requesting}
              onClick={() => void start()}
            >
              {requesting
                ? "Duke hapur mikrofonin…"
                : file
                  ? "Regjistro përsëri"
                  : "Fillo regjistrimin"}
            </button>
          )}
          {!onBack && file && !recording && (
            <button
              type="button"
              className="onboarding-next"
              disabled={busy || analyzing}
              onClick={() => void runAnalysis(file)}
            >
              {busy || analyzing ? "Duke analizuar…" : analyzeLabel}
            </button>
          )}
        </div>
      </div>
      {onBack && <div className="onboarding-actions onboarding-audio-navigation">
        <button type="button" className="onboarding-back" disabled={busy || analyzing || requesting || recording} onClick={onBack}>Kthehu</button>
        <button type="button" className="onboarding-next" disabled={!file || recording || requesting || busy || analyzing}
          onClick={() => { if (file) void runAnalysis(file); }}>
          {busy || analyzing ? "Duke analizuar…" : analyzeLabel}
        </button>
      </div>}
      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
