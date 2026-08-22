import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

const REQUIRED_CASES = [
  "thinking",
  "approval",
  "protected-input",
  "answer-boundary",
  "after-completion",
];
const TERMINAL_OUTCOMES = new Set(["resumed", "completed", "error", "aborted"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function looksSensitive(value) {
  return (
    typeof value === "string" &&
    (/(?:token|password|passwd|secret|api[_ -]?key)\s*[:=]\s*\S+/iu.test(value) ||
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
      /:\/\/[^/\s]+:[^@\s]+@/u.test(value))
  );
}

function checkActiveRestart(value) {
  const blockers = [];
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return {
      passed: false,
      casesPassed: 0,
      casesRequired: REQUIRED_CASES.length,
      blockers: ["Evidence must use schemaVersion 1."],
    };
  }
  if (typeof value.hermesVersion !== "string" || value.hermesVersion.trim().length < 2) {
    blockers.push("Record the tested Hermes version.");
  }
  if (typeof value.modelProvider !== "string" || value.modelProvider.trim().length < 2) {
    blockers.push("Record the tested model/provider without credentials.");
  } else if (looksSensitive(value.modelProvider)) {
    blockers.push("Model/provider field looks like it contains a credential.");
  }
  if (!isIsoTimestamp(value.runAt)) blockers.push("Record runAt as an ISO timestamp.");

  const cases = new Map(
    (Array.isArray(value.cases) ? value.cases : [])
      .filter(isRecord)
      .map((entry) => [entry.id, entry]),
  );
  let casesPassed = 0;
  for (const id of REQUIRED_CASES) {
    const entry = cases.get(id);
    if (!entry) {
      blockers.push(`Required restart case '${id}' is missing.`);
      continue;
    }
    if (entry.status !== "pass") {
      blockers.push(`Restart case '${id}' is ${String(entry.status || "pending")}.`);
      continue;
    }
    const caseBlockers = [];
    if (!isIsoTimestamp(entry.testedAt)) caseBlockers.push("testedAt is not ISO");
    if (typeof entry.restartPoint !== "string" || entry.restartPoint.trim().length < 5) {
      caseBlockers.push("restartPoint is missing");
    }
    if (
      !Array.isArray(entry.connectionStates) ||
      !entry.connectionStates.includes("reconnecting") ||
      !entry.connectionStates.includes("connected")
    ) {
      caseBlockers.push("connectionStates must include reconnecting and connected");
    }
    if (!TERMINAL_OUTCOMES.has(entry.terminalOutcome)) {
      caseBlockers.push("terminalOutcome is invalid");
    }
    if (entry.userPromptCopies !== 1) caseBlockers.push("userPromptCopies must equal 1");
    if (![0, 1].includes(entry.assistantMessageCopies)) {
      caseBlockers.push("assistantMessageCopies must be 0 or 1");
    }
    if (["approval", "protected-input"].includes(id) && entry.protectedInputCleared !== true) {
      caseBlockers.push("protectedInputCleared must be true");
    }
    for (const field of [
      "staleProtectedInputAccepted",
      "falseBusyState",
      "dataLoss",
      "credentialExposure",
    ]) {
      if (entry[field] !== false) caseBlockers.push(`${field} must be false`);
    }
    if (typeof entry.evidence !== "string" || entry.evidence.trim().length < 10) {
      caseBlockers.push("evidence is too short");
    } else if (looksSensitive(entry.evidence)) {
      caseBlockers.push("evidence looks like it contains a credential");
    }
    if (caseBlockers.length === 0) casesPassed += 1;
    else blockers.push(`Restart case '${id}': ${caseBlockers.join("; ")}.`);
  }

  return {
    passed: blockers.length === 0 && casesPassed === REQUIRED_CASES.length,
    casesPassed,
    casesRequired: REQUIRED_CASES.length,
    blockers,
  };
}

function passingFixture() {
  return {
    schemaVersion: 1,
    hermesVersion: "0.20.1",
    modelProvider: "test provider/model",
    runAt: "2026-08-22T10:00:00.000Z",
    cases: REQUIRED_CASES.map((id) => ({
      id,
      status: "pass",
      testedAt: "2026-08-22T10:00:00.000Z",
      restartPoint: `Restarted during ${id}`,
      connectionStates: ["connected", "reconnecting", "connected"],
      terminalOutcome: "completed",
      userPromptCopies: 1,
      assistantMessageCopies: 1,
      protectedInputCleared: ["approval", "protected-input"].includes(id)
        ? true
        : null,
      staleProtectedInputAccepted: false,
      falseBusyState: false,
      dataLoss: false,
      credentialExposure: false,
      evidence: `Sanitized diagnostics captured for ${id}.`,
    })),
  };
}

function selfTest() {
  assert.equal(checkActiveRestart(passingFixture()).passed, true);
  const failed = passingFixture();
  failed.cases[0].assistantMessageCopies = 2;
  failed.cases[1].protectedInputCleared = false;
  const report = checkActiveRestart(failed);
  assert.equal(report.passed, false);
  assert.equal(report.casesPassed, 3);
  assert.ok(report.blockers.some((blocker) => blocker.includes("assistantMessageCopies")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("protectedInputCleared")));
  process.stdout.write("Hermes active-restart evidence self-test passed.\n");
}

const argumentsList = process.argv.slice(2);
if (argumentsList.includes("--self-test")) {
  selfTest();
} else {
  const file =
    process.env.KANA_HERMES_ACTIVE_RESTART_FILE ||
    argumentsList[0] ||
    "acceptance/hermes-active-restart.json";
  const value = JSON.parse(await readFile(file, "utf8"));
  const report = checkActiveRestart(value);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}
