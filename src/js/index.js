import "../css/style.css";

import Alpine from "alpinejs";
import persist from "@alpinejs/persist";
import { initializeContentPage } from "./content.js";
import { restoreDialogFocus, trapDialogFocus } from "./dialog.js";
import { initializeFileUpload } from "./upload.js";
import * as assessmentView from "./assessment-view.js";

window.assessmentView = assessmentView;

let apexChartsPromise;

// Charts are only needed after the dashboard has real data. Keeping them out
// of the initial bundle makes every route—and the dashboard empty state—load
// without paying for the visualization library.
window.loadApexCharts = () => {
  if (!apexChartsPromise) {
    apexChartsPromise = import("apexcharts")
      .then(({ default: ApexCharts }) => {
        window.ApexCharts = ApexCharts;
        return ApexCharts;
      })
      .catch((error) => {
        apexChartsPromise = null;
        throw error;
      });
  }
  return apexChartsPromise;
};

window.dialogFocus = Object.freeze({
  restore: restoreDialogFocus,
  trap: trapDialogFocus,
});

Alpine.plugin(persist);
Alpine.data("contentPage", initializeContentPage);
Alpine.data("fileUpload", initializeFileUpload);

window.Alpine = Alpine;
Alpine.start();
