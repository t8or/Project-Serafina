import test from "node:test";
import assert from "node:assert/strict";
import {
  initialReportId,
  presentPassages,
  initializeReportsPage,
} from "../src/js/reports.js";
const reports = [
  { id: 17, property_id: 2, file_id: 2 },
  { id: 16, property_id: 1, file_id: 1 },
  { id: 12, property_id: 2, file_id: 2 },
];
test("contextual report links select the requested file, property or revision", () => {
  assert.equal(initialReportId(reports, "?property=1"), 16);
  assert.equal(initialReportId(reports, "?file=2"), 17);
  assert.equal(initialReportId(reports, "?revision=12"), 12);
  assert.equal(initialReportId(reports, "?property=99"), null);
  assert.equal(initialReportId([], ""), null);
});
test("source passages retain literal untrusted content and only accept structured table arrays", () => {
  const [text, table, invalid] = presentPassages([
    { id: "a", page: 1, quote: "<script>alert(1)</script>" },
    {
      id: "b",
      page: 2,
      text: JSON.stringify({ headers: ["Radius"], cells: [["3 mile"]] }),
    },
    {
      id: "c",
      page: 3,
      text: JSON.stringify({ headers: ["Radius"], cells: ["bad row"] }),
    },
  ]);
  assert.equal(text.text, "<script>alert(1)</script>");
  assert.equal(text.table, null);
  assert.deepEqual(table.table.cells, [["3 mile"]]);
  assert.equal(invalid.table, null);
});
test("an answer returning after switching reports cannot overwrite the current report or busy state", async () => {
  const view = initializeReportsPage();
  view.reports = reports;
  view.selectedId = "17";
  view.question = "Amenities?";
  let resolve;
  view.request = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = view.askReport();
  view.epoch++;
  view.questionRequest++;
  view.selectedId = "16";
  view.asking = true;
  resolve({ answer: "Old report answer", citations: [] });
  await pending;
  assert.equal(view.answer, null);
  assert.equal(view.asking, true);
});
test("failed evidence search from an earlier report cannot show an error on a new report", async () => {
  const view = initializeReportsPage();
  view.reports = reports;
  view.selectedId = "17";
  view.query = "rent";
  let reject;
  view.request = () =>
    new Promise((_, r) => {
      reject = r;
    });
  const pending = view.searchEvidence();
  view.epoch++;
  view.searchRequest++;
  view.selectedId = "16";
  view.searching = false;
  reject(new Error("Old report failed"));
  await pending;
  assert.equal(view.searchError, "");
  assert.deepEqual(view.results, []);
});
