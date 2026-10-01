import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, MessageCircle, RotateCw, X } from "lucide-react";
import { parseInstructionTone, type InstructionTone } from "@wlfv/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOGO } from "@/lib/branding";
import { useLang, useT } from "@/lib/language";

const TONES: InstructionTone[] = ["default", "professional", "empathetic", "direct"];

const TONE_LABEL = {
  default: "toneDefault",
  professional: "toneProfessional",
  empathetic: "toneEmpathetic",
  direct: "toneDirect",
} as const;

const TONE_HINT = {
  default: "toneDefaultHint",
  professional: "toneProfessionalHint",
  empathetic: "toneEmpatheticHint",
  direct: "toneDirectHint",
} as const;

const TRAITS = {
  en: [
    [
      ["Earnest", "Be earnest."],
      ["Polite", "Be polite."],
      ["Gentle", "Be gentle."],
      ["Reflective", "Be reflective."],
      ["Casual", "Talk in a casual tone."],
      ["Empathetic", "Be empathetic."],
      ["Young", "Sound young and approachable."],
    ],
    [
      ["Witty", "Be witty."],
      ["Formal", "Be formal."],
      ["Curious", "Be curious."],
      ["Concise", "Be concise."],
      ["Playful", "Be playful."],
      ["Patient", "Be patient."],
      ["Bold", "Be bold."],
    ],
    [
      ["Calm", "Stay calm."],
      ["Honest", "Be honest."],
      ["Encouraging", "Be encouraging."],
      ["Precise", "Be precise."],
      ["Warm", "Be warm."],
      ["Practical", "Be practical."],
      ["Creative", "Be creative."],
    ],
  ],
  nl: [
    [
      ["Oprecht", "Wees oprecht."],
      ["Beleefd", "Wees beleefd."],
      ["Zachtaardig", "Wees zachtaardig."],
      ["Beschouwend", "Wees beschouwend."],
      ["Informeel", "Praat informeel."],
      ["Empathisch", "Wees empathisch."],
      ["Jong", "Klink jong en toegankelijk."],
    ],
    [
      ["Geestig", "Wees geestig."],
      ["Formeel", "Wees formeel."],
      ["Nieuwsgierig", "Wees nieuwsgierig."],
      ["Beknopt", "Wees beknopt."],
      ["Speels", "Wees speels."],
      ["Geduldig", "Wees geduldig."],
      ["Zelfverzekerd", "Wees zelfverzekerd."],
    ],
    [
      ["Kalm", "Blijf kalm."],
      ["Eerlijk", "Wees eerlijk."],
      ["Bemoedigend", "Wees bemoedigend."],
      ["Precies", "Wees precies."],
      ["Warm", "Wees warm."],
      ["Praktisch", "Wees praktisch."],
      ["Creatief", "Wees creatief."],
    ],
  ],
} as const;

const PREVIEWS: Record<InstructionTone, { en: string[]; nl: string[] }> = {
  default: {
    en: [
      "What kind of book are you in the mood for, {name}? Fiction or non-fiction? A thrilling mystery, a thought-provoking sci-fi, or maybe a deep dive into history or philosophy? Let me know your preferences, and I'll tailor a suggestion for you.",
      "A good place to start, {name}, is a book you will actually finish. Do you want an easy read, a classic, or something people are talking about right now?",
    ],
    nl: [
      "Wat voor boek heb je zin in, {name}? Fictie of non-fictie? Een spannende detective, een tot nadenken stemmende sci-fi, of een duik in geschiedenis of filosofie? Zeg wat je zoekt, dan stem ik een voorstel daarop af.",
      "Een goed begin, {name}, is een boek dat je ook echt uitleest. Wil je iets lichts, een klassieker, of een boek waar nu veel over gepraat wordt?",
    ],
  },
  professional: {
    en: [
      "I can narrow this down quickly, {name}. Are you looking for fiction or non-fiction, and is there a subject you want the book to cover?",
      "Tell me the subject and how much time you have, {name}, and I will recommend one title.",
    ],
    nl: [
      "Ik kan dit snel afbakenen, {name}. Zoek je fictie of non-fictie, en is er een onderwerp dat het boek moet behandelen?",
      "Noem het onderwerp en hoeveel tijd je hebt, {name}, dan beveel ik één titel aan.",
    ],
  },
  empathetic: {
    en: [
      "I'd love to help you find a book that fits how you feel right now, {name}. Do you want something comforting, exciting, or quietly thought-provoking?",
      "That sounds like a lovely thing to look forward to, {name}. What kind of story usually stays with you?",
    ],
    nl: [
      "Ik help je graag een boek te vinden dat past bij hoe je je nu voelt, {name}. Wil je iets troostends, iets spannends, of iets dat je rustig aan het denken zet?",
      "Dat klinkt als iets om naar uit te kijken, {name}. Wat voor verhaal blijft meestal bij je hangen?",
    ],
  },
  direct: {
    en: [
      "Fiction or non-fiction, {name}? Name a genre and I will give you one book.",
      "Pick a genre, {name}. I will recommend a single title, not a list.",
    ],
    nl: [
      "Fictie of non-fictie, {name}? Noem een genre en ik geef je één boek.",
      "Kies een genre, {name}. Ik beveel één titel aan, geen lijst.",
    ],
  },
};

