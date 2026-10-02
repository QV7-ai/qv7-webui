function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function directIdentityReply(message: string, name: string, job: string) {
  const q = message.replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (!q || q.length > 60) return null;
  const dutch = /\b(wat|hoe|welke|mijn|baan|werk|naam|jij)\b/i.test(q) && !/^what/i.test(q);
  if (/^(what(?:['’])?s|what is|who am i|hoe heet ik|wat is mijn naam|wie ben ik)\b/i.test(q) && /\b(name|naam|who am i|wie ben ik|heet ik)\b/i.test(q)) {
    if (!name) return null;
    return dutch ? `Je heet ${name}.` : `Your name is ${name}.`;
  }
  if (/^(what(?:['’])?s|what is|wat is|wat doe ik)\b/i.test(q) && /\b(job|work|occupation|baan|werk|functie)\b/i.test(q)) {
    if (!job) return dutch ? "Je hebt nog geen soort werk gekozen." : "You have not chosen a type of work yet.";
    return dutch ? `Jij werkt als ${job}.` : `You work as a ${job}.`;
  }
  return null;
}

export function correctIdentityVoice(text: string, name: string, job: string) {
  if (!text) return text;
  let out = text;
  if (name) {
    const n = escapeRegExp(name);
    out = out.replace(new RegExp(`\\bI am ${n}\\b`, "gi"), `You are ${name}`);
    out = out.replace(new RegExp(`\\bI'm ${n}\\b`, "gi"), `You're ${name}`);
    out = out.replace(new RegExp(`\\bIk ben ${n}\\b`, "gi"), `Jij bent ${name}`);
    out = out.replace(new RegExp(`\\bMy name is ${n}\\b`, "gi"), `Your name is ${name}`);
    out = out.replace(new RegExp(`\\bMijn naam is ${n}\\b`, "gi"), `Jouw naam is ${name}`);
  }
  if (job) {
    const j = escapeRegExp(job);
    out = out.replace(new RegExp(`\\bI am an? ${j}\\b`, "gi"), `You are a ${job}`);
    out = out.replace(new RegExp(`\\bI'm an? ${j}\\b`, "gi"), `You're a ${job}`);
    out = out.replace(new RegExp(`\\bIk ben(?: een)? ${j}\\b`, "gi"), `Jij bent ${job}`);
    out = out.replace(new RegExp(`\\bAls ${j} ben ik\\b`, "gi"), `Jij bent ${job}`);
  }
  return out;
}

export function bioAsUserFact(bio: string) {
  return bio
    .replace(/\bik ben\b/gi, "de gebruiker is")
    .replace(/\bI am\b/g, "the user is")
    .replace(/\bI'm\b/g, "the user is");
}
