"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
import { saveBusinessService } from "@/lib/services/actions";
import { servicePrice, type BusinessService } from "@/lib/services/model";
import { dayNames, type Hours } from "@/lib/calendar/model";
import { EntityFlowLink } from "@/components/workflows/entity-flow-link";
import { usePageAssistantContext } from "@/components/business-assistant/workspace";
import "./services.css";
function ServiceEditor({
  slug,
  service,
  onClose,
  binding,
  workflowsEnabled,
}: {
  slug: string;
  service?: BusinessService;
  onClose: () => void;
  binding?: { flowId: string; name: string };
  workflowsEnabled: boolean;
}) {
  const router = useRouter(),
    [bookable, setBookable] = useState(service?.booking_enabled ?? false),
    [custom, setCustom] = useState(service?.hours != null),
    [hours, setHours] = useState<Hours[]>(service?.hours ?? []),
    [priceMode, setPriceMode] = useState(service?.price_mode ?? "request");
  const change = (index: number, key: "start" | "end", value: string) =>
    setHours(hours.map((h, i) => (i === index ? { ...h, [key]: value } : h)));
  return (
    <section className="panel section-pad service-editor">
      <div className="service-editor-heading">
        <h2>{service ? "Ndrysho shërbimin" : "Shërbim i ri"}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Mbyll
        </button>
      </div>
      <ActionForm
        action={saveBusinessService.bind(null, slug)}
        onSuccess={() => {
          router.refresh();
          onClose();
        }}
      >
        {service && (
          <>
            <input type="hidden" name="id" value={service.id} />
            <input type="hidden" name="updatedAt" value={service.updated_at} />
          </>
        )}
        <div className="service-fields">
          {service && <div className="service-wide"><EntityFlowLink slug={slug} kind="service" id={service.id} binding={binding} enabled={workflowsEnabled} /></div>}
          <label>
            Emri
            <input
              className="field"
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={service?.name}
              placeholder="P.sh. konsultë online"
            />
          </label>
          <label>
            Kategoria (opsionale)
            <input
              className="field"
              name="category"
              maxLength={120}
              defaultValue={service?.category}
              placeholder="P.sh. Konsulencë"
            />
          </label>
          <label className="service-wide">
            Përshkrimi
            <textarea
              className="field"
              name="description"
              rows={4}
              maxLength={8000}
              defaultValue={service?.description}
              placeholder="Çfarë përfshin shërbimi?"
            />
          </label>
          <label>
            Çmimi
            <select
              className="field"
              name="priceMode"
              value={priceMode}
              onChange={(e) =>
                setPriceMode(e.target.value as BusinessService["price_mode"])
              }
            >
              <option value="request">Sipas kërkesës</option>
              <option value="fixed">Çmim fiks</option>
              <option value="from">Duke filluar nga</option>
            </select>
          </label>
          <label>
            Monedha
            <select
              name="currency"
              className="field"
              defaultValue={service?.currency ?? "EUR"}
            >
              <option value="EUR">EUR</option>
              <option value="ALL">ALL</option>
              <option value="USD">USD</option>
            </select>
          </label>
          {priceMode !== "request" && (
            <label>
              Vlera
              <input
                className="field"
                name="price"
                type="number"
                min={0}
                max={9999999999.99}
                step="0.01"
                required
                defaultValue={service?.price_amount ?? ""}
              />
            </label>
          )}
          <label className="service-check service-wide">
            <input
              type="checkbox"
              name="active"
              defaultChecked={service?.is_active ?? true}
            />
            Shërbimi është aktiv
          </label>
          <label className="service-check service-wide">
            <input
              type="checkbox"
              name="bookingEnabled"
              checked={bookable}
              onChange={(e) => setBookable(e.target.checked)}
            />
            Lejo rezervim me orar për këtë shërbim
          </label>
          {bookable && (
            <>
              <label>
                Kohëzgjatja (min)
                <input
                  className="field"
                  name="duration"
                  type="number"
                  min={5}
                  max={480}
                  required
                  defaultValue={service?.duration_minutes ?? 30}
                />
              </label>
              <label>
                Pushim pas takimit (min)
                <input
                  className="field"
                  name="buffer"
                  type="number"
                  min={0}
                  max={120}
                  required
                  defaultValue={service?.buffer_minutes ?? 0}
                />
              </label>
              <label className="service-check service-wide">
                <input
                  type="checkbox"
                  name="customHours"
                  checked={custom}
                  onChange={(e) => setCustom(e.target.checked)}
                />
                Vendos orar të veçantë për këtë shërbim
              </label>
              {!custom && (
                <p className="muted-copy service-wide">
                  Përdor orarin e biznesit nga{" "}
                  <Link href={`/b/${slug}/calendar`}>Kalendari</Link>.
                </p>
              )}
              {custom && (
                <div className="service-hours service-wide">
                  <input
                    type="hidden"
                    name="hours"
                    value={JSON.stringify(hours)}
                  />
                  <p className="muted-copy">
                    Orari zbatohet brenda orarit të biznesit, në zonën kohore të
                    tij.
                  </p>
                  {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                    <div key={day} className="service-day">
                      <strong>{dayNames[day]}</strong>
                      <div>
                        {hours.map((h, index) =>
                          h.day === day ? (
                            <div className="service-interval" key={index}>
                              <input
                                className="field"
                                type="time"
                                aria-label={`Hapja ${dayNames[day]}`}
                                value={h.start}
                                required
                                onChange={(e) =>
                                  change(index, "start", e.target.value)
                                }
                              />
                              <span>–</span>
                              <input
                                className="field"
                                type="time"
                                aria-label={`Mbyllja ${dayNames[day]}`}
                                value={h.end}
                                required
                                onChange={(e) =>
                                  change(index, "end", e.target.value)
                                }
                              />
                              <button
                                type="button"
                                className="btn btn-ghost"
                                aria-label={`Hiq intervalin ${dayNames[day]}`}
                                onClick={() =>
                                  setHours(hours.filter((_, i) => i !== index))
                                }
                              >
                                ×
                              </button>
                            </div>
                          ) : null,
                        )}
                        {!hours.some((h) => h.day === day) && (
                          <span className="muted-copy">Pa orar</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          setHours([
                            ...hours,
                            { day, start: "09:00", end: "17:00" },
                          ])
                        }
                      >
                        + Orar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="service-wide service-buttons">
            <button className="btn btn-primary" type="submit">
              Ruaj shërbimin
            </button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              Anulo
            </button>
          </div>
        </div>
      </ActionForm>
    </section>
  );
}
export function ServicesWorkspace({
  slug,
  businessName,
  services,
  flowBindings = [],
  workflowsEnabled = false,
}: {
  slug: string;
  businessName: string;
  services: BusinessService[];
  flowBindings?: { id: string; flowId: string; name: string }[];
  workflowsEnabled?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [editor, setEditor] = useState<BusinessService | "new" | null>(null);
  usePageAssistantContext(editor && editor !== "new" ? { entityType: "service", entityId: editor.id } : {});
  const shown = services.filter(
    (s) =>
      (filter === "all" ||
        (filter === "active" && s.is_active) ||
        (filter === "inactive" && !s.is_active) ||
        (filter === "bookable" && s.booking_enabled)) &&
      `${s.name} ${s.description} ${s.category}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="Shërbimet"
        title={`Shërbimet e ${businessName}`}
        description="Menaxho shërbimet dhe çmimet. Aktivizo rezervimin me orar kur të nevojitet."
      >
        <button className="btn btn-primary" onClick={() => setEditor("new")}>
          + Shto shërbim
        </button>
      </PageHeading>
      {editor && (
        <ServiceEditor
          key={editor === "new" ? "new" : `${editor.id}:${editor.updated_at}`}
          slug={slug}
          service={editor === "new" ? undefined : editor}
          binding={editor === "new" ? undefined : flowBindings.find(item => item.id === editor.id)}
          workflowsEnabled={workflowsEnabled}
          onClose={() => setEditor(null)}
        />
      )}
      <section className="services-catalog">
        <div className="services-toolbar">
          <input
            className="field"
            type="search"
            aria-label="Kërko shërbim"
            placeholder="Kërko shërbim…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="field"
            aria-label="Filtro shërbimet"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Të gjitha ({services.length})</option>
            <option value="active">Aktive</option>
            <option value="inactive">Joaktive</option>
            <option value="bookable">Me rezervim</option>
          </select>
        </div>
        <div className="services-grid">
          {shown.map((s) => (
            <article className="panel service-card" key={s.id}>
              <div className="service-card-top">
                <span className="status-badge">
                  {s.is_active ? "Aktiv" : "Joaktiv"}
                </span>
                {s.category && <span className="muted-copy">{s.category}</span>}
              </div>
              <h2>{s.name}</h2>
              <p className="service-description">
                {s.description || "Pa përshkrim"}
              </p>
              <strong>{servicePrice(s)}</strong>
              <EntityFlowLink slug={slug} kind="service" id={s.id} binding={flowBindings.find(item => item.id === s.id)} enabled={workflowsEnabled} />
              <p className="muted-copy">
                {s.booking_enabled
                  ? `${s.duration_minutes} min · ${s.hours ? "Orar i veçantë" : "Orari i biznesit"}`
                  : "Pa rezervim me orar"}
              </p>
              <div className="service-buttons">
                <button className="btn btn-ghost" onClick={() => setEditor(s)}>
                  Ndrysho
                </button>
                {s.booking_enabled && s.is_active && (
                  <Link
                    className="btn btn-ghost"
                    href={`/b/${slug}/calendar?service=${s.id}`}
                  >
                    Rezervo
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
        {!shown.length && (
          <div className="panel section-pad">
            <h2>
              {services.length
                ? "Nuk u gjet asnjë shërbim"
                : "Shto shërbimin tënd të parë"}
            </h2>
            <p className="muted-copy">
              {services.length
                ? "Provo një kërkim ose filtër tjetër."
                : "Vendos emrin, përshkrimin dhe çmimin. Rezervimi me orar është opsional."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
