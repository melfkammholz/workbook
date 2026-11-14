/**
 * Skills for Claude Code that the app serves itself (`GET /skills/install.sh`), so they come with the same version as the
 * MCP tools they call. They only use the `workbook` MCP server; none of them touches the app's own API.
 */

/** Bumped when a tool or a skill changes in a way an installed skill must follow; also the MCP server version. */
export const SKILLS_VERSION = '2';

export interface Skill {
  name: string;
  description: string;
  body: string;
}

const COMMON = `Rules for every workbook skill:
- Everything goes through the \`workbook\` MCP server. Never call the app's HTTP API (\`/api/...\`) with curl or fetch: the MCP token does not work there on purpose, and the student's data is only yours through the tools.
- You cannot change anything. You propose (\`propose\`, \`propose_card\`, ...) and the student decides in the app.
- Every read of a question (\`list_questions\`, \`get_context\`) needs \`purpose\`: use this skill's name. The student sees it next to the question.
- \`list_questions\` shows at most 20 questions and \`remaining\` counts the rest. Do the 20, then say that more are left; do not loop through all of them unless asked.
- Each question has \`rejected\`: what the student turned down for it, in their words. Never propose the same thing again.
- Write in the language of the question (usually German). Never reveal exercise solutions unless the question asks for one; hint instead.`;

export const SKILLS: Skill[] = [
  {
    name: 'workbook-answer-recent',
    description: "Answer the student's recent open questions from the text they were reading, as proposals they decide on in their workbook app. Use when asked to answer, triage or look at their new questions.",
    body: `# Answer recent questions

${COMMON}

## Steps

1. Call \`list_labels\` (reuse their label names).
2. Call \`list_questions\` with \`purpose: "workbook-answer-recent"\`, \`status: "active"\` and \`unfetched_only: true\` (leave it out if the student asks for all). Add \`since\` if they name a time, \`resource\` or \`item\` if they name a place.
3. For each question: read \`get_context\` (purpose again), and \`search\` or \`read_page\` if the text around it is not enough.
4. Call \`propose\` once per question: a short \`answer\` grounded in the text, saying where in it; a \`type\` and \`labels\` if it has none; a one-line \`reason\`. If the text does not answer it, say so in the reason instead of guessing.
5. Where the answer is a definition or fact worth remembering, also call \`propose_card\` with the same \`question\` id. At most one card per question, none where a card would not help.
6. Finish with a short list of what you proposed, and how many questions remain.`,
  },
  {
    name: 'workbook-cards-from-confusion',
    description: 'Turn what the student found confusing in their questions ("x makes no sense", "what is the difference between ...") into flashcard proposals. Use when asked for cards from their questions.',
    body: `# Cards from confusion

${COMMON}

## Steps

1. Call \`list_decks\` (use an existing deck's title where the topic fits).
2. Call \`list_questions\` with \`purpose: "workbook-cards-from-confusion"\` and \`status: "active"\`. Look for wording like "makes no sense", "I do not get", "difference between". Skip questions that are about their own code or that you cannot ground in a text.
3. For each such question read \`get_context\` (purpose again).
4. Call \`propose_card\` with \`question\` set to the question's id: a front that asks the idea plainly, a short back that clears the confusion, and where it comes from (resource + page + an exact quote, or item). One idea per card.
5. Also call \`propose\` with an \`answer\` where the text gives one.
6. Finish with a short list of what you proposed and what you left out.`,
  },
  {
    name: 'workbook-exercise-help',
    description: "Help with one exercise from the student's saved work: run their tests, explain where code and tests disagree, hint instead of revealing the solution. Use when asked for help with an exercise.",
    body: `# Help with an exercise

${COMMON}
- Never propose changes to the student's code and never write the corrected code. Explain and ask leading questions.

## Steps

1. Get the exercise id from the student. If they only name a topic, use \`search\`.
2. Call \`get_exercise_work\` for the task and their saved code, then \`run_tests\` (it runs their saved code, never yours).
3. If they asked a question about the exercise, find it with \`list_questions\` (\`item\` set to the exercise id, purpose \`"workbook-exercise-help"\`) and read \`get_context\`.
4. Say what works, find where the code and the tests disagree, and explain why. Give hints, not the fix. Offer a stronger hint only if they ask.
5. If a short note would help them later, \`propose_question\` or \`propose_card\` is fine; otherwise propose nothing.`,
  },
];

const fileOf = (s: Skill): string => `---\nname: ${s.name}\ndescription: ${s.description}\nmetadata:\n  version: "${SKILLS_VERSION}"\n---\n\n${s.body}\n`;

export const skillFile = (name: string): string | null => {
  const s = SKILLS.find((x) => x.name === name);
  return s ? fileOf(s) : null;
};

/** A shell script that writes every skill into Claude Code's skills folder; nothing is fetched twice or run from elsewhere. */
export function installScript(origin: string): string {
  const out = ['#!/bin/sh', `# Installs the workbook skills (version ${SKILLS_VERSION}) from ${origin} into Claude Code.`, 'set -e', 'dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"'];
  for (const s of SKILLS) {
    out.push(`mkdir -p "$dir/${s.name}"`, `cat > "$dir/${s.name}/SKILL.md" <<'WORKBOOK_SKILL_END'`, fileOf(s).trimEnd(), 'WORKBOOK_SKILL_END', `echo "installed $dir/${s.name}"`);
  }
  out.push('echo "Done. Start Claude Code anew to use them. They need the workbook MCP server (see settings, assistant)."');
  return `${out.join('\n')}\n`;
}
