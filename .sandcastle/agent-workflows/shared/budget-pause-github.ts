// The budget pause's GitHub layer: reads the one budget-pause ticket from the
// factory's open issues and carries out what a new pause does to it. Its
// GH_TOKEN must reach the factory repo with Issues read (to read) or write
// (to record).
import {
  planBudgetPauseTicket,
  readBudgetPause,
  type BudgetPauseState,
  type FactoryIssue,
  type Pause,
  type PausedItem,
} from "./budget-pause";
import { ghApi, ghPages } from "./gh";
import { statusMarker } from "./marker";

export const readBudgetPauseTicket = (factoryRepo: string, factoryAppLogin: string): BudgetPauseState =>
  readBudgetPause(ghPages<FactoryIssue[]>(`repos/${factoryRepo}/issues?state=open&per_page=100`).flat(), factoryAppLogin);

export const recordBudgetPause = (
  pause: Pause,
  item: PausedItem,
  { factoryRepo, factoryAppLogin }: { readonly factoryRepo: string; readonly factoryAppLogin: string }
): void => {
  const current = readBudgetPauseTicket(factoryRepo, factoryAppLogin);
  for (const action of planBudgetPauseTicket(pause, current, item)) {
    switch (action.kind) {
      case "open ticket":
        ghApi(["-X", "POST", `repos/${factoryRepo}/issues`, "-f", `title=${action.title}`, "-f", `body=${action.body}`]);
        break;
      case "update ticket":
        ghApi([
          "-X", "PATCH", `repos/${factoryRepo}/issues/${action.ticket}`,
          "-f", `title=${action.title}`, "-f", `body=${action.body}`,
        ]);
        break;
      case "comment on ticket":
        ghApi(["-X", "POST", `repos/${factoryRepo}/issues/${action.ticket}/comments`, "-f", `body=${action.body} ${statusMarker}`]);
        break;
    }
  }
};
