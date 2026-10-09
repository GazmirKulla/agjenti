"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AUDIO_BYTES } from "@/lib/onboarding/audio-upload";
import type { AudioGuideQuestion } from "@/lib/onboarding/audio-guide";
import { scheduleAudioAnalysis } from "@/lib/onboarding/auto-analysis";

export function AudioRecorder({
  busy,
  onAnalyze,
  questions,
  autoAnalyze = false,
}: {
  busy: boolean;
  onAnalyze: (file: File) => Promise<void>;
  questions?: AudioGuideQuestion[];
  autoAnalyze?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const automatic = useRef<ReturnType<typeof scheduleAudioAnalysis> | null>(null);
  const attemptedFile = useRef<File | null>(null);
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
      automatic.current?.cancel();
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
    automatic.current?.cancel();
    attemptedFile.current = audio;
    analysisInFlight.current = true;
    setCountdown(null);
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
  useEffect(() => {
    if (!autoAnalyze || !file || recording || requesting || busy || analyzing || listening || attemptedFile.current === file) {
      setCountdown(null);
      return;
    }
    const scheduled = scheduleAudioAnalysis(() => { void runAnalysis(file); }, setCountdown);
    automatic.current = scheduled;
    return () => {
      scheduled.cancel();
      if (automatic.current === scheduled) automatic.current = null;
    };
  }, [autoAnalyze, file, recording, requesting, busy, analyzing, listening, runAnalysis]);
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }
  async function start() {
    if (busy || analysisInFlight.current || requesting || recording) return;
    automatic.current?.cancel();
    setCountdown(null);
    setListening(false);
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
  return (
    <div className="onboarding-audio-box">
      {questions && <section className="onboarding-audio-guide" aria-labelledby="audio-guide-title">
        <h2 id="audio-guide-title">Ja çfarë mund të na tregosh</h2>
        <p>Përgjigju në një audio të vetme, deri në 2 minuta. Kapërce çfarë nuk vlen për biznesin tënd.</p>
        <ol>
          {questions.map((question) => (
            <li key={question.id}>
              <strong>{question.title}</strong>
              <span>{question.hint}</span>
            </li>
          ))}
        </ol>
      </section>}
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
      <p role="status">
        {recording
          ? "Duke regjistruar…"
          : busy || analyzing
            ? "Po e kthejmë audion në tekst dhe po përgatisim profilin…"
            : "Fol natyrshëm. Agjenti do ta përgatisë hapësirën për ty."}
      </p>
      <p className="onboarding-audio-time">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} /
        2:00
      </p>
      {!questions && <p>Mund të përmendësh çfarë ofron, si të kontaktojnë klientët dhe çfarë dëshiron të bëjë Agjenti.</p>}
      {url && <audio controls src={url} aria-label="Dëgjo regjistrimin tënd"
        onPlay={() => { automatic.current?.cancel(); setCountdown(null); setListening(true); }}
        onPause={() => setListening(false)} onEnded={() => setListening(false)} />}
      {countdown !== null && <p role="status">Analiza nis automatikisht pas {countdown} sekondash.</p>}
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
        {file && !recording && (
          <button
            type="button"
            className="onboarding-next"
            disabled={busy || analyzing}
            onClick={() => void runAnalysis(file)}
          >
            {busy || analyzing ? "Duke analizuar…" : "Analizo biznesin →"}
          </button>
        )}
      </div>
      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
