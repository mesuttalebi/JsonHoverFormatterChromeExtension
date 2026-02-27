let currentTarget = null;
let actionBar = null;
let currentJsonText = "";
let currentParsedJson = null;
let isAlwaysReplace = false;

// Load settings
chrome.storage.sync.get(['alwaysReplace'], function (result) {
    isAlwaysReplace = result.alwaysReplace || false;
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (changes.alwaysReplace) {
        isAlwaysReplace = changes.alwaysReplace.newValue;
    }
});

let hoverTimer = null;

document.addEventListener('mouseover', (e) => {
    if (e.target.closest('#json-hover-action-bar') || e.target.closest('#json-hover-modal-overlay')) {
        return;
    }

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
        const match = findJsonAncestor(e.target);
        if (match) {
            // Found a valid JSON element
            if (currentTarget !== match.element) {
                removeHoverState();
                currentTarget = match.element;
                currentJsonText = match.text;
                currentParsedJson = match.parsed;

                if (isAlwaysReplace) {
                    replaceInPlace(currentTarget, currentParsedJson);
                    currentTarget = null;
                } else {
                    addHoverState(currentTarget);
                }
            }
        } else {
            // Not over a JSON element anymore
            if (currentTarget && !currentTarget.contains(e.target)) {
                removeHoverState();
            }
        }
    }, 150);
});

// Remove highlight when mouse leaves the highlighted area completely
document.addEventListener('mouseout', (e) => {
    if (currentTarget) {
        let toElement = e.relatedTarget;
        while (toElement && toElement !== currentTarget) {
            if (toElement.id === 'json-hover-action-bar') return; // Moved into action bar, keep highlight
            toElement = toElement.parentElement;
        }
        if (toElement === currentTarget) return; // Still inside currentTarget

        // Mouse left the target and not inside action bar
        removeHoverState();
    }
});

function findJsonAncestor(element) {
    let current = element;
    // Limit depth to avoid walking all the way to body too often if not needed
    let count = 0;
    while (current && current !== document.body && current !== document.documentElement && count < 10) {
        if (current.id === 'json-hover-action-bar' ||
            current.id === 'json-hover-modal-overlay' ||
            current.classList?.contains('json-hover-inline-pre')) {
            return null;
        }

        // If this element has already been replaced inline, use the stored original JSON
        if (current.dataset && current.dataset.jsonOriginal) {
            try {
                const parsed = JSON.parse(current.dataset.jsonOriginal);
                if (typeof parsed === 'object' && parsed !== null) {
                    return { element: current, text: current.dataset.jsonOriginal, parsed: parsed };
                }
            } catch (e) {
                // Stored value is not valid JSON, fall through
            }
        }

        // Skip elements that already contain our inline pre block (already replaced)
        if (current.querySelector && current.querySelector('.json-hover-inline-pre')) {
            return null;
        }

        if (!current.innerText && !current.textContent) {
            current = current.parentElement;
            count++;
            continue;
        }
        const text = (current.innerText || current.textContent).trim();
        if (text.length >= 2 && ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) {
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed === 'object' && parsed !== null) {
                    return { element: current, text: text, parsed: parsed };
                }
            } catch (e) {
                // Not JSON
            }
        }
        current = current.parentElement;
        count++;
    }
    return null;
}

function addHoverState(element) {
    element.classList.add('json-formatter-target');

    actionBar = document.createElement('div');
    actionBar.id = 'json-hover-action-bar';

    const btnModal = document.createElement('button');
    btnModal.innerText = 'Show in Modal';
    btnModal.title = 'View JSON in a modal window';
    btnModal.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        showModal(currentParsedJson);
    };

    const btnReplace = document.createElement('button');
    btnReplace.innerText = 'Replace Inline';
    btnReplace.title = 'Replace this text with formatted JSON in-place';
    btnReplace.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        replaceInPlace(element, currentParsedJson);
        removeHoverState();
    };

    actionBar.appendChild(btnModal);
    actionBar.appendChild(btnReplace);

    const rect = element.getBoundingClientRect();
    let topPos = rect.top + window.scrollY - 40;
    if (topPos < 0) topPos = rect.bottom + window.scrollY + 5; // Put below if no room above

    actionBar.style.top = `${topPos}px`;
    actionBar.style.left = `${rect.left + window.scrollX}px`;

    document.body.appendChild(actionBar);
}

function removeHoverState() {
    if (currentTarget) {
        currentTarget.classList.remove('json-formatter-target');
        currentTarget = null;
    }
    if (actionBar) {
        actionBar.remove();
        actionBar = null;
    }
}

function syntaxHighlight(json) {
    if (typeof json != 'string') {
        json = JSON.stringify(json, undefined, 2);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        var cls = 'json-value-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-value-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-value-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-value-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

function showModal(parsedJson) {
    removeHoverState();
    const existingModal = document.getElementById('json-hover-modal-overlay');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'json-hover-modal-overlay';

    const modal = document.createElement('div');
    modal.id = 'json-hover-modal';

    const header = document.createElement('div');
    header.id = 'json-hover-modal-header';

    const title = document.createElement('span');
    title.innerText = 'JSON Formatter';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'json-hover-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => overlay.remove();

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement('pre');
    content.id = 'json-hover-modal-content';
    content.innerHTML = syntaxHighlight(parsedJson);

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // Handle escape key
    const onEsc = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', onEsc);
        }
    };
    document.addEventListener('keydown', onEsc);
}

function replaceInPlace(element, parsedJson) {
    // Store the original JSON string on the element so subsequent hovers can
    // re-parse it correctly rather than reading the rendered HTML text.
    if (!element.dataset.jsonOriginal) {
        element.dataset.jsonOriginal = JSON.stringify(parsedJson);
    }
    const pre = document.createElement('pre');
    pre.className = 'json-hover-inline-pre';
    pre.innerHTML = syntaxHighlight(parsedJson);
    element.innerHTML = '';
    element.appendChild(pre);
}
