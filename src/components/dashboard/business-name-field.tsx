"use client";

import { useState } from "react";
import { slugifyBusinessName } from "@/lib/businesses/slug";

/** Emri i biznesit me pamje paraprake të slug-ut (slug-u real caktohet në backend). */
export function BusinessNameField() {
  const [name, setName] = useState("");
  const preview = slugifyBusinessName(name);

  return (
    <>
      <label className="form-label">
        Emri i biznesit
        <input
          name="name"
          className="field"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="muted-copy">
        Adresa:{" "}
        <code>/{preview || "…"}</code>
        {preview
          ? " (nëse është e zënë, shtohet automatikisht një numër)"
          : ""}
      </p>
    </>
  );
}
