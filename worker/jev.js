import { buildJevState, decideFromJevResult, JEV_QUESTIONS } from "./jev-policy.js";

export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 4_000;

// Thin Workers AI wrapper. Missing binding, timeout, or a bad payload returns
// null so the customer path can continue to Llama unchanged.
export async function evaluateWithJev(env, messages) {
  if (typeof env?.AI?.run !== "function") return null;

  let settled = false;
  const pending = Promise.resolve()
    .then(() => env.AI.run(JEV_MODEL, {
      state: buildJevState(messages),
      questions: JEV_QUESTIONS
    }))
    .then((result) => decideFromJevResult(result))
    .catch(() => null)
    .finally(() => {
      settled = true;
    });

  const timedOut = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), JEV_TIMEOUT_MS);
    pending.finally(() => clearTimeout(timer));
  });

  const decision = await Promise.race([pending, timedOut]);
  if (!settled) pending.catch(() => {});
  return decision;
}
