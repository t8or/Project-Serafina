import { waitForExtraction } from './extraction-client.js';
import {
  restoreDialogFocus,
  trapDialogFocus as trapFocusWithinDialog,
} from "./dialog.js";

export function initializeContentPage() {
  return {
    page: "content",
    loaded: true,
    darkMode: false,
    stickyMenu: false,
    sidebarToggle: false,
    scrollTop: false,
    files: [],
    processingFiles: new Set(),
    isLoading: true,
    loadError: "",
    loadWarning: "",
    showToast: false,
    toastMessage: "",
    toastType: "success",
    filePendingDeletion: null,
    dialogReturnFocus: null,

    getFileTypeDisplay(fileType) {
      if (!fileType) return "UNKNOWN";

      const type = fileType.toLowerCase();

      // Handle special cases
      if (type.includes("spreadsheetml") || type.includes("excel")) {
        return "EXCEL";
      }
      if (type.includes("csv")) {
        return "CSV";
      }

      // If it's a MIME type (contains '/')
      if (type.includes("/")) {
        return type.split("/")[1].toUpperCase();
      }

      // If it's just an extension
      return type.toUpperCase();
    },

    async showNotification(message, type = "success") {
      this.toastMessage = message;
      this.toastType = type;
      this.showToast = true;
      setTimeout(() => {
        this.showToast = false;
      }, 3000);
    },

    async fetchFiles() {
      this.isLoading = true;
      this.loadError = "";
      this.loadWarning = "";
      try {
        // First fetch the regular files
        const filesResponse = await fetch("/api/files");
        if (!filesResponse.ok) {
          throw new Error(
            `Unable to load files (HTTP ${filesResponse.status})`,
          );
        }

        const filesData = await filesResponse.json();
        if (!Array.isArray(filesData.files)) {
          throw new Error("The files response was not in the expected format");
        }

        // Set files with is_extracted flag set to false by default
        const regularFiles = filesData.files.map((file) => ({
          ...file,
          is_extracted: false,
        }));

        // Try to fetch extracted files
        try {
          const extractedResponse = await fetch("/api/files/extracted");
          if (extractedResponse.ok) {
            const extractedData = await extractedResponse.json();
            if (!Array.isArray(extractedData.files)) {
              throw new Error(
                "The extracted files response was not in the expected format",
              );
            }
            // Add extracted files to the list
            const extractedFiles = extractedData.files.map((file) => ({
              ...file,
              is_extracted: true,
            }));
            this.files = [...regularFiles, ...extractedFiles];
          } else {
            this.files = regularFiles;
            this.loadWarning =
              "Uploaded files loaded, but extracted content is temporarily unavailable.";
          }
        } catch (extractError) {
          console.warn("Extracted files endpoint not available:", extractError);
          this.files = regularFiles;
          this.loadWarning =
            "Uploaded files loaded, but extracted content is temporarily unavailable.";
        }
      } catch (error) {
        console.error("Error fetching files:", error);
        this.files = [];
        this.loadError = error.message || "Unable to load uploaded content.";
      } finally {
        this.isLoading = false;
      }
    },

    openDeleteConfirmation(file, trigger) {
      this.filePendingDeletion = file;
      this.dialogReturnFocus = trigger;
      this.$nextTick(() => this.$refs.deleteCancel?.focus());
    },

    closeDeleteConfirmation() {
      this.filePendingDeletion = null;
      this.$nextTick(() => restoreDialogFocus(this.dialogReturnFocus));
    },

    trapDialogFocus(event) {
      trapFocusWithinDialog(event, event.currentTarget);
    },

    async deleteFile() {
      const fileId = this.filePendingDeletion?.id;
      if (!fileId) return;

      this.filePendingDeletion = null;
      try {
        const response = await fetch(`/api/files/${fileId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to delete file");
        }

        // First update the local state to remove the file
        this.files = this.files.filter((file) => file.id !== fileId);

        // Then fetch the updated list
        await this.fetchFiles();

        // Show success notification after the list is updated
        this.showNotification("File deleted successfully");
      } catch (error) {
        console.error("Error deleting file:", error);
        this.showNotification(
          "Failed to delete file: " + error.message,
          "error",
        );
      } finally {
        this.$nextTick(() => restoreDialogFocus(this.dialogReturnFocus));
      }
    },

    async extractText(fileId, fileName, fileType) {
      if (this.processingFiles.has(fileId)) return;

      try {
        this.processingFiles.add(fileId);
        this.showNotification("Starting local Docling extraction...", "info");

        const response = await fetch(`/api/extract/${fileId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName,
            fileType,
          }),
        });

        if (!response.ok) throw new Error("Failed to extract text");

        const result = await waitForExtraction(response);
        if (result.success) {
          if (result.sections) {
            const sectionCount = result.sections.length;
            this.showNotification(
              `${result.partial ? "Partial extraction; review unresolved pages." : "Full report processed."} Generated ${sectionCount} section files.`,
            );
          } else {
            this.showNotification("Text extracted successfully.");
          }
          // Refresh the file list
          await this.fetchFiles();
        } else {
          throw new Error(result.error || "Failed to extract text");
        }
      } catch (error) {
        console.error("Error extracting text:", error);
        this.showNotification(
          "Failed to extract text: " + error.message,
          "error",
        );
      } finally {
        this.processingFiles.delete(fileId);
      }
    },
  };
}
