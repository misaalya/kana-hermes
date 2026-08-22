import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { REQUIRED_DOGFOOD_MATRIX } from "./dogfood-schema.mjs";

const DEFAULT_FILE = "dogfood/journal.json";
const MATRIX_STATUSES = new Set(["pending", "pass", "fail"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function jakartaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function rejectSensitiveText(value, label) {
  if (value.length > 1_000) throw new Error(`${label} must be at most 1000 characters.`);
  if (
    /(?:token|password|passwd|secret|api[_ -]?key)\s*[:=]\s*\S+/iu.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /:\/\/[^/\s]+:[^@\s]+@/u.test(value)
  ) {
    throw new Error(
      `${label} looks like it contains a credential. Store only sanitized operational evidence.`,
    );
  }
}

function parseFlags(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    if (["--replace", "--data-loss", "--credential-exposure"].includes(argument)) {
      flags.set(argument, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    index += 1;
    const current = flags.get(argument);
    flags.set(argument, current ? [...current, value] : [value]);
  }
  return flags;
}

function one(flags, name, fallback = "") {
  const values = flags.get(name);
  if (!values) return fallback;
  if (!Array.isArray(values) || values.length !== 1) {
    throw new Error(`${name} may be supplied only once.`);
  }
  return values[0];
}

function many(flags, name) {
  const values = flags.get(name);
  return Array.isArray(values) ? values : [];
}

function parseMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440) {
    throw new Error("--minutes must be an integer from 1 to 1440.");
  }
  return minutes;
}

function recordDay(journal, flags) {
  const date = one(flags, "--date", jakartaDate());
  if (!validDate(date)) throw new Error("--date must use YYYY-MM-DD.");
  const minutes = parseMinutes(one(flags, "--minutes"));
  const notes = one(flags, "--notes").trim();
  if (notes.length < 3) throw new Error("--notes must contain a short sanitized note.");
  rejectSensitiveText(notes, "--notes");

  const scenarios = [
    ...new Set(
      many(flags, "--scenario")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (scenarios.length === 0) throw new Error("Supply at least one --scenario.");
  for (const scenario of scenarios) {
    if (!REQUIRED_DOGFOOD_MATRIX.includes(scenario)) {
      throw new Error(`Unknown dogfood scenario: ${scenario}`);
    }
  }

  const days = Array.isArray(journal.days) ? journal.days : [];
  const existing = days.findIndex((day) => isRecord(day) && day.date === date);
  if (existing >= 0 && flags.get("--replace") !== true) {
    throw new Error(`A dogfood entry already exists for ${date}; use --replace intentionally.`);
  }
  const entry = {
    date,
    minutes,
    scenarios,
    notes,
    dataLoss: flags.get("--data-loss") === true,
    credentialExposure: flags.get("--credential-exposure") === true,
  };
  if (existing >= 0) days.splice(existing, 1, entry);
  else days.push(entry);
  days.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  journal.days = days;
  if (!journal.startedAt) journal.startedAt = date;
  return entry;
}

function markMatrix(journal, flags) {
  const id = one(flags, "--id");
  const status = one(flags, "--status");
  const evidence = one(flags, "--evidence").trim();
  if (!REQUIRED_DOGFOOD_MATRIX.includes(id)) {
    throw new Error(`Unknown dogfood matrix ID: ${id}`);
  }
  if (!MATRIX_STATUSES.has(status)) {
    throw new Error("--status must be pending, pass, or fail.");
  }
  if (status !== "pending" && evidence.length < 3) {
    throw new Error("Pass/fail evidence must contain a sanitized reference.");
  }
  rejectSensitiveText(evidence, "--evidence");
  const matrix = Array.isArray(journal.matrix) ? journal.matrix : [];
  const entry = matrix.find((candidate) => isRecord(candidate) && candidate.id === id);
  if (!entry) throw new Error(`Matrix row ${id} is missing from the journal.`);
  entry.status = status;
  entry.evidence = status === "pending" ? "" : evidence;
  entry.verifiedAt = status === "pending" ? null : new Date().toISOString();
  return entry;
}

async function writeAtomic(file, journal) {
  const absolute = path.resolve(file);
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, absolute);
}

function selfTest() {
  const journal = {
    schemaVersion: 1,
    startedAt: null,
    days: [],
    matrix: REQUIRED_DOGFOOD_MATRIX.map((id) => ({
      id,
      status: "pending",
      evidence: "",
    })),
    issues: [],
  };
  const flags = parseFlags([
    "--date",
    "2026-08-22",
    "--minutes",
    "45",
    "--scenario",
    "mock-only,refresh-and-resume",
    "--notes",
    "No private content recorded.",
  ]);
  const day = recordDay(journal, flags);
  assert.equal(day.scenarios.length, 2);
  assert.equal(journal.startedAt, "2026-08-22");
  assert.throws(() => recordDay(journal, flags), /already exists/u);
  const matrix = markMatrix(
    journal,
    parseFlags([
      "--id",
      "mock-only",
      "--status",
      "pass",
      "--evidence",
      "Desktop journey passed.",
    ]),
  );
  assert.equal(matrix.status, "pass");
  assert.throws(
    () => rejectSensitiveText("token=do-not-store-this", "test"),
    /credential/u,
  );
  process.stdout.write("Kana dogfood journal self-test passed.\n");
}

const [command, ...argumentsList] = process.argv.slice(2);
if (command === "--self-test") {
  selfTest();
} else {
  if (!["record-day", "mark-matrix"].includes(command)) {
    throw new Error(
      "Use record-day or mark-matrix. See docs/DOGFOOD.md for examples.",
    );
  }
  const flags = parseFlags(argumentsList);
  const file = one(flags, "--file", DEFAULT_FILE);
  flags.delete("--file");
  const journal = JSON.parse(await readFile(file, "utf8"));
  if (!isRecord(journal) || journal.schemaVersion !== 1) {
    throw new Error("Dogfood journal must use schemaVersion 1.");
  }
  const result =
    command === "record-day"
      ? recordDay(journal, flags)
      : markMatrix(journal, flags);
  await writeAtomic(file, journal);
  process.stdout.write(`${JSON.stringify({ updated: true, file, result }, null, 2)}\n`);
}
