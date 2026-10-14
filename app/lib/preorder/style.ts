// Stil og tekster til forudbestillingen på produktsiden.
//
// Gemmes som JSON i shop-metafeltet lalatoto_preorder.style, som temablokken
// (extensions/preorder-knap) læser. «theme» betyder, at blokken arver temaets
// skrifttype, farver og knapper. «custom» lægger egne farver ovenpå.

export const STYLE_NAMESPACE = "lalatoto_preorder";
export const STYLE_KEY = "style";

export type StyleSettings = {
  mode: "theme" | "custom";
  /** Tekst på læg-i-kurv-knappen. Tom = temaets egen tekst. */
  buttonText: string;
  /** Mærket over teksten, fx «Forudbestilling». */
  badgeText: string;
  /** {dato} erstattes af forfaldsdatoen, {depositum} af beløbet nu. */
  infoText: string;
  colors: { accent: string; accentText: string; background: string; text: string };
  /** Hjørnernes runding i pixels. */
  radius: number;
};

export const DEFAULT_STYLE: StyleSettings = {
  mode: "theme",
  buttonText: "Forudbestil",
  badgeText: "Forudbestilling",
  infoText: "Du betaler {depositum} i dag. Resten trækkes {dato}, når varen sendes.",
  colors: { accent: "#1f1f1f", accentText: "#ffffff", background: "#f5f5f5", text: "#1f1f1f" },
  radius: 8,
};

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_TEXT = 200;
const MAX_SHORT = 40;

/**
 * Læser gemte indstillinger tolerant: ukendte eller ugyldige felter falder
 * tilbage til standarden, så en gammel eller ødelagt værdi aldrig vælter
 * dashboardet.
 */
export function parseStyleSettings(raw: unknown): StyleSettings {
  let value: any = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_STYLE);
  const text = (v: unknown, fallback: string, max: number) =>
    typeof v === "string" && v.length <= max ? v : fallback;
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
  const c = value.colors ?? {};
  return {
    mode: value.mode === "custom" ? "custom" : "theme",
    buttonText: text(value.buttonText, DEFAULT_STYLE.buttonText, MAX_SHORT),
    badgeText: text(value.badgeText, DEFAULT_STYLE.badgeText, MAX_SHORT),
    infoText: text(value.infoText, DEFAULT_STYLE.infoText, MAX_TEXT),
    colors: {
      accent: color(c.accent, DEFAULT_STYLE.colors.accent),
      accentText: color(c.accentText, DEFAULT_STYLE.colors.accentText),
      background: color(c.background, DEFAULT_STYLE.colors.background),
      text: color(c.text, DEFAULT_STYLE.colors.text),
    },
    radius:
      Number.isInteger(value.radius) && value.radius >= 0 && value.radius <= 32 ? value.radius : DEFAULT_STYLE.radius,
  };
}

export type StyleFormResult =
  | { ok: true; value: StyleSettings }
  | { ok: false; errors: Partial<Record<string, string>> };

/** Validerer formularen fra dashboardet. Fejlteksterne vises ved feltet. */
export function validateStyleForm(form: Record<string, string | undefined>): StyleFormResult {
  const errors: Partial<Record<string, string>> = {};
  const mode = form.mode === "custom" ? "custom" : form.mode === "theme" ? "theme" : null;
  if (!mode) errors.mode = "Vælg en stil";

  const short = (key: string, label: string) => {
    const v = (form[key] ?? "").trim();
    if (v.length > MAX_SHORT) errors[key] = `${label} må højst være ${MAX_SHORT} tegn`;
    return v;
  };
  const buttonText = short("buttonText", "Knappens tekst");
  const badgeText = short("badgeText", "Mærket");
  const infoText = (form.infoText ?? "").trim();
  if (!infoText) errors.infoText = "Skriv en tekst til kunden";
  else if (infoText.length > MAX_TEXT) errors.infoText = `Teksten må højst være ${MAX_TEXT} tegn`;
  else if (!infoText.includes("{dato}")) errors.infoText = "Teksten skal indeholde {dato}, så kunden kan se, hvornår der trækkes";

  const color = (key: string) => {
    const v = (form[key] ?? "").trim().toLowerCase();
    if (!HEX.test(v)) errors[key] = "Skriv farven som #rrggbb, fx #1f1f1f";
    return v;
  };
  const colors = {
    accent: color("accent"),
    accentText: color("accentText"),
    background: color("background"),
    text: color("text"),
  };
  const radius = Number(form.radius);
  if (!Number.isInteger(radius) || radius < 0 || radius > 32) errors.radius = "Rundingen skal være et helt tal fra 0 til 32";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { mode: mode!, buttonText, badgeText, infoText, colors, radius } };
}

/** Den tekst, kunden ser. Samme erstatning laves i Liquid i temablokken. */
export function renderInfoText(template: string, values: { dato: string; depositum: string }): string {
  return template.replaceAll("{dato}", values.dato).replaceAll("{depositum}", values.depositum);
}
