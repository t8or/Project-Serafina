import test from "node:test";
import assert from "node:assert/strict";
import { initializeFileUpload } from "../src/js/upload.js";

test("assessment action opens progress and starts once without a second confirmation", async () => {
  const upload = initializeFileUpload();
  const calls = [];
  upload.files = [{ name: "report.pdf" }];
  upload.openOptionsModal = () => calls.push("progress");
  upload.startProcessing = async () => {
    upload.processing = true;
    calls.push("process");
  };
  await upload.beginAssessment({});
  await upload.beginAssessment({});
  assert.deepEqual(calls, ["progress", "process"]);
});

test("empty selection never opens progress or starts processing", async () => {
  const upload = initializeFileUpload();
  upload.openOptionsModal = () => assert.fail("opened with no PDFs");
  upload.startProcessing = () => assert.fail("processed with no PDFs");
  await upload.beginAssessment({});
});

test("retry after extraction failure reuses uploaded files", async () => {
  const upload = initializeFileUpload();
  upload.files = [{ name: "report.pdf" }];
  upload.pendingExtractions = [{ id: 7 }];
  upload.$nextTick = () => {};
  upload.uploadSelectedFiles = () =>
    assert.fail("uploaded a duplicate on retry");
  upload.extractPendingFiles = async () => {
    throw new Error("Extraction unavailable");
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await upload.startProcessing();
  } finally {
    console.error = originalError;
  }
  assert.equal(upload.processingError, "Extraction unavailable");
  assert.equal(upload.processing, false);
  assert.deepEqual(upload.pendingExtractions, [{ id: 7 }]);
});
