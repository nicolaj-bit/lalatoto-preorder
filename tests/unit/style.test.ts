import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  parseStyleSettings,
  renderInfoText,
  validateStyleForm,
} from "../../app/lib/preorder/style";

const goodForm = {
  mode: "custom",
  buttonText: "Forudbestil nu",
  badgeText: "Forudbestilling",
  infoText: "Betal {depositum} nu, resten {dato}.",
  accent: "#AA3366",
  accentText: "#ffffff",
  background: "#fafafa",
  text: "#111111",
  radius: "4",
};

describe("parseStyleSettings", () => {
  it("giver standarden, når der intet er gemt", () => {
    expect(parseStyleSettings(null)).toEqual(DEFAULT_STYLE);
    expect(parseStyleSettings("ikke json")).toEqual(DEFAULT_STYLE);
  });

  it("læser en gemt JSON-streng", () => {
    const saved = JSON.stringify({ ...DEFAULT_STYLE, mode: "custom", radius: 0 });
    expect(parseStyleSettings(saved)).toMatchObject({ mode: "custom", radius: 0 });
  });

  it("erstatter ugyldige felter med standarden i stedet for at fejle", () => {
    const s = parseStyleSettings({ mode: "neon", colors: { accent: "red" }, radius: 99, buttonText: 5 });
    expect(s.mode).toBe("theme");
    expect(s.colors.accent).toBe(DEFAULT_STYLE.colors.accent);
    expect(s.radius).toBe(DEFAULT_STYLE.radius);
    expect(s.buttonText).toBe(DEFAULT_STYLE.buttonText);
  });

  it("ændrer ikke standarden, når resultatet ændres", () => {
    parseStyleSettings(null).colors.accent = "#000000";
    expect(DEFAULT_STYLE.colors.accent).toBe("#1f1f1f");
  });
});

describe("validateStyleForm", () => {
  it("godkender en gyldig formular og normaliserer farverne", () => {
    const r = validateStyleForm(goodForm);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.colors.accent).toBe("#aa3366");
      expect(r.value.radius).toBe(4);
    }
  });

  it("tillader tom knaptekst (så bruges temaets)", () => {
    expect(validateStyleForm({ ...goodForm, buttonText: "" }).ok).toBe(true);
  });

  it("kræver {dato} i teksten, så kunden altid ser forfaldsdatoen", () => {
    const r = validateStyleForm({ ...goodForm, infoText: "Betal senere" });
    expect(r).toMatchObject({ ok: false, errors: { infoText: expect.stringContaining("{dato}") } });
  });

  it("melder ugyldige farver, runding og stil", () => {
    const r = validateStyleForm({ ...goodForm, accent: "rød", radius: "50", mode: "neon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["accent", "mode", "radius"]);
  });

  it("afviser for lange tekster", () => {
    const r = validateStyleForm({ ...goodForm, buttonText: "x".repeat(41) });
    expect(r).toMatchObject({ ok: false, errors: { buttonText: expect.any(String) } });
  });
});

describe("renderInfoText", () => {
  it("indsætter dato og depositum alle steder", () => {
    expect(renderInfoText("{depositum} nu, {dato} resten ({dato})", { dato: "12. november 2026", depositum: "0,00 kr" })).toBe(
      "0,00 kr nu, 12. november 2026 resten (12. november 2026)",
    );
  });
});
