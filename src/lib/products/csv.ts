import { httpUrl, normalizeCurrency } from "./batch";
import { parseAmount } from "./page-extract";

const MAX_ROWS = 100;
const MAX_CHARS = 500_000;

export type CsvProduct = {
  line: number;
  name: string;
  priceText: string;
  currency: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  invalidPrice: boolean;
};

type HeaderKey = "name" | "price" | "currency" | "description" | "sku" | "image";

const HEADERS: Record<HeaderKey, string[]> = {
  name: ["emri", "name", "produkti", "produkt", "product", "titulli", "title", "emertimi", "emer"],
  price: ["cmimi", "price", "shuma", "vlera"],
  currency: ["monedha", "currency", "valuta", "valute"],
  description: ["pershkrimi", "description", "permbajtja", "content", "detaje", "pershkrim"],
  sku: ["sku", "kodi", "kod", "code"],
  image: ["foto", "image", "imageurl", "fotourl", "urlefoto", "fotoja", "img"],
};

const ORDER: HeaderKey[] = ["name", "price", "currency", "description", "sku", "image"];

export function parseProductCsv(raw: string): { rows: CsvProduct[] } | { error: string } {
  const text = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^sep=.\n/i, "")
    .trim();
  if (!text) return { error: "Skedari është bosh." };
  if (text.includes("\u0000")) return { error: "Ky skedar nuk duket si CSV tekst." };
  if (text.length > MAX_CHARS) return { error: "Skedari është shumë i madh. Mbaje nën 100 produkte." };

  const table = parseTable(text);
  if ("error" in table) return table;
  if (!table.length) return { error: "Skedari është bosh." };

  const headerMap = headerIndexes(table[0]);
  const data = headerMap ? table.slice(1) : table;
  if (!data.length) return { error: "Skedari ka vetëm titujt e kolonave." };
  if (data.length > MAX_ROWS) {
    return { error: `Skedari ka ${data.length} rreshta. Maksimumi është ${MAX_ROWS}.` };
  }

  const rows: CsvProduct[] = [];
  data.forEach((cells, index) => {
    const pick = (key: HeaderKey) => {
      const at = headerMap ? headerMap[key] : ORDER.indexOf(key);
      if (at == null || at < 0) return "";
      return (cells[at] ?? "").trim();
    };
    const name = pick("name").replace(/\s+/g, " ").trim().slice(0, 180);
    const priceRaw = pick("price");
    const description = pick("description");
    const sku = pick("sku");
    const image = pick("image");
    if (!name && !priceRaw && !description && !sku && !image) return;

    const amount = priceRaw ? parseAmount(priceRaw) : null;
    const parsedPrice = amount == null ? "" : Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    rows.push({
      line: (headerMap ? index + 2 : index + 1),
      name,
      priceText: amount == null ? priceRaw.slice(0, 40) : parsedPrice,
      currency: currencyFrom(pick("currency"), priceRaw),
      description: description ? description.slice(0, 4000) : null,
      sku: sku ? sku.slice(0, 80) : null,
      imageUrl: httpUrl(image),
      invalidPrice: Boolean(priceRaw) && amount == null,
    });
  });

  if (!rows.length) return { error: "Nuk gjeta produkte në skedar." };
  return { rows };
}

function currencyFrom(cell: string, priceText: string): string {
  if (cell.trim()) return normalizeCurrency(cell);
  const hit = priceText.match(/(€|\$|£|EUR|USD|ALL|GBP|Lekë|Leke|Lek)/iu);
  return hit ? normalizeCurrency(hit[1]) : "ALL";
}

function headerIndexes(cells: string[]): Partial<Record<HeaderKey, number>> | null {
  const map: Partial<Record<HeaderKey, number>> = {};
  let found = false;
  cells.forEach((cell, index) => {
    const key = headerKey(cell);
    if (!key || map[key] != null) return;
    map[key] = index;
    found = true;
  });
  return found ? map : null;
}

function headerKey(value: string): HeaderKey | null {
  const folded = fold(value);
  if (!folded) return null;
  for (const key of ORDER) {
    if (HEADERS[key].includes(folded)) return key;
  }
  return null;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseTable(text: string): string[][] | { error: string } {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushCell = () => {
    row.push(cell.length > 5000 ? cell.slice(0, 5000) : cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\n") {
      pushRow();
      if (rows.length > MAX_ROWS + 1) {
        return { error: `Skedari ka më shumë se ${MAX_ROWS} produkte.` };
      }
      continue;
    }
    cell += char;
  }
  if (quoted) return { error: "Skedari CSV ka thonjëza të pahapura." };
  pushRow();
  return rows;
}

function detectDelimiter(text: string): "," | ";" | "\t" {
  const first = text.split("\n", 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of first) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "," || char === ";" || char === "\t")) counts[char] += 1;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}
