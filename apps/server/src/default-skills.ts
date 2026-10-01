import { eq } from "drizzle-orm";
import { skills, users } from "./db/schema.ts";
import type { DB } from "./db/index.ts";

export const DEEP_RESEARCH_NAME = "Deep Research";

export const DEEP_RESEARCH_SKILL = `Use this skill for thorough, source-backed research: synthesis, market or technical landscapes, evidence-based briefs, and recommendations that need more than one source. For a quick fact, answer with one search_web call and do not write a report.

Tools in this app
- search_web: public web search. It returns snippets and URLs, not the full page. If it says search is disabled, stop and ask the user to turn on Web search. Do not invent results.
- fetch_url: open a public page. After search_web, open the strongest URLs with fetch_url before you rely on them. Never write a browser script.
- There is no news tool, no private document library, and no company drive. Attached files are already in the user message. Read those first. Ignore internal-library steps.
- The report is one HTML file, not a <canvas> tag and not a separate CSS file.

Workflow
1. State the question, scope, time horizon, and geography only when the user left them out and the answer would change.
2. For a broad question, plan 3–5 search angles, then run them. Start broad, then search for primary sources, disagreements, and recent changes.
3. Open important pages with fetch_url. Do not treat a snippet as proof when the claim depends on the page.
4. Prefer primary sources: official docs, papers, standards, regulators, filings, and original data. Note the date. If a date is missing, use "-".
5. Cross-check claims that carry the answer. Separate facts, estimates, opinions, and your own inference.
6. Track each source as: name, exact URL, date, and a credibility score out of 5 (example 4/5). Never use words like High or Trusted. Do not invent URLs.

Report
Write the whole report in the user's language. Headings and table columns use that language too. Do not copy the English labels below unless the user wrote in English.

Put the report in one \`\`\`html fence. One file. All styling in a single <style> block in the head. No <canvas> tag. No external stylesheet.

Include, in the user's language:
- The question you answered
- Executive summary: 3–7 ranked takeaways
- How you searched, and what you could not check
- Findings by theme, with the claim tied to a source
- Source notes, required. One table with three columns only: source, credibility, last updated. The source cell is the link, for example <a href="exact-url">Name</a>. Credibility is n/5. No extra link column. Conflicts can follow the table in the same section.
- Open questions
- What to decide, test, or read next

After the file, send one short chat message: the top finding and that the report is in the canvas. Do not paste the report into the chat.`;

export function deepResearchSkillId(userId: string) {
  return `default-deep-research:${userId}`;
}

export function ensureDefaultSkills(db: DB, userId?: string) {
  const ids = userId ? [userId] : db.select({ id: users.id }).from(users).all().map((row) => row.id);
  const now = Date.now();
  for (const id of ids) {
    const skillId = deepResearchSkillId(id);
    const row = db.select().from(skills).where(eq(skills.id, skillId)).get();
    if (!row) {
      db.insert(skills)
        .values({
          id: skillId,
          userId: id,
          name: DEEP_RESEARCH_NAME,
          content: DEEP_RESEARCH_SKILL,
          defaultOn: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      continue;
    }
    if (row.content !== DEEP_RESEARCH_SKILL || row.name !== DEEP_RESEARCH_NAME) {
      db.update(skills).set({ name: DEEP_RESEARCH_NAME, content: DEEP_RESEARCH_SKILL, updatedAt: now }).where(eq(skills.id, skillId)).run();
    }
  }
}