export function InstructionsDialog({
  open,
  username,
  logoUrl,
  onClose,
}: {
  open: boolean;
  username: string;
  logoUrl?: string;
  onClose: () => void;
}) {
  const tr = useT();
  const { lang } = useLang();
  const [tone, setTone] = useState<InstructionTone>("default");
  const [toneOpen, setToneOpen] = useState(false);
  const [extra, setExtra] = useState("");
  const [traitSet, setTraitSet] = useState(0);
  const [sample, setSample] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setToneOpen(false);
    setTraitSet(0);
    setSample(0);
    setError("");
    api
      .get("/api/settings")
      .then((data) => {
        setExtra(String(data.instructionExtra || ""));
        setTone(parseInstructionTone(data.instructionTone));
      })
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (toneOpen) setToneOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toneOpen, onClose]);

  useEffect(() => {
    if (!toneOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!toneRef.current?.contains(event.target as Node)) setToneOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [toneOpen]);

  if (!open) return null;

  const name = username.trim() || "you";
  const preview = (PREVIEWS[tone][lang][sample % PREVIEWS[tone][lang].length] || "").replaceAll("{name}", name);
  const traits = TRAITS[lang][traitSet % TRAITS[lang].length] ?? TRAITS[lang][0];

  function addTrait(phrase: string) {
    setExtra((current) => {
      if (current.toLowerCase().includes(phrase.toLowerCase())) return current;
      return current.trim() ? `${current.trim()} ${phrase}` : phrase;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.send("/api/settings", "PATCH", {
        instructionTone: tone,
        instructionExtra: extra.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="motion-fade fixed inset-0 z-[60] flex items-end justify-center p-0 md:items-center md:p-6">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label={tr("close")} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-title"
        className="relative flex max-h-[86svh] w-full flex-col overflow-y-auto rounded-t-3xl bg-[var(--elevated)] px-4 pb-[max(1.25rem,var(--safe-bottom))] pt-4 shadow-2xl md:max-h-[min(680px,90dvh)] md:max-w-5xl md:overflow-hidden md:rounded-2xl md:border md:border-[var(--border)] md:bg-[var(--bg)] md:px-0 md:pb-0 md:pt-0"
      >
        <div className="relative mb-4 flex items-center justify-center md:mb-0 md:justify-between md:px-5 md:py-4">
          <h2 id="instructions-title" className="text-[16px] font-medium md:order-1 md:text-[18px]">
            {tr("instructions")}
          </h2>
          <button
            type="button"
            className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text)] md:static md:order-2 md:h-auto md:w-auto md:bg-transparent md:p-1.5 md:text-[var(--muted)] md:hover:bg-[var(--hover)] md:hover:text-[var(--text)]"
            aria-label={tr("close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid min-h-0 gap-5 md:flex-1 md:grid-cols-2 md:overflow-hidden md:px-5 md:pb-5">
          <div className="flex min-h-0 flex-col">
            <p className="text-[14px] font-medium">{tr("tone")}</p>
            <div ref={toneRef} className="relative mt-2">
              <button
                type="button"
                className="flex h-11 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-transparent px-3 text-left text-[14px]"
                aria-expanded={toneOpen}
                onClick={() => setToneOpen((open) => !open)}
              >
                <MessageCircle size={16} className="text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">{tr(TONE_LABEL[tone])}</span>
                <ChevronDown size={16} className="text-[var(--muted)]" />
              </button>
              {toneOpen ? (
                <div className="motion-pop absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] py-1 shadow-2xl">
                  {TONES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-[14px] hover:bg-[var(--hover)]"
                      onClick={() => {
                        setTone(id);
                        setSample(0);
                        setToneOpen(false);
                      }}
                    >
                      {tone === id ? <Check size={15} /> : <span className="w-[15px]" />}
                      {tr(TONE_LABEL[id])}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-[13px] text-[var(--secondary)]">{tr(TONE_HINT[tone])}</p>
            <div className="mt-5 border-t border-[var(--border)] pt-5">
              <p className="text-[14px] font-medium">{tr("additionalInstructions")}</p>
              <textarea
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
                placeholder={tr("instructionsPlaceholder")}
                className="mt-2 h-28 w-full resize-none overflow-y-auto rounded-xl border border-[var(--border)] bg-transparent px-3 py-2.5 text-[14px] leading-6 outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {traits.map(([label, phrase]) => (
                <button
                  key={label}
                  type="button"
                  className="min-h-11 rounded-full border border-[var(--border)] px-3 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)] md:min-h-0 md:py-1.5"
                  onClick={() => addTrait(phrase)}
                >
                  + {label}
                </button>
              ))}
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                aria-label={tr("refreshTraits")}
                onClick={() => setTraitSet((current) => (current + 1) % TRAITS[lang].length)}
              >
                <RotateCw size={14} />
              </button>
            </div>
            {error ? <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p> : null}
            <div className="mt-6 md:mt-auto md:pt-6">
              <Button variant="primary" className="w-full md:w-auto" disabled={saving} onClick={() => void save()}>
                {saving ? tr("saving") : tr("save")}
              </Button>
            </div>
          </div>
          <div className="hidden min-h-0 flex-col rounded-2xl bg-[var(--surface)] p-4 md:flex">
            <div className="flex justify-end">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                aria-label={tr("refreshPreview")}
                onClick={() => setSample((current) => current + 1)}
              >
                <RotateCw size={14} />
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <p className="max-w-[85%] rounded-2xl bg-[var(--elevated)] px-4 py-2.5 text-[14px] leading-6 text-[var(--secondary)]">{tr("previewSuggest")}</p>
            </div>
            <div className="mt-5 flex items-start gap-3">
              <img src={logoUrl || DEFAULT_LOGO} alt="" className="h-7 w-7 shrink-0 rounded-md object-contain" />
              <p className="text-[15px] leading-6">{preview}</p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
