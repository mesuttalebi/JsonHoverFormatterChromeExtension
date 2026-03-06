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

// ---------------------------------------------------------------------------
// Hover detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// JSON processing
// ---------------------------------------------------------------------------

/**
 * Recursively walks a parsed JSON value and tries to JSON.parse any string
 * values that look like escaped JSON objects/arrays.
 *
 * Performance guards:
 *  - Strings shorter than 7 chars can't be a meaningful JSON object → skip
 *  - Strings longer than 200 000 chars → skip to avoid blocking the thread
 *  - Only attempt parse if the trimmed string starts with { or [
 *  - Depth limit of 10 to prevent infinite recursion
 */
function deepParseJson(value, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 10) return value;

    if (typeof value === 'string') {
        // --- Performance fix: skip obviously non-JSON strings immediately ---
        if (value.length < 7 || value.length > 200000) return value;

        const trimmed = value.trim();
        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                const parsed = JSON.parse(trimmed);
                if (typeof parsed === 'object' && parsed !== null) {
                    // Successfully parsed — recurse into it too
                    return deepParseJson(parsed, depth + 1);
                }
            } catch (e) {
                // Not valid JSON, return as-is
            }
        }
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(item => deepParseJson(item, depth + 1));
    }

    if (typeof value === 'object' && value !== null) {
        const result = {};
        for (const key of Object.keys(value)) {
            result[key] = deepParseJson(value[key], depth + 1);
        }
        return result;
    }

    return value;
}

function syntaxHighlight(json) {
    if (typeof json != 'string') {
        json = JSON.stringify(json, undefined, 2);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/(\"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*\"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
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
    // Recursively unescape any nested JSON strings before rendering
    parsedJson = deepParseJson(parsedJson);
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

    // Bail out if we already replaced this element.
    if (element.querySelector('.json-hover-inline-pre')) {
        return;
    }

    // Recursively unescape any nested JSON strings before rendering
    parsedJson = deepParseJson(parsedJson);

    // IMPORTANT: Do NOT use element.innerHTML = '' here.
    // Pages built with React / Angular / Vue keep virtual-DOM references to
    // the original child nodes. Removing them via innerHTML causes the
    // framework's reconciliation to call removeChild on already-detached
    // nodes, producing:
    //   "NotFoundError: Failed to execute 'removeChild' on 'Node'"
    //
    // Instead, we HIDE element-children with CSS and blank out text nodes.
    // The nodes stay in the DOM so the framework never loses them.
    Array.from(element.childNodes).forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            // Hide element nodes without removing them
            node.style.cssText += ';display:none!important';
            node.dataset.jsonHoverHidden = '1';
        } else if (node.nodeType === Node.TEXT_NODE) {
            // Clear text nodes (they're not tracked by virtual-DOM frameworks)
            node._jsonHoverOriginalText = node.textContent;
            node.textContent = '';
        }
    });

    // Fix for horizontal scroll in complex flex/grid layouts:
    // We measure the container's actual width BEFORE inserting the <pre>.
    // This pins the <pre> to a hard pixel width so it won't force flex/grid columns to expand.
    const parentWidth = element.clientWidth;

    const pre = document.createElement('pre');
    pre.className = 'json-hover-inline-pre';
    pre.style.setProperty('max-width', `${parentWidth}px`, 'important');
    pre.innerHTML = syntaxHighlight(parsedJson);
    element.appendChild(pre);
}
