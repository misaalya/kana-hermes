import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { REQUIRED_DOGFOOD_MATRIX } from "./dogfood-schema.mjs";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function checkDogfood(value) {
  const blockers = [];
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { passed: false, blockers: ["Journal must use schemaVersion 1."] };
  }
  const days = Array.isArray(value.days) ? value.days : [];
  const validDays = days.flatMap((day) => {
    if (!isRecord(day)) return [];
    const timestamp = validDate(day.date);
    return timestamp === null ? [] : [{ ...day, timestamp }];
  });
  const distinctDays = [...new Set(validDays.map((day) => day.date))];
  const timestamps = validDays.map((day) => day.timestamp);
  const spanDays =
    timestamps.length > 0
      ? Math.floor((Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000) + 1
      : 0;
  if (distinctDays.length < 7) {
    blockers.push(`Dogfood has ${distinctDays.length}/7 distinct recorded days.`);
  }
  if (spanDays < 7) blockers.push(`Dogfood spans ${spanDays}/7 calendar days.`);
  for (const day of validDays) {
    if (day.dataLoss === true) blockers.push(`Data loss was recorded on ${day.date}.`);
    if (day.credentialExposure === true) {
      blockers.push(`Credential exposure was recorded on ${day.date}.`);
    }
  }

  const matrix = new Map(
    (Array.isArray(value.matrix) ? value.matrix : [])
      .filter(isRecord)
      .map((entry) => [entry.id, entry]),
  );
  for (const id of REQUIRED_DOGFOOD_MATRIX) {
    const entry = matrix.get(id);
    if (!entry) blockers.push(`Required matrix case '${id}' is missing.`);
    else if (entry.status !== "pass") {
      blockers.push(`Required matrix case '${id}' is ${String(entry.status || "pending")}.`);
    } else if (typeof entry.evidence !== "string" || entry.evidence.trim().length < 3) {
      blockers.push(`Required matrix case '${id}' has no evidence note.`);
    }
  }

  const issues = Array.isArray(value.issues) ? value.issues.filter(isRecord) : [];
  const blockingIssues = issues.filter(
    (issue) =>
      ["P0", "P1"].includes(String(issue.severity)) &&
      !["verified", "wontfix"].includes(String(issue.status)),
  );
  for (const issue of blockingIssues) {
    blockers.push(
      `${String(issue.severity)} issue ${String(issue.id || "without ID")} is ${String(issue.status || "open")}.`,
    );
  }
  for (const issue of issues) {
    if (issue.dataLoss === true && issue.status !== "verified") {
      blockers.push(`Data-loss issue ${String(issue.id || "without ID")} is not verified.`);
    }
  }

  return {
    passed: blockers.length === 0,
    distinctDays: distinctDays.length,
    spanDays,
    matrixPassed: REQUIRED_DOGFOOD_MATRIX.length - REQUIRED_DOGFOOD_MATRIX.filter(
      (id) => matrix.get(id)?.status !== "pass",
    ).length,
    matrixRequired: REQUIRED_DOGFOOD_MATRIX.length,
    blockingIssueCount: blockingIssues.length,
    blockers,
  };
}

function selfTest() {
  const matrix = REQUIRED_DOGFOOD_MATRIX.map((id) => ({
    id,
    status: "pass",
    evidence: "checked",
  }));
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    dataLoss: false,
    credentialExposure: false,
  }));
  assert.equal(checkDogfood({ schemaVersion: 1, days, matrix, issues: [] }).passed, true);
  const failed = checkDogfood({
    schemaVersion: 1,
    days: days.slice(0, 2),
    matrix,
    issues: [{ id: "KANA-1", severity: "P1", status: "fixed" }],
  });
  assert.equal(failed.passed, false);
  assert.ok(failed.blockers.some((blocker) => blocker.includes("2/7")));
  assert.ok(failed.blockers.some((blocker) => blocker.includes("P1")));
  process.stdout.write("Kana dogfood gate self-test passed.\n");
}

const argumentsList = process.argv.slice(2);
if (argumentsList.includes("--self-test")) {
  selfTest();
} else {
  const file = process.env.KANA_DOGFOOD_FILE || argumentsList[0] || "dogfood/journal.json";
  const value = JSON.parse(await readFile(file, "utf8"));
  const report = checkDogfood(value);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}
