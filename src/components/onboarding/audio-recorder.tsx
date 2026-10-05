"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_AUDIO_BYTES } from "@/lib/onboarding/audio-upload";

export function AudioRecorder({
  busy,
  onAnalyze,
}: {
  busy: boolean;
  onAnalyze: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
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
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }
  async function start() {
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
          : busy
            ? "Po e kthejmë audion në tekst dhe po përgatisim profilin…"
            : "Fol natyrshëm. Agjenti do ta përgatisë hapësirën për ty."}
      </p>
      <p className="onboarding-audio-time">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} /
        2:00
      </p>
      <p>
        Mund të përmendësh çfarë ofron, si të kontaktojnë klientët dhe çfarë
        dëshiron të bëjë Agjenti.
      </p>
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
            disabled={busy || requesting}
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
            disabled={busy}
            onClick={() => void onAnalyze(file)}
          >
            {busy ? "Duke analizuar…" : "Analizo biznesin →"}
          </button>
        )}
      </div>
      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}
      <p className="onboarding-disclaimer">
        Kur shtyp “Analizo”, audioja dërgohet për transkriptim dhe analizë me
        AI. Ruajmë tekstin dhe rezultatet; audion nuk e ruajmë në hapësirën
        tënde.
      </p>
    </div>
  );
}
