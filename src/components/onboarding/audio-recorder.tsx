"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AUDIO_BYTES } from "@/lib/onboarding/audio-upload";
import type { AudioGuideQuestion } from "@/lib/onboarding/audio-guide";
import "@/components/business-assistant/voice-recorder.css";

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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
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
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }
  async function start() {
    if (busy || analysisInFlight.current || requesting || recording) return;
    setError("");
    setRequesting(true);
    setFile(null);
    setSeconds(0);
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error("unsupported");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
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
        if (timer.current) clearInterval(timer.current);
        if (!mounted.current) return;
        setRecording(false);
        if (!failed && size > 100)
          setFile(new File(chunks, "business-audio", { type: rec.mimeType }));
        else if (!failed) setError("Nuk u regjistrua audio. Provo përsëri.");
      };
      media.getAudioTracks().forEach(
        (track) =>
          (track.onended = () => {
            if (rec.state === "recording") stop();
          }),
      );
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
  if (variant === "assistant") {
    const processing = busy || analyzing;
    const unavailable = processing || requesting;
    const micLabel = requesting ? "Duke hapur mikrofonin" : file ? "Regjistro përsëri" : "Fillo regjistrimin";
    return (
      <div className={`assistant-voice ${recording ? "is-recording" : ""} ${processing ? "is-processing" : ""}`}>
        <div className="assistant-voice-orb" aria-hidden="true"><span /></div>
        <div className="assistant-voice-status">
          <p role="status">
            {requesting ? "Po hapim mikrofonin…" : recording ? "Po regjistrojmë" : processing ? "Po e kthejmë në tekst…" : file ? "Regjistrimi është gati" : "Fol me Agjentin"}
          </p>
          <span className="assistant-voice-time">
            {recording || file ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} / 2:00` : "Deri në 2 minuta"}
          </span>
        </div>
        {url && !recording && <audio controls src={url} aria-label="Dëgjo regjistrimin tënd" />}
        <div className="assistant-voice-controls">
          {onBack && <button type="button" className="assistant-voice-button" aria-label="Kthehu te shkrimi" title="Kthehu te shkrimi" disabled={unavailable || recording} onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>}
          {recording ? (
            <button type="button" className="assistant-voice-button is-stop" onClick={stop} aria-label="Përfundo regjistrimin" title="Përfundo regjistrimin">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3" /></svg>
            </button>
          ) : (
            <button type="button" className={`assistant-voice-button ${file ? "" : "is-primary"}`} disabled={unavailable} onClick={() => void start()} aria-label={micLabel} title={micLabel}>
              {requesting ? <span className="assistant-voice-spinner" aria-hidden="true" /> : file ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 10a9 9 0 1 1 1.5 7M3 4v6h6" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>
              )}
            </button>
          )}
          {file && !recording && <button type="button" className="assistant-voice-button is-primary" disabled={unavailable} onClick={() => void runAnalysis(file)} aria-label="Ktheje regjistrimin në tekst" title="Ktheje regjistrimin në tekst">
            {processing ? <span className="assistant-voice-spinner" aria-hidden="true" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
          </button>}
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
