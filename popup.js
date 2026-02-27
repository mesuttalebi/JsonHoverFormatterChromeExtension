document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('alwaysReplace');

    chrome.storage.sync.get(['alwaysReplace'], function (result) {
        checkbox.checked = result.alwaysReplace || false;
    });

    checkbox.addEventListener('change', () => {
        chrome.storage.sync.set({ alwaysReplace: checkbox.checked });
    });
});
