"use client";

import { useEffect, useId, useState } from "react";

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function maskSecret(value: string) {
  if (value.length <= 10) return "••••••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

export function IntegrationApiKeyField({
  hasStoredSecret,
  storedSecret = null,
}: {
  hasStoredSecret: boolean;
  storedSecret?: string | null;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState(!hasStoredSecret);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [storedVisible, setStoredVisible] = useState(false);
  const [copied, setCopied] = useState<"stored" | "edit" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const pendingChange = editing && value.trim().length > 0;
  const replacingExisting = hasStoredSecret && pendingChange;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyText(text: string, which: "stored" | "edit") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied(null);
    }
  }

  function requestEdit() {
    if (!hasStoredSecret) {
      setEditing(true);
      return;
    }
    setStoredVisible(false);
    setConfirmOpen(true);
  }

  function confirmEdit() {
    if (!acknowledged) return;
    setConfirmOpen(false);
    setEditing(true);
    setValue("");
    setVisible(false);
    setAcknowledged(false);
  }

  function cancelEdit() {
    setConfirmOpen(false);
    setEditing(false);
    setValue("");
    setVisible(false);
    setStoredVisible(false);
    setAcknowledged(false);
  }

  function generate() {
    setValue(randomSecret());
    setVisible(true);
  }

  return (
    <div className="integration-api-key">
      <div className="integration-api-key-head">
        <div>
          <h3 id={titleId}>API key (Bearer secret)</h3>
          <p className="muted-copy">
            I njëjti kod duhet te Agjenti dhe te env i sajtit si{" "}
            <code>AGJENTI_APP_SECRET</code>.
          </p>
        </div>
        {hasStoredSecret && !editing && (
          <span className="integration-api-key-badge">I konfiguruar</span>
        )}
      </div>

      {!editing && hasStoredSecret && (
        <div className="integration-api-key-stored">
          <code className="integration-api-key-mask">
            {storedSecret
              ? storedVisible
                ? storedSecret
                : maskSecret(storedSecret)
              : "••••••••••••••••••••••••••••"}
          </code>
          <p className="muted-copy">
            Key-i aktual është i fshehur. Rigjenerimi e ndërpret lidhjen derisa
            ta përditësosh edhe te sajti i biznesit.
          </p>
          <div className="integration-api-key-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setStoredVisible((v) => !v)}
              disabled={!storedSecret}
            >
              {storedVisible ? "Fshih" : "Shfaq"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => storedSecret && copyText(storedSecret, "stored")}
              disabled={!storedSecret}
            >
              {copied === "stored" ? "Kopjuar" : "Kopjo"}
            </button>
            <button
              className="btn btn-ghost text-danger"
              type="button"
              onClick={requestEdit}
            >
              Ndrysho / rigjenero
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div
          className="integration-api-key-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <p className="integration-api-key-warn-title">
            Kujdes: lidhja mund të ndërpritet
          </p>
          <p className="muted-copy">
            Nëse ndryshon API key këtu dhe nuk e përditëson menjëherë te env i
            sajtit (<code>AGJENTI_APP_SECRET</code>), katalogu dhe porositë do
            të kthejnë <strong>401 Unauthorized</strong>.
          </p>
          <label className="integration-api-key-check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              E kuptoj — do ta kopjoj key-in e ri dhe do ta vendos te sajti para
              se të mbështetem te lidhja.
            </span>
          </label>
          <div className="integration-api-key-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={cancelEdit}
            >
              Anulo
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={confirmEdit}
              disabled={!acknowledged}
            >
              Vazhdo me ndryshimin
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="integration-api-key-editor">
          {hasStoredSecret && (
            <p className="integration-api-key-banner" role="status">
              Po ndryshon key-in ekzistues. Pas “Ruaj ndryshimet”, përditëso
              menjëherë env te sajti i biznesit.
            </p>
          )}

          <label className="form-label">
            {hasStoredSecret ? "API key i ri" : "API key"}
            <div className="integration-api-key-input-row">
              <input
                type={visible ? "text" : "password"}
                name="api_secret"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={
                  hasStoredSecret
                    ? "Gjenero ose ngjit key-in e ri"
                    : "Gjenero ose vendos secret-in e biznesit"
                }
                className="field"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setVisible((v) => !v)}
                disabled={!value}
              >
                {visible ? "Fshih" : "Shfaq"}
              </button>
            </div>
          </label>

          {value ? (
            <p className="muted-copy integration-api-key-preview">
              Pamje: <code>{visible ? value : maskSecret(value)}</code>
            </p>
          ) : hasStoredSecret ? (
            <p className="muted-copy">
              Nëse e lë bosh dhe ruan, key-i aktual mbetet i pandryshuar.
            </p>
          ) : null}

          {replacingExisting && (
            <p className="integration-api-key-banner is-danger" role="alert">
              Ky key i ri do të zëvendësojë të vjetrin sapo të ruash. Lidhja
              mbetet e thyer derisa sajti të ketë të njëjtin kod.
            </p>
          )}

          <div className="integration-api-key-actions">
            <button className="btn btn-ghost" type="button" onClick={generate}>
              Gjenero kod
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => copyText(value, "edit")}
              disabled={!value}
            >
              {copied === "edit" ? "Kopjuar" : "Kopjo"}
            </button>
            {hasStoredSecret && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={cancelEdit}
              >
                Anulo
              </button>
            )}
          </div>
        </div>
      )}

      {!editing && <input type="hidden" name="api_secret" value="" />}
    </div>
  );
}
