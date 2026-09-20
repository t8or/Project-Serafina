export function initialReportId(reports, search = "") {
  const params = new URLSearchParams(search);
  if (params.has("revision"))
    return (
      reports.find((r) => String(r.id) === params.get("revision"))?.id ?? null
    );
  if (params.has("property"))
    return (
      reports.find((r) => String(r.property_id) === params.get("property"))
        ?.id ?? null
    );
  if (params.has("file"))
    return (
      reports.find((r) => String(r.file_id) === params.get("file"))?.id ?? null
    );
  return reports[0]?.id ?? null;
}

export function presentPassages(passages = []) {
  return passages.map((p, index) => {
    const text = p.text || p.quote || "";
    let table = null;
    try {
      const value = JSON.parse(text);
      if (
        Array.isArray(value.headers) &&
        Array.isArray(value.cells) &&
        value.cells.every(Array.isArray)
      )
        table = value;
    } catch {
      /* Most passages are ordinary report text. */
    }
    return { ...p, key: `${p.id || p.page}-${index}`, text, table };
  });
}

export function initializeReportsPage() {
  return {
    details: null,
    detailsError: "",
    reports: [],
    selectedId: "",
    loading: true,
    loadError: "",
    contextMissing: false,
    question: "",
    answer: null,
    citations: [],
    asking: false,
    askError: "",
    query: "",
    results: [],
    searching: false,
    searched: false,
    searchError: "",
    epoch: 0,
    questionRequest: 0,
    searchRequest: 0,
    get selectedReport() {
      return this.reports.find((r) => String(r.id) === String(this.selectedId));
    },
    get coverage() {
      return this.selectedReport?.coverage;
    },
    get coverageLabel() {
      if (!this.coverage) return "Coverage unavailable";
      return `${this.coverage.layout_pages ?? 0} / ${this.coverage.total_pages ?? "—"} pages read`;
    },
    async request(url, options) {
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || `Request failed (${response.status})`);
      return data;
    },
    async init() {
      await this.loadReports();
    },
    async loadReports() {
      this.loading = true;
      this.loadError = "";
      try {
        const data = await this.request("/api/reports");
        if (!Array.isArray(data.reports))
          throw new Error("The report list could not be read.");
        this.reports = data.reports;
        const id = initialReportId(this.reports, window.location.search);
        this.contextMissing = id === null && Boolean(window.location.search);
        this.selectedId = id == null ? "" : String(id);
        this.loadDetails();
      } catch (error) {
        this.loadError = error.message;
      } finally {
        this.loading = false;
      }
    },
    async loadDetails() {
      const epoch = this.epoch,
        id = this.selectedId;
      this.details = null;
      this.detailsError = "";
      if (!id) return;
      try {
        const details = await this.request(`/api/reports/${id}`);
        if (epoch === this.epoch && id === this.selectedId)
          this.details = details;
      } catch (error) {
        if (epoch === this.epoch && id === this.selectedId)
          this.detailsError = error.message;
      }
    },
    get processingLabel() {
      const t = this.details?.timings;
      if (!t) return "Processing timing unavailable.";
      const seconds = Number.isFinite(t.pipeline_seconds)
        ? t.pipeline_seconds.toFixed(1) + "s"
        : "—";
      return `${seconds} processing · ${t.fresh_pages ?? 0} pages newly processed · ${t.cached_pages ?? 0} pages reused`;
    },
    selectReport() {
      this.epoch++;
      this.questionRequest++;
      this.searchRequest++;
      this.question = "";
      this.answer = null;
      this.citations = [];
      this.askError = "";
      this.asking = false;
      this.query = "";
      this.results = [];
      this.searched = false;
      this.searchError = "";
      this.searching = false;
      this.contextMissing = false;
      this.loadDetails();
      const params = new URLSearchParams();
      if (this.selectedId) params.set("revision", this.selectedId);
      history.replaceState(null, "", `${window.location.pathname}?${params}`);
    },
    async askReport() {
      if (!this.selectedReport || this.asking || !this.question.trim()) return;
      const epoch = this.epoch,
        requestId = ++this.questionRequest,
        id = this.selectedId;
      this.asking = true;
      this.askError = "";
      this.answer = null;
      this.citations = [];
      try {
        const result = await this.request(`/api/reports/${id}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: this.question.trim() }),
        });
        if (epoch !== this.epoch || requestId !== this.questionRequest) return;
        this.answer = result;
        this.citations = presentPassages(result.citations);
      } catch (error) {
        if (epoch === this.epoch && requestId === this.questionRequest)
          this.askError = error.message;
      } finally {
        if (epoch === this.epoch && requestId === this.questionRequest)
          this.asking = false;
      }
    },
    async searchEvidence() {
      if (!this.selectedReport || this.searching || !this.query.trim()) return;
      const epoch = this.epoch,
        requestId = ++this.searchRequest,
        id = this.selectedId;
      this.searching = true;
      this.searchError = "";
      this.results = [];
      this.searched = false;
      try {
        const data = await this.request(
          `/api/reports/${id}/search?q=${encodeURIComponent(this.query.trim())}`,
        );
        if (epoch !== this.epoch || requestId !== this.searchRequest) return;
        this.results = presentPassages(data.passages);
        this.searched = true;
      } catch (error) {
        if (epoch === this.epoch && requestId === this.searchRequest)
          this.searchError = error.message;
      } finally {
        if (epoch === this.epoch && requestId === this.searchRequest)
          this.searching = false;
      }
    },
  };
}
