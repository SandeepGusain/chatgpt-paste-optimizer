document.addEventListener('DOMContentLoaded', () => {
    const thresholdInput = document.getElementById('charThreshold');
    const prefixInput = document.getElementById('filenamePrefix');
    const previewCheck = document.getElementById('enablePreview');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');

    // Load Settings
    chrome.storage.local.get({
        charThreshold: 2000,
        filenamePrefix: "Snippet_",
        enablePreview: true
    }, (items) => {
        thresholdInput.value = items.charThreshold;
        prefixInput.value = items.filenamePrefix;
        previewCheck.checked = items.enablePreview;
    });

    // Save Settings
    saveBtn.addEventListener('click', () => {
        // Basic Sanitization: Remove unsafe characters from prefix
        let cleanPrefix = prefixInput.value.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!cleanPrefix) cleanPrefix = "Snippet_"; // Fallback if user clears it

        // Update UI with cleaned value
        prefixInput.value = cleanPrefix;

        chrome.storage.local.set({
            charThreshold: parseInt(thresholdInput.value, 10),
            filenamePrefix: cleanPrefix,
            enablePreview: previewCheck.checked
        }, () => {
            status.style.display = 'block';
            setTimeout(() => status.style.display = 'none', 2000);
        });
    });
});