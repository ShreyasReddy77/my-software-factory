// Trial probe: the budget pause the forced usage limit should cause. Reads
// agent-end.json from probe-pause.ts and opens (or comments on) the real
// budget-pause ticket, as an agent run's report does.
//   GH_TOKEN          App token for FACTORY_REPO: Issues write
//   FACTORY_REPO      where the ticket lives; FACTORY_APP_SLUG the App's slug
//   RECORD_ON         the issue or PR number the ticket names as paused
//   RUN_URL, OUTPUT_DIR
// Throws when the run did not end as a pause: the factory would have counted
// a usage limit as a failed try.
import { readBudgetPauseTicket, recordBudgetPause } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { readAgentEndFile } from "../shared/run-files";

const { agentEnd } = readAgentEndFile();
if (agentEnd.kind !== "paused")
  throw new Error(`The forced usage limit ended the agent as "${agentEnd.kind}", not as a pause`);

const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
recordBudgetPause(
  agentEnd.pause,
  { repo: factoryRepo, number: Number(required("RECORD_ON")), runUrl: required("RUN_URL") },
  { factoryRepo, factoryAppLogin }
);

// GitHub's issue list can lag a new issue by a few seconds, so read it again
// before calling the ticket missing.
let state = readBudgetPauseTicket(factoryRepo, factoryAppLogin);
for (let tries = 1; !state.open && tries < 6; tries++) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  state = readBudgetPauseTicket(factoryRepo, factoryAppLogin);
}
if (!state.open) throw new Error("No budget-pause ticket is open after recording the pause");
console.log(
  `Budget-pause ticket: https://github.com/${factoryRepo}/issues/${state.ticket}` +
    (state.until === undefined ? " (no reset: a human closes it)" : ` (until ${state.until.toISOString()})`)
);
