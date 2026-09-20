// Presentation helpers only: recommendations and scores belong to the scoring service.
export function missingCount(property) {
  return Object.values(property?.breakdown || {}).filter(
    (factor) => factor.rawValue == null,
  ).length;
}

export function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

export function filterAssessments(
  properties,
  { decision = null, query = "", missingOnly = false, sort = "recent" } = {},
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const result = properties.filter((property) => {
    if (decision && property.decisionColor !== decision) return false;
    if (missingOnly && missingCount(property) === 0) return false;
    const haystack = [
      property.propertyName,
      ...Object.values(property.address || {}),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  if (sort === "name")
    return result.sort((a, b) =>
      (a.propertyName || "").localeCompare(b.propertyName || ""),
    );
  if (sort === "score")
    return result.sort(
      (a, b) =>
        (Number.isFinite(b.score) ? b.score : -Infinity) -
        (Number.isFinite(a.score) ? a.score : -Infinity),
    );
  return result.sort((a, b) => Number(b.id) - Number(a.id));
}

export function filterAssessmentGroups(groups, decision = null) {
  const field = {
    green: "moveForward",
    yellow: "needsReview",
    red: "rejected",
    gray: "insufficientData",
  }[decision];
  return groups
    .map((group) => {
      const values = {
        ...group,
        insufficientData: Math.max(
          0,
          group.total - group.moveForward - group.needsReview - group.rejected,
        ),
      };
      if (!field) return values;
      const total = values[field];
      return {
        ...values,
        moveForward: 0,
        needsReview: 0,
        rejected: 0,
        insufficientData: 0,
        [field]: total,
        total,
      };
    })
    .filter((group) => group.total > 0);
}
