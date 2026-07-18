import { restoreDialogFocus, trapDialogFocus } from "./dialog.js";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// Keep this deliberately narrow: the local Docling workflow currently accepts PDFs only.
export const SUPPORTED_FILE_TYPES = Object.freeze({
  "application/pdf": ".pdf",
});

const isSupportedPdf = (file) => {
  const hasPdfExtension = /\.pdf$/i.test(file.name);
  const hasPdfMimeType = Boolean(SUPPORTED_FILE_TYPES[file.type]);

  return hasPdfExtension && hasPdfMimeType;
};

const readResponseError = async (response, fallbackMessage) => {
  try {
    const body = await response.json();
    return body.error || body.message || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

export function initializeFileUpload() {
  return {
    files: [],
    maxSize: MAX_FILE_SIZE_BYTES,
    dragActive: false,
    uploading: false,
    showOptionsModal: false,
    processing: false,
    processingStep: "",
    processingCurrent: 0,
    processingTotal: 0,
    processingError: "",
    pendingExtractions: [],
    feedback: {
      title: "",
      messages: [],
    },
    previouslyFocusedElement: null,

    handleFiles(fileList) {
      if (this.processing) return;

      // A changed selection starts a new processing session. Files already accepted by
      // the API remain available in Content even if the user abandons a failed retry.
      this.pendingExtractions = [];
      this.processingError = "";
      this.validateAndAddFiles(fileList);
    },

    validateAndAddFiles(fileList) {
      const selectedFiles = [...fileList];
      const invalidFiles = [];

      selectedFiles.forEach((file) => {
        if (!isSupportedPdf(file)) {
          invalidFiles.push(`${file.name}: choose a PDF file.`);
          return;
        }

        if (file.size > this.maxSize) {
          invalidFiles.push(`${file.name}: the file is larger than 50 MB.`);
          return;
        }

        this.files.push(file);
      });

      if (invalidFiles.length > 0) {
        this.feedback = {
          title:
            invalidFiles.length === 1
              ? "1 file was not added"
              : `${invalidFiles.length} files were not added`,
          messages: invalidFiles,
        };
        this.$nextTick(() => this.$refs.validationBanner?.focus());
      } else {
        this.clearFeedback();
      }
    },

    removeFile(index) {
      if (this.processing) return;

      this.files.splice(index, 1);
      this.pendingExtractions = [];
      this.processingError = "";
      this.clearFeedback();
    },

    clearFeedback() {
      this.feedback = { title: "", messages: [] };
    },

    chooseFiles() {
      this.$refs.fileInput?.click();
    },

    openOptionsModal(event) {
      if (this.files.length === 0 || this.processing) return;

      this.previouslyFocusedElement =
        event?.currentTarget || document.activeElement;
      this.showOptionsModal = true;
      this.$nextTick(() => this.$refs.optionsDialog?.focus());
    },

    closeOptionsModal() {
      // Once a request is in flight, keep its status visible and prevent accidental
      // dismissal. Escape and the close controls work again as soon as it settles.
      if (this.processing) return;

      this.showOptionsModal = false;
      this.$nextTick(() => restoreDialogFocus(this.previouslyFocusedElement));
    },

    trapDialogFocus(event) {
      if (!this.showOptionsModal || !this.$refs.optionsDialog) return;
      trapDialogFocus(event, this.$refs.optionsDialog);
    },

    get processingPercent() {
      if (this.processingTotal === 0) return 0;
      return Math.round((this.processingCurrent / this.processingTotal) * 100);
    },

    async uploadSelectedFiles() {
      this.processingStep =
        this.files.length === 1 ? "Uploading PDF…" : "Uploading PDFs…";
      this.processingCurrent = 0;
      this.processingTotal = 0;

      const formData = new FormData();
      this.files.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          await readResponseError(
            response,
            "The PDFs could not be uploaded. Check your connection and try again.",
          ),
        );
      }

      const result = await response.json();
      const uploadedFiles = result.files || [];

      if (uploadedFiles.length === 0) {
        throw new Error(
          "The upload finished, but no PDFs were returned for processing. Try again.",
        );
      }

      this.pendingExtractions = uploadedFiles;
    },

    async extractPendingFiles() {
      const filesToExtract = [...this.pendingExtractions];
      const failedExtractions = [];

      this.processingCurrent = 0;
      this.processingTotal = filesToExtract.length;

      for (const file of filesToExtract) {
        this.processingStep = `Processing ${file.original_filename}…`;

        try {
          const response = await fetch(`/api/extract/${file.id}`, {
            method: "POST",
          });

          if (!response.ok) {
            const message = await readResponseError(
              response,
              `Could not process ${file.original_filename}.`,
            );
            failedExtractions.push({ ...file, processingError: message });
          }
        } catch (error) {
          failedExtractions.push({
            ...file,
            processingError:
              error.message || `Could not process ${file.original_filename}.`,
          });
        } finally {
          this.processingCurrent += 1;
        }
      }

      this.pendingExtractions = failedExtractions;

      if (failedExtractions.length > 0) {
        const fileNames = failedExtractions
          .map((file) => file.original_filename)
          .join(", ");
        throw new Error(
          `${failedExtractions.length === 1 ? "This PDF" : "These PDFs"} could not be processed: ${fileNames}. Try again to retry only ${failedExtractions.length === 1 ? "this file" : "these files"}.`,
        );
      }
    },

    async startProcessing() {
      if (this.files.length === 0 || this.processing) return;

      this.processing = true;
      this.uploading = true;
      this.processingError = "";

      try {
        if (this.pendingExtractions.length === 0) {
          await this.uploadSelectedFiles();
        }

        await this.extractPendingFiles();
        this.processingStep = "Processing complete. Opening your dashboard…";
        this.files = [];
        window.location.assign("dashboard.html");
      } catch (error) {
        console.error("Processing error:", error);
        this.processingError =
          error.message ||
          "Processing failed. Check your connection and try again.";
        this.processingStep = "Processing stopped";
      } finally {
        this.processing = false;
        this.uploading = false;
        this.$nextTick(() => this.$refs.startProcessingButton?.focus());
      }
    },

    // Preserve the public method used by the original reusable component.
    async uploadFiles() {
      return this.startProcessing();
    },
  };
}
