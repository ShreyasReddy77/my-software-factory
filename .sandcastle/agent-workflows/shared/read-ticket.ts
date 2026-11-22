// Writes the ticket the agent reads to $AGENT_IO_DIR/ticket.md.
//   GH_TOKEN          App token for TARGET_REPO: Issues read
//   TARGET_REPO       owner/repo; ISSUE the ticket's number
//   FACTORY_APP_SLUG  the App's slug, from the token step
import * as fs from "node:fs";
import * as path from "node:path";
import { required } from "./common";
import { ghApi, ghPages } from "./gh";
import { renderTicket, type Issue, type IssueComment } from "./ticket";

const issuePath = `repos/${required("TARGET_REPO")}/issues/${Number(required("ISSUE"))}`;
const text = renderTicket(
  ghApi([issuePath]) as Issue,
  ghPages<IssueComment[]>(`${issuePath}/comments?per_page=100`).flat(),
  `${required("FACTORY_APP_SLUG")}[bot]`
);
fs.writeFileSync(path.join(required("AGENT_IO_DIR"), "ticket.md"), text);
console.log(text);
