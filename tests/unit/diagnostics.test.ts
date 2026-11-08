import { expect, it } from "vitest";
import { ApplyFailure } from "../../src/geogebra";
import {
  DiagnosticHistory,
  failureNotice,
  metadataNotice,
} from "../../src/diagnostics";

it("exports only allowlisted technical facts after a private failure", () => {
  const privateText = "Draft λ in secret.ggb: a=42";
  const notice = failureNotice(
    new ApplyFailure("APPLY_ROLLED_BACK", privateText, "APPLY_METADATA_FAILED"),
    "transaction",
  );
  const history = new DiagnosticHistory();
  history.record(notice.phase, "APPLY_ROLLED_BACK");
  history.record(notice.phase, "APPLY_METADATA_FAILED");
  const report = history.report(`Mozilla/5.0 Chrome/120.0 ${privateText}`);
  expect(notice.message).not.toContain(privateText);
  expect(report).not.toContain(privateText);
  expect(JSON.parse(report)).toMatchObject({
    applicationVersion: "0.1.0",
    browserFamily: "Chromium",
    geogebraVersion: "5.4.920.0",
  });
  expect(report).toContain("APPLY_METADATA_FAILED");
});

it("gives each failure phase a fixed recovery message without leaking exception text", () => {
  const privateText = "private object Private42 in secret.ggb";
  const notices = [
    failureNotice(new Error(privateText), "compiler"),
    failureNotice(new Error(privateText), "applet"),
    failureNotice(new Error(privateText), "transaction"),
    metadataNotice(`Authoring Source metadata is malformed; ${privateText}`),
    failureNotice(new Error(privateText), "file"),
    failureNotice(new Error(privateText), "recovery"),
    failureNotice(new Error(privateText), "compatibility"),
  ];
  expect(new Set(notices.map((notice) => notice.message)).size).toBe(7);
  expect(notices.every((notice) => notice.message.length > 30)).toBe(true);
  expect(JSON.stringify(notices)).not.toContain(privateText);
  const history = new DiagnosticHistory();
  history.record("file", privateText);
  expect(history.report("private browser data")).not.toContain(privateText);
});
