import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { guardCaseWrong, leaksIn, relayAsks, wrongRelayAnswers, type RelayAnswer } from "./probes";

const token = `sk-ant-oat01-${"x".repeat(60)}`;
const tokenSha256 = createHash("sha256").update(token).digest("hex");

describe("the sandbox probe's leak check", () => {
  it("finds nothing in what a clean sandbox shows", () => {
    const text = "PATH=/usr/bin\nANTHROPIC_AUTH_TOKEN=stand-in-not-a-real-token\n[core]\n\tbare = false\n";
    expect(leaksIn(text, tokenSha256)).toEqual([]);
  });

  it("finds the Claude token by its hash", () => {
    expect(leaksIn(`SOMETHING=${token}`, tokenSha256)).toContain("the Claude token");
  });

  it("finds credential variables, GitHub tokens and git credential headers", () => {
    const text = `GH_TOKEN=x\nghs_${"a".repeat(36)}\n[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic x`;
    expect(leaksIn(text, tokenSha256)).toEqual(["a GitHub token", "a credential variable", "a git credential header"]);
  });
});

describe("the relay probe's check", () => {
  const answer = (index: number, status: number, body: string): RelayAnswer => ({ ask: relayAsks[index]!, status, body });
  const relayed = relayAsks.findIndex((ask) => ask.relayed);

  it("accepts refusals from the relay and a relayed POST /v1/messages", () => {
    expect(wrongRelayAnswers([answer(0, 404, '{"message":"not relayed"}'), answer(relayed, 400, "invalid_request_error")])).toEqual([]);
  });

  it("flags a path the relay forwarded and a POST /v1/messages it refused", () => {
    expect(wrongRelayAnswers([answer(0, 404, "Not Found"), answer(relayed, 404, '{"message":"not relayed"}')])).toEqual([
      "GET / got 404, expected refused",
      "POST /v1/messages got 404, expected relayed",
    ]);
  });
});

describe("the push guard probe's check", () => {
  it("accepts the planted reasons, with or without another", () => {
    expect(guardCaseWrong({ name: "clean", expected: [] }, { verdict: "push" })).toBeUndefined();
    expect(
      guardCaseWrong(
        { name: "token", expected: ["token found"] },
        { verdict: "refuse", reasons: [{ kind: "secret found", findings: [] }, { kind: "token found" }] }
      )
    ).toBeUndefined();
  });

  it("flags a push of planted work, a missed reason and a refused clean change", () => {
    expect(guardCaseWrong({ name: "token", expected: ["token found"] }, { verdict: "push" })).toBe("token: expected [token found], got []");
    expect(
      guardCaseWrong({ name: "workflow", expected: ["workflow path changed"] }, { verdict: "refuse", reasons: [{ kind: "token found" }] })
    ).toBe("workflow: expected [workflow path changed], got [token found]");
    expect(guardCaseWrong({ name: "clean", expected: [] }, { verdict: "refuse", reasons: [{ kind: "token found" }] })).toBe(
      "clean: expected [], got [token found]"
    );
  });
});
