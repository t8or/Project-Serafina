import test from "node:test";
import assert from "node:assert/strict";
import {
  filterAssessments,
  formatScore,
  missingCount,
} from "../src/js/assessment-view.js";

const properties = [
  {
    id: 1,
    propertyName: "Hawks Landing",
    address: { city: "Hickory", stateAbbr: "NC" },
    decisionColor: "red",
    score: 4.52,
    breakdown: { population: { rawValue: 0 }, income: { rawValue: null } },
  },
  {
    id: 2,
    propertyName: "Serafina",
    address: { city: "Phoenix", stateAbbr: "AZ" },
    decisionColor: "yellow",
    score: 5.53,
    breakdown: { population: { rawValue: 10 } },
  },
  {
    id: 3,
    propertyName: "Scanned report",
    address: {},
    decisionColor: "gray",
    score: null,
    breakdown: { population: { rawValue: null } },
  },
];

test("search combines location terms, recommendation and missing inputs", () => {
  assert.deepEqual(
    filterAssessments(properties, {
      query: "  HICKORY nc ",
      decision: "red",
      missingOnly: true,
    }).map((p) => p.id),
    [1],
  );
  assert.deepEqual(
    filterAssessments(properties, { query: "Phoenix", missingOnly: true }),
    [],
  );
});

test("missing is distinct from a real zero and an unscored property remains searchable", () => {
  assert.equal(missingCount(properties[0]), 1);
  assert.deepEqual(
    filterAssessments(properties, { decision: "gray" }).map((p) => p.id),
    [3],
  );
  assert.equal(formatScore(null), "—");
  assert.equal(formatScore(undefined), "—");
  assert.equal(formatScore(0), "0.0");
});

test("sort puts unscored properties last and does not mutate the API list", () => {
  assert.deepEqual(
    filterAssessments(properties, { sort: "score" }).map((p) => p.id),
    [2, 1, 3],
  );
  assert.deepEqual(
    filterAssessments(properties).map((p) => p.id),
    [3, 2, 1],
  );
  assert.deepEqual(
    properties.map((p) => p.id),
    [1, 2, 3],
  );
});

test("empty collections and unmatched searches return empty results", () => {
  assert.deepEqual(filterAssessments([]), []);
  assert.deepEqual(
    filterAssessments(properties, { query: "unknown property" }),
    [],
  );
});
